import cv2
import numpy as np
import json
from pathlib import Path
import logging
from typing import Dict, Optional, List

from app.config import settings
from app.db.models import TrackSkeleton

logger = logging.getLogger(__name__)


class TubeExtractor:
    """
    Extracts the visual foreground tube for each person trajectory.

    For each frame in a TrackSkeleton:
      1. Crops the person bounding box region from the decoded video frame.
      2. Generates a per-pixel alpha mask using one of two methods:
           PRIMARY  — YOLOv8n-seg instance segmentation (GPU, accurate)
           FALLBACK — OpenCV MOG2 background subtraction using the background plate
                      as the reference model (CPU, good for static/fixed CCTV scenes)
      3. Applies 3-5px Gaussian blur to feather mask edges (avoids hard cuts).
      4. Saves each frame as RGBA PNG under:
             devices_data/synopsis/tubes/<track_id>/<frame_idx:06d>.png
      5. Writes a meta.json per tube containing original timestamps, bboxes, camera.

    Storage layout:
        devices_data/synopsis/tubes/
            T_CAM_01_88231/
                000015.png      ← RGBA crop, alpha=person mask
                000016.png
                ...
                meta.json       ← timestamps, bboxes, camera_id
    """

    def __init__(self):
        self.seg_model = None          # YOLOv8n-seg (loaded lazily)
        self._mog2_subtractors: Dict[str, cv2.BackgroundSubtractorMOG2] = {}

    # ── Model Loading ──────────────────────────────────────────────────────────

    def _load_seg_model(self) -> bool:
        """Attempt to load YOLOv8n-seg. Returns True if successful."""
        if self.seg_model is not None:
            return bool(self.seg_model)
        try:
            from ultralytics import YOLO
            logger.info(
                f"[TubeExtractor] Loading YOLOv8 segmentation model: "
                f"{settings.YOLO_SEG_MODEL_PATH}"
            )
            self.seg_model = YOLO(settings.YOLO_SEG_MODEL_PATH)
            logger.info("[TubeExtractor] YOLOv8-seg model loaded.")
            return True
        except Exception as e:
            logger.warning(
                f"[TubeExtractor] YOLOv8-seg unavailable ({e}). "
                "Will use MOG2 background subtraction fallback."
            )
            self.seg_model = False
            return False

    def _get_mog2_for_camera(self, camera_id: str) -> cv2.BackgroundSubtractorMOG2:
        """Returns (or creates) a per-camera MOG2 subtractor instance."""
        if camera_id not in self._mog2_subtractors:
            subtractor = cv2.createBackgroundSubtractorMOG2(
                history=500,
                varThreshold=50,
                detectShadows=False   # Shadows marked as foreground would cause artefacts
            )
            self._mog2_subtractors[camera_id] = subtractor
        return self._mog2_subtractors[camera_id]

    def _prime_mog2_with_background_plate(
        self,
        camera_id: str,
        bg_plate_path: Optional[str] = None
    ):
        """
        Prime the MOG2 model by feeding it the static background plate
        several times so it learns the 'empty scene' as its background model.
        This makes foreground extraction much more accurate than starting cold.
        """
        subtractor = self._get_mog2_for_camera(camera_id)

        plate_path = bg_plate_path
        if not plate_path:
            # Try to find the background plate for this camera automatically
            for suffix in ["morning", "afternoon", "evening", "night"]:
                candidate = settings.BACKGROUND_DIR / f"{camera_id}_{suffix}_bg.png"
                if candidate.exists():
                    plate_path = str(candidate)
                    break
            if not plate_path:
                fallback = settings.BACKGROUND_DIR / f"{camera_id}_bg.png"
                if fallback.exists():
                    plate_path = str(fallback)

        if plate_path and Path(plate_path).exists():
            bg_img = cv2.imread(plate_path)
            if bg_img is not None:
                # Feed plate ~30 times so MOG2 learns it as stable background
                for _ in range(30):
                    subtractor.apply(bg_img, learningRate=0.1)
                logger.info(
                    f"[TubeExtractor] MOG2 primed with background plate: {plate_path}"
                )
        else:
            logger.warning(
                f"[TubeExtractor] No background plate found for MOG2 priming "
                f"(camera: {camera_id}). MOG2 will learn background from first frames."
            )

    # ── Main Extraction Entry Point ────────────────────────────────────────────

    def extract_all_tubes_for_video(
        self,
        video_path: str,
        skeletons: List[TrackSkeleton],
        bg_plate_path: Optional[str] = None
    ) -> None:
        """
        Processes the decoded video clip ONCE and extracts RGBA foreground crops
        for ALL people present in the video simultaneously.

        Args:
            video_path:     Path to decoded (plain) MP4 file.
            skeletons:      List of TrackSkeletons detected in this specific video.
            bg_plate_path:  Optional path to background plate for MOG2 priming.
        """
        if not skeletons:
            return

        use_seg = self._load_seg_model()
        camera_id = skeletons[0].camera_id

        # Setup directories and frame maps for all skeletons
        tube_dirs = {}
        frame_maps = {}
        saved_counts = {}

        for skel in skeletons:
            t_dir = settings.TUBES_DIR / skel.track_id
            t_dir.mkdir(parents=True, exist_ok=True)
            tube_dirs[skel.track_id] = t_dir
            frame_maps[skel.track_id] = {f.frame_idx: f for f in skel.frames}
            saved_counts[skel.track_id] = 0

        # Prime MOG2 fallback with the background plate if seg is unavailable
        if not use_seg:
            self._prime_mog2_with_background_plate(camera_id, bg_plate_path)

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"[TubeExtractor] Cannot open video: {video_path}")
            return

        frame_idx = 0
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            # Update background model
            if not use_seg:
                self._get_mog2_for_camera(camera_id).apply(frame, learningRate=0.005)

            # Process every person present in this frame
            for skel in skeletons:
                if frame_idx in frame_maps[skel.track_id]:
                    f_meta = frame_maps[skel.track_id][frame_idx]
                    x, y, w, h = f_meta.bbox
                    h_img, w_img = frame.shape[:2]

                    # Clamp bbox to frame dimensions
                    x1, y1 = max(0, x), max(0, y)
                    x2, y2 = min(w_img, x + w), min(h_img, y + h)

                    crop = frame[y1:y2, x1:x2]
                    if crop.size > 0:
                        if use_seg:
                            alpha_mask = self._seg_alpha_mask(crop)
                        else:
                            alpha_mask = self._mog2_alpha_mask(frame, x1, y1, x2, y2, camera_id)

                        # Merge RGB + alpha into RGBA PNG
                        b, g, r = cv2.split(crop)
                        rgba = cv2.merge([b, g, r, alpha_mask])

                        t_dir = tube_dirs[skel.track_id]
                        out_path = t_dir / f"{frame_idx:06d}.png"
                        cv2.imwrite(str(out_path), rgba)

                        # Update FrameMeta with saved path
                        f_meta.mask_rel_path = str(out_path.relative_to(settings.STORAGE_DIR))
                        saved_counts[skel.track_id] += 1

            frame_idx += 1

        cap.release()

        # Write meta.json for all tubes
        for skel in skeletons:
            t_dir = tube_dirs[skel.track_id]
            logger.info(f"[TubeExtractor] {skel.track_id}: saved {saved_counts[skel.track_id]} RGBA frames → {t_dir}")
            self._write_meta_json(t_dir, skel)

    # ── Alpha Mask Generation ──────────────────────────────────────────────────

    def _seg_alpha_mask(self, crop: np.ndarray) -> np.ndarray:
        """
        PRIMARY: YOLOv8n-seg instance segmentation.
        Runs segmentation on the person crop and extracts the person mask.
        Applies 3px Gaussian blur to feather edges.
        """
        h, w = crop.shape[:2]
        try:
            res = self.seg_model(crop, verbose=False, device=settings.DEVICE)
            if res and len(res) > 0 and res[0].masks is not None:
                # Take first (primary) mask — the largest person in crop
                masks = res[0].masks.data.cpu().numpy()
                # Pick mask with largest area (most confident foreground)
                best_mask = max(masks, key=lambda m: m.sum())
                mask_resized = cv2.resize(best_mask, (w, h))
                mask_uint8 = (mask_resized * 255).astype(np.uint8)
                # 3px feather for smooth edge blending
                return cv2.GaussianBlur(mask_uint8, (3, 3), 0)
        except Exception as e:
            logger.debug(f"[TubeExtractor] Seg mask error: {e}")

        # YOLOv8-seg found nothing — fallback to full-crop alpha
        return self._feathered_rect_mask(h, w)

    def _mog2_alpha_mask(
        self,
        full_frame: np.ndarray,
        x1: int, y1: int, x2: int, y2: int,
        camera_id: str
    ) -> np.ndarray:
        """
        FALLBACK: MOG2 background subtraction.
        Applies the foreground mask from MOG2 on the full frame,
        then crops the person bbox region out of it.
        Applies morphological ops + 5px blur to clean up noise and feather edges.
        """
        h_crop = y2 - y1
        w_crop = x2 - x1

        try:
            subtractor = self._get_mog2_for_camera(camera_id)
            # getBackgroundImage returns the current learned background
            # We apply the current frame to get the foreground mask
            fg_mask = subtractor.apply(full_frame, learningRate=0)  # 0 = read-only, no update

            # Crop the person bbox region from the full foreground mask
            person_fg = fg_mask[y1:y2, x1:x2]

            # Morphological opening to remove small noise pixels
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            person_fg = cv2.morphologyEx(person_fg, cv2.MORPH_OPEN, kernel)
            # Dilation to fill small holes inside the person silhouette
            person_fg = cv2.dilate(person_fg, kernel, iterations=2)

            # 5px Gaussian blur to feather mask edges
            return cv2.GaussianBlur(person_fg, (5, 5), 0)

        except Exception as e:
            logger.debug(f"[TubeExtractor] MOG2 mask error: {e}")
            return self._feathered_rect_mask(h_crop, w_crop)

    @staticmethod
    def _feathered_rect_mask(h: int, w: int) -> np.ndarray:
        """
        Last-resort fallback: solid white rectangle with soft vignetted border.
        Used only when both YOLOv8-seg and MOG2 fail.
        """
        mask = np.full((h, w), 255, dtype=np.uint8)
        return cv2.GaussianBlur(mask, (7, 7), 0)

    # ── Metadata Writer ───────────────────────────────────────────────────────

    @staticmethod
    def _write_meta_json(tube_dir: Path, skeleton: TrackSkeleton):
        """
        Writes meta.json into the tube directory.
        Contains: track_id, camera_id, start_time, end_time, duration_s,
                  and per-frame original_timestamp, bbox, face_bbox, mask_rel_path.
        """
        meta = {
            "track_id":   skeleton.track_id,
            "camera_id":  skeleton.camera_id,
            "start_time": skeleton.start_time,
            "end_time":   skeleton.end_time,
            "duration_s": skeleton.duration_s,
            "best_face_bbox": skeleton.best_face_bbox,
            "frames": [
                {
                    "frame_idx":          f.frame_idx,
                    "original_timestamp": f.original_timestamp,
                    "bbox":               f.bbox,
                    "face_bbox":          f.face_bbox,
                    "mask_rel_path":      f.mask_rel_path,
                }
                for f in skeleton.frames
                if f.mask_rel_path is not None   # Only saved frames
            ]
        }
        meta_path = tube_dir / "meta.json"
        with open(meta_path, "w") as fp:
            json.dump(meta, fp, indent=2)
        logger.info(f"[TubeExtractor] Written tube metadata → {meta_path}")
