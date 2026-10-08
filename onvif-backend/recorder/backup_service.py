from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from app.core.security import verify_token
from pydantic import BaseModel, Field
from typing import Optional
import asyncio, shutil, os, json
import httpx
from pathlib import Path
from datetime import datetime, timedelta
from . import rtsp_recorder as recorder
from app.core.database import recordings_col
from app.utils.minio_client import minio_client, MINIO_BUCKET

backup_router = APIRouter(prefix="/api/backup", tags=["backup"], dependencies=[Depends(verify_token)])
HOST_AGENT = "http://localhost:9500"

async def _agent(path: str):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{HOST_AGENT}{path}")
    except Exception as e:
        print(f"[BACKUP] Host agent call failed ({path}): {e}")

# ── Paths from environment ────────────────────────────────────────────────────
CONFIG_FILE      = Path(os.environ.get("BACKUP_CONFIG",      "/app/data/backup_config.json"))
HEALTH_LOG       = Path(os.environ.get("BACKUP_HEALTH",      "/app/data/health_log.json"))
NETWORK_BASE_DIR = Path(os.environ.get("BACKUP_NETWORK_DIR", "/network_backup"))

# Only .enc and .meta — these are the actual recording files
RECORDING_EXTENSIONS = {".enc", ".meta"}

backup_state = {
    "status":        "Idle",
    "progress":      0,
    "last_backup":   None,
    "storage_usage": 0,
}
auto_watcher_active   = False
_auto_backup_task: Optional[asyncio.Task] = None
_auto_retention_task: Optional[asyncio.Task] = None

# ── Config helpers ────────────────────────────────────────────────────────────
def load_config() -> dict:
    try:
        if CONFIG_FILE.exists():
            return json.loads(CONFIG_FILE.read_text())
    except Exception as e:
        print(f"[BACKUP] Config load error: {e}")
    return {
        "network":        {"protocol": "SMB", "ip": "", "port": 445,
                           "username": "", "password": "", "path": ""},
        "auto":           {"enabled": False},
        "retention_days": 7,
        "retention_enabled": False,
        "safe_retention_enabled": True,
    }

def save_config(data: dict):
    try:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(data, indent=2))
    except Exception as e:
        print(f"[BACKUP] Config save error: {e}")

def get_local_path() -> Path:
    return Path(recorder.get_recordings_dir())

def get_network_dir() -> Path:
    if os.name == 'nt':
        cfg = load_config()
        path = cfg.get("network", {}).get("path", "")
        if path:
            return Path(path)
    return NETWORK_BASE_DIR

def is_network_available() -> bool:
    try:
        net_dir = get_network_dir()
        return net_dir.exists()
    except Exception:
        return False

def get_storage_usage() -> int:
    try:
        if not is_network_available():
            return 0
        net_dir = get_network_dir()
        usage = shutil.disk_usage(net_dir)
        return int((usage.used / usage.total) * 100)
    except Exception:
        return 0

def copy_file_to_dest(src: Path, dest_base: Path, local_base: Path) -> bool:
    """
    Copy src file to dest_base, preserving folder structure relative to local_base.
    e.g. /recordings/192_168_1_101/2026-04-07/00-17-27.enc
         → <dest_base>/192_168_1_101/2026-04-07/00-17-27.enc
    """
    try:
        rel  = src.relative_to(local_base)
        dest = dest_base / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print(f"[BACKUP] ✓ {rel} → {dest_base}")
        return True
    except Exception as e:
        print(f"[BACKUP] ✗ Copy failed {src.name}: {e}")
        return False

def copy_file_to_network(src: Path) -> bool:
    """Auto-backup helper — always copies to NETWORK_BASE_DIR."""
    return copy_file_to_dest(src, NETWORK_BASE_DIR, get_local_path())

def collect_files_in_range(
    base_dir: Path,
    cam_ip_norm: str,
    start_dt: "datetime.date",
    end_dt: "datetime.date",
) -> list:
    """
    Walk base_dir/<cam_folder>/<YYYY-MM-DD>/ and collect .enc/.meta files
    whose DATE FOLDER name falls within [start_dt, end_dt].
    Uses folder name for date — NOT mtime (mtime is unreliable in network volumes).
    """
    files = []
    try:
        for cam_dir in base_dir.iterdir():
            if not cam_dir.is_dir():
                continue
            if cam_ip_norm not in cam_dir.name:
                continue
            for date_dir in cam_dir.iterdir():
                if not date_dir.is_dir():
                    continue
                try:
                    folder_date = datetime.strptime(date_dir.name, "%Y-%m-%d").date()
                except ValueError:
                    continue  # not a date folder, skip
                if not (start_dt <= folder_date <= end_dt):
                    continue
                for f in date_dir.iterdir():
                    if f.is_file() and f.suffix.lower() in RECORDING_EXTENSIONS:
                        files.append(f)
    except Exception as e:
        print(f"[BACKUP] collect_files error: {e}")
    return files

