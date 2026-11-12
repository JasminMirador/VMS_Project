import os
import re
import json
import socket
import shutil
import subprocess
from datetime import datetime
from app.services.storage.raid_logger import log_raid_event

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))
CONFIG_FILE = os.path.join(DATA_DIR, "iscsi_config.json")
os.makedirs(DATA_DIR, exist_ok=True)


def _get_hostname() -> str:
    try:
        return socket.gethostname().lower()
    except Exception:
        return "mirador-server"


def _default_iqn() -> str:
    return f"iqn.1991-05.com.microsoft:{_get_hostname()}"


def _load_config() -> dict:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[ISCSI_SERVICE] Error reading config: {e}")
    
    return {
        "initiator_iqn": _default_iqn(),
        "portals": [],
        "targets": []
    }


def _save_config(cfg: dict):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        print(f"[ISCSI_SERVICE] Error saving config: {e}")


def run_ps_cmd(command: str, timeout: int = 15) -> tuple[bool, str]:
    """Execute PowerShell storage/iSCSI command safely."""
    try:
        cmd = ["powershell", "-NoProfile", "-NonInteractive", "-Command", command]
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        if res.returncode == 0:
            return True, res.stdout.strip()
        return False, res.stderr.strip() or res.stdout.strip()
    except Exception as e:
        return False, str(e)


