import os
import json
import re
import sys

from pathlib import Path
import sys
from datetime import datetime

class TimestampLogger:
    def __init__(self, stream):
        self.stream = stream
        self._newline = True

    def write(self, message):
        if not message:
            return
        if self._newline and message.strip():
            timestamp = datetime.now().strftime("[%Y-%m-%d %H:%M:%S] ")
            self.stream.write(timestamp)
        self.stream.write(message)
        self._newline = message.endswith("\n")

    def flush(self):
        self.stream.flush()

    def __getattr__(self, attr):
        return getattr(self.stream, attr)

sys.stdout = TimestampLogger(sys.stdout)
sys.stderr = TimestampLogger(sys.stderr)

env_path = Path(__file__).parent.parent.parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip("'\""))

import subprocess
import asyncio
import requests as http_requests
from datetime import datetime
from app.core.database import cameras_col, db as _db
from app.services.camera.mediamtx_service import register_stream
from recorder import rtsp_recorder as recorder

DEVICES_FILE  = os.environ.get("DEVICES_FILE", os.path.join(os.path.dirname(__file__), "..", "..", "devices_data", "devices.json"))
MEDIAMTX_API = os.environ.get(
    "MEDIAMTX_API_URL",
    os.environ["MEDIAMTX_API_URL"]
)
WATCHDOG_INTERVAL      = 5
WATCHDOG_MAX_RETRIES   = 20
WATCHDOG_BACKOFF_RESET = 10

_watchdog_failures = {}
_watchdog_cycle = 0

def normalize_stream_name(ip: str, suffix: str = None, device_name: str = None) -> str:
    base = ip.strip().replace(".", "_")
    if suffix:
        clean_suffix = re.sub(r'[^a-zA-Z0-9\-_]', '', suffix)
        if clean_suffix:
            return f"{base}_{clean_suffix}"
    return base

def save_camera_to_db(data: dict):
    if cameras_col is None:
        print("[MONGO] ERROR: No connection")
        return False
 
    cam_ip = data.get("ip_address") or data.get("ip")
    if cam_ip:
        data["ip_address"] = cam_ip
        data["ip"] = cam_ip

    existing = cameras_col.find_one({"stream_key": data["stream_key"]})
    current_count = cameras_col.count_documents({"enabled": True})

    print("CURRENT:", current_count)
 
    try:
        cameras_col.update_one(
            {"stream_key": data["stream_key"]},
            {"$set": data},
            upsert=True
        )
        print("[MONGO] OK: Camera saved")
        return True
    except Exception as e:
        print("[MONGO] ERROR: Save failed:", e)
        return False

