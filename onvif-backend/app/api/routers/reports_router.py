from fastapi import Path, APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime, timezone, timedelta
from app.core.database import mongo_client
import os

router = APIRouter(prefix="/api/reports", tags=["Reports"])

MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME")
db = mongo_client[MONGO_DB_NAME] if mongo_client else None
uptime_events_col = db["uptime_events"] if db is not None else None
cameras_col = db["cameras"] if db is not None else None
nodes_col = db["infrastructure_nodes"] if db is not None else None

def get_initial_state(node_id: str, event_type: str, from_date: datetime):
    if uptime_events_col is None:
        return "down"
    
    # Try to find the last event before from_date
    last_event = uptime_events_col.find_one(
        {"node_id": node_id, "event_type": event_type, "timestamp": {"$lt": from_date}},
        sort=[("timestamp", -1)]
    )
    if last_event:
        return last_event["state"]
    
    # If no event, we assume it was DOWN unless its current state is UP and there's no DOWN event since then
    # But it's simpler to just query its current state from nodes_col as a best effort
    if nodes_col is not None:
        node = nodes_col.find_one({"id": node_id})
        if node:
            if event_type == "camera":
                status = node.get("stream_status")
                return "up" if status in ["healthy", "degraded", "auth_required"] else "down"
            elif event_type == "recording":
                return "up" if node.get("recording") else "down"
    return "down"

