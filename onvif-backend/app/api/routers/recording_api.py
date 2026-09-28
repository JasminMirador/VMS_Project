"""
recording_api.py
----------------
FastAPI router providing recording management endpoints.
Mount this in main.py with:  

Endpoints:
  GET  /api/recordings/                    - list all recordings (filterable)
  GET  /api/recordings/cameras             - list cameras with recordings
  GET  /api/recordings/status              - recorder thread status
  GET  /api/recordings/play                - decrypt + stream a recording
  GET  /api/recordings/download            - download a single video as MP4
  GET  /api/recordings/{camera_id}         - list recordings for one camera
  POST /api/recordings/decrypt-file        - decrypt uploaded .enc file
  POST /api/recordings/start/{stream_name} - start recording a camera
  POST /api/recordings/stop/{stream_name}  - stop recording a camera
  POST /api/recordings/export-zip          - export date/time range as zip

  GET  /api/storage/management             - list storage locations + disk info
  POST /api/storage/apply                  - update recording path at runtime (persisted to disk)
  POST /api/storage/collect-nonindexed     - collect non-indexed files
"""

import os
import io
import re
import json
import shutil
import tempfile
import zipfile
from app.utils.ffmpeg_utils import FFMPEG_BIN
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, BackgroundTasks, Depends, Request
from app.core.security import verify_token
from fastapi.responses import StreamingResponse, FileResponse, Response
from pydantic import BaseModel
from app.core.database import mongo_client
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.backends import default_backend

from recorder import rtsp_recorder as recorder
from recorder import signature_service
from app.managers.stream_manager import stop_worker_pool

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
KEY_FILE  = os.environ.get("VIDEO_KEY_FILE", "/app/data/video.key")

if os.name == 'nt' and KEY_FILE == "/app/data/video.key":
    player_path = "c:/Users/miradorwin/Documents/GitHub/VMS_Project/onvif-backend/player/video.key"
    if os.path.exists(player_path):
        KEY_FILE = player_path
    else:
        sibling_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "devices_data", "video.key"))
        if os.path.exists(sibling_path):
            KEY_FILE = sibling_path
        else:
            hardcoded_path = "c:/Users/miradorwin/Documents/GitHub/VMS_Project/devices_data/video.key"
            if os.path.exists(hardcoded_path):
                KEY_FILE = hardcoded_path
            else:
                KEY_FILE = sibling_path

# ── Startup sanity check: warn loudly if the key file is missing ──────────────
# Both this module and encrypt_service.py MUST use the same KEY_FILE path.
# They both default to /app/data/video.key, controlled by VIDEO_KEY_FILE env var.
if not os.path.exists(KEY_FILE):
    print(f"[DECRYPT] ⚠⚠⚠  WARNING: video.key NOT FOUND at '{KEY_FILE}'")
    print(f"[DECRYPT]          Set VIDEO_KEY_FILE env var to the correct path,")
    print(f"[DECRYPT]          or ensure it matches the path used by encrypt_service.py")
else:
    print(f"[DECRYPT] ✅ video.key found at '{KEY_FILE}'")

# Path to a small JSON file that persists the user-chosen recording directory.
# Stored alongside devices.json so it survives container restarts.
_CONFIG_FILE = os.environ.get(
    "RECORDING_CONFIG_FILE",
    "/app/data/recording_config.json"
)

# The container-side base mount point — D:\REC on the host maps here.
# Used to validate and sanitize Windows paths entered in the UI.
_CONTAINER_RECORDINGS_ROOT = os.environ.get("RECORDINGS_DIR", "/recordings")

# ------------------------------------------------------------------
# MongoDB
# ------------------------------------------------------------------
_client     = mongo_client
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME", "vms_db")
_db = _client[MONGO_DB_NAME] if _client else None
_collection = _db["recordings"] if _db is not None else None
storage_collection = _db["storage_settings"] if _db is not None else None
locations_collection = _db["storage_locations"] if _db is not None else None
schedules_collection = _db["schedules"] if _db is not None else None

# ------------------------------------------------------------------
# Windows → container path sanitization
# ------------------------------------------------------------------

def _sanitize_path(raw: str) -> str:
    """
    Normalize backslashes to forward slashes.
    Python natively handles forward slashes on Windows.
    """
    return raw.strip().replace("\\", "/")


# ------------------------------------------------------------------
# Recording path persistence helpers
# ------------------------------------------------------------------

def _load_persisted_recording_path() -> str | None:
    """Read the saved recording path from disk (if any)."""
    try:
        with open(_CONFIG_FILE) as f:
            data = json.load(f)
            saved = data.get("recording_path") or None
            if saved:
                # Re-sanitize on load in case an old bad value was stored
                sanitized = _sanitize_path(saved)
                if sanitized != saved:
                    print(f"[CONFIG] 🔧 Sanitizing stored path: {saved!r} → {sanitized!r}")
                return sanitized
            return None
    except Exception:
        return None


def _save_recording_path(path: str):
    """Persist the recording path to disk so it survives restarts."""
    try:
        os.makedirs(os.path.dirname(os.path.abspath(_CONFIG_FILE)), exist_ok=True)
        existing = {}
        try:
            with open(_CONFIG_FILE) as f:
                existing = json.load(f)
        except Exception:
            pass
        existing["recording_path"] = path
        with open(_CONFIG_FILE, "w") as f:
            json.dump(existing, f, indent=2)
        print(f"[CONFIG] 💾 Recording path persisted: {path}")
    except Exception as e:
        print(f"[CONFIG] ⚠ Could not persist recording path: {e}")


def _load_recording_path_from_db():
    try:
        doc = storage_collection.find_one({"type": "recording_path"})
        if doc:
            return doc.get("recording_path")
    except Exception as e:
        print("[CONFIG] DB load failed:", e)
    return None


def _apply_persisted_path_on_startup():

    # ✅ FIRST: try DB
    saved = _load_recording_path_from_db()

    # fallback to file
    if not saved:
        saved = _load_persisted_recording_path()

    if saved:
        print(f"[CONFIG] ▶ Loaded from DB: {saved}")
        recorder.set_recordings_dir(saved)
    else:
        default = recorder.get_recordings_dir()
        os.makedirs(default, exist_ok=True)
        print(f"[CONFIG] ▶ Using default path: {default}")


# Apply persisted path as soon as this module is imported
_apply_persisted_path_on_startup()

def _normalize_enc_path(path: str) -> str:
    if not path:
        return path
    normalized = path.replace("\\", "/")
    if not normalized.endswith(".enc"):
        if normalized.startswith("minio:"):
            from app.utils.minio_client import object_exists
            minio_key = normalized.replace("minio:", "")
            try:
                if object_exists(minio_key + ".enc"):
                    return normalized + ".enc"
            except:
                pass
        else:
            if os.path.exists(normalized + ".enc"):
                return normalized + ".enc"
    return normalized


# ------------------------------------------------------------------
# AES key + decrypt helpers
# ------------------------------------------------------------------

# MP4 magic bytes used to validate decryption produced a real video file.
# ftyp box: bytes 4-7 == b'ftyp'  OR  starts with moov/mdat/free box type.
_MP4_SIGNATURES = (
    b'ftypisom', b'ftypmp42', b'ftypMSNV', b'ftypM4V ', b'ftypM4A ',
    b'ftypf4v ', b'ftypf4p ', b'ftypavc1', b'ftypFACE', b'ftypdash',
    b'ftypiso2', b'ftypiso5', b'ftypiso6', b'ftypmp41', b'ftyp',
)

