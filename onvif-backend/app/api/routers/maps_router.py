from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Response, Body, Query
from app.core.database import mongo_client
from datetime import datetime
from pydantic import BaseModel, Field, validator, field_validator
from typing import List, Optional, Any, Dict
from app.core.security import verify_token
from app.api.routers.auth_router import limiter
from fastapi import Request
from app.core.ws_manager import ws_manager
from app.services.cad_parser import cad_to_svg_data, generate_cad_dxf, CADParserException
import asyncio
import multiprocessing
import os
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
_client   = mongo_client
_db = _client[os.environ.get("MONGO_DB_NAME")] if _client else None
maps_col = _db["map_layouts"] if _db is not None else None

router = APIRouter(prefix="/api/maps", tags=["maps"])


# ── CAD conversion worker pool ────────────────────────────────────
# cad_to_svg_data is CPU-bound pure Python. Running it inside the request handler (even in a
# thread) holds the GIL and starves every other request (status, heartbeat, cameras ...).
# It runs in a separate PROCESS instead, so the API stays responsive while a DWG converts.
CAD_WORKERS      = int(os.environ.get("CAD_WORKERS", "2"))
CAD_TIMEOUT_S    = int(os.environ.get("CAD_TIMEOUT_S", "180"))
CAD_MAX_BYTES    = 70 * 1024 * 1024
_cad_pool: Optional[ProcessPoolExecutor] = None


def _get_cad_pool() -> ProcessPoolExecutor:
    global _cad_pool
    if _cad_pool is None:
        # "spawn" everywhere: same behaviour on Windows/Linux, and safe with a threaded server.
        _cad_pool = ProcessPoolExecutor(
            max_workers=CAD_WORKERS,
            mp_context=multiprocessing.get_context("spawn"),
        )
    return _cad_pool


def _reset_cad_pool(kill: bool = False) -> None:
    """Drop the pool (optionally killing workers stuck in a runaway conversion)."""
    global _cad_pool
    pool, _cad_pool = _cad_pool, None
    if pool is None:
        return
    if kill:
        for p in list(getattr(pool, "_processes", {}).values()):
            try:
                p.terminate()
            except Exception:
                pass
    pool.shutdown(wait=False, cancel_futures=True)


def warm_cad_pool() -> None:
    """Optional: call from your lifespan/startup so the first import doesn't pay worker start-up (~1-2 s)."""
    _get_cad_pool().submit(int, 0)


# ── Pydantic models ───────────────────────────────────────────────

class Marker(BaseModel):
    camId: str = Field(..., max_length=255)
    camName:   Optional[str] = ""
    camIp:     Optional[str] = ""
    x:         float
    y:         float
    fovAngle:  Optional[float] = 60
    direction: Optional[float] = 0
    labelOffset: Optional[dict] = None
    specs:     Optional[dict] = None
    worldPos:  Optional[dict] = None

    class Config:
        extra = "allow"


class Floor(BaseModel):
    id: str = Field(..., max_length=255)
    name: str = Field(..., max_length=255)
    imageDataUrl: Optional[str] = Field(None, max_length=100_000_000)
    modelDataUrl: Optional[str] = Field(None, max_length=100_000_000)   # base64 .glb/.gltf, ~100MB cap (accommodates 70MB binary)
    ppm:          Optional[float] = None
    calibration:  Optional[dict] = None
    partsReport:  Optional[dict] = None
    markers:      List[Marker]  = []
    walls:        Optional[list] = None
    versions:     Optional[List[dict]] = []

    class Config:
        extra = "allow"

    @field_validator('name')
    @classmethod
    def validate_floor_name(cls, v):
        import re
        if not v or not v.strip():
            raise ValueError('Floor name is required')
        if not re.match(r'^[a-zA-Z0-9 _.\-]+$', v.strip()):
            raise ValueError('Floor name contains invalid characters. Only letters, numbers, spaces, hyphens, underscores, and dots are allowed.')
        return v.strip()

    @field_validator('imageDataUrl')
    @classmethod
    def validate_image_data_url(cls, v):
        if v is not None and not (
            v.startswith('data:image/')
            or v.startswith('http://')
            or v.startswith('https://')
            or v.startswith('/')
            or v.startswith('blob:')
        ):
            raise ValueError('Invalid image format.')
        return v

    @field_validator('modelDataUrl')
    @classmethod
    def validate_model_data_url(cls, v):
        if v is not None and not (
            v.startswith('data:model/')
            or v.startswith('data:application/octet-stream')
            or v.startswith('http://')
            or v.startswith('https://')
            or v.startswith('blob:')
        ):
            raise ValueError(
                'Invalid model format. Must be a base64 data URL for a .glb/.gltf file, '
                'or an http(s) URL to a hosted model file'
            )
        return v


