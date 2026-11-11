# discovery_host.py
# Run this ONCE on Windows host: python discovery_host.py
# Keep it running alongside Docker

from http.server import HTTPServer, BaseHTTPRequestHandler
import socket
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

SUBNET  = os.environ.get("HOST_SUBNET")
PORTS   = [int(os.environ.get('RTSP_PORT'))]   # Scan RTSP port to prevent WSL2 NAT congestion/packet drops
TIMEOUT = 1.5     # Increased to 1.5s to account for virtualization latency
MAX_WORKERS = 100 # Reduced from 200 to lower connection rate and avoid firewalls/NAT limit

def check(ip, port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(TIMEOUT)
            return ip if s.connect_ex((ip, port)) == 0 else None
    except:
        return None

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        subnet = os.environ.get("HOST_SUBNET", SUBNET)
        targets = [(f"{subnet}.{i}", p) for i in range(1, 255) for p in PORTS]
        found   = set()
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            for f in as_completed({ex.submit(check, ip, p) for ip, p in targets}):
                r = f.result()
                if r:
                    found.add(r)
        body = json.dumps({"ips": sorted(found)}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)
        
    def log_message(self, *a):
        print(f"[HOST-SCAN] Scan done — {a}")

def start_discovery_host_server():
    def run_server():
        try:
            subnet = os.environ.get("HOST_SUBNET", SUBNET)
            host = os.environ.get("DISCOVERY_HOST_BIND", "0.0.0.0")
            port = int(os.environ.get("DISCOVERY_HOST_PORT"))
            server = HTTPServer((host, port), H)
            print(f"[HOST-SCAN] Running on port {port} (subnet={subnet})")
            server.serve_forever()
        except OSError as e:
            print(f"[HOST-SCAN] ⚠ Port {os.environ.get('DISCOVERY_HOST_PORT')} already in use or unavailable: {e}. Skipping host-scan server startup.")

    t = threading.Thread(target=run_server, daemon=True)
    t.start()

if __name__ == "__main__":
    subnet = os.environ.get("HOST_SUBNET", SUBNET)
    host = os.environ.get("DISCOVERY_HOST_BIND", "0.0.0.0")
    port = int(os.environ.get("DISCOVERY_HOST_PORT"))
    print(f"[HOST-SCAN] Running standalone on port {port} (subnet={subnet})")
    try:
        HTTPServer((host, port), H).serve_forever()
    except KeyboardInterrupt:
        print("[HOST-SCAN] Stopping server...")