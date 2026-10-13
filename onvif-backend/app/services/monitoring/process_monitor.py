import os
import re
import sys
import time
import shutil
import psutil
from datetime import datetime
from app.core.database import cameras_col, db as _db

def _get_system_disk_percent() -> float:
    """Safe disk usage percent calculation across Linux and Windows."""
    try:
        root_path = os.path.splitdrive(os.path.abspath('.'))[0] + '\\' if os.name == 'nt' else '/'
        usage = shutil.disk_usage(root_path)
        if usage.total > 0:
            return round((usage.used / usage.total) * 100, 1)
    except Exception:
        pass
    return 0.0

_proc_cache = {}

def _get_cached_process(pid: int):
    """Reuse persistent Process objects to prevent psutil cpu_percent zero-delta spikes."""
    global _proc_cache
    if pid in _proc_cache:
        p = _proc_cache[pid]
        try:
            if p.is_running():
                return p
        except Exception:
            pass
    try:
        p = psutil.Process(pid)
        p.cpu_percent(interval=None)  # initialize baseline
        _proc_cache[pid] = p
        return p
    except Exception:
        _proc_cache.pop(pid, None)
        return None

def _extract_camera_ip_from_cmdline(cmdline: list) -> str:
    """Extract IP address from FFmpeg command line arguments if present."""
    if not cmdline:
        return ""
    full_str = " ".join(cmdline)
    ip_match = re.search(r'rtsp://(?:[^:@]+:[^:@]+@)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', full_str)
    if ip_match:
        return ip_match.group(1)
    
    stream_match = re.search(r'(\d{1,3}_\d{1,3}_\d{1,3}_\d{1,3})', full_str)
    if stream_match:
        return stream_match.group(1).replace("_", ".")
        
    return ""

def _extract_worker_id_from_cmdline(cmdline: list) -> str:
    """Extract --worker-id argument from recorder_worker process cmdline."""
    if not cmdline:
        return ""
    for i, arg in enumerate(cmdline):
        if arg == "--worker-id" and i + 1 < len(cmdline):
            return cmdline[i + 1]
    return ""

def _check_gpu_availability() -> dict:
    """Checks if an NVIDIA or Intel GPU is active on the system."""
    gpu_found = False
    gpu_name = "None (Pure CPU Mode)"
    try:
        import subprocess
        res = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True, timeout=2)
        if res.returncode == 0 and res.stdout.strip():
            gpu_found = True
            gpu_name = res.stdout.strip().splitlines()[0]
    except Exception:
        pass

    if not gpu_found:
        try:
            import torch
            if torch.cuda.is_available():
                gpu_found = True
                gpu_name = torch.cuda.get_device_name(0)
        except Exception:
            pass

    return {
        "gpu_active": gpu_found,
        "gpu_name": gpu_name,
        "mode": "GPU Hardware Acceleration Active" if gpu_found else "Pure CPU Software Mode (No GPU)"
    }

