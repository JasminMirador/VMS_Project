from pydantic import BaseModel, Field
from typing import List, Optional, Union

class DeviceModel(BaseModel):
    name: str
    health: str
    type: str
    capacity_tb: float
    device_id: Union[str, int]

class StatusModel(BaseModel):
    health: str
    capacity_tb: float
    free_tb: float
    used_tb: float

class ConfigModel(BaseModel):
    recording_path: str
    retention_days: Optional[int] = 30

class PerformanceModel(BaseModel):
    status: str
    write_speed: Optional[str] = None
    read_speed: Optional[str] = None
    last_test: Optional[str] = None

class ProvisionRequest(BaseModel):
    targetDriveLetter: str
    recordingsFolder: str

class ProvisionResponse(BaseModel):
    success: bool
    path: str
    log: str

class ReplicationModel(BaseModel):
    minio_status: str
    minio_service: str
    syncthing_status: str
