from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime

class FrameMeta(BaseModel):
    frame_idx: int
    original_timestamp: str
    bbox: List[int] # [x, y, w, h] body bounding box
    face_bbox: Optional[List[int]] = None # [x, y, w, h] face region bounding box
    mask_rel_path: Optional[str] = None
    face_crop_rel_path: Optional[str] = None

class TrackSkeleton(BaseModel):
    track_id: str
    camera_id: str
    start_time: str
    end_time: str
    duration_s: float
    best_face_bbox: Optional[List[int]] = None
    best_original_timestamp: Optional[str] = None
    best_face_crop_url: Optional[str] = None
    thumbnail_path: Optional[str] = None
    frames: List[FrameMeta]

class SynopsisJobCreate(BaseModel):
    job_name: Optional[str] = None
    description: Optional[str] = None
    incident_time: Optional[str] = None
    camera_id: Union[str, List[str]]
    range_start: str
    range_end: str
    target_duration_s: Optional[float] = 60.0
    direction_angle: Optional[float] = None
    direction_tolerance: Optional[float] = 45.0
    direction_start: Optional[List[float]] = None
    direction_end: Optional[List[float]] = None

class SynopsisJobUpdate(BaseModel):
    job_name: Optional[str] = None
    description: Optional[str] = None
    incident_time: Optional[str] = None
    status: Optional[str] = None

class SynopsisJobResponse(BaseModel):
    job_id: str
    job_name: Optional[str] = None
    description: Optional[str] = None
    incident_time: Optional[str] = None
    camera_id: str
    group_id: Optional[str] = None
    range_start: str
    range_end: str
    direction_angle: Optional[float] = None
    direction_tolerance: Optional[float] = None
    direction_start: Optional[List[float]] = None
    direction_end: Optional[List[float]] = None
    status: str # "queued", "processing", "completed", "failed"
    progress: float = 0.0
    clip_details: Optional[List[Dict[str, Any]]] = None
    total_clips: Optional[int] = None
    total_clips_by_camera: Optional[Dict[str, int]] = None
    stages: Optional[Dict[str, Any]] = None
    objects: Optional[List[str]] = None
    output_video_url: Optional[str] = None
    metadata_sidecar_url: Optional[str] = None
    heatmap_url: Optional[str] = None
    metrics: Optional[dict] = None
    error_message: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    updated_at: Optional[str] = None

class ScheduleItem(BaseModel):
    track_id: str
    synopsis_start_s: float
    original_start_time: str
    original_end_time: str
    duration_s: float

class SynopsisMetadataItem(BaseModel):
    synopsis_timestamp_s: float
    track_id: str
    original_timestamp: str
    bbox: List[int]

class SynopsisSearchRequest(BaseModel):
    camera_id: str
    start: str  # ISO string or relative time string
    end: str

class TubeSummary(BaseModel):
    track_id: str
    start: str
    end: str
    duration_s: float

class SynopsisSearchResponse(BaseModel):
    tubes: List[TubeSummary]