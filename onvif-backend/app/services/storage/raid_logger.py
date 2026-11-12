import os
import glob
from datetime import datetime

# Centralized RAID management log directories
BASE_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MAIN_LOGS_DIR = os.path.join(BASE_BACKEND_DIR, "logs")
SUB_LOGS_DIR = os.path.join(MAIN_LOGS_DIR, "raid_management")

os.makedirs(MAIN_LOGS_DIR, exist_ok=True)
os.makedirs(SUB_LOGS_DIR, exist_ok=True)


def _get_target_filepaths(date_str: str = None) -> list[str]:
    """
    Returns the target filepaths to write RAID logs so it appears both:
    1. Directly in onvif-backend/logs/raid_management.log (and raid_management.YYYY-MM-DD.log)
    2. Inside onvif-backend/logs/raid_management/YYYY-MM-DD.log
    """
    if not date_str:
        date_str = datetime.now().strftime("%Y-%m-%d")

    return [
        os.path.join(MAIN_LOGS_DIR, "raid_management.log"),
        os.path.join(MAIN_LOGS_DIR, f"raid_management.{date_str}.log"),
        os.path.join(SUB_LOGS_DIR, f"{date_str}.log")
    ]


def _create_baseline_content(date_str: str) -> str:
    """Generate comprehensive hardware baseline log explaining drive status & allocation."""
    try:
        from app.services.storage import raid_service
        status = raid_service.get_storage_status()
        devices = raid_service.get_storage_devices()
        vds = raid_service.get_virtual_disks()
        active_target = raid_service.get_active_recording_path()
        cli = raid_service.find_perccli_path()
    except Exception as e:
        status, devices, vds, active_target, cli = {}, [], [], "D:\\Recordings", None

    now_str = f"{date_str} {datetime.now().strftime('%H:%M:%S')}"
    lines = [
        "================================================================================",
        "  MIRADOR VMS - RAID & STORAGE MANAGEMENT AUDIT LOG",
        f"  Date: {date_str} | Generated at: {now_str}",
        "================================================================================",
        f"[{now_str}] [SYSTEM] [STARTUP] Initializing RAID Management Audit Record.",
        f"[{now_str}] [HARDWARE] [CONTROLLER] Storage Controller: {status.get('controller', 'Host Controller')} (Firmware: {status.get('firmware', 'N/A')})",
        f"[{now_str}] [HARDWARE] [DRIVER] Management Tool: {cli if cli else 'Windows Native Storage Engine'}",
        f"[{now_str}] [HARDWARE] [BBU_CACHE] Battery: {status.get('bbu_status', 'N/A')} ({status.get('bbu_temp', 'N/A')}) | Write Cache: {status.get('cache_policy', 'RWBD')}",
        f"[{now_str}] [INVENTORY] [PHYSICAL_DISKS] Total Connected Drive Bays: {len(devices)}",
    ]

    for d in devices:
        lines.append(f"    --> Bay {d.get('slot', 0)}: {d.get('name', 'Disk')} | Capacity: {d.get('size_display', '')} | State: {d.get('health', d.get('state', 'Online'))} | Bus: {d.get('interface', 'SAS')}")

    lines.append(f"[{now_str}] [INVENTORY] [VIRTUAL_DISKS] Configured RAID Virtual Disks:")
    for v in vds:
        lines.append(f"    --> {v.get('name', 'VD')}: {v.get('raid_level', 'RAID')} | Usable Size: {v.get('size', '')} | State: {v.get('state', 'Optimal')} | Target: {v.get('target_volume', 'Unassigned')}")

    lines.append(f"[{now_str}] [INFO] [ALLOCATION_EXPLANATION] Hardware Allocation Status & Why Existing Drives Are Protected:")
    lines.append("    --> Physical Drives in Bays 0, 1, 2, 3 are 100% committed to Virtual Disk 0 (OS & Primary RAID 5).")
    lines.append("    --> The Dell PERC H730 hardware controller blocks any raw physical re-partitioning on these 4 drives to protect the running Windows Server OS from destruction.")
    lines.append("    --> Creating raw hardware RAID arrays (e.g. RAID 1 / RAID 6) directly via PERCCLI requires free/unconfigured drives in unused chassis bays (e.g. Bays 4, 5, 6...).")
    lines.append("    --> For existing allocated drives, Mirador VMS provisions dedicated software/logical storage repositories (e.g. D:\\VMS_Arrays\\...), routing live recordings safely to that Active Target.")
    lines.append(f"[{now_str}] [STATUS] [ACTIVE_TARGET] Current Active Recording Destination: {active_target}")
    lines.append("--------------------------------------------------------------------------------\n")

    return "\n".join(lines)


