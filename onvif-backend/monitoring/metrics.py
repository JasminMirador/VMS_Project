import os
import shutil
import psutil
from datetime import datetime


async def get_system_metrics():
    """
    Gathers real-time hardware metrics from the host system.
    ✅ FIX #10: nvidia-smi now uses asyncio subprocess (non-blocking).
                Previously used subprocess.check_output which blocks the event loop.
    """
    try:
        import asyncio

        # CPU Usage
        cpu_usage = psutil.cpu_percent(interval=None)

        # RAM Usage
        ram = psutil.virtual_memory()
        ram_usage = ram.percent

        # Disk Usage (Root partition)
        try:
            root_path = os.path.splitdrive(os.path.abspath('.'))[0] + '\\' if os.name == 'nt' else '/'
            d_usage = shutil.disk_usage(root_path)
            disk_usage = round((d_usage.used / d_usage.total) * 100, 1) if d_usage.total > 0 else 0.0
        except Exception:
            disk_usage = 0.0

        # Uptime Calculation
        boot_time_timestamp = psutil.boot_time()
        bt = datetime.fromtimestamp(boot_time_timestamp)
        uptime_delta = datetime.now() - bt

        days = uptime_delta.days
        hours, rem = divmod(uptime_delta.seconds, 3600)
        minutes, _ = divmod(rem, 60)
        uptime_str = f"{days}d {hours}h {minutes}m"

        # ✅ FIX #10: GPU via async subprocess — doesn't block event loop
        gpu_usage = 0
        try:
            proc = await asyncio.create_subprocess_exec(
                "nvidia-smi",
                "--query-gpu=utilization.gpu",
                "--format=csv,noheader,nounits",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=3)
            gpu_usage = float(stdout.decode("utf-8").strip())
        except Exception:
            gpu_usage = 0  # No GPU or driver not present

        return {
            "cpu": cpu_usage,
            "ram": ram_usage,
            "disk": disk_usage,
            "gpu": gpu_usage,
            "uptime": uptime_str,
            "last_reboot": bt.strftime("%Y-%m-%d %H:%M:%S")
        }

    except Exception as e:
        print(f"[METRICS] Error gathering metrics: {e}")
        return None
