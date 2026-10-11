import os
from .repository import WindowsStorageRepository
from .config_manager import StorageConfig
from .service_manager import ServiceManager

class StorageService:
    def __init__(self):
        self.repo = WindowsStorageRepository()
        self.config = StorageConfig()
        self.services = ServiceManager()

    def get_devices(self) -> list:
        return self.repo.get_devices()

    def get_available_drive_letters(self) -> list:
        import string
        import shutil

        drives = []
        existing_letters = set()

        # 1. Existing mounted drives with free space (e.g. D:, C:)
        for letter in string.ascii_uppercase:
            path = f"{letter}:\\"
            if os.path.exists(path):
                existing_letters.add(letter)
                try:
                    usage = shutil.disk_usage(path)
                    free_gb = round(usage.free / (1024**3), 1)
                    total_gb = round(usage.total / (1024**3), 1)
                    drives.append({
                        "letter": letter,
                        "label": f"{letter}: Drive (Existing Volume · {free_gb} GB Free)",
                        "is_existing": True,
                        "free_gb": free_gb,
                        "total_gb": total_gb,
                    })
                except Exception:
                    pass

        # Sort so non-C drives appear first (e.g., D: then C:)
        drives.sort(key=lambda d: 1 if d["letter"] == "C" else 0)

        # 2. Unassigned drive letters (D to Z) for new RAID pools
        for letter in string.ascii_uppercase[3:]:
            if letter not in existing_letters:
                drives.append({
                    "letter": letter,
                    "label": f"{letter}: Drive (Unassigned / New RAID Array)",
                    "is_existing": False,
                    "free_gb": None,
                    "total_gb": None,
                })

        return drives

    def get_status(self) -> dict:
        current_path = self.config.get_recording_path()
        drive_letter = current_path.split(":")[0] if ":" in current_path else "C"
        return self.repo.get_volume_status(drive_letter)

    def get_config(self) -> dict:
        return {
            "recording_path": self.config.get_recording_path(),
            "retention_days": self.config.get_retention_days()
        }

    def provision_storage(self, target_drive: str, recordings_folder: str) -> dict:
        target_drive = target_drive.strip().rstrip(":").upper()
        drive_root = f"{target_drive}:\\"
        final_path = f"{target_drive}:\\{recordings_folder}"

        # If drive already exists as an active formatted volume, do not attempt destructive RAID formatting
        if os.path.exists(drive_root):
            os.makedirs(final_path, exist_ok=True)
            log_output = f"[INFO] Target drive {target_drive}: is an active local volume. Initialized recording path at {final_path}."
        else:
            # Infrastructure provision for raw disks / HW RAID
            log_output = self.repo.provision_storage(target_drive, recordings_folder)

        # 2. Update Configuration
        self.config.set_recording_path(final_path)

        # 3. Restart Dependent Services
        self.services.restart_all_vms_services()

        return {
            "success": True,
            "path": final_path,
            "log": log_output
        }

    def run_performance_test(self) -> dict:
        current_path = self.config.get_recording_path()
        drive_letter = current_path.split(":")[0] if ":" in current_path else "C"
        return self.repo.run_performance_test(drive_letter)

    def get_logs(self) -> dict:
        log_paths = [
            r"C:\ProgramData\VMS\Logs\StorageProvision.log",
            os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../../logs/failover.log"))
        ]
        for path in log_paths:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()[-100:]
                    return {"logs": "".join(lines)}
        return {"logs": "No active system logs found."}

    def get_replication(self) -> dict:
        minio_running = self.services.verify_healthy("MinIO")
        return {
            "minio_status": "Healthy" if minio_running else "Stopped",
            "minio_service": "Running" if minio_running else "Stopped",
            "syncthing_status": "Not Configured"
        }
