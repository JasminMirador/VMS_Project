import os
import re
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
import requests as http_requests
from datetime import datetime

from app.background_task_manager import task_manager
from monitoring.scheduler import scheduler as infrastructure_scheduler
from app.managers.stream_manager import devices, get_devices_by_ip, stream_watchdog, supervise_worker_pool, stop_worker_pool
from app.managers.health_manager import system_health_collector, camera_health_collector, analytics_poll_loop
from app.core.database import db as _db, cameras_col, analytics_subs_col
from app.utils.terminal_logger import log_terminal
from app.services.camera.mediamtx_service import register_stream, register_publisher_stream
from recorder import encrypt_service
from recorder import rtsp_recorder as recorder
from schedulers.stream_health_worker import start_health_monitoring
from app.managers.stream_manager import load_devices


_analytics_tasks: dict[str, asyncio.Task] = {}
_health_monitor_task = None

   

async def _periodic_gc_loop():
    import gc
    while True:
        await asyncio.sleep(180)
        try:
            gc.collect()
        except Exception:
            pass

async def _startup_phase_1():
    infrastructure_scheduler.start()
    await task_manager.start_task('gc_cleanup', _periodic_gc_loop())
    
    try:
        from app.background.log_organizer import run_log_organizer
        await task_manager.start_task('log_organizer', run_log_organizer())
    except Exception as e:
        print(f"[STARTUP] ⚠ Failed to start log organizer: {e}")
        
    try:
        from app.api.routers.monitoring_api import collector
        collector.start()
        print("[STARTUP] ✅ System monitoring collector thread started.")
    except Exception as e:
        print(f"[STARTUP] ⚠ Failed to start monitoring collector: {e}")

    from monitoring.diagnostics import run_diagnostics_loop
    await task_manager.start_task('diagnostics', run_diagnostics_loop())

    from monitoring.stream_health import run_stream_health_loop
    await task_manager.start_task('stream_health', run_stream_health_loop())
    try:
        from recorder.metadata_queue import metadata_sync_loop
        await task_manager.start_task('metadata_queue_sync', metadata_sync_loop())
        print("[STARTUP] ✅ Metadata queue sync worker started.")
    except Exception as e:
        print(f"[STARTUP] ⚠ Failed to start metadata queue sync worker: {e}")
    
    # try:
    #     from schedulers.forensic_indexer_worker import start_background_indexer
    #     start_background_indexer()
    #     print("[STARTUP] ✅ Forensic YOLOv8 background indexer started.")
    # except Exception as e:
    #     print(f"[STARTUP] ⚠ Forensic indexer failed to start: {e}")

    try:
        from schedulers.email_report_worker import email_report_worker
        await task_manager.start_task('email_report_scheduler', email_report_worker())
        print("[STARTUP] ✅ Automated Email Report Scheduler background task started.")
    except Exception as e:
        print(f"[STARTUP] ⚠ Failed to start email report scheduler: {e}")

    try:
        from discovery_host import start_discovery_host_server
        start_discovery_host_server()
        print("[STARTUP] ✅ Discovery Host Scan server started on port 19999.")
    except Exception as e:
        print(f"[STARTUP] ⚠ Failed to start Discovery Host Scan server: {e}")

