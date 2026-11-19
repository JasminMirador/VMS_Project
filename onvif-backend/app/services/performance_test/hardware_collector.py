import os
import sys
import time
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
import psutil

class HardwareCollector:
    """
    Windows-compatible hardware and process resource telemetry collector.
    Enforces strict attribution rules:
      - Normalizes process CPU across total logical processors.
      - Differentiates Private Working Set from RSS and shared memory.
      - Never conflates whole-server CPU with test-attributable CPU.
      - Collects NVIDIA GPU telemetry (RTX 2000 Ada / NVML) where present.
      - Calculates baseline deltas.
    """

    def __init__(self):
        self.logical_processors = psutil.cpu_count(logical=True) or 1
        self.physical_cores = psutil.cpu_count(logical=False) or 1
        self.proc_cache: Dict[int, psutil.Process] = {}
        
        # Previous counters for delta rate calculation
        self.last_sample_time: float = time.time()
        self.last_net_io = psutil.net_io_counters()
        self.last_disk_io = psutil.disk_io_counters()

        # Prime CPU calculation
        psutil.cpu_percent(interval=None)

        # Target recording drive/folder: prioritize D:\ if available (21TB dedicated storage pool)
        env_rec = os.environ.get("RECORDINGS_DIR")
        if env_rec and os.path.exists(env_rec):
            self.recordings_path = env_rec
        elif os.path.exists("D:\\"):
            self.recordings_path = "D:\\"
        else:
            self.recordings_path = os.path.splitdrive(os.path.abspath('.'))[0] + '\\'

        # Locate nvidia-smi executable (checks PATH, NVSMI folder, and System32)
        self.nvidia_smi_bin = "nvidia-smi"
        for candidate in [
            "nvidia-smi",
            r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
            r"C:\Windows\System32\nvidia-smi.exe"
        ]:
            if shutil.which(candidate) or (os.path.exists(candidate) and os.path.isfile(candidate)):
                self.nvidia_smi_bin = candidate
                break

    def get_system_topology(self) -> Dict[str, Any]:
        """Collects verified server hardware specs."""
        cpu_name = "Unknown CPU"
        try:
            if sys.platform == "win32":
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
                cpu_name = winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
        except Exception:
            cpu_name = f"{self.physical_cores}-Core Processor"

        vm = psutil.virtual_memory()
        total_ram_gb = round(vm.total / (1024 ** 3), 2)

        # Storage capacity
        disk_usage = shutil.disk_usage(self.recordings_path)
        total_storage_tb = round(disk_usage.total / (1024 ** 4), 2)
        free_storage_tb = round(disk_usage.free / (1024 ** 4), 2)

        # GPU info
        gpu_info = self.sample_gpu_metrics()

        return {
            "os": sys.platform,
            "cpu_model": cpu_name,
            "physical_cores": self.physical_cores,
            "logical_processors": self.logical_processors,
            "total_ram_gb": total_ram_gb,
            "storage_path": self.recordings_path,
            "storage_total_tb": total_storage_tb,
            "storage_free_tb": free_storage_tb,
            "gpu_detected": gpu_info["available"],
            "gpu_model": gpu_info.get("gpu_name", "N/A"),
            "gpu_vram_total_mb": gpu_info.get("vram_total_mb", 0)
        }

    def _get_process(self, pid: int) -> Optional[psutil.Process]:
        if pid in self.proc_cache:
            p = self.proc_cache[pid]
            if p.is_running():
                return p
        try:
            p = psutil.Process(pid)
            p.cpu_percent(interval=None)  # prime baseline
            self.proc_cache[pid] = p
            return p
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            self.proc_cache.pop(pid, None)
            return None

    def sample_gpu_metrics(self) -> Dict[str, Any]:
        """Query NVIDIA GPU telemetry via nvidia-smi CSV mode with robust error handling."""
        res = {
            "available": False,
            "gpu_name": "N/A",
            "utilization_pct": 0.0,
            "vram_used_mb": 0.0,
            "vram_total_mb": 0.0,
            "temperature_c": 0,
            "power_draw_w": 0.0
        }
        try:
            cmd = [
                self.nvidia_smi_bin,
                "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
                "--format=csv,noheader,nounits"
            ]
            run = subprocess.run(cmd, capture_output=True, text=True, timeout=1.5)
            if run.returncode == 0 and run.stdout.strip():
                line = run.stdout.strip().splitlines()[0]
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 6:
                    res["available"] = True
                    res["gpu_name"] = parts[0]
                    res["utilization_pct"] = float(parts[1]) if parts[1] != "[N/A]" else 0.0
                    res["vram_used_mb"] = float(parts[2]) if parts[2] != "[N/A]" else 0.0
                    res["vram_total_mb"] = float(parts[3]) if parts[3] != "[N/A]" else 0.0
                    res["temperature_c"] = int(parts[4]) if parts[4] != "[N/A]" else 0
                    res["power_draw_w"] = float(parts[5]) if parts[5] != "[N/A]" else 0.0
        except Exception:
            pass
        return res

    def sample_system_and_vms_processes(
        self,
        baseline_vms_cpu: float = 0.0,
        baseline_vms_ram_mb: float = 0.0
    ) -> Dict[str, Any]:
        """
        Takes a 1-second sample of:
          - Server-wide CPU, RAM, Disk, and Network (Context/Safety).
          - Test-attributable VMS processes by identified role (PSU/Private Working Set).
          - Normalized CPU percentages.
        """
        now = time.time()
        dt = max(0.001, now - self.last_sample_time)
        self.last_sample_time = now

        # 1. Total Server Context Metrics
        server_cpu = psutil.cpu_percent(interval=None)
        vm = psutil.virtual_memory()

        # Network Throughput (Mbps)
        net_io = psutil.net_io_counters()
        rx_bytes_delta = net_io.bytes_recv - self.last_net_io.bytes_recv
        tx_bytes_delta = net_io.bytes_sent - self.last_net_io.bytes_sent
        self.last_net_io = net_io
        rx_mbps = round((rx_bytes_delta * 8) / (1024 * 1024) / dt, 2)
        tx_mbps = round((tx_bytes_delta * 8) / (1024 * 1024) / dt, 2)

        # Disk Throughput (MB/s) and Available Space
        disk_io = psutil.disk_io_counters()
        r_bytes_delta = disk_io.read_bytes - self.last_disk_io.read_bytes if disk_io else 0
        w_bytes_delta = disk_io.write_bytes - self.last_disk_io.write_bytes if disk_io else 0
        self.last_disk_io = disk_io
        disk_read_mb_s = round((r_bytes_delta / (1024 * 1024)) / dt, 2)
        disk_write_mb_s = round((w_bytes_delta / (1024 * 1024)) / dt, 2)

        try:
            d_usage = shutil.disk_usage(self.recordings_path)
            disk_free_gb = round(d_usage.free / (1024 ** 3), 2)
        except Exception:
            disk_free_gb = 0.0

        # Clean dead PIDs from cache
        for cpid in list(self.proc_cache.keys()):
            try:
                if not self.proc_cache[cpid].is_running():
                    self.proc_cache.pop(cpid, None)
            except Exception:
                self.proc_cache.pop(cpid, None)

        # 2. Identify VMS Process Telemetry
        vms_processes: List[Dict[str, Any]] = []
        by_service: Dict[str, Dict[str, float]] = {
            "vms_core": {"cpu_pct": 0.0, "ram_mb": 0.0, "pids": []},
            "vms_recorder": {"cpu_pct": 0.0, "ram_mb": 0.0, "pids": []},
            "vms_encryption": {"cpu_pct": 0.0, "ram_mb": 0.0, "pids": []},
            "mediamtx": {"cpu_pct": 0.0, "ram_mb": 0.0, "pids": []},
            "storage_services": {"cpu_pct": 0.0, "ram_mb": 0.0, "pids": []},
            "vms_frontend": {"cpu_pct": 0.0, "ram_mb": 0.0, "pids": []},
            "vms_ai": {"cpu_pct": 0.0, "ram_mb": 0.0, "pids": []}
        }

        total_vms_normalized_cpu = 0.0
        total_vms_private_ram_mb = 0.0

        # Scan running processes
        for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'memory_info']):
            try:
                pinfo = proc.info
                name = (pinfo['name'] or "").lower()
                pid = pinfo['pid']
                cmdline = pinfo['cmdline'] or []
                cmd_str = " ".join(cmdline).lower()

                group = None
                service_role = None

                if "mediamtx" in name:
                    group = "mediamtx"
                    service_role = "MediaMTX Ingest & RTSP/WebRTC Server"
                elif "mongod" in name:
                    group = "storage_services"
                    service_role = "MongoDB Database"
                elif "minio" in name:
                    group = "storage_services"
                    service_role = "MinIO Object Storage"
                elif "mosquitto" in name:
                    group = "storage_services"
                    service_role = "Mosquitto MQTT Broker"
                elif "ffmpeg" in name:
                    group = "vms_recorder"
                    service_role = "FFmpeg Transcoding/Ingest Worker"
                elif "node" in name and ("vite" in cmd_str or "miradorai-vms" in cmd_str):
                    group = "vms_frontend"
                    service_role = "React/Vite Frontend Web Server"
                elif "python" in name:
                    if "run_api.py" in cmd_str or "uvicorn" in cmd_str or "app.main:app" in cmd_str:
                        group = "vms_core"
                        service_role = "VMS FastAPI Backend Server"
                    elif "stream_manager" in cmd_str:
                        group = "vms_core"
                        service_role = "Stream Manager & Failover Supervisor"
                    elif "run_scheduler.py" in cmd_str:
                        group = "vms_core"
                        service_role = "Scheduler & Maintenance Service"
                    elif "recorder_worker.py" in cmd_str:
                        group = "vms_recorder"
                        service_role = "Recording Worker"
                    elif "encrypt_service.py" in cmd_str:
                        group = "vms_encryption"
                        service_role = "AES Video Encryption Service"
                    elif "face_detection" in cmd_str or "verify_yolo" in cmd_str or "alert_restream" in cmd_str:
                        group = "vms_ai"
                        service_role = "AI Video Analytics Pipeline"

                if not group:
                    continue

                p_obj = self._get_process(pid)
                if not p_obj:
                    continue

                raw_cpu = p_obj.cpu_percent(interval=None)
                normalized_cpu = round(raw_cpu / self.logical_processors, 2)

                mem_info = pinfo['memory_info']
                rss_mb = round(mem_info.rss / (1024 * 1024), 2) if mem_info else 0.0
                private_bytes = getattr(mem_info, 'private', mem_info.rss) if mem_info else 0
                private_mb = round(private_bytes / (1024 * 1024), 2)

                entry = {
                    "pid": pid,
                    "name": pinfo['name'],
                    "service_role": service_role,
                    "group": group,
                    "raw_cpu_pct": raw_cpu,
                    "normalized_cpu_pct": normalized_cpu,
                    "rss_mb": rss_mb,
                    "private_mb": private_mb
                }
                vms_processes.append(entry)

                by_service[group]["cpu_pct"] = round(by_service[group]["cpu_pct"] + normalized_cpu, 2)
                by_service[group]["ram_mb"] = round(by_service[group]["ram_mb"] + private_mb, 2)
                by_service[group]["pids"].append(pid)

                total_vms_normalized_cpu += normalized_cpu
                total_vms_private_ram_mb += private_mb

            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

        total_vms_normalized_cpu = round(total_vms_normalized_cpu, 2)
        total_vms_private_ram_mb = round(total_vms_private_ram_mb, 2)
        total_vms_ram_gb = round(total_vms_private_ram_mb / 1024, 2)

        # Baseline Adjustments
        delta_cpu = max(0.0, round(total_vms_normalized_cpu - baseline_vms_cpu, 2))
        delta_ram_mb = max(0.0, round(total_vms_private_ram_mb - baseline_vms_ram_mb, 2))
        delta_ram_gb = round(delta_ram_mb / 1024, 2)

        # GPU metrics
        gpu_metrics = self.sample_gpu_metrics()

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "attribution": {
                "vms_total_cpu_pct": total_vms_normalized_cpu,
                "vms_total_ram_mb": total_vms_private_ram_mb,
                "vms_total_ram_gb": total_vms_ram_gb,
                "delta_cpu_pct": delta_cpu,
                "delta_ram_mb": delta_ram_mb,
                "delta_ram_gb": delta_ram_gb,
                "by_service": by_service,
                "identified_processes": vms_processes
            },
            "server_total": {
                "cpu_pct": round(server_cpu, 2),
                "ram_pct": round(vm.percent, 2),
                "ram_used_gb": round(vm.used / (1024 ** 3), 2),
                "ram_free_gb": round(vm.available / (1024 ** 3), 2),
                "ram_total_gb": round(vm.total / (1024 ** 3), 2),
                "disk_read_mb_s": disk_read_mb_s,
                "disk_write_mb_s": disk_write_mb_s,
                "disk_free_gb": disk_free_gb,
                "net_rx_mbps": rx_mbps,
                "net_tx_mbps": tx_mbps
            },
            "gpu": gpu_metrics
        }

hardware_collector = HardwareCollector()
