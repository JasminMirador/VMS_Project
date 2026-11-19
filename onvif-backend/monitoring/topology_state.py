class TopologyState:
    def __init__(self):
        self.nodes = []
        self.edges = []
        
    def update_nodes_from_scan(self, scan_results):
        existing_nodes = {n.get("id"): n for n in self.nodes}
        new_nodes = []
        for r in scan_results:
            nid = f"node-{r['ip'].replace('.', '-')}"
            node = {
                "id": nid,
                "ip": r["ip"],
                "type": r["type"],
                "manufacturer": r.get("manufacturer", ""),
                "model": r.get("model", ""),
                "status": r.get("status", "online")
            }
            if nid in existing_nodes:
                old = existing_nodes[nid]
                if "position" in old:
                    node["position"] = old["position"]
                if "label" in old:
                    node["label"] = old["label"]
            new_nodes.append(node)
        self.nodes = new_nodes

topology_state = TopologyState()
