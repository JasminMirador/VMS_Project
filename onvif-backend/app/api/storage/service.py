import os
from .config_manager import StorageConfig
from .service_manager import ServiceManager
from app.services.storage import raid_service

class StorageService:
    def __init__(self):
        self.config = StorageConfig()
        self.services = ServiceManager()

    def get_devices(self) -> list:
        # Fetch physical drive bays from hardware RAID controller or OS storage
        raw_devices = raid_service.get_storage_devices()
        results = []
        for d in raw_devices:
            results.append({
                "name": d.get("name") or f"Disk Bay {d.get('slot', 0)}",
                "health": d.get("health", "Healthy"),
                "type": d.get("type", "Storage Drive"),
                "capacity_tb": float(d.get("capacity_tb", 0.0)),
                "device_id": d.get("id", str(d.get("slot", 0))),
                "slot": d.get("slot", 0),
                "enclosure": d.get("enclosure", 0),
                "model": d.get("model") or "Standard Storage Disk",
                "interface": d.get("interface", "SATA/SAS"),
                "media": d.get("media", "HDD"),
                "speed": d.get("speed", "N/A"),
                "spun": d.get("spun", "Spun Up"),
                "is_locating": d.get("is_locating", False),
            })
        return results

    def get_available_drive_letters(self) -> list:
        # Query active Windows drives (D:, C:, etc.)
        drives = raid_service.get_available_drives()
        results = []
        for d in drives:
            results.append({
                "letter": d["letter"],
                "label": d["label"],
                "is_existing": True,
                "free_gb": round(d["free_tb"] * 1024, 1),
                "total_gb": round(d["size_tb"] * 1024, 1),
            })
        # Sort so dedicated non-system data volumes appear first (largest capacity first), and OS drive C: last
        results.sort(key=lambda x: (1 if x["letter"] == "C" else 0, -(x.get("total_gb") or 0)))
        return results

    def get_status(self) -> dict:
        return raid_service.get_storage_status()

    def get_config(self) -> dict:
        return raid_service.get_storage_config()

    def provision_storage(self, target_drive: str, recordings_folder: str) -> dict:
        res = raid_service.provision_storage(target_drive, recordings_folder)
        return {
            "success": res.get("success", True),
            "path": res.get("recording_path", f"{target_drive}:\\{recordings_folder}"),
            "log": res.get("message", "Provisioned successfully")
        }

    def run_performance_test(self) -> dict:
        status = raid_service.get_storage_status()
        target = status.get("target_drive", "D:")
        return raid_service.run_performance_test(target)

    def get_logs(self, date_str: str = None) -> dict:
        return raid_service.get_storage_logs(date_str)

    def get_log_dates(self) -> list:
        return raid_service.get_storage_log_dates()

    def get_replication(self) -> dict:
        return {
            "minio_status": "Healthy",
            "minio_service": "Running",
            "syncthing_status": "Synchronized (Direct Hardware RAID Active)"
        }

    def toggle_locate(self, enclosure: int, slot: int, enable: bool = True) -> dict:
        return raid_service.toggle_locate_led(enclosure, slot, enable)

    def rebuild_drive(self, enclosure: int, slot: int) -> dict:
        return raid_service.start_drive_rebuild(enclosure, slot)

    def get_rebuild_progress(self, enclosure: int, slot: int) -> dict:
        return raid_service.get_rebuild_status(enclosure, slot)

    def add_hot_spare(self, enclosure: int, slot: int) -> dict:
        return raid_service.add_hot_spare(enclosure, slot)

    def create_raid_array(self, raid_type: str, drive_slots: list, name: str = "VMS_DATA", strip_kb: int = 64) -> dict:
        return raid_service.create_raid_array(raid_type, drive_slots, name, strip_kb)

    def get_virtual_disks(self) -> list[dict]:
        return raid_service.get_virtual_disks()

    def delete_raid_array(self, vd_id: str) -> dict:
        return raid_service.delete_raid_array(vd_id)

    # ── iSCSI Initiator & SAN LUN Integration ───────────────────────────────────

    def get_iscsi_status(self) -> dict:
        from app.services.storage import iscsi_service
        return iscsi_service.get_iscsi_status()

    def get_iscsi_targets(self) -> list:
        from app.services.storage import iscsi_service
        return iscsi_service.get_iscsi_targets()

    def discover_iscsi_portal(self, portal_ip: str, port: int = 3260) -> dict:
        from app.services.storage import iscsi_service
        return iscsi_service.discover_portal(portal_ip, port)

    def connect_iscsi_target(self, target_iqn: str, portal_ip: str = None) -> dict:
        from app.services.storage import iscsi_service
        return iscsi_service.connect_target(target_iqn, portal_ip)

    def disconnect_iscsi_target(self, target_iqn: str) -> dict:
        from app.services.storage import iscsi_service
        return iscsi_service.disconnect_target(target_iqn)

    def remove_iscsi_portal(self, portal_ip: str) -> dict:
        from app.services.storage import iscsi_service
        return iscsi_service.remove_portal(portal_ip)

    def get_iscsi_disks(self) -> list:
        from app.services.storage import iscsi_service
        return iscsi_service.get_iscsi_disks()

    def format_and_mount_lun(self, disk_number: int, drive_letter: str = "E", label: str = "Mirador_iSCSI_LUN") -> dict:
        from app.services.storage import iscsi_service
        return iscsi_service.format_and_mount_lun(disk_number, drive_letter, label)