class MapSaveRequest(BaseModel):
    map_id:     Optional[str]         = "default"
    floors:     Optional[List[Floor]] = None
    # legacy single-floor fields
    markers:    Optional[List[Marker]] = None
    floor_plan: Optional[str]          = Field(None, max_length=100_000_000)
    ppm:        Optional[float]        = None
    calibration: Optional[dict]        = None

    class Config:
        extra = "allow"

    @field_validator('floor_plan')
    @classmethod
    def validate_floor_plan(cls, v):
        if v is not None and not (
            v.startswith('data:image/')
            or v.startswith('http://')
            or v.startswith('https://')
            or v.startswith('/')
            or v.startswith('blob:')
        ):
            raise ValueError('Invalid image format.')
        return v

# ── Zone models ───────────────────────────────────────────────────

class ZonePoint(BaseModel):
    x: float
    y: float

    class Config:
        extra = "allow"


class Zone(BaseModel):
    id: str = Field(..., max_length=255)
    name: str = Field(..., max_length=255)
    color: str = Field(..., max_length=255)
    polygon:       List[ZonePoint]
    floorIndex:    Optional[int] = 0   # which floor this zone belongs to
    isShape:       Optional[bool] = False
    isBoomBarrier: Optional[bool] = False

    class Config:
        extra = "allow"

    @field_validator('name')
    @classmethod
    def validate_zone_name(cls, v):
        import re
        if not v or not v.strip():
            raise ValueError('Zone name is required')
        if not re.match(r'^[a-zA-Z0-9 _.\-]+$', v.strip()):
            raise ValueError('Zone name contains invalid characters. Only letters, numbers, spaces, hyphens, underscores, and dots are allowed.')
        return v.strip()

class ZoneSaveRequest(BaseModel):
    map_id: Optional[str] = "default"
    zones:  List[Zone]    = []

    class Config:
        extra = "allow"


# ── Legacy migration helper ───────────────────────────────────────

def _migrate_to_floors(doc: dict) -> List[dict]:
    """Convert old single-document format to floors list."""
    if doc.get("floors"):
        return doc["floors"]
    return [{
        "id":           "floor_1",
        "name":         "Floor 1",
        "imageDataUrl": doc.get("floor_plan"),
        "modelDataUrl": doc.get("modelDataUrl"),
        "ppm":          doc.get("ppm"),
        "calibration":  doc.get("calibration"),
        "markers":      doc.get("markers", []),
        "floor_index":  0,
    }]


# ── GET /api/maps ─────────────────────────────────────────────────
@router.get("", dependencies=[Depends(verify_token)])
def get_map(map_id: str = "default"):
    # Fetch all documents for this map_id, sorted by floor_index
    all_docs = list(maps_col.find({"map_id": map_id, "is_deleted": {"$ne": True}}, {"_id": 0}).sort("floor_index", 1))

    if not all_docs:
        return {
            "map_id":     map_id,
            "floors":     [],
            "zones":      [],
            "markers":    [],
            "floor_plan": None,
        }

    # Separate floor docs from zones doc
    floor_docs = [d for d in all_docs if d.get("doc_type") == "floor"]
    zones_doc  = next((d for d in all_docs if d.get("doc_type") == "zones"), None)

    # If no typed docs exist, fall back to legacy single-document format
    if not floor_docs:
        legacy = next((d for d in all_docs if not d.get("doc_type")), None)
        if legacy:
            floors = _migrate_to_floors(legacy)
            zones  = legacy.get("zones", [])
            return {
                "map_id":     map_id,
                "floors":     floors,
                "zones":      zones,
                "markers":    legacy.get("markers", []),
                "floor_plan": legacy.get("floor_plan"),
                "ppm":        legacy.get("ppm"),
                "calibration": legacy.get("calibration"),
                "updated_at": legacy.get("updated_at"),
            }
        return {
            "map_id":     map_id,
            "floors":     [],
            "zones":      [],
            "markers":    [],
            "floor_plan": None,
        }

    # Build floors array from separate documents
    floors = []
    for doc in floor_docs:
        floors.append({
            "id":           doc.get("floor_id"),
            "name":         doc.get("name"),
            "imageDataUrl": doc.get("imageDataUrl"),
            "modelDataUrl": doc.get("modelDataUrl"),
            "ppm":          doc.get("ppm"),
            "calibration":  doc.get("calibration"),
            "partsReport":  doc.get("partsReport"),
            "markers":      doc.get("markers", []),
            "walls":        doc.get("walls", []),
            "versions":     doc.get("versions", []),
            "floor_index":  doc.get("floor_index", 0),
            "isCad":        doc.get("isCad", False),
            "imageWidth":   doc.get("imageWidth"),
            "imageHeight":  doc.get("imageHeight"),
            "showHeatmap":  doc.get("showHeatmap", False),
            "virtualMode":  doc.get("virtualMode", False),
            "showWallMetrics": doc.get("showWallMetrics", False),
            "activeVersionId": doc.get("activeVersionId"),
        })

    zones = [z for z in zones_doc.get("zones", []) if not z.get("is_deleted")] if zones_doc else []

    return {
        "map_id":     map_id,
        "floors":     floors,
        "zones":      zones,
        "markers":    [],
        "floor_plan": None,
        "updated_at": floor_docs[0].get("updated_at") if floor_docs else None,
    }


