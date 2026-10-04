import cv2
import numpy as np
from pathlib import Path
import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from app.config import settings

logger = logging.getLogger(__name__)

# ── Time Bucket Definitions ────────────────────────────────────────────────────
# The synopsis time range may span across different lighting conditions.
# We divide the day into 4 buckets so each plate captures accurate ambient light.
TIME_BUCKETS = [
    ("morning",   6,  12),   # 06:00 – 11:59  (daylight rising)
    ("afternoon", 12, 17),   # 12:00 – 16:59  (bright sunlight)
    ("evening",   17, 21),   # 17:00 – 20:59  (dusk / golden hour)
    ("night",     21, 6),    # 21:00 – 05:59  (artificial / low light)
]

def get_time_bucket(hour: int) -> str:
    """Return the bucket name for a given hour (0–23)."""
    for name, start, end in TIME_BUCKETS:
        if start < end:                      # Normal range (e.g. 6 → 12)
            if start <= hour < end:
                return name
        else:                                # Wraps midnight (e.g. 21 → 6)
            if hour >= start or hour < end:
                return name
    return "afternoon"                       # Fallback


class BackgroundModeler:
    """
    Generates clean static background plates for a given camera.

    Approach:
      - Temporal median across many sampled frames removes moving foreground
        (people, vehicles) because they appear in different positions each frame;
        stationary background pixels stay consistent across frames.

    Multi-plate strategy:
      - A single synopsis request may span several hours with very different
        lighting (morning sun → afternoon glare → evening dusk → night).
      - We therefore compute a SEPARATE plate per time bucket so the compositor
        can pick the plate that matches each tube's original timestamp, making
        the composited result look natural.

    Plate naming convention:
      {BACKGROUND_DIR}/{camera_id}_{bucket_name}_bg.png
      e.g.  CAM_01_morning_bg.png
            CAM_01_afternoon_bg.png
    """

    # ── Single-plate extraction ────────────────────────────────────────────────

    @staticmethod
    def extract_temporal_median(
        video_paths: List[str],
        output_plate_path: str,
        sample_rate: int = 15,
        max_frames: int = 300
    ) -> str:
        """
        Computes ONE background plate from a list of video files by taking
        the temporal pixel-wise median across sampled frames.

        Args:
            video_paths:       List of decoded (plain) MP4 file paths.
            output_plate_path: Where to save the resulting PNG plate.
            sample_rate:       Sample one frame every N frames (default 15).
            max_frames:        Cap on total frames sampled to limit RAM usage.

        Returns:
            Absolute path to the saved background plate PNG.
        """
        frames: List[np.ndarray] = []

        for v_path in video_paths:
            if not Path(v_path).exists():
                logger.warning(f"[BG] Video not found — skipping: {v_path}")
                continue

            cap = cv2.VideoCapture(v_path)
            frame_count = 0
            while cap.isOpened() and len(frames) < max_frames:
                ret, frame = cap.read()
                if not ret:
                    break
                if frame_count % sample_rate == 0:
                    frames.append(frame)
                frame_count += 1
            cap.release()

        if not frames:
            raise ValueError(
                "[BG] No valid frames extracted — cannot build background plate."
            )

        logger.info(
            f"[BG] Computing temporal median over {len(frames)} frames → {output_plate_path}"
        )
        # np.median on axis=0 collapses the time axis; moving objects disappear
        median_frame = np.median(np.stack(frames, axis=0), axis=0).astype(np.uint8)

        Path(output_plate_path).parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(output_plate_path, median_frame)
        logger.info(f"[BG] Background plate saved → {output_plate_path}")
        return output_plate_path

    # ── Multi-plate extraction (time-bucketed) ─────────────────────────────────

    @classmethod
    def extract_bucketed_plates(
        cls,
        video_paths_with_times: List[Dict],
        camera_id: str,
        sample_rate: int = 15,
        max_frames_per_bucket: int = 200
    ) -> Dict[str, str]:
        """
        Computes one background plate PER time bucket covering the requested range.

        This handles lighting changes across large time windows:
          - A query spanning 08:00 → 20:00 will generate morning + afternoon + evening plates.
          - The compositor chooses the right plate when blending each tube.

        Args:
            video_paths_with_times: List of dicts with keys:
                {
                    "path": "/tmp/dec_xyz.mp4",
                    "start_hour": 10          # Hour (0-23) the clip starts
                }
            camera_id:  e.g. "CAM_01"
            sample_rate:          Sample every N frames per clip.
            max_frames_per_bucket: Cap per bucket to control RAM.

        Returns:
            Dict of { bucket_name → absolute plate path }
            e.g. { "morning": "...CAM_01_morning_bg.png",
                   "afternoon": "...CAM_01_afternoon_bg.png" }
        """
        # Group video frames by time bucket
        bucket_frames: Dict[str, List[np.ndarray]] = {
            b[0]: [] for b in TIME_BUCKETS
        }

        for entry in video_paths_with_times:
            v_path = entry.get("path", "")
            start_hour = int(entry.get("start_hour", 12))
            bucket = get_time_bucket(start_hour)

            if not Path(v_path).exists():
                logger.warning(f"[BG] Clip not found — skipping: {v_path}")
                continue

            cap = cv2.VideoCapture(v_path)
            frame_count = 0
            while (
                cap.isOpened()
                and len(bucket_frames[bucket]) < max_frames_per_bucket
            ):
                ret, frame = cap.read()
                if not ret:
                    break
                if frame_count % sample_rate == 0:
                    bucket_frames[bucket].append(frame)
                frame_count += 1
            cap.release()
            logger.info(
                f"[BG] Clip [{v_path}] → bucket '{bucket}': "
                f"{len(bucket_frames[bucket])} frames sampled"
            )

        # Compute one plate per populated bucket
        plate_paths: Dict[str, str] = {}
        for bucket_name, frames in bucket_frames.items():
            if not frames:
                continue  # This bucket has no footage — skip

            plate_filename = f"{camera_id}_{bucket_name}_bg.png"
            plate_path = str(settings.BACKGROUND_DIR / plate_filename)

            logger.info(
                f"[BG] Computing '{bucket_name}' plate from "
                f"{len(frames)} frames → {plate_path}"
            )
            median_frame = np.median(
                np.stack(frames, axis=0), axis=0
            ).astype(np.uint8)

            Path(plate_path).parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(plate_path, median_frame)
            plate_paths[bucket_name] = plate_path
            logger.info(f"[BG] '{bucket_name}' plate saved → {plate_path}")

        if not plate_paths:
            raise ValueError(
                f"[BG] No background plates could be generated for camera {camera_id}."
            )

        return plate_paths

    # ── Plate Selector (used by compositor) ───────────────────────────────────

    @staticmethod
    def select_plate_for_tube(
        plate_paths: Dict[str, str],
        tube_original_timestamp: str
    ) -> str:
        """
        Given the tube's original timestamp, returns the path of the background
        plate whose lighting bucket best matches that time of day.

        Args:
            plate_paths:             Dict of { bucket_name → plate_path }
            tube_original_timestamp: ISO string like "10:25:14.200" or seconds string

        Returns:
            Best-matching plate path. Falls back to any available plate.
        """
        try:
            # Try to parse hour from "HH:MM:SS" or seconds offset
            if ":" in tube_original_timestamp:
                hour = int(tube_original_timestamp.split(":")[0])
            else:
                hour = 12  # Default to afternoon if format is unknown
        except Exception:
            hour = 12

        bucket = get_time_bucket(hour)

        if bucket in plate_paths:
            return plate_paths[bucket]

        # Fallback: return the first available plate
        fallback = next(iter(plate_paths.values()))
        logger.debug(
            f"[BG] Bucket '{bucket}' not available — falling back to '{fallback}'"
        )
        return fallback
