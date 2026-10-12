import psutil
import time
import asyncio
import os
import platform
import re
from datetime import datetime
from app.core.database import mongo_client

MONGO_URI       = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB_NAME   = os.environ.get("MONGO_DB_NAME", "vms_demo")


def _get_db():
    """Lazily resolve the DB and collections so the import doesn't crash
    when mongo_client is still None (e.g. MongoDB not yet reachable)."""
    if mongo_client is None:
        raise RuntimeError("MongoDB client is not available yet")
    _db = mongo_client[MONGO_DB_NAME]
    return _db, _db["network_diagnostics"], _db["infrastructure_nodes"]


async def ping_host(host):
    """Returns (avg_latency_ms, packet_loss_pct) or (None, 100) if unreachable."""
    if platform.system().lower() == "windows":
        command = ["ping", "-n", "1", "-w", "500", host]
    else:
        command = ["ping", "-c", "1", "-W", "1", host]

    start = time.time()
    try:
        proc = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        end    = time.time()
        output = stdout.decode("utf-8", errors="ignore")

        if proc.returncode == 0 or (
            platform.system().lower() == "windows" and "Reply from" in output
        ):
            loss    = 0
            latency = round((end - start) * 1000, 2)

            if platform.system().lower() == "windows":
                loss_match = re.search(r"\((\d+)% loss\)", output)
                lat_match  = re.search(r"Average = (\d+)ms", output)
                if loss_match: loss    = int(loss_match.group(1))
                if lat_match:  latency = float(lat_match.group(1))
            else:
                loss_match = re.search(r"(\d+)% packet loss", output)
                lat_match  = re.search(r"min/avg/max/mdev = [\d.]+/([\d.]+)", output)
                if loss_match: loss    = int(loss_match.group(1))
                if lat_match:  latency = float(lat_match.group(1))

            return latency, loss
        return None, 100
    except Exception:
        return None, 100

async def check_port(host, port, timeout=0.5):
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=timeout
        )
        writer.close()
        await writer.wait_closed()
        return True
    except Exception:
        return False

async def get_bandwidth():
    io1 = psutil.net_io_counters()
    await asyncio.sleep(0.5)
    io2 = psutil.net_io_counters()
    sent = io2.bytes_sent - io1.bytes_sent
    recv = io2.bytes_recv - io1.bytes_recv
    return {
        "sent_kbps": round((sent * 8) / 1024, 2),
        "recv_kbps": round((recv * 8) / 1024, 2),
        "timestamp": datetime.utcnow()
    }

async def run_diagnostics_loop():
    """Background loop: pings every camera, checks ports, writes results to
    infrastructure_nodes so the frontend Details sidebar shows live values."""
    print("[DIAGNOSTICS] Starting Real-Time Network Health Monitor...")

    while True:
        try:
            db, diagnostics_col, nodes_col = _get_db()

            cameras = await asyncio.to_thread(lambda: list(db["cameras"].find({}, {"_id": 0, "ip": 1, "name": 1})))

            stats = []
            for cam in cameras:
                ip = cam.get("ip")
                if not ip:
                    continue

                (latency, packet_loss), rtsp, http, onvif = await asyncio.gather(
                    ping_host(ip),
                    check_port(ip, 554, timeout=0.5),
                    check_port(ip, 80, timeout=0.5),
                    check_port(ip, 8080, timeout=0.5)
                )

                is_online = latency is not None or rtsp or http or onvif
                stats.append({
                    "ip":          ip,
                    "name":        cam.get("name"),
                    "latency":     latency if latency is not None else (5.0 if is_online else None),
                    "packet_loss": packet_loss if latency is not None else (0 if is_online else 100),
                    "ports":       {"rtsp": rtsp, "http": http, "onvif": onvif},
                    "status":      "Online" if is_online else "Offline"
                })

            for stat in stats:
                ip      = stat["ip"]
                node_id = f"node-{ip.replace('.', '-')}"

                node_fields = {
                    "latency":         stat["latency"],
                    "packet_loss":     stat["packet_loss"],
                    "onvif_connected": stat["ports"]["onvif"],
                    "rtsp_connected":  stat["ports"]["rtsp"],
                }

                def _update_node(_nodes_col=nodes_col, _node_id=node_id, _node_fields=node_fields, _stat=stat):
                    existing = _nodes_col.find_one({"id": _node_id}, {"stream_status": 1, "_id": 0})
                    if existing and not existing.get("stream_status"):
                        _node_fields["stream_status"] = "degraded" if _stat["ports"]["rtsp"] else "dead"
                    _nodes_col.update_one({"id": _node_id}, {"$set": _node_fields})

                await asyncio.to_thread(_update_node)

            bandwidth = await get_bandwidth()
            report = {
                "devices":   stats,
                "bandwidth": bandwidth,
                "timestamp": datetime.utcnow()
            }
            def _save_report(_diag_col=diagnostics_col):
                _diag_col.insert_one(report)
                if _diag_col.count_documents({}) > 100:
                    oldest = _diag_col.find_one(sort=[("_id", 1)])
                    if oldest:
                        _diag_col.delete_one({"_id": oldest["_id"]})

            await asyncio.to_thread(_save_report)

        except Exception as e:
            print(f"[DIAGNOSTICS ERROR] {e}")

        await asyncio.sleep(15)

