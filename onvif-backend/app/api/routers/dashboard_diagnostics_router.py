from fastapi import APIRouter, Depends, HTTPException
from app.core.security import verify_token
from app.core.database import db as _db
from datetime import datetime, timedelta
import os
import shutil

router = APIRouter(prefix="/api", tags=["dashboard_diagnostics"])

@router.get("/storage/diagnostics", dependencies=[Depends(verify_token)])
def get_storage_diagnostics():
    if _db is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    from app.services.storage import rtsp_recorder as recorder
    rec_dir = recorder.get_recordings_dir()
    if rec_dir and os.name == 'nt' and len(rec_dir) >= 2 and rec_dir[1] == ':' and (len(rec_dir) == 2 or rec_dir[2] != '\\'):
        rec_dir = rec_dir[:2] + '\\' + rec_dir[2:]
    
    try:
        usage = shutil.disk_usage(rec_dir if os.path.exists(rec_dir) else "/")
        total_gb = round(usage.total / (1024 ** 3), 1)
        used_gb = round(usage.used / (1024 ** 3), 1)
        free_gb = round(usage.free / (1024 ** 3), 1)
    except Exception as e:
        print(f"[DIAGNOSTICS] Disk error: {e}")
        total_gb, used_gb, free_gb = 0.0, 0.0, 0.0

    usage_pct = round((used_gb / total_gb) * 100, 1) if total_gb > 0 else 0.0

    # Read historical metrics from storage_history for the current active disk
    disk_filter = {"total_gb": {"$gte": total_gb * 0.85, "$lte": total_gb * 1.15}} if total_gb > 0 else {}
    history = list(_db["storage_history"].find(disk_filter).sort("timestamp", 1))
    
    avg_daily_consumption = None
    retention_days = None
    exhaustion_date = None
    warning_status = False

    # Check if we have history
    if len(history) >= 2:
        first = history[0]
        last = history[-1]
        now_dt = datetime.now()
        if (now_dt - last["timestamp"]).total_seconds() > 3600 and used_gb > 0:
            end_ts = now_dt
            end_used = used_gb
        else:
            end_ts = last["timestamp"]
            end_used = last["used_gb"]
            
        time_diff = (end_ts - first["timestamp"]).total_seconds()
        days_elapsed = time_diff / 86400.0
        
        if days_elapsed >= 0.1: # require at least 2.4 hours of historical data
            used_diff = end_used - first["used_gb"]
            if used_diff > 0:
                avg_daily_consumption = round(used_diff / days_elapsed, 2)
                if avg_daily_consumption > 0:
                    retention_days = round(free_gb / avg_daily_consumption, 1)
                    exhaustion_dt = datetime.now() + timedelta(days=retention_days)
                    exhaustion_date = exhaustion_dt.strftime("%Y-%m-%d")
    else:
        # Perform full scan of storage dates when history collection is empty
        try:
            daily_sizes = {}
            if os.path.exists(rec_dir):
                for cam_folder in os.listdir(rec_dir):
                    cam_path = os.path.join(rec_dir, cam_folder)
                    if not os.path.isdir(cam_path):
                        continue
                    for date_folder in os.listdir(cam_path):
                        date_path = os.path.join(cam_path, date_folder)
                        if not os.path.isdir(date_path):
                            continue
                        try:
                            datetime.strptime(date_folder, "%Y-%m-%d")
                        except ValueError:
                            continue
                        
                        size = 0
                        for root, dirs, files in os.walk(date_path):
                            for f in files:
                                size += os.path.getsize(os.path.join(root, f))
                        daily_sizes[date_folder] = daily_sizes.get(date_folder, 0) + size
            
            if len(daily_sizes) >= 2:
                dates = sorted(daily_sizes.keys())
                min_dt = datetime.strptime(dates[0], "%Y-%m-%d")
                max_dt = datetime.strptime(dates[-1], "%Y-%m-%d")
                days_diff = (max_dt - min_dt).days
                if days_diff >= 1:
                    total_bytes = sum(daily_sizes.values())
                    avg_daily_consumption = round((total_bytes / days_diff) / (1024 ** 3), 2)
                    if avg_daily_consumption > 0:
                        retention_days = round(free_gb / avg_daily_consumption, 1)
                        exhaustion_dt = datetime.now() + timedelta(days=retention_days)
                        exhaustion_date = exhaustion_dt.strftime("%Y-%m-%d")
        except Exception as scan_err:
            print(f"[DIAGNOSTICS] Directory scan error: {scan_err}")

    # Set warning flag
    if free_gb < (total_gb * 0.15) or (retention_days is not None and retention_days < 7):
        warning_status = True

    # Package trend list for Recharts UI
    trend_history = []
    if len(history) > 0:
        step = max(1, len(history) // 15)
        for h in history[::step]:
            trend_history.append({
                "timestamp": h["timestamp"].strftime("%Y-%m-%d %H:%M"),
                "used_gb": h["used_gb"],
                "free_gb": h["free_gb"]
            })
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
        if trend_history[-1]["timestamp"][:10] != now_str[:10]:
            trend_history.append({
                "timestamp": now_str,
                "used_gb": used_gb,
                "free_gb": free_gb
            })
    else:
        # fallback to scanned daily sizes if any
        try:
            if 'daily_sizes' in locals():
                for d_str, size_bytes in sorted(daily_sizes.items()):
                    trend_history.append({
                        "timestamp": d_str,
                        "used_gb": round(size_bytes / (1024 ** 3), 1),
                        "free_gb": free_gb
                    })
        except:
            pass

    return {
        "total_gb": total_gb,
        "used_gb": used_gb,
        "free_gb": free_gb,
        "usage_pct": usage_pct,
        "avg_daily_consumption": avg_daily_consumption,
        "retention_days": retention_days, # returns None (null) if insufficient data
        "predicted_exhaustion_date": exhaustion_date,
        "warning_status": warning_status,
        "trend_history": trend_history
    }

@router.get("/bitrate/diagnostics", dependencies=[Depends(verify_token)])
def get_bitrate_diagnostics(filter_type: str = "1h"):
    if _db is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    # Aggregate stream_bitrate_mbps from all active camera nodes
    nodes_col = _db["infrastructure_nodes"]
    cameras = list(nodes_col.find({"type": "camera", "stream_status": "healthy"}))
    current_bitrate = 0.0
    for cam in cameras:
        bitrate = cam.get("stream_bitrate_mbps")
        if bitrate is not None:
            try:
                current_bitrate += float(bitrate)
            except:
                pass
    if current_bitrate == 0.0:
        # Fallback to camera_health collection if infrastructure_nodes is not yet populated
        ch_list = list(_db["camera_health"].find())
        for ch in ch_list:
            b = ch.get("bitrate")
            if b:
                try:
                    val = float(b)
                    if val > 100:
                        val = val / 1024.0
                    current_bitrate += val
                except:
                    pass
    current_bitrate = round(current_bitrate, 2)

    # Fetch bitrate history based on filter
    now = datetime.utcnow()
    if filter_type == "1h":
        start_time = now - timedelta(hours=1)
    elif filter_type == "24h":
        start_time = now - timedelta(hours=24)
    else: # 7d
        start_time = now - timedelta(days=7)

    history = list(_db["bitrate_trend_history"].find(
        {"timestamp": {"$gte": start_time}}
    ).sort("timestamp", 1))

    bitrates = [h["bitrate_mbps"] for h in history if h.get("bitrate_mbps") is not None] if history else ([current_bitrate] if current_bitrate > 0 else [])
    avg_bitrate = round(sum(bitrates) / len(bitrates), 2) if bitrates else current_bitrate
    peak_bitrate = round(max(bitrates), 2) if bitrates else current_bitrate

    trend_data = []
    for h in history:
        ts = h.get("timestamp")
        time_str = ts.strftime("%H:%M") if filter_type == "1h" else ts.strftime("%Y-%m-%d %H:%M") if hasattr(ts, "strftime") else str(ts)
        trend_data.append({
            "timestamp": time_str,
            "bitrate_mbps": round(float(h.get("bitrate_mbps", 0.0)), 2)
        })

    if current_bitrate > 0:
        now_time_str = now.strftime("%H:%M") if filter_type == "1h" else now.strftime("%Y-%m-%d %H:%M")
        if not trend_data or trend_data[-1]["timestamp"] != now_time_str:
            trend_data.append({
                "timestamp": now_time_str,
                "bitrate_mbps": current_bitrate
            })

    return {
        "current_bitrate": current_bitrate,
        "avg_bitrate": avg_bitrate,
        "peak_bitrate": peak_bitrate,
        "trend_data": trend_data
    }

@router.get("/cameras/bandwidth", dependencies=[Depends(verify_token)])
def get_cameras_bandwidth():
    if _db is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    nodes_col = _db["infrastructure_nodes"]
    # Exclude inactive/dead cameras
    cameras = list(nodes_col.find({"type": "camera", "stream_status": "healthy"}))
    
    total_bandwidth = 0.0
    cam_list = []
    
    for cam in cameras:
        bitrate = cam.get("stream_bitrate_mbps") or 0.0
        try:
            bitrate_val = float(bitrate)
        except:
            bitrate_val = 0.0
            
        total_bandwidth += bitrate_val
        cam_list.append({
            "id": cam.get("id"),
            "name": cam.get("label") or cam.get("model") or cam.get("ip") or "Camera",
            "ip": cam.get("ip"),
            "bitrate": round(bitrate_val, 2)
        })
        
    # Sort dynamically by bitrate
    cam_list.sort(key=lambda x: x["bitrate"], reverse=True)
    top_5 = cam_list[:5]
    
    # Calculate percentage of total active bandwidth
    for cam in top_5:
        pct = round((cam["bitrate"] / total_bandwidth) * 100, 1) if total_bandwidth > 0 else 0.0
        cam["percentage"] = pct
        
    return {
        "total_bandwidth": round(total_bandwidth, 2),
        "top_cameras": top_5
    }