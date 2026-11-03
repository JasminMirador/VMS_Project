import os
import urllib.parse
from pathlib import Path

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

# Load .env from onvif-backend/ or project root
backend_env = Path(__file__).resolve().parent / ".env"
root_env = Path(__file__).resolve().parent.parent / ".env"
if backend_env.exists():
    load_dotenv(backend_env)
if root_env.exists():
    load_dotenv(root_env)

def inject_rtsp_credentials(rtsp_url: str, username: str, password: str) -> str:
    """Inject credentials and tcp transport into RTSP URL if missing."""
    if not rtsp_url or not username:
        return rtsp_url
    try:
        parsed = urllib.parse.urlparse(rtsp_url)
        if not parsed.username:
            user_enc = urllib.parse.quote(username.strip(), safe='')
            pass_enc = urllib.parse.quote(password.strip(), safe='')
            netloc = f"{user_enc}:{pass_enc}@{parsed.hostname}"
            if parsed.port:
                netloc += f":{parsed.port}"
            rtsp_url = urllib.parse.urlunparse((
                parsed.scheme, netloc, parsed.path,
                parsed.params, parsed.query, parsed.fragment
            ))
        if "transport=" not in rtsp_url:
            rtsp_url += ("&" if "?" in rtsp_url else "?") + "transport=tcp"
    except Exception:
        pass
    return rtsp_url

def stream_path_exists_in_mediamtx(mediamtx_api: str, path_name: str) -> bool:
    """Check if a path already exists in MediaMTX configuration."""
    try:
        res = requests.get(
            f"{mediamtx_api}/v3/config/paths/get/{path_name}",
            timeout=5
        )
    except Exception as e:
        raise RuntimeError(f"Failed to connect to MediaMTX API at {mediamtx_api}: {e}") from e

    if res.status_code == 200:
        return True
    elif res.status_code == 404:
        return False
    else:
        raise RuntimeError(
            f"Unexpected HTTP {res.status_code} from MediaMTX API while checking path '{path_name}': {res.text}"
        )

def backfill():
    mongo_uri = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
    mongo_db_name = os.environ.get("MONGO_DB_NAME", "vms_db")
    mediamtx_api = os.environ.get("MEDIAMTX_API_URL", "http://localhost:9997").rstrip("/")

    print(f"[BACKFILL] Connecting to MongoDB (DB: {mongo_db_name})")
    print(f"[BACKFILL] MediaMTX API URL: {mediamtx_api}")

    try:
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        db = client[mongo_db_name]
        cameras = list(db.cameras.find({}))
    except Exception as e:
        print(f"[BACKFILL] ❌ Database connection failed: {e}")
        return

    print(f"[BACKFILL] Found {len(cameras)} camera record(s) in collection 'cameras'.\n")

    registered_count = 0
    already_existing_count = 0
    skipped_count = 0

    for cam in cameras:
        cam_id = cam.get("_id")
        cam_ip = cam.get("ip") or cam.get("ip_address") or "unknown_ip"
        main_key = cam.get("stream_key") or cam_ip.replace(".", "_")

        # 1. Determine substream key
        sub_key = cam.get("sub_stream_key") or f"{main_key}_sub"

        # 2. Determine secondary RTSP URL
        sub_stream_rtsp = cam.get("sub_stream_rtsp")
        db_needs_update = False

        if not sub_stream_rtsp:
            # Fallback: look for profile labeled "SUB" in stored stream_profiles
            profiles = cam.get("stream_profiles", [])
            sub_profile = next(
                (p for p in profiles if (p.get("label") or "").upper() == "SUB" and p.get("rtsp_url")),
                None
            )
            if sub_profile:
                raw_rtsp = sub_profile["rtsp_url"]
                username = cam.get("username", "")
                password = cam.get("password", "")
                sub_stream_rtsp = inject_rtsp_credentials(raw_rtsp, username, password)
                db_needs_update = True

        if not sub_stream_rtsp:
            print(f"[{cam_ip}] ⏭ No substream RTSP URL available in DB or stream_profiles. Skipping.")
            skipped_count += 1
            continue

        # If sub_stream_rtsp or sub_stream_key were missing in DB, update them once
        if db_needs_update or not cam.get("sub_stream_key"):
            try:
                db.cameras.update_one(
                    {"_id": cam_id},
                    {"$set": {
                        "sub_stream_rtsp": sub_stream_rtsp,
                        "sub_stream_key": sub_key
                    }}
                )
                print(f"[{cam_ip}] 💾 Saved missing substream metadata to MongoDB ({sub_key})")
            except Exception as db_err:
                print(f"[{cam_ip}] ⚠️ Warning: Failed to update MongoDB record: {db_err}")

        # 3. Check if path already exists in MediaMTX
        if stream_path_exists_in_mediamtx(mediamtx_api, sub_key):
            print(f"[{cam_ip}] ✓ Substream path '{sub_key}' already exists in MediaMTX. Skipping.")
            already_existing_count += 1
            continue

        # 4. Register missing substream path in MediaMTX
        payload = {
            "source": sub_stream_rtsp,
            "sourceOnDemand": False
        }
        try:
            res = requests.post(
                f"{mediamtx_api}/v3/config/paths/add/{sub_key}",
                json=payload,
                timeout=10
            )
            if res.status_code in (200, 201):
                print(f"[{cam_ip}] ✅ Successfully registered MediaMTX path '{sub_key}' (HTTP {res.status_code})")
                registered_count += 1
            else:
                print(f"[{cam_ip}] ❌ MediaMTX registration returned HTTP {res.status_code}: {res.text}")
        except Exception as api_err:
            print(f"[{cam_ip}] ❌ Failed to register MediaMTX path '{sub_key}': {api_err}")

    print("\n[BACKFILL SUMMARY]")
    print(f"  Total cameras inspected:       {len(cameras)}")
    print(f"  Newly registered in MediaMTX:  {registered_count}")
    print(f"  Already existed in MediaMTX:   {already_existing_count}")
    print(f"  Skipped (no substream RTSP):   {skipped_count}")

if __name__ == "__main__":
    backfill()
