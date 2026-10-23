"""
ONVIF Device Discovery Service
Auto-detects network subnet and finds ONLY real ONVIF cameras with accurate brands and models.

Key discovery & filtering strategy:
  1. Multicast WS-Discovery bound to active network interface (IP_MULTICAST_IF)
     extracts unauthenticated self-reported brand and hardware model scopes directly from devices.
  2. RTSP port 554 check -- real cameras streaming RTSP video have this open; PCs/workstations do NOT.
  3. ARP table MAC extraction + OUI vendor lookup identifies manufacturer even when auth is required.
  4. Local host IP exclusion ensures VMS server and local MediaMTX are never detected as cameras.
  5. Concurrent subnet scan fallback catches any camera with port 554 open and ONVIF/RTSP signatures.
"""

import socket
import re
import subprocess
import os
import sys
import urllib.parse
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading


# -- Non-camera model/manufacturer keywords ------------------------------------
_NON_CAMERA_KEYWORDS = [
    "nas", "display", "decoder", "workstation", "desktop",
    "laptop", "switch", "router", "gateway", "hub",
    "printer", "access point", "ap ", "firewall", "vrmcockpit",
    "microsoft-httpapi", "windows", "server", "workstation pc",
]

# Known computer, server, and network equipment vendors that are NOT cameras
_NON_CAMERA_VENDORS = {
    "intel", "intel corporate", "hewlett packard", "hp", "hp inc.",
    "hewlett packard enterprise", "dell", "microsoft", "cisco", "cisco systems",
    "cisco systems, inc", "fortinet", "mikrotik", "raspberry pi",
    "raspberry pi trading ltd", "raspberry pi foundation", "apple", "lenovo",
    "supermicro", "asus", "asustek", "gigabyte", "msi", "micro-star",
    "acer", "liteon", "azurewave", "realtek", "gallagher group limited",
    "chongqing fugui electronics co.,ltd.", "nanjing qinheng microelectronics co., ltd.",
    "network device", "unknown device", "workstation", "unknown", "server host"
}

def get_topology_non_camera_ips() -> set[str]:
    """Excludes all non-camera devices discovered on the Topology/infrastructure page."""
    non_camera_ips = set()
    try:
        from monitoring.network_discovery import discovery_manager
        nodes = discovery_manager.get_live_nodes()
        for n in nodes:
            if n.get("type") != "camera" and n.get("ip"):
                non_camera_ips.add(n["ip"])
    except Exception:
        pass
    try:
        from app.core.database import db, mongo_client
        target_db = db
        if target_db is None and mongo_client is not None:
            db_name = os.environ.get("MONGO_DB_NAME", "vms_db")
            target_db = mongo_client[db_name]
        if target_db is not None:
            for n in target_db["infrastructure_nodes"].find({"type": {"$ne": "camera"}}, {"ip": 1}):
                if n.get("ip"):
                    non_camera_ips.add(n["ip"])
    except Exception:
        pass
    return non_camera_ips



# -----------------------------------------------------------------------------
# Local Host & Subnet Detection
# -----------------------------------------------------------------------------

def get_local_ips() -> set[str]:
    """Returns all IPv4 addresses belonging to this host to avoid self-detection."""
    local_ips = {"127.0.0.1", "localhost", "0.0.0.0"}
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            local_ips.add(ip)
    except Exception:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            local_ips.add(s.getsockname()[0])
    except Exception:
        pass
    try:
        if os.name == "nt":
            result = subprocess.run(["ipconfig"], capture_output=True, text=True, timeout=3)
            for ip in re.findall(r'IPv4 Address[.\s]+:\s*(\d+\.\d+\.\d+\.\d+)', result.stdout):
                local_ips.add(ip)
    except Exception:
        pass
    return local_ips


