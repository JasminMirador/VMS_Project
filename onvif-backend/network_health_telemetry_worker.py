"""
Network Health telemetry persistence worker.

Run from the onvif-backend project directory:
    python network_health_telemetry_worker.py or python run_api.py

it is a standalone background worker script designed to collect, process, and persist camera network telemetry into MongoDB.
Specifically, it performs three tasks:
1.Ensures Database Indexes: Automatically builds compound indexes on the 
camera_bandwidth_history collection (camera_id + timestamp and source_measurement_timestamp) to ensure query speed and prevent duplicate data.
2.Probes Camera Streams: Connects to registered cameras via MediaMTX to measure live throughput (bitrate in Mbps, FPS, resolution, dropped frames, and stream health).
3.Persists Live & Historical Records into MongoDB: Writes new timestamped bitrate measurements into camera_bandwidth_history and updates node states in infrastructure_nodes. It also runs 
_sync_recordings_telemetry()
 to sync MP4 recording dates from recordings into the timeline.
"""
import asyncio
import os
import signal
import sys
import time
from datetime import datetime, timezone

from app.core.database import db, cameras_col
from app.api.routers.network_health_router import _persist_new_camera_measurements, _sync_recordings_telemetry
from monitoring.stream_health import probe_camera_stream

POLL_SECONDS = 10


def ensure_indexes(database):
    """Ensure optimized indexes on camera_bandwidth_history for queries and idempotency."""
    if database is None:
        return
    try:
        col = database["camera_bandwidth_history"]
        col.create_index([("camera_id", 1), ("timestamp", -1)])
        col.create_index([("timestamp", -1)])
        col.create_index([("camera_id", 1), ("source_measurement_timestamp", 1)])
    except Exception as e:
        print(f"[NETWORK-HEALTH-WORKER] Warning ensuring indexes: {e}")


async def poll_and_persist_once(database, cameras_collection):
    """Perform one polling and persistence cycle."""
    if database is None:
        print("[NETWORK-HEALTH-WORKER] Error: Database is disconnected. Skipping cycle.")
        return 0, 0

    if cameras_collection is not None:
        registered = list(cameras_collection.find({"is_deleted": {"$ne": True}}))
    else:
        registered = list(database["cameras"].find({"is_deleted": {"$ne": True}}))

    nodes_col = database["infrastructure_nodes"]
    probes = []
    target_nodes = []

    for cam in registered:
        cip = cam.get("ip_address") or cam.get("ip") or ""
        cid = str(cam.get("_id"))
        node_id = f"node-{cip.replace('.', '-')}" if cip else cid

        # Find or initialize node in infrastructure_nodes
        node = nodes_col.find_one({"$or": [{"ip": cip}, {"id": node_id}]})
        if not node:
            node = {
                "id": node_id,
                "ip": cip,
                "type": "camera",
                "manufacturer": cam.get("manufacturer", "Unknown"),
                "model": cam.get("device_name") or cam.get("name") or cam.get("model", "Camera"),
                "status": cam.get("status", "online"),
                "stream_status": "unknown",
                "stream_key": cam.get("stream_key") or cip.replace(".", "_"),
                "sub_stream_key": cam.get("sub_stream_key"),
                "username": cam.get("username", "") or cam.get("user", ""),
                "password": cam.get("password", "") or cam.get("pass", ""),
            }
            try:
                nodes_col.insert_one(node)
            except Exception:
                pass

        target_nodes.append((cam, node))
        probes.append(probe_camera_stream(node))

    if probes:
        results = await asyncio.gather(*probes, return_exceptions=True)
        for (cam, node), res in zip(target_nodes, results):
            if isinstance(res, Exception):
                print(f"[NETWORK-HEALTH-WORKER] Probe failed for {cam.get('ip')}: {res}")
            elif isinstance(res, dict):
                try:
                    nodes_col.update_one({"id": node["id"]}, {"$set": res})
                except Exception as update_err:
                    print(f"[NETWORK-HEALTH-WORKER] Failed updating node {node['id']}: {update_err}")

    inserted = _persist_new_camera_measurements(database, registered)
    try:
        recs_synced = _sync_recordings_telemetry(database)
        inserted += recs_synced
    except Exception as e:
        print(f"[NETWORK-HEALTH-WORKER] Note during recordings telemetry sync: {e}")

    return len(registered), inserted


def main():
    if db is None:
        raise RuntimeError("MongoDB is not configured or connected; verify app.core.database and .env")

    ensure_indexes(db)
    print("[NETWORK-HEALTH-WORKER] Started; collecting and storing verified camera telemetry.")
    print(f"[NETWORK-HEALTH-WORKER] Polling interval: {POLL_SECONDS}s. Press Ctrl+C to stop.")

    running = True

    def _sig_handler(sig, frame):
        nonlocal running
        running = False
        print("\n[NETWORK-HEALTH-WORKER] Stopping gracefully...")

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        while running:
            started = time.monotonic()
            try:
                checked_count, inserted_count = loop.run_until_complete(
                    poll_and_persist_once(db, cameras_col)
                )
                now_str = datetime.now(timezone.utc).isoformat()
                if inserted_count > 0:
                    print(f"[NETWORK-HEALTH-WORKER] {now_str} checked {checked_count} registered cameras; persisted {inserted_count} new measurements.")
                else:
                    print(f"[NETWORK-HEALTH-WORKER] {now_str} checked {checked_count} registered cameras; 0 new measurements (source unchanged or awaiting new reading).")
            except Exception as exc:
                print(f"[NETWORK-HEALTH-WORKER] Recoverable error in worker cycle: {exc}")

            elapsed = time.monotonic() - started
            sleep_dur = max(0.5, POLL_SECONDS - elapsed)
            sleep_end = time.monotonic() + sleep_dur
            while running and time.monotonic() < sleep_end:
                time.sleep(0.5)

    except KeyboardInterrupt:
        pass
    finally:
        loop.close()
        print("[NETWORK-HEALTH-WORKER] Stopped.")


if __name__ == "__main__":
    main()