import os
import logging
import cv2
from pathlib import Path
from datetime import datetime
import asyncio
from typing import List, Dict, Optional

from app.config import settings
from app.db.mongo import get_database
from app.db.models import TrackSkeleton
from app.engine.minio_reader import MinioEncryptedReader
from app.engine.detector_tracker import DetectorTracker
from app.engine.tube_extractor import TubeExtractor
from app.engine.tube_packer import TubePacker
from app.engine.background_modeler import BackgroundModeler
from app.renderer.compositor import Compositor
from app.renderer.video_encoder import VideoEncoder
from app.renderer.metadata_overlay import MetadataOverlayGenerator
from app.renderer.heatmap_generator import HeatmapGenerator

logger = logging.getLogger(__name__)

def _compositing_loop(output_mp4, width, height, fps, total_duration_s, schedule, tubes_map, default_plate_path, plate_paths, direction_start=None, direction_end=None):
    compositor = Compositor(default_plate_path, plate_paths=plate_paths)
    encoder = VideoEncoder(output_mp4, compositor.width, compositor.height, fps=fps)
    encoder.start()
    total_frames = int(total_duration_s * fps)
    for f_idx in range(total_frames):
        cur_time_s = f_idx / fps
        frame_bgr = compositor.render_synopsis_frame(
            cur_time_s, schedule, tubes_map,
            direction_start=direction_start, direction_end=direction_end
        )
        encoder.write_frame(frame_bgr)
    encoder.finish()