def tag_health(camera: str, timestamp: str, status: str):
    try:
        log = json.loads(HEALTH_LOG.read_text()) if HEALTH_LOG.exists() else []
        log.append({"camera": camera, "timestamp": timestamp, "status": status})
        HEALTH_LOG.parent.mkdir(parents=True, exist_ok=True)
        HEALTH_LOG.write_text(json.dumps(log[-500:], indent=2))
    except Exception as e:
        print(f"[BACKUP] Health tag error: {e}")

def get_last_healthy(camera: str, before: str) -> Optional[str]:
    try:
        if not HEALTH_LOG.exists():
            return None
        log       = json.loads(HEALTH_LOG.read_text())
        before_dt = datetime.fromisoformat(before)
        healthy   = [
            e for e in log
            if e["camera"] == camera
            and e["status"] == "Healthy"
            and datetime.fromisoformat(e["timestamp"]) <= before_dt
        ]
        return healthy[-1]["timestamp"] if healthy else None
    except Exception as e:
        print(f"[BACKUP] Health lookup error: {e}")
        return None

def append_log(event: str, status: str):
    try:
        log_file = CONFIG_FILE.parent / "backup_activity.json"
        logs = json.loads(log_file.read_text()) if log_file.exists() else []
        logs.insert(0, {
            "id":     len(logs) + 1,
            "time":   datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "event":  event,
            "status": status,
        })
        log_file.write_text(json.dumps(logs[:100], indent=2))
    except Exception as e:
        print(f"[BACKUP] Log write error: {e}")

# ── Pydantic models ───────────────────────────────────────────────────────────
class NetworkConfig(BaseModel):
    protocol: str = "SMB"
    ip: str = Field(default="", max_length=1024)
    port:     int = 445
    username: str = Field(default="", max_length=1024)
    password: str = Field(default="", max_length=1024)
    path: str = Field(default="", max_length=1024)

class ManualBackupRequest(BaseModel):
    cameras:          list[str]
    start_date: str = Field(..., max_length=1024)
    end_date: str = Field(..., max_length=1024)
    start_time:       str = "00:00:00"
    end_time:         str = "23:59:59"
    format:           str = "ENC"
    destination_path: str = ""   # D:\, C:\, Z:\, custom path — empty = NETWORK_BASE_DIR

class CameraRetentionItem(BaseModel):
    ip: str = Field(..., max_length=1024)
    days: int

class RetentionRequest(BaseModel):
    retention_days: Optional[int] = 7
    camera_configs: Optional[list[CameraRetentionItem]] = None
    retention_enabled: Optional[bool] = None
    safe_retention_enabled: Optional[bool] = True
    backup_first: Optional[bool] = False

class RestoreRequest(BaseModel):
    cameras:           list[str]
    start_date: str = Field(..., max_length=1024)
    end_date: str = Field(..., max_length=1024)
    use_smart_restore: bool = False

class AutoConfigRequest(BaseModel):
    enabled: bool

# ── Auto-backup: asyncio polling ──────────────────────────────────────────────
async def auto_backup_polling():
    """
    Polls /recordings every 3 s for new .enc/.meta files.
    Copies any unseen (size-stable) files to NETWORK_BASE_DIR.
    """
    print("[AutoBackup] ▶ Polling started")
    seen: set[str] = set()

    while auto_watcher_active:
        try:
            base = get_local_path()
            for file in base.rglob("*"):
                if file.suffix.lower() not in RECORDING_EXTENSIONS:
                    continue
                key = str(file)
                if key in seen:
                    continue
                # Wait until write is complete (size stable over 1 s)
                try:
                    size1 = file.stat().st_size
                    await asyncio.sleep(1)
                    size2 = file.stat().st_size
                    if size1 != size2:
                        continue
                except Exception:
                    continue

                print(f"[AutoBackup] New file: {file.name}")
                if copy_file_to_network(file):
                    seen.add(key)
                    cam = file.parent.parent.name
                    tag_health(cam, datetime.now().isoformat(), "Healthy")
                    append_log(f"Auto-pushed: {file.name}", "Success")
                else:
                    append_log(f"Auto-push failed: {file.name}", "Error")

        except Exception as e:
            print(f"[AutoBackup] Poll error: {e}")

        await asyncio.sleep(3)

    print("[AutoBackup] ⏹ Polling stopped")


