"""
Edge sync router - lets private-network edge devices (Raspberry Pi) pull their
camera config from this VMS and report health back.

  GET  /api/edge/{edge_id}/config   Pi pulls camera list (Bearer token, ETag -> 304)
  POST /api/edge/{edge_id}/status   Pi reports per-camera health
  GET  /api/edge/overview           Which edges/cameras are online (no passwords)

Camera list lives in:  onvif-backend/devices_data/edge_cameras.json
(override with env EDGE_CAMERAS_FILE). The file is re-read on every request,
so edits take effect on the Pi's next poll with no backend restart.
"""
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from threading import Lock
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(tags=["edge-sync"])

# onvif-backend/app/api/routers/edge_sync_router.py -> parents[3] == onvif-backend
_BACKEND_DIR = Path(__file__).resolve().parents[3]
CAMERAS_FILE = Path(os.getenv("EDGE_CAMERAS_FILE", _BACKEND_DIR / "devices_data" / "edge_cameras.json"))

# Address the Pi pushes to (MediaMTX RTSP port) - the VMS public IP.
PUBLIC_HOST = os.getenv("VMS_PUBLIC_HOST", "14.99.8.170")
PUBLISH_BASE = os.getenv("VMS_PUBLISH_BASE", f"rtsp://{PUBLIC_HOST}:8554")
WEBRTC_BASE = os.getenv("VMS_WEBRTC_BASE", f"http://{PUBLIC_HOST}:8889")
HLS_BASE = os.getenv("VMS_HLS_BASE", f"http://{PUBLIC_HOST}:8888")
ONLINE_WINDOW_SEC = 60

_status_lock = Lock()
_edge_status = {}   # edge_id -> {"last_seen", "config_version", "cameras": {camera_id: {...}}}


def _load_edges() -> dict:
    try:
        with open(CAMERAS_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("edges", {})
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"edge camera file not found: {CAMERAS_FILE}")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"edge camera file is not valid JSON: {e}")


def channel_for(edge_id: str, camera_id: str) -> str:
    safe = "".join(c if c.isalnum() else "_" for c in str(camera_id))
    return f"{edge_id}_camera_{safe}"


def _authenticate(edge_id: str, authorization: str) -> dict:
    edge = _load_edges().get(edge_id)
    token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    expected = (edge or {}).get("token", "")
    if not edge or not expected or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="invalid edge id or token")
    return edge


def _build_config(edge_id: str, edge: dict) -> dict:
    cameras = []
    for cam in edge.get("cameras", []):
        cameras.append({
            "camera_id": cam["camera_id"],
            "name": cam.get("name", cam["camera_id"]),
            "rtsp_url": cam["rtsp_url"],
            "username": cam.get("username", ""),
            "password": cam.get("password", ""),
            "enabled": cam.get("enabled", True),
            "channel": channel_for(edge_id, cam["camera_id"]),
        })
    # return {"edge_id": edge_id, "publish_base": PUBLISH_BASE, "cameras": cameras}
    cfg = {"edge_id": edge_id, "publish_base": PUBLISH_BASE, "cameras": cameras}
    cfg["config_version"] = _version(cfg)
    return cfg


def _version(cfg: dict) -> str:
    return hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()[:16]


@router.get("/api/edge/{edge_id}/config")
def get_edge_config(edge_id: str, request: Request, authorization: str = Header(default="")):
    edge = _authenticate(edge_id, authorization)
    cfg = _build_config(edge_id, edge)
    etag = f'"{_version(cfg)}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return JSONResponse(cfg, headers={"ETag": etag})


class _CameraStatus(BaseModel):
    camera_id: str
    streaming: bool
    last_error: Optional[str] = None


class _StatusReport(BaseModel):
    config_version: Optional[str] = None
    cameras: List[_CameraStatus] = []


@router.post("/api/edge/{edge_id}/status")
def post_edge_status(edge_id: str, report: _StatusReport, authorization: str = Header(default="")):
    _authenticate(edge_id, authorization)
    with _status_lock:
        _edge_status[edge_id] = {
            "last_seen": time.time(),
            "config_version": report.config_version,
            "cameras": {c.camera_id: c.model_dump() for c in report.cameras},
        }
    return {"success": True}


@router.get("/api/edge/overview")
def edge_overview():
    """Phase 1 check endpoint: edges, cameras, online state, play URLs. Never returns passwords."""
    now = time.time()
    out = []
    for edge_id, edge in _load_edges().items():
        with _status_lock:
            st = _edge_status.get(edge_id)
        edge_online = bool(st and now - st["last_seen"] < ONLINE_WINDOW_SEC)
        for cam in edge.get("cameras", []):
            cam_st = (st or {}).get("cameras", {}).get(cam["camera_id"], {})
            channel = channel_for(edge_id, cam["camera_id"])
            out.append({
                "edge_id": edge_id,
                "camera_id": cam["camera_id"],
                "name": cam.get("name", cam["camera_id"]),
                "enabled": cam.get("enabled", True),
                "edge_online": edge_online,
                "streaming": edge_online and bool(cam_st.get("streaming")),
                "last_error": cam_st.get("last_error"),
                "channel": channel,
                "webrtc_url": f"{WEBRTC_BASE}/{channel}",
                "hls_url": f"{HLS_BASE}/{channel}/index.m3u8",
            })
    return {"count": len(out), "cameras": out}
