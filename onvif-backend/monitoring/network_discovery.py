"""
Complete General-Purpose Network Infrastructure Discovery & Continuous Monitoring Engine
Provides:
  1. Dynamic host LAN interface, IP, subnet mask, and network detection (filtering virtual adapters).
  2. Multi-protocol discovery (ARP, ICMP ping, selective TCP ports, ONVIF/RTSP, SNMP, HTTP/HTTPS, DNS reverse lookup).
  3. MAC-centric device identification and deduplication across IP changes (preserves position, edges, history).
  4. Rich device classification (Camera, Printer, Router, Switch, PoE Switch, Core Switch, Access Point, Server, Workstation, NAS, IoT, Other, Unknown).
  5. MongoDB inventory management with first_seen, last_seen, and 3-cycle consecutive failure offline thresholding.
  6. Continuous non-blocking background watcher with lightweight ARP checks (30s) and full subnet discovery sweeps (5-10m).
  7. Thread-safe single DiscoveryManager coordinator.
"""

import socket
import struct
import subprocess
import threading
import asyncio
import time
import os
import re
import ipaddress
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

import psutil

from app.core.database import mongo_client, db as _core_db


# -----------------------------------------------------------------------------
# 1. Comprehensive MAC OUI Vendor Prefix Lookup Database
# -----------------------------------------------------------------------------
OUI_DATABASE: Dict[str, Tuple[str, str]] = {
    # Prefix (normalized lower 6 hex): (Vendor, Default Device Type)
    # Cameras & Video Security
    "001a8c": ("Bosch Security Systems", "camera"),
    "00075f": ("Bosch Security Systems", "camera"),
    # Dahua Technology OUIs
    "38af29": ("Dahua Technology", "camera"),
    "64db8b": ("Dahua Technology", "camera"),
    "e4246c": ("Dahua Technology", "camera"),
    "14a78b": ("Dahua Technology", "camera"),
    "3c286d": ("Dahua Technology", "camera"),
    "706793": ("Dahua Technology", "camera"),
    "9002a9": ("Dahua Technology", "camera"),
    "d462ea": ("Dahua Technology", "camera"),
    "8ce748": ("Dahua Technology", "camera"),
    "bc325f": ("Dahua Technology", "camera"),
    "a0bd1d": ("Dahua Technology", "camera"),
    "bcad28": ("Hikvision", "camera"),
    "2857be": ("Hikvision", "camera"),
    "e0508b": ("Hikvision", "camera"),
    "accc8e": ("Hikvision", "camera"),
    "001217": ("Cisco-Linksys", "router"),
    "0002d1": ("Vivotek", "camera"),
    "001bc5": ("Convergent Wireless", "camera"),
    "00408c": ("Axis Communications", "camera"),
    "000918": ("Samsung Techwin", "camera"),
    "00166c": ("Samsung Techwin / Hanwha", "camera"),
    "0024e2": ("Uniview", "camera"),
    "9c1463": ("Uniview", "camera"),
    "001f54": ("Reolink", "camera"),
    "ec71db": ("Amcrest", "camera"),
    "00626e": ("Foscam", "camera"),
    "00047d": ("Pelco", "camera"),
    "0018ae": ("Avigilon", "camera"),
    "00201a": ("Mobotix", "camera"),
    "000d18": ("Arecont Vision", "camera"),
    "0080f0": ("Panasonic", "camera"),
    "00014a": ("Sony", "camera"),
    
    # Network Switches, Routers & Gateways
    "00000c": ("Cisco Systems", "switch"),
    "000142": ("Cisco Systems", "switch"),
    "000143": ("Cisco Systems", "switch"),
    "000196": ("Cisco Systems", "switch"),
    "000197": ("Cisco Systems", "switch"),
    "001e13": ("Cisco Systems", "switch"),
    "10f920": ("Cisco Systems", "switch"),
    "001f6c": ("Cisco Systems", "switch"),
    "002255": ("Cisco Systems", "switch"),
    "00260b": ("Cisco Systems", "switch"),
    "00500f": ("Cisco Systems", "switch"),
    "b4a2eb": ("Cisco Systems", "switch"),
    "706979": ("Cisco Systems", "switch"),
    "f44ee3": ("Cisco Systems", "switch"),
    
    # Ubiquiti / UniFi
    "002722": ("Ubiquiti Networks", "access_point"),
    "0418d6": ("Ubiquiti Networks", "switch"),
    "24a43c": ("Ubiquiti Networks", "access_point"),
    "44d9e7": ("Ubiquiti Networks", "access_point"),
    "68d79a": ("Ubiquiti Networks", "switch"),
    "7483c2": ("Ubiquiti Networks", "access_point"),
    "802aa8": ("Ubiquiti Networks", "switch"),
    "b4fbe4": ("Ubiquiti Networks", "access_point"),
    "dc9fdb": ("Ubiquiti Networks", "router"),
    "f09fc2": ("Ubiquiti Networks", "access_point"),
    
    # MikroTik, Juniper, Aruba, Netgear, TP-Link, D-Link, Fortinet
    "000c42": ("MikroTik", "router"),
    "2c58b9": ("MikroTik", "router"),
    "488be5": ("MikroTik", "router"),
    "64d154": ("MikroTik", "router"),
    "b869f4": ("MikroTik", "router"),
    "d4ca6d": ("MikroTik", "router"),
    "e48d8c": ("MikroTik", "router"),
    "000585": ("Juniper Networks", "switch"),
    "0010db": ("Juniper Networks", "switch"),
    "000b86": ("Aruba Networks / HPE", "access_point"),
    "00246c": ("Aruba Networks / HPE", "access_point"),
    "94b40f": ("Aruba Networks / HPE", "access_point"),
    "00095b": ("Netgear", "switch"),
    "00146c": ("Netgear", "switch"),
    "00184d": ("Netgear", "router"),
    "001f33": ("Netgear", "switch"),
    "000aeb": ("TP-Link", "switch"),
    "001478": ("TP-Link", "router"),
    "50c7bf": ("TP-Link", "router"),
    "ec086b": ("TP-Link", "router"),
    "00055d": ("D-Link", "switch"),
    "000d88": ("D-Link", "switch"),
    "0015e9": ("D-Link", "router"),
    "001b11": ("D-Link", "switch"),
    "001349": ("Zyxel", "router"),
    "0019cb": ("Zyxel", "switch"),
    "00090f": ("Fortinet", "router"),
    "704ca5": ("Fortinet", "router"),
    "483a02": ("Fortinet", "router"),
    "085b0e": ("Fortinet", "router"),
    "906cba": ("Fortinet", "router"),
    "04d590": ("Fortinet", "router"),
    "e81da8": ("Fortinet", "router"),
    
    # Printers
    "001a4b": ("Hewlett-Packard", "printer"),
    "a0d3c1": ("Hewlett-Packard", "printer"),
    "18a905": ("Hewlett-Packard", "printer"),
    "0001e6": ("Hewlett-Packard", "printer"),
    "000802": ("Hewlett-Packard", "printer"),
    "00110a": ("Hewlett-Packard", "printer"),
    "0017a4": ("Hewlett-Packard", "printer"),
    "000085": ("Canon", "printer"),
    "001e8f": ("Canon", "printer"),
    "000048": ("Seiko Epson", "printer"),
    "0026ab": ("Seiko Epson", "printer"),
    "008077": ("Brother Industries", "printer"),
    "001ba9": ("Brother Industries", "printer"),
    "30055c": ("Brother Industries", "printer"),
    "000400": ("Lexmark", "printer"),
    "002000": ("Lexmark", "printer"),
    "0000aa": ("Xerox", "printer"),
    "000007": ("Xerox", "printer"),
    "001599": ("Kyocera", "printer"),
    "0017c8": ("Kyocera", "printer"),
    "000074": ("Ricoh", "printer"),
    "002673": ("Ricoh", "printer"),
    "0007c9": ("Zebra Technologies", "printer"),
    
    # NAS & Storage
    "001132": ("Synology", "nas"),
    "00089b": ("QNAP Systems", "nas"),
    "245ebb": ("QNAP Systems", "nas"),
    "0014fd": ("Infortrend", "nas"),
    "000ceb": ("Western Digital", "nas"),
    "0090a9": ("Western Digital", "nas"),
    "001075": ("Seagate", "nas"),
    "00d0b8": ("Buffalo", "nas"),
    
    # Servers & Virtualization
    "005056": ("VMware ESXi / Workstation", "server"),
    "000c29": ("VMware Virtual Platform", "server"),          
    "000569": ("VMware", "server"),
    "525400": ("QEMU / KVM Virtual Machine", "server"), 
    "080027": ("Oracle VirtualBox", "server"),
    "00155d": ("Microsoft Hyper-V", "server"),
    "00144f": ("Dell PowerEdge Server", "server"),
    "001e4f": ("Dell Server / iDRAC", "server"),
    "1866da": ("Dell Server / iDRAC", "server"),
    "001f29": ("HP ProLiant / iLO", "server"),
    "0002b3": ("Intel Server", "server"),
    "001b21": ("Intel", "server"),
    "002590": ("Supermicro", "server"),
    "0c9d92": ("Supermicro", "server"),
    "ac1f6b": ("Supermicro", "server"),
    
    # Workstations & Personal Computers
    "001422": ("Dell", "workstation"),
    "00188b": ("Dell", "workstation"),
    "180373": ("Dell", "workstation"),
    "d481d7": ("Dell", "workstation"),
    "001b78": ("Hewlett-Packard PC", "workstation"),
    "3cd92b": ("Hewlett-Packard PC", "workstation"),
    "705a0f": ("Hewlett-Packard PC", "workstation"),
    "00061b": ("Lenovo", "workstation"),
    "0021ccc": ("Lenovo ThinkPad", "workstation"),
    "54ee75": ("Lenovo", "workstation"),
    "000393": ("Apple", "workstation"),
    "000a95": ("Apple", "workstation"),
    "0017f2": ("Apple", "workstation"),
    "001b63": ("Apple", "workstation"),
    "001e52": ("Apple", "workstation"),
    "002500": ("Apple", "workstation"),
    "109add": ("Apple", "workstation"),
    "acbc32": ("Apple", "workstation"),
    "f01898": ("Apple", "workstation"),
    "001a92": ("ASUSTeK Computer", "workstation"),
    "04d4c4": ("ASUSTeK Computer", "workstation"),
    "0018f3": ("Giga-Byte Technology", "workstation"),
    "0013d4": ("Micro-Star (MSI)", "workstation"),
    
    # IoT / Embedded / Smart Devices
    "b827eb": ("Raspberry Pi Foundation", "iot"),
    "dca632": ("Raspberry Pi Foundation", "iot"),
    "e45f01": ("Raspberry Pi Foundation", "iot"),
    "28cdc1": ("Raspberry Pi Foundation", "iot"),
    "001788": ("Philips Hue", "iot"),
    "240ac4": ("Espressif (ESP32/ESP8266)", "iot"),
    "30aea4": ("Espressif (ESP32/ESP8266)", "iot"),
    "84cca8": ("Espressif (ESP32/ESP8266)", "iot"),
    "a020a6": ("Espressif (ESP32/ESP8266)", "iot"),
    "cc50e3": ("Espressif (ESP32/ESP8266)", "iot"),
    "ecfabc": ("Espressif (ESP32/ESP8266)", "iot"),
    "68c63a": ("Shelly / Allterco", "iot"),
    "483fda": ("Tuya Smart", "iot"),
    "600194": ("Sonoff / ITEAD", "iot"),
}


