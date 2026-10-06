from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from uuid import uuid4
from pathlib import Path
from app.db.mongo import get_database
from app.db.models import (
    SynopsisJobCreate, SynopsisJobResponse, 
    SynopsisSearchRequest, SynopsisSearchResponse, SynopsisJobUpdate, TubeSummary
)
from app.worker import process_synopsis_job
from app.config import settings

router = APIRouter(prefix="/a1/v1/synopsis", tags=["Video Synopsis"])

from typing import Union, List, Optional

@router.post("/jobs", response_model=Union[SynopsisJobResponse, List[SynopsisJobResponse]])
async def create_synopsis_job(payload: SynopsisJobCreate, background_tasks: BackgroundTasks):
    db = get_database()
    jobs_col = db["synopsis_jobs"]

    if isinstance(payload.camera_id, list):
        camera_ids = payload.camera_id
    else:
        camera_ids = [payload.camera_id]

    # One group_id per "Generate Synopsis" request, shared by every sibling
    # job (one job per camera). This is what lets the frontend later fetch
    # ENTRY + EXIT together and show a merged breakdown, instead of only
    # ever being able to see whichever single job_id it happened to fetch.
    group_id = f"grp_{uuid4().hex[:8]}"

    created_jobs = []

    for cam_id in camera_ids:
        # Fetch stream_key from the main vms_db using the provided camera_id
        stream_key = cam_id
        try:
            from bson import ObjectId
            vms_db = db.client["vms_db"]
            camera_doc = await vms_db.cameras.find_one({"_id": ObjectId(cam_id)})
            if camera_doc and "stream_key" in camera_doc:
                stream_key = camera_doc["stream_key"]
        except Exception as e:
            print(f"Error fetching stream_key: {e}")

        job_id = f"syn_{uuid4().hex[:8]}"
        
        video_files = []
        try:
            from app.engine.minio_reader import MinioEncryptedReader
            from datetime import datetime, timedelta

            reader = MinioEncryptedReader()
            if reader.minio_client:
                start_dt = datetime.fromisoformat(payload.range_start) - timedelta(minutes=5)
                end_dt = datetime.fromisoformat(payload.range_end) + timedelta(minutes=5)

                # Build list of date strings that fall within the range (e.g. ["2026-09-21", "2026-09-22"])
                date_set = set()
                cur = start_dt
                while cur <= end_dt:
                    date_set.add(cur.strftime("%Y-%m-%d"))
                    cur += timedelta(days=1)

                # Walk: root/ -> shard/ -> stream_key/ -> date/ -> HH-MM-SS.enc
                # We jump directly to the date folders, skipping everything else
                roots = reader.minio_client.list_objects(reader.bucket, recursive=False)
                for r in roots:
                    if not r.is_dir:
                        continue
                    shards = reader.minio_client.list_objects(reader.bucket, prefix=r.object_name, recursive=False)
                    for s in shards:
                        if not s.is_dir:
                            continue
                        for date_str in date_set:
                            date_prefix = f"{s.object_name}{stream_key}/{date_str}/"
                            day_objs = reader.minio_client.list_objects(reader.bucket, prefix=date_prefix, recursive=False)
                            for obj in day_objs:
                                if not obj.object_name.endswith(".enc"):
                                    continue
                                # Parse time from filename: HH-MM-SS.enc
                                fname = obj.object_name.split("/")[-1].replace(".enc", "").replace("-", ":")
                                try:
                                    file_dt = datetime.fromisoformat(f"{date_str}T{fname}")
                                    if start_dt <= file_dt <= end_dt:
                                        video_files.append(f"minio:{obj.object_name}")
                                except ValueError:
                                    pass
        except Exception as e:
            print(f"MinIO fetch error: {e}")

        if not video_files:
            continue

        total_clips_by_camera = {cam_id: len(video_files)}
        from datetime import datetime

        job_doc = {
            "job_id": job_id,
            "job_name": payload.job_name if payload.job_name else job_id,
            "description": payload.description,
            "incident_time": payload.incident_time,
            "camera_id": cam_id,
            "group_id": group_id,
            "range_start": payload.range_start,
            "range_end": payload.range_end,
            "direction_angle": payload.direction_angle,
            "direction_tolerance": payload.direction_tolerance,
            "direction_start": payload.direction_start,
            "direction_end": payload.direction_end,
            "status": "queued",
            "progress": 0.0,
            "clip_details": [],
            "total_clips": len(video_files),
            "total_clips_by_camera": total_clips_by_camera,
            "objects": [],
            "output_video_url": None,
            "metadata_sidecar_url": None,
            "error_message": None,
            "created_at": datetime.now().astimezone().isoformat()
        }
        
        await jobs_col.insert_one(job_doc.copy())
        
        # Trigger background worker pipeline natively
        background_tasks.add_task(
            process_synopsis_job, 
            job_id, 
            cam_id, 
            [str(v) for v in video_files],
            payload.direction_angle,
            payload.direction_tolerance,
            payload.direction_start,
            payload.direction_end
        )

        created_jobs.append(job_doc)

    if not created_jobs:
        raise HTTPException(status_code=404, detail="No recorded clips found for the selected cameras in the time range.")

    if isinstance(payload.camera_id, list):
        return [SynopsisJobResponse(**job) for job in created_jobs]
    return SynopsisJobResponse(**created_jobs[0])

