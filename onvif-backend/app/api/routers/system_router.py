from fastapi import Path, APIRouter, Depends, HTTPException, File, UploadFile, Query
from app.core.security import verify_token, require_admin
from app.services.license_manager import license_manager
import json
import asyncio
from urllib.parse import urlparse
from pydantic import BaseModel, Field
from typing import Optional
from app.core.database import mongo_client, db as _db, cameras_col, users_col
from app.managers.stream_manager import (
    normalize_stream_name,
    save_camera_to_db,
    save_devices,
    stream_exists_in_mediamtx,
    devices
)
from app.services.camera.mediamtx_service import register_stream
from recorder import rtsp_recorder as recorder
import uuid

import os
import sys
STARTUP_ID = str(uuid.uuid4())

MONGO_URI = os.environ["MONGO_URI"]

CACHED_DISCOVERED_DEVICES = []
_discovery_in_progress = False
_discovery_lock = asyncio.Lock()
_last_discovery_time = 0

async def run_discovery_pipeline():
    global CACHED_DISCOVERED_DEVICES, _discovery_in_progress, _last_discovery_time
    if _discovery_in_progress:
        # If another request is currently running the pipeline, wait for it
        while _discovery_in_progress:
            await asyncio.sleep(0.2)
        return CACHED_DISCOVERED_DEVICES    
    
    _discovery_in_progress = True
    print("[DISCOVERY] Starting network scan...")
    try:
        from app.services.camera.discovery_service import discover_all
        found = await asyncio.to_thread(discover_all, 3, 800)
        print(f"[DISCOVERY] Found {len(found)} camera(s)")

        # Enrich discovered devices with their registered details (like exact model name) if already in database/VMS
        from app.managers.stream_manager import load_devices
        try:
            registered_devices = load_devices()
            registered_by_ip = {r.get("ip"): r for r in registered_devices if r.get("ip")}
            for device in found:
                ip = device.get("ip")
                if ip in registered_by_ip:
                    reg_dev = registered_by_ip[ip]
                    if reg_dev.get("manufacturer") and reg_dev.get("manufacturer") != "Unknown":
                        device["manufacturer"] = reg_dev["manufacturer"]
                    if reg_dev.get("model") and reg_dev.get("model") != "Unknown":
                        device["model"] = reg_dev["model"]
                    if reg_dev.get("mac") and reg_dev.get("mac") != "Unknown":
                        device["mac"] = reg_dev["mac"]
                        if reg_dev.get("name") or reg_dev.get("device_name"):
                            device["name"] = reg_dev.get("device_name") or reg_dev.get("name")
                    device["already_enrolled"] = True
        except Exception as enrich_err:
            print(f"[DISCOVERY] ⚠ Failed to enrich with registered devices: {enrich_err}")

        CACHED_DISCOVERED_DEVICES = found
        import time
        _last_discovery_time = time.time()
        print(f"[DISCOVERY] Cached list updated with {len(found)} camera(s)")
        return found  
    except Exception as e:
        print(f"[DISCOVERY] ❌ Discovery pipeline error: {e}")
        return []    
    finally:
        _discovery_in_progress = False

def start_background_discovery():
    asyncio.create_task(run_discovery_pipeline())

router = APIRouter(prefix="/api", tags=["system"])