def normalize_mac(mac: Optional[str]) -> str:
    """Normalizes MAC address to lowercase xx:xx:xx:xx:xx:xx format."""
    if not mac:
        return ""
    clean = re.sub(r"[^0-9a-fA-F]", "", str(mac)).lower()
    if len(clean) != 12:
        return ""
    return ":".join(clean[i:i+2] for i in range(0, 12, 2))


# ── Placeholder detection (never store these as a real manufacturer/model) ──
GENERIC_VENDORS = {
    "", "unknown", "unknown device", "network device", "device", "web device",
    "network node", "network gateway", "http device", "workstation",
    "network printer", "server host", "nas storage", "ip camera",
}
_MODEL_SUFFIXES = ("pc", "printer", "router", "switch", "ap", "nas", "server", "camera", "device")

def is_placeholder_vendor(v: Optional[str]) -> bool:
    return (v or "").strip().lower() in GENERIC_VENDORS

def is_placeholder_model(m: Optional[str], vendor: Optional[str] = "") -> bool:
    ml = (m or "").strip().lower()
    if ml in GENERIC_VENDORS or ml == "workstation pc":
        return True
    v = (vendor or "").strip().lower()
    return any(ml == f"{v} {s}" for s in _MODEL_SUFFIXES)

def _vendor_from_text(text: str, names: List[str]) -> str:
    """Whole-word match only, so 'hp' no longer matches 'http'."""
    for n in names:
        if re.search(rf"(?<![a-z0-9]){re.escape(n)}(?![a-z0-9])", text):
            return "HP" if n in ("hp", "hewlett-packard") else n.title()
    return ""

# ── Live IEEE OUI lookup (thread-safe singleton) ──
_mac_lookup = None
_mac_lookup_lock = threading.RLock()
_vendor_cache: Dict[str, str] = {}

def _get_mac_lookup():
    global _mac_lookup
    with _mac_lookup_lock:
        if _mac_lookup is None:
            from mac_vendor_lookup import MacLookup
            _mac_lookup = MacLookup()
        return _mac_lookup

def lookup_oui(mac: str) -> Tuple[str, Optional[str]]:
    """Vendor comes from the full IEEE list. The small table is only a type hint / offline fallback."""
    norm = normalize_mac(mac)
    if not norm:
        return ("Unknown", None)
    prefix = norm.replace(":", "")[:6].lower()
    hint = OUI_DATABASE.get(prefix, (None, None))[1]

    # Randomized/private MAC (locally-administered bit) has no vendor by design
    if int(prefix[:2], 16) & 0x02:
        return ("Unknown", None)

    if prefix in _vendor_cache:
        return (_vendor_cache[prefix], hint)

    vendor = None
    try:
        with _mac_lookup_lock:
            vendor = _get_mac_lookup().lookup(norm)
    except Exception:
        vendor = None
    if not vendor and prefix in OUI_DATABASE:      # offline fallback only
        vendor = OUI_DATABASE[prefix][0]
    vendor = vendor or "Unknown"
    _vendor_cache[prefix] = vendor
    return (vendor, hint)

def _extract_real_model(
    http_title: str = "",
    http_server: str = "",
    snmp_descr: str = "",
    hostname: Optional[str] = None,
    vendor: str = "",
    ssl_info: str = ""
) -> Optional[str]:
    """
    Attempts to extract a genuine device model string from raw evidence
    (SSL Certificate Subject/Issuer, HTTP page title, HTTP Server header, SNMP sysDescr, reverse-DNS hostname)
    instead of synthesizing a generic "<Vendor> <Type>" placeholder.
    Applies quality filtering to reject unrelated web content (dashboards,
    login pages, captive portals, this VMS's own frontend, etc.) that isn't
    actually describing the device's hardware. Returns None if nothing
    trustworthy was found — a generic fallback is safer than a wrong guess.
    """
    junk_exact = {
        "", "login", "index", "home", "welcome", "device", "untitled",
        "401 unauthorized", "403 forbidden", "document", "web management",
        "please login", "sign in", "dashboard"
    }
    # Any of these appearing ANYWHERE in the candidate disqualifies it —
    # catches app/dashboard pages (including our own) masquerading as a model.
    junk_contains = [
        "mirador", "dashboard", "analytics", "monitoring", " vms",
        "please wait", "loading", "404", "not found", "error",
        "redirect", "captive portal"
    ]

    def _is_valid(candidate: str) -> bool:
        c = candidate.strip()
        if not c or len(c) < 3 or len(c) > 45:  # real model strings are short
            return False
        if c.lower() in junk_exact:
            return False
        if any(j in c.lower() for j in junk_contains):
            return False
        return True

    candidates = []
    if ssl_info and _is_valid(ssl_info):
        candidates.append(ssl_info.strip())
    if http_title and _is_valid(http_title):
        candidates.append(http_title.strip())
    if http_server and _is_valid(http_server):
        candidates.append(http_server.strip())
    if snmp_descr:
        trimmed = snmp_descr.strip()[:70]
        if _is_valid(trimmed):
            candidates.append(trimmed)
    if hostname:
        clean_host = hostname.replace("_", "-").rstrip(".")
        if _is_valid(clean_host) and not clean_host.replace(".", "").isdigit():
            candidates.append(clean_host)

    for c in candidates:
        if vendor and c.strip().lower() == vendor.strip().lower():
            continue
        return c[:45]
    return None

