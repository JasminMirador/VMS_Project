import asyncio
import psutil
from datetime import datetime
from app.core.database import db, watch_collection, analytics_col
from app.managers.stream_manager import devices
from app.adapters.bosch_adapter import pull_bosch_events
from app.adapters.dahua_adapter import pull_dahua_events
from app.adapters.hikvision_adapter import pull_hikvision_events
from app.core import mqtt_publisher

from app.core.ws_manager import ws_manager
import os
import subprocess
import tempfile
from app.utils import minio_client

import time

_snapshot_cache = {}

def _capture_mediamtx_snapshot(ip: str, time_iso: str) -> str:
    current_time = time.time()
    
    # 1. Check strict 1.0-second cache to prevent CPU spikes on millisecond gaps
    if ip in _snapshot_cache:
        cached_data = _snapshot_cache[ip]
        if current_time - cached_data["timestamp"] <= 1.0:
            print(f"[SNAPSHOT] Using cached image for {ip} (millisecond alert burst)")
            return cached_data["url"]
            
    ip_prefix = ip.replace(".", "_")
    stream_url = f"rtsp://127.0.0.1:8554/{ip_prefix}"
    temp_jpg = tempfile.mktemp(suffix=".jpg")
    
    # 2. Base FFmpeg command (removed strict no-buffer flags to allow normal connection)
    cmd = [
        "ffmpeg", "-y",
        "-rtsp_transport", "tcp",
        "-i", stream_url,
        "-vframes", "1",
        "-q:v", "2",
        temp_jpg
    ]
    try:
        # 3. Increase timeout to 8.0 seconds for safety
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8.0)
        if os.path.exists(temp_jpg) and os.path.getsize(temp_jpg) > 0:
            time_safe = time_iso.replace(":", "-")
            minio_key = f"alert_snapshots/{ip_prefix}/{time_safe}.jpg"
            minio_client.upload_file(minio_key, temp_jpg)
            os.remove(temp_jpg)
            
            final_url = f"minio:{minio_key}"
            
            # Update cache on success
            _snapshot_cache[ip] = {"url": final_url, "timestamp": current_time}
            
            return final_url
    except Exception as e:
        print(f"[SNAPSHOT] Live frame capture failed for {ip}: {e}")
        
    if os.path.exists(temp_jpg):
        try:
            os.remove(temp_jpg)
        except Exception:
            pass
    return ""

_previous_camera_statuses = {}

async def system_health_collector():
    while True:
        try:
            cpu = psutil.cpu_percent()
            ram = psutil.virtual_memory().percent
            disk = psutil.disk_usage('/').percent

            # Optional process metrics summary sampling
            ffmpeg_count = 0
            vms_ram_mb = 0.0
            try:
                for proc in psutil.process_iter(['name', 'memory_info']):
                    pname = (proc.info['name'] or '').lower()
                    if 'ffmpeg' in pname:
                        ffmpeg_count += 1
                        if proc.info['memory_info']:
                            vms_ram_mb += proc.info['memory_info'].rss / (1024 * 1024)
                    elif 'python' in pname or 'mongod' in pname or 'minio' in pname or 'mediamtx' in pname:
                        if proc.info['memory_info']:
                            vms_ram_mb += proc.info['memory_info'].rss / (1024 * 1024)
            except Exception:
                pass

            metrics_payload = {
                "cpu": cpu,
                "ram": ram,
                "disk": disk,
                "ffmpeg_count": ffmpeg_count,
                "vms_ram_mb": round(vms_ram_mb, 1)
            }

            if db is not None:
                db["health_logs"].insert_one({
                    "type": "system",
                    **metrics_payload,
                    "timestamp": datetime.utcnow()
                })

            # Broadcast system metrics telemetry over WebSocket
            await ws_manager.broadcast("system_metrics", "metrics_tick", metrics_payload)

            # High resource usage alert broadcast
            if cpu > 90 or ram > 90 or disk > 90:
                await ws_manager.broadcast("system_metrics", "system_alert", {
                    "severity": "WARNING" if disk < 95 else "CRITICAL",
                    "cpu": cpu,
                    "ram": ram,
                    "disk": disk,
                    "message": f"High resource usage detected: CPU={cpu}%, RAM={ram}%, Disk={disk}%"
                })
        except Exception as e:
            print(f"[HEALTH] Collector error: {e}")
        
        await asyncio.sleep(10)