@router.get("/jobs", response_model=list[SynopsisJobResponse])
async def list_synopsis_jobs(group_id: Optional[str] = None):
    db = get_database()
    jobs_col = db["synopsis_jobs"]
    
    query = {"group_id": group_id} if group_id else {}
    cursor = jobs_col.find(query).sort("_id", -1).limit(100)
    jobs = await cursor.to_list(length=100)
    return [SynopsisJobResponse(**job) for job in jobs]

@router.get("/jobs/{job_id}", response_model=SynopsisJobResponse)
async def get_synopsis_job(job_id: str):
    db = get_database()
    jobs_col = db["synopsis_jobs"]
    
    job = await jobs_col.find_one({"job_id": job_id})
    if not job:
        raise HTTPException(status_code=404, detail=f"Synopsis Job [{job_id}] not found.")
        
    return SynopsisJobResponse(**job)

@router.patch("/jobs/{job_id}", response_model=SynopsisJobResponse)
async def update_synopsis_job(job_id: str, payload: SynopsisJobUpdate):
    db = get_database()
    jobs_col = db["synopsis_jobs"]
    
    job = await jobs_col.find_one({"job_id": job_id})
    if not job:
        raise HTTPException(status_code=404, detail=f"Synopsis Job [{job_id}] not found.")
        
    from datetime import datetime, timezone, timedelta
    ist = timezone(timedelta(hours=5, minutes=30))
    now_ist = datetime.now(ist).isoformat()
    
    await jobs_col.update_one({"job_id": job_id}, {"$set": {"job_name": payload.job_name, "description": getattr(payload, "description", None), "incident_time": getattr(payload, "incident_time", None), "updated_at": now_ist}})
    job["job_name"] = payload.job_name
    job["updated_at"] = now_ist
    return SynopsisJobResponse(**job)

@router.post("/search", response_model=SynopsisSearchResponse)
async def search_tubes(payload: SynopsisSearchRequest):
    """
    Search for candidate tubes (people/movements) available within a requested time range.
    Returns metadata about the tracks without running the full video compilation.
    """
    db = get_database()
    tubes_col = db["tubes_index"]
    
    # Query tubes matching the camera_id. 
    # In a real implementation, we would parse ISO dates and compare timestamps.
    # For now, string comparison works if the start/end times are properly formatted.
    query = {
        "camera_id": payload.camera_id,
        "start": {"$gte": payload.start},
        "end": {"$lte": payload.end}
    }
    
    cursor = tubes_col.find(query)
    tubes = []
    
    async for doc in cursor:
        tubes.append(TubeSummary(
            track_id=doc["track_id"],
            start=doc["start"],
            end=doc["end"],
            duration_s=doc["duration_s"]
        ))
        