def sync_process_lifecycle_events(current_metrics):
    """
    Tracks and records start times, stop times, and uptime duration of all VMS processes
    into the process_lifecycle_logs MongoDB collection.
    """
    if _db is None:
        return
    
    try:
        from datetime import timezone
        lifecycle_col = _db["process_lifecycle_logs"]
        now_dt = datetime.now(timezone.utc)
        now_iso = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        
        live_procs = []
        procs_dict = current_metrics.get("processes", {})
        for group, p_list in procs_dict.items():
            for p in p_list:
                live_procs.append(p)
                
        active_pids = {p["pid"]: p for p in live_procs}

        active_db_records = list(lifecycle_col.find({"status": "ACTIVE"}))
        for rec in active_db_records:
            pid = rec.get("pid")
            if pid in active_pids:
                p_info = active_pids[pid]
                uptime_sec = p_info.get("uptime_seconds", 0)
                m, s = divmod(uptime_sec, 60)
                h, m = divmod(m, 60)
                uptime_fmt = f"{h}h {m}m {s}s" if h > 0 else f"{m}m {s}s"
                
                lifecycle_col.update_one(
                    {"_id": rec["_id"]},
                    {"$set": {
                        "last_seen": now_iso,
                        "uptime_seconds": uptime_sec,
                        "uptime_formatted": uptime_fmt,
                        "ram_mb": p_info.get("ram_mb", 0),
                        "cpu_percent": p_info.get("cpu_percent", 0)
                    }}
                )
            else:
                end_iso = rec.get("last_seen") or now_iso
                
                if rec.get("manual_kill"):
                    reason = "Manually Terminated via UI Cleanup"
                else:
                    reason = "Unexpected Process Crash / Stream Interrupted"
                    if rec.get("last_seen"):
                        try:
                            ls_clean = rec["last_seen"].replace("Z", "+00:00")
                            ls_dt = datetime.fromisoformat(ls_clean)
                            gap_sec = int((now_dt - ls_dt).total_seconds())
                            if gap_sec > 30:
                                m, s = divmod(gap_sec, 60)
                                h, m = divmod(m, 60)
                                gap_fmt = f"{h}h {m}m {s}s" if h > 0 else f"{m}m {s}s"
                                reason = f"Unexpected Crash / System Down (Downtime Gap: {gap_fmt})"
                        except Exception:
                            pass

                lifecycle_col.update_one(
                    {"_id": rec["_id"]},
                    {"$set": {
                        "status": "STOPPED",
                        "end_time": end_iso,
                        "exit_reason": reason
                    }}
                )

        db_active_pids = {r["pid"] for r in active_db_records}
        for pid, p_info in active_pids.items():
            if pid not in db_active_pids:
                uptime_sec = p_info.get("uptime_seconds", 0)
                start_ts = time.time() - uptime_sec
                start_dt_obj = datetime.fromtimestamp(start_ts, tz=timezone.utc)
                start_dt = start_dt_obj.strftime("%Y-%m-%dT%H:%M:%SZ")
                m, s = divmod(uptime_sec, 60)
                h, m = divmod(m, 60)
                uptime_fmt = f"{h}h {m}m {s}s" if h > 0 else f"{m}m {s}s"
                
                svc_key = p_info.get("service") or p_info.get("name", "Process")
                lifecycle_col.insert_one({
                    "pid": pid,
                    "name": p_info.get("name", "Process"),
                    "service": svc_key,
                    "role": p_info.get("role", "Service"),
                    "camera_ip": p_info.get("camera_ip", "N/A"),
                    "status": "ACTIVE",
                    "start_time": start_dt,
                    "end_time": None,
                    "last_seen": now_iso,
                    "uptime_seconds": uptime_sec,
                    "uptime_formatted": uptime_fmt,
                    "ram_mb": p_info.get("ram_mb", 0),
                    "cpu_percent": p_info.get("cpu_percent", 0),
                    "exit_reason": "Running"
                })
    except Exception as err:
        print(f"[PROCESS LIFECYCLE] Error syncing lifecycle events: {err}")

def get_process_history_logs(start_date=None, end_date=None, service=None, status=None, limit=100):
    """
    Fetches process start/stop uptime history with date range & service filtering.
    """
    if _db is None:
        return {"logs": [], "total": 0}
        
    try:
        lifecycle_col = _db["process_lifecycle_logs"]
        query = {}
        
        if start_date or end_date:
            time_query = {}
            if start_date:
                time_query["$gte"] = start_date
            if end_date:
                time_query["$lte"] = end_date
            query["$or"] = [
                {"start_time": time_query},
                {"end_time": time_query},
                {"last_seen": time_query}
            ]
                
        if service and service.lower() != "all":
            clean_svc = service.replace(".py", "").replace(".exe", "")
            query["$or"] = [
                {"service": {"$regex": clean_svc, "$options": "i"}},
                {"name": {"$regex": clean_svc, "$options": "i"}}
            ]
            
        if status and status.lower() != "all":
            st_val = "STOPPED" if "STOP" in status.upper() else ("ACTIVE" if "ACT" in status.upper() else status.upper())
            query["status"] = st_val

        total = lifecycle_col.count_documents(query)
        cursor = lifecycle_col.find(query, {"_id": 0}).sort("start_time", -1).limit(limit)
        logs = list(cursor)
        
        return {
            "success": True,
            "total": total,
            "logs": logs
        }
    except Exception as err:
        print(f"[PROCESS HISTORY] Error fetching process history: {err}")
        return {"success": False, "error": str(err), "logs": []}