def _validate_mp4(data: bytes, label: str = "") -> None:
    """
    Raise ValueError if `data` does not look like an MP4 file.
    Checks the standard 'ftyp' box at bytes 4–8, which every valid
    MP4/MOV produced by ffmpeg will have.
    """
    if len(data) < 12:
        raise ValueError(f"[DECRYPT]{label} Output too small ({len(data)} bytes) — decryption key mismatch?")
    # The ftyp box is: [4-byte size][4-byte 'ftyp'][4-byte brand]
    # size is big-endian and usually 0x00000018 (24) or similar
    box_type = data[4:8]
    if box_type not in (b'ftyp', b'moov', b'mdat', b'free', b'skip', b'wide'):
        raise ValueError(
            f"[DECRYPT]{label} Output is not a valid MP4 "
            f"(bytes[4:8]={box_type!r}). Wrong decryption key?"
        )

def _load_key() -> bytes:
    """
    Load the AES-256 key from KEY_FILE.
    This MUST use the same file path as encrypt_service.py → load_video_key().
    Both default to /app/data/video.key — controlled by VIDEO_KEY_FILE env var.
    NO .strip() — binary keys are read verbatim; stripping corrupts keys whose
    last byte happens to be 0x0a/0x0d, producing a silent AES key mismatch.
    """
    if not os.path.exists(KEY_FILE):
        raise RuntimeError(
            f"video.key not found at {KEY_FILE}. "
            "Set VIDEO_KEY_FILE env var to match encrypt_service.py, "
            "or ensure /app/data/video.key exists."
        )
    with open(KEY_FILE, "rb") as f:
        key = f.read()          # ← NO .strip()
    if len(key) < 1:
        raise RuntimeError(f"video.key at {KEY_FILE} is empty!")
    result = key[:32].ljust(32, b'\0')
    print(f"[DECRYPT] 🔑 Using key from {KEY_FILE} ({len(key)} bytes raw)")
    return result

def decrypt_bytes(raw: bytes) -> io.BytesIO:
    """Decrypt AES-256 encrypted bytes and return a BytesIO of the plaintext."""
    if not raw or len(raw) <= 16:
        raise ValueError("Encrypted payload must be larger than 16 bytes")
    key        = _load_key()
    
    is_ctr = raw.startswith(b'CTR\x00')
    if is_ctr:
        iv = raw[4:20]
        ciphertext = raw[20:]
        cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        data = decryptor.update(ciphertext) + decryptor.finalize()
    else:
        iv         = raw[:16]
        ciphertext = raw[16:]
        
        # Resilient handling for truncated files (e.g. stopped mid-block or aborted transfers)
        extra = len(ciphertext) % 16
        if extra != 0:
            ciphertext = ciphertext[:-extra]

        cipher     = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        dec        = cipher.decryptor()
        padded     = dec.update(ciphertext) + dec.finalize()
        
        try:
            unpadder   = padding.PKCS7(128).unpadder()
            data       = unpadder.update(padded) + unpadder.finalize()
        except Exception:
            # Fall back to using raw decrypted bytes if padding is invalid (common on truncated files)
            data       = padded
            
    is_ts = len(data) > 0 and data[0] == 0x47
    if not is_ts:
        _validate_mp4(data)   # ← catch wrong-key silently-corrupt output early
    return io.BytesIO(data)



def _decrypt(file_path: str) -> io.BytesIO:
    """Decrypt a .enc file on disk or MinIO and return BytesIO of the MP4 payload."""
    is_minio = file_path.startswith("minio:")
    pass

    if is_minio:
        try:
            from app.utils.minio_client import minio_client, MINIO_BUCKET
            from minio.error import S3Error
            object_key = file_path.replace("minio:", "")
            try:
                response = minio_client.get_object(MINIO_BUCKET, object_key)
                raw = response.read()
                response.close()
                response.release_conn()
            except S3Error as err:
                if err.code in ("NoSuchKey", "NoSuchObject"):
                    raw_segments = []
                    idx = 0
                    while True:
                        try:
                            seg_key = f"{object_key.replace('.enc', '')}_{idx:03d}.enc"
                            res = minio_client.get_object(MINIO_BUCKET, seg_key)
                            raw_segments.append(res.read())
                            res.close()
                            res.release_conn()
                            idx += 1
                        except S3Error:
                            break
                    if not raw_segments:
                        raise RuntimeError(f"MinIO object and segments missing for {object_key}")
                    raw = b''.join(raw_segments)
                else:
                    raise err
        except Exception as e:
            raise RuntimeError(f"MinIO read failed: {e}")
    else:
        with open(file_path, "rb") as f:
            raw = f.read()
    try:
        return decrypt_bytes(raw)
    except Exception as e:
        raise RuntimeError(f"Failed to decrypt {file_path}: {e}") from e