async def _startup_phase_2():
    if cameras_col is not None:
        try:
            all_cams = list(cameras_col.find({}))

            for cam in all_cams:
                if cam.get("source") == "edge" or cam.get("is_edge_camera") or cam.get("edge_id"):
                    continue
                ip = cam.get("ip")
                if not ip:
                    continue
                base_name = ip.replace(".", "_")
                current   = cam.get("stream_key", "")

                if re.search(r"_cam\d+$", current):
                    continue

                if re.search(r"_[0-9a-f]{6}$", current):
                    has_cam_n = cameras_col.find_one({
                        "ip": ip,
                        "stream_key": re.compile(f"^{re.escape(base_name)}_cam\\d+$")
                    })
                    if not has_cam_n:
                        conflict = cameras_col.find_one({
                            "stream_key": base_name,
                            "_id": {"$ne": cam["_id"]}
                        })
                        if not conflict:
                            cameras_col.update_one(
                                {"_id": cam["_id"]},
                                {"$set": {"stream_key": base_name}}
                            )
                            print(f"[MIGRATION] 🚚 Renamed hash entry: {current} → {base_name}")
                    continue

                if current and current != base_name and not current.startswith(base_name + "_"):
                    print(f"[MIGRATION] 🚚 Renaming stream: {current} → {base_name}")
                    cameras_col.update_one({"_id": cam["_id"]}, {"$set": {"stream_key": base_name}})

            ghost_result = cameras_col.delete_many({
                "$or": [
                    {"rtsp_url": {"$exists": False}},
                    {"rtsp_url": None},
                    {"rtsp_url": ""},
                ]
            })
            if ghost_result.deleted_count:
                print(f"[MIGRATION] 🧹 Purged {ghost_result.deleted_count} ghost entry/entries with no rtsp_url")

            all_cams = list(cameras_col.find({}))

            cam_n_ips = {
                cam.get("ip", "")
                for cam in all_cams
                if re.search(r"_cam\d+$", cam.get("stream_key", ""))
            }

            ids_to_delete = []

            for cam in all_cams:
                stream = cam.get("stream_key", "")
                ip     = cam.get("ip", "")
                base   = ip.replace(".", "_") if ip else ""

                if re.search(r"_[0-9a-f]{6}$", stream) and ip in cam_n_ips:
                    ids_to_delete.append(cam["_id"])
                    print(f"[MIGRATION] 🗑 Removing superseded hash entry: {stream}")
                    continue

                if stream == base and ip in cam_n_ips:
                    ids_to_delete.append(cam["_id"])
                    print(f"[MIGRATION] 🗑 Removing plain IP entry: {stream} (camN exists for {ip})")

            if ids_to_delete:
                cameras_col.delete_many({"_id": {"$in": ids_to_delete}})
                print(f"[MIGRATION] ✅ Removed {len(ids_to_delete)} stale entry/entries")
        except Exception as e:
            print(f"[MIGRATION] [WARN] DB naming cleanup failed: {e}")




    log_terminal(
        "admin@gmail.com",
        "admin",
        "backend started",
        "/app",
        0,
        "startup success"
    )
    global _health_monitor_task
    import app.managers.stream_manager as sm
    my_devices = sm.devices
    print(f"[STARTUP] Starting with {len(my_devices)} saved devices")

    for device in my_devices:
        stream_name = device.get("stream_key")
        rtsp_url    = device.get("rtsp_url")
        codec       = device.get("codec") or device.get("live_codec")
        sub_rtsp    = device.get("sub_stream_rtsp")

        if device.get("enabled") is False:
            print(f"[STARTUP] ⏭ Skipping disabled camera: {stream_name}")
            continue
        if stream_name and (device.get("source") == "edge" or device.get("is_edge_camera")):
            print(f"[STARTUP] Registering Edge publisher stream: {stream_name}")
            register_publisher_stream(stream_name)
            continue
        if stream_name and rtsp_url:
            print(f"[STARTUP] Registering stream: {stream_name}")
            register_stream(stream_name, rtsp_url, codec=codec, sub_stream_rtsp=sub_rtsp)

    if analytics_subs_col is not None:
        valid_analytics_ips = []
        for device in my_devices:
            manuf = str(device.get("manufacturer", "")).lower()
            model = str(device.get("model", "")).lower()
            ip    = device.get("ip")
            username = device.get("username", "")
            
            # Only poll cameras that are explicitly known ONVIF brands AND have credentials
            if ip and username and ("bosch" in manuf or "bosch" in model or "dahua" in manuf or "dahua" in model):
                valid_analytics_ips.append(ip)
                existing_sub = analytics_subs_col.find_one({"ip": ip})
                if not existing_sub or not existing_sub.get("enabled"):
                    print(f"[ANALYTICS] 🔗 Auto-subscribed camera: {ip} ({manuf})")
                    analytics_subs_col.update_one(
                        {"ip": ip},
                        {"$set": {
                            "ip":       ip,
                            "port":     device.get("port", 80),
                            "username": username,
                            "password": device.get("password", ""),
                            "manufacturer": manuf,
                            "enabled":  True,
                            "enabled_at": datetime.utcnow()
                        }},
                        upsert=True
                    )
                else:
                    analytics_subs_col.update_one({"ip": ip}, {"$set": {"manufacturer": manuf}})

        # Purge stale subscriptions (e.g. cameras deleted from system, or changed to unknown/RTSP-only)
        deleted = analytics_subs_col.delete_many({"ip": {"$nin": valid_analytics_ips}})
        if deleted.deleted_count > 0:
            print(f"[ANALYTICS] 🗑 Purged {deleted.deleted_count} stale/non-ONVIF subscriptions")

        active_subs = list(analytics_subs_col.find({"enabled": True}))
        for sub in active_subs:
            sub_ip = sub.get("ip")
            if sub_ip:
                from app.managers.health_manager import analytics_poll_loop
                t = await task_manager.start_task(
                    f"analytics_{sub_ip}",
                    analytics_poll_loop(
                        sub_ip, sub.get("port", 80),
                        sub.get("username", ""), sub.get("password", ""),
                        sub.get("manufacturer", "bosch")
                    )
                )
                _analytics_tasks[sub_ip] = t
                print(f"[ANALYTICS] ♻ Restored for {sub_ip}")

    _health_monitor_task = await task_manager.start_task('health_monitor', start_health_monitoring(my_devices, cameras_col))
    # Worker pool is now managed separately by stream_manager.py standalone
    try:
        from app.services.ai import motion_detector
        motion_detector.manager.start()
        print("[STARTUP] ✓ Motion detector manager started")
    except Exception as e:
        print(f"[STARTUP] ❌ Failed to start motion detector manager: {e}")
    await task_manager.start_task('system_health', system_health_collector())
    from app.managers.health_manager import process_metrics_collector
    await task_manager.start_task('process_metrics', process_metrics_collector())
    from app.managers.health_manager import dashboard_overview_collector
    await task_manager.start_task('dashboard_overview', dashboard_overview_collector())
    await task_manager.start_task('camera_health', camera_health_collector())

    enabled_count = sum(1 for d in my_devices if d.get("enabled") is not False)

    print(f"[STARTUP] 🎥 Sharded recording pool active for {enabled_count}/{len(my_devices)} enabled camera(s)")

    print(f"[STARTUP] ✓ Stream health monitoring started")

    try:
        from app.api.routers.system_router import start_background_discovery
        start_background_discovery()
        print("[STARTUP] ✓ Background network camera discovery started")
    except Exception as e:
        print(f"[STARTUP] ❌ Failed to start background discovery: {e}")