def get_vms_process_metrics():
    """
    Scans all active running processes on the system using psutil.
    Categorizes VMS-related processes: Python Core Services, Recorder Workers,
    FFmpeg Instances, Infrastructure Services, and Frontend Server.
    Uses cached psutil.Process objects and normalized CPU calculation to prevent spike artifacts.
    """
    now_ts = time.time()
    num_cores = psutil.cpu_count() or 1
    sys_cpu = psutil.cpu_percent(interval=None)
    
    # Clean cache of dead PIDs
    global _proc_cache
    cached_pids = list(_proc_cache.keys())
    for cpid in cached_pids:
        try:
            if not _proc_cache[cpid].is_running():
                _proc_cache.pop(cpid, None)
        except Exception:
            _proc_cache.pop(cpid, None)

    # Fetch active cameras list from MongoDB for mapping
    active_cameras = {}
    registered_stream_ids = set()
    if cameras_col is not None:
        try:
            docs = list(cameras_col.find({}, {"_id": 0, "ip": 1, "ip_address": 1, "stream_key": 1, "enabled": 1}))
            for d in docs:
                cam_ip = d.get("ip_address") or d.get("ip") or ""
                stream_id = d.get("stream_key") or ""
                if cam_ip:
                    active_cameras[cam_ip] = d
                if stream_id:
                    registered_stream_ids.add(stream_id)
        except Exception:
            pass

    python_services = []
    recorder_workers = []
    ffmpeg_processes = []
    raw_infra_services = []
    frontend_services = []
    other_vms_processes = []

    total_vms_cpu = 0.0
    total_vms_ram_mb = 0.0

    for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'memory_info', 'num_threads', 'num_handles', 'create_time']):
        try:
            pinfo = proc.info
            name = (pinfo['name'] or "").lower()
            pid = pinfo['pid']
            cmdline = pinfo['cmdline'] or []
            cmd_str = " ".join(cmdline).lower()
            
            # Fetch smooth, cached CPU % calculation
            p_obj = _get_cached_process(pid)
            if p_obj:
                try:
                    raw_cpu = p_obj.cpu_percent(interval=None)
                    # Normalize CPU % (scale 0-100% per core) and cap against physical system load bounds
                    cpu_pct = round(raw_cpu / num_cores, 1)
                    if sys_cpu < 15.0 and cpu_pct > (sys_cpu * 1.5 + 5.0):
                        cpu_pct = round(sys_cpu / 3.0, 1)
                except Exception:
                    cpu_pct = 0.0
            else:
                cpu_pct = 0.0

            mem_info = pinfo['memory_info']
            ram_mb = round(mem_info.rss / (1024 * 1024), 1) if mem_info else 0.0
            threads = pinfo['num_threads'] or 0
            handles = pinfo['num_handles'] or 0
            uptime_sec = int(now_ts - pinfo['create_time']) if pinfo['create_time'] else 0

            # 1. FFmpeg Stream Transcoders
            if "ffmpeg" in name:
                cam_ip = _extract_camera_ip_from_cmdline(cmdline)
                is_orphaned = False
                if cam_ip and cam_ip not in active_cameras:
                    is_orphaned = True
                elif not cam_ip and uptime_sec > 60:
                    is_orphaned = True
                
                proc_entry = {
                    "pid": pid,
                    "name": pinfo['name'],
                    "role": "FFmpeg Stream Transcoder",
                    "camera_ip": cam_ip or "N/A",
                    "cpu_percent": cpu_pct,
                    "ram_mb": ram_mb,
                    "threads": threads,
                    "handles": handles,
                    "uptime_seconds": uptime_sec,
                    "is_orphaned": is_orphaned,
                    "cmdline": " ".join(cmdline[:8])
                }
                ffmpeg_processes.append(proc_entry)
                total_vms_cpu += cpu_pct
                total_vms_ram_mb += ram_mb

            # 2. Python Backend Processes
            elif "python" in name:
                if "run_api.py" in cmd_str or "uvicorn" in cmd_str or "app.main:app" in cmd_str:
                    python_services.append({
                        "pid": pid,
                        "name": "VMS API Server (run_api.py)",
                        "service": "run_api.py",
                        "role": "REST API & WebSocket Gateway",
                        "port": int(os.environ.get("BACKEND_PORT", 8000)),
                        "cpu_percent": cpu_pct,
                        "ram_mb": ram_mb,
                        "threads": threads,
                        "handles": handles,
                        "uptime_seconds": uptime_sec,
                        "is_orphaned": False
                    })
                    total_vms_cpu += cpu_pct
                    total_vms_ram_mb += ram_mb
                elif "run_scheduler.py" in cmd_str or "schedulers.main" in cmd_str:
                    python_services.append({
                        "pid": pid,
                        "name": "VMS Scheduler (run_scheduler.py)",
                        "service": "run_scheduler.py",
                        "role": "Retention & Storage Maintenance",
                        "cpu_percent": cpu_pct,
                        "ram_mb": ram_mb,
                        "threads": threads,
                        "handles": handles,
                        "uptime_seconds": uptime_sec,
                        "is_orphaned": False
                    })
                    total_vms_cpu += cpu_pct
                    total_vms_ram_mb += ram_mb
                elif "stream_manager" in cmd_str or "run_recorder.py" in cmd_str:
                    python_services.append({
                        "pid": pid,
                        "name": "VMS Stream Manager (stream_manager.py)",
                        "service": "stream_manager.py",
                        "role": "Worker Supervisor & Failover Manager",
                        "cpu_percent": cpu_pct,
                        "ram_mb": ram_mb,
                        "threads": threads,
                        "handles": handles,
                        "uptime_seconds": uptime_sec,
                        "is_orphaned": False
                    })
                    total_vms_cpu += cpu_pct
                    total_vms_ram_mb += ram_mb
                elif "recorder_worker.py" in cmd_str:
                    worker_id = _extract_worker_id_from_cmdline(cmdline)
                    is_standby = "--standby" in cmdline
                    recorder_workers.append({
                        "pid": pid,
                        "name": f"Worker ({worker_id or 'unknown'})",
                        "service": "recorder_worker.py",
                        "worker_id": worker_id or "worker-unknown",
                        "is_standby": is_standby,
                        "role": "Standby Worker" if is_standby else "Active Recording & Encryption Worker",
                        "cpu_percent": cpu_pct,
                        "ram_mb": ram_mb,
                        "threads": threads,
                        "handles": handles,
                        "uptime_seconds": uptime_sec,
                        "is_orphaned": False
                    })
                    total_vms_cpu += cpu_pct
                    total_vms_ram_mb += ram_mb

            # 3. Infrastructure Services
            elif "mongod" in name:
                raw_infra_services.append({
                    "pid": pid,
                    "name": "MongoDB Database",
                    "service": "mongod.exe",
                    "port": 27017,
                    "cpu_percent": cpu_pct,
                    "ram_mb": ram_mb,
                    "threads": threads,
                    "handles": handles,
                    "uptime_seconds": uptime_sec
                })
                total_vms_cpu += cpu_pct
                total_vms_ram_mb += ram_mb
            elif "minio" in name:
                raw_infra_services.append({
                    "pid": pid,
                    "name": "MinIO Object Storage",
                    "service": "minio.exe",
                    "port": 9000,
                    "cpu_percent": cpu_pct,
                    "ram_mb": ram_mb,
                    "threads": threads,
                    "handles": handles,
                    "uptime_seconds": uptime_sec
                })
                total_vms_cpu += cpu_pct
                total_vms_ram_mb += ram_mb
            elif "mosquitto" in name:
                raw_infra_services.append({
                    "pid": pid,
                    "name": "Mosquitto MQTT Broker",
                    "service": "mosquitto.exe",
                    "port": 1883,
                    "cpu_percent": cpu_pct,
                    "ram_mb": ram_mb,
                    "threads": threads,
                    "handles": handles,
                    "uptime_seconds": uptime_sec
                })
                total_vms_cpu += cpu_pct
                total_vms_ram_mb += ram_mb
            elif "mediamtx" in name:
                raw_infra_services.append({
                    "pid": pid,
                    "name": "MediaMTX Streaming Server",
                    "service": "mediamtx.exe",
                    "port": 8554,
                    "cpu_percent": cpu_pct,
                    "ram_mb": ram_mb,
                    "threads": threads,
                    "handles": handles,
                    "uptime_seconds": uptime_sec
                })
                total_vms_cpu += cpu_pct
                total_vms_ram_mb += ram_mb

            # 4. Frontend Web Server
            elif "node" in name and ("vite" in cmd_str or "miradorai-vms" in cmd_str):
                frontend_services.append({
                    "pid": pid,
                    "name": "React Frontend Dev Server",
                    "service": "node.exe",
                    "port": 5173,
                    "cpu_percent": cpu_pct,
                    "ram_mb": ram_mb,
                    "threads": threads,
                    "handles": handles,
                    "uptime_seconds": uptime_sec,
                    "is_orphaned": False
                })
                total_vms_cpu += cpu_pct
                total_vms_ram_mb += ram_mb

        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue

    # Detect duplicate FFmpeg processes for the same camera IP
    ffmpeg_by_ip = {}
    for f in ffmpeg_processes:
        ip = f.get("camera_ip")
        if ip and ip != "N/A":
            ffmpeg_by_ip.setdefault(ip, []).append(f)

    for ip, f_list in ffmpeg_by_ip.items():
        if len(f_list) > 1:
            # Keep the newest process (smallest uptime) as active, mark older duplicates as orphaned
            sorted_f = sorted(f_list, key=lambda x: x.get("uptime_seconds", 0))
            primary_pid = sorted_f[0]["pid"]
            for item in f_list:
                if item["pid"] != primary_pid:
                    item["is_orphaned"] = True
                    item["role"] = f"Stale Duplicate FFmpeg ({ip})"

    # Detect primary vs stale/orphaned infrastructure services
    infrastructure_services = []
    service_groups = {}
    for s in raw_infra_services:
        s_name = s["service"]
        service_groups.setdefault(s_name, []).append(s)

    for s_name, p_list in service_groups.items():
        sorted_p = sorted(p_list, key=lambda x: x["ram_mb"], reverse=True)
        primary_pid = sorted_p[0]["pid"]
        
        for item in p_list:
            is_stale = (len(p_list) > 1 and item["pid"] != primary_pid)
            item["is_orphaned"] = is_stale
            if is_stale:
                item["role"] = f"Stale Duplicate ({item['service']})"
            else:
                item["role"] = f"Active Primary ({item['service']})"
            infrastructure_services.append(item)

    stale_ffmpeg_count = sum(1 for f in ffmpeg_processes if f.get("is_orphaned"))
    stale_infra_count = sum(1 for i in infrastructure_services if i.get("is_orphaned"))
    total_stale_count = stale_ffmpeg_count + stale_infra_count

    metrics_res = {
        "timestamp": datetime.utcnow().isoformat(),
        "summary": {
            "total_vms_cpu_percent": round(total_vms_cpu, 1),
            "total_vms_ram_mb": round(total_vms_ram_mb, 1),
            "total_vms_ram_gb": round(total_vms_ram_mb / 1024, 2),
            "system_overall_cpu_percent": round(sys_cpu, 1),
            "system_overall_ram_percent": psutil.virtual_memory().percent,
            "system_overall_ram_used_gb": round(psutil.virtual_memory().used / (1024**3), 2),
            "system_overall_ram_total_gb": round(psutil.virtual_memory().total / (1024**3), 2),
            "system_overall_disk_used_percent": _get_system_disk_percent(),
            "total_python_services": len(python_services),
            "total_recorder_workers": len(recorder_workers),
            "total_ffmpeg_processes": len(ffmpeg_processes),
            "orphaned_ffmpeg_count": stale_ffmpeg_count,
            "stale_infrastructure_count": stale_infra_count,
            "total_stale_orphaned_count": total_stale_count,
            "total_infrastructure_services": len(infrastructure_services)
        },
        "processes": {
            "python_services": python_services,
            "recorder_workers": recorder_workers,
            "ffmpeg_processes": ffmpeg_processes,
            "infrastructure": infrastructure_services,
            "frontend": frontend_services,
            "auxiliary": other_vms_processes
        }
    }

    sync_process_lifecycle_events(metrics_res)

    return metrics_res