@router.get("/health")
def health():
    import os
    import sys
    import socket
    from monitoring.scheduler import scheduler
    from app.core.database import mongo_client
    import urllib.request
    
    watchdog_active = scheduler.thread.is_alive() if scheduler.thread else False
    
    # 1. MongoDB Check
    mongodb_ok = False
    try:
        if mongo_client:
            mongo_client.admin.command('ping')
            mongodb_ok = True
    except Exception:
        pass

    # 2. Mosquitto Check
    mosquitto_ok = False
    try:
        mqtt_host = os.environ["MQTT_BROKER"]
        mqtt_port = int(os.environ.get("MQTT_PORT", 1883))
        with socket.create_connection((mqtt_host, mqtt_port), timeout=1):
            mosquitto_ok = True
    except Exception:
        pass

    # 3. MinIO Check
    minio_ok = False
    try:
        minio_endpoint = os.environ["MINIO_ENDPOINT"]
        m_host = minio_endpoint.split(":")[0] if ":" in minio_endpoint else minio_endpoint
        m_port = int(minio_endpoint.split(":")[1]) if ":" in minio_endpoint else 9000
        with socket.create_connection((m_host, m_port), timeout=1):
            minio_ok = True
    except Exception:
        pass

    # 4. MediaMTX Check
    mediamtx_ok = False
    try:
        mtx_base = os.environ["MEDIAMTX_API_URL"].rstrip('/')
        if not mtx_base.endswith('/v3/paths/list'):
            mtx_url = f"{mtx_base}/v3/paths/list"
        else:
            mtx_url = mtx_base
        req = urllib.request.Request(mtx_url, method="GET")
        with urllib.request.urlopen(req, timeout=1) as response:
            if response.status == 200:
                mediamtx_ok = True
    except Exception:
        pass

    days_left = license_manager.get_days_until_expiry()
    max_cams = license_manager.get_max_cameras()
    active_cams = cameras_col.count_documents({"enabled": True}) if cameras_col is not None else len([d for d in devices if d.get("enabled") is True])

    # is_healthy = mongodb_ok and mosquitto_ok and minio_ok and mediamtx_ok and watchdog_active
    is_healthy = mongodb_ok and mosquitto_ok and mediamtx_ok and watchdog_active

    from fastapi.responses import JSONResponse
    status_code = 200 if is_healthy else 503

    return JSONResponse(status_code=status_code, content={
        "status": "ok" if is_healthy else "error",
        "mongodb": mongodb_ok,
        "minio": minio_ok,
        "mediamtx": mediamtx_ok,
        "mosquitto": mosquitto_ok,
        "stream_manager": True, # Placeholder for explicit stream manager process check
        "scheduler": watchdog_active,
        "version": os.environ.get("APP_VERSION", "1.0.0"),
        "startup_id": STARTUP_ID,
        "license": {
            "valid": license_manager._check_valid() or (not license_manager.validation_enabled or license_manager.dev_mode),
            "days_remaining": days_left,
            "expiring_soon": days_left is not None and days_left <= 30
        },
        "camera_usage": {
            "used": active_cams,
            "licensed": max_cams
        },
        "cluster_mode": os.environ.get("CLUSTER_MODE") == "1"
    })

@router.get("/node-state")
def node_state():
    import subprocess
    try:
        output = subprocess.check_output(["sc", "query", "mirador-recorder"], text=True)
        is_active = "RUNNING" in output
        return {"state": "ACTIVE" if is_active else "STANDBY"}
    except Exception as e:
        return {"state": "UNKNOWN", "error": str(e)}

@router.get("/discover-devices", dependencies=[Depends(require_admin)])
async def discover_devices(refresh: bool = False):
    global CACHED_DISCOVERED_DEVICES, _last_discovery_time    
    try:
        import time
        now = time.time()
        # If cache exists and is fresh (< 20 seconds) and refresh is not forced, return immediately
        if not refresh and CACHED_DISCOVERED_DEVICES and (now - _last_discovery_time < 20):
            return {"devices": CACHED_DISCOVERED_DEVICES}

        devices = await run_discovery_pipeline()
        return {"devices": devices or CACHED_DISCOVERED_DEVICES}
 
    except Exception as e:
        print(f"[DISCOVER] ❌ Discovery error: {e}")
        return {"devices": CACHED_DISCOVERED_DEVICES or [], "error": str(e)}
 
 
# ------------------------------------------------------------------
# Camera enable / disable / delete
# ------------------------------------------------------------------

@router.get("/debug/mongo", dependencies=[Depends(require_admin)])
def debug_mongo():
    try:
        mongo_client.server_info()
        cam_count  = cameras_col.count_documents({})
        rec_count  = _db["recordings"].count_documents({})
        user_count = users_col.count_documents({})
        return {
            "status":       "connected",
            "uri":          MONGO_URI,
            "cameras":      cam_count,
            "recordings":   rec_count,
            "users":        user_count,
            "devices_json": len(devices),
        }
    except Exception as e:
        return {"status": "failed", "error": str(e), "uri": MONGO_URI}

# Auth endpoints
# ------------------------------------------------------------------