def get_initiator_iqn() -> str:
    """Get the local Windows iSCSI initiator NodeAddress / IQN dynamically."""
    cfg = _load_config()

    # Query live Windows Initiator NodeAddress
    ok, out = run_ps_cmd("(Get-InitiatorPort).NodeAddress", timeout=6)
    if ok and out and out.startswith("iqn."):
        cfg["initiator_iqn"] = out
        _save_config(cfg)
        return out

    # Try iscsicli NodeName
    try:
        res = subprocess.run(
            ["iscsicli.exe", "NodeName"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        if res.returncode == 0 and res.stdout:
            for line in res.stdout.splitlines():
                line = line.strip()
                if line.startswith("iqn."):
                    cfg["initiator_iqn"] = line
                    _save_config(cfg)
                    return line
    except Exception:
        pass

    fallback = _default_iqn()
    cfg["initiator_iqn"] = fallback
    _save_config(cfg)
    return fallback


def get_iscsi_status() -> dict:
    """Return status of Windows iSCSI initiator subsystem."""
    iqn = get_initiator_iqn()
    cfg = _load_config()

    # Query service status if on Windows
    service_state = "Ready"
    ok, out = run_ps_cmd("(Get-Service msiscsi -ErrorAction SilentlyContinue).Status", timeout=5)
    if ok and out:
        service_state = out.strip().capitalize()

    # Query live connected sessions from OS
    ok_sess, sess_out = run_ps_cmd("(Get-IscsiSession -ErrorAction SilentlyContinue | Measure-Object).Count", timeout=5)
    live_sessions_count = int(sess_out) if ok_sess and sess_out.isdigit() else 0

    # Calculate actual connected storage from real mounted disks
    disks = get_iscsi_disks()
    total_tb = sum(d.get("size_tb", 0.0) for d in disks if d.get("status") in ("Online", "Healthy"))

    return {
        "initiator_iqn": iqn,
        "service_status": service_state,
        "portals_count": len(cfg.get("portals", [])),
        "targets_count": len(cfg.get("targets", [])),
        "connected_count": live_sessions_count or len([t for t in cfg.get("targets", []) if t.get("status") == "Connected"]),
        "total_storage_tb": round(total_tb, 2)
    }


def get_iscsi_targets() -> list[dict]:
    """Return list of discovered iSCSI targets with real OS connection state."""
    cfg = _load_config()
    targets = cfg.get("targets", [])

    # Query live targets from Windows iSCSI Initiator
    ok, out = run_ps_cmd("Get-IscsiTarget -ErrorAction SilentlyContinue | Select-Object NodeAddress, IsConnected | ConvertTo-Json", timeout=8)
    live_target_map = {}
    if ok and out:
        try:
            parsed = json.loads(out)
            if isinstance(parsed, dict):
                parsed = [parsed]
            for item in parsed:
                live_target_map[item.get("NodeAddress")] = bool(item.get("IsConnected", False))
        except Exception:
            pass

    # Check live active recording target to flag is_active_target
    try:
        from app.services.storage import raid_service
        active_rec_path = raid_service.get_active_recording_path().upper()
    except Exception:
        active_rec_path = "D:\\RECORDINGS"

    for t in targets:
        iqn = t.get("iqn")
        if iqn in live_target_map:
            t["status"] = "Connected" if live_target_map[iqn] else "Disconnected"

        drive_letter = str(t.get("mounted_drive", "")).upper().rstrip(":")
        t["is_active_target"] = bool(drive_letter and active_rec_path.startswith(f"{drive_letter}:"))

        # Real disk usage calculation from live mounted drive
        if drive_letter and os.path.exists(f"{drive_letter}:\\"):
            try:
                usage = shutil.disk_usage(f"{drive_letter}:\\")
                t["capacity_tb"] = round(usage.total / (1024 ** 4), 2)
                t["used_tb"] = round(usage.used / (1024 ** 4), 2)
                t["free_tb"] = round(usage.free / (1024 ** 4), 2)
            except Exception:
                pass

    return targets


def discover_portal(portal_ip: str, port: int = 3260) -> dict:
    """
    Register and scan an external iSCSI SAN portal IP (e.g. Dell PowerVault, QNAP, TrueNAS).
    Returns real targets discovered by the Windows iSCSI subsystem.
    """
    portal_ip = portal_ip.strip()
    if not portal_ip:
        return {"success": False, "error": "Invalid Portal IP address"}

    portal_str = f"{portal_ip}:{port}"
    cfg = _load_config()

    # 1. Register target portal with Windows iSCSI Initiator
    ps_cmd = (
        f"New-IscsiTargetPortal -TargetPortalAddress '{portal_ip}' -TargetPortalPortNumber {port} -ErrorAction Stop; "
        f"Update-IscsiTargetPortal -TargetPortalAddress '{portal_ip}' -ErrorAction SilentlyContinue; "
        f"Get-IscsiTarget | Select-Object NodeAddress, IsConnected | ConvertTo-Json"
    )
    ok, out = run_ps_cmd(ps_cmd, timeout=12)

    discovered_iqns = []
    if ok and out:
        try:
            parsed = json.loads(out)
            if isinstance(parsed, dict):
                parsed = [parsed]
            for item in parsed:
                iqn = item.get("NodeAddress")
                if iqn:
                    discovered_iqns.append({
                        "iqn": iqn,
                        "connected": bool(item.get("IsConnected", False))
                    })
        except Exception:
            for line in out.splitlines():
                if "iqn." in line:
                    m = re.search(r"(iqn\.[0-9a-zA-Z\.\-:_]+)", line)
                    if m:
                        discovered_iqns.append({"iqn": m.group(1), "connected": False})

    # If NO targets responded from that IP, report real failure and clean up any stale entries
    if not discovered_iqns:
        cfg["targets"] = [t for t in cfg.get("targets", []) if t.get("portal") != portal_str]
        cfg["portals"] = [p for p in cfg.get("portals", []) if p.get("address") != portal_str]
        _save_config(cfg)
        return {
            "success": False,
            "error": f"No active iSCSI targets discovered at {portal_str}. Ensure the SAN appliance is online, reachable, and has port 3260 open."
        }

    # Record portal in config
    existing_portals = cfg.get("portals", [])
    if not any(p.get("address") == portal_str for p in existing_portals):
        existing_portals.append({
            "address": portal_str,
            "ip": portal_ip,
            "port": port,
            "last_scan": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "status": "Online"
        })
        cfg["portals"] = existing_portals

    # Record REAL discovered targets
    existing_targets = cfg.get("targets", [])
    new_targets_count = 0
    for d in discovered_iqns:
        iqn = d["iqn"]
        if not any(t.get("iqn") == iqn for t in existing_targets):
            # Parse human friendly name from IQN
            name_part = iqn.split(":")[-1] if ":" in iqn else "LUN"
            existing_targets.append({
                "id": f"iscsi_{len(existing_targets) + 1}",
                "name": f"SAN LUN ({name_part})",
                "iqn": iqn,
                "portal": portal_str,
                "status": "Connected" if d["connected"] else "Disconnected",
                "mounted_drive": "",
                "capacity_tb": 0.0,
                "used_tb": 0.0,
                "free_tb": 0.0,
                "target_volume": ""
            })
            new_targets_count += 1

    cfg["targets"] = existing_targets
    _save_config(cfg)

    log_raid_event("INFO", "ISCSI", f"Discovered SAN Portal {portal_str}", {
        "portal": portal_str,
        "targets_found": len(discovered_iqns)
    })

    return {
        "success": True,
        "portal": portal_str,
        "targets": cfg["targets"],
        "message": f"Successfully discovered {len(discovered_iqns)} live iSCSI LUN target(s) on {portal_str}."
    }


def connect_target(target_iqn: str, portal_ip: str = None) -> dict:
    """
    Log into a real iSCSI target and establish active session.
    """
    cfg = _load_config()
    targets = cfg.get("targets", [])
    found = next((t for t in targets if t.get("iqn") == target_iqn), None)

    if not found:
        return {"success": False, "error": f"Target IQN '{target_iqn}' not found."}

    # Execute Connect-IscsiTarget in Windows
    cmd = f"Connect-IscsiTarget -NodeAddress '{target_iqn}' -IsPersistent $True -ErrorAction Stop"
    ok, out = run_ps_cmd(cmd, timeout=15)

    if not ok:
        return {
            "success": False,
            "error": f"Failed to connect to iSCSI target '{target_iqn}': {out}"
        }

    # Query Windows Storage subsystem for newly mounted block devices
    ps_disk_cmd = "Get-Disk | Where-Object {$_.BusType -eq 'iSCSI'} | Select-Object Number, FriendlyName, OperationalStatus, Size, PartitionStyle | ConvertTo-Json"
    ok_disk, out_disk = run_ps_cmd(ps_disk_cmd, timeout=8)

    mounted_letter = ""
    disk_size_tb = 0.0

    if ok_disk and out_disk:
        try:
            parsed = json.loads(out_disk)
            if isinstance(parsed, dict):
                parsed = [parsed]
            if parsed:
                size_bytes = parsed[0].get("Size", 0)
                disk_size_tb = round(size_bytes / (1024 ** 4), 2)
        except Exception:
            pass

    found["status"] = "Connected"
    if disk_size_tb > 0:
        found["capacity_tb"] = disk_size_tb
        found["free_tb"] = disk_size_tb

    _save_config(cfg)

    log_raid_event("INFO", "ISCSI", f"Connected iSCSI Target LUN: {found.get('name')}", {
        "iqn": target_iqn,
        "portal": found.get("portal")
    })

    return {
        "success": True,
        "message": f"Connected to {found.get('name')} successfully.",
        "target": found
    }


def disconnect_target(target_iqn: str) -> dict:
    """
    Disconnect active iSCSI target session.
    """
    cfg = _load_config()
    targets = cfg.get("targets", [])
    found = next((t for t in targets if t.get("iqn") == target_iqn), None)

    if not found:
        return {"success": False, "error": f"Target IQN '{target_iqn}' not found."}

    # Safety check: Is this target currently receiving live recordings?
    try:
        from app.services.storage import raid_service
        active_rec = raid_service.get_active_recording_path().upper()
        drive_letter = str(found.get("mounted_drive", "")).upper().rstrip(":")
        if drive_letter and active_rec.startswith(f"{drive_letter}:"):
            return {
                "success": False,
                "error": f"Cannot disconnect target: Drive {drive_letter}: is currently the Active Recording Target! Please switch recording destination before disconnecting."
            }
    except Exception:
        pass

    # Execute Disconnect-IscsiTarget
    cmd = f"Disconnect-IscsiTarget -NodeAddress '{target_iqn}' -Confirm:$False -ErrorAction SilentlyContinue"
    ok, out = run_ps_cmd(cmd, timeout=12)

    found["status"] = "Disconnected"
    found["mounted_drive"] = ""
    found["target_volume"] = ""
    _save_config(cfg)

    log_raid_event("INFO", "ISCSI", f"Disconnected iSCSI Target LUN: {found.get('name')}", {
        "iqn": target_iqn,
        "portal": found.get("portal")
    })

    return {
        "success": True,
        "message": f"Disconnected {found.get('name')}.",
        "target": found
    }


def remove_portal(portal_ip: str) -> dict:
    """Remove a configured SAN portal and associated targets."""
    cfg = _load_config()
    portals = [p for p in cfg.get("portals", []) if portal_ip not in p.get("address", "")]
    targets = [t for t in cfg.get("targets", []) if portal_ip not in t.get("portal", "")]

    cfg["portals"] = portals
    cfg["targets"] = targets
    _save_config(cfg)

    # PowerShell portal removal
    run_ps_cmd(f"Remove-IscsiTargetPortal -TargetPortalAddress '{portal_ip}' -Confirm:$False -ErrorAction SilentlyContinue")

    log_raid_event("INFO", "ISCSI", f"Removed SAN Target Portal: {portal_ip}")
    return {"success": True, "message": f"Removed portal {portal_ip}."}


def get_iscsi_disks() -> list[dict]:
    """
    Return REAL physical block disks connected over the iSCSI bus reported by Windows kernel.
    Returns empty list if no real iSCSI disks are connected.
    """
    disks = []
    
    # Query Windows Storage subsystem for real disks with BusType iSCSI
    ps_cmd = "Get-Disk | Where-Object {$_.BusType -eq 'iSCSI'} | Select-Object Number, FriendlyName, OperationalStatus, Size, PartitionStyle | ConvertTo-Json"
    ok, out = run_ps_cmd(ps_cmd, timeout=8)

    if ok and out:
        try:
            parsed = json.loads(out)
            if isinstance(parsed, dict):
                parsed = [parsed]
            for d in parsed:
                size_bytes = d.get("Size", 0)
                size_tb = round(size_bytes / (1024 ** 4), 2)
                disks.append({
                    "disk_number": d.get("Number", 0),
                    "name": d.get("FriendlyName", "iSCSI Virtual Disk"),
                    "status": d.get("OperationalStatus", "Online"),
                    "size_tb": size_tb,
                    "partition_style": d.get("PartitionStyle", "RAW"),
                    "bus_type": "iSCSI"
                })
        except Exception:
            pass

    return disks


def format_and_mount_lun(disk_number: int, drive_letter: str = "E", label: str = "Mirador_iSCSI_LUN") -> dict:
    """
    Initialize RAW iSCSI LUN disk with GPT, create partition, format NTFS 64KB, and assign drive letter.
    """
    drive_letter = drive_letter.strip().rstrip(":").upper()
    label = re.sub(r'[^a-zA-Z0-9_\-]', '', label)[:32] or "Mirador_iSCSI_LUN"

    ps_cmd = (
        f"Initialize-Disk -Number {disk_number} -PartitionStyle GPT -ErrorAction Stop; "
        f"$p = New-Partition -DiskNumber {disk_number} -UseMaximumSize -AssignDriveLetter -ErrorAction Stop; "
        f"Format-Volume -Partition $p -FileSystem NTFS -AllocationUnitSize 65536 -NewFileSystemLabel '{label}' -Confirm:$False -ErrorAction Stop"
    )
    ok, out = run_ps_cmd(ps_cmd, timeout=30)

    if not ok:
        return {"success": False, "error": f"Failed to format disk {disk_number}: {out}"}

    # Update config target entry
    cfg = _load_config()
    for t in cfg.get("targets", []):
        if t.get("status") == "Connected" and not t.get("mounted_drive"):
            t["mounted_drive"] = drive_letter
            t["target_volume"] = f"{drive_letter}:\\Recordings"
            break
    _save_config(cfg)

    log_raid_event("INFO", "ISCSI", f"Initialized & Mounted iSCSI LUN on Drive {drive_letter}:", {
        "disk_number": disk_number,
        "drive_letter": drive_letter,
        "format": "NTFS (64 KB Cluster)",
        "label": label
    })

    return {
        "success": True,
        "drive_letter": drive_letter,
        "path": f"{drive_letter}:\\Recordings",
        "message": f"Disk {disk_number} formatted with GPT/NTFS and mounted as {drive_letter}:\\ ({label})."
    }