# -----------------------------------------------------------------------------
# 2. Host Network Detection (Automatic Physical Interface, IP, Subnet Mask)
# -----------------------------------------------------------------------------
class HostNetworkDetector:
    VIRTUAL_IFACE_KEYWORDS = [
        "docker", "wsl", "vbox", "virtualbox", "vmware", "hyper-v",
        "vethernet", "loopback", "teredo", "isatap", "npcap",
        "bluetooth", "vpn", "tailscale", "zerotier", "wireguard", "tap", "tun"
    ]

    @classmethod
    def is_virtual_or_filtered_iface(cls, iface_name: str, ip: str) -> bool:
        name_lower = iface_name.lower()
        if any(kw in name_lower for kw in cls.VIRTUAL_IFACE_KEYWORDS):
            return True
        if ip.startswith(("127.", "169.254.", "172.17.", "172.18.")):
            return True
        return False

    @classmethod
    def get_active_host_network(cls) -> Dict[str, Any]:
        """
        Detects the active host IPv4 LAN address, netmask, network CIDR, default gateway,
        and interface name dynamically, prioritizing physical LAN adapters over virtual ones.
        """
        env_subnet = os.environ.get("HOST_SUBNET", "").strip()
        
        outbound_ip = None
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(0.5)
                s.connect(("8.8.8.8", 80))
                outbound_ip = s.getsockname()[0]
        except Exception:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.settimeout(0.5)
                    s.connect(("1.1.1.1", 80))
                    outbound_ip = s.getsockname()[0]
            except Exception:
                outbound_ip = None

        interfaces_info = psutil.net_if_addrs()
        stats_info = psutil.net_if_stats()

        best_iface = None
        best_ip = None
        best_netmask = "255.255.255.0"

        # 1. Match outbound IP on non-virtual interface
        if outbound_ip and not outbound_ip.startswith(("127.", "169.254.")):
            for iface_name, addrs in interfaces_info.items():
                for addr in addrs:
                    if addr.family == socket.AF_INET and addr.address == outbound_ip:
                        best_iface = iface_name
                        best_ip = addr.address
                        best_netmask = addr.netmask or "255.255.255.0"
                        break
                if best_ip:
                    break

        # 2. If not found or if outbound was on a virtual adapter, search physical UP adapters
        if not best_ip or cls.is_virtual_or_filtered_iface(best_iface or "", best_ip):
            for iface_name, addrs in interfaces_info.items():
                if cls.is_virtual_or_filtered_iface(iface_name, ""):
                    continue
                stat = stats_info.get(iface_name)
                is_up = stat.isup if stat else False
                for addr in addrs:
                    if addr.family == socket.AF_INET:
                        ip_val = addr.address
                        if not cls.is_virtual_or_filtered_iface(iface_name, ip_val):
                            if is_up:
                                best_iface = iface_name
                                best_ip = ip_val
                                best_netmask = addr.netmask or "255.255.255.0"
                                break
                            elif not best_ip:
                                best_iface = iface_name
                                best_ip = ip_val
                                best_netmask = addr.netmask or "255.255.255.0"
                if best_ip and stats_info.get(iface_name) and stats_info.get(iface_name).isup:
                    break

        # 3. Fallback
        if not best_ip:
            best_ip = "127.0.0.1"
            best_netmask = "255.0.0.0"
            best_iface = "lo"

        # Compute CIDR Network Object
        try:
            if env_subnet:
                if "/" in env_subnet:
                    network_obj = ipaddress.IPv4Network(env_subnet, strict=False)
                else:
                    network_obj = ipaddress.IPv4Network(f"{env_subnet}.0/24", strict=False)
            elif best_ip.startswith("127."):
                network_obj = ipaddress.IPv4Network("127.0.0.0/8", strict=False)
            else:
                network_obj = ipaddress.IPv4Network(f"{best_ip}/{best_netmask}", strict=False)
        except Exception:
            network_obj = ipaddress.IPv4Network("192.168.1.0/24", strict=False)

        default_gateway = None
        try:
            if os.name == 'nt':
                res = subprocess.run(["route", "print", "0.0.0.0"], capture_output=True, text=True, timeout=2)
                for line in res.stdout.splitlines():
                    parts = line.strip().split()
                    if len(parts) >= 5 and parts[0] == "0.0.0.0" and parts[1] == "0.0.0.0":
                        gw_candidate = parts[2]
                        if not gw_candidate.startswith("127."):
                            default_gateway = gw_candidate
                            break
        except Exception:
            pass

        if not default_gateway and network_obj.prefixlen <= 24:
            hosts = list(network_obj.hosts())
            if hosts:
                default_gateway = str(hosts[0])

        return {
            "interface": best_iface or "Physical LAN",
            "ip": best_ip,
            "netmask": best_netmask,
            "cidr": str(network_obj),
            "network_address": str(network_obj.network_address),
            "prefixlen": network_obj.prefixlen,
            "num_hosts": network_obj.num_addresses - 2 if network_obj.num_addresses > 2 else 1,
            "default_gateway": default_gateway,
            "broadcast_address": str(network_obj.broadcast_address) if hasattr(network_obj, 'broadcast_address') else None
        }


# -----------------------------------------------------------------------------
# 3. ARP Cache Extraction
# -----------------------------------------------------------------------------
class ArpReader:
    @staticmethod
    def _read_proc_net_arp() -> Dict[str, str]:
        """
        Container-safe ARP fallback. Reads /proc/net/arp directly — a kernel
        interface, not a CLI tool — so it works even when the 'arp' binary
        (net-tools) isn't installed in a slim Linux/Docker image. This is why
        MAC/OUI-dependent fields (manufacturer, model) were coming back blank
        for many devices: the 'arp' subprocess call was silently failing.
        """
        result: Dict[str, str] = {}
        try:
            with open("/proc/net/arp", "r") as f:
                lines = f.readlines()[1:]
            for line in lines:
                parts = line.split()
                if len(parts) >= 4:
                    ip, raw_mac = parts[0], parts[3]
                    norm = normalize_mac(raw_mac)
                    if norm and norm != "00:00:00:00:00:00":
                        result[ip] = norm
        except Exception:
            pass
        return result

    @staticmethod
    def get_arp_table() -> Dict[str, str]:
        """
        Extracts IP -> MAC mapping from OS ARP table.
        Works reliably across Windows and Linux, with a container-safe fallback.
        """
        ip_mac_map: Dict[str, str] = {}
        try:
            res = subprocess.run(["arp", "-a"], capture_output=True, text=True, timeout=3)
            for line in res.stdout.splitlines():
                match = re.search(r"(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F[:-]{11,17})", line)
                if match:
                    ip = match.group(1)
                    raw_mac = match.group(2)
                    norm_mac = normalize_mac(raw_mac)
                    if norm_mac and norm_mac != "ff:ff:ff:ff:ff:ff" and not ip.startswith(("224.", "239.", "255.", "127.")):
                        ip_mac_map[ip] = norm_mac
        except Exception as e:
            print(f"[ARP] 'arp' command unavailable ({e}) — using /proc/net/arp fallback")

        if not ip_mac_map:
            proc_map = ArpReader._read_proc_net_arp()
            if proc_map:
                print(f"[ARP] /proc/net/arp fallback resolved {len(proc_map)} entries")
                ip_mac_map.update(proc_map)

        return ip_mac_map

    @staticmethod
    def get_mac_for_ip(ip: str) -> Optional[str]:
        """Actively resolves a single IP's MAC right after a probe, the way
        professional scanners (nmap/Fing) do — with a container-safe fallback."""
        try:
            res = subprocess.run(["arp", "-a", ip], capture_output=True, text=True, timeout=2)
            match = re.search(r"([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}", res.stdout)
            if match:
                norm = normalize_mac(match.group(0))
                if norm and norm != "ff:ff:ff:ff:ff:ff":
                    return norm
        except Exception:
            pass
        return ArpReader._read_proc_net_arp().get(ip)


