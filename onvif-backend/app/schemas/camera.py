from pydantic import BaseModel, model_validator, field_validator, Field
from typing import Optional, Any
from datetime import datetime

class BaseCameraRequest(BaseModel):
    ip: str = Field(default="", max_length=255)
    ip_address: Optional[str] = Field(None, pattern=r"^[a-zA-Z0-9.-]*$", max_length=255)
    is_deleted: bool = False
    deleted_at: Optional[datetime] = None
    deleted_by: Optional[str] = Field(None, max_length=1024)

    @model_validator(mode='before')
    @classmethod
    def sync_ip_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            val = data.get('ip_address') or data.get('ip') or ""
            data['ip'] = val
            data['ip_address'] = val
        return data

import re
NAME_REGEX = re.compile(r"^[a-zA-Z0-9 _.-]+$")

def validate_safe_name(v: str) -> str:
    if v and not NAME_REGEX.match(v):
        raise ValueError("Field contains invalid characters")
    return v


class CameraCredentials(BaseCameraRequest):
    port: int = Field(default=80, ge=1, le=65535)
    username: str = Field(default="", max_length=128)
    password: str = Field(default="", max_length=1024)

class ImagingSettingRequest(BaseCameraRequest):
    port: int = Field(default=80, ge=1, le=65535)
    username: str = Field(default="", max_length=128)
    password: str = Field(default="", max_length=1024)
    setting: str = Field(..., max_length=1024)
    value:    str | float | int

class PTZPresetRequest(BaseCameraRequest):
    port: int = Field(default=80, ge=1, le=65535)
    username: str = Field(default="", max_length=128)
    password: str = Field(default="", max_length=1024)
    preset_token: str = Field(..., max_length=1024)
class PTZSavePresetRequest(BaseCameraRequest):
    port: int = Field(default=80, ge=1, le=65535)
    username: str = Field(default="", max_length=128)
    password: str = Field(default="", max_length=1024)
    preset_name: str = Field(..., max_length=1024)
    preset_token: Optional[str] = Field(None, max_length=1024)

class PTZMoveRequest(BaseCameraRequest):
    port: int = Field(default=80, ge=1, le=65535)
    username: str = Field(default="", max_length=128)
    password: str = Field(default="", max_length=1024)
    pan: float = Field(default=0.0, ge=-1.0, le=1.0)
    tilt: float = Field(default=0.0, ge=-1.0, le=1.0)
    zoom: float = Field(default=0.0, ge=0.0, le=1.0)

class RelayRequest(BaseCameraRequest):
    port: int = Field(default=80, ge=1, le=65535)
    username: str = Field(default="", max_length=128)
    password: str = Field(default="", max_length=1024)
    relay_token: str = Field(..., max_length=1024)
    state: str = Field(default="Active", max_length=255)

class ProbeRequest(BaseCameraRequest):
    port: int = Field(default=80, ge=1, le=65535)
    username: str = Field(default="", max_length=128)
    password: str = Field(default="", max_length=1024)
    channel:     int = 0
    group_id: str = Field(default="default", max_length=255)
    device_name: str = Field(default="", max_length=255)
    save_to_db:  bool = True
    
    @field_validator('group_id', 'device_name', mode='before')
    @classmethod
    def val_safe_name(cls, v):
        return validate_safe_name(v)

class StreamRegisterRequest(BaseCameraRequest):
    rtsp_url: str = Field(..., max_length=1024)
    port: int = Field(default=80, ge=1, le=65535)
    username: str = Field(default="", max_length=128)
    password: str = Field(default="", max_length=1024)
    manufacturer: str = Field(default="Unknown", max_length=255)
    model: str = Field(default="Unknown", max_length=255)
    mac:          str = "—"
    device_name: str = Field(default="", max_length=255)
    group_id: str = Field(default="default", max_length=255)
    live_codec: Optional[str] = Field(default="H.264", max_length=255)
    
    @field_validator('group_id', 'device_name', 'manufacturer', 'model', mode='before')
    @classmethod
    def val_safe_name(cls, v):
        return validate_safe_name(v)

class StreamAssignRequest(BaseCameraRequest):
    port: int = Field(default=80, ge=1, le=65535)
    username: str = Field(default="", max_length=128)
    manufacturer: str = Field(default="Unknown", max_length=255)
    model: str = Field(default="Unknown", max_length=255)
    mac:               str = "—"
    device_name: str = Field(default="", max_length=255)
    live_rtsp: str = Field(..., max_length=1024)
    recording_rtsp: str = Field(..., max_length=1024)
    live_profile: str = Field(default="", max_length=255)
    recording_profile: str = Field(default="", max_length=255)
    live_codec: Optional[str] = Field(default="H.264", max_length=255)
    fps:               Optional[int] = None
    resolution: Optional[str] = Field(None, max_length=1024)
    bitrate:           Optional[int] = None
    bitrate_type: Optional[str] = Field(None, max_length=1024)

    @field_validator('device_name', 'manufacturer', 'model', mode='before')
    @classmethod
    def val_safe_name(cls, v):
        return validate_safe_name(v)

class VideoEncoderSettingRequest(BaseCameraRequest):
    port: int = Field(default=80, ge=1, le=65535)
    username: str = Field(default="", max_length=128)
    password: str = Field(default="", max_length=1024)
    profile_token: str = Field(..., max_length=1024)
    resolution: Optional[str] = Field(None, max_length=1024)
    encoding: Optional[str] = Field(None, max_length=1024)
    fps:               Optional[int] = None
    bitrate:           Optional[int] = None
    bitrate_type: Optional[str] = Field(None, max_length=1024)
    iframe_interval:   Optional[int] = None


