import socket
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
from datetime import datetime
import sys

# Import existing discovery helpers if possible
try:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app.services.camera.discovery_service import get_local_subnet, _classify_device, probe_onvif_device
except ImportError:
    def get_local_subnet(): return "192.168.1"
    def _classify_device(ip, port): return "unknown", "", ""
    def probe_onvif_device(ip): return None

class NetworkScanner:
    def __init__(self):
        self.subnet = get_local_subnet()
        self.ports = [554, 80, 8080, 8000, 8081, 8899, 22]
        self.is_scanning = False

    def ping_device(self, ip, timeout=1):
        """Returns latency in ms if online, else -1"""
        try:
            # Use -n 1 for Windows, -c 1 for Linux
            param = '-n' if os.name == 'nt' else '-c'
            start = datetime.now()
            result = subprocess.run(
                ['ping', param, '1', '-w', str(timeout * 1000), ip],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            if result.returncode == 0:
                return (datetime.now() - start).total_seconds() * 1000
        except Exception:
            pass
        return -1

    def probe_port(self, ip, port, timeout=0.5):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(timeout)
                return s.connect_ex((ip, port)) == 0
        except Exception:
            return False

    def scan_ip(self, ip):
        latency = self.ping_device(ip)
        
        # Check common ports first to see if device is alive even if ping is blocked
        is_alive = latency >= 0
        open_ports = []
        
        # Probe common ports
        for port in self.ports:
            if self.probe_port(ip, port):
                open_ports.append(port)
                is_alive = True
        
        if not is_alive:
            return None
        
        # Default latency for port-only discovery
        if latency < 0:
            latency = 5 # Nominal latency

        # Classification logic
        device_type = "unknown"
        manufacturer = ""
        model = ""

        switch_ip = os.environ.get("SWITCH_IP")
        if ip == switch_ip:
            device_type = "switch"
            manufacturer = "Cisco Systems, Inc."
            model = "Cisco Switch"
        elif 554 in open_ports:
            device_type = "camera"
            # Try rich ONVIF probe
            onvif_data = probe_onvif_device(ip)
            if onvif_data:
                manufacturer = onvif_data.get("manufacturer", "")
                model = onvif_data.get("model", "")
        elif 22 in open_ports:
            device_type = "server"
        elif 80 in open_ports or 8080 in open_ports:
            cam_default_port = int(os.environ.get("CAMERA_DEFAULT_PORT"))
            cam_alt_port = int(os.environ.get("CAMERA_ALT_PORT"))
            port = cam_default_port if cam_default_port in open_ports else cam_alt_port
            dtype, mfr, mdl = _classify_device(ip, port)
            device_type = dtype if dtype != "unknown" else "web_device"
            manufacturer = mfr
            model = mdl

        # Strict filter: ONLY allow camera, server, and switch types
        if device_type not in ("camera", "server", "switch", "poe-switch", "core-switch"):
            return None


        return {
            "ip": ip,
            "type": device_type,
            "manufacturer": manufacturer,
            "model": model,
            "latency": latency,
            "open_ports": open_ports,
            "status": "online",
            "last_seen": datetime.utcnow()
        }

    def scan_network(self, subnet=None):
        if self.is_scanning:
            return []
        
        self.is_scanning = True
        target_subnet = subnet or self.subnet
        print(f"[SCANNER] Starting scan on {target_subnet}.0/24")
        
        discovered = []
        with ThreadPoolExecutor(max_workers=50) as executor:
            futures = {executor.submit(self.scan_ip, f"{target_subnet}.{i}"): i for i in range(1, 255)}
            for future in as_completed(futures):
                try:
                    res = future.result()
                    if res:
                        discovered.append(res)
                except Exception as e:
                    print(f"[SCANNER] Error scanning IP: {e}")
        
        self.is_scanning = False
        print(f"[SCANNER] Scan complete. Found {len(discovered)} devices.")
        return discovered

scanner = NetworkScanner()
