from app.core.database import mongo_client
import os
import asyncio
from .websocket_manager import manager

MONGO_URI = os.environ["MONGO_URI"]
client = mongo_client
db = client[os.environ.get("MONGO_DB_NAME")] if client else None

if db is not None:
    nodes_col = db["infrastructure_nodes"]
    edges_col = db["infrastructure_edges"]
else:
    nodes_col = None
    edges_col = None


def _broadcast_safe(payload: dict):
    """Thread-safe WebSocket broadcast from synchronous context."""
    loop = manager.loop if hasattr(manager, 'loop') and manager.loop else None
    if not loop:
        try:
            loop = asyncio.get_event_loop()
        except Exception:
            pass

    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(manager.broadcast(payload), loop)


def run_root_cause_analysis():
    """
    Analyzes nodes and edges.
    - If a switch has >50% offline children but is itself online → mark as DEGRADED.
    - If a node is offline → its children are effectively unreachable.
    After analysis, runs auto topology linking.
    """
    nodes = {n["id"]: n for n in nodes_col.find({})}
    edges = list(edges_col.find({}))

    # Build parent → children map
    topology = {}
    for edge in edges:
        parent = edge["source"]
        child = edge["target"]
        topology.setdefault(parent, []).append(child)

    changed_nodes = []

    for parent_id, children_ids in topology.items():
        parent_node = nodes.get(parent_id)
        if not parent_node:
            continue

        offline_children = [
            cid for cid in children_ids
            if nodes.get(cid, {}).get("status") == "offline"
        ]

        # If >50% children offline but parent is online → mark DEGRADED
        if (
            len(children_ids) > 1
            and len(offline_children) / len(children_ids) >= 0.5
            and parent_node.get("status") == "online"
        ):
            nodes_col.update_one(
                {"id": parent_id},
                {"$set": {"status": "degraded"}}
            )
            changed_nodes.append(parent_id)
            print(f"[INFERENCE] Parent {parent_id} marked as DEGRADED (high child failure rate)")

    # ✅ FIX #3: Broadcast node status changes to frontend
    for node_id in changed_nodes:
        try:
            _broadcast_safe({
                "type": "NODE_UPDATE",
                "id": node_id,
                "data": {"status": "degraded"}
            })
        except Exception as e:
            print(f"[INFERENCE] Broadcast error for {node_id}: {e}")

    # Run auto-topology linking
    run_auto_topology()


def run_auto_topology():
    """
    Automatically links orphaned cameras/devices to the VMS server node.
    ✅ FIX #3: Broadcasts TOPOLOGY_UPDATE after linking so frontend map refreshes.
    """
    nodes = list(nodes_col.find({}))
    server_node = next((n for n in nodes if n.get("type") == "server"), None)

    if not server_node:
        return

    server_id = server_node["id"]

    # Get all existing child targets
    existing_edges = list(edges_col.find({}))
    children = {e["target"] for e in existing_edges}

    linked_count = 0
    for node in nodes:
        node_id = node["id"]

        # Skip server itself or already-parented nodes
        if node_id == server_id or node_id in children:
            continue

        if node.get("type") in ["camera", "unknown", "web_device"]:
            edges_col.update_one(
                {"source": server_id, "target": node_id},
                {"$set": {
                    "source": server_id,
                    "target": node_id,
                    "type": "default",
                    "inferred": True
                }},
                upsert=True
            )
            linked_count += 1
            print(f"[INFERENCE] Auto-linked {node_id} to server {server_id}")

    # ✅ FIX #3: Broadcast topology refresh if anything was linked
    if linked_count > 0:
        try:
            _broadcast_safe({
                "type": "TOPOLOGY_UPDATE",
                "count": linked_count
            })
        except Exception as e:
            print(f"[INFERENCE] Topology broadcast error: {e}")
