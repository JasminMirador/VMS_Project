import os
from pathlib import Path
from pymongo import MongoClient, ASCENDING, DESCENDING
# ── .env loader ────────────────────────────────────────────────────
# Walks upward from this file (app/core -> app -> onvif-backend -> ...)
# and reads every .env it finds, nearest first. os.environ.setdefault()
# never overwrites, so the nearest file wins for any duplicated key.
# It keeps going until MONGO_URI has been found, so a stray .env in a
# closer folder cannot hide the real one.
def _load_env_files() -> list:
    searched = []
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / ".env"
        if not candidate.is_file():
            continue
        searched.append(str(candidate))
        for line in candidate.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip("'\""))
        if "MONGO_URI" in os.environ:
            break
    return searched


_env_files_read = _load_env_files()
 
for _required in ("MONGO_URI", "MONGO_DB_NAME"):
    if _required not in os.environ:
        raise RuntimeError(
            f"{_required} is not set. .env files read: {_env_files_read or 'none found'}. "
            f"Add {_required}=... to your backend .env (e.g. onvif-backend/.env)."
        )
 
MONGO_URI = os.environ["MONGO_URI"]
MONGO_DB_NAME = os.environ["MONGO_DB_NAME"]
 
def create_database_indexes(db_instance):
    """Creates optimized indexes on MongoDB collections to eliminate full table scans and high CPU load."""
    if db_instance is None:
        return
    try:
        # 1. Health Logs Collection (Fast dashboard queries + 7-day auto-cleanup)
        health_col = db_instance["health_logs"]
        health_col.create_index([("type", ASCENDING), ("timestamp", DESCENDING)])
        health_col.create_index("timestamp", expireAfterSeconds=7 * 86400)
 
        # 2. Analytics Events Collection (Fast alarm filtering & date sorting)
        analytics_col = db_instance["analytics_events"]
        analytics_col.create_index([("received_at", DESCENDING)])
        analytics_col.create_index([("ip", ASCENDING), ("received_at", DESCENDING)])
        analytics_col.create_index([("type", ASCENDING), ("received_at", DESCENDING)])
 
        # 3. MQTT Logs / Watch Collection
        mqtt_col = db_instance["mqtt_logs"]
        mqtt_col.create_index([("time", DESCENDING)])
        mqtt_col.create_index([("serial", ASCENDING), ("time", DESCENDING)])
 
        # 4. Recordings Collection
        rec_col = db_instance["recordings"]
        rec_col.create_index([("camera_ip", ASCENDING), ("start_time", DESCENDING)])
        rec_col.create_index([("stream_key", ASCENDING), ("start_time", DESCENDING)])
 
        # 5. Event Clips Collection
        clips_col = db_instance["event_clips"]
        clips_col.create_index([("camera_ip", ASCENDING), ("timestamp", DESCENDING)])
 
        # 6. Worker Heartbeats Collection
        heartbeat_col = db_instance["worker_heartbeats"]
        heartbeat_col.create_index("worker_id", unique=True)
        heartbeat_col.create_index([("last_seen", DESCENDING)])
 
        # 8. Process Lifecycle Logs Collection (Uptime & Downtime History)
        lifecycle_col = db_instance["process_lifecycle_logs"]
        lifecycle_col.create_index([("start_time", DESCENDING)])
        lifecycle_col.create_index([("pid", ASCENDING), ("status", ASCENDING)])
        lifecycle_col.create_index([("service", ASCENDING), ("start_time", DESCENDING)])
 
        # 9. Soft Delete Indexes
        db_instance["cameras"].create_index("is_deleted")
        db_instance["recordings"].create_index("is_deleted")
        db_instance["analytics_events"].create_index("is_deleted")
        db_instance["users"].create_index("is_deleted")

        # 10. Signup Requests Index
        db_instance["signup_requests"].create_index("email", unique=True)
        # 11. Performance Test Lab Collections
        perf_runs = db_instance["performance_test_runs"]
        perf_runs.create_index("run_id", unique=True)
        perf_runs.create_index([("created_at", DESCENDING)])
        perf_runs.create_index("status")

        perf_stages = db_instance["performance_test_stages"]
        perf_stages.create_index([("run_id", ASCENDING), ("stage_index", ASCENDING)], unique=True)

        perf_samples = db_instance["performance_test_samples"]
        perf_samples.create_index([("run_id", ASCENDING), ("timestamp", ASCENDING)])
        perf_samples.create_index([("run_id", ASCENDING), ("stage_index", ASCENDING), ("timestamp", ASCENDING)])

        perf_events = db_instance["performance_test_events"]
        perf_events.create_index([("run_id", ASCENDING), ("timestamp", DESCENDING)])
 
        print("[MONGO] All database indexes created successfully.")
    except Exception as err:
        print(f"[MONGO] Warning creating indexes: {err}")
 
try:
    mongo_client = MongoClient(
        MONGO_URI,
        serverSelectionTimeoutMS=5000,
        maxPoolSize=100,
        minPoolSize=10
    )
    db = mongo_client[MONGO_DB_NAME]
 
    # Collections
    cameras_col = db["cameras"]
    users_col = db["users"]
    users_col.create_index("email", unique=True)
    settings_col = db["settings"]
    supervisor_col = db["supervisor"]
    settings_col.create_index("name", unique=True)
    auth_logs_col = db["auth_logs"]
    analytics_col = db["analytics_events"]
    analytics_subs_col = db["analytics_subscriptions"]
    watch_collection = db["mqtt_logs"]
    recordings_col = db["recordings"]
    event_clips_col = db["event_clips"]
    health_logs_col = db["health_logs"]
    process_lifecycle_col = db["process_lifecycle_logs"]
    signup_requests_col = db["signup_requests"]

    # Performance Test Collections
    perf_runs_col = db["performance_test_runs"]
    perf_stages_col = db["performance_test_stages"]
    perf_samples_col = db["performance_test_samples"]
    perf_events_col = db["performance_test_events"]

    # Ensure optimized indexes are built
    create_database_indexes(db)
 
    print(f"[MONGO] Connected: {MONGO_URI}")
except Exception as e:
    print(f"[MONGO] FAILED to connect: {e}")
    mongo_client = None
    db = None
    cameras_col = None
    users_col = None
    settings_col = None
    supervisor_col = None
    auth_logs_col = None
    analytics_col = None
    analytics_subs_col = None
    watch_collection = None
    recordings_col = None
    event_clips_col = None
    health_logs_col = None
    process_lifecycle_col = None
    signup_requests_col = None 
    perf_runs_col = None
    perf_stages_col = None
    perf_samples_col = None
    perf_events_col = None