async def auto_retention_polling():
    """
    Background worker that runs a retention sweep every 60 seconds.
    Reads current camera and group retention settings from backup_config.json.
    """
    print("[AutoRetention] ▶ Automatic retention service active")
    while auto_watcher_active:
        try:
            cfg = load_config()
            if not cfg.get("retention_enabled", False):
                await asyncio.sleep(5)
                continue

            default_days = cfg.get("retention_days", 7)
            camera_configs = cfg.get("camera_configs", [])
            safe_enabled = cfg.get("safe_retention_enabled", True)

            camera_map = {}
            for item in camera_configs:
                norm_ip = item.get("ip", "").replace(".", "_")
                if norm_ip:
                    camera_map[norm_ip] = item.get("days", default_days)

            # Query all COMPLETE recordings
            query = {"status": "COMPLETE"}
            docs = list(recordings_col.find(query)) if recordings_col is not None else []
            
            moved, failed = 0, 0
            from app.utils.minio_client import delete_object, object_exists
            
            for doc in docs:
                camera_id = doc.get("camera_id", "")
                created_at = doc.get("created_at")
                file_path = doc.get("file_path", "")
                
                if not file_path or not isinstance(created_at, datetime):
                    continue
                    
                days = camera_map.get(camera_id, default_days)
                cutoff = datetime.utcnow() - timedelta(minutes=days)
                
                if created_at < cutoff:
                    # Expired! Check if backed up
                    backed_up = False
                    rel_path = ""
                    if file_path.startswith("minio:"):
                        obj_name = file_path.split("minio:")[-1]
                        parts = obj_name.split("/")
                        if len(parts) > 3 and parts[0].startswith("shard"):
                            rel_path = "/".join(parts[1:])
                        else:
                            rel_path = obj_name
                    else:
                        rel_path = file_path
                    
                    try:
                        dest = get_network_dir() / rel_path
                        backed_up = dest.is_file()
                    except Exception:
                        pass
                    
                    # If Safe Mode is enabled, verify it's backed up before deleting
                    if safe_enabled and not backed_up:
                        continue
                    
                    # Safe to delete!
                    try:
                        if file_path.startswith("minio:"):
                            obj_name = file_path.split("minio:")[-1]
                            if object_exists(obj_name):
                                if delete_object(obj_name):
                                    recordings_col.delete_one({"_id": doc["_id"]})
                                    moved += 1
                                else:
                                    failed += 1
                            else:
                                # Not in MinIO, delete doc
                                recordings_col.delete_one({"_id": doc["_id"]})
                                moved += 1
                        else:
                            p = Path(file_path)
                            if p.is_file():
                                p.unlink()
                                recordings_col.delete_one({"_id": doc["_id"]})
                                moved += 1
                            else:
                                failed += 1
                    except Exception:
                        failed += 1

            if moved > 0:
                print(f"[AutoRetention] Swept and purged {moved} expired recording(s) from MinIO.")
                append_log(
                    f"Auto-Retention (Sweep) — automatically purged {moved} expired file(s) from MinIO.",
                    "Success" if failed == 0 else "Warning"
                )
        except Exception as e:
            print(f"[AutoRetention] Automated retention loop error: {e}")

        # Sleep for 60 seconds with responsive exit
        for _ in range(60):
            if not auto_watcher_active:
                break
            if not load_config().get("retention_enabled", False):
                break
            await asyncio.sleep(1)

    print("[AutoRetention] ⏹ Automatic retention service stopped")


def start_auto_watcher():
    global auto_watcher_active, _auto_backup_task, _auto_retention_task
    if auto_watcher_active:
        return
    if not is_network_available():
        print("[AutoBackup] ✗ /network_backup not accessible.")
        return
    auto_watcher_active = True
    _auto_backup_task = asyncio.create_task(auto_backup_polling())
    _auto_retention_task = asyncio.create_task(auto_retention_polling())
    asyncio.create_task(_agent("/start"))
    print(f"[AutoBackup] ✓ Watching: {get_local_path()} → {NETWORK_BASE_DIR}")
    append_log("Auto backup & retention polling started", "Info")


def stop_auto_watcher():
    global auto_watcher_active, _auto_backup_task, _auto_retention_task
    auto_watcher_active = False
    if _auto_backup_task and not _auto_backup_task.done():
        _auto_backup_task.cancel()
    if _auto_retention_task and not _auto_retention_task.done():
        _auto_retention_task.cancel()
    _auto_backup_task = None
    _auto_retention_task = None
    asyncio.create_task(_agent("/stop"))
    append_log("Auto backup stopped", "Info")


# ── Endpoints ─────────────────────────────────────────────────────────────────
@backup_router.get("/config")
async def get_config():
    cfg = load_config()
    cfg["local_path"]        = str(get_local_path())
    cfg["network_path"]      = str(get_network_dir())
    cfg["network_available"] = is_network_available()
    return cfg


@backup_router.post("/network/test")
async def test_network_connection(config: NetworkConfig):
    cfg = load_config()
    cfg["network"] = config.dict()
    save_config(cfg)
    if is_network_available():
        append_log("Connection test passed", "Success")
        net_dir = get_network_dir()
        return {
            "status":  "success",
            "message": f"✅ Backup path is accessible! Path: {net_dir}",
        }
    
    path_display = config.path if config.path else str(NETWORK_BASE_DIR)
    if os.name == 'nt':
        raise HTTPException(
            status_code=400,
            detail=f"❌ Backup path '{path_display}' is not accessible. Please check connectivity, folder sharing, or permissions.",
        )
    raise HTTPException(
        status_code=400,
        detail=(
            "❌ /network_backup not accessible inside container. "
        ),
    )