def init_today_log():
    """Ensure today's log file exists on disk with baseline audit entries."""
    today = datetime.now().strftime("%Y-%m-%d")
    target_paths = _get_target_filepaths(today)
    
    # Check if primary log already has content
    if os.path.exists(target_paths[0]) and os.path.getsize(target_paths[0]) > 0:
        return

    content = _create_baseline_content(today)
    for fp in target_paths:
        try:
            os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception as e:
            print(f"[RAID-LOGGER] Failed to init log at {fp}: {e}")


def log_raid_event(level: str, category: str, message: str, details: dict = None):
    """
    Log a structured RAID event to today's daily log files.
    Writes simultaneously to onvif-backend/logs/raid_management.log
    and onvif-backend/logs/raid_management.<date>.log.
    """
    now = datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    date_str = now.strftime("%Y-%m-%d")

    # Format header line
    lines = [f"[{now_str}] [{level.upper()}] [{category.upper()}] {message}"]

    # Format optional structured details
    if details:
        if isinstance(details, dict):
            for k, v in details.items():
                lines.append(f"    --> {k}: {v}")
        elif isinstance(details, list):
            for item in details:
                lines.append(f"    --> {item}")
        else:
            lines.append(f"    --> {details}")

    log_entry = "\n".join(lines) + "\n"

    target_paths = _get_target_filepaths(date_str)
    for fp in target_paths:
        try:
            if not os.path.exists(fp) or os.path.getsize(fp) == 0:
                os.makedirs(os.path.dirname(fp), exist_ok=True)
                with open(fp, "w", encoding="utf-8") as f:
                    f.write(_create_baseline_content(date_str))
            with open(fp, "a", encoding="utf-8") as f:
                f.write(log_entry)
        except Exception as e:
            print(f"[RAID-LOGGER] Failed to write log to {fp}: {e}")


def get_available_log_dates() -> list[str]:
    """Return all dates for which daily RAID logs exist, sorted newest first."""
    try:
        dates = set()
        # Check MAIN_LOGS_DIR
        for fp in glob.glob(os.path.join(MAIN_LOGS_DIR, "raid_management.*.log")):
            name = os.path.basename(fp)
            parts = name.split(".")
            if len(parts) >= 3 and len(parts[1]) == 10 and parts[1].count("-") == 2:
                dates.add(parts[1])

        # Check SUB_LOGS_DIR
        for fp in glob.glob(os.path.join(SUB_LOGS_DIR, "*.log")):
            b = os.path.splitext(os.path.basename(fp))[0]
            if len(b) == 10 and b.count("-") == 2:
                dates.add(b)

        today = datetime.now().strftime("%Y-%m-%d")
        dates.add(today)
        return sorted(list(dates), reverse=True)
    except Exception as e:
        print(f"[RAID-LOGGER] Error listing dates: {e}")
        return [datetime.now().strftime("%Y-%m-%d")]


def get_daily_log(date_str: str = None) -> str:
    """
    Read log contents for a specific date (YYYY-MM-DD).
    If requesting today and log is empty, auto-populates system baseline audit log.
    """
    if not date_str:
        date_str = datetime.now().strftime("%Y-%m-%d")

    target_paths = _get_target_filepaths(date_str)
    
    # Try reading from any existing target path
    for fp in target_paths:
        if os.path.exists(fp) and os.path.getsize(fp) > 0:
            try:
                with open(fp, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                    if content.strip():
                        return content
            except Exception:
                pass

    # If none existed or was empty, generate baseline content once and write to all paths
    content = _create_baseline_content(date_str)
    for fp in target_paths:
        try:
            os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "w", encoding="utf-8") as f:
                f.write(content)
        except Exception:
            pass

    return content
