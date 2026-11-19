# discovery_host.py
# Run this ONCE on Windows host: python discovery_host.py
# Keep it running alongside Docker

from http.server import HTTPServer, BaseHTTPRequestHandler
import socket
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

SUBNET  = os.environ.get("HOST_SUBNET")
PORTS   = [int(os.environ.get('RTSP_PORT', 554))]   # Scan RTSP port to prevent WSL2 NAT congestion/packet drops
TIMEOUT = 1.0     # Scan socket timeout in seconds
MAX_WORKERS = 254 # Concurrently check all addresses in the /24 subnet

_cache_lock = threading.Lock()
_cached_ips = []
_cache_time = 0.0
CACHE_TTL = 10.0  # seconds to cache results to keep response times sub-millisecond

def check(ip, port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(TIMEOUT)
            return ip if s.connect_ex((ip, port)) == 0 else None
    except:
        return None

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        global _cached_ips, _cache_time

        with _cache_lock:
            if _cached_ips and (time.time() - _cache_time < CACHE_TTL):
                body = json.dumps({"ips": sorted(_cached_ips)}).encode()
                self._send_safe_json(body)
                return

        subnet = os.environ.get("HOST_SUBNET", SUBNET)
        targets = [(f"{subnet}.{i}", p) for i in range(1, 255) for p in PORTS]
        found   = set()
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            for f in as_completed({ex.submit(check, ip, p) for ip, p in targets}):
                r = f.result()
                if r:
                    found.add(r)

        with _cache_lock:
            _cached_ips = list(found)
            _cache_time = time.time()

        body = json.dumps({"ips": sorted(found)}).encode()
        self._send_safe_json(body)

    def _send_safe_json(self, body: bytes):
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            # Client aborted or disconnected before response could be delivered
            pass
        
    def log_message(self, *a):
        print(f"[HOST-SCAN] Scan done — {a}")

class DiscoveryServer(HTTPServer):
    def handle_error(self, request, client_address):
        # Gracefully swallow connection aborts/resets by clients
        exc_type, exc_val, _ = sys.exc_info()
        if exc_type in (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError):
            return
        if isinstance(exc_val, OSError) and getattr(exc_val, "winerror", None) in (10053, 10054):
            return
        super().handle_error(request, client_address)

def start_discovery_host_server():
    def run_server():
        try:
            subnet = os.environ.get("HOST_SUBNET", SUBNET)
            host = os.environ.get("DISCOVERY_HOST_BIND", "0.0.0.0")
            port = int(os.environ.get("DISCOVERY_HOST_PORT", 19999))
            server = DiscoveryServer((host, port), H)
            print(f"[HOST-SCAN] Running on port {port} (subnet={subnet})")
            server.serve_forever()
        except OSError as e:
            print(f"[HOST-SCAN] ⚠ Port {os.environ.get('DISCOVERY_HOST_PORT')} already in use or unavailable: {e}. Skipping host-scan server startup.")

    t = threading.Thread(target=run_server, daemon=True)
    t.start()

if __name__ == "__main__":
    subnet = os.environ.get("HOST_SUBNET", SUBNET)
    host = os.environ.get("DISCOVERY_HOST_BIND", "0.0.0.0")
    port = int(os.environ.get("DISCOVERY_HOST_PORT", 19999))
    print(f"[HOST-SCAN] Running standalone on port {port} (subnet={subnet})")
    try:
        DiscoveryServer((host, port), H).serve_forever()
    except KeyboardInterrupt:
        print("[HOST-SCAN] Stopping server...")