from fastapi import Path, APIRouter, Request
from .health import nodes_col, db, alerts_col
from .scheduler import scheduler
from .metrics import get_system_metrics
from datetime import datetime

router = APIRouter(prefix="/api/infrastructure", tags=["infrastructure"])


@router.post("/scan")
async def trigger_scan(subnet: str = None):
    scheduler.trigger_scan(subnet)
    return {"message": "Scan triggered in background"}


@router.get("/topology")
async def get_topology():
    nodes = list(nodes_col.find({}, {"_id": 0}))
    edges_col = db["infrastructure_edges"]
    edges = list(edges_col.find({}, {"_id": 0}))
    return {"nodes": nodes, "edges": edges}


# ─── NEW: Single node detail endpoint ────────────────────────────────────────
# Returns the full document for one node — includes stream_bitrate_mbps,
# stream_fps, stream_resolution, codec, dropped_frames, rtsp_connected,
# onvif_connected, recording, stream_status, stream_last_polled, etc.
@router.get("/nodes/{node_id}")
async def get_node(node_id: str = Path(..., max_length=255)):
    """Return full node document by id (e.g. 'node-192-168-126-236')."""
    node = nodes_col.find_one({"id": node_id}, {"_id": 0})
    if not node:
        # Try matching by IP in case node_id was passed as an IP string
        node = nodes_col.find_one({"ip": node_id}, {"_id": 0})
    if not node:
        from fastapi import Path, HTTPException
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")
    # Serialize datetimes
    for key, val in node.items():
        if isinstance(val, datetime):
            node[key] = val.isoformat()
    return node


@router.get("/health")
async def get_health():
    nodes = list(nodes_col.find(
        {}, {"_id": 0, "id": 1, "ip": 1, "status": 1, "latency": 1}
    ))
    return nodes


@router.get("/metrics")
async def get_metrics():
    """Returns system metrics: CPU, RAM, disk, GPU, uptime, last_reboot."""
    data = await get_system_metrics()
    return data or {}


@router.get("/alerts")
async def get_alerts(
    limit: int = 50,
    unacknowledged_only: bool = False,
    from_date: str = None,
    to_date: str = None
):
    """Returns recent alerts, optionally filtered to unacknowledged or a date range."""
    query = {"acknowledged": False} if unacknowledged_only else {}
    
    if from_date or to_date:
        query["timestamp"] = {}
        if from_date:
            try:
                norm_from = from_date.replace("Z", "+00:00").replace(" ", "T")
                query["timestamp"]["$gte"] = datetime.fromisoformat(norm_from)
            except Exception:
                pass
        if to_date:
            try:
                norm_to = to_date.replace("Z", "+00:00").replace(" ", "T")
                query["timestamp"]["$lte"] = datetime.fromisoformat(norm_to)
            except Exception:
                pass

    alerts = list(
        alerts_col.find(query, {"_id": 0})
        .sort("timestamp", -1)
        .limit(limit)
    )
    for a in alerts:
        if isinstance(a.get("timestamp"), datetime):
            a["timestamp"] = a["timestamp"].isoformat()
    return alerts


@router.post("/alerts/{node_id}/acknowledge")
async def acknowledge_alert(node_id: str = Path(..., max_length=255)):
    """Mark all alerts for a node as acknowledged."""
    result = alerts_col.update_many(
        {"node_id": node_id, "acknowledged": False},
        {"$set": {"acknowledged": True}}
    )
    return {"acknowledged": result.modified_count}


@router.get("/bandwidth")
async def get_bandwidth_history():
    """Returns last 100 bandwidth + device diagnostics snapshots."""
    diag_col = db["network_diagnostics"]
    records = list(
        diag_col.find({}, {"_id": 0})
        .sort("timestamp", -1)
        .limit(100)
    )
    for r in records:
        if isinstance(r.get("timestamp"), datetime):
            r["timestamp"] = r["timestamp"].isoformat()
        if r.get("bandwidth") and isinstance(r["bandwidth"].get("timestamp"), datetime):
            r["bandwidth"]["timestamp"] = r["bandwidth"]["timestamp"].isoformat()
    return records


@router.patch("/nodes/{node_id}")
async def update_node(request: Request, node_id: str = Path(..., max_length=255)):
    data = await request.json()
    allowed_keys = ["position", "label", "manufacturer", "model"]
    filtered_data = {k: v for k, v in data.items() if k in allowed_keys}
    if not filtered_data:
        return {"success": False, "message": "No valid fields to update"}
    nodes_col.update_one({"id": node_id}, {"$set": filtered_data})
    return {"success": True}


@router.post("/edges")
async def create_edge(request: Request):
    data = await request.json()
    edges_col = db["infrastructure_edges"]
    existing = edges_col.find_one({"source": data["source"], "target": data["target"]})
    if existing:
        return {"success": False, "message": "Edge already exists"}
    edges_col.insert_one({
        "source": data["source"], "target": data["target"],
        "type": data.get("type", "default"), "inferred": data.get("inferred", False)
    })
    return {"success": True}


@router.delete("/edges")
async def delete_edge(source: str, target: str):
    edges_col = db["infrastructure_edges"]
    edges_col.delete_one({"source": source, "target": target})
    return {"success": True}


@router.post("/reset")
async def reset_topology():
    """Resets all node positions to None (unplaced) and deletes all edges."""
    nodes_col.update_many({}, {"$set": {"position": None}})
    edges_col = db["infrastructure_edges"]
    edges_col.delete_many({})
    return {"success": True}


@router.post("/edges/clear")
async def clear_edges():
    """Deletes all edges (connections) in the topology."""
    edges_col = db["infrastructure_edges"]
    edges_col.delete_many({})
    return {"success": True}


