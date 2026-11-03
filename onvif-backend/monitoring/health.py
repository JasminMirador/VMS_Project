from app.core.database import mongo_client
import os
from datetime import datetime
import threading
import psutil
from .email_alerts import alert_device_offline, alert_unexpected_reboot
from .uptime_tracker import record_uptime_snapshot, get_uptime_report
from .network_discovery import discovery_manager, DeviceIdentifier, normalize_mac, lookup_oui

MONGO_URI = os.environ["MONGO_URI"]
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME")
client = mongo_client
db = client[MONGO_DB_NAME] if client else None

if db is not None:
    nodes_col = db["infrastructure_nodes"]
    alerts_col = db["infrastructure_alerts"]
else:
    nodes_col = None
    alerts_col = None


def _broadcast_safe(payload: dict):
    pass


def _get_uptime_info():
    try:
        boot_ts = psutil.boot_time()
        bt = datetime.fromtimestamp(boot_ts)
        delta = datetime.now() - bt
        days = delta.days
        hours, rem = divmod(delta.seconds, 3600)
        minutes, _ = divmod(rem, 60)
        return f"{days}d {hours}h {minutes}m", bt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "N/A", "N/A"


def update_node_status(node_id, status, latency=None):
    if nodes_col is None:
        return
    node = nodes_col.find_one({"id": node_id})
    if node is None:
        node = nodes_col.find_one({"ip": node_id})
    if node is None:
        print(f"[HEALTH] ⚠ Skipping update_node_status: node_id={node_id} not found")
        return

    previous_status = node.get("status")
    failures = node.get("consecutive_failures", 0)

    now = datetime.utcnow()

    if status == "online":
        failures = 0
        new_status = "online"
    else:
        failures += 1
        if failures >= 3:
            new_status = "offline"
        else:
            new_status = "degraded" if previous_status == "online" else previous_status

    update_data = {
        "status": new_status,
        "consecutive_failures": failures,
        "last_seen": now
    }   
    if latency is not None:
        update_data["latency"] = latency

    nodes_col.update_one({"_id": node["_id"]}, {"$set": update_data})

    reboot_detected = record_uptime_snapshot(node["id"], node.get("ip", ""), new_status, latency)
    if reboot_detected:
        alert_unexpected_reboot(node.get('model') or node.get('ip'), node.get('ip', ''))

    # Only fire offline alert when transitioning to offline on 3rd failure
    if previous_status != "offline" and new_status == "offline":
        alert = {
            "node_id": node["id"],
            "ip": node.get("ip", ""),
            "model": node.get("model", ""),
            "type": node.get("type", ""),
            "event": "device_offline",
            "message": f"{node.get('model') or node.get('ip')} went OFFLINE",
            "timestamp": now,
            "acknowledged": False
        }
        if alerts_col is not None:
            alerts_col.insert_one(alert)
        uptime_events_col = db["uptime_events"] if db is not None else None
        if uptime_events_col is not None:
            uptime_events_col.insert_one({
                "node_id": node["id"],
                "event_type": node.get("type", "device"),
                "state": "down",
                "timestamp": now
            })

        alert_device_offline(node.get('model') or node.get('ip'), node.get('ip', ''))

        try:
            _broadcast_safe({
                "type": "ALERT",
                "data": {**alert, "timestamp": alert["timestamp"].isoformat()}
            })
        except Exception as e:
            print(f"[HEALTH] Alert broadcast error: {e}")

    elif previous_status != "online" and new_status == "online":
        uptime_events_col = db["uptime_events"] if db is not None else None
        if uptime_events_col is not None:
            uptime_events_col.insert_one({
                "node_id": node["id"],
                "event_type": node.get("type", "device"),
                "state": "up",
                "timestamp": now
            })

    try:
        _broadcast_safe({
            "type": "NODE_UPDATE",
            "id": node["id"],
            "data": {**update_data, "last_seen": update_data["last_seen"].isoformat()}
        })
    except Exception as e:
        print(f"[HEALTH] Broadcast error: {e}")

 
def check_all_nodes():
    discovery_manager.check_known_inventory_health()

 
def save_discovered_nodes(discovered_list):
    for dev in discovered_list:
        discovery_manager.save_or_update_device(dev)
    

def seed_topology_from_cameras():
    """
    ✅ FIX: VMS dedup now strictly by model='VMS Host' — prevents duplicates on IP change.
    ✅ NEW: Persists uptime + last_reboot to VMS node for frontend display.
    """
    if db is None or nodes_col is None:
        return

    cams_col = db["cameras"]
    cameras = list(cams_col.find({}))

    discovered = []
    for cam in cameras:
        ip = cam.get("ip")
        if not ip:
            continue

        discovered.append({
            "ip": ip,
            "mac": cam.get("mac"),
            "type": "camera",
            "manufacturer": cam.get("manufacturer", "IP Camera"),
            "vendor": cam.get("manufacturer", "IP Camera"),
            "model": cam.get("model", "Camera"),
            "confidence": 80,
            "classification_evidence": ["VMS registered camera"],
            "classification_reason": "Camera registered in VMS database",
            "last_seen": datetime.utcnow()
            # No latency/status/open_ports — the watcher's health check is the
            # single owner of liveness data. This function only owns identity.
        })

    for cam_dev in discovered:
        discovery_manager.save_or_update_device(cam_dev)

    print(f"[HEALTH] Seeded topology identity with {len(discovered)} registered cameras.")
