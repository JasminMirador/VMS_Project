"""
encrypt_service.py — fixed MongoDB connection + synced recording path
"""

import os
import sys
import io
import sqlite3

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass

import io
import re
import time
import secrets
import json
import threading
from datetime import datetime
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.backends import default_backend
from pymongo import MongoClient

# ── REMOVED hardcoded RECORDINGS_DIR — now always reads from rtsp_recorder ──
from . import rtsp_recorder as recorder   # get_recordings_dir() gives the live path

MONGO_URI      = os.environ["MONGO_URI"]
KEY_FILE       = os.environ.get("VIDEO_KEY_FILE", "/app/data/video.key")  # Must match recording_api.py

# On Windows host, map default container path to the actual devices_data folder in VMS_Project
if os.name == 'nt' and KEY_FILE == "/app/data/video.key":
    sibling_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "devices_data", "video.key"))
    if os.path.exists(sibling_path):
        KEY_FILE = sibling_path
    else:
        hardcoded_path = "c:/Users/miradorwin/Documents/GitHub/VMS_Project/devices_data/video.key"
        if os.path.exists(hardcoded_path):
            KEY_FILE = hardcoded_path
        else:
            KEY_FILE = sibling_path

POLL_INTERVAL  = 5

# ------------------------------------------------------------------
# MongoDB — single persistent client created at module load time
# ------------------------------------------------------------------
print(f"[ENCRYPT] Connecting to MongoDB at {MONGO_URI}")
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME")
_mongo_client       = MongoClient(MONGO_URI, serverSelectionTimeoutMS=10000)
_db                 = _mongo_client[MONGO_DB_NAME]
metadata_collection = _db["recordings"]

# ------------------------------------------------------------------
# SQLite Failsafe Queue for Local-First Writes
# ------------------------------------------------------------------
_SQLITE_QUEUE_DB = os.environ.get("SQLITE_QUEUE_DB")
if not _SQLITE_QUEUE_DB:
    # If running inside Docker container, use the mounted /app/data volume path
    if os.path.exists("/app/data"):
        _SQLITE_QUEUE_DB = "/app/data/local_metadata_queue.db"
    else:
        # Native Windows fallback
        _SQLITE_QUEUE_DB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "devices_data", "local_metadata_queue.db"))

# Create parent directories if they don't exist
try:
    os.makedirs(os.path.dirname(_SQLITE_QUEUE_DB), exist_ok=True)
except:
    pass

