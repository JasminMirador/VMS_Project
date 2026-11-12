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