@backup_router.post("/network/save")
async def save_network_settings(config: NetworkConfig):
    cfg = load_config()
    cfg["network"] = config.dict()
    save_config(cfg)
    if auto_watcher_active:
        stop_auto_watcher()
        start_auto_watcher()
    append_log("Network settings saved", "Info")
    return {
        "status":  "success",
        "message": "Network settings saved.",
    }


@backup_router.post("/auto/config")
async def update_auto_config(req: AutoConfigRequest):
    if req.enabled and not is_network_available():
        path_display = get_network_dir()
        if os.name == 'nt':
            raise HTTPException(
                status_code=400,
                detail=f"❌ Backup path '{path_display}' is not accessible. Check network connectivity or path permissions.",
            )
        raise HTTPException(
            status_code=400,
            detail="❌ /network_backup not accessible. Check the network backup volume configuration.",
        )
    cfg = load_config()
    cfg["auto"]["enabled"] = req.enabled
    save_config(cfg)
    if req.enabled:
        start_auto_watcher()
    else:
        stop_auto_watcher()
    return {
        "status":  "success",
        "message": f"Auto backup {'enabled ✅' if req.enabled else 'disabled ⏹'}.",
    }
def windows_path_to_container(windows_path: str) -> Path:
    """
    Convert a Windows path selected in the UI → container mount path.
    
    Examples:
      D:\\Backup        → /mnt/dest_d/Backup
      D:\\              → /mnt/dest_d
      E:\\MyUSB\\clips  → /mnt/dest_e/MyUSB/clips
      C:\\Backup        → /mnt/dest_c/Backup
      Z:\\              → /network_backup  (already mounted)
    """
    stripped = windows_path.strip()

    # Not a Windows path — return as-is (already a Linux path)
    if len(stripped) < 2 or stripped[1] != ':':
        return Path(stripped) if stripped else NETWORK_BASE_DIR

    # If running natively on Windows (not in a Linux container), keep Windows path!
    if os.name == 'nt':
        return Path(stripped)

    drive_letter = stripped[0].lower()          # "d"
    rest         = stripped[2:].lstrip("\\/")   # "Backup" or "" or "MyUSB\\clips"
    rest_linux   = rest.replace("\\", "/")      # "Backup" or "" or "MyUSB/clips"

    # Z: is already the network_backup mount
    if drive_letter == 'z':
        return NETWORK_BASE_DIR / rest_linux if rest_linux else NETWORK_BASE_DIR

    container_root = Path(f"/mnt/dest_{drive_letter}")
    return container_root / rest_linux if rest_linux else container_root

