import os
import sys
import time
import argparse
import threading
import psutil
from datetime import datetime

# Add backend root directory to path so imports work correctly when running as script
backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if backend_root not in sys.path:
    sys.path.insert(0, backend_root)
from app.core.database import db, cameras_col, mongo_client

# Import recorder and encrypt service
from recorder import rtsp_recorder as recorder
from recorder import encrypt_service

_last_net_io = None
_last_net_time = None

def get_network_mbps():
    global _last_net_io, _last_net_time
    try:
        net_io = psutil.net_io_counters()
        now = time.time()
        total_bytes = net_io.bytes_sent + net_io.bytes_recv
        if _last_net_io is not None and _last_net_time is not None:
            elapsed = now - _last_net_time
            if elapsed > 0:
                bytes_diff = total_bytes - _last_net_io
                mbps = (bytes_diff * 8) / (1024 * 1024) / elapsed
                _last_net_io = total_bytes
                _last_net_time = now
                return max(0.0, mbps)
        _last_net_io = total_bytes
        _last_net_time = now
    except:
        pass
    return 0.0

def parse_args():
    parser = argparse.ArgumentParser(description="VMS Sharded Recorder Worker Process")
    parser.add_argument("--worker-id", required=True, help="Unique identifier for this worker (e.g. worker-1)")
    parser.add_argument("--standby", action="store_true", help="Start worker in idle standby mode")
    return parser.parse_args()

def publish_heartbeat(mongo_uri: str, worker_id: str, active_cameras: list, status: str = "active"):
    try:
        if db is None:
            return
        heartbeats_col = db["worker_heartbeats"]
        
        cpu_percent = psutil.cpu_percent()
        mem_info = psutil.virtual_memory()
        network_mbps = get_network_mbps()
        
        # Determine actively recording streams on this worker
        active_recorders = [
            name for name, rec in recorder._recorders.items()
            if rec.is_alive() and name in getattr(recorder, '_actively_recording_streams', set())
        ]
        
        # Compute cumulative camera weight
        assigned_cams = list(cameras_col.find({
            "assigned_worker": worker_id,
            "enabled": {"$ne": False}
        })) if cameras_col is not None else []
        from app.managers.stream_manager import get_camera_weight
        cumulative_weight = sum(get_camera_weight(cam) for cam in assigned_cams)
        
        # SQLite queue depth
        upload_queue_depth = 0
        try:
            import sqlite3
            from recorder.encrypt_service import _SQLITE_QUEUE_DB
            if os.path.exists(_SQLITE_QUEUE_DB):
                conn = sqlite3.connect(_SQLITE_QUEUE_DB)
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM metadata_queue WHERE status = 'pending'")
                upload_queue_depth = cursor.fetchone()[0]
                conn.close()
        except Exception as e:
            print(f"[WORKER-{worker_id}] SQLite queue check error: {e}")
            
        # Active uploads = active recorder count
        active_uploads = len(active_recorders)
        
        # Authoritative shard_prefix
        from app.utils.minio_client import get_shard_prefix
        shard_pref = get_shard_prefix(worker_id)
        
        # Update heartbeat document with worker-generated timestamp and rich metrics
        now_dt = datetime.utcnow()
        heartbeats_col.update_one(
            {"worker_id": worker_id},
            {
                "$set": {
                    "worker_id": worker_id,
                    "status": status,
                    "last_seen": now_dt,
                    "heartbeat_timestamp": now_dt,  # worker-generated timestamp
                    "cameras": active_cameras,
                    "active_recorders": active_recorders,
                    "active_camera_count": len(active_recorders),
                    "cumulative_camera_weight": cumulative_weight,
                    "upload_queue_depth": upload_queue_depth,
                    "active_uploads": active_uploads,
                    "network_mbps": network_mbps,
                    "cpu_percent": cpu_percent,
                    "memory_percent": mem_info.percent,
                    "recorder_status": status,
                    "shard_prefix": shard_pref,
                    "system_stats": {
                        "cpu_percent": cpu_percent,
                        "memory_percent": mem_info.percent,
                        "network_mbps": network_mbps
                    }
                }
            },
            upsert=True
        )
    except Exception as e:
        print(f"[WORKER-{worker_id}] Heartbeat update failed: {e}")