def load_devices():
    if cameras_col is not None:
        try:
            try:
                cameras_col.update_many(
                    {"ip_address": {"$exists": False}, "ip": {"$exists": True}},
                    [{"$set": {"ip_address": "$ip"}}]
                )
            except Exception:
                pass

            # docs = list(cameras_col.find({}, {"_id": 0}))
            docs = list(cameras_col.find({"is_deleted": {"$ne": True}}))

            if docs:
                unique_cams = {}
                for d in docs:
                    cam_ip = d.get("ip_address") or d.get("ip")
                    stream_id = d.get("stream_key") or normalize_stream_name(cam_ip or "unknown")
                    if not stream_id: continue
                    
                    if stream_id not in unique_cams:
                        unique_cams[stream_id] = d
                    else:
                        if d.get("enabled") and not unique_cams[stream_id].get("enabled"):
                            unique_cams[stream_id] = d
                
                deduped = list(unique_cams.values())
                print(f"[STARTUP] Loaded {len(docs)} cameras ({len(deduped)} unique IPs) from MongoDB")
                
                final_list = [{
                    "id":             str(d.get("_id")) if d.get("_id") else (d.get("id") or d.get("stream_key") or f"{d.get('edge_id')}_{d.get('camera_id')}"),
                    "group_id":       d.get("group_id"),
                    "mac":            d.get("mac", "—"),
                    "status":         d.get("status"),
                    "stream_key":     d.get("stream_key") or normalize_stream_name(d.get("ip_address") or d.get("ip")),
                    "rtsp_url":       d.get("rtsp_url"),
                    "recording_rtsp": d.get("recording_rtsp", d.get("rtsp_url")),
                    "sub_stream_rtsp": d.get("sub_stream_rtsp"),
                    "sub_stream_key":  d.get("sub_stream_key"),
                    "ip":             d.get("ip_address") or d.get("ip"),
                    "ip_address":     d.get("ip_address") or d.get("ip"),
                    "port":           d.get("port", 80),
                    "username":       d.get("username", ""),
                    "password":       d.get("password", ""),
                    "enabled":        d.get("enabled", True),
                    "manufacturer":   d.get("manufacturer", "Unknown"),
                    "model":          d.get("model", "Unknown"),
                    "device_name":    d.get("device_name") or d.get("name") or d.get("camera_name"),
                    "name":           d.get("name") or d.get("device_name"),
                    "active_live_profile": d.get("active_live_profile", ""),
                    "active_rec_profile":  d.get("active_rec_profile", ""),
                    "recording_profile":   d.get("recording_profile", ""),
                    "assigned_schedule_id": d.get("assigned_schedule_id", "Always"),
                    "motion_only":          d.get("motion_only", False),
                    "live_codec":           d.get("live_codec", "H.264"),
                    "codec":                d.get("codec"),
                    "shard_prefix":         d.get("shard_prefix"),
                    "assigned_worker":      d.get("assigned_worker"),
                    "reader_id":            d.get("reader_id"),
                    "source":               d.get("source"),
                    "thumbnail":            d.get("thumbnail"),
                    "edge_id":              d.get("edge_id"),
                    "edge_name":            d.get("edge_name") or d.get("display_name"),
                    "display_name":         d.get("display_name") or d.get("edge_name"),
                    "edge_ip":              d.get("edge_ip"),
                    "token":                d.get("token", ""),
                    "camera_id":            d.get("camera_id"),
                    "channel":              d.get("channel"),
                    "source_rtsp":          d.get("source_rtsp"),
                    "is_edge_camera":       d.get("is_edge_camera", d.get("source") == "edge"),
                    "stream_status":        (lambda s: "streaming" if isinstance(s, dict) and s.get("connected") else ("streaming" if s == "streaming" else (s if isinstance(s, str) else d.get("status"))))(d.get("stream_status", d.get("status"))),
                    "ws_url":               d.get("ws_url"),
                    "type":                 d.get("type", "entrance"),
                    "stream_count":         d.get("stream_count", 0),
                    "stream_profiles":      d.get("stream_profiles", []),
                    "added_at":             d.get("added_at").isoformat() if hasattr(d.get("added_at"), "isoformat") else (str(d.get("added_at")) if d.get("added_at") else None),
                    "updated_at":           d.get("updated_at").isoformat() if hasattr(d.get("updated_at"), "isoformat") else (str(d.get("updated_at")) if d.get("updated_at") else None),
                } for d in deduped if (d.get("ip_address") or d.get("ip")) and d.get("rtsp_url")]
                
                save_devices(final_list)
                return final_list
            else:
                print("[STARTUP] MongoDB connected successfully but contains 0 cameras. Syncing empty state to devices.json.")
                save_devices([])
                return []
        except Exception as e:
            print(f"[STARTUP] MongoDB load failed: {e} - falling back to devices.json")

    try:
        if os.path.exists(DEVICES_FILE):
            with open(DEVICES_FILE) as f:
                data = json.load(f)
                for d in data:
                    cam_ip = d.get("ip_address") or d.get("ip")
                    if cam_ip:
                        d["ip"] = cam_ip
                        d["ip_address"] = cam_ip
                print(f"[STARTUP] Loaded {len(data)} cameras from devices.json")
                return data
    except Exception as e:
        print(f"[STARTUP] devices.json load failed: {e}")

    return []