@router.get("/camera-health", dependencies=[Depends(verify_token)])
def get_camera_health():
    if cameras_col is None:
        return []
        
    # 1. Get registered cameras
    registered_cameras = list(cameras_col.find({}, {"_id": 0}))
    result = []
    
    for cam in registered_cameras:
        ip = cam.get("ip")
        if not ip: continue
        
        # 2. Find the latest health record for this camera's IP
        ip_pattern = ip.replace(".", "_")
        latest = _db["camera_health"].find_one(
            {"stream": {"$regex": ip_pattern}},
            sort=[("timestamp", -1)]
        )
        
        # 3. Combine registered info with live health info
        is_enabled = cam.get("enabled") is not False
        stream_st = cam.get("stream_status") or cam.get("status")
        prof = cam.get("stream_profiles", [{}])[0] if cam.get("stream_profiles") else {}
        default_fps = prof.get("fps", 25)
        default_bitrate = prof.get("bitrate", 4096)
        
        if latest and latest.get("status"):
            st = latest.get("status")
            fps = latest.get("fps", 0)
            bitrate = latest.get("bitrate", 0)
        else:
            if not is_enabled:
                st = "offline"
                fps = 0
                bitrate = 0
            elif stream_st == "streaming":
                st = "online"
                fps = default_fps
                bitrate = default_bitrate
            elif stream_st == "error":
                st = "error"
                fps = 0
                bitrate = 0
            else:
                st = "online" if is_enabled else "offline"
                fps = default_fps if is_enabled else 0
                bitrate = default_bitrate if is_enabled else 0

        health_entry = {
            "name": cam.get("name") or cam.get("device_name") or f"Camera @ {ip}",
            "model": cam.get("model", "ONVIF Camera"),
            "ip": ip,
            "status": st,
            "bitrate": bitrate,
            "fps": fps,
            "timestamp": latest.get("timestamp") if latest else None
        }
        result.append(health_entry)

    return result


@router.get("/license", dependencies=[Depends(verify_token)])
def get_license(payload: dict = Depends(verify_token)):
    is_admin = payload.get("role") == "admin"
    return license_manager.get_license_info(is_admin=is_admin)

@router.get("/license/info", dependencies=[Depends(verify_token)])
def get_license_info(payload: dict = Depends(verify_token)):
    is_admin = payload.get("role") == "admin"
    return license_manager.get_license_info(is_admin=is_admin)

@router.get("/license/status", dependencies=[Depends(verify_token)])
def get_license_status():
    return {
        "valid": license_manager._check_valid() or (not license_manager.validation_enabled or license_manager.dev_mode),
        "days_remaining": license_manager.get_days_until_expiry(),
        "expiring_soon": license_manager.get_days_until_expiry() is not None and license_manager.get_days_until_expiry() <= 30
    }

@router.post("/license/upload", dependencies=[Depends(require_admin)])
async def upload_license(file: UploadFile = File(...)):
    content = await file.read()
    temp_path = license_manager.license_path + ".tmp"
    backup_path = license_manager.license_path + ".bak"
    
    # Write new license to temp file
    os.makedirs(os.path.dirname(temp_path), exist_ok=True)
    with open(temp_path, "wb") as f:
        f.write(content)
        
    original_path = license_manager.license_path
    try:
        # Swap configuration path to validate the temporary uploaded file
        license_manager.license_path = temp_path
        license_manager.initialize(force_revalidate=True)
        
        # If successfully validated, backup current license and overwrite it
        import shutil
        if os.path.exists(original_path):
            shutil.copy2(original_path, backup_path)
            
        shutil.move(temp_path, original_path)
        license_manager.license_path = original_path
        
        # Finally initialize the manager with the newly moved license
        license_manager.initialize(force_revalidate=True)
        return {"success": True, "message": "License uploaded and activated successfully"}
        
    except Exception as e:
        # Restore the manager state to use the original license path
        license_manager.license_path = original_path
        try:
            license_manager.initialize(force_revalidate=True)
        except Exception:
            pass
            
        # Clean up temp file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
                
        raise HTTPException(status_code=400, detail=f"Invalid license upload: {str(e)}")

