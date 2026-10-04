import cv2
import numpy as np
from pathlib import Path
import logging
from typing import List, Dict, Tuple, Optional
from app.config import settings
from app.db.models import TrackSkeleton, ScheduleItem
from app.engine.background_modeler import BackgroundModeler

logger = logging.getLogger(__name__)

class Compositor:
    def __init__(
        self,
        default_background_plate_path: str,
        plate_paths: Optional[Dict[str, str]] = None
    ):
        """
        Args:
            default_background_plate_path: Fallback plate if no bucketed match.
            plate_paths: Dict of { bucket_name → plate_path } from BackgroundModeler.
                         If provided, compositor selects the lighting-correct plate
                         per tube based on its original timestamp.
        """
        self.default_bg = cv2.imread(default_background_plate_path)
        if self.default_bg is None:
            raise ValueError(
                f"Failed to load background plate: {default_background_plate_path}"
            )
        self.plate_paths = plate_paths or {}
        self.height, self.width = self.default_bg.shape[:2]
        self._bg_cache = {}

    def _get_background_for_tube(self, tube_original_timestamp: str) -> np.ndarray:
        """Returns the lighting-correct background plate for this tube's time-of-day."""
        if self.plate_paths:
            plate_path = BackgroundModeler.select_plate_for_tube(
                self.plate_paths, tube_original_timestamp
            )
            if plate_path in self._bg_cache:
                return self._bg_cache[plate_path].copy()
            bg = cv2.imread(plate_path)
            if bg is not None:
                self._bg_cache[plate_path] = bg
                return bg.copy()
        return self.default_bg.copy()

    def render_synopsis_frame(
        self,
        current_time_s: float,
        schedule: List[ScheduleItem],
        tubes_map: Dict[str, TrackSkeleton],
        direction_start: Optional[List[float]] = None,
        direction_end: Optional[List[float]] = None
    ) -> np.ndarray:
        """
        Renders a single synopsis output frame at synopsis timeline position t_s.

        Steps:
          1. Find all tubes active at current_time_s.
          2. Sort them back-to-front by their bottom-Y coordinate (depth heuristic).
          3. For the dominant (frontmost) tube, pick the lighting-correct background plate.
          4. Alpha-blend each tube crop onto the canvas in depth order.
        """
        # Collect active tubes at this synopsis timestamp
        active_tubes: List[Tuple[float, TrackSkeleton, int, List[int], str]] = []

        for item in schedule:
            if item.synopsis_start_s <= current_time_s < item.synopsis_start_s + item.duration_s:
                tube = tubes_map.get(item.track_id)
                if not tube:
                    continue
                rel_s = current_time_s - item.synopsis_start_s
                if item.duration_s > 0:
                    progress = rel_s / item.duration_s
                    frame_idx_in_tube = int(progress * len(tube.frames))
                else:
                    frame_idx_in_tube = 0
                    
                if 0 <= frame_idx_in_tube < len(tube.frames):
                    f_meta = tube.frames[frame_idx_in_tube]
                    y_max = f_meta.bbox[1] + f_meta.bbox[3]
                    
                    # Smoothly fade in/out over 0.3 seconds to hide abrupt tracker cuts
                    fade_duration = 0.3
                    opacity = 1.0
                    if rel_s < fade_duration:
                        opacity = rel_s / fade_duration
                    elif item.duration_s - rel_s < fade_duration:
                        opacity = (item.duration_s - rel_s) / fade_duration
                        
                    active_tubes.append((
                        y_max,
                        tube,
                        frame_idx_in_tube,
                        f_meta.bbox,
                        f_meta.original_timestamp,
                        opacity
                    ))

        # Sort back-to-front (smaller y = further back in scene)
        active_tubes.sort(key=lambda item: item[0])

        # Select background plate based on the frontmost (last) tube's original timestamp
        if active_tubes:
            dominant_timestamp = active_tubes[-1][4]  # frontmost tube
            canvas = self._get_background_for_tube(dominant_timestamp)
        else:
            canvas = self.default_bg.copy()

        if direction_start and direction_end:
            h, w = canvas.shape[:2]
            p1 = (int(direction_start[0] * w), int(direction_start[1] * h))
            p2 = (int(direction_end[0] * w), int(direction_end[1] * h))
            self._draw_curved_arrow(canvas, p1, p2, color=(255, 255, 255), thickness=3, head_len=16)

        # Alpha-blend all active tubes onto canvas in depth order
        for _, tube, f_idx, bbox, orig_ts, opacity in active_tubes:
            x, y, w, h = bbox
            if tube.frames[f_idx].mask_rel_path:
                crop_path = settings.STORAGE_DIR / tube.frames[f_idx].mask_rel_path
                if crop_path.exists():
                    rgba_crop = cv2.imread(str(crop_path), cv2.IMREAD_UNCHANGED)
                    if rgba_crop is not None and rgba_crop.shape[2] == 4:
                        self._alpha_blend(canvas, rgba_crop, x, y, opacity)
                        
                        # Burn the timestamp directly into the video to prevent React UI lagging
                        time_str = orig_ts.split(" ")[1] if " " in orig_ts else orig_ts
                        
                        font = cv2.FONT_HERSHEY_SIMPLEX
                        font_scale = 0.6
                        thickness = 2
                        text_x = x + (w // 2) - 30
                        text_y = max(20, y - 10)
                        
                        if opacity > 0.1:
                            # Draw black outline for visibility
                            cv2.putText(canvas, time_str, (text_x, text_y), font, font_scale, (0, 0, 0), thickness + 1, cv2.LINE_AA)
                            # Draw white text
                            cv2.putText(canvas, time_str, (text_x, text_y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

        return canvas

    def _draw_curved_arrow(self, frame, p1, p2, color=(255, 255, 255), thickness=3, head_len=16):
        import math
        x1, y1 = p1
        x2, y2 = p2
        dx = x2 - x1
        dy = y2 - y1

        cx = x1 + dx * 0.5 + dy * 0.2
        cy = y1 + dy * 0.5 - dx * 0.2

        N = 60
        pts = []
        for i in range(N + 1):
            t = i / N
            bx = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2
            by = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2
            pts.append((int(round(bx)), int(round(by))))

        poly = np.array(pts, dtype=np.int32)
        cv2.polylines(frame, [poly], isClosed=False,
                      color=(0, 0, 0), thickness=thickness + 4,
                      lineType=cv2.LINE_AA)
        cv2.polylines(frame, [poly], isClosed=False,
                      color=color, thickness=thickness,
                      lineType=cv2.LINE_AA)

        tip_angle = math.atan2(y2 - cy, x2 - cx)
        spread = math.pi / 7

        lx = int(round(x2 - head_len * math.cos(tip_angle - spread)))
        ly = int(round(y2 - head_len * math.sin(tip_angle - spread)))
        rx = int(round(x2 - head_len * math.cos(tip_angle + spread)))
        ry = int(round(y2 - head_len * math.sin(tip_angle + spread)))

        head_pts = np.array([[x2, y2], [lx, ly], [rx, ry]], dtype=np.int32)
        cv2.fillPoly(frame, [head_pts], color=(0, 0, 0))
        cv2.polylines(frame, [head_pts], isClosed=True,
                      color=(0, 0, 0), thickness=2, lineType=cv2.LINE_AA)
        cv2.fillPoly(frame, [head_pts], color=color)

    def _alpha_blend(self, canvas: np.ndarray, rgba_crop: np.ndarray, x: int, y: int, opacity: float = 1.0):
        """Alpha blends an RGBA crop onto the canvas at target (x, y) coordinates."""
        h_crop, w_crop = rgba_crop.shape[:2]
        h_canv, w_canv = canvas.shape[:2]

        x1, y1 = max(0, x), max(0, y)
        x2, y2 = min(w_canv, x + w_crop), min(h_canv, y + h_crop)

        crop_x1, crop_y1 = x1 - x, y1 - y
        crop_x2, crop_y2 = crop_x1 + (x2 - x1), crop_y1 + (y2 - y1)

        if x2 > x1 and y2 > y1:
            overlay_bgr = rgba_crop[crop_y1:crop_y2, crop_x1:crop_x2, :3]
            alpha = (rgba_crop[crop_y1:crop_y2, crop_x1:crop_x2, 3] / 255.0)[:, :, np.newaxis] * opacity

            canvas[y1:y2, x1:x2] = (alpha * overlay_bgr + (1.0 - alpha) * canvas[y1:y2, x1:x2]).astype(np.uint8)