async def _shutdown_phase_1():
    print("[SHUTDOWN] Stopping worker pool and motion detectors...")
    try:
        from app.services.ai import motion_detector
        motion_detector.manager.stop()
    except Exception as e:
        print(f"[SHUTDOWN] Error stopping motion detector manager: {e}")
    stop_worker_pool()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- STARTUP ---
    from app.services.license_manager import license_manager, LicenseValidationError
    try:
        license_manager.initialize()
    except LicenseValidationError as e:
        import logging
        logging.getLogger(__name__).critical(f"❌ VMS Startup Blocked: {e}")
        raise RuntimeError(f"License validation failed: {e}") from e

    app.state.license_manager = license_manager

    # Warm up Redis connection (non-fatal — API starts even if Redis is absent)
    try:
        from app.services.redis_stream_publisher import _get_client as _redis_init
        await _redis_init()
    except Exception as _redis_err:
        print(f"[STARTUP] ⚠ Redis warm-up skipped: {_redis_err}")

    await _startup_phase_1()
    await _startup_phase_2()
    yield
    # --- SHUTDOWN ---
    await _shutdown_phase_1()
    # Close Redis stream connection cleanly
    try:
        from app.services.redis_stream_publisher import close as _redis_close
        await _redis_close()
    except Exception:
        pass
    # Shut down all central tasks with max 5s timeout
    await task_manager.shutdown_all_tasks(timeout=5.0)
    # Stop background indexer
    # try:
    #     from schedulers.forensic_indexer_worker import stop_background_indexer
    #     stop_background_indexer()
    # except Exception as e:
    #     print(f"[SHUTDOWN] Failed to stop indexer: {e}")
    # Stop infrastructure scheduler
    infrastructure_scheduler.stop()
    # Stop monitoring collector
    try:
        from app.api.routers.monitoring_api import collector
        collector.stop_event.set()
        print("[SHUTDOWN] Monitoring collector stopped.")
    except Exception as e:
        print(f"[SHUTDOWN] Failed to stop collector: {e}")
    # Find and kill orphan ffmpeg processes
    task_manager.kill_orphan_ffmpegs()