@router.get("/raw_clip")
async def get_raw_clip(camera_id: str, timestamp: str):
    from fastapi.responses import FileResponse
    from app.engine.minio_reader import MinioEncryptedReader
    from datetime import datetime
    import os

    reader = MinioEncryptedReader()
    if not reader.minio_client:
        raise HTTPException(status_code=500, detail="MinIO client not initialized")

    try:
        req_dt = datetime.fromisoformat(timestamp.replace(" ", "T"))
    except:
        raise HTTPException(status_code=400, detail="Invalid timestamp format")

    def get_camera_files(reader, stream_key):
        files = []
        roots = reader.minio_client.list_objects(reader.bucket, recursive=False)
        for r in roots:
            if r.is_dir:
                shards = reader.minio_client.list_objects(reader.bucket, prefix=r.object_name, recursive=False)
                for s in shards:
                    if s.is_dir:
                        cam_prefix = f"{s.object_name}{stream_key}/"
                        cam_objs = reader.minio_client.list_objects(reader.bucket, prefix=cam_prefix, recursive=True)
                        for c in cam_objs:
                            if c.object_name.endswith(".enc"):
                                files.append(c.object_name)
        return files

    db = get_database()
    stream_key = camera_id
    try:
        from bson import ObjectId
        vms_db = db.client["vms_db"]
        camera_doc = await vms_db.cameras.find_one({"_id": ObjectId(camera_id)})
        if camera_doc and "stream_key" in camera_doc:
            stream_key = camera_doc["stream_key"]
    except Exception as e:
        pass

    all_enc_files = get_camera_files(reader, stream_key)

    target_file = None
    target_dt = None
    
    for f in all_enc_files:
        if f"/{stream_key}/" not in f"/{f}":
            continue
        parts = f.replace("\\", "/").split("/")
        if len(parts) >= 2:
            date_str = parts[-2]
            time_str = parts[-1].replace(".enc", "").replace("-", ":")
            try:
                file_dt = datetime.fromisoformat(f"{date_str}T{time_str}")
                if file_dt <= req_dt:
                    if target_dt is None or file_dt > target_dt:
                        target_dt = file_dt
                        target_file = f
            except Exception:
                pass

    if not target_file:
        raise HTTPException(status_code=404, detail="No raw video found for this timestamp")

    try:
        import asyncio
        dec_path = await asyncio.to_thread(reader.decrypt_minio_file_to_temp, target_file)
        # Serve the raw .ts file (MPEG-TS). 
        # Using video/mp4 MIME type sometimes tricks browsers into playing raw H264 streams
        return FileResponse(dec_path, media_type="video/mp4")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/event-playback")
async def get_event_playback_clip_url(camera_id: str, timestamp: str, request: Request):
    """
    Returns a JSON with clipUrl that points to the actual video stream endpoint.
    This mimics the onvif-backend behavior for the frontend.
    """
    import urllib.parse
    encoded_time = urllib.parse.quote(timestamp)
    base_url = str(request.base_url).rstrip("/")
    clip_url = f"{base_url}/a1/v1/synopsis/event-playback/video?camera_id={camera_id}&timestamp={encoded_time}"
    return {"clipUrl": clip_url}

