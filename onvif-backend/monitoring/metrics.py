import os
import shutil
import psutil
from datetime import datetime
import time
import asyncio

_last_gpu_query_ts = 0.0
_cached_gpu_val = 0.0


async def get_system_metrics():
    """
    Gathers real-time hardware metrics from the host system.
    Cached GPU checks with fast timeout to prevent driver contention with external AI tasks.

    """
    try:
        global _last_gpu_query_ts, _cached_gpu_val

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

        # Non-blocking GPU caching (25s TTL, 0.8s timeout)
        now_ts = time.time()
        if (now_ts - _last_gpu_query_ts) < 25.0:
            gpu_usage = _cached_gpu_val
        else:
            try:
                proc = await asyncio.create_subprocess_exec(
                    "nvidia-smi",
                    "--query-gpu=utilization.gpu",
                    "--format=csv,noheader,nounits",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=0.8)
                gpu_usage = float(stdout.decode("utf-8").strip())
                _cached_gpu_val = gpu_usage
                _last_gpu_query_ts = now_ts
            except Exception:
                gpu_usage = _cached_gpu_val

        total_cores = psutil.cpu_count(logical=True) or 1
        used_cores = round((cpu_usage / 100.0) * total_cores, 1)
        free_cores = round(max(0.0, total_cores - used_cores), 1)

        return {
            "cpu": cpu_usage,
            "cpu_cores": total_cores,
            "cpu_used_cores": used_cores,
            "cpu_free_cores": free_cores,
            "ram": ram_usage,
            "disk": disk_usage,
            "gpu": gpu_usage,
            "uptime": uptime_str,
            "last_reboot": bt.strftime("%Y-%m-%d %H:%M:%S")
        }

    except Exception as e:
        print(f"[METRICS] Error gathering metrics: {e}")
        return None
