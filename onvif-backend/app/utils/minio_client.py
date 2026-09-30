import os
import io
from minio import Minio
from minio.error import S3Error
from minio.commonconfig import ComposeSource

# Load MinIO configuration from environment variables
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "192.168.1.100:9000")
# Remove http/https prefix if present, as Minio client expects raw endpoint
if "://" in MINIO_ENDPOINT:
    MINIO_ENDPOINT = MINIO_ENDPOINT.split("://")[1]

MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "your_access_key")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "your_secret_key")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "vms-recordings")

import urllib3

# Initialize MinIO client
try:
    minio_client = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=False,  # Set to True if using HTTPS
        http_client=urllib3.PoolManager(maxsize=100)
    )
    
    # Ensure bucket exists
    if not minio_client.bucket_exists(MINIO_BUCKET):
        minio_client.make_bucket(MINIO_BUCKET)
        print(f"[MINIO] Created bucket '{MINIO_BUCKET}'")
except Exception as e:
    print(f"[MINIO] Initialization failed: {e}")
    minio_client = None


def upload_file(object_name: str, file_path: str) -> bool:
    """Uploads a local file to MinIO."""
    if not minio_client:
        print("[MINIO] Client not initialized. Cannot upload.")
        return False
    try:
        minio_client.fput_object(MINIO_BUCKET, object_name, file_path)
        print(f"[MINIO] ✅ Uploaded {file_path} to {object_name}")
        return True
    except S3Error as e:
        print(f"[MINIO] ❌ Upload failed for {file_path}: {e}")
        return False
    except Exception as e:
        print(f"[MINIO] ❌ Unexpected error uploading {file_path}: {e}")
        return False


def get_file_stream(object_name: str):
    """
    Gets an HTTP stream for an object in MinIO.
    Returns an urllib3.response.HTTPResponse object which can be read in chunks.
    IMPORTANT: You must close the response or consume it fully.
    """
    if not minio_client:
        raise RuntimeError("[MINIO] Client not initialized.")
    try:
        response = minio_client.get_object(MINIO_BUCKET, object_name)
        return response
    except S3Error as e:
        print(f"[MINIO] ❌ Get file stream failed for {object_name}: {e}")
        raise


def list_objects(prefix: str):
    """
    List all objects in MinIO under a specific prefix.
    """
    if not minio_client:
        print("[MINIO] Client not initialized.")
        return []
    try:
        objects = minio_client.list_objects(MINIO_BUCKET, prefix=prefix, recursive=True)
        return [obj.object_name for obj in objects]
    except S3Error as e:
        print(f"[MINIO] ❌ List objects failed for prefix {prefix}: {e}")
        return []


def delete_object(object_name: str) -> bool:
    """Deletes an object from MinIO."""
    if not minio_client:
        print("[MINIO] Client not initialized.")
        return False
    try:
        minio_client.remove_object(MINIO_BUCKET, object_name)
        print(f"[MINIO] 🗑️ Deleted {object_name}")
        return True
    except S3Error as e:
        print(f"[MINIO] ❌ Delete object failed for {object_name}: {e}")
        return False

def upload_bytes(object_name: str, data: bytes) -> bool:
    """Uploads bytes directly to MinIO."""
    if not minio_client:
        print("[MINIO] Client not initialized. Cannot upload.")
        return False
    try:
        data_stream = io.BytesIO(data)
        minio_client.put_object(
            MINIO_BUCKET,
            object_name,
            data_stream,
            length=len(data)
        )
        print(f"[MINIO] ✅ Uploaded bytes to {object_name}")
        return True
    except S3Error as e:
        print(f"[MINIO] ❌ Upload bytes failed for {object_name}: {e}")
        return False
    except Exception as e:
        print(f"[MINIO] ❌ Unexpected error uploading bytes for {object_name}: {e}")
        return False

def compose_object(destination: str, sources: list[str]) -> bool:
    """Composes multiple MinIO objects into a single object."""
    if not minio_client:
        return False
    try:
        compose_sources = [ComposeSource(MINIO_BUCKET, src) for src in sources]
        minio_client.compose_object(MINIO_BUCKET, destination, compose_sources)
        print(f"[MINIO] ✅ Composed {len(sources)} parts into {destination}")
        return True
    except Exception as e:
        print(f"[MINIO] ❌ Compose failed for {destination}: {e}")
        raise

def object_exists(object_name: str) -> bool:
    """Checks if an object exists in MinIO."""
    if not minio_client:
        return False
    try:
        minio_client.stat_object(MINIO_BUCKET, object_name)
        return True
    except S3Error as e:
        if e.code in ("NoSuchKey", "NoSuchObject"):
            return False
        print(f"[MINIO] ⚠ Stat object error for {object_name}: {e}")
        return False
    except Exception as e:
        print(f"[MINIO] ⚠ Stat object unexpected error for {object_name}: {e}")
        return False

# Centrally managed worker-to-shard mapping
WORKER_TO_SHARD_MAP = {
    "worker-1": "shard1",
    "worker-2": "shard2",
    "worker-3": "shard3",
    "worker-4": "shard4",
    "worker-5": "shard5",
    "worker-standby-1": "shard_worker-standby-1",
    "worker-standby-2": "shard_worker-standby-2",
}

def get_shard_prefix(worker_id: str) -> str:
    """Authority for mapping worker_id to logical shard prefix."""
    if not worker_id:
        return "shard1"
    if worker_id in WORKER_TO_SHARD_MAP:
        return WORKER_TO_SHARD_MAP[worker_id]
    if "standby" in worker_id:
        return f"shard_{worker_id}"
    try:
        idx = worker_id.split("-")[-1]
        int(idx) # verify it's numeric
        return f"shard{idx}"
    except:
        return f"shard_{worker_id}"

def get_parent_folder() -> str:
    """Dynamically read the parent folder name from MongoDB or local config."""
    try:
        from app.core.database import db
        if db is not None:
            doc = db["storage_settings"].find_one({"type": "recording_path"})
            if doc:
                raw_path = doc.get("recording_path")
                if raw_path:
                    cleaned = raw_path.strip().replace("\\", "/").strip("/")
                    if cleaned:
                        return cleaned
    except Exception as e:
        print("[MINIO] Failed to load parent folder from db:", e)

    try:
        config_path = os.environ.get("RECORDING_CONFIG_FILE", "/app/data/recording_config.json")
        if os.path.exists(config_path):
            import json
            with open(config_path) as f:
                data = json.load(f)
                saved = data.get("recording_path")
                if saved:
                    cleaned = saved.strip().replace("\\", "/").strip("/")
                    if cleaned:
                        return cleaned
    except Exception as e:
        print("[MINIO] Failed to load parent folder from config file:", e)

    return "Recordings"

def build_recording_path(shard_prefix: str, camera_id: str, date_str: str, filename: str) -> str:
    """Consistent format for MinIO object paths."""
    parent = get_parent_folder()
    if parent:
        return f"{parent}/{shard_prefix}/{camera_id}/{date_str}/{filename}"
    return f"{shard_prefix}/{camera_id}/{date_str}/{filename}"


