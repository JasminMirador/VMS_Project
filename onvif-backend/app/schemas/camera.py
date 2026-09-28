from pydantic import BaseModel, model_validator, field_validator
from typing import Optional, Any
from datetime import datetime

class BaseCameraRequest(BaseModel):
    ip:         str = ""
    ip_address: Optional[str] = None
    is_deleted: bool = False
    deleted_at: Optional[datetime] = None
    deleted_by: Optional[str] = None

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
    port:     int = 80
    username: str = ""
    password: str = ""

class ImagingSettingRequest(BaseCameraRequest):
    port:     int   = 80
    username: str   = ""
    password: str   = ""
    setting:  str
    value:    str | float | int

class PTZPresetRequest(BaseCameraRequest):
    port:         int = 80
    username:     str = ""
    password:     str = ""
    preset_token: str

class PTZSavePresetRequest(BaseCameraRequest):
    port:         int = 80
    username:     str = ""
    password:     str = ""
    preset_name:  str
    preset_token: Optional[str] = None

class PTZMoveRequest(BaseCameraRequest):
    port:     int   = 80
    username: str   = ""
    password: str   = ""
    pan:      float = 0.0
    tilt:     float = 0.0
    zoom:     float = 0.0

class RelayRequest(BaseCameraRequest):
    port:        int = 80
    username:    str = ""
    password:    str = ""
    relay_token: str
    state:       str = "Active"

class ProbeRequest(BaseCameraRequest):
    port:        int = 80
    username:    str = ""
    password:    str = ""
    channel:     int = 0
    group_id:    str = "default"
    device_name: str = ""
    save_to_db:  bool = True
    
    @field_validator('group_id', 'device_name', mode='before')
    @classmethod
    def val_safe_name(cls, v):
        return validate_safe_name(v)

class StreamRegisterRequest(BaseCameraRequest):
    rtsp_url:     str
    port:         int = 80
    username:     str = ""
    password:     str = ""
    manufacturer: str = "Unknown"
    model:        str = "Unknown"
    mac:          str = "—"
    device_name:  str = ""
    group_id:     str = "default"
    live_codec:   Optional[str] = "H.264"
    
    @field_validator('group_id', 'device_name', 'manufacturer', 'model', mode='before')
    @classmethod
    def val_safe_name(cls, v):
        return validate_safe_name(v)

class StreamAssignRequest(BaseCameraRequest):
    port:              int = 80
    username:          str = ""
    manufacturer:      str = "Unknown"
    model:             str = "Unknown"
    mac:               str = "—"
    device_name:       str = ""
    live_rtsp:         str
    recording_rtsp:    str
    live_profile:      str = ""
    recording_profile: str = ""
    live_codec:        Optional[str] = "H.264"
    fps:               Optional[int] = None
    resolution:        Optional[str] = None
    bitrate:           Optional[int] = None
    bitrate_type:      Optional[str] = None

    @field_validator('device_name', 'manufacturer', 'model', mode='before')
    @classmethod
    def val_safe_name(cls, v):
        return validate_safe_name(v)

class VideoEncoderSettingRequest(BaseCameraRequest):
    port:              int = 80
    username:          str = ""
    password:          str = ""
    profile_token:     str
    resolution:        Optional[str] = None
    encoding:          Optional[str] = None
    fps:               Optional[int] = None
    bitrate:           Optional[int] = None
    bitrate_type:      Optional[str] = None
    iframe_interval:   Optional[int] = None


