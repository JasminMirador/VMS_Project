import cv2
import numpy as np
import logging
from typing import List, Dict, Any, Optional
from app.config import settings
from app.db.models import TrackSkeleton, FrameMeta

logger = logging.getLogger(__name__)


# ── Haar Cascade Face Detector (loaded once at module import) ─────────────────
# Self-contained inside synopsis-service — no dependency on onvif-backend.
# Uses OpenCV's built-in frontal face Haar cascade XML.
_face_cascade: Optional[cv2.CascadeClassifier] = None

def _load_face_cascade() -> Optional[cv2.CascadeClassifier]:
    """Load OpenCV Haar Cascade frontal face detector. Returns None if unavailable."""
    global _face_cascade
    if _face_cascade is not None:
        return _face_cascade
    try:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        cascade = cv2.CascadeClassifier(cascade_path)
        if cascade.empty():
            logger.warning("[FaceDetect] Haar cascade XML not found — falling back to geometric estimate.")
            return None
        _face_cascade = cascade
        logger.info("[FaceDetect] OpenCV Haar Cascade face detector loaded successfully.")
        return _face_cascade
    except Exception as e:
        logger.warning(f"[FaceDetect] Failed to load Haar cascade: {e}")
        return None


def _detect_face_in_person_bbox(
    frame_bgr: np.ndarray,
    x1: int, y1: int, x2: int, y2: int
) -> List[int]:
    """
    Runs OpenCV Haar Cascade face detection on the top 40% of the person bounding box.

    Returns:
        [fx, fy, fw, fh] — real detected face bbox in full-frame coordinates.
        Falls back to geometric estimate (top 25% of person bbox) if no face found.
    """
    cascade = _load_face_cascade()
    fh_frame, fw_frame = frame_bgr.shape[:2]

    # Clamp person bbox to frame dimensions
    x1 = max(0, x1); y1 = max(0, y1)
    x2 = min(fw_frame, x2); y2 = min(fh_frame, y2)
    person_w = x2 - x1
    person_h = y2 - y1

    if person_w < 10 or person_h < 10:
        # Too small — return geometric fallback immediately
        return [x1, y1, person_w, max(1, int(person_h * 0.25))]

    if cascade is not None:
        try:
            # Search only in the top 40% of the person bbox (where the head is)
            search_y2 = y1 + int(person_h * 0.40)
            search_y2 = min(fh_frame, search_y2)
            top_region = frame_bgr[y1:search_y2, x1:x2]

            if top_region.size > 0:
                gray_top = cv2.cvtColor(top_region, cv2.COLOR_BGR2GRAY)
                # Removed equalizeHist as it severely boosts noise/textures (like carpet) causing Haar false positives.

                faces = cascade.detectMultiScale(
                    gray_top,
                    scaleFactor=1.1,
                    minNeighbors=5,
                    minSize=(30, 30),
                    flags=cv2.CASCADE_SCALE_IMAGE
                )

                if len(faces) > 0:
                    # Take the largest detected face (most likely the primary subject)
                    fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
                    # Convert region-local coords back to full-frame coords
                    return [int(x1 + fx), int(y1 + fy), int(fw), int(fh)]
        except Exception as e:
            logger.debug(f"[FaceDetect] Haar detect error: {e}")

    # ── Geometric fallback: top 25% of person bounding box ──────────────────
    geo_fw = person_w
    geo_fh = max(1, int(person_h * 0.25))
    return [x1, y1, geo_fw, geo_fh]


# ── Main Detector + Tracker Class ─────────────────────────────────────────────

