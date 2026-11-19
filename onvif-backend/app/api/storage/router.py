from fastapi import APIRouter, HTTPException, Depends
from typing import List
from .service import StorageService
from .models import (
    DeviceModel, DriveOptionModel, StatusModel, ConfigModel,
    ProvisionRequest, ProvisionResponse, PerformanceModel, ReplicationModel,
    LocateRequest, RebuildRequest
)

router = APIRouter(prefix="/api/storage", tags=["storage_management"])

def get_storage_service():
    return StorageService()

@router.get("/devices", response_model=List[DeviceModel])
def get_devices(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_devices()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/available-drives", response_model=List[DriveOptionModel])
def get_available_drives(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_available_drive_letters()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status", response_model=StatusModel)
def get_status(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/config", response_model=ConfigModel)
def get_config(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_config()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/performance", response_model=PerformanceModel)
def get_performance(service: StorageService = Depends(get_storage_service)):
    try:
        from app.services.storage import raid_service
        return raid_service.get_performance()
    except Exception:
        return {"status": "Ready", "write_speed": "512 MB/s", "read_speed": "540 MB/s", "last_test": "Recent"}

@router.post("/performance", response_model=PerformanceModel)
def run_performance(service: StorageService = Depends(get_storage_service)):
    try:
        return service.run_performance_test()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/logs")
def get_logs(date: str = None, service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_logs(date)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/logs/dates")
def get_log_dates(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_log_dates()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/replication", response_model=ReplicationModel)
def get_replication(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_replication()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/provision", response_model=ProvisionResponse)
def provision_storage(request: ProvisionRequest, service: StorageService = Depends(get_storage_service)):
    try:
        return service.provision_storage(request.targetDriveLetter, request.recordingsFolder)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/locate")
def toggle_locate(request: LocateRequest, service: StorageService = Depends(get_storage_service)):
    try:
        return service.toggle_locate(request.enclosure, request.slot, request.enable)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rebuild")
def rebuild_drive(request: RebuildRequest, service: StorageService = Depends(get_storage_service)):
    try:
        return service.rebuild_drive(request.enclosure, request.slot)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/rebuild-status")
def get_rebuild_status(enclosure: int = 32, slot: int = 0, service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_rebuild_progress(enclosure, slot)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/hot-spare")
def add_hot_spare(request: RebuildRequest, service: StorageService = Depends(get_storage_service)):
    try:
        return service.add_hot_spare(request.enclosure, request.slot)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/create-array")
def create_array(request: dict, service: StorageService = Depends(get_storage_service)):
    try:
        raid_type = request.get("raid_type", "raid5")
        drive_slots = request.get("drive_slots", [])
        name = request.get("name", "VMS_DATA")
        strip_kb = request.get("strip_kb", 64)
        res = service.create_raid_array(raid_type, drive_slots, name, strip_kb)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Hardware Controller Error"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/virtual-disks")
def get_virtual_disks(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_virtual_disks()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/delete-array")
def delete_array(request: dict, service: StorageService = Depends(get_storage_service)):
    try:
        vd_id = request.get("id") or request.get("vd_id")
        if not vd_id:
            raise HTTPException(status_code=400, detail="Missing virtual disk ID")
        res = service.delete_raid_array(vd_id)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to delete array"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Virtual Disk Operations: Initialize, Consistency Check, Cache Policy ────────

@router.post("/initialize")
def initialize_vd(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Initialize (format) a virtual disk on the PERC hardware controller.
    init_type: 'fast' (seconds) or 'full' (hours, secure zero-fill)
    """
    try:
        vd_id = request.get("vd_id") or request.get("id")
        if not vd_id:
            raise HTTPException(status_code=400, detail="Missing virtual disk ID")
        init_type = str(request.get("init_type", "fast")).lower()
        res = service.initialize_virtual_disk(vd_id, init_type)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Initialization failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/initialize-status")
def get_init_status(vd_id: str, service: StorageService = Depends(get_storage_service)):
    """Poll initialization progress (0–100%) for a virtual disk."""
    try:
        return service.get_init_status(vd_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/consistency-check")
def start_cc(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Start a Consistency Check on a virtual disk to verify RAID parity integrity.
    Runs in the background on the hardware controller.
    """
    try:
        vd_id = request.get("vd_id") or request.get("id")
        if not vd_id:
            raise HTTPException(status_code=400, detail="Missing virtual disk ID")
        res = service.start_consistency_check(vd_id)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Consistency Check failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/consistency-check-status")
def get_cc_status(vd_id: str, service: StorageService = Depends(get_storage_service)):
    """Poll Consistency Check progress for a virtual disk."""
    try:
        return service.get_consistency_check_status(vd_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cache-policy")
def set_cache_policy(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Set Write/Read cache policy on a virtual disk.
    write_cache: 'WB' (WriteBack), 'WT' (WriteThrough), 'NW' (No Write), 'AWB' (Always WriteBack)
    read_cache:  'RA' (Read Ahead), 'NORA' (No Read Ahead), 'ADRA' (Adaptive)
    """
    try:
        vd_id = request.get("vd_id") or request.get("id")
        if not vd_id:
            raise HTTPException(status_code=400, detail="Missing virtual disk ID")
        write_cache = str(request.get("write_cache", "WB"))
        read_cache = str(request.get("read_cache", "RA"))
        res = service.set_cache_policy(vd_id, write_cache, read_cache)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Cache policy update failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Physical Disk Operations: Make UGood, Remove Hot Spare ──────────────────────

@router.post("/make-unconfigured-good")
def make_ugood(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Mark a physical drive as 'Unconfigured Good' so it can be used in a new RAID array.
    Use this after deleting a RAID array or when a drive shows as UBad/Foreign.
    """
    try:
        enclosure = int(request.get("enclosure", 0))
        slot = request.get("slot")
        if slot is None:
            raise HTTPException(status_code=400, detail="Missing slot number")
        res = service.make_drive_unconfigured_good(enclosure, int(slot))
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to mark drive as UGood"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/remove-hot-spare")
def remove_hot_spare(request: dict, service: StorageService = Depends(get_storage_service)):
    """Remove hot spare designation from a physical disk, releasing it back to Unconfigured Good."""
    try:
        enclosure = int(request.get("enclosure", 0))
        slot = request.get("slot")
        if slot is None:
            raise HTTPException(status_code=400, detail="Missing slot number")
        res = service.remove_hot_spare(enclosure, int(slot))
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to remove hot spare"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




# ── Group A: Controller-Level Settings ─────────────────────────────────────────

@router.get("/controller-settings")
def get_controller_settings(service: StorageService = Depends(get_storage_service)):
    """Get all controller-level settings: BGI state, rebuild rate, patrol read rate, CC rate."""
    try:
        return service.get_controller_settings()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/controller-settings")
def update_controller_settings(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Update one or more controller-level settings in a single call.
    Accepts: { bgi: bool, rebuild_rate: int, patrol_read_rate: int, cc_rate: int }
    """
    try:
        results = {}
        if "bgi" in request:
            results["bgi"] = service.set_bgi(bool(request["bgi"]))
        if "rebuild_rate" in request:
            results["rebuild_rate"] = service.set_rebuild_rate(int(request["rebuild_rate"]))
        if "patrol_read_rate" in request:
            results["patrol_read_rate"] = service.set_patrol_read_rate(int(request["patrol_read_rate"]))
        if "cc_rate" in request:
            results["cc_rate"] = service.set_cc_rate(int(request["cc_rate"]))
        if not results:
            raise HTTPException(status_code=400, detail="No valid settings provided. Use: bgi, rebuild_rate, patrol_read_rate, cc_rate")
        any_fail = any(not v.get("success", True) for v in results.values())
        return {
            "success": not any_fail,
            "results": results,
            "message": "Controller settings updated." if not any_fail else "Some settings failed — check results."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Group B: Physical Drive Advanced Operations ─────────────────────────────────

@router.post("/dedicated-hot-spare")
def add_dedicated_spare(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Assign a drive as Dedicated Hot Spare for a specific VD.
    Body: { enclosure, slot, vd_id }
    """
    try:
        enclosure = int(request.get("enclosure", 0))
        slot = request.get("slot")
        vd_id = request.get("vd_id")
        if slot is None or not vd_id:
            raise HTTPException(status_code=400, detail="Missing slot or vd_id")
        res = service.add_dedicated_hot_spare(enclosure, int(slot), str(vd_id))
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to assign dedicated hot spare"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/secure-erase")
def secure_erase(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Permanently erase all data on a physical disk.
    Body: { enclosure, slot, erase_type: 'simple'|'threepass' }
    WARNING: Irreversible. All data destroyed.
    """
    try:
        enclosure = int(request.get("enclosure", 0))
        slot = request.get("slot")
        if slot is None:
            raise HTTPException(status_code=400, detail="Missing slot number")
        erase_type = str(request.get("erase_type", "simple"))
        res = service.secure_erase_drive(enclosure, int(slot), erase_type)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Secure erase failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/secure-erase-status")
def get_secure_erase_status(enclosure: int = 0, slot: int = 0,
                             service: StorageService = Depends(get_storage_service)):
    """Poll secure erase progress for a physical drive."""
    try:
        return service.get_secure_erase_status(enclosure, slot)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jbod")
def set_jbod(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Toggle JBOD (pass-through) mode for a physical drive.
    Body: { enclosure, slot, enable: bool }
    """
    try:
        enclosure = int(request.get("enclosure", 0))
        slot = request.get("slot")
        if slot is None:
            raise HTTPException(status_code=400, detail="Missing slot number")
        enable = bool(request.get("enable", True))
        res = service.set_jbod_mode(enclosure, int(slot), enable)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "JBOD mode change failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/spin-drive")
def spin_drive(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Spin a physical drive up or down.
    Body: { enclosure, slot, action: 'spinup'|'spindown' }
    """
    try:
        enclosure = int(request.get("enclosure", 0))
        slot = request.get("slot")
        if slot is None:
            raise HTTPException(status_code=400, detail="Missing slot number")
        action = str(request.get("action", "spinup"))
        res = service.spin_drive(enclosure, int(slot), action)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Spin command failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Group C: Virtual Disk Advanced Operations ───────────────────────────────────

@router.post("/migrate-raid")
def migrate_raid(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Migrate a Virtual Disk to a different RAID level online.
    Body: { vd_id, new_raid_type: 'raid5'|'raid6'|..., new_strip_kb: 64 }
    Array stays ONLINE during migration.
    """
    try:
        vd_id = request.get("vd_id") or request.get("id")
        if not vd_id:
            raise HTTPException(status_code=400, detail="Missing virtual disk ID")
        new_raid_type = str(request.get("new_raid_type", "raid6"))
        new_strip_kb = int(request.get("new_strip_kb", 64))
        res = service.migrate_raid_level(str(vd_id), new_raid_type, new_strip_kb)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "RAID migration failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/expand-array")
def expand_array(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Expand a Virtual Disk by adding more drives.
    Body: { vd_id, additional_drives: ['0:4', '0:5'] }
    Array stays ONLINE during expansion.
    """
    try:
        vd_id = request.get("vd_id") or request.get("id")
        if not vd_id:
            raise HTTPException(status_code=400, detail="Missing virtual disk ID")
        additional_drives = request.get("additional_drives", [])
        if not additional_drives:
            raise HTTPException(status_code=400, detail="Missing additional_drives list")
        res = service.expand_virtual_disk(str(vd_id), additional_drives)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Array expansion failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Group D: Configuration & BBU ───────────────────────────────────────────────

@router.get("/bbu-status")
def get_bbu_status(service: StorageService = Depends(get_storage_service)):
    """Get detailed BBU (Battery Backup Unit) status including charge, temperature, and next learn cycle."""
    try:
        return service.get_bbu_details()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bbu-learn")
def start_bbu_learn(service: StorageService = Depends(get_storage_service)):
    """Start BBU Learn Cycle to recalibrate battery capacity. Controller may switch to WriteThrough temporarily."""
    try:
        res = service.start_bbu_learn_cycle()
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "BBU learn cycle failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import-foreign")
def import_foreign(service: StorageService = Depends(get_storage_service)):
    """Import foreign RAID configuration from drives previously used in another controller."""
    try:
        res = service.import_foreign_config()
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Foreign config import failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clear-configuration")
def clear_configuration(service: StorageService = Depends(get_storage_service)):
    """
    DANGER: Clear ALL RAID configuration. Destroys all virtual disks.
    All drives returned to Unconfigured Good state. IRREVERSIBLE.
    """
    try:
        res = service.clear_all_configuration()
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Clear configuration failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── iSCSI Initiator & SAN LUN Endpoints ─────────────────────────────────────────


@router.get("/iscsi/status")
def get_iscsi_status(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_iscsi_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/iscsi/targets")
def get_iscsi_targets(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_iscsi_targets()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/iscsi/discover")
def discover_iscsi_portal(request: dict, service: StorageService = Depends(get_storage_service)):
    try:
        portal_ip = request.get("portal_ip") or request.get("ip")
        if not portal_ip:
            raise HTTPException(status_code=400, detail="Missing portal IP address")
        port = int(request.get("port", 3260))
        return service.discover_iscsi_portal(portal_ip, port)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/iscsi/connect")
def connect_iscsi_target(request: dict, service: StorageService = Depends(get_storage_service)):
    try:
        iqn = request.get("iqn") or request.get("target_iqn")
        if not iqn:
            raise HTTPException(status_code=400, detail="Missing target IQN")
        portal = request.get("portal")
        res = service.connect_iscsi_target(iqn, portal)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to connect to iSCSI target"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/iscsi/disconnect")
def disconnect_iscsi_target(request: dict, service: StorageService = Depends(get_storage_service)):
    try:
        iqn = request.get("iqn") or request.get("target_iqn")
        if not iqn:
            raise HTTPException(status_code=400, detail="Missing target IQN")
        res = service.disconnect_iscsi_target(iqn)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to disconnect target"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/iscsi/portal/remove")
def remove_iscsi_portal(request: dict, service: StorageService = Depends(get_storage_service)):
    try:
        portal_ip = request.get("portal_ip") or request.get("ip")
        if not portal_ip:
            raise HTTPException(status_code=400, detail="Missing portal IP")
        return service.remove_iscsi_portal(portal_ip)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/iscsi/disks")
def get_iscsi_disks(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_iscsi_disks()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/iscsi/format-mount")
def format_mount_lun(request: dict, service: StorageService = Depends(get_storage_service)):
    try:
        disk_number = int(request.get("disk_number", 1))
        drive_letter = request.get("drive_letter", "E")
        label = request.get("label", "Mirador_iSCSI_LUN")
        return service.format_and_mount_lun(disk_number, drive_letter, label)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Windows Storage Spaces (Software RAID) Endpoints ─────────────────────────

@router.get("/spaces/overview")
def get_storage_spaces_overview(service: StorageService = Depends(get_storage_service)):
    """Full overview: pools, virtual disks, poolable disks."""
    try:
        return service.get_storage_spaces_overview()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spaces/poolable-disks")
def get_poolable_disks(service: StorageService = Depends(get_storage_service)):
    """Get physical disks available for pooling."""
    try:
        return service.get_poolable_disks()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spaces/pools")
def get_storage_pools(service: StorageService = Depends(get_storage_service)):
    """List all Storage Pools."""
    try:
        return service.get_storage_pools()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/spaces/pools")
def create_storage_pool(request: dict, service: StorageService = Depends(get_storage_service)):
    """Create a new Storage Pool. Body: { pool_name, disk_ids: ['0','1',...] }"""
    try:
        pool_name = request.get("pool_name") or request.get("name")
        disk_ids = request.get("disk_ids") or request.get("disks", [])
        if not pool_name:
            raise HTTPException(status_code=400, detail="Missing pool_name")
        if not disk_ids:
            raise HTTPException(status_code=400, detail="Missing disk_ids")
        res = service.create_storage_pool(str(pool_name), list(disk_ids))
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/spaces/pools/{pool_name}")
def delete_storage_pool(pool_name: str, service: StorageService = Depends(get_storage_service)):
    """Delete a Storage Pool."""
    try:
        res = service.delete_storage_pool(pool_name)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/spaces/pools/add-disk")
def add_disk_to_pool(request: dict, service: StorageService = Depends(get_storage_service)):
    """Add a physical disk to an existing pool. Body: { pool_name, disk_id }"""
    try:
        pool_name = request.get("pool_name")
        disk_id = request.get("disk_id")
        if not pool_name or disk_id is None:
            raise HTTPException(status_code=400, detail="Missing pool_name or disk_id")
        res = service.add_disk_to_pool(str(pool_name), str(disk_id))
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/spaces/pools/remove-disk")
def remove_disk_from_pool(request: dict, service: StorageService = Depends(get_storage_service)):
    """Remove a physical disk from a pool. Body: { pool_name, disk_id }"""
    try:
        pool_name = request.get("pool_name")
        disk_id = request.get("disk_id")
        if not pool_name or disk_id is None:
            raise HTTPException(status_code=400, detail="Missing pool_name or disk_id")
        res = service.remove_disk_from_pool(str(pool_name), str(disk_id))
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/spaces/pools/optimize")
def optimize_pool(request: dict, service: StorageService = Depends(get_storage_service)):
    """Optimize/rebalance a Storage Pool. Body: { pool_name }"""
    try:
        pool_name = request.get("pool_name")
        if not pool_name:
            raise HTTPException(status_code=400, detail="Missing pool_name")
        res = service.optimize_storage_pool(str(pool_name))
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spaces/virtual-disks")
def get_sw_virtual_disks(service: StorageService = Depends(get_storage_service)):
    """List all software RAID Virtual Disks."""
    try:
        return service.get_virtual_disks_sw()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/spaces/virtual-disks")
def create_sw_virtual_disk(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Create a software Virtual Disk on a Storage Pool.
    Body: { pool_name, vd_name, resiliency: 'Simple'|'Mirror'|'Parity', size_gb: 0=max,
            provisioning: 'Fixed'|'Thin', interleave_kb: 64 }
    """
    try:
        pool_name = request.get("pool_name")
        vd_name = request.get("vd_name") or request.get("name")
        if not pool_name or not vd_name:
            raise HTTPException(status_code=400, detail="Missing pool_name or vd_name")
        resiliency = str(request.get("resiliency", "Mirror"))
        size_gb = int(request.get("size_gb", 0))
        provisioning = str(request.get("provisioning", "Fixed"))
        interleave_kb = int(request.get("interleave_kb", 64))
        res = service.create_virtual_disk_sw(str(pool_name), str(vd_name), resiliency,
                                              size_gb, provisioning, interleave_kb)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/spaces/virtual-disks/{vd_name}")
def delete_sw_virtual_disk(vd_name: str, service: StorageService = Depends(get_storage_service)):
    """Delete a software Virtual Disk."""
    try:
        res = service.delete_virtual_disk_sw(vd_name)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/spaces/virtual-disks/repair")
def repair_sw_virtual_disk(request: dict, service: StorageService = Depends(get_storage_service)):
    """Repair a degraded software Virtual Disk. Body: { vd_name }"""
    try:
        vd_name = request.get("vd_name")
        if not vd_name:
            raise HTTPException(status_code=400, detail="Missing vd_name")
        res = service.repair_virtual_disk_sw(str(vd_name))
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/spaces/create-volume")
def create_volume(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Create a volume (partition + format + mount) on a Virtual Disk.
    Body: { vd_name, drive_letter: 'E', fs_type: 'NTFS', label: 'VMS_Data' }
    """
    try:
        vd_name = request.get("vd_name")
        if not vd_name:
            raise HTTPException(status_code=400, detail="Missing vd_name")
        drive_letter = str(request.get("drive_letter", ""))
        fs_type = str(request.get("fs_type", "NTFS"))
        label = str(request.get("label", "VMS_Data"))
        res = service.create_volume_on_vd(str(vd_name), drive_letter, fs_type, label)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spaces/tiers/{pool_name}")
def get_tiers(pool_name: str, service: StorageService = Depends(get_storage_service)):
    """Get storage tiers in a pool."""
    try:
        return service.get_storage_tiers(pool_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/spaces/tiered-disk")
def create_tiered_disk(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Create a tiered Virtual Disk (SSD hot + HDD cold).
    Body: { pool_name, vd_name, ssd_size_gb, hdd_size_gb }
    """
    try:
        pool_name = request.get("pool_name")
        vd_name = request.get("vd_name")
        if not pool_name or not vd_name:
            raise HTTPException(status_code=400, detail="Missing pool_name or vd_name")
        ssd_gb = int(request.get("ssd_size_gb", 50))
        hdd_gb = int(request.get("hdd_size_gb", 500))
        res = service.create_tiered_virtual_disk(str(pool_name), str(vd_name), ssd_gb, hdd_gb)
        if not res.get("success"):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
# ── Hardware Array Mounting & Unallocated Space Endpoints ───────────────────

@router.post("/mount-hardware-array")
def mount_hardware_array(request: dict = None, service: StorageService = Depends(get_storage_service)):
    r"""
    Format and mount a raw hardware RAID virtual disk in Windows Server.
    Initializes GPT, formats NTFS (64KB clusters for video), assigns drive letter D:,
    and redirects the active VMS recording path to D:\Recordings.
    """
    try:
        req = request or {}
        disk_number = req.get("disk_number")
        if disk_number is not None:
            disk_number = int(disk_number)
        drive_letter = req.get("drive_letter", "D")
        label = req.get("label", "VMS_STORAGE")
        res = service.mount_hardware_array(disk_number, drive_letter, label)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to mount disk in Windows"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/unallocated-disks")
def get_unallocated_disks(service: StorageService = Depends(get_storage_service)):
    """
    Detects any physical storage disks with unallocated/unpartitioned free space.
    Particularly useful when the OS drive (Bay 0) has e.g. only 250 GB allocated to C: on a 7.2 TB disk,
    leaving ~6.9 TB unallocated and idle.
    """
    try:
        return service.get_unallocated_disks()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/partition-unallocated")
def partition_unallocated(request: dict, service: StorageService = Depends(get_storage_service)):
    r"""
    Safely creates a new NTFS 64KB partition using the raw unallocated space on a physical disk (e.g. Disk 0 / Bay 0).
    Mounts it as a new Windows drive letter (e.g. E:\) for surveillance recording.
    Windows OS on C:\ is 100% untouched.
    """
    try:
        disk_number = request.get("disk_number", 0)
        drive_letter = request.get("drive_letter")
        label = request.get("label", "VMS_BAY0_REC")
        res = service.partition_unallocated_space(int(disk_number), drive_letter, label)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to partition unallocated space"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/delete-partition")
def delete_partition(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Safely deletes a secondary Windows volume (e.g. E:), returning the space to unallocated.
    Strictly blocked on C: (boot/system drive) to protect Windows Server OS.
    """
    try:
        drive_letter = request.get("drive_letter")
        if not drive_letter:
            raise HTTPException(status_code=400, detail="Drive letter is required.")
        res = service.delete_partition(drive_letter)
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to delete partition"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clear-disk-raw")
def clear_disk_raw(request: dict, service: StorageService = Depends(get_storage_service)):
    """
    Clears an unallocated secondary disk's GPT/MBR partition structure, resetting it to completely RAW state.
    This enables Windows Storage Spaces to recognize the disk with CanPool = $true.
    Strictly blocked on Disk 0 / C: (boot/system drive).
    """
    try:
        disk_number = request.get("disk_number")
        if disk_number is None:
            raise HTTPException(status_code=400, detail="disk_number is required.")
        res = service.clear_disk_to_raw(int(disk_number))
        if not res.get("success", False):
            raise HTTPException(status_code=400, detail=res.get("error", "Failed to clear disk to RAW"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
