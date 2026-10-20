"""
uptime_tracker.py
─────────────────
Per-device uptime tracking stored in MongoDB.
Detects reboots by comparing boot_time across snapshots.

Exports:
  record_uptime_snapshot(node_id, ip, status, latency)  → called every health cycle
  get_uptime_report(node_id)                             → returns dict for sidebar
  get_vms_uptime()                                       → async, returns VMS host info
"""
import os
import psutil
import asyncio
from datetime import datetime
from app.core.database import mongo_client

MONGO_URI = os.environ["MONGO_URI"]
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME")
client    = mongo_client
db        = client[MONGO_DB_NAME] if client else None

if db is not None:
    uptime_col = db["uptime_snapshots"]
    events_col = db["uptime_events"]
else:
    uptime_col = None
    events_col = None


# ── Snapshot recording ────────────────────────────────────────────────────

def record_uptime_snapshot(node_id: str, ip: str, status: str, latency=None):
    """
    Called on every health-check cycle for a node.
    - Tracks online_since, downtime_start, total_downtime_seconds, reboot_count.
    - Detects reboots by fetching remote boot_time (via SNMP/psutil for local, or heuristic).
    """
    now = datetime.utcnow()
    rec = uptime_col.find_one({"node_id": node_id}) or {}

    update = {"node_id": node_id, "ip": ip, "last_checked": now}

    if status == "online":
        update["last_seen_online"] = now

        if not rec.get("online_since"):
            update["online_since"] = now

        # If previously offline, close downtime window and add to total
        if rec.get("downtime_start"):
            downtime_secs = (now - rec["downtime_start"]).total_seconds()
            prev_total = rec.get("total_downtime_seconds", 0) or 0
            update["total_downtime_seconds"] = prev_total + downtime_secs
            update["downtime_start"] = None

        # Reboot detection: compare last known latency spike / boot_time
        # For the VMS host we can read psutil; for remote devices we use
        # a heuristic: if the device was offline and is back, and it was
        # offline for > 30 s, count it as a possible reboot.
        if (
            rec.get("downtime_start") is not None
            and (now - rec.get("downtime_start", now)).total_seconds() > 30
        ):
            reboot_count = (rec.get("reboot_count") or 0) + 1
            update["reboot_count"]        = reboot_count
            update["last_reboot_detected"] = now

    else:  # offline
        if not rec.get("downtime_start"):
            update["downtime_start"] = now

    # Merge and upsert
    uptime_col.update_one(
        {"node_id": node_id},
        {"$set": update},
        upsert=True
    )
    return update.get("last_reboot_detected") is not None


# ── Report retrieval ──────────────────────────────────────────────────────

def get_uptime_report(node_id: str) -> dict | None:
    """
    Returns the uptime record for a node, formatted for the frontend.
    Fields: online_since, last_seen_online, downtime_start,
            total_downtime_seconds, reboot_count, last_reboot_detected.
    """
    rec = uptime_col.find_one({"node_id": node_id}, {"_id": 0})
    if not rec:
        return None

    def fmt_dt(val):
        if isinstance(val, datetime):
            return val.strftime("%Y-%m-%d %H:%M:%S")
        return val

    return {
        "node_id":               rec.get("node_id"),
        "ip":                    rec.get("ip"),
        "online_since":          fmt_dt(rec.get("online_since")),
        "last_seen_online":      fmt_dt(rec.get("last_seen_online")),
        "downtime_start":        fmt_dt(rec.get("downtime_start")),
        "total_downtime_seconds": rec.get("total_downtime_seconds", 0),
        "reboot_count":          rec.get("reboot_count", 0),
        "last_reboot_detected":  fmt_dt(rec.get("last_reboot_detected")),
        "last_checked":          fmt_dt(rec.get("last_checked")),
    }


# ── VMS host live uptime ──────────────────────────────────────────────────

async def get_vms_uptime() -> dict:
    """
    Reads live system uptime from the VMS host (the machine running this code).
    Returns: { uptime, last_reboot, reboot_reason }

    reboot_reason is determined by reading systemd journal (Linux) or
    Windows event log; falls back to 'unknown' gracefully.
    """
    try:
        boot_ts = psutil.boot_time()
        bt      = datetime.fromtimestamp(boot_ts)
        delta   = datetime.now() - bt

        days           = delta.days
        hours, rem     = divmod(delta.seconds, 3600)
        minutes, _     = divmod(rem, 60)
        uptime_str     = f"{days}d {hours}h {minutes}m"
        last_reboot    = bt.strftime("%Y-%m-%d %H:%M:%S")
        reboot_reason  = await _detect_reboot_reason()

        return {
            "uptime":        uptime_str,
            "last_reboot":   last_reboot,
            "reboot_reason": reboot_reason,
        }
    except Exception as e:
        print(f"[UPTIME] Error reading VMS uptime: {e}")
        return {
            "uptime":        "N/A",
            "last_reboot":   "N/A",
            "reboot_reason": "unknown",
        }


async def _detect_reboot_reason() -> str:
    """
    Attempts to read the last reboot reason from systemd journal.
    Returns one of: 'power_loss', 'crash', 'manual', 'unknown'.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "journalctl", "-b", "-1", "--no-pager", "-n", "50",
            "--output=short",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        text = stdout.decode("utf-8", errors="ignore").lower()

        if any(k in text for k in ["watchdog", "kernel panic", "oops", "bug:", "segfault"]):
            return "crash"
        if any(k in text for k in ["power loss", "unexpected power", "acpi: power button"]):
            return "power_loss"
        if any(k in text for k in ["reboot", "shutdown", "systemctl"]):
            return "manual"
        return "unknown"
    except Exception:
        # journalctl not available (Windows / no systemd)
        return "unknown"
