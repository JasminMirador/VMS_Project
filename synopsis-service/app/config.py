import os
import torch
from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Load .env into os.environ BEFORE the Settings class is defined.
# Nearest file first; load_dotenv never overwrites values already set.
_SERVICE_DIR = Path(__file__).resolve().parent.parent   # synopsis-service/
_ROOT_DIR    = _SERVICE_DIR.parent                      # VMS_Project/

# Service-specific .env first (optional), then the shared project .env.
# load_dotenv never overwrites values that are already set.
load_dotenv(_SERVICE_DIR / ".env")
load_dotenv(_ROOT_DIR / ".env")

class Settings(BaseSettings):
    PROJECT_NAME: str = "MIRADOR Video Synopsis Microservice"
    PORT: int = int(os.getenv("SYNOPSIS_SERVICE_PORT", "8005"))
    HOST: str = "0.0.0.0"
    
    # MongoDB Configuration
    MONGO_URI: str = os.environ["MONGO_URI"]
    DB_NAME: str = os.environ["MONGO_DB_NAME"]
    
    # Hardware & Model Configuration
    DEVICE: str = os.getenv("CUDA_DEVICE", "cuda:0" if torch.cuda.is_available() else "cpu")
    USE_FP16: bool = True
    YOLO_MODEL_PATH: str = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
    YOLO_SEG_MODEL_PATH: str = os.getenv("YOLO_SEG_MODEL_PATH", "yolov8n-seg.pt")
    
    # Storage Paths
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    STORAGE_DIR: Path = BASE_DIR / "devices_data" / "synopsis"
    BACKGROUND_DIR: Path = STORAGE_DIR / "backgrounds"
    TUBES_DIR: Path = STORAGE_DIR / "tubes"
    OUTPUT_DIR: Path = STORAGE_DIR / "outputs"
    FACE_THUMBS_DIR: Path = STORAGE_DIR / "face_thumbs"
    
    # Synopsis Algorithm Configuration
    MAX_IOU_OVERLAP: float = 0.15
    DEFAULT_COMPRESSION_RATIO: float = 60.0
    # How many source frames to advance between detections during tracking.
    # 1 = process every frame (smoothest, most natural-looking motion, slowest).
    # 2 = process every other frame (2x faster, but people visibly "hop" between
    #     positions since only half their real poses were captured).
    DETECTION_FRAME_SKIP: int = int(os.getenv("DETECTION_FRAME_SKIP", "1"))
    
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()

# Ensure required storage subdirectories exist
for d in [settings.STORAGE_DIR, settings.BACKGROUND_DIR, settings.TUBES_DIR, settings.OUTPUT_DIR, settings.FACE_THUMBS_DIR]:
    d.mkdir(parents=True, exist_ok=True)