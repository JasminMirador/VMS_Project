from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime
from uuid import uuid4
 
class CADFileBase(BaseModel):
    map_id: str
    original_filename: str
    file_type: str
 
class CADFileCreate(CADFileBase):
    id: str = Field(default_factory=lambda: str(uuid4()))
    storage_url: str
    conversion_status: str = "pending"
    conversion_error: Optional[str] = None
    uploaded_by: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
 
class CADParsedData(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    cad_file_id: str
    units_detected: Optional[str] = None
    bounds_min_x: Optional[float] = None
    bounds_min_y: Optional[float] = None
    bounds_max_x: Optional[float] = None
    bounds_max_y: Optional[float] = None
    parsed_json: Dict[str, Any]
    parser_version: str = "1.0.0"
    created_at: datetime = Field(default_factory=datetime.utcnow)
 
class MapScaleCalibration(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    map_id: str
    method: str
    scale_factor: float
    calibration_point_a: Optional[Dict[str, float]] = None
    calibration_point_b: Optional[Dict[str, float]] = None
    real_world_distance_m: Optional[float] = None
    calibrated_by: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
 
class CADLayerMapping(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    map_id: str
    layer_name: str
    role: str
    entity_count: int
    created_at: datetime = Field(default_factory=datetime.utcnow)