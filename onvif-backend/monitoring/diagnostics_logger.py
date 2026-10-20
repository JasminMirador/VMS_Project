import os
import shutil
from datetime import datetime, timezone
from app.core.database import mongo_client

MONGO_URI = os.environ["MONGO_URI"]
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME")
client = mongo_client
db = client[MONGO_DB_NAME] if client else None

def calculate_retention_stats(free_gb):
    if db is None:
        return None, None
    
    # Query storage history sorted by timestamp
    history = list(db["storage_history"].find().sort("timestamp", 1))
    if len(history) < 2:
        return None, None # Insufficient historical data
        
    first = history[0]
    last = history[-1]
    time_diff = (last["timestamp"] - first["timestamp"]).total_seconds()
    days_elapsed = time_diff / 86400.0
    
    if days_elapsed < 0.1: # require at least 2.4 hours of historical logs
        return None, None
        
    used_diff = last["used_gb"] - first["used_gb"]
    if used_diff <= 0:
        return None, None
        
    avg_daily_consumption = used_diff / days_elapsed
    retention_days = free_gb / avg_daily_consumption if avg_daily_consumption > 0 else None
    
    return round(avg_daily_consumption, 2), round(retention_days, 1) if retention_days else None

_last_storage_alert = 0

def log_diagnostics():
    global _last_storage_alert
    if db is None:
        return
        
    # 1. Gather Storage Metrics
    from recorder import rtsp_recorder as recorder
    rec_dir = recorder.get_recordings_dir()
    try:
        usage = shutil.disk_usage(rec_dir if os.path.exists(rec_dir) else "/")
        total_gb = round(usage.total / (1024 ** 3), 1)
        used_gb = round(usage.used / (1024 ** 3), 1)
        free_gb = round(usage.free / (1024 ** 3), 1)
    except Exception as e:
        print(f"[DIAGNOSTICS] Error reading disk usage: {e}")
        total_gb, used_gb, free_gb = 0.0, 0.0, 0.0

    usage_pct = round((used_gb / total_gb) * 100, 1) if total_gb > 0 else 0.0
    if usage_pct >= 95.0:
        import time
        now = time.time()
        # Only send once every 24 hours (86400 seconds) to avoid spam
        if now - _last_storage_alert > 86400:
            try:
                from .email_alerts import alert_storage_full
                alert_storage_full("Dashboard Storage", usage_pct)
                _last_storage_alert = now
            except Exception as alert_err:
                print(f"[DIAGNOSTICS] Error sending storage alert: {alert_err}")

    avg_daily, retention_days = calculate_retention_stats(free_gb)

    # Insert into storage_history
    db["storage_history"].insert_one({
        "timestamp": datetime.utcnow(),
        "total_gb": total_gb,
        "used_gb": used_gb,
        "free_gb": free_gb,
        "avg_daily_consumption_gb": avg_daily,
        "estimated_retention_days": retention_days
    })

    # 2. Gather active camera stream bitrates
    nodes_col = db["infrastructure_nodes"]
    cameras = list(nodes_col.find({"type": "camera"}))
    total_bitrate = 0.0
    for cam in cameras:
        bitrate = cam.get("stream_bitrate_mbps")
        if bitrate is not None:
            try:
                total_bitrate += float(bitrate)
            except:
                pass

    # Insert into bitrate_trend_history
    db["bitrate_trend_history"].insert_one({
        "timestamp": datetime.utcnow(),
        "bitrate_mbps": round(total_bitrate, 2)
    })
    
    print(f"[DIAGNOSTICS] Logged storage (free={free_gb}GB, retention={retention_days} days) and bitrate ({total_bitrate} Mbps)")