# -----------------------------------------------------------------------------
# 4. Selective Probing, Fingerprinting & Identification
# -----------------------------------------------------------------------------
class DeviceIdentifier:
    STRATEGIC_PORTS = {
        554: "rtsp",
        80: "http",
        443: "https",
        8080: "http-alt",
        8000: "http-dev",
        8081: "http-alt3",
        8899: "onvif-discovery",
        37777: "dahua-private",
        135: "msrpc",
        139: "netbios-ssn",
        445: "microsoft-ds",
        3389: "ms-wbt-server",
        22: "ssh",
        9100: "jetdirect",
        631: "ipp",
        515: "lpd",
        5000: "synology-dsm",
        5001: "synology-dsm-ssl",
        161: "snmp"
    }

    @staticmethod
    def ping_device(ip: str, timeout_ms: int = 350) -> float:
        """Returns round-trip latency in ms if responsive, else -1.0."""
        try:
            param = '-n' if os.name == 'nt' else '-c'
            t_ms = str(max(timeout_ms, 100))
            start = time.perf_counter()
            res = subprocess.run(
                ['ping', param, '1', '-w', t_ms, ip],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=(timeout_ms / 1000.0) + 0.3
            )
            if res.returncode == 0:
                return round((time.perf_counter() - start) * 1000, 1)
        except Exception:
            pass
        return -1.0

    @staticmethod
    def probe_tcp_port(ip: str, port: int, timeout_s: float = 0.25) -> bool:
        """Fast TCP SYN/Connect probe on a specific port."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(timeout_s)
                return s.connect_ex((ip, port)) == 0
        except Exception:
            return False

    @staticmethod
    def resolve_hostname(ip: str) -> Optional[str]:
        """Resolves PTR reverse DNS hostname."""
        try:
            host, _, _ = socket.gethostbyaddr(ip)
            if host and host != ip:
                return host
        except Exception:
            pass
        return None

    @staticmethod
    def grab_http_banner(ip: str, port: int = 80, timeout_s: float = 1.2) -> Tuple[str, str, str]:
        """Returns (ServerHeader, HtmlTitle, SslCertInfo) from HTTP or HTTPS GET request."""
        server_header = ""
        title = ""
        ssl_info = ""
        try:
            import http.client, ssl, gzip
            is_https = (port in (443, 8443))
            
            if is_https:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                conn = http.client.HTTPSConnection(ip, port, context=ctx, timeout=timeout_s)
            else:
                conn = http.client.HTTPConnection(ip, port, timeout=timeout_s)
                
            conn.request("GET", "/", headers={
                "User-Agent": "Mozilla/5.0 (compatible; MiradorDiscovery/1.0)",
                "Accept-Encoding": "gzip, deflate"
            })
            res = conn.getresponse()
            server_header = res.getheader("Server") or ""
            raw_body = res.read()
            if res.getheader("Content-Encoding") == "gzip":
                try:
                    raw_body = gzip.decompress(raw_body)
                except Exception:
                    pass
            body_text = raw_body.decode("utf-8", errors="ignore")
            
            m_tit = re.search(r"<title[^>]*>(.*?)</title>", body_text, re.IGNORECASE | re.DOTALL)
            if m_tit:
                title = re.sub(r"\s+", " ", m_tit.group(1)).strip()

            if is_https and hasattr(conn, "sock") and conn.sock:
                try:
                    cert_der = conn.sock.getpeercert(binary_form=True)
                    if cert_der:
                        try:
                            from cryptography import x509
                            from cryptography.x509.oid import NameOID
                            cert = x509.load_der_x509_certificate(cert_der)
                            
                            org_attrs = cert.subject.get_attributes_for_oid(NameOID.ORGANIZATION_NAME) or cert.issuer.get_attributes_for_oid(NameOID.ORGANIZATION_NAME)
                            cn_attrs = cert.subject.get_attributes_for_oid(NameOID.COMMON_NAME) or cert.issuer.get_attributes_for_oid(NameOID.COMMON_NAME)
                            
                            raw_org = str(org_attrs[0].value).strip() if org_attrs else ""
                            raw_cn = str(cn_attrs[0].value).strip() if cn_attrs else ""
                            
                            clean_org = re.sub(r"(?i)\s+(ltd|inc|corporation|corp|co|llc|gmbh|ag|sa)\b\.?", "", raw_org).strip()
                            
                            ssl_org = clean_org or raw_org
                            ssl_cn = raw_cn
                            
                            ssl_info = ssl_cn or ssl_org
                        except Exception:
                            pass
                except Exception:
                    pass
            conn.close()
        except Exception:
            pass
        return (server_header, title, ssl_info)

    @staticmethod
    def query_upnp(ip: str, timeout_s: float = 1.0) -> Tuple[str, str]:
        """Returns (manufacturer, modelName) from the device's own UPnP description."""
        try:
            from urllib.parse import urlparse
            import urllib.request
            msg = ('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\n'
                   'MAN: "ssdp:discover"\r\nMX: 1\r\nST: upnp:rootdevice\r\n\r\n').encode()
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(timeout_s)
                s.sendto(msg, (ip, 1900))
                data, _ = s.recvfrom(2048)
            m = re.search(r"(?im)^location:\s*(http://\S+)", data.decode("utf-8", "ignore"))
            if not m:
                return ("", "")
            url = m.group(1)
            if urlparse(url).hostname != ip:      # only fetch from the device itself
                return ("", "")
            with urllib.request.urlopen(url, timeout=timeout_s) as r:
                xml_text = r.read(65536).decode("utf-8", "ignore")

            def tag(name):
                mm = re.search(rf"<{name}>(.*?)</{name}>", xml_text, re.I | re.S)
                return mm.group(1).strip() if mm else ""
            return (tag("manufacturer"), tag("modelName") or tag("friendlyName"))
        except Exception:
            return ("", "")

    @staticmethod
    def grab_rtsp_banner(ip: str, port: int = 554, timeout_s: float = 1.0) -> Tuple[str, str]:
        """Sends RTSP OPTIONS request and retrieves Server / Realm banners."""
        server = ""
        realm = ""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(timeout_s)
                s.connect((ip, port))
                req = f"OPTIONS rtsp://{ip}:{port} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: MiradorDiscovery/1.0\r\n\r\n".encode("utf-8")
                s.sendall(req)
                data = s.recv(2048).decode("utf-8", errors="ignore")
                
                for line in data.splitlines():
                    if line.lower().startswith("server:"):
                        server = line.split(":", 1)[1].strip()
                        break
                
                m_rlm = re.search(r'realm="([^"]+)"', data, re.IGNORECASE)
                if m_rlm:
                    realm = m_rlm.group(1).strip()
        except Exception:
            pass
        return (server, realm)

    @staticmethod
    def query_snmp_sysdescr(ip: str, community: str = "public", timeout_s: float = 0.8) -> str:
        """Queries SNMP OID 1.3.6.1.2.1.1.1.0 (sysDescr) using raw UDP packet."""
        try:
            def _encode_oid(oid_str):
                parts = list(map(int, oid_str.split(".")))
                encoded = bytes([40 * parts[0] + parts[1]])
                for p in parts[2:]:
                    if p == 0:
                        encoded += bytes([0])
                    else:
                        segs = []
                        while p:
                            segs.append(p & 0x7f)
                            p >>= 7
                        segs.reverse()
                        for i, s in enumerate(segs):
                            encoded += bytes([s | (0x80 if i < len(segs) - 1 else 0)])
                return encoded

            def _tlv(tag, value):
                if len(value) < 128:
                    return bytes([tag, len(value)]) + value
                elif len(value) < 256:
                    return bytes([tag, 0x81, len(value)]) + value
                else:
                    return bytes([tag, 0x82, len(value) >> 8, len(value) & 0xff]) + value

            comm = community.encode()
            oid = _encode_oid("1.3.6.1.2.1.1.1.0")
            varbind = _tlv(0x30, _tlv(0x06, oid) + _tlv(0x05, b""))
            varbinds = _tlv(0x30, varbind)
            pdu = _tlv(0xa0, bytes([0x02, 0x01, 0x01, 0x02, 0x01, 0x00, 0x02, 0x01, 0x00]) + varbinds)
            packet = _tlv(0x30, bytes([0x02, 0x01, 0x00]) + _tlv(0x04, comm) + pdu)

            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(timeout_s)
                s.sendto(packet, (ip, 161))
                data, _ = s.recvfrom(2048)

            match = re.search(r'\x04([\x01-\x7f])([\x20-\x7e]{4,})', data.decode("latin-1", errors="ignore"))
            if match:
                length = ord(match.group(1))
                return match.group(2)[:length].strip()
        except Exception:
            pass
        return ""