@router.get("/event-playback/video")
async def get_event_playback_video(camera_id: str, timestamp: str, background_tasks: BackgroundTasks):
    from fastapi.responses import FileResponse
    from app.engine.minio_reader import MinioEncryptedReader
    from datetime import datetime
    import os, tempfile, subprocess

    reader = MinioEncryptedReader()
    if not reader.minio_client:
        raise HTTPException(status_code=500, detail="MinIO client not initialized")

    try:
        req_dt = datetime.fromisoformat(timestamp.replace(" ", "T"))
    except:
        raise HTTPException(status_code=400, detail="Invalid timestamp format")

    def get_camera_files(reader, stream_key):
        files = []
        roots = reader.minio_client.list_objects(reader.bucket, recursive=False)
        for r in roots:
            if r.is_dir:
                shards = reader.minio_client.list_objects(reader.bucket, prefix=r.object_name, recursive=False)
                for s in shards:
                    if s.is_dir:
                        cam_prefix = f"{s.object_name}{stream_key}/"
                        cam_objs = reader.minio_client.list_objects(reader.bucket, prefix=cam_prefix, recursive=True)
                        for c in cam_objs:
                            if c.object_name.endswith(".enc"):
                                files.append(c.object_name)
        return files

    db = get_database()
    stream_key = camera_id
    try:
        from bson import ObjectId
        vms_db = db.client["vms_db"]
        camera_doc = await vms_db.cameras.find_one({"_id": ObjectId(camera_id)})
        if camera_doc and "stream_key" in camera_doc:
            stream_key = camera_doc["stream_key"]
    except Exception as e:
        pass

    all_enc_files = get_camera_files(reader, stream_key)

    target_file = None
    target_dt = None
    
    for f in all_enc_files:
        if f"/{stream_key}/" not in f"/{f}":
            continue
        parts = f.replace("\\", "/").split("/")
        if len(parts) >= 2:
            date_str = parts[-2]
            time_str = parts[-1].replace(".enc", "").replace("-", ":")
            try:
                file_dt = datetime.fromisoformat(f"{date_str}T{time_str}")
                if file_dt <= req_dt:
                    if target_dt is None or file_dt > target_dt:
                        target_dt = file_dt
                        target_file = f
            except Exception:
                pass

    if not target_file:
        raise HTTPException(status_code=404, detail="No raw video found for this timestamp")

    try:
        import asyncio
        dec_path = await asyncio.to_thread(reader.decrypt_minio_file_to_temp, target_file)
        
        # Calculate offset for 4 seconds before and 4 seconds after
        offset_s = (req_dt - target_dt).total_seconds()
        start_offset = max(0.0, offset_s - 4.0)
        duration = 8.0
        
        output_path = tempfile.mktemp(suffix=".mp4")
        
        ffmpeg_bin = os.getenv("FFMPEG_BIN", r"C:\Users\hp\Downloads\ffmpeg.exe")
        ffmpeg_cmd = [
            ffmpeg_bin, "-y",
            "-ss", str(start_offset),
            "-i", dec_path,
            "-t", str(duration),
            "-c:v", "copy",
            "-c:a", "copy",
            "-movflags", "+faststart",
            output_path
        ]
        
        proc = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        
        try:
            os.remove(dec_path)
        except:
            pass
            
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail=f"FFmpeg error: {stderr.decode()}")
            
        def cleanup_file():
            try:
                os.remove(output_path)
            except:
                pass

        background_tasks.add_task(cleanup_file)
        return FileResponse(output_path, media_type="video/mp4")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from pydantic import BaseModel
from typing import Union, List

class FaceJobCreate(BaseModel):
    camera_id: Union[str, List[str]]
    range_start: str
    range_end: str

@router.post("/face-jobs")
async def create_face_job(payload: FaceJobCreate, background_tasks: BackgroundTasks):
    db = get_database()
    jobs_col = db["face_jobs"]
    
    if isinstance(payload.camera_id, list):
        camera_ids = payload.camera_id
    else:
        camera_ids = [payload.camera_id]

    stream_keys = []
    try:
        from bson import ObjectId
        vms_db = db.client["vms_db"]
        for cid in camera_ids:
            camera_doc = await vms_db.cameras.find_one({"_id": ObjectId(cid)})
            if camera_doc and "stream_key" in camera_doc:
                stream_keys.append(camera_doc["stream_key"])
            else:
                stream_keys.append(cid)
    except Exception as e:
        stream_keys = camera_ids

    job_id = f"face_{uuid4().hex[:8]}"
    
    video_files = []
    try:
        from app.engine.minio_reader import MinioEncryptedReader
        from datetime import datetime, timedelta

        reader = MinioEncryptedReader()
        if reader.minio_client:
            start_dt = datetime.fromisoformat(payload.range_start) - timedelta(minutes=5)
            end_dt = datetime.fromisoformat(payload.range_end) + timedelta(minutes=5)

            date_set = set()
            cur = start_dt
            while cur <= end_dt:
                date_set.add(cur.strftime("%Y-%m-%d"))
                cur += timedelta(days=1)

            roots = reader.minio_client.list_objects(reader.bucket, recursive=False)
            for r in roots:
                if not r.is_dir: continue
                shards = reader.minio_client.list_objects(reader.bucket, prefix=r.object_name, recursive=False)
                for s in shards:
                    if not s.is_dir: continue
                    for sk in stream_keys:
                        for date_str in date_set:
                            date_prefix = f"{s.object_name}{sk}/{date_str}/"
                            day_objs = reader.minio_client.list_objects(reader.bucket, prefix=date_prefix, recursive=False)
                            for obj in day_objs:
                                if not obj.object_name.endswith(".enc"): continue
                                fname = obj.object_name.split("/")[-1].replace(".enc", "").replace("-", ":")
                                try:
                                    file_dt = datetime.fromisoformat(f"{date_str}T{fname}")
                                    if start_dt <= file_dt <= end_dt:
                                        video_files.append(f"minio:{obj.object_name}")
                                except ValueError:
                                    pass
    except Exception as e:
        print(f"MinIO fetch error: {e}")

    if not video_files:
        raise HTTPException(status_code=404, detail="No video files found for the given time range.")

    # Build map of stream_key -> camera_id for the worker
    camera_map = dict(zip(stream_keys, camera_ids))
    
    total_clips_by_camera = {cid: 0 for cid in camera_ids}
    for vf in video_files:
        for sk, cid in camera_map.items():
            if f"/{sk}/" in vf:
                total_clips_by_camera[cid] += 1
                break

    from datetime import datetime
    job_doc = {
        "job_id": job_id,
        "job_name": payload.job_name if payload.job_name else job_id,
            "description": payload.description,
            "incident_time": payload.incident_time,
        "camera_id": camera_ids, # Keep original payload list for db record
        "range_start": payload.range_start,
        "range_end": payload.range_end,
        "status": "queued",
        "progress": 0.0,
        "clip_details": [],
        "total_clips": len(video_files),
        "total_clips_by_camera": total_clips_by_camera,
        "faces": [],
        "error_message": None,
        "created_at": datetime.now().astimezone().isoformat()
    }
    
    await jobs_col.insert_one(job_doc)
    
    from app.worker import process_face_job
    background_tasks.add_task(
        process_face_job, 
        job_id, 
        camera_map, 
        [str(v) for v in video_files],
        payload.range_start,
        payload.range_end
    )

    del job_doc["_id"]
    return job_doc

