import subprocess
import numpy as np
from pathlib import Path
import logging
from app.config import settings

logger = logging.getLogger(__name__)

class VideoEncoder:
    def __init__(self, output_mp4_path: str, width: int, height: int, fps: float = 25.0):
        self.output_path = Path(output_mp4_path)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.width = width
        self.height = height
        self.fps = fps
        self.writer = None

    def start(self):
        import cv2
        # Use avc1 (H264) codec
        fourcc = cv2.VideoWriter_fourcc(*'avc1')
        self.writer = cv2.VideoWriter(str(self.output_path), fourcc, self.fps, (self.width, self.height))
        if not self.writer.isOpened():
            # Fallback to mp4v if avc1 is missing
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            self.writer = cv2.VideoWriter(str(self.output_path), fourcc, self.fps, (self.width, self.height))
        logger.info(f"Started cv2.VideoWriter Video Encoder process -> {self.output_path}")

    def write_frame(self, frame_bgr: np.ndarray):
        if self.writer and self.writer.isOpened():
            self.writer.write(frame_bgr)

    def finish(self):
        if self.writer:
            self.writer.release()
            logger.info(f"cv2.VideoWriter encoding finished successfully -> {self.output_path}")