# ── Manual backup ─────────────────────────────────────────────────────────────
async def run_manual_backup(req: ManualBackupRequest):
    global backup_state
    backup_state.update({"status": "Processing", "progress": 0})

    # Resolve destination
    dest_base = windows_path_to_container(req.destination_path) if req.destination_path.strip() else get_network_dir()
    append_log(
        f"Manual backup started — {len(req.cameras)} camera(s), "
        f"{req.start_date} → {req.end_date}, dest: {dest_base}",
        "Info"
    )

    try:
        local    = get_local_path()
        
        # Create destination
        try:
            dest_base.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            backup_state["status"] = "Failed"
            append_log(f"Cannot create destination {dest_base}: {e}", "Error")
            return

        print(f"[BACKUP] Destination: {dest_base}")
        print(f"[BACKUP] Date range: {req.start_date} ({req.start_time}) → {req.end_date} ({req.end_time})")
        print(f"[BACKUP] Cameras: {req.cameras}")

        # Normalize request times (convert HH:MM:SS or HH:MM to HH-MM-SS format)
        def clean_time(t_str: str) -> str:
            return t_str.replace(":", "-").strip()

        req_start_t = clean_time(req.start_time)
        req_end_t = clean_time(req.end_time)

        # Query MongoDB recordings collection
        camera_ids_norm = [cam.replace(".", "_") for cam in req.cameras]
        query = {
            "camera_id": {"$in": camera_ids_norm},
            "date": {"$gte": req.start_date, "$lte": req.end_date}
        }
        docs = list(recordings_col.find(query)) if recordings_col is not None else []

        backup_items = []
        for doc in docs:
            doc_date = doc.get("date", "")
            doc_time = clean_time(doc.get("start_time", ""))

            # Filter by date and time range
            if doc_date == req.start_date and doc_time < req_start_t:
                continue
            if doc_date == req.end_date and doc_time > req_end_t:
                continue

            file_path = doc.get("file_path", "")
            if not file_path:
                continue
            if file_path.startswith("minio:"):
                obj_name = file_path.split("minio:")[-1]
                parts = obj_name.split("/")
                if len(parts) > 3 and parts[0].startswith("shard"):
                    rel_path = "/".join(parts[1:])
                else:
                    rel_path = obj_name
                backup_items.append({
                    "type": "minio",
                    "source": obj_name,
                    "rel_path": rel_path
                })
            else:
                p = Path(file_path)
                try:
                    rel_path = p.relative_to(local)
                except ValueError:
                    rel_path = p.name
                backup_items.append({
                    "type": "local",
                    "source": p,
                    "rel_path": rel_path
                })

        total = len(backup_items)
        print(f"[BACKUP] Total: {total} files to copy → {dest_base}")

        if total == 0:
            backup_state.update({"status": "Completed", "progress": 100})
            append_log(
                f"Manual backup: no recordings found in MinIO/local for {req.cameras} "
                f"between {req.start_date} and {req.end_date}.",
                "Warning"
            )
            return

        copied = 0
        failed = 0
        for i, item in enumerate(backup_items):
            try:
                dest = dest_base / item["rel_path"]
                dest.parent.mkdir(parents=True, exist_ok=True)

                if item["type"] == "minio":
                    if minio_client is not None:
                        await asyncio.to_thread(
                            minio_client.fget_object,
                            MINIO_BUCKET,
                            item["source"],
                            str(dest)
                        )
                        copied += 1
                        print(f"[BACKUP] ✓ ({i+1}/{total}) minio:{item['source']} → {dest}")
                    else:
                        raise RuntimeError("MinIO client not initialized")
                else:
                    shutil.copy2(item["source"], dest)
                    copied += 1
                    print(f"[BACKUP] ✓ ({i+1}/{total}) local:{item['source']} → {dest}")

            except Exception as e:
                failed += 1
                print(f"[BACKUP] ✗ ({i+1}/{total}) {item['rel_path']}: {e}")

            backup_state["progress"] = int(((i + 1) / total) * 100)
            await asyncio.sleep(0.01)

        backup_state.update({
            "status":      "Completed",
            "progress":    100,
            "last_backup": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
        append_log(
            f"Manual backup done — {copied}/{total} files ({copied//2} chunks) "
            f"copied to {dest_base}, {failed} failed",
            "Success" if failed == 0 else "Warning"
        )

    except Exception as e:
        backup_state["status"] = "Failed"
        append_log(f"Manual backup failed: {e}", "Error")
        print(f"[BACKUP] Manual error: {e}")


@backup_router.post("/manual/start")
async def start_manual_backup(req: ManualBackupRequest, background_tasks: BackgroundTasks):
    if backup_state["status"] == "Processing":
        raise HTTPException(status_code=400, detail="A backup is already running.")

    # If destination is the default network mount, check it's accessible
    dest = req.destination_path.strip()
    if not dest and not is_network_available():
        raise HTTPException(
            status_code=400,
            detail="Network storage not accessible. Set a destination path or fix the network mount."
        )

    background_tasks.add_task(run_manual_backup, req)
    dest_display = dest if dest else str(get_network_dir())
    return {"status": "success", "message": f"Manual backup started → {dest_display}"}


# ── Retention ─────────────────────────────────────────────────────────────────
@backup_router.get("/retention/preview")
async def preview_retention(days: int = 7):
    cutoff = datetime.now() - timedelta(minutes=days)
    local  = get_local_path()
    files  = []
    try:
        for f in local.rglob("*"):
            if not f.is_file() or f.suffix.lower() not in RECORDING_EXTENSIONS:
                continue
            mtime = datetime.fromtimestamp(f.stat().st_mtime)
            if mtime < cutoff:
                parts  = f.parts
                camera = parts[-3] if len(parts) >= 3 else "unknown"
                files.append({
                    "file":     f.name,
                    "camera":   camera,
                    "modified": mtime.strftime("%Y-%m-%d %H:%M"),
                })
    except Exception as e:
        print(f"[BACKUP] Preview error: {e}")
    return {"count": len(files), "files": files[:20]}


@backup_router.post("/retention/preview")
async def preview_retention_post(req: RetentionRequest):
    camera_map = {}
    if req.camera_configs:
        for item in req.camera_configs:
            norm_ip = item.ip.replace(".", "_")
            camera_map[norm_ip] = item.days

    default_days = req.retention_days or 7
    safe_enabled = req.safe_retention_enabled if req.safe_retention_enabled is not None else load_config().get("safe_retention_enabled", True)

    files = []
    missing_in_backup_count = 0
    missing_files = []
    try:
        query = {"status": "COMPLETE"}
        docs = list(recordings_col.find(query)) if recordings_col is not None else []
        
        for doc in docs:
            camera_id = doc.get("camera_id", "")
            created_at = doc.get("created_at")
            file_path = doc.get("file_path", "")
            
            if not file_path or not isinstance(created_at, datetime):
                continue
                
            days = camera_map.get(camera_id, default_days)
            cutoff = datetime.utcnow() - timedelta(minutes=days)
            
            if created_at < cutoff:
                backed_up = False
                rel_path = ""
                if file_path.startswith("minio:"):
                    obj_name = file_path.split("minio:")[-1]
                    parts = obj_name.split("/")
                    if len(parts) > 3 and parts[0].startswith("shard"):
                        rel_path = "/".join(parts[1:])
                    else:
                        rel_path = obj_name
                else:
                    rel_path = file_path
                
                try:
                    dest = get_network_dir() / rel_path
                    backed_up = dest.is_file()
                except Exception:
                    pass
                
                from app.utils.minio_client import object_exists
                obj_exists_minio = False
                if file_path.startswith("minio:"):
                    obj_name = file_path.split("minio:")[-1]
                    obj_exists_minio = object_exists(obj_name)
                
                if file_path.startswith("minio:") and not obj_exists_minio:
                    continue
                    
                files.append({
                    "file":     os.path.basename(rel_path),
                    "camera":   camera_id,
                    "modified": created_at.strftime("%Y-%m-%d %H:%M"),
                    "backed_up": backed_up
                })
                if not backed_up:
                    missing_in_backup_count += 1
                    missing_files.append(f"{camera_id}/{doc.get('date', '')}/{os.path.basename(rel_path)}")
    except Exception as e:
        print(f"[BACKUP] Preview error: {e}")
    return {
        "count": len(files),
        "files": files[:20],
        "missing_in_backup_count": missing_in_backup_count,
        "missing_files": missing_files[:10]
    }


def run_enforce_retention_bg(req: RetentionRequest):
    global backup_state
    backup_state.update({"status": "Processing", "progress": 0})
    append_log("Retention Enforcement task started in background", "Info")
    
    try:
        camera_map = {}
        if req.camera_configs:
            for item in req.camera_configs:
                norm_ip = item.ip.replace(".", "_")
                camera_map[norm_ip] = item.days

        default_days = req.retention_days or 7
        safe_enabled = req.safe_retention_enabled if req.safe_retention_enabled is not None else load_config().get("safe_retention_enabled", True)

        expired_docs = []
        missing_files = []
        docs = list(recordings_col.find({"status": "COMPLETE"})) if recordings_col is not None else []
        
        # 1. First Pass: Scan for expired files and missing backups
        for doc in docs:
            camera_id = doc.get("camera_id", "")
            created_at = doc.get("created_at")
            file_path = doc.get("file_path", "")
            
            if not file_path or not isinstance(created_at, datetime):
                continue
                
            days = camera_map.get(camera_id, default_days)
            cutoff = datetime.utcnow() - timedelta(minutes=days)
            
            if created_at < cutoff:
                backed_up = False
                rel_path = ""
                if file_path.startswith("minio:"):
                    obj_name = file_path.split("minio:")[-1]
                    parts = obj_name.split("/")
                    if len(parts) > 3 and parts[0].startswith("shard"):
                        rel_path = "/".join(parts[1:])
                    else:
                        rel_path = obj_name
                else:
                    rel_path = file_path
                
                try:
                    dest = get_network_dir() / rel_path
                    backed_up = dest.is_file()
                except Exception:
                    pass
                
                from app.utils.minio_client import object_exists
                obj_exists_minio = False
                if file_path.startswith("minio:"):
                    obj_name = file_path.split("minio:")[-1]
                    obj_exists_minio = object_exists(obj_name)
                
                if file_path.startswith("minio:") and not obj_exists_minio:
                    continue
                
                if safe_enabled and not backed_up:
                    missing_files.append((doc, rel_path))
                else:
                    expired_docs.append(doc)

        # 2. If backup_first is enabled, back up the missing files
        if safe_enabled and missing_files:
            if req.backup_first:
                total_missing = len(missing_files)
                append_log(f"Auto-backing up {total_missing} missing files before purging...", "Info")
                
                for idx, (doc, rel_path) in enumerate(missing_files):
                    file_path = doc.get("file_path", "")
                    try:
                        dest_file = get_network_dir() / rel_path
                        dest_file.parent.mkdir(parents=True, exist_ok=True)
                        if file_path.startswith("minio:"):
                            from app.utils.minio_client import minio_client, MINIO_BUCKET
                            obj_name = file_path.split("minio:")[-1]
                            minio_client.fget_object(MINIO_BUCKET, obj_name, str(dest_file))
                        else:
                            shutil.copy2(file_path, dest_file)
                            
                        # Backup succeeded! Add to expired_docs to be purged
                        expired_docs.append(doc)
                    except Exception as e:
                        append_log(f"Failed to back up {rel_path}: {e}", "Error")
                    
                    # Update progress bar
                    progress_pct = int(((idx + 1) / total_missing) * 90)  # Reserve last 10% for the delete phase
                    backup_state["progress"] = progress_pct
            else:
                append_log(f"Retention halted — {len(missing_files)} file(s) are missing from network backup.", "Error")
                backup_state["status"] = "Failed"
                return

        # 3. Purge expired files (verified or just backed up) from MinIO
        total_to_purge = len(expired_docs)
        moved = 0
        failed = 0
        from app.utils.minio_client import delete_object
        
        for idx, doc in enumerate(expired_docs):
            file_path = doc.get("file_path", "")
            try:
                if file_path.startswith("minio:"):
                    obj_name = file_path.split("minio:")[-1]
                    if delete_object(obj_name):
                        recordings_col.delete_one({"_id": doc["_id"]})
                        moved += 1
                    else:
                        failed += 1
                else:
                    p = Path(file_path)
                    if p.is_file():
                        p.unlink()
                        recordings_col.delete_one({"_id": doc["_id"]})
                        moved += 1
                    else:
                        failed += 1
            except Exception:
                failed += 1
            
            # Update progress for delete phase
            if total_to_purge > 0:
                del_pct = int((moved / total_to_purge) * 10)
                backup_state["progress"] = 90 + del_pct

        cfg = load_config()
        cfg["retention_days"] = req.retention_days
        if req.camera_configs:
            cfg["camera_configs"] = [item.dict() for item in req.camera_configs]
        cfg["safe_retention_enabled"] = safe_enabled
        save_config(cfg)
        
        append_log(
            f"Retention Enforce complete — MinIO files purged: {moved}, failed: {failed}",
            "Success" if failed == 0 else "Warning",
        )
        backup_state.update({
            "status": "Completed",
            "progress": 100,
        })
        
    except Exception as e:
        print(f"[RETENTION] Background run crashed: {e}")
        append_log(f"Retention sweep crashed: {e}", "Error")
        backup_state["status"] = "Failed"


@backup_router.post("/retention/enforce")
async def enforce_retention(req: RetentionRequest, background_tasks: BackgroundTasks):
    if backup_state["status"] == "Processing":
        raise HTTPException(status_code=400, detail="A backup or retention sweep is already running.")

    if req.backup_first:
        background_tasks.add_task(run_enforce_retention_bg, req)
        return {"status": "success", "message": "Auto-backup and retention sweep started in background."}

    camera_map = {}
    if req.camera_configs:
        for item in req.camera_configs:
            norm_ip = item.ip.replace(".", "_")
            camera_map[norm_ip] = item.days

    default_days = req.retention_days or 7
    safe_enabled = req.safe_retention_enabled if req.safe_retention_enabled is not None else load_config().get("safe_retention_enabled", True)

    if safe_enabled and not is_network_available():
        raise HTTPException(status_code=400, detail="Network storage not accessible in Safe Mode.")
    
    expired_docs = []
    missing_files = []
    docs = []
    
    try:
        query = {"status": "COMPLETE"}
        docs = list(recordings_col.find(query)) if recordings_col is not None else []
        
        for doc in docs:
            camera_id = doc.get("camera_id", "")
            created_at = doc.get("created_at")
            file_path = doc.get("file_path", "")
            
            if not file_path or not isinstance(created_at, datetime):
                continue
                
            days = camera_map.get(camera_id, default_days)
            cutoff = datetime.utcnow() - timedelta(minutes=days)
            
            if created_at < cutoff:
                backed_up = False
                rel_path = ""
                if file_path.startswith("minio:"):
                    obj_name = file_path.split("minio:")[-1]
                    parts = obj_name.split("/")
                    if len(parts) > 3 and parts[0].startswith("shard"):
                        rel_path = "/".join(parts[1:])
                    else:
                        rel_path = obj_name
                else:
                    rel_path = file_path
                
                try:
                    dest = get_network_dir() / rel_path
                    backed_up = dest.is_file()
                except Exception:
                    pass
                
                from app.utils.minio_client import object_exists
                obj_exists_minio = False
                if file_path.startswith("minio:"):
                    obj_name = file_path.split("minio:")[-1]
                    obj_exists_minio = object_exists(obj_name)
                
                if file_path.startswith("minio:") and not obj_exists_minio:
                    continue
                
                if safe_enabled and not backed_up:
                    missing_files.append(f"{camera_id}/{doc.get('date', '')}/{os.path.basename(rel_path)}")
                else:
                    expired_docs.append(doc)
    except Exception as e:
        print(f"[BACKUP] Scan error: {e}")
        raise HTTPException(status_code=500, detail=f"Database or scan error: {str(e)}")

    # Safety Halt: If Safe Mode is ON and any expired files are NOT stored in the backup, cancel retention!
    if safe_enabled and missing_files:
        append_log(
            f"Retention halted — {len(missing_files)} file(s) are missing from network backup.",
            "Error"
        )
        return {
            "status": "error",
            "error_type": "missing_backups",
            "message": "Retention cannot happen as some files are not stored in the backup.",
            "missing_files": missing_files[:10]
        }

    # Second Pass: Safely purge MinIO objects or local files
    moved = 0
    failed = 0
    from app.utils.minio_client import delete_object
    for doc in expired_docs:
        file_path = doc.get("file_path", "")
        try:
            if file_path.startswith("minio:"):
                obj_name = file_path.split("minio:")[-1]
                if delete_object(obj_name):
                    recordings_col.delete_one({"_id": doc["_id"]})
                    moved += 1
                else:
                    failed += 1
            else:
                p = Path(file_path)
                if p.is_file():
                    p.unlink()
                    recordings_col.delete_one({"_id": doc["_id"]})
                    moved += 1
                else:
                    failed += 1
        except Exception:
            failed += 1

    cfg = load_config()
    cfg["retention_days"] = req.retention_days
    if req.camera_configs:
        cfg["camera_configs"] = [item.dict() for item in req.camera_configs]
    cfg["safe_retention_enabled"] = safe_enabled
    save_config(cfg)
    
    append_log(
        f"Retention enforced — MinIO files purged: {moved}, failed: {failed}",
        "Success" if failed == 0 else "Warning",
    )
    return {
        "status":  "success",
        "moved":   moved,
        "failed":  failed,
        "message": f"Enforced retention rules successfully. Purged {moved} expired file(s) from MinIO.",
    }


@backup_router.post("/retention/save")
async def save_retention_settings(req: RetentionRequest):
    cfg = load_config()
    if req.retention_days is not None:
        cfg["retention_days"] = req.retention_days
    if req.camera_configs is not None:
        cfg["camera_configs"] = [item.dict() for item in req.camera_configs]
    if req.retention_enabled is not None:
        cfg["retention_enabled"] = req.retention_enabled
    if req.safe_retention_enabled is not None:
        cfg["safe_retention_enabled"] = req.safe_retention_enabled
    save_config(cfg)
    
    status_msg = "enabled" if cfg.get("retention_enabled", False) else "disabled"
    append_log(f"Retention configuration updated (Enabled: {status_msg})", "Info")
    return {
        "status": "success",
        "message": f"Retention settings saved successfully. Background sweep is {status_msg}."
    }


# ── Restore ───────────────────────────────────────────────────────────────────
async def run_restore(req: RestoreRequest):
    global backup_state
    backup_state.update({"status": "Processing", "progress": 0})
    append_log(f"Restore started — {len(req.cameras)} camera(s)", "Info")
    try:
        net      = NETWORK_BASE_DIR
        local    = get_local_path()
        start_dt = datetime.strptime(req.start_date, "%Y-%m-%d").date()
        end_dt   = datetime.strptime(req.end_date,   "%Y-%m-%d").date()

        if req.use_smart_restore and req.cameras:
            smart_end = get_last_healthy(req.cameras[0], req.end_date + "T23:59:59")
            if smart_end:
                end_dt = datetime.fromisoformat(smart_end).date()
                append_log(f"Smart restore point: {smart_end}", "Info")

        all_files: list[Path] = []
        for camera in req.cameras:
            cam_ip_norm = camera.replace(".", "_")
            found = collect_files_in_range(net, cam_ip_norm, start_dt, end_dt)
            all_files.extend(found)

        total = len(all_files)
        if total == 0:
            backup_state.update({"status": "Completed", "progress": 100})
            append_log("Restore done — no files found in network backup", "Warning")
            return

        for i, f in enumerate(all_files):
            try:
                rel  = f.relative_to(net)
                dest = local / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, dest)
                print(f"[RESTORE] ✓ {rel}")
            except Exception as e:
                print(f"[RESTORE] ✗ {f.name}: {e}")
            backup_state["progress"] = int(((i + 1) / total) * 100)
            await asyncio.sleep(0.01)

        backup_state.update({
            "status":      "Completed",
            "progress":    100,
            "last_backup": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })
        append_log(f"Restore done — {total} file(s) restored to {local}", "Success")

    except Exception as e:
        backup_state["status"] = "Failed"
        append_log(f"Restore failed: {e}", "Error")
        print(f"[BACKUP] Restore error: {e}")


@backup_router.post("/restore/start")
async def start_restore(req: RestoreRequest, background_tasks: BackgroundTasks):
    if backup_state["status"] == "Processing":
        raise HTTPException(status_code=400, detail="A task is already running.")
    if not is_network_available():
        raise HTTPException(status_code=400, detail="Network storage not accessible.")
    background_tasks.add_task(run_restore, req)
    return {"status": "success", "message": "Restore started."}


@backup_router.get("/restore/smart-preview")
async def smart_restore_preview(camera: str, end_date: str):
    last_healthy = get_last_healthy(camera, end_date + "T23:59:59")
    return {
        "camera":                    camera,
        "requested_end":             end_date,
        "recommended_restore_point": last_healthy,
        "reason": (
            "Last confirmed healthy recording before instability or crash"
            if last_healthy else
            "No healthy tags found — full date range will be used"
        ),
    }


@backup_router.post("/health/tag")
async def tag_recording_health(camera: str, timestamp: str, status: str):
    if status not in ("Healthy", "Unstable", "Crashed"):
        raise HTTPException(status_code=400, detail="status must be: Healthy, Unstable, or Crashed")
    tag_health(camera, timestamp, status)
    return {"status": "success"}


@backup_router.get("/status")
async def get_backup_status():
    backup_state["storage_usage"]     = get_storage_usage()
    backup_state["local_path"]        = str(get_local_path())
    backup_state["network_path"]      = str(get_network_dir())
    backup_state["network_available"] = is_network_available()
    backup_state["auto_active"]       = auto_watcher_active
    return backup_state


@backup_router.get("/logs")
async def get_backup_logs():
    try:
        log_file = CONFIG_FILE.parent / "backup_activity.json"
        if log_file.exists():
            return json.loads(log_file.read_text())
    except Exception as e:
        print(f"[BACKUP] Log read error: {e}")
    return [{"id": 1, "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
             "event": "Backup service ready", "status": "Info"}]