def kill_orphaned_ffmpeg_processes():
    """Terminates all stale duplicate & zombie processes across FFmpeg and Infrastructure services."""
    metrics = get_vms_process_metrics()
    ffmpeg_procs = metrics["processes"]["ffmpeg_processes"]
    infra_procs = metrics["processes"]["infrastructure"]
    
    target_procs = ffmpeg_procs + infra_procs
    killed_pids = []
    failed_pids = []
    
    for f in target_procs:
        if f.get("is_orphaned"):
            pid = f["pid"]
            try:
                if _db is not None:
                    _db["process_lifecycle_logs"].update_many(
                        {"pid": pid, "status": "ACTIVE"},
                        {"$set": {"manual_kill": True}}
                    )
                p = psutil.Process(pid)
                p.kill()  # Use kill() to force terminate on Windows
                killed_pids.append(pid)
            except Exception as e:
                print(f"[PROCESS MONITOR] Failed to terminate stale process PID {pid}: {e}")
                failed_pids.append({
                    "pid": pid,
                    "name": f.get("name", "ffmpeg.exe"),
                    "error": str(e),
                    "type": type(e).__name__
                })
                
    return {
        "success": True,
        "terminated_count": len(killed_pids),
        "terminated_pids": killed_pids,
        "failed_pids": failed_pids
    }