def main():
    args = parse_args()
    worker_id = args.worker_id
    is_standby = args.standby
    status = "standby" if is_standby else "active"
    
    print(f"[WORKER-{worker_id}] Starting sharded worker process...")
    print(f"[WORKER-{worker_id}] Mode: {'Standby' if is_standby else 'Active'}")
    
    # 2. (Removed) local encryption watcher is no longer needed in MinIO architecture
    
    # Mongo connection URI
    mongo_uri = os.environ["MONGO_URI"]
    
    # Main sync loop
    last_heartbeat_time = 0
    heartbeat_interval = 10  # Seconds
    last_db_poll_time = 0
    db_poll_interval = 3  # Seconds
    
    while True:
        try:
            # 1. Tick all active threadless recorders
            recorder.tick_all()
            
            # 2. Publish heartbeat periodically
            now = time.time()
            if now - last_heartbeat_time >= heartbeat_interval:
                active_cameras = [name for name, rec in recorder._recorders.items() if rec.is_alive()]
                publish_heartbeat(mongo_uri, worker_id, active_cameras, status)
                last_heartbeat_time = now
                
            if is_standby:
                # Standby workers stay idle and do not pull camera configurations
                time.sleep(1)
                continue
                
            # 3. Poll camera assignments periodically
            if now - last_db_poll_time >= db_poll_interval:
                
                # Fetch all cameras assigned to this worker that are enabled
                assigned_cameras = list(cameras_col.find({
                    "assigned_worker": worker_id,
                    "enabled": {"$ne": False}
                })) if cameras_col is not None else []

                
                # Build current assignment map
                assigned_map = {}
                for cam in assigned_cameras:
                    stream_name = cam.get("stream_key")
                    rtsp_url = cam.get("recording_rtsp", cam.get("rtsp_url"))
                    if stream_name and rtsp_url:
                        assigned_map[stream_name] = {
                            "rtsp_url": rtsp_url,
                            "device_data": cam
                        }
                
                active_running_streams = list(recorder._recorders.keys())
                
                # Stop any recorders that are no longer assigned to us
                for stream_name in active_running_streams:
                    if stream_name not in assigned_map:
                        print(f"[WORKER-{worker_id}] ⏹ Stopping unassigned camera recorder: {stream_name}")
                        recorder.stop_camera(stream_name)
                
                # Start or update any assigned recorders
                for stream_name, cam_info in assigned_map.items():
                    is_running = stream_name in recorder._recorders
                    
                    if is_running:
                        recorder.update_camera_data(stream_name, cam_info["device_data"])
                        # Check for database motion triggers to forward to the recorder
                        last_trigger = cam_info["device_data"].get("last_motion_trigger")
                        if last_trigger and (time.time() - last_trigger < 15):
                            face_url = cam_info["device_data"].get("last_face_url")
                            recorder.trigger_motion_local(stream_name, face_url)
                    
                    # Check if the RTSP URL of the running recorder differs from the assigned one
                    # current_recorded_rtsp = recorder._camera_data.get(stream_name, {}).get("recording_rtsp") or recorder._camera_data.get(stream_name, {}).get("rtsp_url")
                    # rtsp_changed = current_recorded_rtsp != cam_info["rtsp_url"]
                    current_recorded_rtsp = recorder._recorders[stream_name].rtsp_url if is_running else None
                    rtsp_changed = current_recorded_rtsp and current_recorded_rtsp != cam_info["rtsp_url"]
                    
                    # Check if stream profiles changed
                    current_profiles = recorder._camera_data.get(stream_name, {}).get("stream_profiles")
                    assigned_profiles = cam_info["device_data"].get("stream_profiles")
                    profiles_changed = current_profiles != assigned_profiles
                    
                    if not is_running or rtsp_changed or profiles_changed:
                        if is_running:
                            reason = "RTSP URL changed" if rtsp_changed else "Stream profiles changed"
                            print(f"[WORKER-{worker_id}] 🔄 {reason} for {stream_name}. Restarting recorder...")
                            recorder.stop_camera(stream_name)
                            time.sleep(0.5)
                        
                        print(f"[WORKER-{worker_id}] 🎥 Starting assigned camera recorder: {stream_name}")
                        # Build mask filter if present
                        from app.services.ai import mask_service
                        ip = cam_info["device_data"].get("ip", "")
                        vf = mask_service.build_ffmpeg_vf(ip) or "" if ip else ""
                        
                        recorder.start_camera(
                            stream_name,
                            cam_info["rtsp_url"],
                            cam_info["device_data"],
                            vf_filter=vf
                        )
                last_db_poll_time = now
                
        except Exception as e:
            print(f"[WORKER-{worker_id}] Error in worker sync loop: {e}")
            
        time.sleep(1)  # Tick every 1 second

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("[WORKER] KeyboardInterrupt received. Shutting down recorders...")
        recorder.stop_all()
        if mongo_client:
            mongo_client.close()
        sys.exit(0)
    finally:
        if mongo_client:
            mongo_client.close()