@router.get("/face-jobs")
async def list_face_jobs():
    db = get_database()
    jobs_col = db["face_jobs"]
    
    cursor = jobs_col.find().sort("_id", -1).limit(50)
    jobs = await cursor.to_list(length=50)
    for job in jobs:
        if "_id" in job:
            del job["_id"]
    return jobs

@router.get("/face-jobs/{job_id}")
async def get_face_job(job_id: str):
    db = get_database()
    jobs_col = db["face_jobs"]
    
    job = await jobs_col.find_one({"job_id": job_id})
    if not job:
        raise HTTPException(status_code=404, detail="Face Job not found.")
        
    del job["_id"]
    return job

@router.patch("/face-jobs/{job_id}")
async def update_face_job(job_id: str, payload: SynopsisJobUpdate):
    db = get_database()
    jobs_col = db["face_jobs"]
    
    job = await jobs_col.find_one({"job_id": job_id})
    if not job:
        raise HTTPException(status_code=404, detail=f"Face Job [{job_id}] not found.")
        
    update_data = {}
    if payload.job_name is not None:
        update_data["job_name"] = payload.job_name
    if hasattr(payload, "description") and payload.description is not None:
        update_data["description"] = payload.description
    if hasattr(payload, "incident_time") and payload.incident_time is not None:
        update_data["incident_time"] = payload.incident_time
    if payload.status is not None:
        update_data["status"] = payload.status
        if payload.status == "cancelled":
            update_data["error_message"] = "Job cancelled by user"
            
    if update_data:
        await jobs_col.update_one({"job_id": job_id}, {"$set": update_data})
        for k, v in update_data.items():
            job[k] = v
            
    del job["_id"]
    return job


