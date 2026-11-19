from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class TestStageConfig(BaseModel):
    camera_count: int = Field(default=10, ge=0, description="Target logical camera feeds")
    duration_sec: int = Field(default=600, ge=30, description="Stage duration in seconds")
    is_baseline: bool = Field(default=False, description="Whether this stage serves as 0-feed baseline")

class SafetyThresholds(BaseModel):
    max_server_cpu_pct: float = Field(default=95.0, ge=50.0, le=100.0)
    min_free_disk_gb: float = Field(default=30.0, ge=1.0)
    max_dropped_frames_pct: float = Field(default=20.0, ge=1.0, le=100.0)

class StreamProfiles(BaseModel):
    resolution: str = "1080p"
    fps: int = 25
    codec: str = "H.264"
    bitrate_kbps: int = 4096

class CreateRunRequest(BaseModel):
    name: str = Field(default="Performance Test Run", max_length=120)
    target_camera_count: Optional[int] = Field(default=100, ge=1, le=500, description="Dynamic number of cameras to benchmark")
    test_duration_minutes: Optional[float] = Field(default=10.0, ge=0.5, le=1440.0, description="Sustained test duration in minutes")
    test_mode: Optional[str] = Field(default="sustained", description="'sustained' direct target load or 'progressive' multi-stage")
    baseline_duration_sec: Optional[int] = Field(default=60, ge=10, le=600, description="0-camera baseline duration in seconds")
    stages: Optional[List[TestStageConfig]] = None
    profiles: Optional[StreamProfiles] = None
    enable_recording: bool = True
    enable_encryption: bool = True
    enable_ai: bool = False
    enable_minio_upload: bool = True
    concurrent_live_viewers: int = 2
    warmup_sec: int = 60
    safety_thresholds: Optional[SafetyThresholds] = None

class StopRunRequest(BaseModel):
    reason: str = Field(default="Operator cancelled test run", max_length=200)