def save_devices(devs):
    try:
        os.makedirs(os.path.dirname(DEVICES_FILE), exist_ok=True)
        from datetime import datetime

        def serialize(obj):
            if isinstance(obj, datetime):
                return obj.isoformat()
            return str(obj)

        for d in devs:
            cam_ip = d.get("ip_address") or d.get("ip")
            if cam_ip:
                d["ip"] = cam_ip
                d["ip_address"] = cam_ip

        new_content = json.dumps(devs, default=serialize, indent=2)
        
        if os.path.exists(DEVICES_FILE):
            try:
                with open(DEVICES_FILE, "r") as f:
                    old_content = f.read()
                if old_content == new_content:
                    # Skip writing to avoid triggering Uvicorn auto-reload
                    return
            except Exception:
                pass
                
        with open(DEVICES_FILE, "w") as f:
            f.write(new_content)
        print("[DEVICES] OK: Saved successfully")
    except Exception as e:
        print(f"[DEVICES] WARN: Could not save devices.json: {e}")

def stream_exists_in_mediamtx(stream_name: str) -> bool:
    try:
        r = http_requests.get(
            f"{MEDIAMTX_API}/v3/config/paths/get/{stream_name}",
            timeout=3,
        )
        return r.status_code == 200
    except:
        return False

# Global list of devices
devices = load_devices()

def get_devices_by_ip(ip: str) -> list:
    return [d for d in devices if d.get("ip") == ip or d.get("ip_address") == ip]

# ------------------------------------------------------------------
# Worker Subprocess Pool & Dynamic Camera Sharding
# ------------------------------------------------------------------
_worker_processes = {}
_worker_pool_lock = asyncio.Lock()
_worker_retries = {}

# Keep track of promoted standbys dynamically
_promoted_standbys = set()