@router.get("/face-static/{filename}")
async def get_face_static(filename: str):
    """Serve a pre-saved face thumbnail JPEG directly from disk (fast, no decryption)."""
    import os
    from fastapi.responses import FileResponse
    thumb_path = str(settings.FACE_THUMBS_DIR / filename)
    if not os.path.exists(thumb_path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(thumb_path, media_type="image/jpeg")


@router.get("/face-thumbnail")
async def get_face_thumbnail(camera_id: str, timestamp: str, fx: int, fy: int, fw: int, fh: int):
    """
    Decode a video frame at the given timestamp, crop the face bbox [fx,fy,fw,fh]
    and return a JPEG image. Uses the same MinIO decryption pipeline as raw_clip.
    """
    import cv2
    import numpy as np
    import asyncio
    from datetime import datetime
    from fastapi.responses import Response as FastAPIResponse
    from app.engine.minio_reader import MinioEncryptedReader

    reader = MinioEncryptedReader()
    if not reader.minio_client:
        raise HTTPException(status_code=500, detail="MinIO client not initialized")

    try:
        req_dt = datetime.fromisoformat(timestamp.replace(" ", "T"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid timestamp format")

    # Resolve stream_key from camera_id
    stream_key = camera_id
    try:
        from bson import ObjectId
        db = get_database()
        vms_db = db.client["vms_db"]
        camera_doc = await vms_db.cameras.find_one({"_id": ObjectId(camera_id)})
        if camera_doc and "stream_key" in camera_doc:
            stream_key = camera_doc["stream_key"]
    except Exception:
        pass

    # Find the .enc file closest before req_dt
    def find_enc_file(reader, stream_key, req_dt):
        target_file = None
        target_dt = None
        roots = reader.minio_client.list_objects(reader.bucket, recursive=False)
        for r in roots:
            if not r.is_dir:
                continue
            shards = reader.minio_client.list_objects(reader.bucket, prefix=r.object_name, recursive=False)
            for s in shards:
                if not s.is_dir:
                    continue
                cam_prefix = f"{s.object_name}{stream_key}/"
                cam_objs = reader.minio_client.list_objects(reader.bucket, prefix=cam_prefix, recursive=True)
                for c in cam_objs:
                    if not c.object_name.endswith(".enc"):
                        continue
                    parts = c.object_name.replace("\\", "/").split("/")
                    if len(parts) >= 2:
                        date_str = parts[-2]
                        time_str = parts[-1].replace(".enc", "").replace("-", ":")
                        try:
                            file_dt = datetime.fromisoformat(f"{date_str}T{time_str}")
                            if file_dt <= req_dt:
                                if target_dt is None or file_dt > target_dt:
                                    target_dt = file_dt
                                    target_file = c.object_name
                        except Exception:
                            pass
        return target_file, target_dt

    target_file, target_dt = await asyncio.to_thread(find_enc_file, reader, stream_key, req_dt)

    if not target_file:
        raise HTTPException(status_code=404, detail="No video found for this timestamp")

    try:
        dec_path = await asyncio.to_thread(reader.decrypt_minio_file_to_temp, target_file)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {e}")

    try:
        # Seek to correct frame offset within the clip
        cap = cv2.VideoCapture(dec_path)
        if not cap.isOpened():
            raise HTTPException(status_code=500, detail="Cannot open video")

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        offset_s = (req_dt - target_dt).total_seconds()
        target_frame = max(0, int(offset_s * fps))
        
        # cap.set(cv2.CAP_PROP_POS_FRAMES) jumps to the nearest keyframe, not the exact frame.
        cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
        current_frame = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
        
        # If it jumped to a keyframe BEFORE the target, we must read the difference
        if current_frame < target_frame:
            for _ in range(target_frame - current_frame):
                cap.read()
        elif current_frame > target_frame:
            # If it jumped PAST it, we have to start from the beginning
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            for _ in range(target_frame):
                cap.read()

        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            # Fallback: read first frame
            cap2 = cv2.VideoCapture(dec_path)
            ret, frame = cap2.read()
            cap2.release()

        if frame is None:
            raise HTTPException(status_code=500, detail="Could not read video frame")

        # Crop face region with small padding
        h, w = frame.shape[:2]
        pad = 10
        x1 = max(0, fx - pad)
        y1 = max(0, fy - pad)
        x2 = min(w, fx + fw + pad)
        y2 = min(h, fy + fh + pad)

        if x2 > x1 and y2 > y1:
            face_crop = frame[y1:y2, x1:x2]
        else:
            face_crop = frame  # fallback to full frame

        # Encode to JPEG
        success, jpeg = cv2.imencode(".jpg", face_crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not success:
            raise HTTPException(status_code=500, detail="Failed to encode image")

        return FastAPIResponse(content=jpeg.tobytes(), media_type="image/jpeg")

    finally:
        try:
            import os
            if os.path.exists(dec_path):
                os.remove(dec_path)
        except Exception:
            pass