# -----------------------------------------------------------------------------
# 5. Device Classification Engine
# -----------------------------------------------------------------------------
class DeviceClassifier:
    @classmethod
    def classify(
        cls,
        ip: str,
        mac: Optional[str],
        open_ports: List[int],
        hostname: Optional[str] = None,
        oui_vendor: str = "Unknown",
        oui_suggested_type: Optional[str] = None,
        http_server: str = "",
        http_title: str = "",
        ssl_info: str = "",
        rtsp_server: str = "",
        rtsp_realm: str = "",
        snmp_descr: str = "",
        is_default_gateway: bool = False,
    ) -> Tuple[str, str, str, int, List[str], str]:
        """
        Multi-Signal Weighted Classification Engine.
        Returns: (device_type, vendor, model, confidence_score, evidence_list, reasoning)
        """
        combined_text = f"{hostname or ''} {oui_vendor} {http_server} {http_title} {ssl_info} {rtsp_server} {rtsp_realm} {snmp_descr}".lower()

        workstation_score = 0
        workstation_evidence = []

        printer_score = 0
        printer_evidence = []

        router_score = 0
        router_evidence = []

        switch_score = 0
        switch_evidence = []

        nas_score = 0
        nas_evidence = []

        server_score = 0
        server_evidence = []

        # --- A. Workstation & PC Evaluation (High Priority) ---
        if 445 in open_ports:
            workstation_score += 45
            workstation_evidence.append("SMB (port 445)")
        if 3389 in open_ports:
            workstation_score += 40
            workstation_evidence.append("RDP (port 3389)")
        if 135 in open_ports or 139 in open_ports:
            workstation_score += 30
            active_rpc = [p for p in [135, 139] if p in open_ports]
            workstation_evidence.append(f"Windows RPC/NetBIOS ({active_rpc})")
        if 22 in open_ports:
            # SSH on workstation / dev computer with dev web services
            if any(p in open_ports for p in [5000, 8000, 8080, 3000, 5173]) or 3389 in open_ports or 445 in open_ports:
                workstation_score += 55
                active_dev = [p for p in [22, 5000, 8000, 8080, 3000, 5173] if p in open_ports]
                workstation_evidence.append(f"Linux/Dev Workstation (SSH + Dev Ports {active_dev})")
            elif not any(cam in combined_text for cam in ["dahua", "hikvision", "bosch", "axis"]):
                # Standalone SSH without web development services: check if router or server
                if not is_default_gateway and not any(r in combined_text for r in ["router", "gateway", "firewall"]):
                    server_score += 30
                    server_evidence.append("SSH remote administration port (22)")

        # --- B. Web Interface / Embedded Signals ---
        if 80 in open_ports or 443 in open_ports or 8080 in open_ports or 8443 in open_ports:
            active_web = [p for p in [80, 443, 8080, 8443] if p in open_ports]
            if is_default_gateway:
                router_score += 25
                router_evidence.append(f"Web admin interface ({active_web})")

        if any(k in combined_text for k in ["desktop", "laptop", "thinkpad", "macbook", "imac", "optiplex", "latitude", "workstation", "windows 10", "windows 11"]):
            workstation_score += 35
            workstation_evidence.append("Workstation hostname/banner")

        if oui_suggested_type == "workstation" or any(mfg in combined_text for mfg in ["dell", "lenovo", "apple", "hp", "asus", "intel", "realtek", "microsoft"]):
            if not any(cam in combined_text for cam in ["dahua", "hikvision", "bosch", "axis", "uniview"]):
                workstation_score += 25
                workstation_evidence.append(f"Workstation vendor ({oui_vendor})")

        # --- C. Printer Evaluation ---
        if 9100 in open_ports:
            if 22 in open_ports and any(p in open_ports for p in [5000, 8000, 8080]):
                printer_score += 15 # Port 9100 on Linux dev host
                printer_evidence.append("Port 9100 (low printer weight on Dev Host)")
            else:
                printer_score += 50
                printer_evidence.append("JetDirect port 9100")
        if 631 in open_ports or 515 in open_ports:
            printer_score += 35
            printer_evidence.append(f"IPP/LPD print port ({[p for p in [631, 515] if p in open_ports]})")
        if "printer" in combined_text or "jetdirect" in combined_text or oui_suggested_type == "printer":
            printer_score += 35
            printer_evidence.append(f"Printer vendor/banner ({oui_vendor})")

        # --- D. Router / Gateway Evaluation ---
        if is_default_gateway:
            router_score += 60
            router_evidence.append("Default Gateway IP")
        if any(k in combined_text for k in ["router", "gateway", "firewall", "wrt"]) or oui_suggested_type == "router":
            router_score += 40
            router_evidence.append(f"Router signature/OUI ({oui_vendor if oui_vendor != 'Unknown' else 'Network'})")
        if ssl_info:
            router_score += 20
            router_evidence.append(f"SSL Certificate ({ssl_info})")

        # --- E. Switch / AP Evaluation ---
        if any(k in combined_text for k in ["switch", "catalyst", "nexus", "edgeswitch", "unifi switch", "managed switch"]) or (oui_suggested_type == "switch" and (161 in open_ports or 80 in open_ports)):
            switch_score += 50
            switch_evidence.append(f"Switch banner/OUI ({oui_vendor})")
        if any(k in combined_text for k in ["access point", "unifi ap", "uap", "airmax", "aruba ap", "ruckus", "meraki ap"]) or oui_suggested_type == "access_point":
            switch_score += 45
            switch_evidence.append(f"Access Point signature ({oui_vendor})")

        # --- F. NAS Storage Evaluation ---
        if (5000 in open_ports or 5001 in open_ports) and not (445 in open_ports and 3389 in open_ports):
            nas_score += 60
            nas_evidence.append(f"DSM storage port ({[p for p in [5000, 5001] if p in open_ports]})")
        if any(k in combined_text for k in ["synology", "qnap", "truenas", "freenas", "diskstation", "nas", "storage server"]) or oui_suggested_type == "nas":
            nas_score += 40
            nas_evidence.append(f"NAS vendor/OUI ({oui_vendor})")

        # --- G. Server Evaluation ---
        if (22 in open_ports and not any(p in open_ports for p in [3389, 445, 135])) and (any(k in combined_text for k in ["esxi", "vmware", "proxmox", "hyper-v", "linux", "ubuntu", "debian", "centos", "redhat", "supermicro", "poweredge", "proliant", "server"]) or oui_suggested_type == "server"):
            server_score += 50
            server_evidence.append(f"Server host banner/OUI ({oui_vendor})")

        detected_vendor = oui_vendor if oui_vendor != "Unknown" else ""

        # --- Decision Priority Matrix ---

        # 1. Workstation: Strong workstation signals (SMB 445, RDP 3389, NetBIOS 139, RPC 135, SSH+Dev)
        if workstation_score >= 50:
            dev_type = "workstation"
            confidence = min(100, workstation_score)
            if not detected_vendor:
                detected_vendor = _vendor_from_text(combined_text, ["dell", "lenovo", "apple", "hp", "asus"]) or "Unknown"
            real_model = _extract_real_model(http_title, http_server, snmp_descr, hostname, detected_vendor, ssl_info)
            detected_model = real_model or f"{detected_vendor} PC"
            reasoning = f"Workstation confirmed by: {', '.join(workstation_evidence)}"
            return (dev_type, detected_vendor, detected_model, confidence, workstation_evidence, reasoning)

        # 3. Printer
        if printer_score >= 50:
            dev_type = "printer"
            confidence = min(100, printer_score)
            if not detected_vendor:
                detected_vendor = _vendor_from_text(combined_text, ["hewlett-packard", "hp", "canon", "epson", "brother", "lexmark", "xerox", "kyocera", "ricoh", "zebra"]) or "Unknown"
            real_model = _extract_real_model(http_title, http_server, snmp_descr, hostname, detected_vendor, ssl_info)
            detected_model = real_model or f"{detected_vendor} Printer"
            reasoning = f"Printer confirmed by: {', '.join(printer_evidence)}"
            return (dev_type, detected_vendor, detected_model, confidence, printer_evidence, reasoning)

        # 4. Router / Gateway
        if router_score >= 60:
            dev_type = "router"
            confidence = min(100, router_score)
            if not detected_vendor or detected_vendor == "Unknown":
                for r_mfg in ["cisco", "mikrotik", "tp-link", "netgear", "d-link", "zyxel", "ubiquiti"]:
                    if r_mfg in combined_text:
                        detected_vendor = r_mfg.capitalize()
                        break
            real_model = _extract_real_model(http_title, http_server, snmp_descr, hostname, detected_vendor, ssl_info)
            detected_model = real_model or f"{detected_vendor or 'Gateway'} Router"
            reasoning = f"Router confirmed by: {', '.join(router_evidence)}"
            return (dev_type, detected_vendor or "Network Gateway", detected_model, confidence, router_evidence, reasoning)

        # 5. Switch / AP
        if switch_score >= 45:
            is_ap = any(k in combined_text for k in ["access point", "unifi ap", "uap", "airmax", "aruba ap", "ruckus", "meraki ap"]) or oui_suggested_type == "access_point"
            dev_type = "access_point" if is_ap else ("poe-switch" if "poe" in combined_text else "switch")
            confidence = min(100, switch_score)
            real_model = _extract_real_model(http_title, http_server, snmp_descr, hostname, detected_vendor, ssl_info)
            detected_model = real_model or f"{detected_vendor or 'Network'} {'AP' if is_ap else 'Switch'}"
            reasoning = f"Network infrastructure confirmed by: {', '.join(switch_evidence)}"
            return (dev_type, detected_vendor or "Network Device", detected_model, confidence, switch_evidence, reasoning)

        # 6. NAS
        if nas_score >= 50:
            dev_type = "nas"
            confidence = min(100, nas_score)
            for n_mfg in ["synology", "qnap", "truenas", "freenas", "buffalo", "western digital"]:
                if n_mfg in combined_text:
                    detected_vendor = n_mfg.capitalize()
                    break
            real_model = _extract_real_model(http_title, http_server, snmp_descr, hostname, detected_vendor, ssl_info)
            detected_model = real_model or f"{detected_vendor or 'Storage'} NAS"
            reasoning = f"NAS storage confirmed by: {', '.join(nas_evidence)}"
            return (dev_type, detected_vendor or "NAS Storage", detected_model, confidence, nas_evidence, reasoning)

        # 7. Server
        if server_score >= 45:
            dev_type = "server"
            confidence = min(100, server_score)
            if not detected_vendor:
                detected_vendor = _vendor_from_text(combined_text, ["vmware", "proxmox", "dell", "hp", "supermicro", "intel"])
            real_model = _extract_real_model(http_title, http_server, snmp_descr, hostname, detected_vendor, ssl_info)
            detected_model = real_model or f"{detected_vendor or 'Compute'} Server"
            reasoning = f"Server confirmed by: {', '.join(server_evidence)}"
            return (dev_type, detected_vendor or "Server Host", detected_model, confidence, server_evidence, reasoning)

        # 8. Single weak signal fallback -> Workstation if SSH or RDP or SMB
        if 22 in open_ports or 3389 in open_ports or 445 in open_ports:
            return ("workstation", detected_vendor or "Unknown", "Workstation PC", 50, ["Remote access / SMB active"], "Likely Workstation based on remote access service")

        # 9. Generic Web Device -> UNKNOWN (Never blindly guess Camera)
        if 80 in open_ports or 443 in open_ports or 8080 in open_ports:
            return ("unknown", detected_vendor or "Web Device", http_title[:30] or "HTTP Device", 35, [f"HTTP/HTTPS active (port {[p for p in [80, 443, 8080] if p in open_ports]})"], "Web-enabled device with insufficient classification evidence")

        return ("unknown", detected_vendor or "Unknown Device", "Network Device", 20, ["Basic network response"], "Insufficient evidence for conclusive classification")


class NetworkDiscoveryManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super(NetworkDiscoveryManager, cls).__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        self._initialized = True
        self.is_scanning = False
        self.scan_lock = threading.Lock()
        self._save_lock = threading.RLock()
        self.stop_event = threading.Event()
        self.watcher_thread: Optional[threading.Thread] = None
        
        self.last_scan_time: Optional[str] = None
        self.last_scan_duration_s: float = 0.0
        self.current_subnet: Optional[str] = None
        self.scan_progress_percent: int = 0
        self.discovered_count: int = 0
        self.last_error: Optional[str] = None

        self.watcher_interval = 25
        self.full_scan_interval = 300  # 5 minutes
        self.last_full_scan_time = 0.0

    @property
    def db(self):
        global _core_db, mongo_client
        if _core_db is not None:
            return _core_db
        if mongo_client:
            from app.core.database import MONGO_DB_NAME, db as loaded_db
            return loaded_db if loaded_db is not None else mongo_client[MONGO_DB_NAME]
        return None

    @property
    def nodes_col(self):
        d = self.db
        return d["infrastructure_nodes"] if d is not None else None

    @property
    def alerts_col(self):
        d = self.db
        return d["infrastructure_alerts"] if d is not None else None

    def get_scan_status(self) -> Dict[str, Any]:
        return {
            "is_scanning": self.is_scanning,
            "progress_percent": self.scan_progress_percent,
            "current_subnet": self.current_subnet,
            "discovered_count": self.discovered_count,
            "last_scan_time": self.last_scan_time,
            "last_scan_duration_s": round(self.last_scan_duration_s, 2),
            "last_error": self.last_error
        }

    def inspect_ip(self, ip: str, arp_map: Dict[str, str], default_gateway: Optional[str]) -> Optional[Dict[str, Any]]:
        latency = DeviceIdentifier.ping_device(ip, timeout_ms=300)
        open_ports = []
        
        # Probe strategic ports in parallel for fast response
        with ThreadPoolExecutor(max_workers=min(16, len(DeviceIdentifier.STRATEGIC_PORTS))) as port_pool:
            port_futures = {
                port_pool.submit(DeviceIdentifier.probe_tcp_port, ip, port, 0.3): port
                for port in DeviceIdentifier.STRATEGIC_PORTS.keys()
                if port != 161
            }
            for pf in as_completed(port_futures):
                p = port_futures[pf]
                try:
                    if pf.result():
                        open_ports.append(p)
                except Exception:
                    pass

        # Check if known in ARP table even if ping/ports blocked
        mac = arp_map.get(ip)
        is_alive = (latency >= 0) or (len(open_ports) > 0)
        if not is_alive:
            return None

        # Re-resolve ARP for THIS ip now that we've pinged/probed it — the
        # pre-sweep snapshot is often stale for hosts that were previously idle.
        if not mac:
            mac = ArpReader.get_mac_for_ip(ip)

        if latency < 0:
            latency = 4.0

        oui_vendor, oui_type = lookup_oui(mac) if mac else ("Unknown", None)
        hostname = DeviceIdentifier.resolve_hostname(ip)

        http_server, http_title, ssl_info = "", "", ""
        web_ports = [p for p in [443, 8443, 80, 8080] if p in open_ports]
        for wp in web_ports:
            s_hdr, tit, s_inf = DeviceIdentifier.grab_http_banner(ip, wp)
            if s_hdr and not http_server:
                http_server = s_hdr
            if tit and not http_title:
                http_title = tit
            if s_inf and not ssl_info:
                ssl_info = s_inf
            if http_title or ssl_info:
                break

        rtsp_server, rtsp_realm = "", ""
        if 554 in open_ports:
            rtsp_server, rtsp_realm = DeviceIdentifier.grab_rtsp_banner(ip, 554)

        snmp_descr = ""
        if 161 in open_ports or len(open_ports) > 0:
            snmp_descr = DeviceIdentifier.query_snmp_sysdescr(ip)

        is_gw = (ip == default_gateway)

        # Camera classification is owned exclusively by discovery_service.py.
        # If this device is already recorded as a camera, preserve its camera identity and metadata.
        existing_doc = None
        if self.nodes_col is not None:
            if mac:
                existing_doc = self.nodes_col.find_one({"mac": mac})
            if not existing_doc and ip:
                existing_doc = self.nodes_col.find_one({"ip": ip})

        if existing_doc and existing_doc.get("type") == "camera":
            dev_type = "camera"
            vendor = existing_doc.get("vendor") or existing_doc.get("manufacturer") or oui_vendor
            model = existing_doc.get("model") or f"{vendor} Camera"
            confidence = existing_doc.get("confidence", 100)
            evidence = existing_doc.get("classification_evidence") or ["Confirmed by discovery_service"]
            reason = existing_doc.get("classification_reason") or "Camera verified by discovery service"
        else:
            dev_type, vendor, model, confidence, evidence, reason = DeviceClassifier.classify(
                ip=ip,
                mac=mac,
                open_ports=open_ports,
                hostname=hostname,
                oui_vendor=oui_vendor,
                oui_suggested_type=oui_type,
                http_server=http_server,
                http_title=http_title,
                ssl_info=ssl_info,
                rtsp_server=rtsp_server,
                rtsp_realm=rtsp_realm,
                snmp_descr=snmp_descr,
                is_default_gateway=is_gw
            )

        # Real-time identity straight from the device, not from tables
        if dev_type != "camera":
            up_mfg, up_model = DeviceIdentifier.query_upnp(ip)
            if up_mfg:
                vendor = up_mfg[:45]
            if up_model:
                model = up_model[:45]

        # Never store placeholder text ("Workstation", "Network Gateway"...) as manufacturer
        if is_placeholder_vendor(vendor):
            vendor = oui_vendor if not is_placeholder_vendor(oui_vendor) else "Unknown"

        detected_services = [
            f"{DeviceIdentifier.STRATEGIC_PORTS.get(p, 'tcp')}:{p}"
            for p in open_ports
        ]

        return {
            "ip": ip,
            "mac": mac,
            "hostname": hostname,
            "vendor": vendor,
            "manufacturer": vendor,
            "model": model,
            "type": dev_type,
            "confidence": confidence,
            "classification_evidence": evidence,
            "classification_reason": reason,
            "status": "online",
            "latency": latency,
            "open_ports": open_ports,
            "detected_services": detected_services,
            "last_seen": datetime.utcnow(),
            "inferred": False
        }

    def save_or_update_device(self, dev: Dict[str, Any]) -> Tuple[Dict[str, Any], bool, bool]:
        with self._save_lock:
            return self._save_or_update_device_unlocked(dev)

    def _save_or_update_device_unlocked(self, dev: Dict[str, Any]) -> Tuple[Dict[str, Any], bool, bool]:
        """
        Saves or updates a discovered device in MongoDB with classification locking & hysteresis.
        Uses MAC address as the primary identity whenever available.
        Preserves topology position, edges, history, and credentials across IP changes.
        """
        col = self.nodes_col
        if col is None:
            return (dev, False, False)

        mac = dev.get("mac")
        ip = dev.get("ip")
        now = datetime.utcnow()

        existing = None
        ip_changed = False
        is_new = False

        if mac:
            existing = col.find_one({"mac": mac})

        if not existing and ip:
            if mac:
                # only adopt an IP-matched doc that has no MAC yet
                existing = col.find_one({"ip": ip, "$or": [{"mac": None}, {"mac": ""}]})
            else:
                existing = col.find_one({"ip": ip})

        if mac:
            node_id = f"node-mac-{mac.replace(':', '')}"
        else:
            node_id = f"node-{ip.replace('.', '-')}"

        if not existing:
            is_new = True
            node_doc = {
                "id": node_id,
                "ip": ip,
                "mac": mac,
                "hostname": dev.get("hostname"),
                "vendor": dev.get("vendor", "Unknown Device"),
                "manufacturer": dev.get("manufacturer", "Unknown Device"),
                "model": dev.get("model", "Network Device"),
                "type": dev.get("type", "unknown"),
                "confidence": dev.get("confidence", 30),
                "classification_evidence": dev.get("classification_evidence", []),
                "classification_reason": dev.get("classification_reason", ""),
                "manual_override": False,
                "status": "online",
                "latency": dev.get("latency"),
                "open_ports": dev.get("open_ports", []),
                "detected_services": dev.get("detected_services", []),
                "first_seen": now,
                "last_seen": now,
                "consecutive_failures": 0,
                "inferred": False,
                "position": None
            }

            if dev.get("type") == "camera" and self.db is not None:
                cam_doc = self.db["cameras"].find_one({"ip": ip}, {"_id": 0, "username": 1, "password": 1})
                if cam_doc:
                    if cam_doc.get("username"):
                        node_doc["username"] = cam_doc["username"]
                    if cam_doc.get("password"):
                        node_doc["password"] = cam_doc["password"]

            col.insert_one(node_doc)
            print(f"[INVENTORY] [ADD] New device added: {node_id} ({ip} | MAC={mac or 'N/A'} | {node_doc['type']} | {node_doc['model']})")
            return (node_doc, True, False)

        else:
            old_ip = existing.get("ip")
            should_update_ip = False
            if ip and old_ip and old_ip != ip:
                new_conf = dev.get("confidence", 0)
                old_conf = existing.get("confidence", 0)
                # Only rebind IP if new probe has equal/higher confidence, active ports, or existing node is offline
                if new_conf >= old_conf or existing.get("status") == "offline" or len(dev.get("open_ports", [])) > 0:
                    should_update_ip = True
                    ip_changed = True
                    print(f"[INVENTORY] [IP_CHANGED] IP Changed for MAC {mac}: {old_ip} -> {ip} (Preserving topology position & edges)")
                else:
                    print(f"[INVENTORY] [DEDUP] Suppressed IP flip for MAC {mac}: keeping {old_ip}, ignoring candidate {ip}")

            # Check for User Manual Override
            if existing.get("manual_override"):
                update_fields = {"last_seen": now}
                if dev.get("open_ports") is not None:
                    update_fields["open_ports"] = dev["open_ports"]
                if dev.get("detected_services") is not None:
                    update_fields["detected_services"] = dev["detected_services"]
                if dev.get("latency") is not None:
                    update_fields["latency"] = dev["latency"]
                if dev.get("status") == "online" or dev.get("latency") is not None:
                    update_fields["status"] = "online"
                    update_fields["consecutive_failures"] = 0

                if should_update_ip:
                    update_fields["ip"] = ip
                if mac and not existing.get("mac"):
                    update_fields["mac"] = mac
                col.update_one({"_id": existing["_id"]}, {"$set": update_fields})
                return ({**existing, **update_fields}, False, ip_changed)

            # Classification Locking / Hysteresis
            existing_type = existing.get("type", "unknown")
            existing_conf = existing.get("confidence", 0)
            new_type = dev.get("type", "unknown")
            new_conf = dev.get("confidence", 0)

            should_update_type = False
            if existing_type in ("unknown", "other", None, ""):
                # Always upgrade from unknown/unclassified
                should_update_type = True
            elif new_type == "unknown":
                # NEVER downgrade a classified device to unknown
                should_update_type = False
            elif new_type == existing_type:
                # Same type - update evidence if confidence improved or equal
                should_update_type = (new_conf >= existing_conf)
            elif existing_conf < 50 and new_conf > existing_conf:
                # Upgrade legacy / unverified records with zero or weak confidence
                should_update_type = True
            elif new_conf >= 70 and new_conf > (existing_conf + 15):
                # Different type - require strong confidence (>=70) AND significant improvement (+15)
                should_update_type = True

            update_fields: Dict[str, Any] = {"last_seen": now}
            if dev.get("open_ports") is not None:
                update_fields["open_ports"] = dev["open_ports"]
            if dev.get("detected_services") is not None:
                update_fields["detected_services"] = dev["detected_services"]
            if dev.get("latency") is not None:
                update_fields["latency"] = dev["latency"]
            if dev.get("status") == "online" or dev.get("latency") is not None:
                update_fields["status"] = "online"
                update_fields["consecutive_failures"] = 0

            if should_update_ip:
                update_fields["ip"] = ip
            if mac and (not existing.get("mac") or existing.get("mac") in ("-", "—", "None", "Unknown")):
                update_fields["mac"] = mac
            if dev.get("hostname") and not existing.get("hostname"):
                update_fields["hostname"] = dev.get("hostname")

            if should_update_type:
                update_fields["type"] = new_type
                update_fields["confidence"] = new_conf
                update_fields["classification_evidence"] = dev.get("classification_evidence", [])
                update_fields["classification_reason"] = dev.get("classification_reason", "")
                if dev.get("vendor") and dev.get("vendor") != "Unknown":
                    update_fields["vendor"] = dev.get("vendor")
                    update_fields["manufacturer"] = dev.get("vendor")
                if dev.get("model") and dev.get("model") not in ("Device", "Network Device", "Network Node", "Unknown", None, ""):
                    update_fields["model"] = dev.get("model")

            # Always refresh manufacturer/model when the scan found a real value
            _v, _m = dev.get("vendor"), dev.get("model")
            if _v and not is_placeholder_vendor(_v):
                update_fields["vendor"] = _v
                update_fields["manufacturer"] = _v
            if _m and not is_placeholder_model(_m, _v):
                update_fields["model"] = _m

            col.update_one({"_id": existing["_id"]}, {"$set": update_fields})
            updated_doc = {**existing, **update_fields}
            return (updated_doc, False, ip_changed)

    def scan_network_sync(self, target_subnet: Optional[str] = None, scan_cameras: bool = True) -> List[Dict[str, Any]]:
        if not self.scan_lock.acquire(blocking=False):
            print("[DISCOVERY] [WARN] Scan already in progress, skipping duplicate scan request.")
            return []

        start_time = time.perf_counter()
        self.is_scanning = True
        self.scan_progress_percent = 0
        self.last_error = None

        discovered_list = []

        try:
            host_net = HostNetworkDetector.get_active_host_network()
            subnet_str = target_subnet or host_net["cidr"]
            self.current_subnet = subnet_str
            print(f"[DISCOVERY] [SCAN] Starting network discovery on {subnet_str} (Host: {host_net['ip']}, Interface: {host_net['interface']}, ScanCameras: {scan_cameras})")

            arp_map = ArpReader.get_arp_table()

            # Phase 1: Camera Discovery exclusively via discovery_service.py (Manual scan only)
            camera_ips = set()
            if scan_cameras:
                try:
                    from app.services.camera.discovery_service import discover_all
                    print("[DISCOVERY] Running camera discovery exclusively via discovery_service...")
                    cameras_found = discover_all(ws_timeout=5, scan_timeout_ms=1000)
                    print(f"[DISCOVERY] discovery_service found {len(cameras_found)} camera(s)")

                    # Enrich with any already-known real model/manufacturer from
                    # existing infrastructure_nodes or the registered cameras
                    # collection — these come from earlier AUTHENTICATED ONVIF
                    # calls (e.g. via Add Devices with credentials) and are far
                    # more trustworthy than an unauthenticated scan's guess.
                    registered_by_ip = {}
                    if self.db is not None:
                        try:
                            for reg in self.db["cameras"].find({}, {"_id": 0, "ip": 1, "manufacturer": 1, "model": 1}):
                                if reg.get("ip"):
                                    registered_by_ip[reg["ip"]] = reg
                        except Exception:
                            pass

                    for cam in cameras_found:
                        c_ip = cam.get("ip")
                        reg = registered_by_ip.get(c_ip)
                        if reg:
                            if reg.get("model") and reg["model"] not in ("Unknown", "", None):
                                cam["model"] = reg["model"]
                            if reg.get("manufacturer") and reg["manufacturer"] not in ("Unknown", "", None):
                                cam["manufacturer"] = reg["manufacturer"]

                        # Also preserve a previously-known good model from our own
                        # inventory, in case this device was scanned successfully
                        # (with credentials) at some earlier point.
                        if self.nodes_col is not None:
                            col = self.nodes_col
                            existing_node = col.find_one({"ip": c_ip, "type": "camera"}, {"model": 1, "manufacturer": 1})
                            if existing_node:
                                ex_mdl = existing_node.get("model")
                                if ex_mdl and ex_mdl not in ("Unknown", "", None, "vcs-videojet-webserver") and not ex_mdl.endswith(" Camera"):
                                    if not cam.get("model") or cam.get("model", "").endswith(" Camera"):
                                        cam["model"] = ex_mdl
                        c_ip = cam.get("ip")
                        if not c_ip:
                            continue
                        camera_ips.add(c_ip)
                        c_mac = cam.get("mac")
                        if not c_mac or c_mac == "Unknown":
                            c_mac = arp_map.get(c_ip) or ArpReader.get_mac_for_ip(c_ip)

                        mfg = cam.get("manufacturer") or "IP Camera"
                        mdl = cam.get("model") or f"{mfg} Camera"

                        cam_device = {
                            "ip": c_ip,
                            "mac": c_mac,
                            "type": "camera",
                            "vendor": mfg,
                            "manufacturer": mfg,
                            "model": mdl,
                            "confidence": 100,
                            "classification_evidence": ["Confirmed by discovery_service (RTSP port 554 + ONVIF/brand verification)"],
                            "classification_reason": f"Camera verified by discovery service ({mfg} {mdl})",
                            "status": "online",
                            "open_ports": [554],
                            "detected_services": ["rtsp:554"],
                            "last_seen": datetime.utcnow(),
                            "inferred": False
                        }
                        if cam.get("rtsp_url"):
                            cam_device["rtsp_url"] = cam["rtsp_url"]

                        self.save_or_update_device(cam_device)
                        discovered_list.append(cam_device)
                except Exception as cam_err:
                    print(f"[DISCOVERY] [WARN] Camera discovery via discovery_service failed: {cam_err}")

            # Phase 2: General Infrastructure Discovery for non-camera targets
            try:
                net_obj = ipaddress.IPv4Network(subnet_str, strict=False)
                if net_obj.num_addresses > 512:
                    host_ip = host_net["ip"]
                    parts = host_ip.split(".")
                    net_obj = ipaddress.IPv4Network(f"{parts[0]}.{parts[1]}.{parts[2]}.0/24", strict=False)
                host_ip = host_net["ip"]
                targets = [str(ip) for ip in net_obj.hosts() if str(ip) not in camera_ips and str(ip) != host_ip]
            except Exception as e:
                print(f"[DISCOVERY] Error parsing subnet: {e}, falling back to 192.168.1.0/24")
                targets = [f"192.168.1.{i}" for i in range(1, 255) if f"192.168.1.{i}" not in camera_ips]

            total_targets = len(targets)
            completed = 0
            max_workers = min(40, max(10, total_targets))

            with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="net-disc") as executor:
                futures = {
                    executor.submit(self.inspect_ip, ip, arp_map, host_net.get("default_gateway")): ip
                    for ip in targets
                }

                for future in as_completed(futures):
                    completed += 1
                    self.scan_progress_percent = int((completed / total_targets) * 100)
                    
                    try:
                        res = future.result()
                        if res:
                            discovered_list.append(res)
                            self.save_or_update_device(res)
                    except Exception:
                        pass

            # Post-scan ARP refresh to capture MAC addresses populated during the sweep
            refreshed_arp = ArpReader.get_arp_table()
            col = self.nodes_col
            if col is not None:
                for dev in discovered_list:
                    ip = dev["ip"]
                    if not dev.get("mac") and ip in refreshed_arp:
                        new_mac = refreshed_arp[ip]
                        vname, vtype = lookup_oui(new_mac)
                        if vname != "Unknown":
                            set_fields = {"mac": new_mac, "vendor": vname, "manufacturer": vname}
                            # Only fill in a real model if we're still on the generic placeholder —
                            # never clobber a model the classifier already earned from evidence.
                            existing_node = col.find_one({"ip": ip}, {"model": 1, "type": 1})
                            if existing_node and existing_node.get("model") in (None, "", "Network Device", "Device"):
                                set_fields["model"] = f"{vname} Device"
                            col.update_one({"ip": ip, "mac": {"$in": [None, ""]}}, {"$set": set_fields})

            self._ensure_host_node(host_net)

            self.last_scan_duration_s = time.perf_counter() - start_time
            self.last_scan_time = datetime.utcnow().isoformat()
            self.discovered_count = len(discovered_list)
            self.scan_progress_percent = 100
            print(f"[DISCOVERY] [OK] Scan finished in {self.last_scan_duration_s:.1f}s. Discovered {len(discovered_list)} devices.")

        except Exception as e:
            self.last_error = str(e)
            print(f"[DISCOVERY] [ERROR] Error during network discovery scan: {e}")
        finally:
            self.is_scanning = False
            self.scan_lock.release()

        return discovered_list

    def _ensure_host_node(self, host_net: Dict[str, Any]):
        col = self.nodes_col
        if col is None:
            return

        host_ip = host_net["ip"]
        now = datetime.utcnow()

        try:
            boot_ts = psutil.boot_time()
            bt = datetime.fromtimestamp(boot_ts)
            delta = datetime.now() - bt
            days = delta.days
            hours, rem = divmod(delta.seconds, 3600)
            mins, _ = divmod(rem, 60)
            uptime_str = f"{days}d {hours}h {mins}m"
            reboot_str = bt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            uptime_str, reboot_str = "Active", "N/A"

        col.update_one(
            {"id": "node-vms-host"},
            {
                "$setOnInsert": {
                    "id": "node-vms-host", "type": "server",
                    "manufacturer": "Mirador", "vendor": "Mirador AI", "model": "VMS Host",
                    "first_seen": now, "inferred": False,
                    "position": {"x": 400, "y": 80}
                },
                "$set": {
                    "ip": host_ip, "uptime": uptime_str, "last_reboot": reboot_str,
                    "status": "online", "last_seen": now, "consecutive_failures": 0
                }
            },
            upsert=True
        )

    def get_live_nodes(self, max_age_s: Optional[int] = None) -> List[Dict[str, Any]]:
        """Return inventory devices, strictly deduplicated across IP, MAC, and ID."""
        col = self.nodes_col
        if col is None:
            return []
        if max_age_s is not None:
            cutoff = datetime.utcnow() - timedelta(seconds=max_age_s)
            query = {"$or": [{"last_seen": {"$gte": cutoff}}, {"id": "node-vms-host"}]}
        else:
            query = {}
        docs = list(col.find(query, {"_id": 0}))
        rank = lambda d: (bool(d.get("position")),
                          d.get("confidence", 0),
                          d.get("last_seen") or datetime.min)

        seen_ips = set()
        seen_macs = set()
        seen_ids = set()
        unique_nodes = []

        for d in sorted(docs, key=rank, reverse=True):
            # Ignore stale legacy duplicate VMS Host doc if node-vms-host exists
            if d.get("id") != "node-vms-host" and (d.get("model") == "VMS Host" or (d.get("manufacturer") == "Mirador" and d.get("type") == "server")):
                continue

            node_id = d.get("id")
            ip = d.get("ip")
            mac = d.get("mac")

            if node_id and node_id in seen_ids:
                continue
            if ip and ip in seen_ips:
                continue
            if mac and mac in seen_macs:
                continue

            if node_id:
                seen_ids.add(node_id)
            if ip:
                seen_ips.add(ip)
            if mac:
                seen_macs.add(mac)

            unique_nodes.append(d)

        return unique_nodes

    def trigger_scan(self, subnet: Optional[str] = None, scan_cameras: bool = True) -> bool:
        if self.is_scanning:
            return False

        t = threading.Thread(
            target=self.scan_network_sync,
            args=(subnet,),
            kwargs={"scan_cameras": scan_cameras},
            name="bg-net-discovery",
            daemon=True
        )
        t.start()
        return True

    def check_known_inventory_health(self):
        """
        Polls all existing nodes in inventory.
        Applies a 3-consecutive-failure threshold before marking a node OFFLINE
        and triggering offline alerts/emails. Automatically restores to ONLINE on recovery.
        """
        col = self.nodes_col
        if col is None:
            return

        nodes = list(col.find({}))
        now = datetime.utcnow()

        def _check_single(node):
            node_id = node.get("id")
            ip = node.get("ip")
            if not ip or node.get("model") == "VMS Host":
                return

            prev_status = node.get("status", "online")
            failures = node.get("consecutive_failures", 0)

            latency = DeviceIdentifier.ping_device(ip, timeout_ms=300)
            is_reachable = (latency >= 0)

            if not is_reachable:
                open_ports = node.get("open_ports") or [554, 80, 8080, 22, 445]
                for p in open_ports[:4]:
                    if DeviceIdentifier.probe_tcp_port(ip, p, timeout_s=0.25):
                        is_reachable = True
                        latency = 5.0
                        break

            if is_reachable:
                new_status = "online"
                failures = 0
                update_set = {
                    "status": new_status,
                    "latency": latency,
                    "last_seen": now,
                    "consecutive_failures": 0
                }
                
                # If recovering from offline/degraded, log event
                if prev_status != "online":
                    print(f"[HEALTH] [RESTORE] Device {node.get('model') or ip} ({ip}) restored to ONLINE.")
                    if self.db is not None:
                        uptime_col = self.db.get("uptime_events")
                        if uptime_col is not None:
                            uptime_col.insert_one({
                                "node_id": node_id,
                                "event_type": node.get("type", "device"),
                                "state": "up",
                                "timestamp": now
                            })

            else:
                failures += 1
                if failures >= 3:
                    new_status = "offline"
                else:
                    new_status = "degraded" if prev_status == "online" else prev_status

                update_set = {
                    "status": new_status,
                    "consecutive_failures": failures
                }

                # Transition to offline on 3rd failure
                if prev_status != "offline" and new_status == "offline":
                    print(f"[HEALTH] [OFFLINE] Device {node.get('model') or ip} ({ip}) went OFFLINE (3 consecutive failures).")
                    
                    if self.alerts_col is not None:
                        alert = {
                            "node_id": node_id,
                            "ip": ip,
                            "model": node.get("model", ""),
                            "type": node.get("type", ""),
                            "event": "device_offline",
                            "message": f"{node.get('model') or ip} went OFFLINE",
                            "timestamp": now,
                            "acknowledged": False
                        }
                        self.alerts_col.insert_one(alert)

                    if self.db is not None:
                        uptime_col = self.db.get("uptime_events")
                        if uptime_col is not None:
                            uptime_col.insert_one({
                                "node_id": node_id,
                                "event_type": node.get("type", "device"),
                                "state": "down",
                                "timestamp": now
                            })

                    try:
                        from .email_alerts import alert_device_offline
                        alert_device_offline(node.get('model') or ip, ip)
                    except Exception:
                        pass

            col.update_one({"id": node_id}, {"$set": update_set})

        with ThreadPoolExecutor(max_workers=20, thread_name_prefix="inv-health") as ex:
            futures = [ex.submit(_check_single, n) for n in nodes]
            for _ in as_completed(futures):
                pass

    def run_continuous_watcher_loop(self):
        """
        Background loop:
          - Runs health polling & lightweight neighbor/ARP discovery every 25s.
          - Detects host subnet/IP changes and kicks off immediate rediscovery.
          - Runs scheduled full discovery sweep every 5-10m.
        """
        print(f"[WATCHER] Continuous Network Watcher started (Interval={self.watcher_interval}s, FullScan={self.full_scan_interval}s)")

        try:                                   # refresh the IEEE vendor list once at startup
            with _mac_lookup_lock:
                _get_mac_lookup().update_vendors()
        except Exception:
            pass

        self.stop_event.wait(2.0)
        if not self.stop_event.is_set():
            self.scan_network_sync(scan_cameras=False)
            self.last_full_scan_time = time.time()

        while not self.stop_event.is_set():
            try:
                # 1. Health check for existing nodes
                self.check_known_inventory_health()

                # 2. Fast lightweight ARP scan for new neighbors
                arp_map = ArpReader.get_arp_table()
                col = self.nodes_col
                if col is not None:
                    _cur_net = ipaddress.IPv4Network(
                        HostNetworkDetector.get_active_host_network()["cidr"], strict=False)
                    for arp_ip, arp_mac in arp_map.items():
                        try:
                            if ipaddress.ip_address(arp_ip) not in _cur_net:
                                continue
                        except ValueError:
                            continue
                        # Check if this MAC or IP is unknown in DB
                        existing = col.find_one({"$or": [{"mac": arp_mac}, {"ip": arp_ip}]})
                        if not existing:
                            # Fast inspect newly appeared ARP neighbor
                            host_net = HostNetworkDetector.get_active_host_network()
                            new_dev = self.inspect_ip(arp_ip, arp_map, host_net.get("default_gateway"))
                            if new_dev:
                                self.save_or_update_device(new_dev)

                # 3. Detect host network/subnet changes
                curr_net = HostNetworkDetector.get_active_host_network()
                if self.current_subnet and curr_net["cidr"] != self.current_subnet:
                    print(f"[WATCHER] [NET_CHANGE] Host network change detected: {self.current_subnet} -> {curr_net['cidr']}")
                    self.scan_network_sync(curr_net["cidr"], scan_cameras=False)
                    self.last_full_scan_time = time.time()

                # 4. Scheduled deep subnet sweep
                elif time.time() - self.last_full_scan_time >= self.full_scan_interval:
                    if not self.is_scanning:
                        print("[WATCHER] [SCHEDULED] Running scheduled full network discovery sweep (cameras excluded — manual scan only)...")
                        self.scan_network_sync(scan_cameras=False)
                        self.last_full_scan_time = time.time()

            except Exception as e:
                print(f"[WATCHER] Error in network watcher loop: {e}")

            self.stop_event.wait(self.watcher_interval)

        print("[WATCHER] Continuous Network Watcher stopped cleanly.")

    def start_watcher(self):
        if self.watcher_thread and self.watcher_thread.is_alive():
            return
        self.stop_event.clear()
        self.watcher_thread = threading.Thread(
            target=self.run_continuous_watcher_loop,
            name="bg-net-watcher",
            daemon=True
        )
        self.watcher_thread.start()

    def stop_watcher(self):
        self.stop_event.set()
        if self.watcher_thread:
            self.watcher_thread.join(timeout=3.0)


discovery_manager = NetworkDiscoveryManager()