# ── POST /api/maps ────────────────────────────────────────────────
@router.post("", dependencies=[Depends(verify_token)])
def save_map(req: MapSaveRequest):
    if req.floors is not None:
        # Mark removed floors as deleted
        active_ids = [f.id for f in req.floors]
        maps_col.update_many(
            {"map_id": req.map_id, "doc_type": "floor", "floor_id": {"$nin": active_ids}},
            {"$set": {"is_deleted": True, "updated_at": datetime.utcnow().isoformat()}}
        )

        # Save each floor as its own separate document
        total_markers = 0
        for idx, f in enumerate(req.floors):
            markers = [m.dict() for m in f.markers]

            set_doc = {
                "map_id":      req.map_id,
                "doc_type":    "floor",
                "floor_id":    f.id,
                "floor_index": idx,
                "name":        f.name,
                "markers":     markers,
                "is_deleted":  False,
                "updated_at":  datetime.utcnow().isoformat(),
            }
            # A field the client did not send (None / empty versions) means "keep what is stored".
            if f.imageDataUrl is not None:
                set_doc["imageDataUrl"] = f.imageDataUrl
            if f.modelDataUrl is not None:
                set_doc["modelDataUrl"] = f.modelDataUrl
            if f.ppm is not None:
                set_doc["ppm"] = f.ppm
            if f.calibration is not None:
                set_doc["calibration"] = f.calibration
            if f.walls is not None:
                set_doc["walls"] = f.walls
            if f.partsReport is not None:
                set_doc["partsReport"] = f.partsReport
            if f.versions:
                set_doc["versions"] = f.versions

            # Extra attributes
            f_dict = f.dict()
            for key in ["isCad", "imageWidth", "imageHeight", "showHeatmap", "virtualMode", "showWallMetrics", "activeVersionId"]:
                if key in f_dict and f_dict[key] is not None:
                    set_doc[key] = f_dict[key]

            maps_col.update_one(
                {"map_id": req.map_id, "doc_type": "floor", "floor_id": f.id},
                {"$set": set_doc},
                upsert=True,
            )
            total_markers += len(markers)

        print(
            f"[MAPS] ✅ Saved {len(req.floors)} floor(s) for map '{req.map_id}' | "
            f"{total_markers} total markers"
        )
        ws_manager.publish_sync(
            "maps",
            "map_updated",
            {
                "map_id": req.map_id,
                "client_id": getattr(req, "client_id", None) or (req.dict().get("client_id") if hasattr(req, "dict") else None),
                "updated_at": datetime.utcnow().isoformat(),
            }
        )
        return {"success": True, "map_id": req.map_id, "marker_count": total_markers}

    else:
        # Legacy single-floor save (backward compat)
        existing     = maps_col.find_one({"map_id": req.map_id}, {"_id": 0})
        floor_plan   = req.floor_plan or (existing.get("floor_plan") if existing else None)
        markers_data = [m.dict() for m in (req.markers or [])]

        maps_col.update_one(
            {"map_id": req.map_id},
            {"$set": {
                "markers":    markers_data,
                "floor_plan": floor_plan,
                "ppm":        req.ppm or (existing.get("ppm") if existing else None),
                "calibration": req.calibration or (existing.get("calibration") if existing else None),
                "updated_at": datetime.utcnow().isoformat(),
            }},
            upsert=True,
        )
        print(f"[MAPS] ✅ Legacy save for map '{req.map_id}': {len(markers_data)} markers")
        ws_manager.publish_sync(
            "maps",
            "map_updated",
            {
                "map_id": req.map_id,
                "client_id": getattr(req, "client_id", None) or (req.dict().get("client_id") if hasattr(req, "dict") else None),
                "updated_at": datetime.utcnow().isoformat(),
            }
        )
        return {"success": True, "map_id": req.map_id, "marker_count": len(markers_data)}