@router.post("/license/revalidate", dependencies=[Depends(require_admin)])
def revalidate_license():
    try:
        license_manager.initialize(force_revalidate=True)
        return {
            "success": True, 
            "message": "License revalidated successfully", 
            "info": license_manager.get_license_info(is_admin=True)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
# ------------------------------------------------------------------
# Event Clips — list, play, manual save
# ------------------------------------------------------------------
# ------------------------------------------------------------------
# Snapshot & Filesystem Endpoints
# ------------------------------------------------------------------
import base64
from datetime import datetime

class SnapshotSaveRequest(BaseModel):
    base64_data: str = Field(...)
    camera_name: str = "Unknown"
    target_folder: str = Field(default="", max_length=1024)

@router.post("/snapshot/save")
def save_snapshot_endpoint(req: SnapshotSaveRequest):
    try:
        target_folder = req.target_folder
        if not target_folder:
            target_folder = os.path.join(os.path.expanduser("~"), "Pictures")
            
        os.makedirs(target_folder, exist_ok=True)
        
        # Clean base64
        b64 = req.base64_data
        if "," in b64:
            b64 = b64.split(",", 1)[1]
            
        image_bytes = base64.b64decode(b64)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_cam_name = req.camera_name.replace("/", "_").replace("\\", "_")
        filename = f"snapshot_{safe_cam_name}_{timestamp}.jpg"
        
        file_path = os.path.join(target_folder, filename)
        
        with open(file_path, "wb") as f:
            f.write(image_bytes)
            
        return {"success": True, "path": file_path}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

class OpenFolderRequest(BaseModel):
    folder_path: str = Field(..., min_length=1, max_length=1024)

@router.post("/open-folder")
def open_folder_endpoint(req: OpenFolderRequest):
    try:
        path = req.folder_path
        print(f"[DEBUG] Attempting to open folder: {path}")
        if not path or not os.path.exists(path):
            print(f"[DEBUG] Folder does not exist: {path}")
            return {"success": False, "error": f"Folder does not exist: {path}"}
            
        if os.name == 'nt':
            import subprocess
            import ctypes
            # Force open a new window so it pops to the front!
            # explorer.exe /n, /e, "path" forces a new window
            subprocess.Popen(['explorer.exe', '/n,', '/e,', os.path.normpath(path)])
        else:
            # For linux/mac
            import subprocess
            subprocess.Popen(["xdg-open" if sys.platform == "linux" else "open", path])
            
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/browse-directories")
def browse_directories(path: str = Query("", min_length=1, max_length=1024)):
    try:
        if not path:
            # Return drives on Windows
            if os.name == 'nt':
                import string
                from ctypes import windll
                drives = []
                bitmask = windll.kernel32.GetLogicalDrives()
                for letter in string.ascii_uppercase:
                    if bitmask & 1:
                        drives.append(f"{letter}:\\")
                    bitmask >>= 1
                return {"success": True, "directories": drives, "current_path": ""}
            else:
                path = "/"
                
        if not os.path.exists(path):
            return {"success": False, "error": "Path does not exist"}
            
        directories = []
        for item in os.listdir(path):
            full_path = os.path.join(path, item)
            if os.path.isdir(full_path):
                directories.append(item)
                
        return {"success": True, "directories": sorted(directories), "current_path": path}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/pick-folder")
async def pick_folder_endpoint():
    try:
        def ask_dir():
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            folder = filedialog.askdirectory(parent=root, title="Select Snapshot Folder")
            root.destroy()
            return folder
            
        # Run in thread so it doesn't block asyncio event loop
        import asyncio
        folder_path = await asyncio.to_thread(ask_dir)
        
        if folder_path:
            # normalize slashes for windows
            folder_path = folder_path.replace("/", "\\")
            return {"success": True, "path": folder_path}
        else:
            return {"success": False, "error": "Canceled"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ------------------------------------------------------------------
# Global OS Clipboard Monitor for Screenshots (Win+Shift+S)
# ------------------------------------------------------------------

_clipboard_task = None

@router.on_event("startup")
async def startup_clipboard_monitor():
    global _clipboard_task
    # poll_clipboard was removed; clipboard screenshot monitor is disabled
    _clipboard_task = None

# ------------------------------------------------------------------
# Native File Picker and Audio Streaming
# ------------------------------------------------------------------
from fastapi.responses import FileResponse
from fastapi import Query

@router.get("/pick-file")
def pick_file_endpoint():
    try:
        import tkinter as tk
        from tkinter import filedialog
        import ctypes
        
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        
        file_path = filedialog.askopenfilename(
            title="Select Audio File",
            filetypes=[("Audio Files", "*.mp3 *.wav *.ogg")]
        )
        root.destroy()
        
        if file_path:
            return {"success": True, "path": file_path.replace("/", "\\")}
        return {"success": False, "error": "No file selected"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/stream-audio")
def stream_audio(
    path: str = Query(
        ...,
        min_length=1,
        max_length=1024,
        description="Absolute path to the audio file"
    )
):
    if not os.path.exists(path):
        return {"success": False, "error": "File not found"}
    return FileResponse(path)

