from fastapi import APIRouter, HTTPException, Depends
from typing import List
from .service import StorageService
from .models import DeviceModel, DriveOptionModel, StatusModel, ConfigModel, ProvisionRequest, ProvisionResponse, PerformanceModel, ReplicationModel

router = APIRouter(prefix="/api/storage", tags=["storage_management"])

# Dependency to get the service instance
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
    # By default, without running a test, we just return Not Tested
    return {"status": "Not Tested", "write_speed": None, "read_speed": None, "last_test": "Never"}

@router.post("/performance", response_model=PerformanceModel)
def run_performance(service: StorageService = Depends(get_storage_service)):
    try:
        perf = service.run_performance_test()
        return {
            "status": "Tested",
            "write_speed": perf.get("write_speed"),
            "read_speed": perf.get("read_speed"),
            "last_test": "Just now"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/logs")
def get_logs(service: StorageService = Depends(get_storage_service)):
    try:
        return service.get_logs()
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

@router.post("/healthcheck", response_model=StatusModel)
def healthcheck(service: StorageService = Depends(get_storage_service)):
    # Re-evaluates health by getting status
    try:
        return service.get_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
