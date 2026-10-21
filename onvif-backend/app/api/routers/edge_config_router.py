"""Admin API for managing Edge sync configuration on the Windows VMS backend.

The existing edge_sync_router reads the same JSON file for Pi polling. This
router only manages that file; it does not register streams with MediaMTX.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.parse import urlparse
from app.managers.stream_manager import save_camera_to_db

from fastapi import APIRouter, Depends, HTTPException, Path as ApiPath
from pydantic import BaseModel, Field, validator
from app.core.security import require_admin

router = APIRouter(prefix="/api/edge-config", tags=["edge-config"])

_BACKEND_DIR = Path(__file__).resolve().parents[2].parents[0]
# Keep this path identical to edge_sync_router.py so the Pi sync endpoint reads
# the exact file managed by this API. EDGE_CAMERAS_FILE overrides both routers.
CAMERAS_FILE = Path(
    os.getenv("EDGE_CAMERAS_FILE", _BACKEND_DIR / "devices_data" / "edge_cameras.json")
)
_FILE_LOCK = threading.RLock()
_EDGE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_CAM_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")


class CameraConfig(BaseModel):
    camera_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    rtsp_url: str = Field(min_length=8, max_length=2048)
    username: str = Field(default="", max_length=256)
    password: str = Field(default="", max_length=512)
    enabled: bool = True
    channel: str | None = Field(default=None, max_length=128)
    added_at: str | None = Field(default=None, max_length=64)
    updated_at: str | None = Field(default=None, max_length=64)

    @validator("camera_id")
    def validate_camera_id(cls, value: str) -> str:
        value = value.strip()
        if not _CAM_ID_RE.fullmatch(value):
            raise ValueError("camera_id may contain letters, numbers, dot, underscore and hyphen")
        return value

    @validator("name")
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Camera name cannot be empty")
        return value

    @validator("rtsp_url")
    def validate_rtsp(cls, value: str) -> str:
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme.lower() != "rtsp" or not parsed.hostname:
            raise ValueError("Enter a valid RTSP URL beginning with rtsp://")
        return value


class EdgeConfigUpsert(BaseModel):
    edge_id: str = Field(min_length=1, max_length=64)
    display_name: str = Field(min_length=1, max_length=120)
    token: str = Field(min_length=24, max_length=512)
    publish_base: str | None = Field(default=None, max_length=512)
    cameras: list[CameraConfig] = Field(min_length=1, max_length=256)

    @validator("edge_id")
    def validate_edge_id(cls, value: str) -> str:
        value = value.strip()
        if not _EDGE_ID_RE.fullmatch(value):
            raise ValueError("edge_id may contain letters, numbers, underscore and hyphen")
        return value

    @validator("display_name")
    def validate_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Edge display name cannot be empty")
        return value

    @validator("token")
    def validate_token(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 24:
            raise ValueError("Edge sync token must be at least 24 characters")
        return value


def _read_document() -> dict[str, Any]:
    if not CAMERAS_FILE.exists():
        return {"edges": {}}
    try:
        with CAMERAS_FILE.open("r", encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Edge configuration file could not be read") from exc
    if not isinstance(document, dict) or not isinstance(document.get("edges", {}), dict):
        raise HTTPException(status_code=500, detail="Edge configuration file has an invalid structure")
    document.setdefault("edges", {})
    return document


def _atomic_write(document: dict[str, Any]) -> None:
    CAMERAS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=str(CAMERAS_FILE.parent),
            prefix=f"{CAMERAS_FILE.name}.", suffix=".tmp", delete=False
        ) as handle:
            temp_path = handle.name
            json.dump(document, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, CAMERAS_FILE)
    except OSError as exc:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail="Edge configuration could not be saved") from exc


def _safe_edge_summary(edge_id: str, config: dict[str, Any]) -> dict[str, Any]:
    cameras = config.get("cameras", [])
    return {
        "edge_id": edge_id,
        "display_name": config.get("display_name") or config.get("name") or edge_id,
        "camera_count": len(cameras) if isinstance(cameras, list) else 0,
        "enabled_camera_count": sum(1 for camera in cameras if isinstance(camera, dict) and camera.get("enabled", True)),
        "has_token": bool(config.get("token")),
        # Never return token, RTSP credentials, or full camera URLs from list API.
    }


@router.get("", dependencies=[Depends(require_admin)])
async def list_edge_configs():
    """Return configured Edge IDs and counts without secrets."""
    with _FILE_LOCK:
        document = _read_document()
        return {"edges": [_safe_edge_summary(edge_id, config) for edge_id, config in document["edges"].items()]}

def _inject_credentials(rtsp_str: str, user: str, pwd: str) -> str:
    if not rtsp_str or not user or not pwd:
        return rtsp_str
    import urllib.parse
    if f"{urllib.parse.quote_plus(user)}:" in rtsp_str or f"{user}:" in rtsp_str:
        return rtsp_str
    if rtsp_str.startswith("rtsp://"):
        parts = rtsp_str.split("rtsp://", 1)
        safe_user = urllib.parse.quote_plus(user)
        safe_pwd = urllib.parse.quote_plus(pwd)
        return f"rtsp://{safe_user}:{safe_pwd}@{parts[1]}"
    return rtsp_str


def _save_edge_cameras_to_mongo(edge_id: str, edge: dict):
    from app.core.database import cameras_col
    from app.managers.stream_manager import load_devices

    publish_base = (
        edge.get("publish_base")
        or os.getenv("VMS_PUBLISH_BASE")
        or f"rtsp://{os.getenv('VMS_PUBLIC_HOST', '14.99.8.170')}:8554"
    ).rstrip("/")

    display_name = edge.get("display_name") or edge.get("name") or edge_id
    token = edge.get("token") or ""
    current_camera_ids = []

    for camera in edge.get("cameras", []):
        camera_id = str(camera.get("camera_id", "")).strip()
        if not camera_id:
            continue
        current_camera_ids.append(camera_id)

        safe_camera_id = re.sub(r"[^A-Za-z0-9_.-]", "_", camera_id)
        stream_key = camera.get("channel") or f"{edge_id}_camera_{safe_camera_id}"
        cam_rtsp = str(camera.get("rtsp_url", "")).strip()

        cam_name = camera.get("name") or camera_id
        cam_user = camera.get("username", "") or ""
        cam_pass = camera.get("password", "") or ""
        cam_enabled = bool(camera.get("enabled", True))

        if cam_user and cam_pass and cam_rtsp:
            cam_rtsp = _inject_credentials(cam_rtsp, cam_user, cam_pass)

        stream_url = cam_rtsp or f"{publish_base}/{stream_key}"

        parsed = urlparse(cam_rtsp) if cam_rtsp else urlparse(stream_url)
        camera_ip = parsed.hostname or edge.get("edge_ip") or edge_id
        port = parsed.port or 554

        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        cam_added_at = camera.get("added_at") or now_str
        cam_updated_at = camera.get("updated_at") or now_str

        record = {
            "stream_key": stream_key,
            "ome_stream": stream_key,  # Required by recorder_worker.py
            "rtsp_url": cam_rtsp or stream_url,
            "recording_rtsp": stream_url or cam_rtsp,
            "source_rtsp": cam_rtsp,
            "ip": camera_ip,
            "ip_address": camera_ip,
            "device_name": cam_name,
            "name": cam_name,
            "source": "edge",
            "is_edge_camera": True,
            "edge_id": edge_id,
            "edge_name": display_name,
            "display_name": display_name,
            "edge_ip": edge.get("edge_ip") or "",
            "token": token,
            "camera_id": camera_id,
            "channel": camera.get("channel") or stream_key,
            "username": cam_user,
            "password": cam_pass,
            "enabled": cam_enabled,
            "status": "Online" if cam_enabled else "Offline",
            "port": port,
            "manufacturer": "Edge",
            "model": "Edge Camera",
            "type": "entrance",
            "is_deleted": False,
            "added_at": cam_added_at,
            "updated_at": cam_updated_at,
        }

        if cameras_col is not None:
            try:
                # Update existing record if found by stream_key or (edge_id + camera_id)
                existing = cameras_col.find_one({
                    "$or": [
                        {"stream_key": stream_key},
                        {"edge_id": edge_id, "camera_id": camera_id}
                    ]
                })
                if existing:
                    if existing.get("added_at"):
                        record["added_at"] = existing["added_at"]
                    record["updated_at"] = cam_updated_at
                    cameras_col.update_one(
                        {"_id": existing["_id"]},
                        {"$set": record}
                    )
                    # Clean up any duplicate documents for this edge camera
                    cameras_col.delete_many({
                        "_id": {"$ne": existing["_id"]},
                        "edge_id": edge_id,
                        "camera_id": camera_id
                    })
                else:
                    cameras_col.update_one(
                        {"stream_key": stream_key},
                        {"$set": record},
                        upsert=True
                    )
            except Exception as e:
                print(f"[EDGE-CONFIG] Error saving camera {camera_id} to MongoDB: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to save Edge camera {camera_id} to MongoDB: {e}"
                )

    if cameras_col is not None and current_camera_ids:
        try:
            cameras_col.update_many(
                {
                    "edge_id": edge_id,
                    "camera_id": {"$nin": current_camera_ids}
                },
                {"$set": {"is_deleted": True, "enabled": False}}
            )
        except Exception as e:
            print(f"[EDGE-CONFIG] Error marking removed edge cameras: {e}")

    try:
        load_devices()
    except Exception as e:
        print(f"[EDGE-CONFIG] Error calling load_devices(): {e}")


@router.put("/{edge_id}", dependencies=[Depends(require_admin)])
async def save_edge_config(
    payload: EdgeConfigUpsert,
    edge_id: str = ApiPath(..., min_length=1, max_length=64),
):
    """Create/update one Edge while preserving all other Edge entries."""
    if edge_id != payload.edge_id:
        raise HTTPException(status_code=400, detail="URL edge_id must match payload edge_id")

    camera_ids = [camera.camera_id for camera in payload.cameras]
    if len(camera_ids) != len(set(camera_ids)):
        raise HTTPException(status_code=400, detail="Camera IDs must be unique within an Edge")

    with _FILE_LOCK:
        document = _read_document()
        old_config = document["edges"].get(edge_id, {})
        old_cameras_map = {}
        if isinstance(old_config, dict):
            for c in old_config.get("cameras", []):
                if isinstance(c, dict) and c.get("camera_id"):
                    old_cameras_map[c.get("camera_id")] = c

        now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

        cameras: list[dict[str, Any]] = []
        for camera in payload.cameras:
            item = camera.dict(exclude_none=True)
            u = item.get("username")
            p = item.get("password")
            raw_url = item.get("rtsp_url")
            if u and p and raw_url:
                item["rtsp_url"] = _inject_credentials(raw_url, u, p)
            cid = item.get("camera_id")
            existing_cam = old_cameras_map.get(cid)

            if existing_cam:
                item["added_at"] = existing_cam.get("added_at") or item.get("added_at") or now_str
                item["updated_at"] = now_str
            else:
                item["added_at"] = item.get("added_at") or now_str
                item["updated_at"] = now_str

            cameras.append(item)

        edge_config: dict[str, Any] = {
            **(old_config if isinstance(old_config, dict) else {}),
            "token": payload.token,
            "display_name": payload.display_name,
            "cameras": cameras,
        }
        if payload.publish_base is not None:
            edge_config["publish_base"] = payload.publish_base.strip()
        document["edges"][edge_id] = edge_config
        _atomic_write(document)
        _save_edge_cameras_to_mongo(edge_id, document["edges"][edge_id])

    return {
        "success": True,
        "edge_id": edge_id,
        "display_name": payload.display_name,
        "camera_count": len(cameras),
        "message": "Edge configuration saved. The Edge device will receive it on its next sync.",
    }


@router.delete("/{edge_id}", dependencies=[Depends(require_admin)])
async def delete_edge_config(edge_id: str = ApiPath(..., min_length=1, max_length=64)):
    """Delete an Edge device and permanently delete all its connected cameras."""
    if not _EDGE_ID_RE.fullmatch(edge_id):
        raise HTTPException(status_code=400, detail="Invalid edge_id")

    from app.core.database import cameras_col, db as _db
    from app.services.camera.mediamtx_service import remove_stream
    from app.managers.stream_manager import load_devices
    from recorder import rtsp_recorder as recorder

    regex_id = re.compile(f"^{re.escape(edge_id)}$", re.IGNORECASE)
    edge_prefix_re = re.compile(f"^{re.escape(edge_id)}_camera_", re.IGNORECASE)
    query = {
        "$or": [
            {"edge_id": regex_id},
            {"stream_key": edge_prefix_re}
        ]
    }

    deleted_cameras_count = 0

    with _FILE_LOCK:
        document = _read_document()
        matched_key = None
        for k in list(document["edges"].keys()):
            if k.lower() == edge_id.lower():
                matched_key = k
                break

        # Check if edge exists in JSON or in MongoDB
        edge_in_mongo = cameras_col is not None and cameras_col.count_documents(query) > 0
        if not matched_key and not edge_in_mongo:
            raise HTTPException(status_code=404, detail="Edge configuration not found")

        if matched_key:
            del document["edges"][matched_key]
            _atomic_write(document)

        if cameras_col is not None:
            try:
                matched_cams = list(cameras_col.find(query))
                for cam in matched_cams:
                    sk = cam.get("stream_key")
                    if sk:
                        try:
                            recorder.stop_camera(sk)
                        except Exception:
                            pass
                        try:
                            remove_stream(sk)
                        except Exception:
                            pass

                del_res = cameras_col.delete_many(query)
                deleted_cameras_count = del_res.deleted_count
                print(f"[EDGE-CONFIG] 🗑 Deleted {deleted_cameras_count} camera(s) for edge '{edge_id}' from MongoDB")
            except Exception as e:
                print(f"[EDGE-CONFIG] Error deleting edge cameras from MongoDB: {e}")

        try:
            if _db is not None:
                if "recordings" in _db.list_collection_names():
                    _db["recordings"].delete_many(query)
                if "analytics_events" in _db.list_collection_names():
                    _db["analytics_events"].delete_many(query)
        except Exception:
            pass

        try:
            import app.managers.stream_manager as sm
            sm.devices = sm.load_devices()
        except Exception as e:
            print(f"[EDGE-CONFIG] Error reloading devices after edge deletion: {e}")

    return {
        "success": True,
        "edge_id": edge_id,
        "deleted_cameras": deleted_cameras_count,
        "message": f"Edge device '{edge_id}' and {deleted_cameras_count} camera(s) deleted successfully."
    }


def sync_all_edge_cameras_to_mongo():
    """Reads edge_cameras.json and synchronizes all edge devices and cameras to MongoDB."""
    try:
        document = _read_document()
        for edge_id, edge in document.get("edges", {}).items():
            if isinstance(edge, dict):
                _save_edge_cameras_to_mongo(edge_id, edge)
        print("[EDGE-CONFIG] All edge cameras successfully synced to MongoDB.")
    except Exception as e:
        print(f"[EDGE-CONFIG] Error syncing edge cameras to MongoDB: {e}")