async def process_metrics_collector():
    """Periodically fetches detailed process metrics and broadcasts them over WebSocket."""
    from app.services.monitoring.process_monitor import get_vms_process_metrics
    while True:
        try:
            metrics = await asyncio.to_thread(get_vms_process_metrics)
            if metrics.get("success", True) is not False:
                await ws_manager.broadcast("process_metrics", "process_metrics_update", metrics)
        except Exception as e:
            print(f"[PROCESS METRICS] Collector error: {e}")
        
        await asyncio.sleep(5)


async def dashboard_overview_collector():
    """Collects all dashboard overview data and broadcasts via WebSocket every 10s.
    Replaces the frontend's multiple HTTP polling loops for the main dashboard.
    Topics: 'dashboard_overview' → event: 'dashboard_update'
    """
    from app.core.database import db as _db, analytics_col, cameras_col
    from datetime import datetime, timedelta

    while True:
        try:
            payload = {}

            # 1. Summary (camera counts, alarms, health)
            try:
                if cameras_col is not None and analytics_col is not None:
                    total_cameras = cameras_col.count_documents({"is_deleted": {"$ne": True}})
                    active_streams = cameras_col.count_documents({"enabled": {"$ne": False}, "is_deleted": {"$ne": True}})
                    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
                    alarms_today = analytics_col.count_documents({
                        "received_at": {"$gte": today_start.isoformat()},
                        "is_deleted": {"$ne": True}
                    })
                    latest_health = _db["health_logs"].find_one({"type": "system"}, sort=[("timestamp", -1)])
                    cpu = latest_health.get("cpu", 0) if latest_health else 0
                    ram = latest_health.get("ram", 0) if latest_health else 0
                    disk = latest_health.get("disk", 0) if latest_health else 0
                    status = "Critical" if (cpu > 85 or ram > 85 or disk > 90) else ("Warning" if (cpu > 60 or ram > 60 or disk > 75) else "Healthy")
                    payload["summary"] = {
                        "total_cameras": total_cameras,
                        "active_streams": active_streams,
                        "alarms_today": alarms_today,
                        "cpu": cpu, "ram": ram, "disk": disk,
                        "status": status,
                    }
            except Exception as e:
                print(f"[DASH WS] summary error: {e}")

            # 2. Recent AI alert events (last 20)
            try:
                if analytics_col is not None:
                    docs = list(
                        analytics_col.find({"is_deleted": {"$ne": True}}, {"_id": 0})
                        .sort("received_at", -1).limit(20)
                    )
                    for d in docs:
                        if "received_at" in d and hasattr(d["received_at"], "isoformat"):
                            d["received_at"] = d["received_at"].isoformat()
                    payload["events"] = docs
            except Exception as e:
                print(f"[DASH WS] events error: {e}")

            # 3. Camera list
            try:
                if cameras_col is not None:
                    cams = list(cameras_col.find({}, {"_id": 0}))
                    payload["cameras"] = cams
            except Exception as e:
                print(f"[DASH WS] cameras error: {e}")

            # 4. Active recorders (from worker heartbeats)
            try:
                if _db is not None:
                    cutoff = datetime.utcnow() - timedelta(seconds=30)
                    active_set = set()
                    workers = _db["worker_heartbeats"].find({"last_seen": {"$gte": cutoff}})
                    for w in workers:
                        for stream in w.get("active_recorders", []):
                            active_set.add(stream)
                    payload["active_recorders"] = sorted(list(active_set))
            except Exception as e:
                print(f"[DASH WS] recorders error: {e}")

            # 5. Camera health
            try:
                if _db is not None:
                    cam_health = list(_db["camera_health"].find({}, {"_id": 0}))
                    payload["camera_health"] = cam_health
            except Exception as e:
                print(f"[DASH WS] camera_health error: {e}")

            if payload:
                await ws_manager.broadcast("dashboard_overview", "dashboard_update", payload)

        except Exception as e:
            print(f"[DASH WS] overview collector error: {e}")

        await asyncio.sleep(10)