# ── POST /api/maps/zones ──────────────────────────────────────────
@router.post("/zones", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")
def save_zones(request: Request, req: ZoneSaveRequest):
    """
    Saves all zone definitions for a map in a single dedicated document.
    Each zone has a floorIndex field so zones are floor-specific on the frontend.
    """
    zones_data = [z.dict() for z in req.zones]

    maps_col.update_one(
        {"map_id": req.map_id, "doc_type": "zones"},
        {"$set": {
            "map_id":     req.map_id,
            "doc_type":   "zones",
            "zones":      zones_data,
            "is_deleted": False,
            "updated_at": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )
    print(f"[MAPS] 🗺  Saved {len(zones_data)} zone(s) for map '{req.map_id}'")
    ws_manager.publish_sync(
        "maps",
        "map_updated",
        {
            "map_id": req.map_id,
            "client_id": getattr(req, "client_id", None) or (req.dict().get("client_id") if hasattr(req, "dict") else None),
            "updated_at": datetime.utcnow().isoformat(),
        }
    )
    return {"success": True, "map_id": req.map_id, "zone_count": len(zones_data)}


# ── DELETE /api/maps/zones/{zone_id} ─────────────────────────────
@router.delete("/zones/{zone_id}", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")
def delete_zone(request: Request, zone_id: str, map_id: str = "default"):
    """Remove a single zone by ID from the zones document."""
    result = maps_col.update_one(
        {"map_id": map_id, "doc_type": "zones", "zones.id": zone_id},
        {"$set": {"zones.$.is_deleted": True}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")

    print(f"[MAPS] 🗑  Deleted zone '{zone_id}' from map '{map_id}'")
    return {"success": True, "map_id": map_id, "deleted_zone_id": zone_id}


# ── DELETE /api/maps/floor ────────────────────────────────────────
@router.delete("/floor", dependencies=[Depends(verify_token)])
def delete_floor(floor_id: str, map_id: str = "default"):
    """Delete a floor's own document from MongoDB and re-index remaining floors."""
    result = maps_col.update_one(
        {"map_id": map_id, "doc_type": "floor", "floor_id": floor_id},
        {"$set": {"is_deleted": True}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=f"Floor '{floor_id}' not found")

    # Re-index remaining floors so floor_index stays sequential (0, 1, 2 ...)
    # Projection: only the fields we need (not the multi-MB image/model data URLs).
    remaining = list(
        maps_col.find({"map_id": map_id, "doc_type": "floor", "is_deleted": {"$ne": True}},
                      {"_id": 0, "floor_id": 1})
               .sort("floor_index", 1)
    )
    for new_idx, doc in enumerate(remaining):
        maps_col.update_one(
            {"map_id": map_id, "doc_type": "floor", "floor_id": doc["floor_id"]},
            {"$set": {"floor_index": new_idx}}
        )

    print(f"[MAPS] 🗑  Deleted floor '{floor_id}' from map '{map_id}', re-indexed {len(remaining)} remaining floors")
    return {"success": True, "map_id": map_id, "deleted_floor_id": floor_id}


# ── DELETE /api/maps ──────────────────────────────────────────────
@router.delete("", dependencies=[Depends(verify_token)])
def delete_map(map_id: str = "default"):
    """Delete ALL documents for a map (all floors + zones)."""
    result = maps_col.update_many({"map_id": map_id}, {"$set": {"is_deleted": True}})
    print(f"[MAPS] 🗑  Marked all {result.modified_count} document(s) as deleted for map '{map_id}'")
    return {"success": True, "map_id": map_id}


# ── POST /api/maps/floor-plan ─────────────────────────────────────
# Legacy endpoint — updates imageDataUrl for a specific floor document
@router.post("/floor-plan", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")
def save_floor_plan(request: Request, payload: dict):
    map_id     = payload.get("map_id", "default")
    floor_plan = payload.get("floor_plan")
    floor_id   = payload.get("floor_id", "floor_1")

    if not floor_plan:
        raise HTTPException(status_code=400, detail="floor_plan required")
    if len(floor_plan) > 100_000_000:
        raise HTTPException(status_code=400, detail="floor_plan image too large (max 70MB)")

    if not floor_plan.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Invalid image format. Must be a base64 image data URL starting with data:image/")

    # Try new per-floor document first
    result = maps_col.update_one(
        {"map_id": map_id, "doc_type": "floor", "floor_id": floor_id},
        {"$set": {
            "imageDataUrl": floor_plan,
            "updated_at":   datetime.utcnow().isoformat(),
        }},
    )

    # Fall back to legacy single-document format
    if result.matched_count == 0:
        maps_col.update_one(
            {"map_id": map_id},
            {"$set": {
                "floor_plan": floor_plan,
                "updated_at": datetime.utcnow().isoformat(),
            }},
            upsert=True,
        )

    print(f"[MAPS] ✅ Floor plan saved for map '{map_id}' floor '{floor_id}'")
    return {"success": True, "map_id": map_id, "floor_id": floor_id}


# ── POST /api/maps/convert-cad ────────────────────────────────────
@router.post("/convert-cad")
async def convert_cad(
    file: UploadFile = File(...),
    hatch_mode: str = Query("solid", description="solid | outline | ignore | normal"),
    skip_annotation_layers: bool = Query(False, description="hide text/dimension/hatch/grid layers in the SVG"),
):
    """
    Accepts an AutoCAD DWG or DXF file, converts it into a high-resolution
    clean SVG floor plan data URL with detected dimensions and estimated scale.

    The conversion runs in a worker process so the API keeps answering other requests.
    """
    filename = file.filename or "layout.dwg"
    ext = filename.lower().split('.')[-1]
    if ext not in ("dwg", "dxf"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file format '.{ext}'. Only AutoCAD DWG (.dwg) and DXF (.dxf) files are supported."
        )

    # Read in chunks and stop as soon as the cap is exceeded (no 2 GB buffering)
    chunks, total = [], 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > CAD_MAX_BYTES:
            raise HTTPException(status_code=400, detail="File too large. Maximum supported CAD file size is 70MB.")
        chunks.append(chunk)
    contents = b"".join(chunks)

    loop = asyncio.get_running_loop()
    try:
        res = await asyncio.wait_for(
            loop.run_in_executor(
                _get_cad_pool(), cad_to_svg_data, contents, filename, skip_annotation_layers, hatch_mode
            ),
            timeout=CAD_TIMEOUT_S,
        )
        t = res.get("timings", {})
        print(
            f"[MAPS] 📐 Converted CAD '{filename}' -> SVG ({res['width']}x{res['height']}, "
            f"{len(res['layers'])} layers, {len(res.get('walls', []))} walls, "
            f"{'cache hit' if res.get('cached') else 'timings ' + str(t)})"
        )
        return res
    except asyncio.TimeoutError:
        _reset_cad_pool(kill=True)   # the worker is still burning CPU; recycle the pool
        print(f"[MAPS] ❌ CAD conversion timed out after {CAD_TIMEOUT_S}s for '{filename}'")
        raise HTTPException(status_code=504, detail=f"CAD conversion timed out after {CAD_TIMEOUT_S}s")
    except BrokenProcessPool:
        _reset_cad_pool()
        print(f"[MAPS] ❌ CAD worker crashed while converting '{filename}'")
        raise HTTPException(status_code=503, detail="CAD conversion worker crashed. Please retry.")
    except CADParserException as e:
        print(f"[MAPS] ❌ CAD conversion failed for '{filename}': {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[MAPS] ❌ Unexpected CAD error for '{filename}': {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to process CAD file: {str(e)}")


# ── POST /api/maps/export-cad ─────────────────────────────────────
@router.post("/export-cad")
async def export_cad(payload: Dict[str, Any] = Body(...)):
    """
    Exports the current floor layout (walls, placed cameras with FOV cones, zones)
    into an AutoCAD DXF/DWG compatible drawing file.
    """
    try:
        dxf_content = generate_cad_dxf(payload)
        filename = payload.get("filename") or "floor_layout.dxf"
        if not filename.lower().endswith(".dxf") and not filename.lower().endswith(".dwg"):
            filename += ".dxf"

        return Response(
            content=dxf_content.encode("utf-8"),
            media_type="application/dxf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[MAPS] ❌ CAD export failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate CAD export: {str(e)}")