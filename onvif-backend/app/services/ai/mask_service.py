"""
mask_service.py — Applies saved privacy masks to recorded video.

Reads masks from MongoDB / JSON and generates FFmpeg filter chains
that black-out the masked polygon regions on each frame.

Used by rtsp_recorder.py to inject -vf filter arguments.
"""

import os
import json
import math
from typing import List, Optional


# ── Storage (mirrors masks_router.py) ────────────────────────────
_masks_col = None
try:
    from app.core.database import mongo_client
    MONGO_URI  = os.environ["MONGO_URI"]
    _mongo     = mongo_client
    _db_name = os.environ.get("MONGO_DB_NAME")
    _masks_col = _mongo[_db_name]["masks"]
except Exception:
    pass

MASKS_FILE = os.environ.get(
    "MASKS_FILE",
    os.path.join(os.path.dirname(__file__), "..", "devices_data", "masks.json")
)


def get_masks_for_ip(ip: str) -> list:
    """Return enabled masks for a given camera IP."""
    masks = []
    apply_to = True

    if _masks_col is not None:
        try:
            doc = _masks_col.find_one({"ip": ip}, {"_id": 0})
            if doc:
                masks = doc.get("masks", [])
                apply_to = doc.get("apply_to_recordings", True)
        except Exception:
            pass
    else:
        try:
            if os.path.exists(MASKS_FILE):
                with open(MASKS_FILE) as f:
                    data = json.load(f)
                if ip in data:
                    if isinstance(data[ip], list):
                        masks = data[ip]
                    else:
                        masks = data[ip].get("masks", [])
                        apply_to = data[ip].get("apply_to_recordings", True)
        except Exception:
            pass

    if not apply_to:
        return []

    return [m for m in masks if m.get("enabled", True) and not m.get("is_deleted")]


def _poly_bounding_box(points: List[List[float]], canvas_w=640, canvas_h=360):
    """
    Convert polygon points → a conservative bounding rectangle for FFmpeg drawbox.
    Points are in canvas-space (640×360); we'll scale to actual video resolution at runtime.
    Returns (x, y, w, h) as fractions of canvas size (0.0–1.0).
    """
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x0 = max(0.0, min(xs) / canvas_w)
    y0 = max(0.0, min(ys) / canvas_h)
    x1 = min(1.0, max(xs) / canvas_w)
    y1 = min(1.0, max(ys) / canvas_h)
    return x0, y0, x1 - x0, y1 - y0


def build_ffmpeg_vf(ip: str, video_w: int = 1920, video_h: int = 1080) -> Optional[str]:
    """
    Build an FFmpeg -vf filter string that blacks out all enabled mask regions.

    Returns None if no masks are defined (caller should omit -vf entirely).

    Example output for 2 masks:
        drawbox=x=480:y=0:w=320:h=270:color=black:t=fill,
        drawbox=x=100:y=200:w=400:h=150:color=black:t=fill

    Usage in rtsp_recorder.py:
        vf = mask_service.build_ffmpeg_vf(ip, 1920, 1080)
        if vf:
            ffmpeg_cmd += ["-vf", vf]
    """
    masks = get_masks_for_ip(ip)
    if not masks:
        return None

    CANVAS_W, CANVAS_H = 640, 360
    filters = []

    for mask in masks:
        pts = mask.get("points", [])
        if len(pts) < 3:
            continue

        fx, fy, fw, fh = _poly_bounding_box(pts, CANVAS_W, CANVAS_H)

        # Scale to actual video resolution
        x = int(fx * video_w)
        y = int(fy * video_h)
        w = max(1, int(fw * video_w))
        h = max(1, int(fh * video_h))

        filters.append(
            f"drawbox=x={x}:y={y}:w={w}:h={h}:color=black:t=fill"
        )

    if not filters:
        return None

    return ",".join(filters)


def get_mask_overlay_svg(ip: str, canvas_w: int = 640, canvas_h: int = 360) -> str:
    """
    Build an SVG overlay string for use in HLS/WebRTC player overlays.
    Returns an SVG string that can be injected as an <img> or <object> over the video.
    """
    masks = get_masks_for_ip(ip)
    polygons = []

    for mask in masks:
        pts = mask.get("points", [])
        if len(pts) < 3:
            continue
        pts_str = " ".join(f"{int(p[0])},{int(p[1])}" for p in pts)
        polygons.append(f'<polygon points="{pts_str}" fill="black" />')

    if not polygons:
        return ""

    poly_str = "\n  ".join(polygons)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{canvas_w}" height="{canvas_h}" '
        f'viewBox="0 0 {canvas_w} {canvas_h}" '
        f'style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none">'
        f'\n  {poly_str}\n</svg>'
    )


# ── Quick test ────────────────────────────────────────────────────
if __name__ == "__main__":
    test_ip = "192.168.1.100"
    vf = build_ffmpeg_vf(test_ip, 1920, 1080)
    print(f"FFmpeg vf for {test_ip}:")
    print(vf or "(no masks)")