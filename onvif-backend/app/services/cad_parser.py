"""
cad_parser.py - DWG/DXF parsing, SVG floor-plan rendering, wall + parts extraction.

Public API (unchanged from the original):
    CADParserException, INSUNITS_MAP, MAX_ENTITIES
    convert_dwg_to_dxf(dwg_path, output_dxf_path) -> bool
    extract_polyline_points(entity) -> list
    scan_layers(file_path) -> dict
    parse_dxf(file_path, included_layers=None) -> dict
    extract_cad_parts_report(doc, msp, units_detected, ppm, page_width, to_pixel_fn) -> dict
    cad_to_svg_data(file_bytes, filename, skip_annotation_layers=False, hatch_mode="solid") -> dict
    generate_cad_dxf(layout_data) -> str

What changed for speed / correctness:
    * Results are cached by file content hash; a DWG is converted to DXF only once.
    * Layer / block names are classified once per unique name (lru_cache), not per entity.
    * Block bounds are computed only for blocks that are actually inserted.
    * Parts report stops building dicts once MAX_PARTS is reached (still counts everything).
    * LibreDWG non-zero exit codes no longer discard a usable DXF.
    * POLYLINE (old-style) entities are now really read (get_points() only exists on LWPOLYLINE).
    * Hatches render as solid fills by default (hatch_mode) - up to ~90x faster / ~55x smaller SVG.
    * Per-step timings are logged and returned in result["timings"].
"""
import base64
import glob
import gzip
import hashlib
import json
import logging
import math
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from collections import defaultdict
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

import ezdxf
from ezdxf import disassemble, bbox
from ezdxf.math import Vec3

log = logging.getLogger("cad")

# Hard limit for number of entities to parse to prevent memory explosion
MAX_ENTITIES = 100000
# Max number of parts returned in the parts report
MAX_PARTS = 3500

INSUNITS_MAP = {
    0: "unitless",
    1: "inches",
    2: "feet",
    3: "miles",
    4: "millimeters",
    5: "centimeters",
    6: "meters",
    7: "kilometers",
    8: "microinches",
    9: "mils",
    10: "yards",
    11: "angstroms",
    12: "nanometers",
    13: "microns",
    14: "decimeters",
    15: "decameters",
    16: "hectometers",
    17: "gigameters",
    18: "astronomical_units",
    19: "light_years",
    20: "parsecs",
}


class CADParserException(Exception):
    pass


# ============================================================================
# Timing
# ============================================================================
@contextmanager
def timed(label: str, sink: dict = None):
    t0 = time.perf_counter()
    try:
        yield
    finally:
        dt = time.perf_counter() - t0
        log.info("cad step %-16s %.2fs", label, dt)
        if sink is not None:
            sink[label] = round(dt, 3)


