"""
debug_stream.py — Run this DIRECTLY on your server to diagnose why
stream data isn't appearing. It bypasses the async loop and tests each
step individually.

Usage:
    cd /path/to/your/backend
    python debug_stream.py
"""
import socket
import subprocess
import sys
import os

MONGO_URI = os.environ["MONGO_URI"]

print("=" * 60)
print("STREAM HEALTH DEBUG")
print("=" * 60)

# ── Step 1: Check MongoDB connection and camera nodes ────────────
print("\n[1] Checking MongoDB...")
try:
    from app.core.database import mongo_client
    client = mongo_client
    client.server_info()
    db = client[os.environ.get("MONGO_DB_NAME")]
    
    cameras = list(db["infrastructure_nodes"].find({"type": "camera"}, {"_id": 0, "id": 1, "ip": 1, "username": 1, "password": 1, "stream_status": 1, "stream_fps": 1}))
    print(f"    ✅ Connected. Found {len(cameras)} camera node(s) in infrastructure_nodes:")
    for c in cameras:
        print(f"       id={c.get('id')}  ip={c.get('ip')}  user={c.get('username','-')}  stream_status={c.get('stream_status','-')}  fps={c.get('stream_fps','-')}")
    
    if not cameras:
        print("    ❌ NO CAMERAS FOUND in infrastructure_nodes with type='camera'")
        print("       Check: does your topology scan populate this collection?")
        # Show what IS in there
        all_nodes = list(db["infrastructure_nodes"].find({}, {"_id": 0, "id": 1, "ip": 1, "type": 1}))
        print(f"       All nodes ({len(all_nodes)}):")
        for n in all_nodes:
            print(f"         {n}")
        sys.exit(1)
except Exception as e:
    print(f"    ❌ MongoDB failed: {e}")
    sys.exit(1)

# ── Step 2: TCP port check on each camera ───────────────────────
print("\n[2] Checking TCP ports for each camera...")
def tcp_check(ip, port, timeout=2):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        result = s.connect_ex((ip, port))
        s.close()
        return result == 0
    except:
        return False

for cam in cameras:
    ip = cam.get("ip")
    if not ip:
        continue
    rtsp  = tcp_check(ip, 554)
    http  = tcp_check(ip, 80)
    onvif = tcp_check(ip, 8080)
    print(f"    {ip}:  RTSP(554)={'✅' if rtsp else '❌'}  HTTP(80)={'✅' if http else '❌'}  ONVIF(8080)={'✅' if onvif else '❌'}")

# ── Step 3: Raw RTSP OPTIONS request ────────────────────────────
print("\n[3] Sending RTSP OPTIONS to each camera...")
for cam in cameras:
    ip = cam.get("ip")
    if not ip or not tcp_check(ip, 554):
        print(f"    {ip}: RTSP port closed — skipping")
        continue
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(4)
        s.connect((ip, 554))
        req = f"OPTIONS rtsp://{ip}:554/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: DebugTool/1.0\r\n\r\n"
        s.send(req.encode())
        resp = s.recv(1024).decode("utf-8", errors="ignore")
        s.close()
        first_line = resp.split("\r\n")[0] if resp else "(empty)"
        print(f"    {ip}: Response → {first_line}")
        if "401" in resp:
            print(f"           ⚠ Auth required — need username/password for full probe")
        elif "200" in resp:
            print(f"           ✅ RTSP alive and responding")
    except Exception as e:
        print(f"    {ip}: RTSP error → {e}")

# ── Step 4: Check if stream_health fields are in MongoDB ────────
print("\n[4] Checking stream fields in infrastructure_nodes...")
stream_fields = ["stream_bitrate_mbps", "stream_fps", "stream_resolution", 
                 "stream_status", "codec", "dropped_frames", 
                 "rtsp_connected", "onvif_connected", "recording"]
for cam in cameras:
    ip = cam.get("ip")
    node = db["infrastructure_nodes"].find_one({"ip": ip}, {"_id": 0})
    if not node:
        print(f"    {ip}: Node not found!")
        continue
    print(f"    {ip}:")
    for f in stream_fields:
        val = node.get(f)
        status = "✅" if val is not None else "❌ None"
        print(f"      {f:25s} = {status if val is None else val}")

# ── Step 5: Check if stream_health.py loop is actually running ──
print("\n[5] Checking if stream_health loop wrote anything recently...")
for cam in cameras:
    ip = cam.get("ip")
    node = db["infrastructure_nodes"].find_one({"ip": ip}, {"_id": 0, "stream_last_polled": 1})
    polled = node.get("stream_last_polled") if node else None
    if polled:
        print(f"    {ip}: Last polled at {polled} ✅")
    else:
        print(f"    {ip}: stream_last_polled = None ❌ — stream_health loop has NEVER written to this node")
        print(f"           → stream_health.py is either not running or erroring silently")

# ── Step 6: Check camera credentials in nodes vs cameras col ────
print("\n[6] Cross-checking credentials between cameras and infrastructure_nodes...")
for cam in cameras:
    ip = cam.get("ip")
    cam_doc = db["cameras"].find_one({"ip": ip}, {"_id": 0, "username": 1, "password": 1})
    node_doc = db["infrastructure_nodes"].find_one({"ip": ip}, {"_id": 0, "username": 1, "password": 1})
    cam_user = cam_doc.get("username", "") if cam_doc else "NOT IN cameras"
    node_user = node_doc.get("username", "") if node_doc else "NOT IN nodes"
    print(f"    {ip}: cameras.username={cam_user!r}  nodes.username={node_user!r}")
    if cam_user and not node_user:
        print(f"           ⚠ Credentials exist in cameras but NOT in infrastructure_nodes!")
        print(f"           → stream_health.py won't be able to auth. Run the credential migration.")

print("\n" + "=" * 60)
print("DEBUG COMPLETE")
print("=" * 60)