async def process_synopsis_job(job_id: str, camera_id: str, video_paths: List[str], direction_angle: Optional[float] = None, direction_tolerance: Optional[float] = 45.0, direction_start: Optional[List[float]] = None, direction_end: Optional[List[float]] = None):
    db = get_database()
    jobs_col = db["synopsis_jobs"]
    temp_decrypted_files: List[str] = []

    try:
        logger.info(f"Beginning processing for Synopsis Job [{job_id}] (Camera: {camera_id})...")
        
        stage_times = {
            "Decryption": {"start": datetime.now().astimezone().isoformat(), "end": None}
        }
        
        await jobs_col.update_one(
            {"job_id": job_id}, 
            {"$set": {
                "status": "processing", 
                "progress": 5.0,
                "started_at": datetime.now().astimezone().isoformat(),
                "stages": stage_times
            }}
        )

        minio_reader = MinioEncryptedReader()
        local_mp4_paths: List[str] = []
        
        sys_task_start = datetime.now()
        clip_details = [{
            "is_system": True,
            "task_name": "Decryption & Background Modeling",
            "timestamp": "Unknown",
            "camera_id": "system",
            "status": "processing",
            "objects_detected": "-",
            "time_taken_s": None
        }]
        await jobs_col.update_one({"job_id": job_id}, {"$set": {"clip_details": clip_details}})

        for vp in video_paths:
            if vp.startswith("minio:") or vp.endswith(".enc"):
                dec_path = await asyncio.to_thread(minio_reader.decrypt_minio_file_to_temp, vp)
                local_mp4_paths.append(dec_path)
                temp_decrypted_files.append(dec_path)
            else:
                local_mp4_paths.append(vp)

        stage_times["Decryption"]["end"] = datetime.now().astimezone().isoformat()
        stage_times["Background Modeling"] = {"start": datetime.now().astimezone().isoformat(), "end": None}
        await jobs_col.update_one({"job_id": job_id}, {"$set": {"progress": 15.0, "stages": stage_times}})

        video_paths_with_times = []
        for orig_vp, vp in zip(video_paths, local_mp4_paths):
            try:
                parts = orig_vp.replace("\\", "/").split("/")
                time_part = parts[-1].replace(".mp4", "").replace(".ts", "").replace(".enc", "")
                start_hour = int(time_part.split("-")[0])
            except Exception:
                start_hour = datetime.now().hour
            video_paths_with_times.append({"path": vp, "start_hour": start_hour})

        plate_paths = await asyncio.to_thread(BackgroundModeler.extract_bucketed_plates, video_paths_with_times, camera_id)
        default_plate_path = next(iter(plate_paths.values()))
        
        stage_times["Background Modeling"]["end"] = datetime.now().astimezone().isoformat()
        stage_times["Object Tracking"] = {"start": datetime.now().astimezone().isoformat(), "end": None}
        
        clip_details[0]["status"] = "completed"
        clip_details[0]["time_taken_s"] = round((datetime.now() - sys_task_start).total_seconds(), 2)
        await jobs_col.update_one({"job_id": job_id}, {"$set": {"progress": 30.0, "stages": stage_times, "clip_details": clip_details}})

        detector = DetectorTracker()
        all_tubes: List[TrackSkeleton] = []
        video_to_tubes: Dict[str, List[TrackSkeleton]] = {}
        job_doc = await jobs_col.find_one({"job_id": job_id})
        range_start_dt = None
        range_end_dt = None
        if job_doc and job_doc.get("range_start"):
            try:
                range_start_dt = datetime.fromisoformat(job_doc["range_start"])
                range_end_dt = datetime.fromisoformat(job_doc["range_end"])
            except:
                pass

        for orig_vp, vp in zip(video_paths, local_mp4_paths):
            # Extract exact start datetime from original MinIO filename (e.g. 14-23-55)
            # using the parent folder (e.g. 2026-09-11)
            video_start_dt = None
            try:
                parts = orig_vp.replace("\\", "/").split("/")
                if len(parts) >= 2:
                    date_str = parts[-2]
                    time_str = parts[-1].replace(".mp4", "").replace(".ts", "").replace(".enc", "").replace("-", ":")
                    video_start_dt = datetime.fromisoformat(f"{date_str}T{time_str}")
            except Exception:
                pass
                
            clip_start_time = datetime.now()
            current_clip_info = {
                "timestamp": video_start_dt.isoformat() if video_start_dt else "Unknown",
                "camera_id": camera_id,
                "status": "processing",
                "objects_detected": 0,
                "time_taken_s": None,
                "video_duration_s": None
            }
            # Fetch current job doc to append to clip_details safely
            job_doc_curr = await jobs_col.find_one({"job_id": job_id})
            clip_details = job_doc_curr.get("clip_details", [])
            clip_details.append(current_clip_info)
            await jobs_col.update_one({"job_id": job_id}, {"$set": {"clip_details": clip_details}})
            
            skels, video_duration_s = await asyncio.to_thread(detector.process_video_clip, vp, camera_id, video_start_dt, range_start_dt, range_end_dt)
            skel_list = list(skels.values())
            all_tubes.extend(skel_list)
            video_to_tubes[vp] = skel_list
            
            clip_end_time = datetime.now()
            
            from datetime import timedelta
            processed_dur_str = ""
            dur = 0
            if video_start_dt and video_duration_s:
                eff_start = video_start_dt
                if range_start_dt and eff_start < range_start_dt:
                    eff_start = range_start_dt
                eff_end = video_start_dt + timedelta(seconds=video_duration_s)
                if range_end_dt and eff_end > range_end_dt:
                    eff_end = range_end_dt
                dur = (eff_end - eff_start).total_seconds()
                if dur > 0:
                    h = int(dur // 3600)
                    m = int((dur % 3600) // 60)
                    s = int(dur % 60)
                    processed_dur_str = f"{h:02d}:{m:02d}:{s:02d} (from {eff_start.strftime('%H:%M:%S')} to {eff_end.strftime('%H:%M:%S')})"
                else:
                    processed_dur_str = "00:00:00 (skipped)"

            clip_details[-1]["status"] = "completed"
            clip_details[-1]["objects_detected"] = len(skel_list)
            clip_details[-1]["time_taken_s"] = round((clip_end_time - clip_start_time).total_seconds(), 2)
            clip_details[-1]["video_duration_s"] = round(video_duration_s, 2)
            clip_details[-1]["processed_duration_str"] = processed_dur_str
            clip_details[-1]["processed_duration_s"] = int(dur) if dur > 0 else 0
            await jobs_col.update_one({"job_id": job_id}, {"$set": {"clip_details": clip_details}})

        # Apply Directional Filtering
        if direction_angle is None and direction_start and direction_end:
            import math
            dx = direction_end[0] - direction_start[0]
            dy = direction_end[1] - direction_start[1]
            direction_angle = math.degrees(math.atan2(dy, dx))
            
        if direction_angle is not None:
            import math
            filtered_tubes = []
            filtered_video_to_tubes = {vp: [] for vp in video_to_tubes}
            tol = direction_tolerance if direction_tolerance is not None else 45.0
            
            for tube in all_tubes:
                if len(tube.frames) > 0:
                    first_bbox = tube.frames[0].bbox
                    last_bbox = tube.frames[-1].bbox
                    
                    x1 = first_bbox[0] + first_bbox[2]/2
                    y1 = first_bbox[1] + first_bbox[3]/2
                    x2 = last_bbox[0] + last_bbox[2]/2
                    y2 = last_bbox[1] + last_bbox[3]/2
                    
                    angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
                    diff = (angle - direction_angle + 180) % 360 - 180
                    
                    if abs(diff) <= tol:
                        filtered_tubes.append(tube)
                        for vp, t_list in video_to_tubes.items():
                            if tube in t_list:
                                filtered_video_to_tubes[vp].append(tube)
                                break
                                
            logger.info(f"Directional filter applied: {len(all_tubes)} total tracks -> {len(filtered_tubes)} matching direction {direction_angle}° (±{tol}°)")
            all_tubes = filtered_tubes
            video_to_tubes = filtered_video_to_tubes

        if not all_tubes:
            raise ValueError("No valid person trajectories detected in requested video range.")

        del detector
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

        stage_times["Object Tracking"]["end"] = datetime.now().astimezone().isoformat()
        stage_times["Tube Extraction"] = {"start": datetime.now().astimezone().isoformat(), "end": None}
        
        job_doc_curr = await jobs_col.find_one({"job_id": job_id})
        clip_details = job_doc_curr.get("clip_details", [])
        clip_details.append({
            "is_system": True,
            "task_name": "Tube Extraction",
            "timestamp": "Unknown",
            "camera_id": "system",
            "status": "processing",
            "objects_detected": "-",
            "time_taken_s": None
        })
        
        await jobs_col.update_one({"job_id": job_id}, {"$set": {"progress": 50.0, "stages": stage_times, "clip_details": clip_details}})

        extractor = TubeExtractor()
        for vp, tubes_for_video in video_to_tubes.items():
            if tubes_for_video:
                await asyncio.to_thread(extractor.extract_all_tubes_for_video, vp, tubes_for_video, bg_plate_path=default_plate_path)

        del extractor
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

        stage_times["Tube Extraction"]["end"] = datetime.now().astimezone().isoformat()
        stage_times["Final Compilation"] = {"start": datetime.now().astimezone().isoformat(), "end": None}
        
        job_doc_curr = await jobs_col.find_one({"job_id": job_id})
        clip_details = job_doc_curr.get("clip_details", [])
        if clip_details and clip_details[-1]["task_name"] == "Tube Extraction":
            clip_details[-1]["status"] = "completed"
            clip_details[-1]["time_taken_s"] = round((datetime.now().astimezone() - datetime.fromisoformat(stage_times["Tube Extraction"]["start"])).total_seconds(), 2)

        final_sys_task_start = datetime.now()
        clip_details.append({
            "is_system": True,
            "task_name": "Final Compilation",
            "timestamp": "Unknown",
            "camera_id": "system",
            "status": "processing",
            "objects_detected": "-",
            "time_taken_s": None
        })
        
        await jobs_col.update_one({"job_id": job_id}, {"$set": {"progress": 70.0, "stages": stage_times, "clip_details": clip_details}})

        packer = TubePacker()
        _plate_img = cv2.imread(default_plate_path)
        _frame_h, _frame_w = _plate_img.shape[:2] if _plate_img is not None else (1080, 1920)
        schedule = await asyncio.to_thread(
            packer.compute_schedule, all_tubes,
            frame_width=_frame_w, frame_height=_frame_h
        )
        tubes_map = {t.track_id: t for t in all_tubes}

        forensic_col = db["forensic_index"]
        forensic_docs = []
        for tube in all_tubes:
            for f in tube.frames[::5]:
                forensic_docs.append({
                    "detection_id": f"det_syn_{tube.track_id}_{f.frame_idx}",
                    "track_id": tube.track_id,
                    "camera_id": camera_id,
                    "timestamp": f.original_timestamp,
                    "bbox": f.bbox,
                    "face_bbox": f.face_bbox,
                    "mask_rel_path": f.mask_rel_path,
                    "synopsis_job_id": job_id
                })
        if forensic_docs:
            await forensic_col.insert_many(forensic_docs)
            logger.info(f"Persisted {len(forensic_docs)} trajectory records.")

        tubes_col = db["tubes_index"]
        tube_docs = []
        for tube in all_tubes:
            tube_docs.append({
                "track_id": tube.track_id,
                "camera_id": camera_id,
                "start": tube.start_time,
                "end": tube.end_time,
                "duration_s": tube.duration_s,
                "synopsis_job_id": job_id
            })
        if tube_docs:
            for doc in tube_docs:
                await tubes_col.update_one(
                    {"track_id": doc["track_id"]},
                    {"$set": doc},
                    upsert=True
                )

        max_synopsis_start = max(item.synopsis_start_s + item.duration_s for item in schedule) if schedule else 10.0
        total_duration_s = round(max_synopsis_start, 2)

        output_mp4 = str(settings.OUTPUT_DIR / f"synopsis_{job_id}.mp4")
        
        await asyncio.to_thread(
            _compositing_loop, 
            output_mp4, 1920, 1080, 25.0, 
            total_duration_s, schedule, tubes_map, 
            default_plate_path, plate_paths,
            direction_start, direction_end
        )

        metadata_path = str(settings.OUTPUT_DIR / f"synopsis_{job_id}_meta.json")
        await asyncio.to_thread(MetadataOverlayGenerator.generate_sidecar, metadata_path, schedule, tubes_map, total_duration_s)

        heatmap_path = str(settings.OUTPUT_DIR / f"synopsis_{job_id}_heatmap.png")
        # Get width and height from the default plate for heatmap dimensions
        bg_plate = cv2.imread(default_plate_path)
        h_h, h_w = bg_plate.shape[:2] if bg_plate is not None else (1080, 1920)
        await asyncio.to_thread(HeatmapGenerator.generate, all_tubes, h_w, h_h, heatmap_path, default_plate_path)

        original_dur = 0.0
        for vp in local_mp4_paths:
            try:
                cap = cv2.VideoCapture(vp)
                if cap.isOpened():
                    fps_val = cap.get(cv2.CAP_PROP_FPS)
                    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                    if fps_val > 0:
                        original_dur += frame_count / fps_val
                cap.release()
            except Exception:
                pass
        if original_dur <= 0:
            original_dur = total_duration_s * 5.0

        out_rel_mp4 = f"/static/synopsis/outputs/synopsis_{job_id}.mp4"
        out_rel_meta = f"/static/synopsis/outputs/synopsis_{job_id}_meta.json"
        out_rel_heatmap = f"/static/synopsis/outputs/synopsis_{job_id}_heatmap.png"

        stage_times["Final Compilation"]["end"] = datetime.now().astimezone().isoformat()
        if clip_details:
            clip_details[-1]["status"] = "completed"
            clip_details[-1]["time_taken_s"] = round((datetime.now() - final_sys_task_start).total_seconds(), 2)

        await jobs_col.update_one(
            {"job_id": job_id}, 
            {"$set": {
                "status": "completed", 
                "progress": 100.0,
                "clip_details": clip_details,
                "completed_at": datetime.now().astimezone().isoformat(),
                "stages": stage_times,
                "output_video_url": out_rel_mp4,
                "metadata_sidecar_url": out_rel_meta,
                "heatmap_url": out_rel_heatmap,
                "objects": [t.track_id for t in all_tubes],
                "metrics": {
                    "original_duration_s": original_dur,
                    "synopsis_duration_s": total_duration_s,
                    "compression_ratio": round(original_dur / total_duration_s, 2) if total_duration_s > 0 else 1.0,
                    "total_objects": len(all_tubes)
                }
            }}
        )
        logger.info(f"Successfully finished Synopsis Job [{job_id}] -> {output_mp4}")

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        logger.error(f"Error processing Synopsis Job [{job_id}]: {e}", exc_info=True)
        
        job_doc = await jobs_col.find_one({"job_id": job_id})
        clip_details = job_doc.get("clip_details", []) if job_doc else []
        if clip_details and clip_details[-1].get("status") == "processing":
            clip_details[-1]["status"] = "failed"
            
        await jobs_col.update_one({"job_id": job_id}, {"$set": {
            "status": "failed",
            "clip_details": clip_details,
            "error_message": f"{str(e)} | TB: {tb}",
            "completed_at": datetime.now().astimezone().isoformat()
        }})
    finally:
        for tmp_f in temp_decrypted_files:
            try:
                if os.path.exists(tmp_f):
                    os.remove(tmp_f)
                    logger.info(f"Cleaned up temp decrypted file: {tmp_f}")
            except Exception as cleanup_err:
                logger.warning(f"Failed to remove temp file [{tmp_f}]: {cleanup_err}")

async def process_face_job(job_id: str, camera_map: Dict[str, str], video_paths: List[str], range_start: str, range_end: str):
    db = get_database()
    jobs_col = db["face_jobs"]
    temp_decrypted_files: List[str] = []

    try:
        logger.info(f"Beginning processing for Face Job [{job_id}] (Cameras: {list(camera_map.values())})...")
        
        await jobs_col.update_one(
            {"job_id": job_id}, 
            {"$set": {
                "status": "processing", 
                "progress": 5.0,
                "started_at": datetime.now().astimezone().isoformat()
            }}
        )

        minio_reader = MinioEncryptedReader()
        local_mp4_paths: List[str] = []
        clip_details = []
        
        # System task for decryption
        decryption_start = datetime.now()
        clip_details.append({
            "is_system": True,
            "task_name": "Initialization & Decryption",
            "timestamp": "Unknown",
            "camera_id": "system",
            "status": "processing",
            "faces_detected": "-",
            "time_taken_s": None
        })
        await jobs_col.update_one({"job_id": job_id}, {"$set": {"clip_details": clip_details}})

        for vp in video_paths:
            if vp.startswith("minio:") or vp.endswith(".enc"):
                dec_path = await asyncio.to_thread(minio_reader.decrypt_minio_file_to_temp, vp)
                local_mp4_paths.append(dec_path)
                temp_decrypted_files.append(dec_path)
            else:
                local_mp4_paths.append(vp)
                
        clip_details[0]["status"] = "completed"
        clip_details[0]["time_taken_s"] = round((datetime.now() - decryption_start).total_seconds(), 2)

        await jobs_col.update_one({"job_id": job_id}, {"$set": {"progress": 30.0, "clip_details": clip_details}})

        detector = DetectorTracker()
        all_tubes: List[TrackSkeleton] = []
        range_start_dt = datetime.fromisoformat(range_start) if range_start else None
        range_end_dt = datetime.fromisoformat(range_end) if range_end else None
        total_video_duration_s = 0.0

        from app.config import settings
        face_thumbs_dir = str(settings.FACE_THUMBS_DIR)
        
        total_clips = len(video_paths)
        for idx, (orig_vp, vp) in enumerate(zip(video_paths, local_mp4_paths)):
            video_start_dt = None
            try:
                parts = orig_vp.replace("\\", "/").split("/")
                if len(parts) >= 2:
                    date_str = parts[-2]
                    time_str = parts[-1].replace(".mp4", "").replace(".ts", "").replace(".enc", "").replace("-", ":")
                    video_start_dt = datetime.fromisoformat(f"{date_str}T{time_str}")
            except Exception:
                pass
                
            # Resolve correct camera_id for this clip
            current_cam_id = list(camera_map.values())[0] if camera_map else "unknown"
            for sk, cid in camera_map.items():
                if f"/{sk}/" in orig_vp.replace("\\", "/"):
                    current_cam_id = cid
                    break
                
            base_prog = 30.0 + (idx / total_clips) * 40.0
            step_prog = 40.0 / total_clips
                
            logger.info(f"DEBUG: Processing {vp} (orig: {orig_vp}) | camera_id: {current_cam_id} | video_start: {video_start_dt} | range_start: {range_start_dt} | range_end: {range_end_dt}")
            
            clip_start_process_time = datetime.now()
            # Check for cancellation
            job_state = await jobs_col.find_one({"job_id": job_id})
            if job_state and job_state.get("status") == "cancelled":
                logger.info(f"Job {job_id} was cancelled by user. Stopping worker.")
                return

            # Update DB with current processing clip
            current_clip_info = {
                "timestamp": video_start_dt.isoformat() if video_start_dt else "Unknown",
                "camera_id": current_cam_id,
                "status": "processing",
                "start_process_time": clip_start_process_time.isoformat(),
                "faces_detected": 0,
                "time_taken_s": None
            }
            clip_details.append(current_clip_info)
            await jobs_col.update_one({"job_id": job_id}, {"$set": {"clip_details": clip_details}})
            
            skels, video_duration_s = await asyncio.to_thread(
                detector.process_video_clip, vp, current_cam_id,
                video_start_dt, range_start_dt, range_end_dt,
                face_thumbs_dir, job_id, base_prog, step_prog
            )
            logger.info(f"DEBUG: Returned {len(skels)} skeletons for clip {vp}")
            
            skel_list = list(skels.values())
            all_tubes.extend(skel_list)
            
            clip_end_process_time = datetime.now()
            time_taken_s = (clip_end_process_time - clip_start_process_time).total_seconds()
            
            from datetime import timedelta
            processed_dur_str = ""
            dur = 0
            if video_start_dt and video_duration_s:
                eff_start = video_start_dt
                if range_start_dt and eff_start < range_start_dt:
                    eff_start = range_start_dt
                eff_end = video_start_dt + timedelta(seconds=video_duration_s)
                if range_end_dt and eff_end > range_end_dt:
                    eff_end = range_end_dt
                dur = (eff_end - eff_start).total_seconds()
                if dur > 0:
                    h = int(dur // 3600)
                    m = int((dur % 3600) // 60)
                    s = int(dur % 60)
                    processed_dur_str = f"{h:02d}:{m:02d}:{s:02d} (from {eff_start.strftime('%H:%M:%S')} to {eff_end.strftime('%H:%M:%S')})"
                else:
                    processed_dur_str = "00:00:00 (skipped)"
            
            # Update clip details with completion
            clip_details[-1]["status"] = "completed"
            clip_details[-1]["faces_detected"] = len(skel_list)
            clip_details[-1]["time_taken_s"] = round(time_taken_s, 2)
            clip_details[-1]["video_duration_s"] = round(video_duration_s, 2)
            clip_details[-1]["processed_duration_str"] = processed_dur_str
            clip_details[-1]["processed_duration_s"] = int(dur) if dur > 0 else 0
            total_video_duration_s += video_duration_s
            
            # Ensure it reaches exactly the end of this clip's chunk
            await jobs_col.update_one({"job_id": job_id}, {"$set": {"progress": base_prog + step_prog, "clip_details": clip_details}})

        del detector
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

        dedup_start = datetime.now()
        clip_details.append({
            "is_system": True,
            "task_name": "Deduplication & Finalizing",
            "timestamp": "Unknown",
            "camera_id": "system",
            "status": "processing",
            "faces_detected": "-",
            "time_taken_s": None
        })
        await jobs_col.update_one({"job_id": job_id}, {"$set": {"progress": 70.0, "clip_details": clip_details}})

        # Build faces list from pre-saved thumbnail paths in TrackSkeleton
        faces = []
        for tube in all_tubes:
            if not tube.frames:
                continue
            # Use thumbnail_path that was saved to disk during detection (no re-seeking needed)
            if tube.thumbnail_path:
                ts = tube.best_original_timestamp or tube.frames[0].original_timestamp
                faces.append({
                    "track_id": tube.track_id,
                    "camera_id": tube.camera_id,
                    "timestamp": ts,
                    "bbox": tube.frames[0].bbox,
                    "face_bbox": tube.best_face_bbox or tube.frames[0].face_bbox,
                    "thumbnail_path": tube.thumbnail_path,
                })

        # ── Deduplicate same person appearing across multiple clips ──────────────
        # ByteTrack resets between .enc clips so the same person gets multiple track IDs.
        # Compare face histograms: if two thumbnails are >80% similar, keep the one
        # with the larger face bbox (sharper / more frontal view).
        import cv2 as _cv2
        import os as _os

        def _face_hist(path):
            """Compute a normalised HSV histogram for a face thumbnail."""
            try:
                # path is like /face-static/filename.jpg, we need the local disk path
                basename = path.split("/")[-1]
                disk_path = _os.path.join(face_thumbs_dir, basename)
                
                img = _cv2.imread(disk_path)
                if img is None:
                    return None
                hsv = _cv2.cvtColor(img, _cv2.COLOR_BGR2HSV)
                hist = _cv2.calcHist([hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
                _cv2.normalize(hist, hist)
                return hist
            except Exception:
                return None

        SIMILARITY_THRESHOLD = 0.82  # >82% histogram correlation → same person
        kept = []          # indices of faces we keep
        dropped = set()    # indices we remove as duplicates

        histograms = [_face_hist(f["thumbnail_path"]) for f in faces]

        for i in range(len(faces)):
            if i in dropped:
                continue
            for j in range(i + 1, len(faces)):
                if j in dropped:
                    continue
                h1, h2 = histograms[i], histograms[j]
                if h1 is None or h2 is None:
                    continue
                score = _cv2.compareHist(h1, h2, _cv2.HISTCMP_CORREL)
                if score >= SIMILARITY_THRESHOLD:
                    # Keep the face with the larger bbox area (better quality)
                    area_i = (faces[i].get("face_bbox") or [0, 0, 0, 0])[2] * (faces[i].get("face_bbox") or [0, 0, 0, 0])[3]
                    area_j = (faces[j].get("face_bbox") or [0, 0, 0, 0])[2] * (faces[j].get("face_bbox") or [0, 0, 0, 0])[3]
                    if area_i >= area_j:
                        dropped.add(j)
                        # Clean up the duplicate thumbnail file
                        try:
                            _os.remove(faces[j]["thumbnail_path"])
                        except Exception:
                            pass
                    else:
                        dropped.add(i)
                        try:
                            _os.remove(faces[i]["thumbnail_path"])
                        except Exception:
                            pass
                        break  # face i is dropped, no need to compare further

        faces = [f for idx, f in enumerate(faces) if idx not in dropped]
        logger.info(f"After dedup: {len(faces)} unique faces (removed {len(dropped)} duplicates).")
        # ─────────────────────────────────────────────────────────────────────────

        clip_details[-1]["status"] = "completed"
        clip_details[-1]["time_taken_s"] = round((datetime.now() - dedup_start).total_seconds(), 2)

        await jobs_col.update_one(
            {"job_id": job_id}, 
            {"$set": {
                "status": "completed", 
                "progress": 100.0,
                "clip_details": clip_details,
                "total_video_duration_s": round(total_video_duration_s, 2),
                "completed_at": datetime.now().astimezone().isoformat(),
                "faces": faces
            }}
        )
        logger.info(f"Successfully finished Face Job [{job_id}] with {len(faces)} faces.")

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        logger.error(f"Error processing Face Job [{job_id}]: {e}", exc_info=True)
        
        job_doc = await jobs_col.find_one({"job_id": job_id})
        clip_details = job_doc.get("clip_details", []) if job_doc else []
        if clip_details and clip_details[-1].get("status") == "processing":
            clip_details[-1]["status"] = "failed"
            
        await jobs_col.update_one({"job_id": job_id}, {"$set": {
            "status": "failed",
            "clip_details": clip_details,
            "error_message": f"{str(e)} | TB: {tb}",
            "completed_at": datetime.now().astimezone().isoformat()
        }})
    finally:
        for tmp_f in temp_decrypted_files:
            try:
                if os.path.exists(tmp_f):
                    os.remove(tmp_f)
                    logger.info(f"Cleaned up temp decrypted file: {tmp_f}")
            except Exception as cleanup_err:
                logger.warning(f"Failed to remove temp file [{tmp_f}]: {cleanup_err}")