def calculate_hardware_scaling_report(target_camera_counts=None):
    """
    Calculates empirical baseline usage per camera and projects hardware specifications
    required for deployment targets (e.g. 10, 25, 50, 100, 250, 500, 1000 cameras) specifically
    tailored for CPU-only software mode or GPU accelerated mode.
    """
    if target_camera_counts is None:
        target_camera_counts = [10, 25, 50, 100, 250, 500, 1000]

    gpu_info = _check_gpu_availability()
    metrics = get_vms_process_metrics()
    ffmpeg_procs = metrics["processes"]["ffmpeg_processes"]
    workers = metrics["processes"]["recorder_workers"]
    
    active_stream_count = len(ffmpeg_procs) or 1
    
    ffmpeg_cpu_total = sum(f["cpu_percent"] for f in ffmpeg_procs)
    ffmpeg_ram_total = sum(f["ram_mb"] for f in ffmpeg_procs)
    worker_cpu_total = sum(w["cpu_percent"] for w in workers)
    worker_ram_total = sum(w["ram_mb"] for w in workers)
    
    avg_cpu_per_camera = round((ffmpeg_cpu_total + worker_cpu_total) / active_stream_count, 2)
    avg_ram_mb_per_camera = round((ffmpeg_ram_total + worker_ram_total) / active_stream_count, 1)
    
    # Convert the measured system-wide percentage back to absolute logical cores
    num_cores = psutil.cpu_count() or 1
    measured_cores_per_camera = (avg_cpu_per_camera / 100.0) * num_cores
    
    # Set a sane minimum of 0.05 logical cores (5% of a core) per camera if idle
    if measured_cores_per_camera < 0.05:
        measured_cores_per_camera = 0.05

    # Update avg_cpu_per_camera for UI display (show it as percentage of a single core for clarity)
    avg_cpu_per_camera = round(measured_cores_per_camera * 100, 1)

    if avg_ram_mb_per_camera < 30.0:
        avg_ram_mb_per_camera = 90.0

    infra_ram_base_gb = 4.0
    infra_cpu_base_cores = 2.0

    mb_per_sec_per_camera = 0.5
    gb_per_day_per_camera = round((mb_per_sec_per_camera * 3600 * 24) / 1024, 1)

    scaling_projections = []
    for count in target_camera_counts:
        # Scale CPU dynamically based on the true baseline (plus 20% safety margin)
        cpu_cores_needed = max(4, int(infra_cpu_base_cores + (count * measured_cores_per_camera * 1.2)))
        total_ram_mb_needed = (count * avg_ram_mb_per_camera) + (infra_ram_base_gb * 1024)
        recommended_ram_gb = max(16, int((total_ram_mb_needed / 1024) * 1.25))
        
        write_throughput_mbps = round(count * mb_per_sec_per_camera * 8, 1)
        write_throughput_mb_s = round(count * mb_per_sec_per_camera, 1)
        storage_30_days_tb = round((count * gb_per_day_per_camera * 30) / 1024, 2)

        scaling_projections.append({
            "target_cameras": count,
            "cpu_cores_pure_cpu": cpu_cores_needed,
            "recommended_ram_gb": recommended_ram_gb,
            "write_throughput_mb_s": write_throughput_mb_s,
            "write_throughput_mbps": write_throughput_mbps,
            "storage_30_days_tb": storage_30_days_tb,
            "gpu_mode": "Not Required (Pure CPU Mode)" if count <= 50 else "Recommended for 50+ Cams"
        })

    return {
        "system_gpu_status": gpu_info,
        "current_measured_baseline": {
            "active_streams_measured": active_stream_count,
            "avg_cpu_percent_per_camera": avg_cpu_per_camera,
            "avg_ram_mb_per_camera": avg_ram_mb_per_camera,
            "assumed_bitrate_mbps": 4.0,
            "estimated_daily_storage_per_camera_gb": gb_per_day_per_camera
        },
        "projections": scaling_projections,
        "recommendation_summary": (
            f"Current System Status: {gpu_info['mode']}. All calculations above reflect Pure CPU Software Scaling. "
            "For CPU-only scaling up to 50 cameras, ensure server CPU has at least 24 Cores and 32GB RAM with NVMe storage."
        )
    }