def get_configured_workers():
    try:
        # Check environment variable first for manual override
        active_env = os.environ.get("VMS_WORKER_COUNT")
        if active_env is not None and active_env.strip() != "":
            active_count = int(active_env)
        else:
            # Auto-scale: 1 worker per 5 cameras, with a minimum of 2 workers for redundancy
            if cameras_col is not None:
                enabled_count = cameras_col.count_documents({"enabled": {"$ne": False}})
            else:
                enabled_count = 0
            active_count = max(2, (enabled_count + 4) // 5)
    except Exception as e:
        print(f"[STREAM MANAGER] Error calculating active worker count: {e}")
        active_count = 2
        
    try:
        standby_count = int(os.environ.get("VMS_STANDBY_COUNT", "0"))
    except:
        standby_count = 0
        
    active_workers = [f"worker-{i}" for i in range(1, active_count + 1)]
    standby_workers = [f"worker-standby-{i}" for i in range(1, standby_count + 1)]
    
    # Add promoted standbys to active list and remove from standby list
    for s_id in _promoted_standbys:
        if s_id not in active_workers:
            active_workers.append(s_id)
        if s_id in standby_workers:
            standby_workers.remove(s_id)
            
    return active_workers, standby_workers

def get_camera_weight(cam: dict) -> float:
    # Estimate weight based on resolution and fps
    profiles = cam.get("stream_profiles")
    primary = {}
    if isinstance(profiles, dict):
        primary = profiles.get("primary") or {}
    
    res_str = primary.get("resolution") or cam.get("live_codec", "1920x1080")
    fps = 15.0
    try:
        fps_val = primary.get("fps")
        if fps_val is not None:
            fps = float(fps_val)
    except:
        pass
        
    # Standardize resolution string parsing
    try:
        if "x" in str(res_str).lower():
            width, height = map(int, str(res_str).lower().split("x"))
        else:
            width, height = 1920, 1080
    except:
        width, height = 1920, 1080
        
    # Scale relative to baseline 1080p@15fps (weight 1.0)
    pixels_sec = width * height * fps
    weight = pixels_sec / (1920 * 1080 * 15.0)
    return max(0.1, weight)

async def rebalance_sharding():
    if cameras_col is None or _db is None:
        return
    
    try:
        # Load configurable balancing factors
        CAMERA_WEIGHT_FACTOR = float(os.environ.get("CAMERA_WEIGHT_FACTOR", "0.50"))
        CPU_FACTOR           = float(os.environ.get("CPU_FACTOR", "0.25"))
        NETWORK_FACTOR       = float(os.environ.get("NETWORK_FACTOR", "0.15"))
        MEMORY_FACTOR        = float(os.environ.get("MEMORY_FACTOR", "0.10"))
        REBALANCE_THRESHOLD  = float(os.environ.get("REBALANCE_THRESHOLD", "0.15"))
        
        # 1. Discover workers dynamically from MongoDB worker_heartbeats
        from datetime import timedelta
        cutoff = datetime.utcnow() - timedelta(seconds=45)
        heartbeats = list(_db["worker_heartbeats"].find({"last_seen": {"$gte": cutoff}}))
        
        # Filter active workers
        active_hbs = [hb for hb in heartbeats if hb.get("status") == "active"]
        if not active_hbs:
            # Fallback to get_configured_workers if no heartbeats found yet
            active_ids, _ = get_configured_workers()
            active_hbs = [{"worker_id": w, "cpu_percent": 0.0, "memory_percent": 0.0, "network_mbps": 0.0, "last_seen": datetime.utcnow()} for w in active_ids]
            
        # Get active cameras
        all_cameras = list(cameras_col.find({"enabled": {"$ne": False}}))
        if not all_cameras:
            return
            
        # For each worker, calculate static score from system stats + heartbeat age penalty
        worker_base_scores = {}
        for hb in active_hbs:
            w_id = hb["worker_id"]
            cpu = float(hb.get("cpu_percent", 0.0))
            mem = float(hb.get("memory_percent", 0.0))
            net_mbps = float(hb.get("network_mbps", 0.0))
            net_pct = min(100.0, net_mbps)
            
            # Base resource score
            res_score = (CPU_FACTOR * cpu) + (NETWORK_FACTOR * net_pct) + (MEMORY_FACTOR * mem)
            
            # Age penalty
            last_seen = hb.get("last_seen", datetime.utcnow())
            age = (datetime.utcnow() - last_seen).total_seconds()
            if age > 15.0:
                res_score += (age - 15.0) * 5.0 # Progressive penalty
                
            worker_base_scores[w_id] = res_score

        # Calculate camera weight sum for each worker
        worker_camera_weights = {w_id: 0.0 for w_id in worker_base_scores}
        for cam in all_cameras:
            w_id = cam.get("assigned_worker")
            if w_id in worker_base_scores:
                worker_camera_weights[w_id] += get_camera_weight(cam)
                
        # Centralized mapping imports
        from app.utils.minio_client import get_shard_prefix
        
        # Distribute cameras with hysteresis
        for cam in all_cameras:
            cam_weight = get_camera_weight(cam)
            current_worker = cam.get("assigned_worker")
            
            # Calculate total load scores for all workers as if this camera was NOT assigned to them
            worker_scores = {}
            for w_id in worker_base_scores:
                w_cam_weight = worker_camera_weights[w_id]
                # subtract camera's weight if it is currently assigned to this worker
                if w_id == current_worker:
                    w_cam_weight = max(0.0, w_cam_weight - cam_weight)
                
                worker_scores[w_id] = worker_base_scores[w_id] + (CAMERA_WEIGHT_FACTOR * w_cam_weight)
            
            # Choose destination worker (lowest score)
            dest_worker = min(worker_scores.keys(), key=lambda w: worker_scores[w])
            
            # Determine assignment:
            # Keep the camera on its current worker as long as that worker is healthy/active (Sticky Sharding)
            if current_worker in worker_scores:
                target_worker = current_worker
            else:
                target_worker = dest_worker
                
            # Update local tracking
            if current_worker in worker_camera_weights and current_worker != target_worker:
                worker_camera_weights[current_worker] = max(0.0, worker_camera_weights[current_worker] - cam_weight)
            worker_camera_weights[target_worker] += cam_weight
            
            # Update DB with shard_prefix mapping
            shard_pref = get_shard_prefix(target_worker)
            if cam.get("assigned_worker") != target_worker or cam.get("shard_prefix") != shard_pref:
                cameras_col.update_one(
                    {"_id": cam["_id"]},
                    {
                        "$set": {
                            "assigned_worker": target_worker,
                            "shard_prefix": shard_pref,
                            "assigned_at": datetime.utcnow()
                        },
                        "$unset": {
                            "assigned_disk": ""  # Clean up old assigned_disk field!
                        }
                    }
                )
                print(f"[STREAM MANAGER] Rebalanced camera {cam.get('stream_key')} to {target_worker} (Shard: {shard_pref}, Load Score: {worker_scores[target_worker]:.2f})")
                
                # Invalidate segment receiver cache
                try:
                    # Invalidate local cache dynamically in process
                    from recorder.segment_receiver import _camera_shard_cache
                    _camera_shard_cache.pop(cam.get("stream_key"), None)
                except:
                    pass
    except Exception as e:
        print(f"[STREAM MANAGER] Error during camera sharding: {e}")

async def start_worker_pool():
    async with _worker_pool_lock:
        active_workers, standby_workers = get_configured_workers()
        
        # Scale down: Terminate any running worker subprocesses no longer in configuration
        all_configured = set(active_workers) | set(standby_workers)
        for w_id in list(_worker_processes.keys()):
            if w_id not in all_configured:
                print(f"[STREAM MANAGER] Scaling down: Stopping decommissioned worker {w_id}...")
                info = _worker_processes.pop(w_id, None)
                if info:
                    proc = info["process"]
                    try:
                        import psutil
                        parent = psutil.Process(proc.pid)
                        for child in parent.children(recursive=True):
                            child.kill()
                        parent.kill()
                    except Exception:
                        try:
                            proc.kill()
                        except:
                            pass
                    try:
                        if _db is not None:
                            _db["worker_heartbeats"].delete_one({"worker_id": w_id})
                    except Exception as db_err:
                        print(f"[STREAM MANAGER] Failed to delete heartbeat during worker shutdown: {db_err}")
        
        # 1. Spawn primary / active workers
        for w_id in active_workers:
            if w_id not in _worker_processes or _worker_processes[w_id]["process"].poll() is not None:
                cmd = [
                    sys.executable,
                    os.path.join(os.path.dirname(__file__), "..", "..", "recorder", "recorder_worker.py"),
                    "--worker-id", w_id
                ]
                print(f"[STREAM MANAGER] Spawning active worker {w_id}...")
                
                worker_env = os.environ.copy()
                worker_env.pop("SQLITE_QUEUE_DB", None)
                creation_flags = 0
                if sys.platform == "win32":
                    creation_flags = subprocess.CREATE_NO_WINDOW
                
                proc = subprocess.Popen(
                    cmd,
                    env=worker_env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    creationflags=creation_flags
                )
                
                _worker_processes[w_id] = {
                    "process": proc,
                    "standby": False
                }
                
                try:
                    _db["worker_heartbeats"].update_one(
                        {"worker_id": w_id},
                        {
                            "$set": {
                                "worker_id": w_id,
                                "status": "active",
                                "last_seen": datetime.utcnow(),
                                "cameras": []
                            }
                        },
                        upsert=True
                    )
                except Exception as db_err:
                    print(f"[STREAM MANAGER] DB heartbeat write failed for {w_id}: {db_err}")

        # 2. Spawn standby workers
        for s_id in standby_workers:
            if s_id not in _worker_processes or _worker_processes[s_id]["process"].poll() is not None:
                cmd = [
                    sys.executable,
                    os.path.join(os.path.dirname(__file__), "..", "..", "recorder", "recorder_worker.py"),
                    "--worker-id", s_id,
                    "--standby"
                ]
                print(f"[STREAM MANAGER] Spawning standby worker {s_id}...")
                
                worker_env = os.environ.copy()
                worker_env.pop("SQLITE_QUEUE_DB", None)
                creation_flags = 0
                if sys.platform == "win32":
                    creation_flags = subprocess.CREATE_NO_WINDOW
                
                proc = subprocess.Popen(
                    cmd,
                    env=worker_env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    creationflags=creation_flags
                )
                
                _worker_processes[s_id] = {
                    "process": proc,
                    "standby": True
                }
                
                try:
                    _db["worker_heartbeats"].update_one(
                        {"worker_id": s_id},
                        {
                            "$set": {
                                "worker_id": s_id,
                                "status": "standby",
                                "last_seen": datetime.utcnow(),
                                "cameras": []
                            }
                        },
                        upsert=True
                    )
                except Exception as db_err:
                    print(f"[STREAM MANAGER] DB heartbeat write failed for {s_id}: {db_err}")

async def supervise_worker_pool():
    """Background monitoring loop for spawned worker processes."""
    print("[STREAM MANAGER] Starting worker subprocess supervision loop...")
    while True:
        try:
            await start_worker_pool() # Ensure they are running
            
            # Watch for process crashes and frozen workers (missed heartbeats)
            now = datetime.utcnow()
            for w_id, info in list(_worker_processes.items()):
                proc = info["process"]
                
                # Check 1: Process exit
                exit_code = proc.poll()
                is_dead = exit_code is not None
                
                # Check 2: Missed heartbeats (for primary active workers that should be writing heartbeats)
                if not is_dead and not info.get("standby", False):
                    try:
                        hb = _db["worker_heartbeats"].find_one({"worker_id": w_id})
                        if hb and hb.get("last_seen"):
                            last_seen = hb["last_seen"]
                            elapsed = (now - last_seen).total_seconds()
                            if elapsed > 30:  # Timeout if no heartbeat for 30s (3 missed)
                                print(f"[STREAM MANAGER] 🚨 Worker subprocess {w_id} has frozen! No heartbeat for {elapsed:.1f}s. Terminating process...")
                                try:
                                    import psutil
                                    parent = psutil.Process(proc.pid)
                                    for child in parent.children(recursive=True):
                                        child.kill()
                                    parent.kill()
                                except Exception as kill_err:
                                    print(f"[STREAM MANAGER] Failed to kill frozen worker process via psutil: {kill_err}")
                                    try:
                                        proc.kill()
                                    except Exception:
                                        pass
                                is_dead = True
                    except Exception as hb_err:
                        print(f"[STREAM MANAGER] Error verifying heartbeat for {w_id}: {hb_err}")
                
                if is_dead:
                    if exit_code is not None:
                        print(f"[STREAM MANAGER] ⚠️ Worker subprocess {w_id} exited with code {exit_code}!")
                        try:
                            stderr_out = proc.stderr.read().decode(errors="replace").strip()
                            if stderr_out:
                                print(f"[STREAM MANAGER] Worker stderr: {stderr_out}")
                        except Exception:
                            pass
                    
                    # Remove from active processes list
                    _worker_processes.pop(w_id, None)
                    
                    # Check if it was a primary/active worker and handle failover
                    if not info.get("standby", False):
                        retries = _worker_retries.get(w_id, 0) + 1
                        _worker_retries[w_id] = retries
                        
                        if retries <= 3:
                            print(f"[STREAM MANAGER] Respawning primary worker {w_id} (Attempt {retries}/3)...")
                        else:
                            print(f"[STREAM MANAGER] 🚨 Primary worker {w_id} has crashed persistently! Triggering failover...")
                            
                            # Try to find a standby worker to promote
                            _, standby_workers = get_configured_workers()
                            standby_to_promote = None
                            for s_id in standby_workers:
                                if s_id in _worker_processes and _worker_processes[s_id]["process"].poll() is None:
                                    standby_to_promote = s_id
                                    break
                                    
                            if standby_to_promote:
                                print(f"[STREAM MANAGER] 🚀 Promoting standby worker {standby_to_promote} to take over {w_id} workload...")
                                
                                # Terminate standby process
                                s_proc = _worker_processes[standby_to_promote]["process"]
                                try:
                                    s_proc.terminate()
                                    s_proc.wait(timeout=2)
                                except:
                                    pass
                                
                                # Remove from registry and promote dynamically
                                standby_info = _worker_processes.pop(standby_to_promote)
                                _promoted_standbys.add(standby_to_promote)
                                
                                # Re-assign cameras in MongoDB
                                try:
                                    cameras_col.update_many(
                                        {"assigned_worker": w_id},
                                        {
                                            "$set": {
                                                "assigned_worker": standby_to_promote,
                                                "assigned_disk": standby_info["shard_path"],
                                                "assigned_at": datetime.utcnow()
                                            }
                                        }
                                    )
                                    _db["worker_heartbeats"].update_one(
                                        {"worker_id": w_id},
                                        {"$set": {"status": "dead"}}
                                    )
                                    print(f"[STREAM MANAGER] Re-assigned {w_id} workload to promoted standby {standby_to_promote}.")
                                except Exception as db_err:
                                    print(f"[STREAM MANAGER] Failover DB update failed: {db_err}")
                            else:
                                print(f"[STREAM MANAGER] ⚠️ No standby workers available! Re-sharding workload across remaining workers...")
                                # Mark as dead and trigger re-sharding across remaining workers
                                try:
                                    _db["worker_heartbeats"].update_one(
                                        {"worker_id": w_id},
                                        {"$set": {"status": "dead"}}
                                    )
                                except Exception:
                                    pass
                                await rebalance_sharding()
                    else:
                        print(f"[STREAM MANAGER] Respawning standby worker {w_id}...")
                        
        except Exception as e:
            print(f"[STREAM MANAGER] Worker pool supervision error: {e}")
            
        try:
            from app.services.monitoring.process_monitor import get_vms_process_metrics
            await asyncio.to_thread(get_vms_process_metrics)
        except Exception:
            pass

        await asyncio.sleep(5)

def stop_worker_pool():
    print("[STREAM MANAGER] Shutting down worker process pool...")
    for w_id, info in list(_worker_processes.items()):
        proc = info["process"]
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        print(f"[STREAM MANAGER] ⏹ Stopped subprocess worker: {w_id}")
    _worker_processes.clear()

async def stream_watchdog():
    global _watchdog_cycle, _watchdog_failures, devices
    await asyncio.sleep(5)
    while True:
        try:
            _watchdog_cycle += 1
            
            # Reload devices dynamically to capture edits
            devices = load_devices()
            
            for device in list(devices):
                stream_name = device.get("stream_key")
                rtsp_url    = device.get("rtsp_url")
                if not stream_name or not rtsp_url:
                    continue

                if device.get("enabled") is False:
                    continue

                fail_count = _watchdog_failures.get(stream_name, 0)
                if fail_count >= WATCHDOG_MAX_RETRIES:
                    if _watchdog_cycle % WATCHDOG_BACKOFF_RESET == 0:
                        print(f"[WATCHDOG] 🔄 Resetting backoff for {stream_name}")
                        _watchdog_failures[stream_name] = 0
                    else:
                        continue

                # Get dynamic codec using MediaMTX API which is instant and avoids ffprobe timeouts
                from app.services.camera.mediamtx_service import get_stream_info
                
                actual_codec = device.get("live_codec", "H.264")
                stream_info = get_stream_info(stream_name)
                
                if stream_info and stream_info.get("tracks"):
                    tracks = stream_info["tracks"]
                    if any("H265" in str(t).upper() or "HEVC" in str(t).upper() for t in tracks):
                        actual_codec = "H.265"
                    elif any("H264" in str(t).upper() for t in tracks):
                        actual_codec = "H.264"
                
                # Save it back to device if it changed so rebalance_sharding sees it next cycle
                if device.get("codec") != actual_codec or device.get("live_codec") != actual_codec:
                    print(f"[WATCHDOG] UPDATING detected codec for {stream_name} to {actual_codec}")
                    device["live_codec"] = actual_codec
                    device["codec"] = actual_codec
                    save_devices(devices)
                    if cameras_col is not None:
                        cameras_col.update_one({"stream_key": stream_name}, {"$set": {"live_codec": actual_codec, "codec": actual_codec}})

                needs_h264_path = actual_codec == "H.265"
                sub_stream_rtsp = device.get("sub_stream_rtsp")
                base_exists = stream_exists_in_mediamtx(stream_name)
                h264_exists = stream_exists_in_mediamtx(f"{stream_name}_h264") if needs_h264_path else True
                sub_exists  = stream_exists_in_mediamtx(f"{stream_name}_sub") if sub_stream_rtsp else True

                # if not base_exists or (needs_h264_path and not h264_exists):
                if not base_exists or (needs_h264_path and not h264_exists) or (sub_stream_rtsp and not sub_exists):
                    if not base_exists:
                        print(f"[WATCHDOG] WARN: Stream {stream_name} base is down - re-registering...")
                    elif needs_h264_path and not h264_exists:
                        print(f"[WATCHDOG] WARN: Stream {stream_name}_h264 path is missing - re-registering...")
                    else:
                        # print(f"[WATCHDOG] WARN: Stream {stream_name}_h264 path is missing - re-registering...")
                        print(f"[WATCHDOG] WARN: Stream {stream_name}_sub path is missing - re-registering...")
                    
                    try:
                        from app.services.camera.mediamtx_service import register_stream
                        result      = register_stream(stream_name, rtsp_url, codec=actual_codec, sub_stream_rtsp=sub_stream_rtsp)
                        status_code = result.get("statusCode", 0) if isinstance(result, dict) else 0
                        if status_code in (200, 201):
                            print(f"[WATCHDOG] OK: Re-registered {stream_name} with codec {actual_codec}")
                            _watchdog_failures[stream_name] = 0
                        else:
                            _watchdog_failures[stream_name] = fail_count + 1
                            print(f"[WATCHDOG] ERROR: Re-register failed for {stream_name}: {result}")
                    except Exception as e:
                        _watchdog_failures[stream_name] = fail_count + 1
                        print(f"[WATCHDOG] ERROR: Exception for {stream_name}: {e}")
                else:
                    if _watchdog_failures.get(stream_name, 0) > 0:
                        print(f"[WATCHDOG] OK: {stream_name} recovered")
                    _watchdog_failures[stream_name] = 0

            # Dynamically distribute camera workloads across worker processes NOW that codecs are detected and saved
            await rebalance_sharding()
            
        except Exception as e:
            import traceback
            print(f"[WATCHDOG] FATAL ERROR CRASH: {e}")
            traceback.print_exc()

        await asyncio.sleep(WATCHDOG_INTERVAL)

async def main():
    print("[STREAM MANAGER] Booting standalone Stream Manager & Worker Supervisor...")
    # Run the worker pool supervisor and watchdog concurrently
    await asyncio.gather(
        supervise_worker_pool(),
        stream_watchdog()
    )

if __name__ == "__main__":
    try:
        import sys
        if sys.platform == 'win32':
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[STREAM MANAGER] Shutdown requested...")
        try:
            stop_worker_pool()
        except KeyboardInterrupt:
            pass