import os
import time
import shutil
import threading
from datetime import datetime, timedelta

_monitor_thread = None
_stop_event = threading.Event()
_last_alerts = {}  # key -> last timestamp to prevent spamming


def start_storage_monitor():
    """Start background health & capacity monitor for storage subsystem."""
    global _monitor_thread, _stop_event
    if _monitor_thread is not None and _monitor_thread.is_alive():
        return
    _stop_event.clear()

    # Pre-initialize today's RAID audit log on startup
    try:
        from app.services.storage import raid_logger
        raid_logger.init_today_log()
        raid_logger.log_raid_event("INFO", "STARTUP", "Mirador Storage & RAID subsystem health monitor started.")
    except Exception as e:
        print(f"[STORAGE-MONITOR] Could not pre-init raid log: {e}")

    _monitor_thread = threading.Thread(target=_monitor_loop, daemon=True, name="StorageHealthMonitor")
    _monitor_thread.start()
    print("[STORAGE-MONITOR] Background storage health & failover monitor started.")


def stop_storage_monitor():
    """Stop the storage monitor thread."""
    global _stop_event
    _stop_event.set()


def _should_alert(alert_key: str, cooldown_minutes: int = 15) -> bool:
    """Ensure we don't spam identical alerts constantly."""
    now = time.time()
    last = _last_alerts.get(alert_key, 0)
    if now - last >= (cooldown_minutes * 60):
        _last_alerts[alert_key] = now
        return True
    return False


def _emit_storage_alert(event_type: str, severity: str, message: str, details: dict = None):
    """Save alert to MongoDB and broadcast via WebSocket to UI."""
    try:
        from app.core.database import db
        if db is not None and "alerts" in db.list_collection_names():
            alerts_col = db["alerts"]
            alert_doc = {
                "event": event_type,
                "type": "storage",
                "severity": severity,
                "message": message,
                "details": details or {},
                "timestamp": datetime.utcnow(),
                "acknowledged": False
            }
            alerts_col.insert_one(alert_doc)
            print(f"[STORAGE-ALERT] [{severity.upper()}] {message}")
    except Exception as e:
        print(f"[STORAGE-MONITOR] Alert persistence error: {e}")

    # WebSocket broadcast
    try:
        from monitoring.health import _broadcast_safe
        _broadcast_safe({
            "type": "STORAGE_ALERT",
            "severity": severity,
            "message": message,
            "timestamp": datetime.utcnow().isoformat()
        })
    except Exception:
        pass


def _monitor_loop():
    """Main monitor loop checking controller health and free disk space."""
    time.sleep(10)  # Initial grace period on startup
    while not _stop_event.is_set():
        try:
            from app.services.storage import raid_service
            
            # 1. Check Controller & Physical Disks Health
            status = raid_service.get_storage_status()
            ctrl_health = status.get("health", "Healthy")
            ctrl_name = status.get("controller", "Storage Controller")
            raid_mode = status.get("raid_level", "RAID")

            if ctrl_health.lower() in ("degraded", "failed", "partially degraded"):
                if _should_alert("ctrl_degraded", cooldown_minutes=15):
                    _emit_storage_alert(
                        event_type="raid_degraded",
                        severity="critical",
                        message=f"CRITICAL: Storage array ({raid_mode}) on {ctrl_name} is {ctrl_health.upper()}! Check physical drive bays.",
                        details={"controller": ctrl_name, "health": ctrl_health, "raid_level": raid_mode}
                    )

            # Check individual drive bay states
            devices = raid_service.get_storage_devices()
            for d in devices:
                slot = d.get("slot", "?")
                d_state = str(d.get("state", "")).lower()
                d_health = str(d.get("health", "")).lower()
                if d_state in ("failed", "offline", "missing") or d_health in ("degraded", "failed"):
                    key = f"bay_{slot}_failed"
                    if _should_alert(key, cooldown_minutes=15):
                        _emit_storage_alert(
                            event_type="drive_failure",
                            severity="critical",
                            message=f"CRITICAL: Drive in Bay {slot} ({d.get('name', 'Disk')}) is {d_state.upper()}!",
                            details=d
                        )

            # 2. Check Active Recording Repository Disk Capacity
            active_path = raid_service.get_active_recording_path()
            if active_path:
                try:
                    drive_root = os.path.splitdrive(active_path)[0] + ("\\" if os.name == "nt" else "/")
                    check_target = drive_root if os.path.exists(drive_root) else active_path
                    usage = shutil.disk_usage(check_target)
                    free_gb = usage.free / (1024 ** 3)
                    total_gb = usage.total / (1024 ** 3)
                    free_pct = (usage.free / usage.total) * 100 if usage.total > 0 else 100

                    # Critical space warning (< 5 GB or < 2%)
                    if free_gb < 5.0 or free_pct < 2.0:
                        if _should_alert("disk_critical", cooldown_minutes=10):
                            _emit_storage_alert(
                                event_type="storage_space_critical",
                                severity="critical",
                                message=f"CRITICAL: Recording volume {check_target} has only {free_gb:.1f} GB ({free_pct:.1f}%) remaining! Failover recommended.",
                                details={"target": check_target, "free_gb": free_gb, "free_pct": free_pct}
                            )
                    # Low space warning (< 20 GB or < 5%)
                    elif free_gb < 20.0 or free_pct < 5.0:
                        if _should_alert("disk_warning", cooldown_minutes=30):
                            _emit_storage_alert(
                                event_type="storage_space_low",
                                severity="warning",
                                message=f"Warning: Recording volume {check_target} is running low on disk space: {free_gb:.1f} GB ({free_pct:.1f}%) free.",
                                details={"target": check_target, "free_gb": free_gb, "free_pct": free_pct}
                            )
                except Exception as ex:
                    pass

        except Exception as e:
            print(f"[STORAGE-MONITOR] Loop iteration error: {e}")

        _stop_event.wait(45.0)  # Check every 45 seconds