async def camera_health_collector():
    global _previous_camera_statuses
    while True:
        try:
            for cam in devices:
                ip = cam.get("ip")
                if not ip:
                    continue
                current_status = "online" if cam.get("enabled") else "offline"
                previous_status = _previous_camera_statuses.get(ip)

                if db is not None:
                    db["health_logs"].insert_one({
                        "type": "camera",
                        "ip": ip,
                        "status": current_status,
                        "timestamp": datetime.utcnow()
                    })

                # Broadcast camera status ONLY when status actually changes
                if previous_status is not None and previous_status != current_status:
                    await ws_manager.broadcast("camera_status", "status_change", {
                        "ip": ip,
                        "status": current_status,
                        "previous_status": previous_status,
                        "camera_name": cam.get("name", ip)
                    })
                    print(f"[WS CAM STATUS CHANGE] {ip}: {previous_status} -> {current_status}")

                _previous_camera_statuses[ip] = current_status

        except Exception as e:
            print("[CAM HEALTH ERROR]", e)

        await asyncio.sleep(10)            


# Semaphore initialized lazily inside the event loop to avoid cross-loop errors on Python 3.10+
_analytics_semaphore = None


async def analytics_poll_loop(ip: str, port: int, username: str, password: str, manufacturer: str = "bosch"):
    global _analytics_semaphore
    # Create semaphore inside running event loop (lazy init prevents RuntimeError on module import)
    if _analytics_semaphore is None:
        _analytics_semaphore = asyncio.Semaphore(5)

    print(f"[ANALYTICS] Started polling for {ip} ({manufacturer})")

    from app.services.license_manager import license_manager
    from app.core.database import analytics_subs_col

    consecutive_failures = 0
    mfr_lower    = manufacturer.lower()
    is_hikvision = any(k in mfr_lower for k in ("hikvision", "hikvisio", "hik"))
    is_dahua     = "dahua" in mfr_lower

    while True:
        sleep_time = 5  # default poll interval on success
        try:
            # Enforce max analytics modules limit
            max_analytics = license_manager.get_max_analytics()
            active_count = analytics_subs_col.count_documents({"enabled": True}) if analytics_subs_col is not None else 0
            if active_count > max_analytics:
                print(f"[ANALYTICS] License limit exceeded: active={active_count}, max={max_analytics}. Suspending {ip}.")
                await asyncio.sleep(30)
                continue

            async with _analytics_semaphore:
                if is_hikvision:
                    poll_coro = asyncio.to_thread(pull_hikvision_events, ip, port, username, password)
                    source_name = "hikvision"
                elif is_dahua:
                    poll_coro = asyncio.to_thread(pull_dahua_events, ip, port, username, password)
                    source_name = "dahua"
                else:
                    poll_coro = asyncio.to_thread(pull_bosch_events, ip, port, username, password)
                    source_name = "bosch"

                result = await asyncio.wait_for(poll_coro, timeout=20.0)

            if result.get("success"):
                consecutive_failures = 0

                if result.get("events"):
                    for ev in result["events"]:
                        event_type = ev.get("event_type", "Object Detection")
                        
                        if not license_manager.is_analytics_enabled(event_type):
                            print(f"[ANALYTICS] Skipped event type: {event_type} on {ip} (not licensed)")
                            continue

                        now_iso = datetime.now().isoformat()
                        alert = {
                            "ip":          ip,
                            "serial":      ip.replace(".", "_"),
                            "type":        event_type,
                            "scenario":    ev.get("scenario_name", "Detect Any Object"),
                            "status":      "Active",
                            "source":      source_name,
                            "topic":       ev.get("topic", ""),
                            "raw":         ev.get("raw", {}),
                            "time":        now_iso,
                            "received_at": now_iso,
                        }

                        if "occupancy" in alert["type"].lower():
                            count_val = ev.get("count")
                            if count_val is None:
                                raw_data = ev.get("raw", {})
                                count_val = (raw_data.get("Value") or raw_data.get("Active") or
                                             raw_data.get("State") or raw_data.get("Occupancy") or
                                             raw_data.get("Count"))
                            if count_val is not None:
                                try:
                                    alert["total"] = int(count_val)
                                    alert["human"] = int(count_val)
                                except ValueError:
                                    alert["total"] = count_val
                                    alert["human"] = count_val

                        # ── Instant MediaMTX Snapshot Capture ──
                        snapshot_url = await asyncio.to_thread(_capture_mediamtx_snapshot, ip, now_iso)
                        if snapshot_url:
                            alert["snapshot_url"] = snapshot_url

                        if analytics_col is not None:
                            res = analytics_col.insert_one(alert)
                            alert_id = str(res.inserted_id)
                            clean_alert = {**alert, "_id": alert_id}
                            await ws_manager.broadcast("alerts", "analytics_alert", clean_alert, event_id=alert_id)

                        # Publish to Mosquitto; fall back to direct DB write if broker unreachable
                        published = mqtt_publisher.publish_alert(source_name, ip, alert)
                        if not published and watch_collection is not None:
                            watch_collection.insert_one(alert)

                        print(f"[{source_name.upper()} UI ALERT] {ip} -> {alert['type']} (mqtt={'ok' if published else 'direct'})")

            elif not result.get("success"):
                consecutive_failures += 1
                err_msg = str(result.get("error", "")).lower()

                # Auth failure: back off 5 minutes to avoid account lockout
                if any(x in err_msg for x in ["authorized", "authorization", "password", "username"]):
                    print(f"[ANALYTICS] Auth failure on {ip}: {result.get('error')}. Backing off 5 min.")
                    await asyncio.sleep(300)
                    continue

                # Device doesn't support pullpoint: back off 5 minutes
                if ("pullpoint" in err_msg or
                        "device doesn`t support service" in err_msg or
                        "device doesn't support service" in err_msg):
                    print(f"[ANALYTICS] {ip} does not support ONVIF pullpoint. Backing off 5 min.")
                    await asyncio.sleep(300)
                    continue

                # Camera account locked by previous failed logins: back off 30s
                if "account has been locked" in err_msg:
                    await asyncio.sleep(30)
                    continue

                # Transient subscription failure (camera busy): back off 15s
                if "subscribe creation failed" in err_msg:
                    await asyncio.sleep(15)
                    continue

                # General failure: exponential backoff 5s → 10s → 20s → 40s → 60s (capped)
                sleep_time = min(60, 5 * (2 ** min(consecutive_failures - 1, 3)))
                if consecutive_failures % 5 == 0:
                    print(f"[ANALYTICS] Failed to poll {ip} {consecutive_failures} times. Retry in {sleep_time}s...")

        except asyncio.CancelledError:
            print(f"[ANALYTICS] Stopped for {ip}")
            break
        except asyncio.TimeoutError:
            print(f"[ANALYTICS] Timeout polling {ip} (>20s)")
            consecutive_failures += 1
            sleep_time = min(60, 5 * (2 ** min(consecutive_failures - 1, 3)))
        except Exception as e:
            print(f"[ANALYTICS] Error polling {ip}: {e}")
            consecutive_failures += 1
            sleep_time = min(60, 5 * (2 ** min(consecutive_failures - 1, 3)))

        await asyncio.sleep(sleep_time)
