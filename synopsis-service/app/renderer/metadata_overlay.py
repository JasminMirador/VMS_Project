import json
from pathlib import Path
import logging
from typing import List, Dict
from app.db.models import TrackSkeleton, ScheduleItem, SynopsisMetadataItem

logger = logging.getLogger(__name__)

class MetadataOverlayGenerator:
    @staticmethod
    def generate_sidecar(output_json_path: str, schedule: List[ScheduleItem], tubes_map: Dict[str, TrackSkeleton], total_synopsis_duration_s: float, fps: float = 25.0):
        """
        Generates an interactive JSON sidecar file mapping synopsis timeline frames 
        to raw footage timestamps and spatial bounding boxes for frontend interactivity.
        """
        metadata_items: List[Dict] = []
        total_frames = int(total_synopsis_duration_s * fps)

        for frame_idx in range(total_frames):
            syn_time_s = frame_idx / fps
            for item in schedule:
                if item.synopsis_start_s <= syn_time_s < item.synopsis_start_s + item.duration_s:
                    tube = tubes_map.get(item.track_id)
                    if tube:
                        rel_s = syn_time_s - item.synopsis_start_s
                        tube_frame_idx = int(rel_s * fps)
                        if 0 <= tube_frame_idx < len(tube.frames):
                            f_meta = tube.frames[tube_frame_idx]
                            metadata_items.append({
                                "synopsis_timestamp_s": round(syn_time_s, 2),
                                "track_id": item.track_id,
                                "original_timestamp": f_meta.original_timestamp,
                                "camera_id": tube.camera_id,
                                "bbox": f_meta.bbox,
                                "face_bbox": f_meta.face_bbox
                            })

        Path(output_json_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_json_path, "w") as f:
            json.dump({
                "total_duration_s": total_synopsis_duration_s,
                "fps": fps,
                "items": metadata_items
            }, f, indent=2)

        logger.info(f"Generated interactive metadata sidecar JSON at: {output_json_path}")
        return output_json_path
