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

    def initialize_virtual_disk(self, vd_id: str, init_type: str = "fast") -> dict:
        return raid_service.initialize_virtual_disk(vd_id, init_type)

    def get_init_status(self, vd_id: str) -> dict:
        return raid_service.get_init_status(vd_id)

    def start_consistency_check(self, vd_id: str) -> dict:
        return raid_service.start_consistency_check(vd_id)

    def get_consistency_check_status(self, vd_id: str) -> dict:
        return raid_service.get_consistency_check_status(vd_id)

    def set_cache_policy(self, vd_id: str, write_cache: str = "WB", read_cache: str = "RA") -> dict:
        return raid_service.set_cache_policy(vd_id, write_cache, read_cache)

    def make_drive_unconfigured_good(self, enclosure: int, slot: int) -> dict:
        return raid_service.make_drive_unconfigured_good(enclosure, slot)

    def remove_hot_spare(self, enclosure: int, slot: int) -> dict:
        return raid_service.remove_hot_spare(enclosure, slot)

    # ── Group A: Controller-Level Settings ───────────────────────────────────────

    def get_controller_settings(self) -> dict:
        return raid_service.get_controller_settings()

    def set_rebuild_rate(self, rate: int) -> dict:
        return raid_service.set_rebuild_rate(rate)

    def set_patrol_read_rate(self, rate: int) -> dict:
        return raid_service.set_patrol_read_rate(rate)

    def set_cc_rate(self, rate: int) -> dict:
        return raid_service.set_cc_rate(rate)

    def set_bgi(self, enabled: bool) -> dict:
        return raid_service.set_bgi(enabled)

    # ── Group B: Physical Drive Advanced Ops ─────────────────────────────────────

    def add_dedicated_hot_spare(self, enclosure: int, slot: int, vd_id: str) -> dict:
        return raid_service.add_dedicated_hot_spare(enclosure, slot, vd_id)

    def secure_erase_drive(self, enclosure: int, slot: int, erase_type: str = "simple") -> dict:
        return raid_service.secure_erase_drive(enclosure, slot, erase_type)

    def get_secure_erase_status(self, enclosure: int, slot: int) -> dict:
        return raid_service.get_secure_erase_status(enclosure, slot)

    def set_jbod_mode(self, enclosure: int, slot: int, enable: bool = True) -> dict:
        return raid_service.set_jbod_mode(enclosure, slot, enable)

    def spin_drive(self, enclosure: int, slot: int, action: str = "spinup") -> dict:
        return raid_service.spin_drive(enclosure, slot, action)

    # ── Group C: Virtual Disk Advanced Ops ───────────────────────────────────────

    def migrate_raid_level(self, vd_id: str, new_raid_type: str, new_strip_kb: int = 64) -> dict:
        return raid_service.migrate_raid_level(vd_id, new_raid_type, new_strip_kb)

    def expand_virtual_disk(self, vd_id: str, additional_drive_slots: list) -> dict:
        return raid_service.expand_virtual_disk(vd_id, additional_drive_slots)

    # ── Group D: Configuration & BBU ─────────────────────────────────────────────

    def get_bbu_details(self) -> dict:
        return raid_service.get_bbu_details()

    def start_bbu_learn_cycle(self) -> dict:
        return raid_service.start_bbu_learn_cycle()

    def import_foreign_config(self) -> dict:
        return raid_service.import_foreign_config()

    def clear_all_configuration(self) -> dict:
        return raid_service.clear_all_configuration()

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

    # ── Windows Storage Spaces (Software RAID) ───────────────────────────────

    def get_storage_spaces_overview(self) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.get_storage_spaces_overview()

    def get_poolable_disks(self) -> list:
        from app.services.storage import storage_spaces_service as ss
        return ss.get_poolable_disks()

    def get_storage_pools(self) -> list:
        from app.services.storage import storage_spaces_service as ss
        return ss.get_storage_pools()

    def create_storage_pool(self, pool_name: str, disk_ids: list) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.create_storage_pool(pool_name, disk_ids)

    def delete_storage_pool(self, pool_name: str) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.delete_storage_pool(pool_name)

    def add_disk_to_pool(self, pool_name: str, disk_id: str) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.add_disk_to_pool(pool_name, disk_id)

    def remove_disk_from_pool(self, pool_name: str, disk_id: str) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.remove_disk_from_pool(pool_name, disk_id)

    def optimize_storage_pool(self, pool_name: str) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.optimize_storage_pool(pool_name)

    def get_virtual_disks_sw(self) -> list:
        from app.services.storage import storage_spaces_service as ss
        return ss.get_virtual_disks_sw()

    def create_virtual_disk_sw(self, pool_name: str, vd_name: str, resiliency: str,
                                size_gb: int, provisioning: str, interleave_kb: int) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.create_virtual_disk_sw(pool_name, vd_name, resiliency, size_gb, provisioning, interleave_kb=interleave_kb)

    def delete_virtual_disk_sw(self, vd_name: str) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.delete_virtual_disk_sw(vd_name)

    def repair_virtual_disk_sw(self, vd_name: str) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.repair_virtual_disk(vd_name)

    def create_volume_on_vd(self, vd_name: str, drive_letter: str, fs_type: str, label: str) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.create_volume_on_vd(vd_name, drive_letter, fs_type, label)

    def get_storage_tiers(self, pool_name: str) -> list:
        from app.services.storage import storage_spaces_service as ss
        return ss.get_storage_tiers(pool_name)

    def create_tiered_virtual_disk(self, pool_name: str, vd_name: str,
                                     ssd_size_gb: int, hdd_size_gb: int) -> dict:
        from app.services.storage import storage_spaces_service as ss
        return ss.create_tiered_virtual_disk(pool_name, vd_name, ssd_size_gb, hdd_size_gb)

    # ── Hardware Array Mounting & Unallocated Partition Methods ──────────────

    def mount_hardware_array(self, disk_number: int = None, drive_letter: str = "D", label: str = "VMS_STORAGE") -> dict:
        return raid_service.mount_and_format_vd_in_windows(disk_number, drive_letter, label)

    def mount_and_format_hardware_array(self, disk_number: int = None, drive_letter: str = "D", label: str = "VMS_STORAGE") -> dict:
        return raid_service.mount_and_format_vd_in_windows(disk_number, drive_letter, label)

    def get_unallocated_disks(self) -> list:
        return raid_service.get_unallocated_disks()

    def partition_unallocated_space(self, disk_number: int, drive_letter: str = None, label: str = "VMS_BAY0_REC") -> dict:
        return raid_service.partition_and_format_unallocated_space(disk_number, drive_letter, label)

    def delete_partition(self, drive_letter: str) -> dict:
        return raid_service.delete_windows_partition(drive_letter)

    def clear_disk_to_raw(self, disk_number: int) -> dict:
        return raid_service.clear_disk_to_raw(disk_number)