@router.get("/history")
async def get_camera_history(
    from_date: str = Query(..., description="Start date in ISO format"),
    # to_date: str = Query(..., description="End date in ISO format")
    to_date: str = Query(..., description="End date in ISO format"),
    live_only: bool = Query(False, description="Filter for live/healthy cameras only")
):
    if db is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    try:
        start_dt = datetime.fromisoformat(from_date.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(to_date.replace("Z", "+00:00"))
        
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
            
        now_dt = datetime.now(timezone.utc)
        if end_dt > now_dt:
            end_dt = now_dt
            
        if start_dt > end_dt:
            start_dt = end_dt
            
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO format.")

    query = {}
    all_cameras_raw = list(cameras_col.find(query, {"_id": 0, "ip": 1, "name": 1, "model": 1}))
    # Deduplicate cameras by IP to prevent double-counting in reports
    seen_ips = set()
    all_cameras = []
    for cam in all_cameras_raw:
        ip = cam.get("ip")
        if ip and ip not in seen_ips:
            seen_ips.add(ip)
            all_cameras.append(cam)

    all_nodes = {n["id"]: n for n in nodes_col.find({})} if nodes_col is not None else {}

    if live_only:
        live_cams = []
        for cam in all_cameras:
            node_id = f"node-{cam.get('ip', '').replace('.', '-')}"
            node = all_nodes.get(node_id)
            if node and node.get("stream_status") in ["healthy", "auth_required"]:
                live_cams.append(cam)
        all_cameras = live_cams

    recordings_col = db["recordings"] if db is not None else None
    uptime_snapshots_col = db["uptime_snapshots"] if db is not None else None
    
    # 1. Bulk recording aggregate durations
    rec_durations = {}
    if recordings_col is not None:
        rec_agg = list(recordings_col.aggregate([
            {"$match": {
                "created_at": {"$gte": start_dt, "$lte": end_dt},
                "status": {"$in": ["COMPLETE", "UPLOADING", "INCOMPLETE", "COMPOSING"]}
            }},
            {"$group": {
                "_id": "$camera_id",
                "total_duration": {"$sum": "$duration_seconds"},
                "total_size": {"$sum": "$file_size"}
            }}
        ]))
        rec_durations = {item["_id"]: {"duration": item["total_duration"], "size": item.get("total_size", 0)} for item in rec_agg if item["_id"]}

    # 2. Bulk initial states before start_dt
    initial_states = {}
    if uptime_events_col is not None:
        init_agg = list(uptime_events_col.aggregate([
            {"$match": {
                "timestamp": {"$lt": start_dt}
            }},
            {"$sort": {"timestamp": 1}},
            {"$group": {
                "_id": {
                    "node_id": "$node_id",
                    "event_type": "$event_type"
                },
                "state": {"$last": "$state"}
            }}
        ]))
        initial_states = {(item["_id"]["node_id"], item["_id"]["event_type"]): item["state"] for item in init_agg}

    # 3. Bulk uptime snapshots fallback
    uptime_snapshots_by_node = {}
    if uptime_snapshots_col is not None:
        uptime_snapshots_by_node = {s["node_id"]: s for s in uptime_snapshots_col.find({})}

    # 4. Bulk events in range (with dedup for duplicate events from multiple monitors)
    events_by_node_raw = {}
    if uptime_events_col is not None:
        events_list = list(uptime_events_col.find({
            "timestamp": {"$gte": start_dt, "$lte": end_dt}
        }).sort("timestamp", 1))
        for ev in events_list:
            nid = ev.get("node_id")
            if nid:
                events_by_node_raw.setdefault(nid, []).append(ev)
    
    # Deduplicate: remove consecutive events with same event_type + state
    # (caused by health.py and stream_health.py both logging the same transition)
    events_by_node = {}
    for nid, evts in events_by_node_raw.items():
        deduped = []
        for ev in evts:
            key = (ev.get("event_type"), ev.get("state"))
            if deduped:
                last_key = (deduped[-1].get("event_type"), deduped[-1].get("state"))
                if key == last_key:
                    continue  # Skip duplicate consecutive event
            deduped.append(ev)
        events_by_node[nid] = deduped

    def get_bulk_initial_state(node_id: str, event_type: str):
        state = initial_states.get((node_id, event_type))
        if state:
            return state
        node = all_nodes.get(node_id)
        if node:
            if event_type == "camera":
                status = node.get("stream_status")
                return "up" if status in ["healthy", "degraded", "auth_required"] else "down"
            elif event_type == "recording":
                return "up" if node.get("recording") else "down"
        return "up"
    
    report_data = []

    for cam in all_cameras:
        ip = cam.get("ip")
        if not ip:
            continue
            
        node_id = f"node-{ip.replace('.', '-')}"
        cam_name = cam.get("name", ip)
        cam_id = ip.replace('.', '_')
        
        total_window_hours = (end_dt - start_dt).total_seconds() / 3600.0
        if total_window_hours < 0:
            total_window_hours = 0
            
        # 1. Recording UP/DOWN calculation based on bulk durations
        rec_data = rec_durations.get(cam_id, {"duration": 0.0, "size": 0})
        rec_duration = rec_data["duration"]
        storage_bytes = rec_data["size"]
        
        rec_up = min(total_window_hours, rec_duration / 3600.0)
        rec_down = max(0.0, total_window_hours - rec_up)
        
        # 2. Camera UP/DOWN calculation based on bulk events
        cam_events = events_by_node.get(node_id, [])
        cam_history_events = [e for e in cam_events if e.get("event_type") == "camera"]
        
        if cam_history_events:
            def calc_hours(events_list, e_type):
                current_time = start_dt
                current_state = get_bulk_initial_state(node_id, e_type)
                total_up = 0.0
                total_down = 0.0
                
                for ev in events_list:
                    ev_time = ev["timestamp"]
                    if ev_time.tzinfo is None:
                        ev_time = ev_time.replace(tzinfo=timezone.utc)
                    
                    delta_hours = (ev_time - current_time).total_seconds() / 3600.0
                    if current_state == "up":
                        total_up += delta_hours
                    else:
                        total_down += delta_hours
                        
                    current_time = ev_time
                    current_state = ev.get("state", "down")
                    
                if end_dt > current_time:
                    delta_hours = (end_dt - current_time).total_seconds() / 3600.0
                    if current_state == "up":
                        total_up += delta_hours
                    else:
                        total_down += delta_hours
                        
                return round(total_up, 2), round(total_down, 2)
            
            cam_up, cam_down = calc_hours(cam_history_events, "camera")
        else:
            cam_down = 0.0
            if uptime_snapshots_col is not None:
                snapshot = uptime_snapshots_by_node.get(node_id)
                if snapshot:
                    downtime_secs = snapshot.get("total_downtime_seconds", 0)
                    if snapshot.get("downtime_start"):
                        ds = snapshot["downtime_start"]
                        if ds.tzinfo is None:
                            ds = ds.replace(tzinfo=timezone.utc)
                        if ds < end_dt:
                            downtime_secs += (end_dt - ds).total_seconds()
                    
                    cam_down = downtime_secs / 3600.0
                    if cam_down > total_window_hours:
                        cam_down = total_window_hours
            
            cam_up = max(0.0, total_window_hours - cam_down)

        # Enforce physical consistency: Camera UP time cannot be less than Recording UP time
        if cam_up < rec_up:
            cam_up = rec_up
            cam_down = max(0.0, total_window_hours - cam_up)

        def format_event(e):
            return {
                "state": e["state"].upper(),
                "timestamp": e["timestamp"].isoformat()
            }

        report_data.append({
            "ip": ip,
            "name": cam_name,
            "camera_hours_up": round(cam_up, 2),
            "camera_hours_down": round(cam_down, 2),
            "recording_hours_up": round(rec_up, 2),
            "recording_hours_down": round(rec_down, 2),
            "storage_consumed_bytes": storage_bytes,
            "camera_events": [format_event(e) for e in cam_history_events],
            "recording_events": []
        })

    return {"status": "success", "data": report_data}