def get_active_interface_ip() -> str:
    """Finds the primary local IPv4 address connected to the local network."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        pass
    subnet = get_local_subnet()
    for ip in get_local_ips():
        if ip.startswith(f"{subnet}."):
            return ip
    return "0.0.0.0"


def get_local_subnet() -> str:
    env_subnet = os.environ.get("HOST_SUBNET", "").strip()
    if env_subnet:
        return env_subnet

    try:
        import platform
        if platform.system() == "Windows":
            result = subprocess.run(["ipconfig"], capture_output=True, text=True, timeout=3)
            for line in result.stdout.split('\n'):
                if "IPv4 Address" in line:
                    ip = re.search(r'(\d+\.\d+\.\d+\.\d+)', line)
                    if ip:
                        local_ip = ip.group(1)
                        if not local_ip.startswith(('127.', '172.17.', '172.18.', '169.254.')):
                            subnet = '.'.join(local_ip.split('.')[:3])
                            return subnet
    except Exception as e:
        print(f"[DISCOVERY] ipconfig failed: {e}")

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
        if not local_ip.startswith(('127.', '172.17.', '172.18.')):
            subnet = '.'.join(local_ip.split('.')[:3])
            return subnet
    except Exception as e:
        print(f"[DISCOVERY] socket subnet detection failed: {e}")

    return "192.168.1"


# -----------------------------------------------------------------------------
# RTSP port 554 check
# Real IP cameras ALWAYS listen on 554.
# -----------------------------------------------------------------------------

def _has_rtsp_port(ip: str, timeout_ms: int = 600) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout_ms / 1000.0)
            result = s.connect_ex((ip, 554))
            return result == 0
    except Exception:
        return False


def _check_port(ip: str, port: int, timeout_ms: int = 150) -> tuple[str, int] | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout_ms / 1000.0)
            if sock.connect_ex((ip, port)) == 0:
                return (ip, port)
    except Exception:
        pass
    return None


# -----------------------------------------------------------------------------
# Helpers & Fingerprinting
# -----------------------------------------------------------------------------

def _normalize_vendor_name(name: str) -> str:
    """Normalizes vendor names for clean UI display."""
    if not name or name.strip().lower() in ("unknown", "--", ""):
        return "Unknown"
    nl = name.lower()
    if "dahua" in nl:
        return "Dahua"
    if "bosch" in nl:
        return "Bosch"
    if "hikvision" in nl:
        return "Hikvision"
    if "axis" in nl:
        return "Axis"
    if "hanwha" in nl:
        return "Hanwha"
    if "uniview" in nl:
        return "Uniview"
    if "reolink" in nl:
        return "Reolink"
    if "amcrest" in nl:
        return "Amcrest"
    if "foscam" in nl:
        return "Foscam"
    if "vivotek" in nl:
        return "Vivotek"
    if "pelco" in nl:
        return "Pelco"
    if "sony" in nl:
        return "Sony"
    if "panasonic" in nl:
        return "Panasonic"
    return name.strip()


def _oui_lookup(mac: str) -> str | None:
    if not mac or mac in ("Unknown", "--", ""):
        return None
    try:
        from monitoring.network_discovery import lookup_oui
        vendor, dev_type = lookup_oui(mac)
        if vendor and vendor != "Unknown":
            return _normalize_vendor_name(vendor)
        return None
    except Exception:
        return None


def _get_mac(ip: str) -> str:
    try:
        from monitoring.network_discovery import ArpReader
        mac = ArpReader.get_mac_for_ip(ip)
        if mac and mac != "Unknown":
            return mac
    except Exception:
        pass
    return "Unknown"


def _http_banner_grab(ip: str, port: int, timeout: float = 2.0) -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect((ip, port))
            s.sendall(b"GET / HTTP/1.0\r\nHost: " + ip.encode() + b"\r\nConnection: close\r\n\r\n")
            chunks = []
            while True:
                chunk = s.recv(2048)
                if not chunk:
                    break
                chunks.append(chunk)
                if sum(len(c) for c in chunks) > 8192:
                    break
            return b"".join(chunks).decode("utf-8", errors="ignore").lower()
    except Exception:
        return ""


def _rtsp_banner_grab(ip: str, port: int = 554, timeout: float = 2.0) -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            s.connect((ip, port))
            req = f"OPTIONS rtsp://{ip}:{port} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: LibVLC/3.0.16\r\n\r\n".encode()
            s.sendall(req)
            resp = s.recv(4096).decode("utf-8", errors="ignore").lower()
            return resp
    except Exception:
        return ""


def _extract_name_from_scopes(scopes_text: str) -> str:
    if not scopes_text:
        return ""
    m = re.search(r'onvif://www\.onvif\.org/name/([^\s"<]+)', scopes_text, re.IGNORECASE)
    if m:
        raw = urllib.parse.unquote(m.group(1)).replace("_", " ").strip()
        if raw:
            return _normalize_vendor_name(raw)
    return ""


def _extract_hardware_from_scopes(scopes_text: str) -> str:
    if not scopes_text:
        return ""
    match = re.search(r'onvif://www\.onvif\.org/hardware/([^\s"<]+)', scopes_text, re.IGNORECASE)
    if match:
        raw = match.group(1).strip()
        decoded = urllib.parse.unquote(raw).replace("_", " ").strip()
        if decoded and len(decoded) > 1:
            return decoded[:45]
    return ""


def _extract_port_from_xaddrs(xaddrs_text: str) -> int:
    if not xaddrs_text:
        return 80
    match = re.search(r'https?://[^:/]+:(\d+)', xaddrs_text)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    if "https://" in xaddrs_text:
        return 443
    return 80


def _classify_device(ip: str, port: int, mac: str = "") -> tuple[str, str, str]:
    if not mac or mac == "Unknown":
        mac = _get_mac(ip)

    oui_mfg = _oui_lookup(mac)
    if oui_mfg:
        print(f"[CLASSIFY] {ip} -> {oui_mfg} (OUI)")
        return "camera", oui_mfg, ""

    # RTSP banner identifies the BRAND reliably
    rtsp_banner = _rtsp_banner_grab(ip, 554)
    rtsp_mfg = ""
    if rtsp_banner:
        if 'realm="login to ' in rtsp_banner:
            rtsp_mfg = "Dahua"
        elif 'please log in with a valid username' in rtsp_banner or 'videojet' in rtsp_banner:
            rtsp_mfg = "Bosch"
        else:
            known_brands = ["hikvision", "dahua", "axis", "bosch", "hanwha", "uniview", "reolink", "amcrest", "foscam", "vivotek", "pelco"]
            for b in known_brands:
                if b in rtsp_banner.lower():
                    rtsp_mfg = _normalize_vendor_name(b)
                    break

    # HTTP banner extraction
    banner = _http_banner_grab(ip, port)
    if banner:
        # Check for non-camera services like VRM Cockpit or Microsoft-HTTPAPI
        if "vrmcockpit" in banner or "video recording manager" in banner:
            return "recorder", "Bosch", "VRM Server"
        if "microsoft-httpapi" in banner:
            return "workstation", "Microsoft", "Windows PC"

        if "vcs-videojet" in banner or "boschvideosecurity" in banner:
            return "camera", "Bosch", ""
        if "dahua" in banner:
            return "camera", "Dahua", ""
        if "hikvision" in banner:
            return "camera", "Hikvision", ""

        title_match = re.search(r'<title[^>]*>(.*?)</title>', banner, re.IGNORECASE | re.DOTALL)
        model_hint = ""
        if title_match:
            t = re.sub(r"\s+", " ", title_match.group(1)).strip()
            t_lower = t.lower()
            software_markers = ["webserver", "web server", "httpd", "server", "boa/", "goahead", "404", "502", "302"]
            looks_like_software_banner = any(m in t_lower for m in software_markers)
            if (t and t_lower not in ("login", "index", "home", "") and not looks_like_software_banner):
                model_hint = t[:40]

        mfg = rtsp_mfg or "Unknown"
        if rtsp_mfg or (port == 554):
            return "camera", mfg, model_hint

    if rtsp_mfg:
        return "camera", rtsp_mfg, ""

    return "unknown", "Unknown", ""


# -----------------------------------------------------------------------------
# ONVIF probe -- RTSP gate first, then full validation
# -----------------------------------------------------------------------------

def probe_onvif_device(
    ip: str,
    port: int = 80,
    username: str = "",
    password: str = "",
    mac: str = "",
    known_mfg: str = "",
    known_model: str = ""
) -> dict | None:
    """
    Validates camera and gathers metadata.
      Gate 1 -> Skip local host IPs
      Gate 2 -> RTSP port 554 must be open
      Gate 3 -> ONVIF probe or classify as auth-required camera
    """
    local_ips = get_local_ips()
    topology_non_cams = get_topology_non_camera_ips()
    if ip in local_ips or ip in topology_non_cams or ip.startswith(('127.', '255.')):
        print(f"[DISCOVERY] ⏭ {ip} -- skipped (local host or topology infrastructure node)")
        return None

    if not _has_rtsp_port(ip):
        print(f"[DISCOVERY] [X] {ip} -- port 554 CLOSED -- not a streaming camera")
        return None

    if not mac or mac == "Unknown":
        mac = _get_mac(ip)

    if known_mfg and known_mfg.lower() in _NON_CAMERA_VENDORS:
        print(f"[DISCOVERY] [X] {ip} -- rejected non-camera vendor: {known_mfg}")
        return None

    if mac and mac != "Unknown":
        oui = _oui_lookup(mac)
        if oui and oui.lower() in _NON_CAMERA_VENDORS:
            print(f"[DISCOVERY] [X] {ip} -- rejected non-camera OUI: {oui}")
            return None

    try:
        from app.services.camera.onvif_service import probe_camera
        result = probe_camera(ip, port, username, password)

        if result.get("success"):
            valid_profiles = [
                p for p in result.get("profiles", [])
                if p.get("rtsp_url") and "rtsp://" in p.get("rtsp_url", "")
            ]

            rtsp_url = result.get('stream_uri', '')
            rtsp_url = re.sub(r"[&?]proto=Onvif", "", rtsp_url)

            manufacturer = _normalize_vendor_name(result.get('manufacturer') or known_mfg)
            if not manufacturer or manufacturer == 'Unknown':
                _, mfg, _ = _classify_device(ip, port, mac)
                manufacturer = _normalize_vendor_name(mfg)

            if manufacturer.lower() in _NON_CAMERA_VENDORS:
                return None

            model = result.get('model') or known_model
            if not model or model == 'Unknown':
                model = f"{manufacturer} Camera" if manufacturer != "Unknown" else "Camera"

            res_mac = result.get('mac')
            if not res_mac or res_mac == 'Unknown':
                res_mac = mac

            print(f"[DISCOVERY] [OK] CONFIRMED camera {ip}: {manufacturer} {model} | {len(valid_profiles)} stream(s)")

            return {
                'id':            f"device-{ip}",
                'ip':            ip,
                'port':          port,
                'mac':           res_mac,
                'status':        'online',
                'manufacturer':  manufacturer if manufacturer != "Unknown" else "Generic ONVIF",
                'model':         model,
                'authenticated': True,
                'firmware':      result.get('firmware', ''),
                'rtsp_url':      rtsp_url,
                'stream_uri':    rtsp_url,
                'device_type':   'camera',
                'discovered_at': datetime.utcnow().isoformat(),
            }

        else:
            # ONVIF probe failed (usually authentication required) but port 554 IS open
            if ip in topology_non_cams:
                return None

            manufacturer = _normalize_vendor_name(known_mfg)
            model_hint = known_model

            if not manufacturer or manufacturer == "Unknown":
                dtype, mfg, hint = _classify_device(ip, port, mac)
                if dtype not in ("recorder", "workstation", "unknown"):
                    manufacturer = _normalize_vendor_name(mfg)
                    if not model_hint:
                        model_hint = hint

            # If manufacturer is in non-camera vendors, reject immediately
            if manufacturer and manufacturer.lower() in _NON_CAMERA_VENDORS:
                return None

            # Must have verified camera identity (e.g. from WS-Discovery scopes or camera banner)
            if not manufacturer or manufacturer == "Unknown":
                print(f"[DISCOVERY] [X] {ip} -- rejected unverified device (auth failed, no camera banner)")
                return None

            if model_hint and model_hint.strip() and model_hint.strip().lower() != manufacturer.lower():
                model = model_hint.strip()
            else:
                model = f"{manufacturer} Camera"

            print(f"[DISCOVERY] [OK] Confirmed camera (auth required) {ip}: {manufacturer} {model}")

            return {
                'id':            f"device-{ip}",
                'ip':            ip,
                'port':          port,
                'mac':           mac,
                'status':        'online',
                'manufacturer':  manufacturer,
                'model':         model,
                'authenticated': False,
                'device_type':   'camera',
                'note':          'ONVIF probe requires credentials',
                'discovered_at': datetime.utcnow().isoformat(),
            }

    except Exception as e:
        print(f"[DISCOVERY] [WARN] {ip} -- port 554 open, ONVIF exception: {e}")
        manufacturer = _normalize_vendor_name(known_mfg) or _oui_lookup(mac) or "Generic ONVIF"
        model = known_model or f"{manufacturer} Camera"

        return {
            'id':            f"device-{ip}",
            'ip':            ip,
            'port':          port,
            'mac':           mac,
            'status':        'online',
            'manufacturer':  manufacturer,
            'model':         model,
            'authenticated': False,
            'device_type':   'camera',
            'discovered_at': datetime.utcnow().isoformat(),
        }


# -----------------------------------------------------------------------------
# WS-Discovery -- Multicast on active network interface
# -----------------------------------------------------------------------------

def discover_onvif_devices(timeout: int = 3) -> list:
    discovered_devices = {}
    local_ips = get_local_ips()
    topology_non_cams = get_topology_non_camera_ips()
    active_ip = get_active_interface_ip()

    try:
        probe_message = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
            'xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" '
            'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">'
            '<s:Header>'
            '<a:Action s:mustUnderstand="1">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action>'
            '<a:MessageID>urn:uuid:0d52d05f-bfd6-4e77-b8a8-5f22c39f7fcf</a:MessageID>'
            '<a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>'
            '<a:To s:mustUnderstand="1">dn:///</a:To>'
            '</s:Header>'
            '<s:Body><d:Probe><d:Types>tdn:NetworkVideoTransmitter</d:Types></d:Probe></s:Body>'
            '</s:Envelope>'
        ).encode('utf-8')

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.settimeout(timeout)

        # Bind to active interface to ensure multicast leaves the correct network adapter on Windows
        try:
            if active_ip and active_ip != "0.0.0.0":
                sock.bind((active_ip, 0))
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(active_ip))
            else:
                sock.bind(("", 0))
        except Exception as bind_err:
            print(f"[DISCOVERY] Interface bind fallback: {bind_err}")
            sock.bind(("", 0))

        MCAST_GRP  = '239.255.255.250'
        MCAST_PORT = 3702

        print(f"[DISCOVERY] WS-Discovery probe via {active_ip} (timeout={timeout}s)...")
        sock.sendto(probe_message, (MCAST_GRP, MCAST_PORT))

        raw_cams = {}
        try:
            while True:
                data, addr = sock.recvfrom(8192)
                ip = addr[0]

                if ip in local_ips or ip in topology_non_cams or ip.startswith(('127.', '255.')):
                    continue

                xml_data = data.decode('utf-8', errors='ignore')

                scopes_raw = re.findall(
                    r'<(?:[^:>]+:)?Scopes[^>]*>(.*?)</(?:[^:>]+:)?Scopes>',
                    xml_data, re.DOTALL | re.IGNORECASE
                )
                xaddrs_raw = re.findall(
                    r'<(?:[^:>]+:)?XAddrs[^>]*>(.*?)</(?:[^:>]+:)?XAddrs>',
                    xml_data, re.DOTALL | re.IGNORECASE
                )
                all_scopes = ' '.join(scopes_raw)
                all_xaddrs = ' '.join(xaddrs_raw)

                # Reject NVR/display/recorder scopes
                scopes_lower = all_scopes.lower()
                is_non_camera = any(kw in scopes_lower for kw in [
                    'networkvideodisplay', 'networkvideorecorder',
                    'network_video_recorder', 'network_video_display', 'videodisplay'
                ])
                if is_non_camera:
                    print(f"[DISCOVERY] [X] {ip} -- WS scope is NVR/display, skipping")
                    continue

                mfg = _extract_name_from_scopes(all_scopes)
                model = _extract_hardware_from_scopes(all_scopes)
                port = _extract_port_from_xaddrs(all_xaddrs)

                if ip not in raw_cams:
                    raw_cams[ip] = {
                        "ip": ip,
                        "port": port,
                        "mfg": mfg,
                        "model": model,
                    }

        except socket.timeout:
            pass
        finally:
            sock.close()

        print(f"[DISCOVERY] WS-Discovery received responses from {len(raw_cams)} camera(s)")

        # Verify RTSP gate & enrich discovered cameras
        with ThreadPoolExecutor(max_workers=min(len(raw_cams) or 1, 20)) as executor:
            futures = {
                executor.submit(
                    probe_onvif_device,
                    cam["ip"],
                    cam["port"],
                    "",
                    "",
                    "",
                    cam["mfg"],
                    cam["model"]
                ): cam["ip"]
                for cam in raw_cams.values()
            }
            for future in as_completed(futures):
                try:
                    device_info = future.result()
                    if device_info:
                        discovered_devices[device_info["ip"]] = device_info
                except Exception as e:
                    print(f"[DISCOVERY] WS probe result error: {e}")

    except Exception as e:
        print(f"[DISCOVERY] WS-Discovery error: {e}")

    return list(discovered_devices.values())


# -----------------------------------------------------------------------------
# Subnet scan (fallback & complementary)
# -----------------------------------------------------------------------------

def discover_onvif_devices_simple(
    timeout_ms:  int = 800,
    username:    str = "",
    password:    str = "",
    max_workers: int = 100,
) -> list:
    discovered_devices: dict[str, dict] = {}
    lock = threading.Lock()
    local_ips = get_local_ips()

    # Try host proxy scan agent if running
    open_ips: dict[str, int] = {}
    try:
        import urllib.request, json as _json
        url = "http://127.0.0.1:19999"
        with urllib.request.urlopen(url, timeout=2) as r:
            ips = _json.loads(r.read()).get("ips", [])
        if ips:
            open_ips = {ip: 554 for ip in ips if ip not in local_ips}
            print(f"[DISCOVERY] Host proxy found {len(open_ips)} IPs: {list(open_ips)}")
    except Exception:
        pass

    # Direct port scan if host proxy is not available
    if not open_ips:
        subnet = get_local_subnet()
        ports  = [554, 80]
        scan_targets = [
            (f"{subnet}.{i}", port)
            for i in range(1, 255)
            for port in ports
            if f"{subnet}.{i}" not in local_ips
        ]
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(_check_port, ip, port, timeout_ms): (ip, port)
                for ip, port in scan_targets
            }
            for future in as_completed(futures):
                res = future.result()
                if res:
                    ip, port = res
                    with lock:
                        if ip not in open_ips:
                            open_ips[ip] = port

    topology_non_cams = get_topology_non_camera_ips()

    def probe_worker(ip: str, port: int):
        if ip in local_ips or ip in topology_non_cams or not _has_rtsp_port(ip):
            return None
        mac = _get_mac(ip)
        dtype, mfg, model_hint = _classify_device(ip, port, mac)
        if dtype in ("recorder", "workstation") or (mfg and mfg.lower() in _NON_CAMERA_VENDORS):
            return None
        return probe_onvif_device(ip, port, username, password, mac, mfg, model_hint)

    with ThreadPoolExecutor(max_workers=min(len(open_ips), 20)) as executor:
        futures = {
            executor.submit(probe_worker, ip, port): ip
            for ip, port in open_ips.items()
            if ip not in local_ips and ip not in topology_non_cams
        }
        for future in as_completed(futures):
            try:
                device_info = future.result()
                if device_info:
                    with lock:
                        discovered_devices[device_info["ip"]] = device_info
            except Exception as e:
                print(f"[DISCOVERY] Subnet probe failed: {e}")

    return list(discovered_devices.values())


# -----------------------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------------------

def discover_all(
    ws_timeout:      int = 3,
    scan_timeout_ms: int = 800,
    username:        str = "",
    password:        str = "",
) -> list:
    """
    Runs WS-Discovery and subnet scan concurrently.
    Returns real, verified ONVIF cameras with accurate models and manufacturers.
    Excludes local host, non-camera topology nodes, and non-camera vendors.
    """
    print("[DISCOVERY] Starting parallel WS-Discovery + subnet scan...")
    local_ips = get_local_ips()
    topology_non_cams = get_topology_non_camera_ips()

    with ThreadPoolExecutor(max_workers=2) as executor:
        ws_future     = executor.submit(discover_onvif_devices, ws_timeout)
        subnet_future = executor.submit(
            discover_onvif_devices_simple, scan_timeout_ms, username, password
        )
        ws_results     = ws_future.result()
        subnet_results = subnet_future.result()

    # Merge -- WS-Discovery (rich self-reported metadata) takes precedence
    merged: dict[str, dict] = {}
    for d in subnet_results:
        ip = d.get("ip")
        mfg = (d.get("manufacturer") or "").lower()
        if ip and ip not in local_ips and ip not in topology_non_cams and mfg not in _NON_CAMERA_VENDORS:
            merged[ip] = d
    for d in ws_results:
        ip = d.get("ip")
        mfg = (d.get("manufacturer") or "").lower()
        if ip and ip not in local_ips and ip not in topology_non_cams and mfg not in _NON_CAMERA_VENDORS:
            merged[ip] = d

    # Helper to sort IPs numerically
    def ip_sort_key(dev: dict):
        ip = dev.get("ip", "")
        parts = [int(p) if p.isdigit() else 0 for p in ip.split(".")]
        return tuple(parts)

    result = sorted(merged.values(), key=ip_sort_key)

    print(f"[DISCOVERY] [OK] Done -- found {len(result)} camera(s) "
          f"(WS={len(ws_results)}, subnet={len(subnet_results)})")
    return result