class DetectorTracker:
    """
    Runs YOLOv8n person detection + ByteTrack multi-object tracking on a
    recorded video clip. Builds per-person TrackSkeleton objects containing:
      - Full body bbox per frame
      - Real face bbox per frame (via Haar Cascade, with geometric fallback)
      - Start / end timestamps
      - Duration in seconds
    """

    def __init__(self):
        self.model = None

    def _load_model(self):
        if self.model is None:
            try:
                from ultralytics import YOLO
                logger.info(f"Loading YOLOv8 model: {settings.YOLO_MODEL_PATH}")
                self.model = YOLO(settings.YOLO_MODEL_PATH)
            except Exception as e:
                logger.error(f"Failed to load YOLO model: {e}")
                raise e

    def process_video_clip(
        self,
        video_path: str,
        camera_id: str,
        video_start_dt=None,
        range_start_dt=None,
        range_end_dt=None,
        face_thumbs_dir: Optional[str] = None,
        job_id: Optional[str] = None,
        base_progress: float = 0.0,
        progress_step: float = 0.0
    ) -> Dict[str, "TrackSkeleton"]:
        """
        Processes a decoded (plain MP4) video clip frame-by-frame.

        For each frame:
          1. YOLOv8 detects persons (class 0)
          2. ByteTrack assigns and maintains stable Track IDs
          3. Haar Cascade detects real face bbox inside each person bbox
          4. All metadata is accumulated into per-track FrameMeta lists

        Returns:
            Dict of track_id -> TrackSkeleton
        """
        self._load_model()
        
        # Setup Mongo client for live progress updates
        jobs_col = None
        if job_id and progress_step > 0:
            try:
                from pymongo import MongoClient
                client = MongoClient(settings.MONGO_URI)
                jobs_col = client[settings.DB_NAME]["face_jobs"]
            except Exception as e:
                logger.error(f"Failed to connect to Mongo for progress: {e}")

        # Force FFmpeg backend which is much better at decoding .ts files on Windows than MSMF
        cap = cv2.VideoCapture(video_path, cv2.CAP_FFMPEG)
        
        # Test if we can actually read a frame (isOpened is not enough on some systems)
        test_ret = False
        if cap.isOpened():
            test_ret, _ = cap.read()
        
        cap.release()
        
        if not test_ret:
            logger.warning(f"FFMPEG backend failed for {video_path}, falling back to default MSMF.")
            # Use default backend (usually MSMF on Windows)
            cap = cv2.VideoCapture(video_path)
        else:
            # Reopen fresh with FFMPEG because we CANNOT seek back to 0 on .ts files!
            cap = cv2.VideoCapture(video_path, cv2.CAP_FFMPEG)
            
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            logger.warning(f"Warning: OpenCV reports 0 total frames for {video_path}. Proceeding anyway to test read.")
            
        if not cap.isOpened():
            logger.error(f"Could not open video: {video_path}")
            return {}, 0

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        tracks_map: Dict[str, Dict[str, Any]] = {}
        frame_idx = 0

        logger.info(f"Processing clip: {video_path}  FPS={fps:.1f}")

        from datetime import timedelta
        from uuid import uuid4
        clip_uuid = uuid4().hex[:6]

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            rel_timestamp_s = frame_idx / fps
            
            # Pre-calculate absolute timestamp to check if frame is within user's selected time range
            abs_dt = None
            orig_ts_str = f"{rel_timestamp_s:.3f}"
            if video_start_dt:
                abs_dt = video_start_dt + timedelta(seconds=rel_timestamp_s)
                orig_ts_str = abs_dt.strftime("%Y-%m-%d %H:%M:%S")
                
                # Trim frames that fall strictly outside the user's requested search range
                if range_start_dt and abs_dt < range_start_dt:
                    frame_idx += 1
                    continue
                if range_end_dt and abs_dt > range_end_dt:
                    frame_idx += 1
                    continue

            # Update live progress to MongoDB every ~15 frames
            if jobs_col is not None and total_frames > 0 and frame_idx % 15 == 0:
                current_prog = base_progress + (frame_idx / total_frames) * progress_step
                try:
                    jobs_col.update_one({"job_id": job_id}, {"$set": {"progress": current_prog}})
                except Exception:
                    pass

            # ── Frame skipping (configurable via settings.DETECTION_FRAME_SKIP) ──
            # Skipping frames here means fewer real poses are captured per second
            # of footage, which makes people visibly "hop" between positions in
            # the synopsis output instead of moving smoothly. Default is 1 (no
            # skip) so motion looks natural; raise it only if processing time
            # matters more than motion smoothness.
            if frame_idx % settings.DETECTION_FRAME_SKIP != 0:
                frame_idx += 1
                continue

            # ── YOLOv8 + ByteTrack ───────────────────────────────────────────
            try:
                results = self.model.track(
                    frame,
                    persist=True,              # ByteTrack keeps ID across frames
                    tracker="bytetrack.yaml",  # ByteTrack algorithm
                    classes=[0],               # Class 0 = person only
                    conf=0.35,                 # Slightly lower conf to not miss blurry people
                    imgsz=320,                 # Smaller inference size → ~4x faster on GPU
                    half=True,                 # FP16 inference on GPU → ~2x faster
                    verbose=False,
                    device=settings.DEVICE
                )
            except Exception as e:
                logger.warning(f"Frame {frame_idx} tracking error: {e}")
                frame_idx += 1
                continue

            if results and results[0].boxes is not None:
                boxes = results[0].boxes
                if boxes.id is not None:
                    track_ids = boxes.id.int().cpu().tolist()
                    xyxy_boxes = boxes.xyxy.int().cpu().tolist()

                    for tid, box in zip(track_ids, xyxy_boxes):
                        t_key = f"T_{camera_id}_{clip_uuid}_{tid}"
                        x1, y1, x2, y2 = box
                        w = x2 - x1
                        h = y2 - y1

                        # Skip Haar for tiny/distant people (saves CPU time)
                        # Also skip Haar on alternate processed frames (runs Haar every 4th original frame)
                        if h > 50 and (frame_idx % 4 == 0):
                            face_bbox = _detect_face_in_person_bbox(frame, x1, y1, x2, y2)
                        else:
                            # Geometric fallback
                            face_bbox = [x1, y1, w, max(1, int(h * 0.25))]

                        frame_meta = FrameMeta(
                            frame_idx=frame_idx,
                            timestamp_s=round(rel_timestamp_s, 4),
                            original_timestamp=orig_ts_str,
                            bbox=[x1, y1, w, h],        # Full body
                            face_bbox=face_bbox          # Real face region
                        )

                        if t_key not in tracks_map:
                            tracks_map[t_key] = {
                                "track_id": t_key,
                                "camera_id": camera_id,
                                "start_time": f"{rel_timestamp_s:.3f}",
                                "end_time": f"{rel_timestamp_s:.3f}",
                                "best_face_bbox": None,
                                "best_original_timestamp": None,
                                "best_face_area": 0,
                                "best_is_real_face": False,
                                "thumbnail_path": None,
                                "frames": []
                            }

                        # Check if this is a real Haar-detected face (fw < 95% of person width)
                        is_real_face = face_bbox[2] < (w * 0.95)
                        face_area = face_bbox[2] * face_bbox[3]
                        # Real faces score 1M× higher so they always win over fallbacks
                        score = face_area * 1000000 if is_real_face else face_area

                        # Only update best score if it's a REAL face, or if we don't have one yet
                        if score > tracks_map[t_key].get("best_score", -1):
                            tracks_map[t_key]["best_face_bbox"] = face_bbox
                            tracks_map[t_key]["best_face_area"] = face_area
                            tracks_map[t_key]["best_is_real_face"] = is_real_face
                            tracks_map[t_key]["best_score"] = score
                            tracks_map[t_key]["best_original_timestamp"] = orig_ts_str

                            # ── Save thumbnail to disk NOW while frame is in memory ──
                            if face_thumbs_dir and job_id:
                                try:
                                    import os as _os
                                    pad = 10
                                    fh_fr, fw_fr = frame.shape[:2]
                                    # Crop fallback or real face
                                    cx1 = max(0, face_bbox[0] - pad)
                                    cy1 = max(0, face_bbox[1] - pad)
                                    cx2 = min(fw_fr, face_bbox[0] + face_bbox[2] + pad)
                                    cy2 = min(fh_fr, face_bbox[1] + face_bbox[3] + pad)

                                    if cx2 > cx1 and cy2 > cy1:
                                        crop = frame[cy1:cy2, cx1:cx2]
                                        safe_tid = t_key.replace("/", "_").replace(":", "_")
                                        thumb_filename = f"{job_id}_{safe_tid}.jpg"
                                        thumb_path = _os.path.join(face_thumbs_dir, thumb_filename)
                                        cv2.imwrite(thumb_path, crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
                                        tracks_map[t_key]["thumbnail_path"] = thumb_path
                                except Exception as _te:
                                    logger.debug(f"[FaceDetect] Could not save thumbnail: {_te}")

                        tracks_map[t_key]["end_time"] = f"{rel_timestamp_s:.3f}"
                        tracks_map[t_key]["frames"].append(frame_meta)

            frame_idx += 1

        cap.release()

        # ── Build TrackSkeleton objects ───────────────────────────────────────
        skeletons: Dict[str, TrackSkeleton] = {}
        for t_id, data in tracks_map.items():
            duration = float(data["end_time"]) - float(data["start_time"])
            if duration >= 0.5:  # Drop noise tracks shorter than 0.5 seconds
                skeletons[t_id] = TrackSkeleton(
                    track_id=data["track_id"],
                    camera_id=data["camera_id"],
                    start_time=data["start_time"],
                    end_time=data["end_time"],
                    duration_s=round(duration, 2),
                    best_face_bbox=data["best_face_bbox"],
                    best_original_timestamp=data.get("best_original_timestamp"),
                    thumbnail_path=data.get("thumbnail_path"),
                    frames=data["frames"]
                )

        logger.info(
            f"Extracted {len(skeletons)} valid person tracks from: {video_path}"
        )
        video_duration_s = total_frames / fps if fps > 0 else 0
        return skeletons, video_duration_s