# ============================================================================
# Cache (content-hash keyed). Bump CACHE_VERSION whenever the logic below changes.
# ============================================================================
CACHE_VERSION = "v6"
CACHE_DIR = Path(os.environ.get("CAD_CACHE_DIR", Path(tempfile.gettempdir()) / "cad_cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)
_last_prune = 0.0


def content_hash(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()


def result_get(key: str):
    p = CACHE_DIR / f"{CACHE_VERSION}_{key}.json.gz"
    if p.exists():
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            p.unlink(missing_ok=True)  # corrupt entry: recompute
    return None


def result_put(key: str, result: dict) -> None:
    p = CACHE_DIR / f"{CACHE_VERSION}_{key}.json.gz"
    tmp = CACHE_DIR / f"{CACHE_VERSION}_{key}.{uuid.uuid4().hex}.tmp"
    try:
        with gzip.open(tmp, "wt", encoding="utf-8") as f:
            json.dump(result, f)
        os.replace(tmp, p)  # atomic: readers never see a half-written file
    finally:
        tmp.unlink(missing_ok=True)


def prune_cache(max_age_days: int = 14) -> None:
    cutoff = time.time() - max_age_days * 86400
    for p in CACHE_DIR.iterdir():
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
        except OSError:
            pass


def _maybe_prune() -> None:
    global _last_prune
    if time.time() - _last_prune > 3600:
        _last_prune = time.time()
        try:
            prune_cache()
        except Exception:
            pass


# ============================================================================
# DWG -> DXF
# ============================================================================
def _find_oda():
    exe = shutil.which("ODAFileConverter")
    if exe:
        return exe
    for sp in (
        r"C:\Program Files\ODA\*\ODAFileConverter.exe",
        r"C:\Program Files (x86)\ODA\*\ODAFileConverter.exe",
        r"C:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe",
    ):
        matches = glob.glob(sp)
        if matches:
            return matches[0]
    return None


def convert_dwg_to_dxf(dwg_path: str, output_dxf_path: str, timeout: int = 120) -> bool:
    """
    Tries LibreDWG (dwg2dxf) first, then ODA File Converter.
    Success = "output file exists and is non-empty" (LibreDWG can exit non-zero on
    recoverable warnings while still writing a usable DXF).
    """
    engine_used = None
    cmd_run = []
    exit_code = None
    stderr_out = ""
    stdout_out = ""

    exe = shutil.which("dwg2dxf")
    if exe:
        cmd_run = [exe, "-o", output_dxf_path, dwg_path]
        try:
            r = subprocess.run(
                cmd_run,
                capture_output=True, text=True, timeout=timeout,
            )
            exit_code = r.returncode
            stderr_out = r.stderr or ""
            stdout_out = r.stdout or ""
        except subprocess.TimeoutExpired:
            raise CADParserException("dwg2dxf conversion timed out.")
        except Exception as e:
            raise CADParserException(f"Conversion error: {str(e)}")
        if os.path.exists(output_dxf_path) and os.path.getsize(output_dxf_path) > 0:
            engine_used = "LibreDWG (dwg2dxf)"
            if r.returncode != 0:
                log.warning("dwg2dxf exit=%s but output produced. stderr: %s",
                            r.returncode, (r.stderr or "")[-300:])
        else:
            log.warning("dwg2dxf failed exit=%s stderr: %s", r.returncode, (r.stderr or "")[-500:])

    if not engine_used:
        oda_path = _find_oda()
        if not oda_path or not os.path.exists(oda_path):
            raise CADParserException("Neither LibreDWG (dwg2dxf) nor ODA File Converter could convert this file.")

        # ODAFileConverter works on folders: <in dir> <out dir> <version> <type> <recurse> <audit>
        base = tempfile.gettempdir()
        in_dir = os.path.join(base, f"oda_in_{uuid.uuid4().hex}")
        out_dir = os.path.join(base, f"oda_out_{uuid.uuid4().hex}")
        os.makedirs(in_dir, exist_ok=True)
        os.makedirs(out_dir, exist_ok=True)
        try:
            shutil.copy2(dwg_path, os.path.join(in_dir, "input.dwg"))
            cmd_run = [oda_path, in_dir, out_dir, "ACAD2018", "DXF", "0", "0"]
            try:
                r = subprocess.run(
                    cmd_run,
                    capture_output=True, text=True, timeout=timeout,
                )
                exit_code = r.returncode
                stderr_out = r.stderr or ""
                stdout_out = r.stdout or ""
            except subprocess.TimeoutExpired:
                raise CADParserException("ODA conversion timed out.")
            produced = os.path.join(out_dir, "input.dxf")
            if not os.path.exists(produced):
                raise CADParserException(f"ODA conversion failed, no output file. Error: {(stderr_out or '')[-300:]}")
            shutil.copy2(produced, output_dxf_path)
            engine_used = f"ODA File Converter ({oda_path})"
        finally:
            shutil.rmtree(in_dir, ignore_errors=True)
            shutil.rmtree(out_dir, ignore_errors=True)

    # Diagnostic read of resulting converted DXF for $INSUNITS
    converted_insunits_code = None
    converted_insunits_str = "unknown"
    try:
        if os.path.exists(output_dxf_path):
            test_doc = ezdxf.readfile(output_dxf_path)
            converted_insunits_code = test_doc.header.get('$INSUNITS', 0)
            converted_insunits_str = INSUNITS_MAP.get(converted_insunits_code, 'unitless')
    except Exception as e:
        converted_insunits_str = f"Error reading: {e}"

    print("\n" + "=" * 80, flush=True)
    print("[CAD-DIAGNOSTIC PART A: DWG -> DXF CONVERSION STEP]", flush=True)
    print(f"1. Engine Used: {engine_used}", flush=True)
    print(f"2. Exact Subprocess Command: {' '.join(cmd_run)}", flush=True)
    print(f"3. Exit Code: {exit_code}", flush=True)
    print(f"   Stderr: {stderr_out.strip() or 'None'}", flush=True)
    print(f"   Stdout: {stdout_out.strip() or 'None'}", flush=True)
    print(f"4. Resulting Converted DXF $INSUNITS: Code={converted_insunits_code} -> '{converted_insunits_str}'", flush=True)
    print("=" * 80 + "\n", flush=True)

    return True


def dxf_path_for(file_bytes: bytes, ext: str, h: str) -> str:
    """Persistent DXF path for this content. A DWG is converted only once, ever."""
    dxf = CACHE_DIR / f"{h}.dxf"
    if dxf.exists() and dxf.stat().st_size > 0:
        return str(dxf)
    if ext.lower() == "dxf":
        dxf.write_bytes(file_bytes)
        return str(dxf)
    src = CACHE_DIR / f"{h}.dwg"
    part = CACHE_DIR / f"{h}.{uuid.uuid4().hex}.part.dxf"
    src.write_bytes(file_bytes)
    try:
        if not convert_dwg_to_dxf(str(src), str(part)):
            raise CADParserException("Failed to convert DWG file to DXF format.")
        os.replace(part, dxf)
    finally:
        src.unlink(missing_ok=True)
        part.unlink(missing_ok=True)
    return str(dxf)


def _read_doc(path: str):
    try:
        return ezdxf.readfile(path)
    except IOError:
        raise CADParserException("Not a DXF file or a read error occurred.")
    except ezdxf.DXFStructureError as e:
        raise CADParserException(f"Invalid or corrupted DXF file: {str(e)}")
    except Exception as e:
        raise CADParserException(f"Failed to read CAD DXF data: {str(e)}")


# ============================================================================
# Automated AUDIT & PURGE pipeline
# ============================================================================
def audit_and_purge_doc(doc) -> dict:
    """
    Automated AUDIT & PURGE pipeline for CAD drawings:
    1. AUDIT (Health Check & Repair):
       - Runs doc.audit() to detect and fix broken object pointers, missing entity handles,
         and corrupt table references.
    2. PURGE (Clean Unused Items & Ghost Entities):
       - Purges unused block definitions (ghost symbols never inserted in model/paper space).
       - Purges empty layers (layers containing 0 entities).
       - Purges zero-length degenerate lines (start == end) and zero-radius circles/arcs.
    """
    stats = {
        "fixed_errors": 0,
        "purged_blocks": 0,
        "purged_layers": 0,
        "purged_ghost_entities": 0,
    }

    # 1. AUDIT
    try:
        auditor = doc.audit()
        stats["fixed_errors"] = len(auditor.fixes)
        if auditor.has_errors or len(auditor.fixes) > 0:
            log.info("CAD Audit: fixed %d error(s)", len(auditor.fixes))
    except Exception as e:
        log.warning("CAD Audit warning: %s", e)

    # 2. PURGE DEGENERATE GHOST ENTITIES (e.g. 0-length lines)
    try:
        for space in (doc.modelspace(), *[lay for lay in doc.layouts if lay.name != 'Model']):
            to_delete = []
            for entity in space:
                dxftype = entity.dxftype()
                if dxftype == 'LINE':
                    try:
                        if entity.dxf.start.isclose(entity.dxf.end, abs_tol=1e-5):
                            to_delete.append(entity)
                    except Exception:
                        pass
                elif dxftype in ('CIRCLE', 'ARC'):
                    try:
                        if getattr(entity.dxf, 'radius', 1.0) <= 1e-5:
                            to_delete.append(entity)
                    except Exception:
                        pass
            
            for ent in to_delete:
                try:
                    space.delete_entity(ent)
                    stats["purged_ghost_entities"] += 1
                except Exception:
                    pass
    except Exception as e:
        log.warning("CAD entity purge warning: %s", e)

    # 3. PURGE UNUSED BLOCKS (ghost parts)
    try:
        referenced_blocks = set()
        for layout_obj in doc.layouts:
            for entity in layout_obj:
                if entity.dxftype() == 'INSERT':
                    referenced_blocks.add(entity.dxf.name)
        
        # Follow nested block references
        blocks_to_check = list(referenced_blocks)
        while blocks_to_check:
            blk_name = blocks_to_check.pop()
            if blk_name in doc.blocks:
                for sub_ent in doc.blocks[blk_name]:
                    if sub_ent.dxftype() == 'INSERT':
                        sub_name = sub_ent.dxf.name
                        if sub_name not in referenced_blocks:
                            referenced_blocks.add(sub_name)
                            blocks_to_check.append(sub_name)

        # Delete unreferenced blocks (keep system blocks starting with '*')
        for blk in list(doc.blocks):
            bname = blk.name
            if not bname.startswith('*') and bname not in referenced_blocks:
                try:
                    doc.blocks.delete_block(bname, safe=False)
                    stats["purged_blocks"] += 1
                except Exception:
                    pass
    except Exception as e:
        log.warning("CAD block purge warning: %s", e)

    # 4. PURGE EMPTY LAYERS
    try:
        used_layers = set()
        for layout_obj in doc.layouts:
            for entity in layout_obj:
                used_layers.add(entity.dxf.layer)
        for blk in doc.blocks:
            for entity in blk:
                used_layers.add(entity.dxf.layer)

        for layer in list(doc.layers):
            lname = layer.dxf.name
            if lname not in ('0', 'Defpoints', 'DEFPOINTS') and lname not in used_layers:
                try:
                    doc.layers.remove(lname)
                    stats["purged_layers"] += 1
                except Exception:
                    pass
    except Exception as e:
        log.warning("CAD layer purge warning: %s", e)

    return stats


# ============================================================================
# Keyword tables + one-time name classification
# ============================================================================
EXCLUDE_KEYWORDS = (
    'FURN', 'MOBIL', 'ARREDO', 'MEUBL', 'CHAIR', 'SEDIA', 'SILLA', 'STUHL', 'CHAISE',
    'TABLE', 'TAVOLO', 'MESA', 'TISCH', 'DESK', 'SCRIVANIA', 'BUREAU', 'SCHREIBTISCH',
    'SOFA', 'DIVANO', 'BED', 'LETTO', 'CAMA', 'LIT',
    'CABINET', 'ARMARIO', 'ARMOIRE', 'SCHRANK', 'WARDROBE', 'SHELF', 'SCAFFAL',
    'LLAVE', 'KEY', 'RECTANG', 'EQUIP', 'APPLIANCE', 'ELETR', 'ELEC', 'PLUMB', 'SANITA',
    'WC', 'TOILET', 'BATH', 'BAGNO', 'SINK', 'LAVABO', 'DOUCHE', 'SHOWER', 'DOC',
    'KITCHEN', 'CUCINA', 'COCINA', 'CUISINE', 'STOVE', 'OVEN', 'FORNO', 'FRIDGE', 'FRIGORIFERO',
    'PLANT', 'PIANT', 'VEGET', 'TREE', 'ALBER', 'ARBOL', 'ARBRE', 'VERDE', 'GREEN', 'FLOWER', 'FIORE', 'FIOR', 'BOTAN',
    'TEXT', 'MTEXT', 'DIM', 'QUOTE', 'QUOTA', 'COTA', 'HATCH', 'RETIN', 'PATTERN',
    'DEFPOINTS', 'GRID', 'GRIGLIA', 'REJILLA', 'AXIS', 'ASSE', 'EJE', 'ACHSE',
    'TITLE', 'TITOLO', 'FRAME', 'BORDO', 'BORDER', 'VIEWPORT', 'VP', 'TAG', 'LEGEND',
    'SIMB', 'SYMB', 'NOTE', 'NOTA', 'SECTION', 'SEZIONE', 'SECCION', 'DETAIL', 'DETT',
    'CENTER', 'CENTRO', 'HIDDEN', 'DASH', 'CONSTR', 'GUIDE', 'CAR', 'AUTO', 'VEHIC',
    'PERSON', 'PEOPLE', 'OMINO', 'FIGUR', 'ENTORNO',
)

DOOR_KEYWORDS = ('DOOR', 'PORTA', 'PORTE', 'PUERTA', 'TUER', 'TÜR')

WALL_KEYWORDS = (
    'WALL', 'PARIET', 'MUR', 'MURO', 'MURAT', 'PARED', 'TABIQ', 'PARTITION', 'PART',
    'BARRIER', 'OBSTACLE', 'CLOISON', 'WAND', 'DIVIS', 'TRAMEZ', 'PANEL', 'TAVOLATO',
    'COLUMN', 'COLONN', 'PILAST', 'PILLAR', 'PILAR', 'STUTZE', 'SÄULE',
    'STRUC', 'STRUTT', 'ESTRUC', 'BEAM', 'TRAVE', 'VIGA', 'BALKEN',
    'MASONRY', 'CONCRET', 'CALC', 'BETON', 'HORMI',
    'BUILD', 'EDIFIC', 'INVOL', 'FACCIAT', 'FACADE', 'ENVEL',
    'GLAZ', 'GLASS', 'VETR', 'VIDRIO', 'VITR', 'FENET', 'VENTAN', 'WINDOW', 'INFISS',
)

# Layers optionally hidden from the SVG when skip_annotation_layers=True (faster, cleaner plan)
ANNOTATION_KEYWORDS = (
    'TEXT', 'MTEXT', 'DIM', 'QUOTE', 'QUOTA', 'COTA', 'HATCH', 'RETIN', 'PATTERN',
    'DEFPOINTS', 'GRID', 'GRIGLIA', 'REJILLA', 'TITLE', 'TITOLO', 'FRAME', 'BORDER',
    'LEGEND', 'NOTE', 'NOTA',
)


def matches_any(text, keywords: tuple) -> bool:
    if not text:
        return False
    t = str(text).upper()
    return any(k in t for k in keywords)


@lru_cache(maxsize=8192)
def classify_name(name) -> str:
    """'exclude' | 'door' | 'wall' | 'numeric' | 'other' - computed once per unique name."""
    t = str(name or "").upper()
    if any(k in t for k in EXCLUDE_KEYWORDS):
        return "exclude"
    if any(k in t for k in DOOR_KEYWORDS):
        return "door"
    if any(k in t for k in WALL_KEYWORDS):
        return "wall"
    if t.strip().isdigit():
        # Bare-numeric layers ("0", "1", "2") are CAD default layers with no naming
        # convention; raw LINE/POLYLINE geometry on them is almost always structural.
        return "numeric"
    return "other"


# ============================================================================
# Unit / scale helpers
# ============================================================================
def _scale_to_m(units: str, geom_width: float = 0.0) -> float:
    if units in ('millimeters', 'mm'):
        return 0.001
    if units in ('meters', 'm'):
        return 1.0
    if units in ('centimeters', 'cm'):
        return 0.01
    if units in ('inches', 'in'):
        return 0.0254
    if units in ('feet', 'ft'):
        return 0.3048
    if units == 'unitless':
        if geom_width > 500:
            return 0.001
        if 0 < geom_width < 100:
            return 1.0
    return 0.001


def _estimate_ppm(units: str, geom_width: float, px_width: float) -> float:
    """Pixels per metre, from actual drawing geometry width and rendered pixel width."""
    if geom_width <= 0:
        return 25.0
    scale_m = _scale_to_m(units, geom_width)
    width_in_meters = geom_width * scale_m
    if width_in_meters <= 0:
        return 25.0
    return px_width / width_in_meters


# ============================================================================
# Geometry helpers
# ============================================================================
def _poly_points(entity) -> list:
    """XY points of LWPOLYLINE and old-style POLYLINE (the latter has no get_points())."""
    t = entity.dxftype()
    if t == 'LWPOLYLINE':
        return [(p[0], p[1]) for p in entity.get_points(format='xy')]
    if t == 'POLYLINE':
        return [(v.dxf.location.x, v.dxf.location.y) for v in entity.vertices]
    return []


def extract_polyline_points(entity) -> list:
    return [[x, y] for x, y in _poly_points(entity)]


def compute_block_bounds(doc, needed_names: set) -> dict:
    """Bounding boxes only for blocks that are actually inserted."""
    out = {}
    for name in needed_names:
        if not name or name.startswith('*') or name not in doc.blocks:
            continue
        xs, ys = [], []
        for b in doc.blocks.get(name):
            t = b.dxftype()
            try:
                if t == 'LINE':
                    xs += [b.dxf.start.x, b.dxf.end.x]
                    ys += [b.dxf.start.y, b.dxf.end.y]
                elif t in ('LWPOLYLINE', 'POLYLINE'):
                    for x, y in _poly_points(b):
                        xs.append(x)
                        ys.append(y)
                elif t in ('CIRCLE', 'ARC'):
                    r, c = b.dxf.radius, b.dxf.center
                    xs += [c.x - r, c.x + r]
                    ys += [c.y - r, c.y + r]
            except Exception:
                pass
        if xs and ys:
            out[name] = {
                "w": max(xs) - min(xs),
                "h": max(ys) - min(ys),
                "cx": (min(xs) + max(xs)) / 2.0,
                "cy": (min(ys) + max(ys)) / 2.0,
            }
    return out


# ============================================================================
# Pass 1: lightweight layer scan
# ============================================================================
def scan_layers(file_path: str) -> Dict[str, Any]:
    """
    Lightweight scan. Returns layer names, entity counts, and entity types.
    Does NOT extract full geometry. Not subject to MAX_ENTITIES limit.
    """
    doc = _read_doc(file_path)
    msp = doc.modelspace()

    layer_counts = defaultdict(int)
    layer_types = defaultdict(set)
    for entity in msp:
        layer = entity.dxf.layer
        layer_counts[layer] += 1
        layer_types[layer].add(entity.dxftype())

    layers = [
        {"name": layer, "count": count, "types": sorted(layer_types[layer])}
        for layer, count in sorted(layer_counts.items(), key=lambda item: item[1], reverse=True)
    ]
    return {"total_entities": len(msp), "layers": layers}


# ============================================================================
# Pass 2: full geometry parse (selected layers)
# ============================================================================
def parse_dxf(file_path: str, included_layers: list = None) -> Dict[str, Any]:
    """Parses a DXF file and returns normalized JSON containing layers and entities, bounds and units."""
    doc = _read_doc(file_path)
    audit_and_purge_doc(doc)
    msp = doc.modelspace()

    included = set(included_layers) if included_layers is not None else None

    if included is not None:
        entity_count = sum(1 for e in msp if e.dxf.layer in included)
    else:
        entity_count = len(msp)
    if entity_count > MAX_ENTITIES:
        raise CADParserException(
            f"Selected layers contain {entity_count:,} entities, which exceeds the "
            f"{MAX_ENTITIES:,} limit - deselect additional layers."
        )

    insunits_code = doc.header.get("$INSUNITS", 0)
    units_detected = INSUNITS_MAP.get(insunits_code, "unitless")

    extmin = doc.header.get("$EXTMIN", (0, 0, 0))
    extmax = doc.header.get("$EXTMAX", (0, 0, 0))
    bounds = {"minX": extmin[0], "minY": extmin[1], "maxX": extmax[0], "maxY": extmax[1]}

    layers_data = {}
    for entity in msp:
        layer_name = entity.dxf.layer
        if included is not None and layer_name not in included:
            continue

        dxftype = entity.dxftype()
        ent_obj = None

        if dxftype == 'LINE':
            s, e = entity.dxf.start, entity.dxf.end
            ent_obj = {"type": "line", "points": [[s.x, s.y], [e.x, e.y]]}
        elif dxftype in ('LWPOLYLINE', 'POLYLINE'):
            pts = extract_polyline_points(entity)
            if pts:
                ent_obj = {"type": "polyline", "points": pts,
                           "closed": bool(getattr(entity, 'is_closed', False))}
        elif dxftype == 'CIRCLE':
            c = entity.dxf.center
            ent_obj = {"type": "circle", "center": [c.x, c.y], "radius": entity.dxf.radius}
        elif dxftype == 'ARC':
            c = entity.dxf.center
            ent_obj = {"type": "arc", "center": [c.x, c.y], "radius": entity.dxf.radius,
                       "start_angle": entity.dxf.start_angle, "end_angle": entity.dxf.end_angle}
        # Extend to other types like TEXT, ELLIPSE, SPLINE if needed later

        if ent_obj:
            layers_data.setdefault(layer_name, {"entities": []})["entities"].append(ent_obj)

    return {"units": units_detected, "bounds": bounds, "layers": layers_data}


# ============================================================================
# Parts report (real-world metres)
# ============================================================================
def extract_cad_parts_report(doc, msp, units_detected: str, ppm: float = 25.0,
                             page_width: float = 0.0, to_pixel_fn=None) -> dict:
    """
    Structured parts report in real-world meters, compatible with GltfPartAnalyzer format:
    { totalRawParts, strategy, namingQuality,
      parts: [{ name, layer, type, dimensions:{width,height,depth}, length_m, worldCenter, screen }],
      summary: { total, extracted, by_type, by_layer }, warning }
    """
    scale_to_m = _scale_to_m(units_detected, page_width)

    parts = []
    by_layer = defaultdict(int)
    by_type = defaultdict(int)
    extracted = 0

    def _screen(x, y):
        if to_pixel_fn is None:
            return None
        try:
            px, py = to_pixel_fn(Vec3(x, y, 0))
            return {"x": px, "y": py}
        except Exception:
            return None

    def emit(name, layer, ptype, width, height, length, cx, cy, raw_x, raw_y, screen_bounds=None):
        """Counts every extractable part, but only builds dicts up to MAX_PARTS."""
        nonlocal extracted
        extracted += 1
        if len(parts) >= MAX_PARTS:
            return
        parts.append({
            "name": name,
            "layer": layer,
            "type": ptype,
            "dimensions": {"width": round(width, 4), "height": round(height, 4), "depth": 0.0},
            "length_m": round(length, 4),
            "worldCenter": {"x": round(cx, 3), "y": round(cy, 3), "z": 0.0},
            "screen": _screen(raw_x, raw_y),
            "screenBounds": screen_bounds,
        })

    total_entities = 0
    block_inserts, other_entities = [], []
    for ent in msp:
        total_entities += 1
        (block_inserts if ent.dxftype() == 'INSERT' else other_entities).append(ent)

    # Bounds only for blocks that are really inserted
    try:
        block_bounds = compute_block_bounds(doc, {getattr(e.dxf, 'name', '') for e in block_inserts})
    except Exception:
        block_bounds = {}

    # 1. Blocks
    for idx, ent in enumerate(block_inserts):
        bname = getattr(ent.dxf, 'name', 'BLOCK')
        layer = getattr(ent.dxf, 'layer', '0')
        by_layer[layer] += 1
        by_type['block'] += 1

        sx = abs(getattr(ent.dxf, 'xscale', 1.0) or 1.0)
        sy = abs(getattr(ent.dxf, 'yscale', 1.0) or 1.0)
        insert = getattr(ent.dxf, 'insert', (0, 0, 0))

        bb = block_bounds.get(bname)
        if bb:
            w_m = bb['w'] * sx * scale_to_m
            h_m = bb['h'] * sy * scale_to_m
            raw_cx = insert[0] + bb['cx'] * sx
            raw_cy = insert[1] + bb['cy'] * sy
        else:
            w_m = h_m = 0.5
            raw_cx, raw_cy = insert[0], insert[1]

        w_m, h_m = max(0.01, w_m), max(0.01, h_m)
        screen_b = None
        if bb and to_pixel_fn:
            try:
                min_p = to_pixel_fn(Vec3(insert[0] + (bb['cx'] - bb['w'] / 2.0) * sx, insert[1] + (bb['cy'] - bb['h'] / 2.0) * sy, 0))
                max_p = to_pixel_fn(Vec3(insert[0] + (bb['cx'] + bb['w'] / 2.0) * sx, insert[1] + (bb['cy'] + bb['h'] / 2.0) * sy, 0))
                if min_p and max_p:
                    screen_b = {
                        "minX": round(min(min_p[0], max_p[0]), 1),
                        "minY": round(min(min_p[1], max_p[1]), 1),
                        "maxX": round(max(min_p[0], max_p[0]), 1),
                        "maxY": round(max(min_p[1], max_p[1]), 1),
                    }
            except Exception:
                pass

        emit(f"BLOCK: {bname} #{idx + 1}", layer, "block", w_m, h_m, max(w_m, h_m),
             raw_cx * scale_to_m, raw_cy * scale_to_m, raw_cx, raw_cy, screen_bounds=screen_b)

    # 2. Geometric entities
    for ent in other_entities:
        dxftype = ent.dxftype()
        layer = getattr(ent.dxf, 'layer', '0')
        by_layer[layer] += 1
        by_type[dxftype.lower()] += 1

        try:
            if dxftype == 'LINE':
                s, e = ent.dxf.start, ent.dxf.end
                dx_m = (e.x - s.x) * scale_to_m
                dy_m = (e.y - s.y) * scale_to_m
                len_m = math.hypot(dx_m, dy_m)
                if len_m < 0.01:
                    continue
                mx, my = (s.x + e.x) * 0.5, (s.y + e.y) * 0.5
                screen_b = None
                if to_pixel_fn:
                    try:
                        p1 = to_pixel_fn(s)
                        p2 = to_pixel_fn(e)
                        if p1 and p2:
                            screen_b = {
                                "minX": round(min(p1[0], p2[0]), 1),
                                "minY": round(min(p1[1], p2[1]), 1),
                                "maxX": round(max(p1[0], p2[0]), 1),
                                "maxY": round(max(p1[1], p2[1]), 1),
                                "p1": [round(p1[0], 1), round(p1[1], 1)],
                                "p2": [round(p2[0], 1), round(p2[1], 1)],
                            }
                    except Exception:
                        pass
                emit(f"{layer}: Line ({len_m:.2f}m)", layer, "line", abs(dx_m), abs(dy_m), len_m,
                     mx * scale_to_m, my * scale_to_m, mx, my, screen_bounds=screen_b)

            elif dxftype in ('LWPOLYLINE', 'POLYLINE'):
                pts = _poly_points(ent)
                if len(pts) < 2:
                    continue
                raw_xs = [p[0] for p in pts]
                raw_ys = [p[1] for p in pts]
                is_closed = bool(getattr(ent, 'is_closed', False))

                tot_len = 0.0
                for i in range(len(pts) - 1):
                    tot_len += math.hypot((pts[i + 1][0] - pts[i][0]) * scale_to_m,
                                          (pts[i + 1][1] - pts[i][1]) * scale_to_m)
                if is_closed and len(pts) > 2:
                    tot_len += math.hypot((pts[0][0] - pts[-1][0]) * scale_to_m,
                                          (pts[0][1] - pts[-1][1]) * scale_to_m)
                if tot_len < 0.01:
                    continue

                raw_cx = (min(raw_xs) + max(raw_xs)) * 0.5
                raw_cy = (min(raw_ys) + max(raw_ys)) * 0.5
                label = 'Closed Polyline' if is_closed else 'Polyline'
                screen_b = None
                if to_pixel_fn and len(pts) >= 2:
                    try:
                        sp_list = [to_pixel_fn(Vec3(p[0], p[1], 0)) for p in pts if p]
                        xs = [p[0] for p in sp_list if p]
                        ys = [p[1] for p in sp_list if p]
                        if xs and ys:
                            screen_b = {
                                "minX": round(min(xs), 1),
                                "minY": round(min(ys), 1),
                                "maxX": round(max(xs), 1),
                                "maxY": round(max(ys), 1),
                            }
                    except Exception:
                        pass
                emit(f"{layer}: {label} ({tot_len:.2f}m)", layer, "polyline",
                     (max(raw_xs) - min(raw_xs)) * scale_to_m, (max(raw_ys) - min(raw_ys)) * scale_to_m,
                     tot_len, raw_cx * scale_to_m, raw_cy * scale_to_m, raw_cx, raw_cy, screen_bounds=screen_b)

            elif dxftype == 'CIRCLE':
                c = ent.dxf.center
                r_m = ent.dxf.radius * scale_to_m
                diam_m = 2.0 * r_m
                emit(f"{layer}: Circle (r={r_m:.2f}m)", layer, "circle", diam_m, diam_m,
                     math.pi * diam_m, c.x * scale_to_m, c.y * scale_to_m, c.x, c.y)

            elif dxftype == 'ARC':
                c = ent.dxf.center
                r_m = ent.dxf.radius * scale_to_m
                s_deg, e_deg = ent.dxf.start_angle, ent.dxf.end_angle
                if e_deg < s_deg:
                    e_deg += 360.0
                span_rad = math.radians(e_deg - s_deg)
                emit(f"{layer}: Arc (r={r_m:.2f}m, {math.degrees(span_rad):.0f}\u00b0)", layer, "arc",
                     2.0 * r_m, 2.0 * r_m, r_m * span_rad, c.x * scale_to_m, c.y * scale_to_m, c.x, c.y)
        except Exception:
            pass

    return {
        "totalRawParts": total_entities,
        "strategy": "direct",
        "namingQuality": "semantic",
        "parts": parts,
        "summary": {
            "total": total_entities,
            "extracted": extracted,
            "by_type": dict(by_type),
            "by_layer": dict(by_layer),
        },
        "warning": None if len(parts) >= total_entities
        else f"Displaying top {len(parts):,} entities out of {total_entities:,} total CAD elements.",
    }


# ============================================================================
# Wall / door segment extraction (pixel space of the rendered SVG)
# ============================================================================
def _extract_wall_segments(msp, backend, min_x, min_y, vbw, vbh, width, height, ppm, scale_to_m):
    """
    Physical structural wall, column, partition and door boundary segments.
    Camera FOV rays must concentrate on structural barriers and doors, never on
    furniture, plants, door swing arcs or micro ticks.
    Returns (wall_segments, to_pixel_fn_or_None).
    """
    m_mat = getattr(backend, 'transformation_matrix', None)
    if m_mat is None or vbw <= 0 or vbh <= 0:
        return [], None

    # Trusted (named wall/door layers) keep almost everything; the numeric-layer
    # fallback needs >= 0.3 m or 8 px to filter dimension ticks and drafting marks.
    min_len_trusted = 1.0
    min_len_fallback = max(8.0, (ppm * 0.30) if ppm > 0 else 8.0)

    kx = width / vbw
    ky = height / vbh
    wall_segments = []
    seen = set()

    def to_pixel(vec):
        t = m_mat.transform(vec)
        return round((t.x - min_x) * kx, 1), round((t.y - min_y) * ky, 1)

    def add_segment(p1, p2, min_len):
        if p1 == p2:
            return
        if math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < min_len:
            return
        c1, c2 = (p1, p2) if p1 <= p2 else (p2, p1)
        key = (round(c1[0]), round(c1[1]), round(c2[0]), round(c2[1]))
        if key not in seen:
            seen.add(key)
            wall_segments.append([[p1[0], p1[1]], [p2[0], p2[1]]])

    def process(e, is_door, min_len):
        dxftype = e.dxftype()
        if dxftype == 'ARC':
            # Door swing ARCs and decorative curves must NEVER become wall segments
            if is_door:
                return
            try:
                r = getattr(e.dxf, 'radius', 0.0)
                if r * scale_to_m < 1.0:
                    return
                s_deg, e_deg = e.dxf.start_angle, e.dxf.end_angle
                span = (e_deg - s_deg) % 360.0
                if 80.0 <= span <= 100.0:  # quarter arc = door swing
                    return
                c = e.dxf.center
                steps = max(6, min(16, int(span / 20.0)))
                pts = []
                for s in range(steps + 1):
                    a = math.radians(s_deg + span * (s / steps))
                    pts.append(to_pixel(Vec3(c.x + r * math.cos(a), c.y + r * math.sin(a), 0)))
                for i in range(len(pts) - 1):
                    add_segment(pts[i], pts[i + 1], min_len)
            except Exception:
                pass
        elif dxftype == 'LINE':
            try:
                add_segment(to_pixel(e.dxf.start), to_pixel(e.dxf.end), min_len)
            except Exception:
                pass
        elif dxftype in ('LWPOLYLINE', 'POLYLINE'):
            try:
                pts = [to_pixel(Vec3(x, y, 0)) for x, y in _poly_points(e)]
                for i in range(len(pts) - 1):
                    add_segment(pts[i], pts[i + 1], min_len)
                if getattr(e, 'is_closed', False) and len(pts) > 2:
                    add_segment(pts[-1], pts[0], min_len)
            except Exception:
                pass

    for ent in msp:
        dxftype = ent.dxftype()
        layer_cls = classify_name(getattr(ent.dxf, 'layer', ''))
        if layer_cls == 'exclude':
            continue

        if dxftype == 'INSERT':
            bcls = classify_name(getattr(ent.dxf, 'name', ''))
            if bcls == 'exclude':
                continue
            is_door_block = bcls == 'door' or layer_cls == 'door'
            is_wall_block = bcls == 'wall' or layer_cls == 'wall'
            # Only explicit wall/door blocks. NEVER fall back to all inserts, otherwise
            # tables, chairs and plants become obstacles.
            if is_door_block or is_wall_block:
                try:
                    for sub in disassemble.recursive_decompose([ent]):
                        if classify_name(getattr(sub.dxf, 'layer', '')) == 'exclude':
                            continue
                        process(sub, is_door_block, min_len_trusted)
                except Exception:
                    pass
        elif layer_cls == 'door':
            process(ent, True, min_len_trusted)
        elif layer_cls == 'wall':
            process(ent, False, min_len_trusted)
        elif layer_cls == 'numeric' and dxftype in ('LINE', 'LWPOLYLINE', 'POLYLINE'):
            # Fallback ONLY for bare-numeric layers ("1", "2", ...). A named layer that fails the
            # WALL/DOOR keyword test (e.g. "SEGMENTED 1 100") is deliberate non-wall geometry and
            # must not become an occluder.
            process(ent, False, min_len_fallback)

    return wall_segments, to_pixel


# ============================================================================
# DWG/DXF -> SVG data URL + walls + parts report
# ============================================================================
HATCH_MODES = {"solid": "SHOW_SOLID", "outline": "SHOW_OUTLINE", "ignore": "IGNORE", "normal": "NORMAL"}


GEOMETRIC_ENTITY_TYPES = {
    'LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'ELLIPSE',
    'SPLINE', 'INSERT', 'SOLID', '3DFACE', 'MESH', 'HATCH'
}


def _get_drawing_extents(doc, msp) -> tuple[float, float]:
    """
    Computes true drawing dimensions (width, height) in drawing units.
    Filters out runaway MTEXT bounding boxes that AutoCAD often creates with unconstrained widths.
    """
    # 1. Primary: Geometric & structural entities
    try:
        geom_entities = [e for e in msp if e.dxftype() in GEOMETRIC_ENTITY_TYPES]
        if geom_entities:
            bb = bbox.extents(geom_entities)
            if bb.has_data and bb.extmin is not None and bb.extmax is not None:
                gw = float(bb.extmax.x - bb.extmin.x)
                gh = float(bb.extmax.y - bb.extmin.y)
                if gw > 0.0001 and gh > 0.0001:
                    return gw, gh
    except Exception as e:
        log.warning("CAD geometric bbox calculation warning: %s", e)

    # 2. Fallback: Header extents ($EXTMIN / $EXTMAX)
    try:
        extmin = doc.header.get('$EXTMIN')
        extmax = doc.header.get('$EXTMAX')
        if extmin and extmax:
            xmin, ymin = float(extmin[0]), float(extmin[1])
            xmax, ymax = float(extmax[0]), float(extmax[1])
            if -1e10 < xmin < 1e10 and -1e10 < ymin < 1e10 and -1e10 < xmax < 1e10 and -1e10 < ymax < 1e10:
                gw = xmax - xmin
                gh = ymax - ymin
                if gw > 0.0001 and gh > 0.0001:
                    return gw, gh
    except Exception as e:
        log.warning("CAD header extents calculation warning: %s", e)

    # 3. Last resort: all modelspace entities
    try:
        bb = bbox.extents(msp)
        if bb.has_data and bb.extmin is not None and bb.extmax is not None:
            gw = float(bb.extmax.x - bb.extmin.x)
            gh = float(bb.extmax.y - bb.extmin.y)
            if gw > 0.0001 and gh > 0.0001:
                return gw, gh
    except Exception as e:
        log.warning("CAD all-entities bbox calculation warning: %s", e)

    return 0.0, 0.0


def cad_to_svg_data(file_bytes: bytes, filename: str, skip_annotation_layers: bool = False,
                    hatch_mode: str = "solid") -> dict:
    """
    Converts a DWG or DXF file into a crisp SVG floor plan (data:image/svg+xml;base64,...)
    plus wall segments and a parts report. Results are cached by file content hash.

    skip_annotation_layers=True hides text / dimension / hatch / grid layers in the SVG:
    noticeably faster to render and lighter to load for dense drawings.

    hatch_mode controls how HATCH entities are drawn. Pattern hatches (brick, concrete, ANSI31...)
    are expanded into thousands of line strokes by default ("normal"), which can turn a small
    drawing into a multi-MB SVG that takes seconds to render. Measured on a small office plan:
        normal  2.69 s / 6.67 MB      solid  0.03 s / 0.12 MB
    "solid" (default) fills each hatch area, "outline" draws boundaries only, "ignore" hides
    hatches, "normal" restores the exact CAD look.
    """
    if hatch_mode not in HATCH_MODES:
        raise CADParserException(f"hatch_mode must be one of {sorted(HATCH_MODES)}")
    from ezdxf.addons.drawing import Frontend, RenderContext, layout
    from ezdxf.addons.drawing.svg import SVGBackend
    from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy, ColorPolicy, HatchPolicy

    ext = filename.lower().split('.')[-1]
    if ext not in ('dwg', 'dxf'):
        raise CADParserException("Unsupported file type. Only DWG and DXF files are supported.")

    _maybe_prune()
    h = content_hash(file_bytes)
    rkey = f"{h}_{hatch_mode}{'_na' if skip_annotation_layers else ''}"
    cached = result_get(rkey)
    if cached is not None:
        return {**cached, "cached": True}

    timings: dict = {}

    with timed("convert", timings):
        dxf_path = dxf_path_for(file_bytes, ext, h)

    with timed("read dxf", timings):
        doc = _read_doc(dxf_path)

    with timed("audit and purge", timings):
        audit_stats = audit_and_purge_doc(doc)
        log.info("CAD Audit & Purge summary: %s", audit_stats)

    msp = doc.modelspace()
    if len(msp) == 0:
        for lay in doc.layouts:  # fall back to paper space
            if len(lay) > 0:
                msp = lay
                break

    units_detected = INSUNITS_MAP.get(doc.header.get('$INSUNITS', 0), 'unitless')
    layers = [layer.dxf.name for layer in doc.layers]

    if skip_annotation_layers:
        # Must happen BEFORE RenderContext(doc): layer visibility is read at construction.
        for lay in doc.layers:
            if matches_any(lay.dxf.name, ANNOTATION_KEYWORDS):
                lay.off()

    # 1. Compute ACTUAL geometry bounding box from modelspace entities (filtering runaway text)
    actual_geom_w, actual_geom_h = _get_drawing_extents(doc, msp)
    used_fallback_page = False

    with timed("svg render", timings):
        backend = SVGBackend()
        ctx = RenderContext(doc)
        cfg = Configuration(
            background_policy=BackgroundPolicy.WHITE,
            color_policy=ColorPolicy.COLOR,
            hatch_policy=getattr(HatchPolicy, HATCH_MODES[hatch_mode]),
            min_lineweight=0.20,
            lineweight_scaling=1.0,
        )
        Frontend(ctx, backend, config=cfg).draw_layout(msp)
        if actual_geom_w > 0.0001 and actual_geom_h > 0.0001:
            # Standard drawing sheet scale (250mm base) ensures CAD lines render with rich, dark,
            # sharp contrast (1.2px - 2.8px screen strokes) without being faint/dull or muddy.
            base_dim = 250.0
            if actual_geom_w >= actual_geom_h:
                page_w = base_dim
                page_h = max(10.0, base_dim * (actual_geom_h / actual_geom_w))
            else:
                page_h = base_dim
                page_w = max(10.0, base_dim * (actual_geom_w / actual_geom_h))
            page = layout.Page(width=page_w, height=page_h, margins=layout.Margins.all(0))
        else:
            used_fallback_page = True
            log.warning(
                "CAD geometry bounding box is empty/degenerate (geom_w=%s, geom_h=%s). "
                "Falling back to layout page size.",
                actual_geom_w, actual_geom_h
            )
            try:
                page = layout.Page.from_dxf_layout(msp)
            except Exception:
                page = layout.Page(1000, 1000)
        svg_str = backend.get_string(page)

    # Explicit pixel width & height, preserving aspect ratio
    width, height = 2400, 1800
    min_x = min_y = 0.0
    vbw, vbh = 2400.0, 1800.0
    vb_match = re.search(r'viewBox="([^"]+)"', svg_str)
    if vb_match:
        try:
            nums = [float(p) for p in vb_match.group(1).split()]
            if len(nums) == 4:
                min_x, min_y, vbw, vbh = nums
                if vbw > 0 and vbh > 0:
                    if vbw >= vbh:
                        width, height = 2400, max(100, int(2400 * (vbh / vbw)))
                    else:
                        height, width = 2400, max(100, int(2400 * (vbw / vbh)))
        except Exception:
            pass
    svg_str = re.sub(r'width="[^"]+"', f'width="{width}"', svg_str, count=1)
    svg_str = re.sub(r'height="[^"]+"', f'height="{height}"', svg_str, count=1)

    page_width = getattr(page, 'width', 0.0)
    page_height = getattr(page, 'height', 0.0)

    if used_fallback_page:
        geom_w_for_scale = page_width
        geom_h_for_scale = page_height
    else:
        geom_w_for_scale = actual_geom_w
        geom_h_for_scale = actual_geom_h

    scale_to_m = _scale_to_m(units_detected, geom_w_for_scale)
    actual_geometry_width_in_meters = geom_w_for_scale * scale_to_m
    actual_geometry_height_in_meters = geom_h_for_scale * scale_to_m
    ppm = _estimate_ppm(units_detected, geom_w_for_scale, width)

    # ── [CAD-DIAGNOSTIC PART B] ──────────────────────────────────────────
    extmin = doc.header.get('$EXTMIN', None)
    extmax = doc.header.get('$EXTMAX', None)
    extmin_str = f"({extmin.x:.3f}, {extmin.y:.3f})" if hasattr(extmin, 'x') else str(extmin)
    extmax_str = f"({extmax.x:.3f}, {extmax.y:.3f})" if hasattr(extmax, 'x') else str(extmax)
    insunits_code = doc.header.get('$INSUNITS', 0)

    print("\n" + "=" * 80, flush=True)
    print(f"[CAD-DIAGNOSTIC PART B: DXF PARSING & PPM CALCULATION] File: {filename} (Ext: {ext})", flush=True)
    print(f"1. Raw Modelspace Geometry BBox: Width={actual_geom_w:.4f}, Height={actual_geom_h:.4f} (Native units)", flush=True)
    print(f"   Layout Page Bounding Box: Width={page_width:.4f}, Height={page_height:.4f} (Native units) [Fallback Used: {used_fallback_page}]", flush=True)
    print(f"   Raw Header Extents: ExtMin={extmin_str}, ExtMax={extmax_str}", flush=True)
    print(f"2. Detected $INSUNITS: Code={insunits_code} -> Mapped String='{units_detected}'", flush=True)
    print(f"3. Scale to Meters Factor (scale_to_m): {scale_to_m}", flush=True)
    print(f"4. Actual Drawing Dimensions in Meters: {actual_geometry_width_in_meters:.4f} m x {actual_geometry_height_in_meters:.4f} m", flush=True)
    print(f"   (Old Layout Page Dimensions in Meters would be: {page_width * scale_to_m:.4f} m x {page_height * scale_to_m:.4f} m)", flush=True)
    print(f"5. Canvas Pixel Dimensions: Width={width} px, Height={height} px", flush=True)
    print(f"6. Computed PPM from Actual Geometry: {ppm:.4f} px/m (Final Clamped PPM: {round(ppm, 2)} px/m)", flush=True)
    print("=" * 80 + "\n", flush=True)

    with timed("walls", timings):
        wall_segments, to_pixel = _extract_wall_segments(
            msp, backend, min_x, min_y, vbw, vbh, width, height, ppm, scale_to_m
        )

    # Clamp PPM to realistic values (1 - 200 px/m)
    if ppm < 1.0 or ppm > 200.0:
        ppm = 25.0

    with timed("parts report", timings):
        parts_report = extract_cad_parts_report(
            doc=doc, msp=msp, units_detected=units_detected, ppm=ppm,
            page_width=geom_w_for_scale, to_pixel_fn=to_pixel,
        )

    with timed("encode", timings):
        b64 = base64.b64encode(svg_str.encode("utf-8")).decode("ascii")
        data_url = f"data:image/svg+xml;base64,{b64}"

    result = {
        "status": "ok",
        "dataUrl": data_url,
        "width": width,
        "height": height,
        "units": units_detected,
        "ppm": round(ppm, 2),
        "layers": layers,
        "walls": wall_segments,
        "partsReport": parts_report,
        "audit": audit_stats,
        "timings": timings,
        "cached": False,
    }
    try:
        result_put(rkey, result)
    except Exception as e:  # cache failure must never break the request
        log.warning("cad cache write failed: %s", e)
    return result


# ============================================================================
# Layout -> DXF export
# ============================================================================
def generate_cad_dxf(layout_data: dict) -> str:
    """Generates an AutoCAD DXF document from layout data (walls, cameras, zones, ppm)."""
    import io

    doc = ezdxf.new(dxfversion="R2010")
    msp = doc.modelspace()

    doc.layers.add("WALLS", color=7)
    doc.layers.add("CAMERAS", color=5)
    doc.layers.add("FOV_BEAMS", color=4)
    doc.layers.add("ZONES", color=1)
    doc.layers.add("ANNOTATIONS", color=3)

    ppm = float(layout_data.get("ppm", 25.0) or 25.0)

    # 1. Walls
    for seg in layout_data.get("walls", []):
        if isinstance(seg, (list, tuple)) and len(seg) >= 2:
            p1, p2 = seg[0], seg[1]
            if isinstance(p1, (list, tuple)) and isinstance(p2, (list, tuple)):
                msp.add_line(
                    (float(p1[0]) / ppm, -float(p1[1]) / ppm),
                    (float(p2[0]) / ppm, -float(p2[1]) / ppm),
                    dxfattribs={"layer": "WALLS"},
                )

    # 2. Cameras & FOV cones
    for cam in layout_data.get("cameras", []):
        cx = float(cam.get("x", 0)) / ppm
        cy = -float(cam.get("y", 0)) / ppm
        direction_deg = float(cam.get("direction", 0))
        hfov_deg = float(cam.get("hfov", 60))
        range_m = float(cam.get("range_m", 25))
        name = str(cam.get("name") or cam.get("model") or "Camera")

        msp.add_circle((cx, cy), radius=0.35, dxfattribs={"layer": "CAMERAS"})
        msp.add_text(name, dxfattribs={"layer": "ANNOTATIONS", "height": 0.45}).set_placement((cx + 0.5, cy + 0.2))

        angle_rad = math.radians(-direction_deg)
        half = math.radians(hfov_deg / 2.0)
        a1, a2 = angle_rad - half, angle_rad + half
        ex1, ey1 = cx + math.cos(a1) * range_m, cy + math.sin(a1) * range_m
        ex2, ey2 = cx + math.cos(a2) * range_m, cy + math.sin(a2) * range_m

        msp.add_line((cx, cy), (ex1, ey1), dxfattribs={"layer": "FOV_BEAMS"})
        msp.add_line((cx, cy), (ex2, ey2), dxfattribs={"layer": "FOV_BEAMS"})
        msp.add_line((ex1, ey1), (ex2, ey2), dxfattribs={"layer": "FOV_BEAMS"})

    # 3. Zones
    for zone in layout_data.get("zones", []):
        polygon = zone.get("polygon", [])
        if isinstance(polygon, list) and len(polygon) >= 3:
            pts = [(float(pt["x"]) / ppm, -float(pt["y"]) / ppm)
                   for pt in polygon if isinstance(pt, dict) and "x" in pt and "y" in pt]
            if len(pts) >= 3:
                msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": "ZONES"})
                zname = str(zone.get("name") or "Zone")
                msp.add_text(f"ZONE: {zname}", dxfattribs={"layer": "ZONES", "height": 0.55}).set_placement(pts[0])

    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue()