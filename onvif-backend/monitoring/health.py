from app.core.database import mongo_client
import os
from datetime import datetime
import threading
import asyncio
import psutil
from .email_alerts import alert_device_offline, alert_unexpected_reboot
from .uptime_tracker import record_uptime_snapshot, get_uptime_report

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


# def update_node_status(node_id, status, latency=None):
#     node = nodes_col.find_one({"id": node_id})
#     previous_status = node.get("status") if node else None

#     update_data = {"status": status, "last_seen": datetime.utcnow()}
#     if latency is not None:
#         update_data["latency"] = latency

#     nodes_col.update_one({"id": node_id}, {"$set": update_data})

#     # Record uptime snapshot (tracks reboots and cumulative uptime)
#     reboot_detected = record_uptime_snapshot(node_id, node.get("ip", ""), status, latency)
#     if reboot_detected:
#         alert_unexpected_reboot(node.get('model') or node.get('ip'), node.get('ip', ''))

#     # Fire alert on transition to offline
#     if previous_status and previous_status != status and status == "offline":
#         alert = {
#             "node_id": node_id,
#             "ip": node.get("ip", ""),
#             "model": node.get("model", ""),
#             "type": node.get("type", ""),
#             "event": "device_offline",
#             "message": f"{node.get('model') or node.get('ip')} went OFFLINE",
#             "timestamp": datetime.utcnow(),
#             "acknowledged": False
#         }
#         alerts_col.insert_one(alert)

#         uptime_events_col = db["uptime_events"] if db is not None else None
#         if uptime_events_col is not None:
#             uptime_events_col.insert_one({
#                 "node_id": node_id,
#                 "event_type": "camera",
#                 "state": "down",
#                 "timestamp": datetime.utcnow()
#             })

#         # ✅ Send email alert for device offline
#         alert_device_offline(node.get('model') or node.get('ip'), node.get('ip', ''))

#         try:
#             _broadcast_safe({
#                 "type": "ALERT",
#                 "data": {**alert, "timestamp": alert["timestamp"].isoformat()}
#             })
#         except Exception as e:
#             print(f"[HEALTH] Alert broadcast error: {e}")

#     elif previous_status and previous_status != status and status == "online":
#         uptime_events_col = db["uptime_events"] if db is not None else None
#         if uptime_events_col is not None:
#             uptime_events_col.insert_one({
#                 "node_id": node_id,
#                 "event_type": "camera",
#                 "state": "up",
#                 "timestamp": datetime.utcnow()
#             })

#     try:
#         _broadcast_safe({
#             "type": "NODE_UPDATE",
#             "id": node_id,
#             "data": {**update_data, "last_seen": update_data["last_seen"].isoformat()}
#         })
#     except Exception as e:
#         print(f"[HEALTH] Broadcast error: {e}")

def update_node_status(node_id, status, latency=None):
    node = nodes_col.find_one({"id": node_id})
    if node is None:
        print(f"[HEALTH] ⚠ Skipping update_node_status: node_id={node_id} not found (likely purged)")
        return

    previous_status = node.get("status")

    update_data = {"status": status, "last_seen": datetime.utcnow()}
    if latency is not None:
        update_data["latency"] = latency

    nodes_col.update_one({"id": node_id}, {"$set": update_data})

    reboot_detected = record_uptime_snapshot(node_id, node.get("ip", ""), status, latency)
    if reboot_detected:
        alert_unexpected_reboot(node.get('model') or node.get('ip'), node.get('ip', ''))

    if previous_status and previous_status != status and status == "offline":
        alert = {
            "node_id": node_id,
            "ip": node.get("ip", ""),
            "model": node.get("model", ""),
            "type": node.get("type", ""),
            "event": "device_offline",
            "message": f"{node.get('model') or node.get('ip')} went OFFLINE",
            "timestamp": datetime.utcnow(),
            "acknowledged": False
        }
        alerts_col.insert_one(alert)

        uptime_events_col = db["uptime_events"] if db is not None else None
        if uptime_events_col is not None:
            uptime_events_col.insert_one({
                "node_id": node_id,
                "event_type": "camera",
                "state": "down",
                "timestamp": datetime.utcnow()
            })

        alert_device_offline(node.get('model') or node.get('ip'), node.get('ip', ''))

        try:
            _broadcast_safe({
                "type": "ALERT",
                "data": {**alert, "timestamp": alert["timestamp"].isoformat()}
            })
        except Exception as e:
            print(f"[HEALTH] Alert broadcast error: {e}")

    elif previous_status and previous_status != status and status == "online":
        uptime_events_col = db["uptime_events"] if db is not None else None
        if uptime_events_col is not None:
            uptime_events_col.insert_one({
                "node_id": node_id,
                "event_type": "camera",
                "state": "up",
                "timestamp": datetime.utcnow()
            })

    try:
        _broadcast_safe({
            "type": "NODE_UPDATE",
            "id": node_id,
            "data": {**update_data, "last_seen": update_data["last_seen"].isoformat()}
        })
    except Exception as e:
        print(f"[HEALTH] Broadcast error: {e}")


# def check_all_nodes():
#     from .scanner import scanner
#     nodes = list(nodes_col.find({}))

#     def worker(node):
#         ip = node.get("ip")
#         if not ip:
#             return
#         latency = scanner.ping_device(ip)
#         if latency >= 0:
#             status = "online"
#         else:
#             # Fallback check: check if RTSP, ONVIF or HTTP ports are reachable
#             is_reachable = False
#             for port in [554, 8080, 80]:
#                 if scanner.probe_port(ip, port, timeout=0.5):
#                     is_reachable = True
#                     break
#             if is_reachable:
#                 status = "online"
#                 latency = 5.0  # Nominal latency for ping-blocked devices
#             else:
#                 status = "offline"
#         update_node_status(node["id"], status, latency)

#     threads = [threading.Thread(target=worker, args=(n,)) for n in nodes]
#     for t in threads:
#         t.start()
#     for t in threads:
#         t.join(timeout=5)

def check_all_nodes():
    from .scanner import scanner
    nodes = list(nodes_col.find({}))

    def worker(node):
        try:
            ip = node.get("ip")
            if not ip:
                return
            latency = scanner.ping_device(ip)
            if latency >= 0:
                status = "online"
            else:
                is_reachable = False
                for port in [554, 8080, 80]:
                    if scanner.probe_port(ip, port, timeout=0.5):
                        is_reachable = True
                        break
                if is_reachable:
                    status = "online"
                    latency = 5.0
                else:
                    status = "offline"
            update_node_status(node["id"], status, latency)
        except Exception as e:
            print(f"[HEALTH] worker() error for node {node.get('id', '?')}: {e}")

    threads = [threading.Thread(target=worker, args=(n,)) for n in nodes]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)


def save_discovered_nodes(discovered_list):
    cams_col = db["cameras"]
    for dev in discovered_list:
        node_id = f"node-{dev['ip'].replace('.', '-')}"
        existing = nodes_col.find_one({"id": node_id})
        node_data = {
            "id": node_id, "ip": dev["ip"], "type": dev["type"],
            "manufacturer": dev.get("manufacturer", ""), "model": dev.get("model", ""),
            "status": "online", "latency": dev.get("latency"),
            "last_seen": dev.get("last_seen", datetime.utcnow()), "inferred": False
        }
        # ── FIX: copy credentials from cameras collection so stream_health
        #         can authenticate against RTSP/ONVIF without them being None.
        if dev["type"] == "camera":
            cam_doc = cams_col.find_one({"ip": dev["ip"]}, {"_id": 0, "username": 1, "password": 1})
            if cam_doc:
                if cam_doc.get("username"):
                    node_data["username"] = cam_doc["username"]
                if cam_doc.get("password"):
                    node_data["password"] = cam_doc["password"]
        if not existing:
            node_data["position"] = None
            nodes_col.insert_one(node_data)
            print(f"[HEALTH] Added new node: {node_id} ({dev['ip']})")
        else:
            # Preserve credentials already stored; only overwrite if we got new ones
            update = {k: v for k, v in node_data.items() if k not in ("username", "password") or v}
            nodes_col.update_one({"id": node_id}, {"$set": update})

    try:
        _broadcast_safe({"type": "TOPOLOGY_UPDATE", "count": len(discovered_list)})
    except Exception as e:
        print(f"[HEALTH] Topology broadcast error: {e}")


def seed_topology_from_cameras():
    """
    ✅ FIX: VMS dedup now strictly by model='VMS Host' — prevents duplicates on IP change.
    ✅ NEW: Persists uptime + last_reboot to VMS node for frontend display.
    """
    # Purge any existing web_device entries and their edges from database
    nodes_col.delete_many({"type": "web_device"})
    db["infrastructure_edges"].delete_many({
        "$or": [
            {"source": {"$regex": ".*web-device.*"}},
            {"target": {"$regex": ".*web-device.*"}}
        ]
    })

    from .scanner import scanner
    cams_col = db["cameras"]
    cameras = list(cams_col.find({}))

    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        local_ip = "127.0.0.1"

    uptime_str, last_reboot = _get_uptime_info()

    # ✅ KEY FIX: Dedup by model only, not IP
    existing_host = nodes_col.find_one({"model": "VMS Host"})
    if not existing_host:
        vms_node = {
            "ip": local_ip, "type": "server", "manufacturer": "Mirador",
            "model": "VMS Host", "latency": 0,
            "uptime": uptime_str, "last_reboot": last_reboot,
            "last_seen": datetime.utcnow()
        }
        save_discovered_nodes([vms_node])
    else:
        nodes_col.update_one(
            {"model": "VMS Host"},
            {"$set": {"uptime": uptime_str, "last_reboot": last_reboot, "ip": local_ip}}
        )

    discovered = []
    for cam in cameras:
        ip = cam.get("ip")
        if not ip:
            continue
        latency = scanner.ping_device(ip)
        if latency < 0:
            is_reachable = any(
                scanner.probe_port(ip, p) for p in [80, 554, 8080, 8000, 8081, 8899]
            )
            latency = 1 if is_reachable else None
        discovered.append({
            "ip": ip, "type": "camera",
            "manufacturer": cam.get("manufacturer", ""),
            "model": cam.get("model", ""),
            "latency": latency, "last_seen": datetime.utcnow()
        })

    save_discovered_nodes(discovered)
    print(f"[HEALTH] Seeded topology with {len(discovered)} cameras and VMS host.")