def remux_ts_to_mp4(ts_data: bytes) -> bytes:
    """
    Synchronously remux MPEG-TS bytes to standard MP4 bytes using ffmpeg.
    Uses copy mode (-c copy) so it's extremely fast and light.
    """
    from app.utils.ffmpeg_utils import run_ffmpeg_sync
    if len(ts_data) > 0 and ts_data[0] == 0x47:
        try:
            cmd = [FFMPEG_BIN, "-y", "-loglevel", "quiet", "-i", "pipe:0", "-c", "copy", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1"]
            success, stdout_data, stderr_data = run_ffmpeg_sync(cmd, timeout=30, input_data=ts_data, capture_stdout=True)
            if success and len(stdout_data) > 0:
                return stdout_data
        except Exception as e:
            print(f"[REMUX] Remuxing failed: {e}")
    return ts_data

def convert_video_format(video_data: bytes, output_format: str, trim_start: float = None, trim_end: float = None) -> bytes:
    """
    Synchronously convert video bytes (MPEG-TS or MP4) to the desired output format ('mp4', 'avi', 'asf') using ffmpeg.
    Uses copy mode (-c copy) for speed and resource efficiency.
    Supports trimming the output.
    """
    from app.utils.ffmpeg_utils import run_ffmpeg_sync
    
    output_format = (output_format or "mp4").lower()
    if output_format not in ("mp4", "avi", "asf"):
        output_format = "mp4"
        
    # Detect if input is MPEG-TS
    is_ts = len(video_data) > 0 and video_data[0] == 0x47
    
    is_trimming = trim_start is not None or trim_end is not None
    
    if output_format == "mp4" and not is_ts and not is_trimming:
        # Already MP4 and requested MP4, and no trimming
        return video_data

    tmp_path = None
    if is_trimming:
        import tempfile
        import os
        fd, tmp_path = tempfile.mkstemp(suffix=".ts" if is_ts else ".mp4")
        with os.fdopen(fd, 'wb') as f:
            f.write(video_data)
        cmd = [FFMPEG_BIN, "-y", "-loglevel", "quiet"]
        if trim_start is not None:
            cmd.extend(["-ss", str(trim_start)])
        cmd.extend(["-i", tmp_path])
        if trim_end is not None:
            duration = float(trim_end) - (float(trim_start) if trim_start else 0.0)
            if duration > 0:
                cmd.extend(["-t", str(duration)])
        # Frame-accurate cut with fast re-encoding
        cmd.extend(["-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac"])
    else:
        cmd = [FFMPEG_BIN, "-y", "-loglevel", "quiet", "-i", "pipe:0", "-c", "copy"]

    if output_format == "mp4":
        cmd.extend(["-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1"])
    elif output_format == "avi":
        cmd.extend(["-f", "avi", "pipe:1"])
    elif output_format == "asf":
        cmd.extend(["-f", "asf", "pipe:1"])

    try:
        success, stdout_data, stderr_data = run_ffmpeg_sync(cmd, timeout=60, input_data=None if is_trimming else video_data, capture_stdout=True)
        if success and len(stdout_data) > 0:
            return stdout_data
        else:
            print(f"[CONVERSION] FFmpeg failed or produced empty output for format {output_format}. Stderr: {stderr_data.decode(errors='replace')}")
    except Exception as e:
        print(f"[CONVERSION] Exception during format conversion to {output_format}: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except:
                pass
        
    return video_data


def decrypt_stream(file_path: str):
    """
    Generator that decrypts an .enc file in chunks.
    Allows browsers to start playing immediately as data arrives.
    """
    if not os.path.exists(file_path):
        return

    key = _load_key()
    with open(file_path, "rb") as f:
        header = f.read(4)
        is_ctr = header == b'CTR\x00'
        
        if is_ctr:
            iv = f.read(16)
            cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
        else:
            f.seek(0)
            iv = f.read(16)
            if not iv or len(iv) < 16:
                return
            cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
            
        dec = cipher.decryptor()
        
        while True:
            chunk = f.read(128 * 1024) # 128KB chunks
            if not chunk:
                break
            yield dec.update(chunk)
        
        try:
            yield dec.finalize()
        except:
            pass

def _decrypt_bytes(encrypted_bytes: bytes) -> io.BytesIO:
    """Decrypt raw encrypted bytes (from an uploaded file) and return BytesIO."""
    try:
        key = _load_key()
    except Exception as e:
        print(f"[DECRYPT] Key load failed: {e}")
        raise HTTPException(status_code=500, detail="Encryption key (video.key) not found on server.")

    if len(encrypted_bytes) < 16:
        raise HTTPException(status_code=400, detail="Invalid encrypted file (too small).")

    try:
        is_ctr = encrypted_bytes.startswith(b'CTR\x00')
        if is_ctr:
            iv = encrypted_bytes[4:20]
            ciphertext = encrypted_bytes[20:]
            cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
            dec = cipher.decryptor()
            data = dec.update(ciphertext) + dec.finalize()
        else:
            iv         = encrypted_bytes[:16]
            ciphertext = encrypted_bytes[16:]
            cipher     = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
            dec        = cipher.decryptor()
            padded     = dec.update(ciphertext) + dec.finalize()
            unpadder   = padding.PKCS7(128).unpadder()
            data       = unpadder.update(padded) + unpadder.finalize()
            
        _validate_mp4(data)   # ← catch wrong-key silently-corrupt output early
        return io.BytesIO(data)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[DECRYPT] Decryption failed: {e}")
        raise HTTPException(status_code=400, detail=f"Decryption failed: {e}. Check if video.key matches.")

# ------------------------------------------------------------------
# Shared CORS headers
# ------------------------------------------------------------------
_CORS_HEADERS = {
    "Access-Control-Expose-Headers": "Content-Length, Content-Type, Accept-Ranges, Content-Disposition",
    "Vary":                          "Origin",
    "Cache-Control":                 "no-store",
}

# ------------------------------------------------------------------
# Routers
# ------------------------------------------------------------------
recording_router = APIRouter(prefix="/api/recordings", tags=["recordings"], dependencies=[Depends(verify_token)])
storage_router   = APIRouter(prefix="/api/storage",    tags=["storage"], dependencies=[Depends(verify_token)])

class ExportZipRequest(BaseModel):
    camera_id:  str
    start_date: str
    end_date:   str
    start_time: str = "00:00"
    end_time:   str = "23:59"
    format:     str = "mp4"

class ExportDeviceRequest(BaseModel):
    camera_id:        str
    start_date:       str
    end_date:         str
    start_time:       str = "00:00"
    end_time:         str = "23:59"
    format:           str = "mp4"
    destination_path: str = ""

class StorageApplyRequest(BaseModel):
    location:       str | None = None
    folder:         str | None = None
    allocated:      int | None = None
    recording_path: str | None = None

class StorageLocation(BaseModel):
    display_path:   str
    container_path: str
    allocated:      int = 100

class Schedule(BaseModel):
    id:         str | int
    name:       str
    week:       dict[str, list[bool]]
    ranges:     dict[str, str] = {} # Human-readable strings for Compass
    exceptions: list[str] = [] # ISO dates

class AssignScheduleRequest(BaseModel):
    camera_id:   str
    schedule_id: str | int | None
    motion_only: bool = False

def _doc_to_dict(doc: dict) -> dict:
    doc.pop("_id", None)
    if "created_at" in doc and hasattr(doc["created_at"], "isoformat"):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc

# ==================================================================
# STORAGE ROUTES
# ==================================================================

@storage_router.get("/management")
def get_storage_management():
    """
    Return real disk usage info for the current recording directory.
    Always returns the live recording path from the recorder (which includes
    any persisted override), so the UI shows the correct path after restart.
    """
    rec_dir = recorder.get_recordings_dir()

    try:
        usage    = shutil.disk_usage(rec_dir if os.path.exists(rec_dir) else "/")
        total_gb = round(usage.total / (1024 ** 3), 1)
        used_gb  = round(usage.used  / (1024 ** 3), 1)
        free_gb  = round(usage.free  / (1024 ** 3), 1)
    except Exception:
        total_gb, used_gb, free_gb = 0, 0, 0

    # Show the Windows-friendly display path in the UI
    display_path = _container_to_display_path(rec_dir)

    # Return all persisted locations
    all_locs = list(locations_collection.find({"is_deleted": {"$ne": True}}))
    if not all_locs:
        # Fallback to current if none persisted
        return [{
            "location":      display_path,
            "container_path": rec_dir,
            "type":          "Local Disk",
            "total":         total_gb,
            "used":          used_gb,
            "free":          free_gb,
            "allocated":     round(total_gb * 0.9),
            "status":        "Recording" if recorder._recorders else "OK",
            "server":        "MIRADOR",
        }]

    results = []
    for loc in all_locs:
        c_path = loc["container_path"]
        try:
            u    = shutil.disk_usage(c_path if os.path.exists(c_path) else "/")
            t_gb = round(u.total / (1024 ** 3), 1)
            u_gb = round(u.used  / (1024 ** 3), 1)
            f_gb = round(u.free  / (1024 ** 3), 1)
        except:
            t_gb, u_gb, f_gb = 0, 0, 0
        
        results.append({
            "location":       loc["display_path"],
            "container_path": c_path,
            "type":           "Local Disk",
            "total":          t_gb,
            "used":           u_gb,
            "free":           f_gb,
            "allocated":      loc.get("allocated", 100),
            "status":         "Recording" if c_path == rec_dir else "OK",
            "server":         "MIRADOR",
        })
    return results

@storage_router.post("/locations")
def add_storage_location(loc: StorageLocation):
    sanitized = _sanitize_path(loc.container_path)
    locations_collection.update_one(
        {"container_path": sanitized},
        {"$set": {
            "display_path": loc.display_path,
            "container_path": sanitized,
            "allocated": loc.allocated,
            "updated_at": datetime.utcnow()
        }},
        upsert=True
    )
    return {"message": "Location added"}

@storage_router.delete("/locations")
def remove_storage_location(container_path: str = Query(...)):
    locations_collection.update_one({"container_path": container_path}, {"$set": {"is_deleted": True}})
    return {"message": "Location removed"}


def _container_to_display_path(container_path: str) -> str:
    """
    Convert forward slashes to backslashes for native Windows UI display.
    """
    return container_path.replace("/", "\\")


@storage_router.post("/apply")
def apply_storage_settings(req: StorageApplyRequest):

    raw_path = req.recording_path or req.folder or req.location

    if not raw_path:
        raise HTTPException(status_code=400, detail="No path provided")

    # ✅ Convert Windows → container path
    sanitized = _sanitize_path(raw_path)

    # ✅ Apply to recorder (THIS IS MAIN)
    recorder.set_recordings_dir(sanitized)

    # ✅ SAVE TO MONGODB (NEW)
    storage_collection.update_one(
        {"type": "recording_path"},
        {
            "$set": {
                "recording_path": sanitized,
                "updated_at": datetime.utcnow()
            }
        },
        upsert=True
    )

    # ✅ Optional (keep your existing file backup)
    _save_recording_path(sanitized)

    # ✅ Ensure it is in locations_collection
    display_path = _container_to_display_path(sanitized)
    locations_collection.update_one(
        {"container_path": sanitized},
        {"$set": {
            "display_path": display_path,
            "container_path": sanitized,
            "allocated": req.allocated or 100,
            "updated_at": datetime.utcnow()
        }},
        upsert=True
    )

    # ✅ Restart worker pool so new shard paths apply dynamically
    try:
        stop_worker_pool()
        print("[API] ♻️ Triggered worker pool restart for new storage path")
    except Exception as e:
        print(f"[API] ⚠️ Failed to restart worker pool: {e}")

    return {
        "message": "Recording path updated successfully",
        "recording_path": sanitized,
        "display_path": display_path
    }


@storage_router.post("/collect-nonindexed")
def collect_nonindexed():
    """
    Move files in the recording dir that are not referenced in MongoDB
    into a 'Non-indexed Files' subfolder.
    """
    rec_dir     = recorder.get_recordings_dir()
    non_idx_dir = os.path.join(rec_dir, "Non-indexed Files")
    os.makedirs(non_idx_dir, exist_ok=True)

    moved  = 0
    errors = []

    for root, dirs, files in os.walk(rec_dir):
        if os.path.abspath(root).startswith(os.path.abspath(non_idx_dir)):
            continue
        for fname in files:
            if not fname.endswith(".mp4"):
                continue
            fpath = os.path.join(root, fname)
            in_db = _collection.find_one({"file_path": fpath})
            if not in_db:
                try:
                    dest = os.path.join(non_idx_dir, fname)
                    if os.path.exists(dest):
                        base, ext = os.path.splitext(fname)
                        dest = os.path.join(non_idx_dir, f"{base}_{moved}{ext}")
                    shutil.move(fpath, dest)
                    moved += 1
                except Exception as e:
                    errors.append(str(e))

    return {
        "ok":     True,
        "moved":  moved,
        "errors": errors,
        "folder": non_idx_dir,
    }


# ==================================================================
# SCHEDULE ROUTES
# ==================================================================

@storage_router.get("/schedules")
def list_schedules():
    docs = list(schedules_collection.find({"is_deleted": {"$ne": True}}))
    for d in docs:
        d["id"] = str(d.get("id", d["_id"]))
        d.pop("_id", None)
    return docs

@storage_router.post("/schedules")
def save_schedule(sch: Schedule):
    data = sch.dict()
    # Force ID to string for consistency in DB
    sch_id = str(data["id"])
    data["id"] = sch_id 
    
    schedules_collection.update_one(
        {"id": sch_id},
        {"$set": data},
        upsert=True
    )
    return {"message": "Schedule saved", "id": sch_id}

@storage_router.delete("/schedules/{sch_id}")
def delete_schedule(sch_id: str):
    # Try to delete by both string and numeric ID for legacy support
    try:
        numeric_id = int(sch_id)
        schedules_collection.update_many({"id": {"$in": [str(sch_id), numeric_id]}}, {"$set": {"is_deleted": True}})
    except (ValueError, TypeError):
        schedules_collection.update_one({"id": str(sch_id)}, {"$set": {"is_deleted": True}})
    
    # Also, find any cameras assigned to this schedule and reset them to 'always'
    _db["cameras"].update_many(
        {"assigned_schedule_id": sch_id},
        {"$set": {"assigned_schedule_id": "always"}}
    )
    # Re-sync with recorder
    for cam in _db["cameras"].find({"assigned_schedule_id": "always"}):
        recorder.update_camera_data(cam["stream_key"], {"assigned_schedule_id": "always"})

    return {"message": "Schedule deleted and assignments reset"}

@recording_router.post("/assign-schedule")
def assign_schedule(req: AssignScheduleRequest):
    # Update camera in 'cameras' collection
    _db["cameras"].update_one(
        {"stream_key": req.camera_id},
        {"$set": {
            "assigned_schedule_id": req.schedule_id,
            "motion_only": req.motion_only
        }}
    )
    # Also update in recorder if active
    recorder.update_camera_data(req.camera_id, {
        "assigned_schedule_id": req.schedule_id,
        "motion_only": req.motion_only
    })
    
    # Sync motion detector manager immediately
    try:
        from app.services.ai import motion_detector
        motion_detector.manager.trigger_sync()
    except Exception as e:
        print(f"[API] Error triggering motion detector sync: {e}")
        
    # Sync main app devices list
    try:
        import main
        main.devices = main.load_devices()
    except Exception as e:
        print(f"[API] Error reloading devices in main: {e}")
        
    return {"message": "Schedule assigned to camera"}


# ==================================================================
# RECORDING GET ROUTES
# ==================================================================

@recording_router.get("/")
def list_recordings(
    camera_id: str = Query(None),
    date:      str = Query(None),
    limit:     int = Query(100, le=500),
):
    query = {}
    if camera_id:
        query["camera_id"] = camera_id
    if date:
        query["date"] = date
    # Only return .enc files, not .meta or .mp4
    query["file_path"] = {"$regex": "\\.enc$"}
    query["is_deleted"] = {"$ne": True}
    docs = list(_collection.find(query).sort("created_at", -1))
    return [_doc_to_dict(d) for d in docs]

@recording_router.get("/cameras")
def list_recordings_cameras():
    """
    Return the names of folders (camera IPs/IDs) found in storage or database
    that are inside the active parent folder.
    Returns only the canonical underscore format (e.g. 192_168_126_235).
    The frontend normalizes these for display.
    """
    results = set()
    from app.utils.minio_client import get_parent_folder
    import re
    
    parent = get_parent_folder()
    
    # 1. Add cameras that have completed recordings in MongoDB under the parent folder
    try:
        query = {}
        if parent:
            escaped_parent = re.escape(parent)
            query["file_path"] = {"$regex": f"^minio:{escaped_parent}/"}
        
        db_cams = _collection.distinct("camera_id", query)
        from app.utils.minio_client import minio_client, MINIO_BUCKET
        for cam in db_cams:
             # Dynamic check: verify camera actually exists in MinIO
            doc = _collection.find_one({"camera_id": cam, "file_path": {"$regex": f"^minio:{escaped_parent}/"}})
            if doc and "file_path" in doc and minio_client:
                path_parts = doc["file_path"].replace("minio:", "", 1).split("/")
                if len(path_parts) >= 3:
                    cam_prefix = "/".join(path_parts[:3]) + "/"
                    try:
                        objects = minio_client.list_objects(MINIO_BUCKET, prefix=cam_prefix, recursive=True)
                        if any(True for _ in objects):
                            results.add(cam)
                        else:
                            # Cleanup stale DB records since folder was manually deleted
                            _collection.delete_many({"camera_id": cam, "file_path": {"$regex": f"^minio:{escaped_parent}/"}})
                    except Exception:
                        results.add(cam)
                else:
                    results.add(cam)
            else:
                results.add(cam)
    except Exception as e:
        print(f"[API] Error fetching distinct cameras from recordings: {e}")

    # 2. Also support scanning local filesystem path for the active parent folder
    try:
        rec_dir = recorder.get_recordings_dir()
        if os.path.exists(rec_dir):
            for entry in os.listdir(rec_dir):
                full_path = os.path.join(rec_dir, entry)
                if os.path.isdir(full_path):
                    if entry.startswith("shard"):
                        try:
                            for sub_entry in os.listdir(full_path):
                                sub_full_path = os.path.join(full_path, sub_entry)
                                if os.path.isdir(sub_full_path):
                                    if sub_entry not in ("Non-indexed Files", "lost+found", "Config"):
                                        results.add(sub_entry)
                        except:
                            pass
                    elif entry not in ("Non-indexed Files", "lost+found", "Config"):
                        results.add(entry)
    except Exception as e:
        print(f"[API] Error scanning local directory for cameras: {e}")

    return sorted(list(results))



@recording_router.get("/status")
def recorder_status():
    import time
    from datetime import datetime, timedelta
    
    active_set = set()
    
    # 1. Aggregate from worker heartbeats (active in the last 30 seconds)
    try:
        if _db is not None:
            cutoff = datetime.utcnow() - timedelta(seconds=30)
            active_workers = _db["worker_heartbeats"].find({"last_seen": {"$gte": cutoff}})
            for worker in active_workers:
                worker_active = worker.get("active_recorders", [])
                if isinstance(worker_active, list):
                    for stream in worker_active:
                        active_set.add(stream)
    except Exception as e:
        print(f"[API] Error aggregating active recorders from worker heartbeats: {e}")

    # 2. Legacy fallback: check system_status collection
    try:
        if _db is not None:
            status_doc = _db["system_status"].find_one({"type": "recorder_status"})
            if status_doc and (time.time() - status_doc.get("timestamp", 0) < 15):
                for stream in status_doc.get("active_recorders", []):
                    active_set.add(stream)
    except Exception:
        pass

    # 3. Fallback: check in-memory recorders of the current process
    try:
        in_memory_active = [
            name
            for name, thread in recorder._recorders.items()
            if thread.is_alive() and name in getattr(recorder, '_actively_recording_streams', set())
        ]
        for stream in in_memory_active:
            active_set.add(stream)
    except Exception:
        pass

    active = sorted(list(active_set))
    rec_dir = recorder.get_recordings_dir()
    return {
        "active_recorders": active,
        "count":            len(active),
        "recording_path":   rec_dir,
        "display_path":     _container_to_display_path(rec_dir),
    }

def _parse_range_header(range_header: str, file_size: int):
    if not range_header or not range_header.startswith("bytes="):
        return 0, max(0, file_size - 1)
    
    try:
        ranges = range_header.replace("bytes=", "").split("-")
        start_str = ranges[0].strip() if len(ranges) > 0 else ""
        end_str = ranges[1].strip() if len(ranges) > 1 else ""
        
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        
        start = max(0, start)
        end = min(file_size - 1, end)
        return start, end
    except Exception:
        return 0, max(0, file_size - 1)

@recording_router.get("/play")
def play_recording(
    request: Request,
    background_tasks: BackgroundTasks,
    camera_id:  str = Query(...),
    date:       str = Query(...),
    start_time: str = Query(...),
    _cb:        str = Query(None),
):
    doc = _collection.find_one({
        "camera_id":  camera_id,
        "date":       date,
        "start_time": start_time,
    })
    if not doc:
        raise HTTPException(status_code=404, detail="Recording not found in database")

    enc_path = _normalize_enc_path(doc.get("file_path", ""))
    is_minio = enc_path.startswith("minio:")
    object_key = enc_path.replace("minio:", "") if is_minio else None

    if not is_minio and not os.path.exists(enc_path):
        raise HTTPException(status_code=404, detail=f"Encrypted file missing: {enc_path}")

    # Check for empty/corrupted legacy files
    file_size_on_disk = doc.get("file_size", 0) if is_minio else os.path.getsize(enc_path)
    if file_size_on_disk < 100:
        raise HTTPException(status_code=415, detail="Recording is empty or corrupted")


    try:
        key = _load_key()
        
        # Determine if it's CTR or CBC
        if is_minio:
            from app.utils.minio_client import minio_client, MINIO_BUCKET
            from minio.error import S3Error
            try:
                response = minio_client.get_object(MINIO_BUCKET, object_key, offset=0, length=4)
                header = response.read(4)
                response.close()
                response.release_conn()
            except S3Error as e:
                if e.code in ("NoSuchKey", "NoSuchObject"):
                    seg0 = f"{object_key.replace('.enc', '')}_000.enc"
                    response = minio_client.get_object(MINIO_BUCKET, seg0, offset=0, length=4)
                    header = response.read(4)
                    response.close()
                    response.release_conn()
                    object_key = seg0  # use seg0 for the IV read below
                else:
                    raise HTTPException(status_code=404, detail=f"MinIO file missing: {e}")
        else:
            with open(enc_path, "rb") as f:
                header = f.read(4)
                
        is_ctr = header == b'CTR\x00'
            
        if is_ctr:
            # Check if it is MPEG-TS (starts with 0x47 in first decrypted block)
            if is_minio:
                from app.utils.minio_client import minio_client, MINIO_BUCKET
                response = minio_client.get_object(MINIO_BUCKET, object_key, offset=4, length=32)
                iv = response.read(16)
                first_block = response.read(16)
                response.close()
                response.release_conn()
            else:
                with open(enc_path, "rb") as f:
                    f.seek(4)
                    iv = f.read(16)
                    f.seek(20)
                    first_block = f.read(16)
                
            is_ts = False
            if len(first_block) > 0:
                cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
                decryptor = cipher.decryptor()
                decrypted_block = decryptor.update(first_block) + decryptor.finalize()
                is_ts = len(decrypted_block) > 0 and decrypted_block[0] == 0x47
                
            if is_ts:
                # Dynamic TS -> MP4 remuxing to temporary file
                decrypted_stream = _decrypt(enc_path)
                ts_data = decrypted_stream.getvalue()
                
                temp_mp4 = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
                temp_mp4_path = temp_mp4.name
                temp_mp4.close()
                
                try:
                    from app.utils.ffmpeg_utils import run_ffmpeg_sync
                    cmd = [FFMPEG_BIN, "-y", "-loglevel", "quiet", "-i", "pipe:0", "-c", "copy", "-movflags", "+faststart", "-f", "mp4", temp_mp4_path]
                    success, _, stderr = run_ffmpeg_sync(cmd, timeout=30, input_data=ts_data)
                    if not success:
                        raise Exception(stderr.decode(errors='replace'))
                except Exception as remux_err:
                    print(f"[PLAY] Error remuxing TS to MP4: {remux_err}")
                    if os.path.exists(temp_mp4_path):
                        os.unlink(temp_mp4_path)
                    raise HTTPException(status_code=415, detail=f"Failed to remux TS segment: {remux_err}")
                
                background_tasks.add_task(os.unlink, temp_mp4_path)
                
                headers = {
                    "Cache-Control": "no-store",
                    **_CORS_HEADERS
                }
                return FileResponse(temp_mp4_path, media_type="video/mp4", headers=headers)

            # For standard MP4 CTR files, serve them dynamically without reading the whole file!
            real_file_size = file_size_on_disk - 20 
            
            range_header = request.headers.get("range")
            start_byte, end_byte = _parse_range_header(range_header, real_file_size)
            chunk_size = end_byte - start_byte + 1
            
            def stream_ctr():
                if is_minio:
                    from app.utils.minio_client import minio_client, MINIO_BUCKET
                    response_iv = minio_client.get_object(MINIO_BUCKET, object_key, offset=4, length=16)
                    iv = response_iv.read(16)
                    response_iv.close()
                    response_iv.release_conn()

                    block_index = start_byte // 16
                    new_iv_int = int.from_bytes(iv, 'big') + block_index
                    new_iv = new_iv_int.to_bytes(16, 'big')
                    cipher = Cipher(algorithms.AES(key), modes.CTR(new_iv), backend=default_backend())
                    decryptor = cipher.decryptor()

                    offset_in_block = start_byte % 16
                    actual_start = 20 + start_byte - offset_in_block
                    bytes_to_read = chunk_size + offset_in_block
                    
                    response_data = minio_client.get_object(MINIO_BUCKET, object_key, offset=actual_start, length=bytes_to_read)
                    if offset_in_block != 0:
                        discard_chunk = response_data.read(offset_in_block)
                        decryptor.update(discard_chunk)

                    bytes_remaining = chunk_size
                    while bytes_remaining > 0:
                        to_read = min(128 * 1024, bytes_remaining)
                        chunk = response_data.read(to_read)
                        if not chunk:
                            break
                        yield decryptor.update(chunk)
                        bytes_remaining -= len(chunk)

                    response_data.close()
                    response_data.release_conn()
                else:
                    with open(enc_path, "rb") as f:
                        f.seek(4)
                        iv = f.read(16)
                        # For AES-CTR, calculate new IV based on block offset
                        block_index = start_byte // 16
                        new_iv_int = int.from_bytes(iv, 'big') + block_index
                        new_iv = new_iv_int.to_bytes(16, 'big')
                        cipher = Cipher(algorithms.AES(key), modes.CTR(new_iv), backend=default_backend())
                        decryptor = cipher.decryptor()
                        
                        # Read the partial block if start_byte is not aligned
                        offset_in_block = start_byte % 16
                        if offset_in_block != 0:
                            f.seek(20 + start_byte - offset_in_block)
                            discard_chunk = f.read(offset_in_block)
                            decryptor.update(discard_chunk) # push cipher state forward
                            
                        # Seek to actual start byte
                        f.seek(20 + start_byte)
                        bytes_remaining = chunk_size
                        while bytes_remaining > 0:
                            to_read = min(128 * 1024, bytes_remaining)
                            chunk = f.read(to_read)
                            if not chunk:
                                break
                            yield decryptor.update(chunk)
                            bytes_remaining -= len(chunk)
            
            headers = {
                "Content-Range": f"bytes {start_byte}-{end_byte}/{real_file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": "video/mp4",
                "Cache-Control": "no-store",
                **_CORS_HEADERS
            }
            status_code = 206 if range_header else 200
            return StreamingResponse(stream_ctr(), status_code=status_code, headers=headers)
            
        else:
            # Fallback for CBC: Decrypt the whole file into memory first, then slice
            try:
                stream = _decrypt(enc_path)
            except RuntimeError as e:
                raise HTTPException(status_code=415, detail=str(e))
            data = stream.getvalue()
            real_file_size = len(data)
            
            range_header = request.headers.get("range")
            start_byte, end_byte = _parse_range_header(range_header, real_file_size)
            chunk_size = end_byte - start_byte + 1
            
            headers = {
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": "video/mp4",
                "Cache-Control": "no-store",
                **_CORS_HEADERS
            }
            if range_header:
                headers["Content-Range"] = f"bytes {start_byte}-{end_byte}/{real_file_size}"
            status_code = 206 if range_header else 200
            return Response(
                content=data[start_byte:end_byte + 1],
                status_code=status_code,
                headers=headers
            )
            
    except HTTPException:
        # Re-raise FastAPI HTTP exceptions as-is (e.g. 404 from MinIO check)
        raise
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[PLAY] ❌ {enc_path}: {e}\n{tb}")
        try:
            rec_dir = recorder.get_recordings_dir()
            if os.path.exists(rec_dir):
                log_path = os.path.join(rec_dir, "error_log.txt")
                with open(log_path, "w") as f:
                    f.write(tb)
        except Exception as log_err:
            print(f"[PLAY] Failed to write error log: {log_err}")
        raise HTTPException(status_code=500, detail=f"Decryption failed: {e}")

@recording_router.get("/download")
def download_recording(
    camera_id:  str = Query(...),
    date:       str = Query(...),
    start_time: str = Query(...),
    format:     str = Query("mp4"),
    trim_start: float = Query(None),
    trim_end:   float = Query(None),
    filename:   str = Query(None),
    background_tasks: BackgroundTasks = None,
):
    format = format.lower()
    if format not in ("mp4", "avi", "asf"):
        raise HTTPException(status_code=400, detail="Invalid format. Supported formats: mp4, avi, asf")

    doc = _collection.find_one({
        "camera_id":  camera_id,
        "date":       date,
        "start_time": start_time,
    })
    if not doc:
        raise HTTPException(status_code=404, detail="Recording not found in database")

    enc_path = _normalize_enc_path(doc.get("file_path", ""))
    is_minio = enc_path.startswith("minio:")
    
    if not is_minio and not os.path.exists(enc_path):
        raise HTTPException(status_code=404, detail=f"Encrypted file missing: {enc_path}")

    try:
        stream = _decrypt(enc_path)
        data   = stream.getvalue()
        data   = convert_video_format(data, format, trim_start=trim_start, trim_end=trim_end)
    except Exception as e:
        print(f"[DOWNLOAD] ❌ {enc_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Decryption failed: {e}")

    if not data:
        raise HTTPException(status_code=500, detail="Decryption produced empty output — key mismatch?")

    # Sanitize filename: replace colons/slashes that break VLC on Windows
    if filename:
        # User provided filename, sanitize it slightly
        base_filename = re.sub(r'[^\w\-.]', '_', filename)
        if base_filename.endswith(f".{format}"):
            base_filename = base_filename[:-len(f".{format}")]
    else:
        safe_time = start_time.replace(":", "-").replace("/", "-")
        safe_date = date.replace("/", "-")
        safe_cam  = re.sub(r'[^\w\-.]', '_', camera_id)
        base_filename  = f"{safe_cam}_{safe_date}_{safe_time}"
        
    out_filename  = f"{base_filename}.{format}"
    sig_filename = f"{base_filename}.sig"

    try:
        signature = signature_service.sign_data(data)
        public_key = signature_service.get_public_key_pem()
        
        temp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        zip_path = temp_zip.name
        temp_zip.close()
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as zf:
            zf.writestr(out_filename, data)
            zf.writestr(sig_filename, signature)
            zf.writestr("public_key.pem", public_key)
            
        if background_tasks:
            background_tasks.add_task(os.unlink, zip_path)
            
        return FileResponse(
            path=zip_path,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename=\"{base_filename}.zip\"",
                "Cache-Control":       "no-store",
                **_CORS_HEADERS,
            }
        )
    except Exception as e:
        print(f"[DOWNLOAD] Zip creation failed: {e}")
        if 'zip_path' in locals() and os.path.exists(zip_path):
            os.unlink(zip_path)
        raise HTTPException(status_code=500, detail=f"Failed to create secure zip: {e}")

@recording_router.post("/upload-temp")
async def upload_temp(file: UploadFile = File(...)):
    try:
        import uuid
        temp_id = str(uuid.uuid4())
        temp_dir = tempfile.gettempdir()
        temp_path = os.path.join(temp_dir, f"upload_{temp_id}.enc")
        with open(temp_path, "wb") as f:
            f.write(await file.read())
        return {"temp_id": temp_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload temporary file: {e}")


@recording_router.get("/play-uploaded")
def play_uploaded(
    request: Request,
    background_tasks: BackgroundTasks,
    temp_id: str = Query(...),
    _cb: str = Query(None),
):
    import re
    if not re.match(r'^[a-zA-Z0-9\-]+$', temp_id):
        raise HTTPException(status_code=400, detail="Invalid temp_id format")

    temp_dir = tempfile.gettempdir()
    enc_path = os.path.join(temp_dir, f"upload_{temp_id}.enc")
    if not os.path.exists(enc_path):
        raise HTTPException(status_code=404, detail="Uploaded file not found or expired")

    file_size_on_disk = os.path.getsize(enc_path)
    if file_size_on_disk < 100:
        raise HTTPException(status_code=415, detail="Recording is empty or corrupted")

    try:
        key = _load_key()
        
        with open(enc_path, "rb") as f:
            header = f.read(4)
        is_ctr = header == b'CTR\x00'

        if is_ctr:
            with open(enc_path, "rb") as f:
                f.seek(4)
                iv = f.read(16)
                f.seek(20)
                first_block = f.read(16)
            
            is_ts = False
            if len(first_block) > 0:
                cipher = Cipher(algorithms.AES(key), modes.CTR(iv), backend=default_backend())
                decryptor = cipher.decryptor()
                decrypted_block = decryptor.update(first_block) + decryptor.finalize()
                is_ts = len(decrypted_block) > 0 and decrypted_block[0] == 0x47

            if is_ts:
                decrypted_stream = _decrypt(enc_path)
                ts_data = decrypted_stream.getvalue()
                
                temp_mp4 = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
                temp_mp4_path = temp_mp4.name
                temp_mp4.close()
                
                try:
                    from app.utils.ffmpeg_utils import run_ffmpeg_sync
                    cmd = [FFMPEG_BIN, "-y", "-loglevel", "quiet", "-i", "pipe:0", "-c", "copy", "-movflags", "+faststart", "-f", "mp4", temp_mp4_path]
                    success, _, stderr = run_ffmpeg_sync(cmd, timeout=30, input_data=ts_data)
                    if not success:
                        raise Exception(stderr.decode(errors='replace'))
                except Exception as remux_err:
                    print(f"[PLAY-UPLOADED] Error remuxing TS to MP4: {remux_err}")
                    if os.path.exists(temp_mp4_path):
                        os.unlink(temp_mp4_path)
                    raise HTTPException(status_code=415, detail=f"Failed to remux TS segment: {remux_err}")
                
                background_tasks.add_task(os.unlink, temp_mp4_path)
                
                headers = {
                    "Cache-Control": "no-store",
                    **_CORS_HEADERS
                }
                return FileResponse(temp_mp4_path, media_type="video/mp4", headers=headers)

            real_file_size = file_size_on_disk - 20
            range_header = request.headers.get("range")
            start_byte, end_byte = _parse_range_header(range_header, real_file_size)
            chunk_size = end_byte - start_byte + 1

            def stream_ctr():
                with open(enc_path, "rb") as f:
                    f.seek(4)
                    iv = f.read(16)
                    block_index = start_byte // 16
                    new_iv_int = int.from_bytes(iv, 'big') + block_index
                    new_iv = new_iv_int.to_bytes(16, 'big')
                    cipher = Cipher(algorithms.AES(key), modes.CTR(new_iv), backend=default_backend())
                    decryptor = cipher.decryptor()

                    offset_in_block = start_byte % 16
                    if offset_in_block != 0:
                        f.seek(20 + start_byte - offset_in_block)
                        discard_chunk = f.read(offset_in_block)
                        decryptor.update(discard_chunk)

                    f.seek(20 + start_byte)
                    bytes_remaining = chunk_size
                    while bytes_remaining > 0:
                        to_read = min(128 * 1024, bytes_remaining)
                        chunk = f.read(to_read)
                        if not chunk:
                            break
                        yield decryptor.update(chunk)
                        bytes_remaining -= len(chunk)

            headers = {
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": "video/mp4",
                "Cache-Control": "no-store",
                **_CORS_HEADERS
            }
            if range_header:
                headers["Content-Range"] = f"bytes {start_byte}-{end_byte}/{real_file_size}"
                
            status_code = 206 if range_header else 200
            return StreamingResponse(stream_ctr(), status_code=status_code, headers=headers)

        else:
            try:
                stream = _decrypt(enc_path)
            except RuntimeError as e:
                raise HTTPException(status_code=415, detail=str(e))
            data = stream.getvalue()
            real_file_size = len(data)

            range_header = request.headers.get("range")
            start_byte, end_byte = _parse_range_header(range_header, real_file_size)
            chunk_size = end_byte - start_byte + 1

            headers = {
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": "video/mp4",
                "Cache-Control": "no-store",
                **_CORS_HEADERS
            }
            if range_header:
                headers["Content-Range"] = f"bytes {start_byte}-{end_byte}/{real_file_size}"
                
            status_code = 206 if range_header else 200
            return Response(
                content=data[start_byte:end_byte + 1],
                status_code=status_code,
                headers=headers
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Playback failed: {e}")


@recording_router.get("/{camera_id_or_path}")
def list_camera_recordings(camera_id_or_path: str, date: str = Query(None)):
    # Try as camera_id first
    query = {"camera_id": camera_id_or_path}
    if date:
        query["date"] = date
    query["is_deleted"] = {"$ne": True}
    docs = list(_collection.find(query).sort("created_at", -1))
    
    if not docs:
        # Try as a storage path / folder name
        try:
            loc = locations_collection.find_one({"display_path": camera_id_or_path})
            c_path = loc["container_path"] if loc else camera_id_or_path
            
            safe_name = re.escape(c_path.replace("\\", "/"))
            query = {
                "$and": [
                    {"file_path": {"$regex": f"/{safe_name}/|^{safe_name}/"}},
                    {"file_path": {"$regex": "\\.enc$"}}
                ]
            }
            if date:
                query["date"] = date
            query["is_deleted"] = {"$ne": True}
            docs = list(_collection.find(query).sort("created_at", -1))
        except Exception as e:
            print(f"[RECORDINGS] Fallback query failed for '{camera_id_or_path}': {e}")
            docs = []

    return [_doc_to_dict(d) for d in docs]

# ==================================================================
# RECORDING POST ROUTES
# ==================================================================

@recording_router.post("/decrypt-file")
@recording_router.post("/decrypt-upload")
async def decrypt_file(file: UploadFile = File(...)):
    try:
        encrypted_data   = await file.read()
        from app.services.storage import encrypt_service
        decrypted_stream = encrypt_service.decrypt_bytes_to_io(encrypted_data)

        filename = file.filename or "video.mp4"
        if filename.endswith(".enc"):
            filename = filename[:-4] + ".mp4"
        elif not filename.endswith(".mp4"):
            filename = filename + ".mp4"

        return StreamingResponse(
            decrypted_stream,
            media_type="video/mp4",
            headers={
                "Content-Disposition": f"inline; filename={filename}",
                **_CORS_HEADERS,
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {str(e)}")
class VerifySignatureResponse(BaseModel):
    valid: bool
    message: str

@recording_router.post("/verify-signature", response_model=VerifySignatureResponse)
async def verify_signature(
    video_file: UploadFile = File(...),
    signature_file: UploadFile = File(...)
):
    try:
        video_data = await video_file.read()
        signature_data = await signature_file.read()
        
        is_valid = signature_service.verify_signature(video_data, signature_data)
        
        if is_valid:
            return {"valid": True, "message": "Signature is valid. Video has not been tampered with."}
        else:
            return {"valid": False, "message": "Signature is invalid. Video may have been tampered with or signature does not match."}
    except Exception as e:
        print(f"[VERIFY] Error verifying signature: {e}")
        return {"valid": False, "message": f"Verification error: {str(e)}"}

@recording_router.post("/export-zip")
def export_zip(request: ExportZipRequest, background_tasks: BackgroundTasks):
    req_format = request.format.lower()
    if req_format not in ("mp4", "avi", "asf"):
        raise HTTPException(status_code=400, detail="Invalid format. Supported formats: mp4, avi, asf")

    try:
        start = datetime.strptime(request.start_date, "%Y-%m-%d")
        end   = datetime.strptime(request.end_date,   "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    if start > end:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date")

    def normalize_time(t_str: str) -> str:
        """Convert HH-MM-SS or HH:MM:SS to HH:MM for comparison."""
        if not t_str: return "00:00"
        clean = t_str.replace('_', ':').replace('-', ':')
        parts = clean.split(':')
        if len(parts) >= 2:
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}"
        return "00:00"

    req_start = request.start_time if ":" in request.start_time else f"{str(request.start_time).zfill(2)}:00"
    req_end   = request.end_time   if ":" in request.end_time   else f"{str(request.end_time).zfill(2)}:59"

    current_date = start
    all_docs     = []
    while current_date <= end:
        date_str = current_date.strftime("%Y-%m-%d")
        docs     = list(_collection.find({"camera_id": request.camera_id, "date": date_str, "is_deleted": {"$ne": True}}))
        for doc in docs:
            doc_time = normalize_time(doc.get("start_time", ""))
            if req_start <= doc_time <= req_end:
                all_docs.append(doc)
        current_date += timedelta(days=1)

    if not all_docs:
        raise HTTPException(status_code=404, detail="No recordings found for the specified range")

    temp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    zip_path = temp_zip.name
    temp_zip.close()

    decrypt_errors = []
    try:
        file_count = 0
        # ZIP_STORED (no compression) — MP4/H.264 is already compressed.
        # ZIP_DEFLATED wastes CPU and can corrupt the moov atom alignment
        # that some players rely on, causing VLC to reject the file.
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_STORED) as zf:
            try:
                public_key = signature_service.get_public_key_pem()
                zf.writestr("public_key.pem", public_key)
            except Exception as e:
                print(f"[EXPORT-ZIP] Could not add public key: {e}")

            for doc in all_docs:
                enc_path = (doc.get("file_path", "") or "").replace("\\", "/")
                is_minio = enc_path.startswith("minio:")
                if not enc_path or (not is_minio and not os.path.exists(enc_path)):
                    decrypt_errors.append(f"File missing: {enc_path}")
                    continue

                try:
                    decrypted_data = _decrypt(enc_path).getvalue()
                    decrypted_data = convert_video_format(decrypted_data, req_format)
                except Exception as dec_err:
                    decrypt_errors.append(f"Decrypt failed for {enc_path}: {dec_err}")
                    print(f"[EXPORT-ZIP] ❌ {enc_path}: {dec_err}")
                    continue

                if not decrypted_data or len(decrypted_data) < 32:
                    decrypt_errors.append(f"Empty output for {enc_path}")
                    continue

                # Sanitize filename components so VLC/Windows can open them
                safe_cam  = re.sub(r'[^\w\-.]', '_', doc.get('camera_id', 'cam'))
                safe_date = (doc.get('date', '') or '').replace('/', '-')
                safe_time = (doc.get('start_time', '') or '').replace(':', '-').replace('/', '-')
                base_name = f"{safe_cam}_{safe_date}_{safe_time}"
                out_name  = f"{base_name}.{req_format}"
                sig_name  = f"{base_name}.sig"

                try:
                    signature = signature_service.sign_data(decrypted_data)
                    zf.writestr(sig_name, signature)
                except Exception as sig_err:
                    print(f"[EXPORT-ZIP] Warning: could not sign {out_name}: {sig_err}")

                zf.writestr(out_name, decrypted_data)
                file_count += 1
                print(f"[EXPORT-ZIP] ✅ Added {out_name} ({len(decrypted_data):,} bytes)")

        if file_count == 0:
            if os.path.exists(zip_path): os.unlink(zip_path)
            detail = "No recordings could be decrypted."
            if decrypt_errors:
                detail += " Errors: " + "; ".join(decrypt_errors[:3])
            raise HTTPException(status_code=404, detail=detail)

        if decrypt_errors:
            print(f"[EXPORT-ZIP] ⚠ {len(decrypt_errors)} file(s) skipped: {decrypt_errors}")

        background_tasks.add_task(os.unlink, zip_path)
        return FileResponse(
            path=zip_path,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename=\"recordings_{request.start_date}_to_{request.end_date}.zip\"",
                "Cache-Control":       "no-store",
                **_CORS_HEADERS,
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(zip_path): os.unlink(zip_path)
        raise HTTPException(status_code=500, detail=f"Failed to create zip: {e}")

def _windows_path_to_container(windows_path: str) -> Path:
    stripped = windows_path.strip()
    if len(stripped) < 2 or stripped[1] != ':':
        return Path(stripped) if stripped else Path("/network_backup")
    drive_letter = stripped[0].lower()          # "d"
    rest         = stripped[2:].lstrip("\\/")   # "Backup" or ""
    rest_linux   = rest.replace("\\", "/")      # "Backup" or ""
    if drive_letter == 'z':
        return Path("/network_backup") / rest_linux if rest_linux else Path("/network_backup")
    container_root = Path(f"/mnt/dest_{drive_letter}")
    return container_root / rest_linux if rest_linux else container_root

@recording_router.post("/export-device")
def export_device(request: ExportDeviceRequest, background_tasks: BackgroundTasks):
    req_format = request.format.lower()
    if req_format not in ("mp4", "avi", "asf"):
        raise HTTPException(status_code=400, detail="Invalid format. Supported formats: mp4, avi, asf")

    try:
        start = datetime.strptime(request.start_date, "%Y-%m-%d")
        end   = datetime.strptime(request.end_date,   "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    if start > end:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date")

    def normalize_time(t_str: str) -> str:
        """Convert HH-MM-SS or HH:MM:SS to HH:MM for comparison."""
        if not t_str: return "00:00"
        clean = t_str.replace('_', ':').replace('-', ':')
        parts = clean.split(':')
        if len(parts) >= 2:
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}"
        return "00:00"

    req_start = request.start_time if ":" in request.start_time else f"{str(request.start_time).zfill(2)}:00"
    req_end   = request.end_time   if ":" in request.end_time   else f"{str(request.end_time).zfill(2)}:59"

    current_date = start
    all_docs     = []
    while current_date <= end:
        date_str = current_date.strftime("%Y-%m-%d")
        docs     = list(_collection.find({"camera_id": request.camera_id, "date": date_str, "is_deleted": {"$ne": True}}))
        for doc in docs:
            doc_time = normalize_time(doc.get("start_time", ""))
            if req_start <= doc_time <= req_end:
                all_docs.append(doc)
        current_date += timedelta(days=1)

    if not all_docs:
        raise HTTPException(status_code=404, detail="No recordings found for the specified range")

    # Resolve destination path
    dest_path_str = request.destination_path.strip()
    if not dest_path_str:
        raise HTTPException(status_code=400, detail="Destination path cannot be empty")
        
    dest_dir = _windows_path_to_container(dest_path_str)
    
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot access or create destination directory {dest_path_str}: {e}")

    exported_files = []
    export_errors = []
    
    for doc in all_docs:
        enc_path = (doc.get("file_path", "") or "").replace("\\", "/")
        if not enc_path or not os.path.exists(enc_path):
            export_errors.append(f"File missing: {enc_path}")
            continue

        try:
            decrypted_data = _decrypt(enc_path).getvalue()
            decrypted_data = convert_video_format(decrypted_data, req_format)
        except Exception as dec_err:
            export_errors.append(f"Decrypt failed for {enc_path}: {dec_err}")
            print(f"[EXPORT-DEVICE] ❌ {enc_path}: {dec_err}")
            continue

        if not decrypted_data or len(decrypted_data) < 32:
            export_errors.append(f"Empty output for {enc_path}")
            continue

        # Sanitize filename components so VLC/Windows can open them
        safe_cam  = re.sub(r'[^\w\-.]', '_', doc.get('camera_id', 'cam'))
        safe_date = (doc.get('date', '') or '').replace('/', '-')
        safe_time = (doc.get('start_time', '') or '').replace(':', '-').replace('/', '-')
        out_name  = f"{safe_cam}_{safe_date}_{safe_time}.{req_format}"
        
        target_file_path = dest_dir / out_name
        
        try:
            target_file_path.write_bytes(decrypted_data)
            exported_files.append(out_name)
            print(f"[EXPORT-DEVICE] ✅ Exported {out_name} to {target_file_path}")
        except Exception as write_err:
            export_errors.append(f"Write failed for {out_name}: {write_err}")
            print(f"[EXPORT-DEVICE] ❌ Write failed for {out_name}: {write_err}")

    if not exported_files:
        raise HTTPException(status_code=500, detail=f"Failed to export any files. Errors: {'; '.join(export_errors[:3])}")

    return {
        "status": "success",
        "message": f"Successfully exported {len(exported_files)} files to {dest_path_str}",
        "exported_files": exported_files,
        "errors": export_errors
    }



