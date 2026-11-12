from pydantic import BaseModel, Field
from typing import List, Optional, Union

class DeviceModel(BaseModel):
    name: str
    health: str
    type: str
    capacity_tb: float
    device_id: Union[str, int]
    slot: Optional[int] = None
    enclosure: Optional[int] = None
    model: Optional[str] = None
    interface: Optional[str] = None
    media: Optional[str] = None
    speed: Optional[str] = None
    spun: Optional[str] = None
    is_locating: Optional[bool] = False

class DriveOptionModel(BaseModel):
    letter: str
    label: str
    is_existing: bool
    free_gb: Optional[float] = None
    total_gb: Optional[float] = None

class StatusModel(BaseModel):
    health: str
    capacity_tb: float
    free_tb: float
    used_tb: float
    raid_level: Optional[str] = "Standard Volume"
    controller: Optional[str] = "Host Storage Controller"
    serial_number: Optional[str] = "N/A"
    firmware: Optional[str] = "N/A"
    interface: Optional[str] = "SATA/NVMe"
    personality: Optional[str] = "Standard"
    bbu_status: Optional[str] = "Not Installed"
    bbu_temp: Optional[str] = "N/A"
    cache_policy: Optional[str] = "OS Managed"
    target_drive: Optional[str] = "C:"
    virtual_drives: Optional[int] = 0
    physical_drives: Optional[int] = 0
    mode: Optional[str] = "Standard Storage"

class ConfigModel(BaseModel):
    recording_path: str
    retention_days: Optional[int] = 70
    failover: Optional[bool] = False
    raid_level: Optional[str] = "RAID 5"
    file_system: Optional[str] = "NTFS"
    allocation_unit: Optional[str] = "64 KB"

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

class LocateRequest(BaseModel):
    enclosure: Optional[int] = 0
    slot: int
    enable: bool = True

class RebuildRequest(BaseModel):
    enclosure: Optional[int] = 0
    slot: int

class CreateRaidRequest(BaseModel):
    raid_type: str
    drive_slots: list
    name: Optional[str] = "VMS_DATA"
    strip_kb: Optional[int] = 64

class HotSpareRequest(BaseModel):
    enclosure: Optional[int] = 0
    slot: int