def init_sqlite_queue():
    try:
        os.makedirs(os.path.dirname(_SQLITE_QUEUE_DB), exist_ok=True)
        conn = sqlite3.connect(_SQLITE_QUEUE_DB)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS metadata_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                camera_id TEXT,
                date_part TEXT,
                time_part TEXT,
                file_path TEXT,
                duration_seconds REAL,
                end_time TEXT,
                file_size INTEGER,
                created_at TEXT,
                status TEXT DEFAULT 'pending'
            )
        """)
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[ENCRYPT] ❌ Failed to initialize SQLite queue: {e}")

# Call on import
init_sqlite_queue()

def queue_metadata_locally(camera_id, date_part, time_part, file_path, duration_seconds, end_time, file_size):
    try:
        conn = sqlite3.connect(_SQLITE_QUEUE_DB)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO metadata_queue 
            (camera_id, date_part, time_part, file_path, duration_seconds, end_time, file_size, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (camera_id, date_part, time_part, file_path, duration_seconds, end_time, file_size, datetime.utcnow().isoformat()))
        conn.commit()
        conn.close()
        print(f"[ENCRYPT] 💾 Queued segment locally in SQLite for {camera_id} / {date_part} / {time_part}")
    except Exception as e:
        print(f"[ENCRYPT] ❌ Failed to write to SQLite queue: {e}")

def flush_local_queue_to_mongodb():
    if metadata_collection is None:
        return
    try:
        conn = sqlite3.connect(_SQLITE_QUEUE_DB)
        cursor = conn.cursor()
        cursor.execute("SELECT id, camera_id, date_part, time_part, file_path, duration_seconds, end_time, file_size FROM metadata_queue WHERE status = 'pending'")
        rows = cursor.fetchall()
        if not rows:
            conn.close()
            return
        
        print(f"[ENCRYPT] 🔄 Found {len(rows)} pending segments in SQLite queue. Pushing to MongoDB...")
        synced_ids = []
        for row in rows:
            db_id, camera_id, date_part, time_part, file_path, duration_seconds, end_time, file_size = row
            try:
                metadata_collection.update_one(
                    {
                        "camera_id":  camera_id,
                        "date":       date_part,
                        "start_time": time_part,
                    },
                    {
                        "$set": {
                            "file_path":  file_path,
                            "duration_seconds": duration_seconds,
                            "end_time": end_time,
                            "file_size":  file_size,
                            "created_at": datetime.utcnow(),
                        }
                    },
                    upsert=True
                )
                synced_ids.append(db_id)
            except Exception as mongo_err:
                print(f"[ENCRYPT] ❌ Failed to flush SQLite row {db_id} to Mongo: {mongo_err}")
                break # Stop processing if DB is still unreachable
        
        if synced_ids:
            # Delete synced rows
            placeholders = ",".join("?" for _ in synced_ids)
            cursor.execute(f"DELETE FROM metadata_queue WHERE id IN ({placeholders})", synced_ids)
            conn.commit()
            print(f"[ENCRYPT] ✅ Successfully flushed {len(synced_ids)} segments from SQLite to MongoDB.")
        conn.close()
    except Exception as e:
        print(f"[ENCRYPT] ❌ Error flushing local SQLite queue: {e}")

def migrate_existing_recordings():
    """
    Self-healing migration: if any recording document in MongoDB has a date format
    as its camera_id (due to the old path parsing bug), fix it by parsing the
    correct camera_id from its file_path.
    """
    try:
        date_pattern = re.compile(r'^\d{4}-\d{2}-\d{2}$')
        incorrect_docs = list(metadata_collection.find({"camera_id": {"$regex": r'^\d{4}-\d{2}-\d{2}$'}}))
        if incorrect_docs:
            print(f"[ENCRYPT] 🔧 Found {len(incorrect_docs)} recordings with incorrect camera_id. Starting migration...")
            fixed_count = 0
            for doc in incorrect_docs:
                file_path = doc.get("file_path", "")
                if not file_path:
                    continue
                normalized = file_path.replace("\\", "/")
                parts = normalized.split("/")
                try:
                    for i, part in enumerate(parts):
                        if date_pattern.match(part) and i > 0:
                            correct_cam_id = parts[i - 1]
                            metadata_collection.update_one(
                                {"_id": doc["_id"]},
                                {"$set": {"camera_id": correct_cam_id}}
                            )
                            fixed_count += 1
                            break
                except Exception as ex:
                    print(f"[ENCRYPT] Migration failed for document {doc.get('_id')}: {ex}")
            print(f"[ENCRYPT] ✅ Fixed {fixed_count} existing recording documents in MongoDB.")
    except Exception as e:
        print(f"[ENCRYPT] ❌ Existing recordings migration failed: {e}")

try:
    _mongo_client.server_info()
    print("[ENCRYPT] ✅ MongoDB connected successfully")
    migrate_existing_recordings()
except Exception as e:
    print(f"[ENCRYPT] ❌ MongoDB connection FAILED: {e}")


# ------------------------------------------------------------------
# AES-256 key
# ------------------------------------------------------------------

# Old default path used before this fix — kept here ONLY for one-time migration.
# If a key exists there but not at KEY_FILE, we copy it so existing recordings
# remain decryptable after upgrading.
_OLD_KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "devices_data", "video.key")

def _migrate_key_if_needed():
    """
    One-time migration: if the key only exists at the old path, copy it to
    KEY_FILE so recording_api.py (which always uses KEY_FILE) can decrypt
    recordings that were encrypted with the old key.
    """
    if os.path.exists(KEY_FILE):
        return  # Already at the canonical location — nothing to do
    old_path = os.path.normpath(_OLD_KEY_FILE)
    if os.path.exists(old_path):
        print(f"[ENCRYPT] 🔑 Migrating key from old path: {old_path} → {KEY_FILE}")
        try:
            os.makedirs(os.path.dirname(os.path.abspath(KEY_FILE)), exist_ok=True)
            import shutil
            shutil.copy2(old_path, KEY_FILE)
            print(f"[ENCRYPT] ✅ Key migrated successfully — recordings remain decryptable")
        except Exception as e:
            print(f"[ENCRYPT] ⚠ Key migration failed: {e}")

def _sync_keys_on_windows():
    if os.name != 'nt':
        return
    win_key = "C:/app/data/video.key"
    target_key = KEY_FILE
    if os.path.exists(win_key) and os.path.abspath(win_key) != os.path.abspath(target_key):
        try:
            if not os.path.exists(target_key):
                print(f"[ENCRYPT] 🔑 Syncing key: Copying {win_key} to {target_key}")
                os.makedirs(os.path.dirname(os.path.abspath(target_key)), exist_ok=True)
                import shutil
                shutil.copy2(win_key, target_key)
            else:
                with open(win_key, "rb") as f1, open(target_key, "rb") as f2:
                    k1 = f1.read()
                    k2 = f2.read()
                if k1 != k2:
                    print(f"[ENCRYPT] ⚠️ WARNING: Keys differ! Host key {win_key} vs Target key {target_key}.")
                    print(f"[ENCRYPT] Overwriting {target_key} with {win_key} to match host encryption.")
                    import shutil
                    shutil.copy2(win_key, target_key)
        except Exception as e:
            print(f"[ENCRYPT] Sync key error: {e}")

_migrate_key_if_needed()
_sync_keys_on_windows()

def load_video_key() -> bytes:
    """
    Load the AES-256 key from KEY_FILE (canonical path, shared with recording_api.py).
    IMPORTANT: read raw bytes WITHOUT .strip() — binary keys are exactly 32 bytes and
    .strip() silently removes trailing 0x0a/0x0d bytes, producing a different key than
    the one used to encrypt, causing AES to output garbage that VLC rejects.
    """
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            key = f.read()   # ← NO .strip() — binary key must be read verbatim
        if len(key) < 1:
            raise RuntimeError(f"[ENCRYPT] video.key at {KEY_FILE} is empty!")
        padded = key[:32].ljust(32, b'\0')
        print(f"[ENCRYPT] 🔑 Loaded key from {KEY_FILE} ({len(key)} bytes raw, using first 32)")
        return padded
    print("[ENCRYPT] video.key not found — generating new AES-256 key")
    key = secrets.token_bytes(32)
    os.makedirs(os.path.dirname(os.path.abspath(KEY_FILE)), exist_ok=True)
    with open(KEY_FILE, "wb") as f:
        f.write(key)
    print(f"[ENCRYPT] Key saved to {KEY_FILE}")
    return key

MASTER_KEY = load_video_key()


def _aes_encrypt(data: bytes) -> bytes:
    iv     = secrets.token_bytes(16)
    cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(iv), backend=default_backend())
    enc    = cipher.encryptor()
    return b'CTR\x00' + iv + enc.update(data) + enc.finalize()


def _parse_path(input_path: str):
    filename = os.path.basename(input_path)
    date_dir = os.path.basename(os.path.dirname(input_path))
    camera_id = os.path.basename(os.path.dirname(os.path.dirname(input_path)))
    stem = filename.replace(".mp4", "").replace(".enc", "").replace(".ts", "")
    if stem.endswith("_motion_based"):
        stem = stem[:-13]
    if "_" in stem:
        time_part = stem.rsplit("_", 1)[1]
    else:
        time_part = stem
    return camera_id, date_dir, time_part

import subprocess
import json

def _get_video_duration_seconds(path: str) -> float:
    try:
        probe_path = path
        temp_decrypted = None
        if path.endswith(".enc"):
            temp_decrypted = path + ".temp.mp4"
            if decrypt_file(path, temp_decrypted):
                probe_path = temp_decrypted
            else:
                probe_path = None

        if not probe_path or not os.path.exists(probe_path):
            return 0.0

        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            probe_path
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True
        )

        data = json.loads(result.stdout)
        duration = float(data["format"]["duration"])

        if temp_decrypted and os.path.exists(temp_decrypted):
            try:
                os.remove(temp_decrypted)
            except:
                pass

        return duration

    except Exception as e:
        print(f"[ENCRYPT] Failed to read duration: {e}")
        if temp_decrypted and os.path.exists(temp_decrypted):
            try:
                os.remove(temp_decrypted)
            except:
                pass
        return 0.0


def _save_metadata_to_db(camera_id, date_part, time_part, output_path, input_path=None):
    file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
    from datetime import timedelta

    duration_seconds = 300.0
    durations_map = recorder._recording_durations.get(camera_id, {})
    if time_part in durations_map:
        duration_seconds = float(durations_map[time_part])

    try:
        start_dt = datetime.strptime(
            f"{date_part} {time_part}",
            "%Y-%m-%d %H-%M-%S"
        )
    except Exception:
        start_dt = datetime.now()

    end_dt = start_dt + timedelta(seconds=duration_seconds)
    end_time = end_dt.strftime("%H-%M-%S")

    try:
        metadata_collection.update_one(
            {
                "camera_id":  camera_id,
                "date":       date_part,
                "start_time": time_part,
            },
            {
                "$set": {
                    "file_path":  output_path,
                    "duration_seconds": duration_seconds,
                    "end_time": end_time,
                    "file_size":  file_size,
                    "created_at": datetime.utcnow(),
                }
            },
            upsert=True
        )
        print(f"[ENCRYPT] 📄 Saved to MongoDB (Upserted): {camera_id} / {date_part} / {time_part} file_size={file_size} duration={duration_seconds} end_time={end_time}")
    except Exception as e:
        print(f"[ENCRYPT] ❌ MongoDB upsert FAILED: {e} — writing to local SQLite queue instead")
        queue_metadata_locally(camera_id, date_part, time_part, output_path, duration_seconds, end_time, file_size)


def _save_meta_sidecar(camera_id, date_part, time_part, output_path):
    try:
        file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        meta = {
            "camera_id":  camera_id,
            "date":       date_part,
            "start_time": time_part,
            "file_path":  output_path.replace("\\", "/"),
            "file_size":  file_size,
            "created_at": datetime.utcnow().isoformat(),
        }
        encrypted = _aes_encrypt(json.dumps(meta).encode())
        with open(output_path.replace(".enc", ".meta"), "wb") as f:
            f.write(encrypted)
    except Exception as e:
        print(f"[ENCRYPT] Meta sidecar error: {e}")


def _is_file_complete(path: str) -> bool:
    try:
        fname = os.path.basename(path)
        is_segment = fname.endswith(".ts") and "_" in fname
        
        mtime = os.path.getmtime(path)
        if time.time() - mtime > 15:
            return True
            
        if is_segment:
            stem = fname.replace(".ts", "")
            parts = stem.split("_")
            if len(parts) >= 2:
                time_part = parts[0]
                try:
                    idx = int(parts[1])
                    next_fname = f"{time_part}_{idx+1:03d}.ts"
                    next_path = os.path.join(os.path.dirname(path), next_fname)
                    if os.path.exists(next_path):
                        return True
                except:
                    pass
            return False
            
        s1 = os.path.getsize(path)
        if s1 == 0:
            return False
        time.sleep(1)
        s2 = os.path.getsize(path)
        return s1 == s2
    except Exception:
        return False


def heal_mp4(input_path: str) -> str:
    import subprocess
    
    healed_path = input_path + ".healed.mp4"
    ffmpeg_bin = os.environ.get("FFMPEG_BIN", "ffmpeg")
    
    cmd = [
        ffmpeg_bin,
        "-y",
        "-loglevel", "error",
        "-err_detect", "ignore_err",
        "-i", input_path,
        "-c", "copy",
        "-movflags", "+faststart",
        healed_path
    ]
    
    try:
        print(f"[ENCRYPT] 🩺 Attempting to heal/remux MP4: {input_path}")
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if proc.returncode == 0 and os.path.exists(healed_path) and os.path.getsize(healed_path) > 0:
            print(f"[ENCRYPT] 🩺 Successfully healed {input_path} -> {healed_path}")
            os.remove(input_path)
            os.rename(healed_path, input_path)
            return input_path
        else:
            stderr = proc.stderr.decode(errors="replace")
            print(f"[ENCRYPT] 🩺 Healing process exited with code {proc.returncode}. Stderr: {stderr}")
    except Exception as e:
        print(f"[ENCRYPT] 🩺 Error during healing: {e}")
        
    if os.path.exists(healed_path):
        try:
            os.remove(healed_path)
        except:
            pass
            
    return input_path


def encrypt_file(input_path: str) -> bool:
    fname = os.path.basename(input_path)
    is_segment = fname.endswith(".ts") and "_" in fname
    
    if is_segment:
        stem = fname.replace(".ts", "")
        parts = stem.split("_")
        if len(parts) >= 2:
            time_part = parts[0]
            segment_index = parts[1]
        else:
            print(f"[ENCRYPT] Invalid segment filename structure: {fname}")
            return False
            
        try:
            camera_id, date_part, _ = _parse_path(input_path)
        except Exception as e:
            print(f"[ENCRYPT] Path parse error {input_path}: {e}")
            return False
    else:
        try:
            camera_id, date_part, time_part = _parse_path(input_path)
        except Exception as e:
            print(f"[ENCRYPT] Path parse error {input_path}: {e}")
            return False

    motion_only = False
    try:
        cam_doc = _db["cameras"].find_one({"stream_key": camera_id})
        if cam_doc and cam_doc.get("motion_only"):
            motion_only = True
    except Exception as e:
        print(f"[ENCRYPT] Error querying camera {camera_id}: {e}")

    out_dir = os.path.dirname(input_path)
    os.makedirs(out_dir, exist_ok=True)
    if motion_only:
        output_path = os.path.join(out_dir, f"{time_part}_motion_based.enc")
    else:
        output_path = os.path.join(out_dir, f"{time_part}.enc")

    if not is_segment:
        input_path = heal_mp4(input_path)

    try:
        if is_segment:
            with open(input_path, "rb") as f:
                segment_data = f.read()
                
            current_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
            
            if current_size == 0:
                base_iv = secrets.token_bytes(16)
                payload_size = 0
            else:
                with open(output_path, "rb") as f_in:
                    f_in.seek(4)
                    base_iv = f_in.read(16)
                payload_size = current_size - 20
                
            block_index = payload_size // 16
            offset_in_block = payload_size % 16
            
            iv_int = int.from_bytes(base_iv, 'big') + block_index
            chained_iv = iv_int.to_bytes(16, 'big')
            
            cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(chained_iv), backend=default_backend())
            encryptor = cipher.encryptor()
            
            if offset_in_block != 0:
                encryptor.update(b'\x00' * offset_in_block)
                
            encrypted_data = encryptor.update(segment_data) + encryptor.finalize()
            
            with open(output_path, "ab") as f_out:
                if current_size == 0:
                    f_out.write(b'CTR\x00' + base_iv)
                f_out.write(encrypted_data)
                
            print(f"[ENCRYPT] 🛠  Appended segment {segment_index} to: {output_path} (new size: {os.path.getsize(output_path)} bytes)")
        else:
            with open(input_path, "rb") as f:
                data = f.read()
            with open(output_path, "wb") as f:
                f.write(_aes_encrypt(data))
            print(f"[ENCRYPT] ✅ Encrypted complete file: {output_path}")
            
    except Exception as e:
        print(f"[ENCRYPT] ❌ Encryption failed {input_path}: {e}")
        return False

    _save_metadata_to_db(camera_id, date_part, time_part, output_path, input_path)
    _save_meta_sidecar(camera_id, date_part, time_part, output_path)

    for _ in range(10):
        try:
            os.remove(input_path)
            print(f"[ENCRYPT] 🗑  Deleted original: {input_path}")
            return True
        except Exception:
            time.sleep(2)

    print(f"[ENCRYPT] Could not delete {input_path}")
    return True


_seen_files = set()
_stop_event = threading.Event()


def decrypt_bytes_to_io(raw_bytes: bytes) -> io.BytesIO:
    if not raw_bytes or len(raw_bytes) <= 16:
        raise ValueError("Encrypted payload must be larger than 16 bytes")
        
    is_ctr = raw_bytes.startswith(b'CTR\x00')
    
    if is_ctr:
        iv = raw_bytes[4:20]
        ciphertext = raw_bytes[20:]
        cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        data = decryptor.update(ciphertext) + decryptor.finalize()
    else:
        iv         = raw_bytes[:16]
        ciphertext = raw_bytes[16:]
        cipher     = Cipher(algorithms.AES(MASTER_KEY), modes.CBC(iv), backend=default_backend())
        decryptor  = cipher.decryptor()
        padded_data = decryptor.update(ciphertext) + decryptor.finalize()
        unpadder    = padding.PKCS7(128).unpadder()
        data        = unpadder.update(padded_data) + unpadder.finalize()
        
    is_ts = len(data) > 0 and data[0] == 0x47
    if not is_ts:
        if len(data) < 12 or data[4:8] not in (b'ftyp', b'moov', b'mdat', b'free', b'skip', b'wide'):
            raise ValueError(
                f"Decrypted output is not a valid MP4 or TS (bytes[0]={data[0] if data else None!r}, bytes[4:8]={data[4:8] if len(data)>=8 else None!r}). "
                "Key mismatch between encrypt_service and recording_api?"
            )
    return io.BytesIO(data)

def decrypt_file(input_path: str, output_path: str) -> bool:
    try:
        with open(output_path, "wb") as f_out:
            for chunk in decrypt_file_stream(input_path):
                f_out.write(chunk)
        return True
    except Exception as e:
        print(f"[DECRYPT] ❌ Failed {input_path}: {e}")
        return False

def decrypt_to_temp_file(enc_path: str, suffix: str = ".ts") -> str:
    import tempfile
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.close()
    if decrypt_file(enc_path, tmp.name):
        return tmp.name
    return ""

def get_local_fallback_path(recordings_dir: str, object_key: str) -> str | None:
    if not object_key:
        return None
    direct_path = os.path.join(recordings_dir, object_key)
    if os.path.exists(direct_path):
        return direct_path
    if os.path.exists(recordings_dir):
        try:
            for entry in os.listdir(recordings_dir):
                if entry.startswith("shard"):
                    sharded_path = os.path.join(recordings_dir, entry, object_key)
                    if os.path.exists(sharded_path):
                        return sharded_path
        except Exception as e:
            print(f"[DECRYPT] Error listing recordings dir: {e}")
    return None

def decrypt_file_stream(input_path: str):
    is_minio = input_path.startswith("minio:")
    
    # Check local fallback removed. We strictly stream from MinIO.

    f = None
    stream = None
    
    if is_minio:
        try:
            from app.utils import minio_client
            object_key = input_path.replace("minio:", "")
            stream = minio_client.get_file_stream(object_key)
            if not stream:
                return
            header = stream.read(4)
        except Exception as e:
            print(f"[DECRYPT] ❌ Failed to get MinIO stream for {input_path}: {e}")
            return
    else:
        if not os.path.exists(input_path):
            return
        f = open(input_path, "rb")
        header = f.read(4)

    try:
        is_ctr = header == b'CTR\x00'
        
        if is_ctr:
            iv = stream.read(16) if is_minio else f.read(16)
            cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(iv), backend=default_backend())
        else:
            if is_minio:
                iv = header + stream.read(12)
            else:
                f.seek(0)
                iv = f.read(16)
                
            if not iv or len(iv) < 16:
                return
            cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CBC(iv), backend=default_backend())
            
        dec = cipher.decryptor()
        while True:
            chunk = stream.read(128 * 1024) if is_minio else f.read(128 * 1024)
            if not chunk:
                break
            yield dec.update(chunk)
        try:
            yield dec.finalize()
        except:
            pass
    finally:
        if is_minio and stream:
            stream.close()
            stream.release_conn()
        elif f:
            f.close()

