from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, UploadFile, File, Form
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
        # Fetch stream_key from the main vms DB using the provided camera_id
        stream_key = cam_id
        try:
            from bson import ObjectId
            import os
            # Use same DB name as the main backend (MONGO_DB_NAME env var)
            main_db_name = os.environ.get("MONGO_DB_NAME", "vms_db")
            main_db = db.client[main_db_name]
            camera_doc = await main_db.cameras.find_one({"_id": ObjectId(cam_id)})
            if camera_doc:
                stream_key = camera_doc.get("stream_key") or camera_doc.get("id") or cam_id
                print(f"[SYNOPSIS-DEBUG] Resolved stream_key={stream_key} for cam_id={cam_id}")
        except Exception as e:
            print(f"Error fetching stream_key: {e}")

        job_id = f"syn_{uuid4().hex[:8]}"
        
        video_files = []
        try:
            from app.engine.minio_reader import MinioEncryptedReader
            from datetime import datetime, timedelta
            import re

            def to_naive_dt(dt_val):
                if isinstance(dt_val, str):
                    try:
                        dt_val = datetime.fromisoformat(dt_val.replace("Z", "+00:00"))
                    except Exception:
                        return None
                if dt_val and getattr(dt_val, "tzinfo", None) is not None:
                    return dt_val.astimezone().replace(tzinfo=None)
                return dt_val

            raw_start_dt = datetime.fromisoformat(payload.range_start.replace("Z", "+00:00"))
            raw_end_dt = datetime.fromisoformat(payload.range_end.replace("Z", "+00:00"))
            start_dt = to_naive_dt(raw_start_dt) - timedelta(minutes=5)
            end_dt = to_naive_dt(raw_end_dt) + timedelta(minutes=5)

            date_set = set()
            cur = start_dt
            while cur <= end_dt:
                date_set.add(cur.strftime("%Y-%m-%d"))
                cur += timedelta(days=1)

            # Build list of possible camera identifiers
            possible_keys = {cam_id, stream_key, stream_key.replace(".", "_"), stream_key.replace("_", ".")}
            try:
                if camera_doc:
                    for attr in ["stream_key", "ip", "name", "id"]:
                        val = camera_doc.get(attr)
                        if val:
                            sval = str(val)
                            possible_keys.add(sval)
                            possible_keys.add(sval.replace(".", "_"))
                            possible_keys.add(sval.replace("_", "."))
            except Exception:
                pass

            print(f"[SYNOPSIS-DEBUG] cam_id={cam_id} stream_key={stream_key} possible_keys={possible_keys}")
            print(f"[SYNOPSIS-DEBUG] Searching dates: {date_set} (Range: {start_dt} -> {end_dt})")

            # ── 1. Query MongoDB recordings first (FASTEST & ALWAYS HAS EXACT PATHS) ──
            try:
                main_db_name = os.environ.get("MONGO_DB_NAME", "vms_db")
                main_db = db.client[main_db_name]
                rec_cursor = main_db.recordings.find({
                    "camera_id": {"$in": list(possible_keys)},
                    "date": {"$in": list(date_set)},
                    "is_deleted": {"$ne": True}
                }).sort("start_time", 1)

                async for rec in rec_cursor:
                    fpath = rec.get("file_path")
                    if not fpath:
                        continue
                    rec_date = rec.get("date", "")
                    rec_time = str(rec.get("start_time", "00:00:00")).replace("-", ":")
                    try:
                        rec_dt = datetime.fromisoformat(f"{rec_date}T{rec_time}")
                        rec_dt = to_naive_dt(rec_dt)
                        if rec_dt and start_dt <= rec_dt <= end_dt:
                            v_key = fpath if fpath.startswith("minio:") else f"minio:{fpath}"
                            if v_key not in video_files:
                                video_files.append(v_key)
                    except Exception:
                        v_key = fpath if fpath.startswith("minio:") else f"minio:{fpath}"
                        if v_key not in video_files:
                            video_files.append(v_key)

                print(f"[SYNOPSIS-DEBUG] Found {len(video_files)} video_files via MongoDB recordings.")
            except Exception as e:
                print(f"[SYNOPSIS-DEBUG] Error querying MongoDB recordings: {e}")

            # ── 2. Fallback: Direct MinIO scan if MongoDB yielded 0 clips ──
            if not video_files:
                reader = MinioEncryptedReader()
                if reader.minio_client:
                    # Collect all top-level roots in the bucket
                    roots = list(reader.minio_client.list_objects(reader.bucket, recursive=False))
                    prefixes_to_scan = set()

                    for r in roots:
                        if not r.is_dir:
                            continue
                        r_name = r.object_name.rstrip("/")
                        for k in possible_keys:
                            for d in date_set:
                                prefixes_to_scan.add(f"{r_name}/{k}/{d}/")
                                prefixes_to_scan.add(f"{r_name}/{d}/{k}/")
                            prefixes_to_scan.add(f"{r_name}/{k}/")

                    for k in possible_keys:
                        for d in date_set:
                            prefixes_to_scan.add(f"{k}/{d}/")
                        prefixes_to_scan.add(f"{k}/")

                    for pfx in prefixes_to_scan:
                        try:
                            objs = reader.minio_client.list_objects(reader.bucket, prefix=pfx, recursive=True)
                            for obj in objs:
                                if not obj.object_name.endswith(".enc"):
                                    continue
                                fname_base = obj.object_name.split("/")[-1].replace(".enc", "")
                                
                                # Match timestamp from filename or path
                                file_dt = None
                                m = re.search(r'(\d{4}-\d{2}-\d{2})[T_](\d{2})[-_](\d{2})[-_](\d{2})', fname_base)
                                if m:
                                    try:
                                        file_dt = datetime.strptime(f"{m.group(1)}_{m.group(2)}-{m.group(3)}-{m.group(4)}", "%Y-%m-%d_%H-%M-%S")
                                    except ValueError:
                                        pass
                                if not file_dt:
                                    date_m = re.search(r'/(\d{4}-\d{2}-\d{2})/', obj.object_name)
                                    time_m = re.search(r'(\d{2})[-_](\d{2})[-_](\d{2})', fname_base)
                                    if date_m and time_m:
                                        try:
                                            file_dt = datetime.strptime(f"{date_m.group(1)}_{time_m.group(1)}-{time_m.group(2)}-{time_m.group(3)}", "%Y-%m-%d_%H-%M-%S")
                                        except ValueError:
                                            pass

                                if file_dt:
                                    file_dt = to_naive_dt(file_dt)
                                    if start_dt <= file_dt <= end_dt:
                                        v_key = f"minio:{obj.object_name}"
                                        if v_key not in video_files:
                                            video_files.append(v_key)
                                else:
                                    # Fallback to date match if specific time couldn't be parsed
                                    if any(d in obj.object_name for d in date_set):
                                        v_key = f"minio:{obj.object_name}"
                                        if v_key not in video_files:
                                            video_files.append(v_key)
                        except Exception as scan_err:
                            pass

                    print(f"[SYNOPSIS-DEBUG] Total video_files found after MinIO fallback: {len(video_files)}")
        except Exception as e:
            print(f"[SYNOPSIS-DEBUG] MinIO fetch error: {e}")

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

@router.delete("/jobs/{job_id}")
async def delete_synopsis_job(job_id: str):
    db = get_database()
    jobs_col = db["synopsis_jobs"]
    if job_id.startswith("local-"):
        return {"status": "success", "message": f"Local draft {job_id} acknowledged"}
    result = await jobs_col.delete_many({"$or": [{"job_id": job_id}, {"group_id": job_id}]})
    return {"status": "success", "deleted_count": result.deleted_count}

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
            if not r.is_dir: continue
            # New architecture: root/stream_key/
            cam_prefix_new = f"{r.object_name}{stream_key}/"
            cam_objs_new = reader.minio_client.list_objects(reader.bucket, prefix=cam_prefix_new, recursive=True)
            for c in cam_objs_new:
                if c.object_name.endswith(".enc"):
                    files.append(c.object_name)
                    
            # Old architecture: root/shard/stream_key/
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
        import os
        main_db_name = os.environ.get("MONGO_DB_NAME", "vms_db")
        camera_doc = await db.client[main_db_name].cameras.find_one({"_id": ObjectId(camera_id)})
        if camera_doc:
            stream_key = camera_doc.get("stream_key") or camera_doc.get("id") or camera_id
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
            fname_base = parts[-1].replace(".enc", "")
            date_str = parts[-2]
            try:
                # New format: YYYY-MM-DD_HH-MM-SS
                file_dt = datetime.strptime(fname_base, "%Y-%m-%d_%H-%M-%S")
            except ValueError:
                try:
                    # Old format: HH-MM-SS combined with date folder
                    file_dt = datetime.strptime(f"{date_str}_{fname_base}", "%Y-%m-%d_%H-%M-%S")
                except Exception:
                    continue
            if file_dt <= req_dt:
                if target_dt is None or file_dt > target_dt:
                    target_dt = file_dt
                    target_file = f

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
async def get_event_playback_clip_url(
    camera_id: str,
    timestamp: str,
    request: Request,
    track_id: Optional[str] = None,
    job_id: Optional[str] = None,
    burn_box: bool = True
):
    """
    Returns a JSON with clipUrl that points to the actual video stream endpoint.
    This mimics the onvif-backend behavior for the frontend.
    """
    import urllib.parse
    encoded_time = urllib.parse.quote(timestamp)
    base_url = str(request.base_url).rstrip("/")
    clip_url = f"{base_url}/a1/v1/synopsis/event-playback/video?camera_id={camera_id}&timestamp={encoded_time}"
    if track_id:
        clip_url += f"&track_id={urllib.parse.quote(track_id)}"
    if job_id:
        clip_url += f"&job_id={urllib.parse.quote(job_id)}"
    clip_url += f"&burn_box={'true' if burn_box else 'false'}"
    return {"clipUrl": clip_url, "target_offset_s": 3.0}

@router.get("/event-playback/video")
async def get_event_playback_video(
    camera_id: str,
    timestamp: str,
    background_tasks: BackgroundTasks,
    download: bool = False,
    track_id: Optional[str] = None,
    job_id: Optional[str] = None,
    burn_box: bool = True
):
    from fastapi.responses import FileResponse
    from app.engine.minio_reader import MinioEncryptedReader
    from datetime import datetime, timedelta
    import os, subprocess, re
    from pathlib import Path

    reader = MinioEncryptedReader()
    if not reader.minio_client:
        raise HTTPException(status_code=500, detail="MinIO client not initialized")

    try:
        req_dt = datetime.fromisoformat(timestamp.replace(" ", "T"))
    except:
        raise HTTPException(status_code=400, detail="Invalid timestamp format")

    db = get_database()
    stream_key = camera_id
    cam_ip = None

    # Resolve camera doc
    try:
        from bson import ObjectId
        candidate_dbs = [os.environ.get("MONGO_DB_NAME", "vms_db"), "vms_database", "vms_db"]
        for db_name in candidate_dbs:
            try:
                col = db.client[db_name].cameras
                query = {"$or": [{"stream_key": camera_id}, {"ip": camera_id}, {"id": camera_id}]}
                try:
                    query["$or"].append({"_id": ObjectId(camera_id)})
                except Exception:
                    pass
                camera_doc = await col.find_one(query)
                if camera_doc:
                    stream_key = camera_doc.get("stream_key") or camera_doc.get("id") or camera_id
                    cam_ip = camera_doc.get("ip")
                    break
            except Exception:
                pass
    except Exception:
        pass

    clean_stream_key = stream_key.replace(".", "_")
    req_date = req_dt.strftime("%Y-%m-%d")
    req_time = req_dt.strftime("%H:%M:%S")

    # Ensure clip cache directory exists
    cache_dir = Path("devices_data") / "playback_clips"
    cache_dir.mkdir(parents=True, exist_ok=True)
    raw_cache_filename = f"{clean_stream_key}_{req_date}_{req_dt.strftime('%H-%M-%S')}.mp4"
    raw_cache_path = str(cache_dir / raw_cache_filename)

    # Check burned filename if burn requested
    safe_tid = re.sub(r'[^a-zA-Z0-9_-]', '_', track_id) if track_id else ""
    burned_cache_filename = f"{clean_stream_key}_{req_date}_{req_dt.strftime('%H-%M-%S')}_burn_{safe_tid}.mp4" if safe_tid else raw_cache_filename
    burned_cache_path = str(cache_dir / burned_cache_filename)

    target_cache_path = burned_cache_path if burn_box and safe_tid else raw_cache_path
    target_cache_filename = burned_cache_filename if burn_box and safe_tid else raw_cache_filename

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'attachment; filename="{target_cache_filename}"' if download else "inline"
    }

    # If cached file exists and valid, return it immediately
    if os.path.exists(target_cache_path) and os.path.getsize(target_cache_path) > 1000:
        return FileResponse(target_cache_path, media_type="video/mp4", headers=headers)

    # 1. Fast lookup via MongoDB recordings collection
    target_file = None
    target_dt = None

    candidate_keys = list(set([clean_stream_key, stream_key, cam_ip.replace('.', '_') if cam_ip else None, cam_ip]))
    candidate_keys = [k for k in candidate_keys if k]

    try:
        candidate_dbs = [os.environ.get("MONGO_DB_NAME", "vms_db"), "vms_database", "vms_db"]
        for db_name in candidate_dbs:
            try:
                rec_col = db.client[db_name].recordings
                doc = await rec_col.find_one(
                    {
                        "camera_id": {"$in": candidate_keys},
                        "date": req_date,
                        "start_time": {"$lte": req_time}
                    },
                    sort=[("start_time", -1)]
                )
                if not doc:
                    # Try previous day border check
                    prev_date = (req_dt - timedelta(days=1)).strftime("%Y-%m-%d")
                    doc = await rec_col.find_one(
                        {"camera_id": {"$in": candidate_keys}, "date": prev_date},
                        sort=[("start_time", -1)]
                    )

                if doc and doc.get("file_path"):
                    raw_fp = doc.get("file_path").replace("minio:", "")
                    st_str = doc.get("start_time", "00:00:00").replace("-", ":")
                    d_str = doc.get("date", req_date)
                    try:
                        t_dt = datetime.strptime(f"{d_str} {st_str}", "%Y-%m-%d %H:%M:%S")
                        target_file = raw_fp
                        target_dt = t_dt
                        break
                    except Exception:
                        pass
            except Exception:
                pass
    except Exception as e:
        logger.warning(f"DB recording lookup failed: {e}")

    # 2. Targeted fallback in MinIO if DB didn't find the chunk
    if not target_file:
        import asyncio
        def search_minio_targeted():
            candidates = []
            for root_prefix in [f"recorder_service/{clean_stream_key}/{req_date}/", f"shard1/{clean_stream_key}/{req_date}/"]:
                try:
                    for obj in reader.minio_client.list_objects(reader.bucket, prefix=root_prefix, recursive=True):
                        if obj.object_name.endswith(".enc"):
                            candidates.append(obj.object_name)
                except Exception:
                    pass
            return candidates

        all_enc_files = await asyncio.to_thread(search_minio_targeted)
        for f in all_enc_files:
            parts = f.replace("\\", "/").split("/")
            if len(parts) >= 2:
                fname_base = parts[-1].replace(".enc", "")
                date_str = parts[-2]
                try:
                    f_dt = datetime.strptime(fname_base, "%Y-%m-%d_%H-%M-%S")
                except ValueError:
                    try:
                        f_dt = datetime.strptime(f"{date_str}_{fname_base}", "%Y-%m-%d_%H-%M-%S")
                    except Exception:
                        continue
                if f_dt <= req_dt:
                    if target_dt is None or f_dt > target_dt:
                        target_dt = f_dt
                        target_file = f

    if not target_file:
        raise HTTPException(status_code=404, detail="No raw video recording found for this timestamp")

    try:
        ffmpeg_bin = os.getenv("FFMPEG_BIN", r"C:\Users\mirador\Downloads\ffmpeg.exe")

        # Extract raw 10s clip if not already present
        if not os.path.exists(raw_cache_path) or os.path.getsize(raw_cache_path) < 1000:
            import asyncio
            dec_path = await asyncio.to_thread(reader.decrypt_minio_file_to_temp, target_file)

            # Offset calculation (3 seconds before target moment, 10 seconds total)
            offset_s = max(0.0, (req_dt - target_dt).total_seconds()) if target_dt else 0.0
            start_offset = max(0.0, offset_s - 3.0)
            duration = 10.0

            ffmpeg_cmd = [
                ffmpeg_bin, "-y",
                "-ss", str(start_offset),
                "-i", dec_path,
                "-t", str(duration),
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                raw_cache_path
            ]

            proc = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            try:
                if os.path.exists(dec_path):
                    os.remove(dec_path)
            except Exception:
                pass

            if proc.returncode != 0:
                raise HTTPException(status_code=500, detail=f"FFmpeg error: {stderr.decode(errors='replace')}")

        # If burn requested and track_id given, burn directly into frames
        if burn_box and safe_tid:
            try:
                import cv2
                cap = cv2.VideoCapture(raw_cache_path)
                fps = cap.get(cv2.CAP_PROP_FPS) or 20.0
                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

                traj = []
                label = "Target Person"
                match_score = None
                if job_id:
                    try:
                        jdoc = await db["face_jobs"].find_one({"job_id": job_id})
                        if jdoc and jdoc.get("faces"):
                            for f in jdoc["faces"]:
                                if f.get("track_id") == track_id:
                                    traj = f.get("trajectory") or []
                                    idx = f.get("matched_probe_index", 0)
                                    match_score = f.get("match_score")
                                    if match_score:
                                        label = f"Target #{idx + 1} ({match_score}%)"
                                    else:
                                        label = f"Target #{idx + 1}"
                                    break
                    except Exception as _je:
                        logger.warning(f"Error loading trajectory for burn-in: {_je}")

                burn_ffmpeg_cmd = [
                    ffmpeg_bin, "-y",
                    "-f", "rawvideo",
                    "-vcodec", "rawvideo",
                    "-s", f"{w}x{h}",
                    "-pix_fmt", "bgr24",
                    "-r", str(fps),
                    "-i", "-",
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-crf", "22",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    burned_cache_path
                ]

                burn_proc = subprocess.Popen(burn_ffmpeg_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                color = (34, 197, 94) if (match_score or 0) >= 80 else (11, 158, 245)

                fi = 0
                while True:
                    ret, frame = cap.read()
                    if not ret: break
                    t_sec = fi / fps

                    box = None
                    if traj:
                        for pt in traj:
                            if abs(pt["t"] - t_sec) <= (1.0 / fps):
                                box = pt.get("face_bbox") or pt.get("bbox")
                                break

                    if box and len(box) == 4:
                        bx, by, bw, bh = box
                        bx = max(0, min(w - 1, bx))
                        by = max(0, min(h - 1, by))
                        bw = max(10, min(w - bx, bw))
                        bh = max(10, min(h - by, bh))

                        cv2.rectangle(frame, (bx, by), (bx + bw, by + bh), color, 3)
                        clen = max(6, int(min(bw, bh) * 0.25))
                        cv2.line(frame, (bx, by), (bx + clen, by), (255, 255, 255), 4)
                        cv2.line(frame, (bx, by), (bx, by + clen), (255, 255, 255), 4)
                        cv2.line(frame, (bx + bw, by), (bx + bw - clen, by), (255, 255, 255), 4)
                        cv2.line(frame, (bx + bw, by), (bx + bw, by + clen), (255, 255, 255), 4)

                        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
                        cv2.rectangle(frame, (bx, max(0, by - 32)), (bx + tw + 16, by), (15, 23, 42), -1)
                        cv2.rectangle(frame, (bx, max(0, by - 32)), (bx + tw + 16, by), color, 1)
                        cv2.putText(frame, label, (bx + 8, max(22, by - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)

                    burn_proc.stdin.write(frame.tobytes())
                    fi += 1

                burn_proc.stdin.close()
                burn_proc.wait()
                cap.release()
            except Exception as _be:
                logger.warning(f"Burn-in processing failed, falling back to raw: {_be}")

        final_file = burned_cache_path if burn_box and safe_tid and os.path.exists(burned_cache_path) and os.path.getsize(burned_cache_path) > 1000 else raw_cache_path
        return FileResponse(final_file, media_type="video/mp4", headers=headers)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from pydantic import BaseModel
from typing import Union, List, Optional

class FaceJobCreate(BaseModel):
    camera_id: Union[str, List[str]]
    range_start: str
    range_end: str
    job_name: Optional[str] = None
    description: Optional[str] = None
    incident_time: Optional[str] = None
    probe_photo_base64: Optional[str] = None
    similarity_threshold: Optional[float] = 0.65

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
        import os
        main_db_name = os.environ.get("MONGO_DB_NAME", "vms_db")
        for cid in camera_ids:
            camera_doc = await db.client[main_db_name].cameras.find_one({"_id": ObjectId(cid)})
            if camera_doc:
                sk = camera_doc.get("stream_key") or camera_doc.get("id") or cid
                stream_keys.append(sk)
            else:
                stream_keys.append(cid)
    except Exception as e:
        stream_keys = camera_ids

    job_id = f"face_{uuid4().hex[:8]}"

    probe_vector = None
    probe_photo_url = None
    if getattr(payload, "probe_photo_base64", None):
        import base64
        import os
        try:
            b64_data = payload.probe_photo_base64
            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]
            raw_photo = base64.b64decode(b64_data)
            from app.engine.face_recognizer import FaceEmbeddingEngine
            rec_engine = FaceEmbeddingEngine()
            probe_vector_np, aligned_face = rec_engine.extract_probe_embedding(raw_photo)
            probe_vector = probe_vector_np.tolist()

            probe_filename = f"probe_{job_id}.jpg"
            os.makedirs(settings.FACE_THUMBS_DIR, exist_ok=True)
            probe_path = settings.FACE_THUMBS_DIR / probe_filename
            with open(probe_path, "wb") as pf:
                pf.write(raw_photo)
            probe_photo_url = f"/face-static/{probe_filename}"
        except Exception as pe:
            raise HTTPException(status_code=400, detail=f"Target photo processing failed: {pe}")
    
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
                # New architecture: root/stream_key/date_str/
                for sk in stream_keys:
                    for date_str in date_set:
                        date_prefix = f"{r.object_name}{sk}/{date_str}/"
                        day_objs = reader.minio_client.list_objects(reader.bucket, prefix=date_prefix, recursive=False)
                        for obj in day_objs:
                            if not obj.object_name.endswith(".enc"): continue
                            fname_base = obj.object_name.split("/")[-1].replace(".enc", "")
                            try:
                                # New format: YYYY-MM-DD_HH-MM-SS
                                file_dt = datetime.strptime(fname_base, "%Y-%m-%d_%H-%M-%S")
                            except ValueError:
                                try:
                                    # Old format: HH-MM-SS combined with date folder
                                    file_dt = datetime.strptime(f"{date_str}_{fname_base}", "%Y-%m-%d_%H-%M-%S")
                                except ValueError:
                                    continue
                            if start_dt <= file_dt <= end_dt:
                                video_files.append(f"minio:{obj.object_name}")
                
                # Old architecture: root/shard/stream_key/date_str/
                shards = reader.minio_client.list_objects(reader.bucket, prefix=r.object_name, recursive=False)
                for s in shards:
                    if not s.is_dir: continue
                    for sk in stream_keys:
                        for date_str in date_set:
                            date_prefix = f"{s.object_name}{sk}/{date_str}/"
                            day_objs = reader.minio_client.list_objects(reader.bucket, prefix=date_prefix, recursive=False)
                            for obj in day_objs:
                                if not obj.object_name.endswith(".enc"): continue
                                fname_base = obj.object_name.split("/")[-1].replace(".enc", "")
                                try:
                                    # New format: YYYY-MM-DD_HH-MM-SS
                                    file_dt = datetime.strptime(fname_base, "%Y-%m-%d_%H-%M-%S")
                                except ValueError:
                                    try:
                                        # Old format: HH-MM-SS combined with date folder
                                        file_dt = datetime.strptime(f"{date_str}_{fname_base}", "%Y-%m-%d_%H-%M-%S")
                                    except ValueError:
                                        continue
                                if start_dt <= file_dt <= end_dt:
                                    video_files.append(f"minio:{obj.object_name}")
    except Exception as e:
        print(f"MinIO fetch error: {e}")

    # Deduplicate and sort files chronologically
    video_files = sorted(list(set(video_files)))

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
        "job_type": "probe_search" if probe_vector else "face_detection",
        "similarity_threshold": float(payload.similarity_threshold or 0.65) if probe_vector else None,
        "probe_photo_url": probe_photo_url,
        "job_name": getattr(payload, "job_name", None) or job_id,
        "description": getattr(payload, "description", None),
        "incident_time": getattr(payload, "incident_time", None),
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
        payload.range_end,
        probe_vector,
        float(payload.similarity_threshold or 0.65)
    )

    del job_doc["_id"]
    return job_doc


@router.post("/face-jobs-search")
@router.post("/face-search-jobs")
async def create_face_search_job(
    camera_ids: str = Form(...),
    range_start: str = Form(...),
    range_end: str = Form(...),
    similarity_threshold: float = Form(0.65),
    probe_photo: Optional[UploadFile] = File(None),
    probe_photos: Optional[List[UploadFile]] = File(None),
    job_name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    incident_time: Optional[str] = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    import json
    import os
    from uuid import uuid4
    from datetime import datetime, timedelta

    # 1. Parse camera IDs
    raw_cams = camera_ids.strip()
    try:
        if raw_cams.startswith("["):
            cam_list = json.loads(raw_cams)
        elif "," in raw_cams:
            cam_list = [c.strip() for c in raw_cams.split(",") if c.strip()]
        else:
            cam_list = [raw_cams]
    except Exception:
        cam_list = [raw_cams]

    # 2. Collect uploaded probe photos (single or multiple)
    uploaded_files: List[UploadFile] = []
    if probe_photos:
        uploaded_files.extend(probe_photos)
    if probe_photo:
        uploaded_files.append(probe_photo)

    if not uploaded_files:
        raise HTTPException(status_code=400, detail="No target photo provided.")

    job_id = f"facesearch_{uuid4().hex[:8]}"

    # 3. Extract embeddings and save each probe photo
    from app.engine.face_recognizer import FaceEmbeddingEngine
    rec_engine = FaceEmbeddingEngine()
    probe_vectors = []
    probe_photo_urls = []
    skipped_photos = []
    os.makedirs(settings.FACE_THUMBS_DIR, exist_ok=True)

    for idx, p_file in enumerate(uploaded_files):
        p_bytes = await p_file.read()
        if not p_bytes:
            continue
        fname = getattr(p_file, "filename", None) or f"Photo #{idx + 1}"
        try:
            p_vec_np, _ = rec_engine.extract_probe_embedding(p_bytes)
            probe_vectors.append(p_vec_np.tolist())

            p_filename = f"probe_{job_id}_{idx}.jpg"
            p_disk_path = settings.FACE_THUMBS_DIR / p_filename
            with open(p_disk_path, "wb") as pf:
                pf.write(p_bytes)
            probe_photo_urls.append(f"/face-static/{p_filename}")
        except ValueError as ve:
            skipped_photos.append({"index": idx, "filename": fname, "reason": str(ve)})
            logger.warning(f"[FaceSearch] Target photo '{fname}' skipped: {ve}")
            if len(uploaded_files) == 1:
                raise HTTPException(status_code=400, detail=str(ve))
            continue
        except Exception as fe:
            skipped_photos.append({"index": idx, "filename": fname, "reason": str(fe)})
            logger.warning(f"[FaceSearch] Target photo '{fname}' error: {fe}")
            if len(uploaded_files) == 1:
                raise HTTPException(status_code=500, detail=f"Face recognition engine error: {fe}")
            continue

    if not probe_vectors:
        raise HTTPException(status_code=400, detail="No clear frontal face detected in the uploaded photo(s). Please upload clear face images.")

    # 5. Resolve stream keys
    db = get_database()
    jobs_col = db["face_jobs"]
    stream_keys = []
    try:
        from bson import ObjectId
        main_db_name = os.environ.get("MONGO_DB_NAME", "vms_db")
        for cid in cam_list:
            camera_doc = await db.client[main_db_name].cameras.find_one({"_id": ObjectId(cid)})
            if camera_doc:
                sk = camera_doc.get("stream_key") or camera_doc.get("id") or cid
                stream_keys.append(sk)
            else:
                stream_keys.append(cid)
    except Exception:
        stream_keys = cam_list

    # 6. Locate video files in MinIO
    video_files = []
    try:
        from app.engine.minio_reader import MinioEncryptedReader
        reader = MinioEncryptedReader()
        if reader.minio_client:
            start_dt = datetime.fromisoformat(range_start) - timedelta(minutes=5)
            end_dt = datetime.fromisoformat(range_end) + timedelta(minutes=5)

            date_set = set()
            cur = start_dt
            while cur <= end_dt:
                date_set.add(cur.strftime("%Y-%m-%d"))
                cur += timedelta(days=1)

            roots = reader.minio_client.list_objects(reader.bucket, recursive=False)
            for r in roots:
                if not r.is_dir:
                    continue
                for sk in stream_keys:
                    for date_str in date_set:
                        date_prefix = f"{r.object_name}{sk}/{date_str}/"
                        day_objs = reader.minio_client.list_objects(reader.bucket, prefix=date_prefix, recursive=False)
                        for obj in day_objs:
                            if not obj.object_name.endswith(".enc"):
                                continue
                            fname_base = obj.object_name.split("/")[-1].replace(".enc", "")
                            try:
                                file_dt = datetime.strptime(fname_base, "%Y-%m-%d_%H-%M-%S")
                            except ValueError:
                                try:
                                    file_dt = datetime.strptime(f"{date_str}_{fname_base}", "%Y-%m-%d_%H-%M-%S")
                                except ValueError:
                                    continue
                            if start_dt <= file_dt <= end_dt:
                                video_files.append(f"minio:{obj.object_name}")

                shards = reader.minio_client.list_objects(reader.bucket, prefix=r.object_name, recursive=False)
                for s in shards:
                    if not s.is_dir:
                        continue
                    for sk in stream_keys:
                        for date_str in date_set:
                            date_prefix = f"{s.object_name}{sk}/{date_str}/"
                            day_objs = reader.minio_client.list_objects(reader.bucket, prefix=date_prefix, recursive=False)
                            for obj in day_objs:
                                if not obj.object_name.endswith(".enc"):
                                    continue
                                fname_base = obj.object_name.split("/")[-1].replace(".enc", "")
                                try:
                                    file_dt = datetime.strptime(fname_base, "%Y-%m-%d_%H-%M-%S")
                                except ValueError:
                                    try:
                                        file_dt = datetime.strptime(f"{date_str}_{fname_base}", "%Y-%m-%d_%H-%M-%S")
                                    except ValueError:
                                        continue
                                if start_dt <= file_dt <= end_dt:
                                    video_files.append(f"minio:{obj.object_name}")
    except Exception as me:
        print(f"MinIO fetch error in search job: {me}")

    video_files = sorted(list(set(video_files)))
    if not video_files:
        raise HTTPException(status_code=404, detail="No video files found for the given time range.")

    camera_map = dict(zip(stream_keys, cam_list))
    total_clips_by_camera = {cid: 0 for cid in cam_list}
    for vf in video_files:
        for sk, cid in camera_map.items():
            if f"/{sk}/" in vf:
                total_clips_by_camera[cid] += 1
                break

    job_doc = {
        "job_id": job_id,
        "job_type": "probe_search",
        "job_name": job_name or f"Face Search {job_id[-6:]}",
        "description": description,
        "incident_time": incident_time,
        "camera_id": cam_list,
        "range_start": range_start,
        "range_end": range_end,
        "similarity_threshold": float(similarity_threshold),
        "probe_photo_url": probe_photo_urls[0] if probe_photo_urls else None,
        "probe_photo_urls": probe_photo_urls,
        "skipped_photos": skipped_photos,
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
        range_start,
        range_end,
        probe_vectors,
        float(similarity_threshold),
        probe_photo_urls
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
        import os
        db = get_database()
        main_db_name = os.environ.get("MONGO_DB_NAME", "vms_db")
        camera_doc = await db.client[main_db_name].cameras.find_one({"_id": ObjectId(camera_id)})
        if camera_doc:
            stream_key = camera_doc.get("stream_key") or camera_doc.get("id") or camera_id
    except Exception:
        pass

    def find_enc_file(reader, stream_key, req_dt):
        target_file = None
        target_dt = None
        roots = reader.minio_client.list_objects(reader.bucket, recursive=False)
        for r in roots:
            if not r.is_dir: continue
            
            # New architecture
            cam_prefix_new = f"{r.object_name}{stream_key}/"
            cam_objs_new = reader.minio_client.list_objects(reader.bucket, prefix=cam_prefix_new, recursive=True)
            for c in cam_objs_new:
                if not c.object_name.endswith(".enc"): continue
                parts = c.object_name.replace("\\", "/").split("/")
                if len(parts) >= 2:
                    fname_base = parts[-1].replace(".enc", "")
                    date_str = parts[-2]
                    try:
                        file_dt = datetime.strptime(fname_base, "%Y-%m-%d_%H-%M-%S")
                    except ValueError:
                        try:
                            file_dt = datetime.strptime(f"{date_str}_{fname_base}", "%Y-%m-%d_%H-%M-%S")
                        except Exception:
                            continue
                    if file_dt <= req_dt:
                        if target_dt is None or file_dt > target_dt:
                            target_dt = file_dt
                            target_file = c.object_name
                        
            # Old architecture
            shards = reader.minio_client.list_objects(reader.bucket, prefix=r.object_name, recursive=False)
            for s in shards:
                if not s.is_dir: continue
                cam_prefix = f"{s.object_name}{stream_key}/"
                cam_objs = reader.minio_client.list_objects(reader.bucket, prefix=cam_prefix, recursive=True)
                for c in cam_objs:
                    if not c.object_name.endswith(".enc"): continue
                    parts = c.object_name.replace("\\", "/").split("/")
                    if len(parts) >= 2:
                        fname_base = parts[-1].replace(".enc", "")
                        date_str = parts[-2]
                        try:
                            file_dt = datetime.strptime(fname_base, "%Y-%m-%d_%H-%M-%S")
                        except ValueError:
                            try:
                                file_dt = datetime.strptime(f"{date_str}_{fname_base}", "%Y-%m-%d_%H-%M-%S")
                            except Exception:
                                continue
                        if file_dt <= req_dt:
                            if target_dt is None or file_dt > target_dt:
                                target_dt = file_dt
                                target_file = c.object_name
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


# =============================================================================
# EMPLOYEE MANAGEMENT & FACIAL BIOMETRIC ENROLLMENT
# =============================================================================

@router.get("/employees")
async def list_employees(
    search: Optional[str] = None,
    department: Optional[str] = None,
    status: Optional[str] = None
):
    """List all employees with optional search and filters."""
    db = get_database()
    query = {}
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"department": {"$regex": search, "$options": "i"}}
        ]
    if department and department != "All":
        query["department"] = department
    if status and status != "All":
        query["status"] = status.lower()

    cursor = db["employees"].find(query).sort("created_at", -1)
    employees = []
    async for emp in cursor:
        p_urls = emp.get("photo_urls") or ([emp.get("photo_url")] if emp.get("photo_url") else [])
        employees.append({
            "emp_id": emp.get("emp_id"),
            "name": emp.get("name"),
            "email": emp.get("email", ""),
            "department": emp.get("department", "General"),
            "status": (emp.get("status") or "authorised").lower(),
            "photo_url": emp.get("photo_url") or (p_urls[0] if p_urls else None),
            "photo_urls": p_urls,
            "photos_count": len(p_urls),
            "has_face_embedding": bool(emp.get("face_embeddings") or emp.get("face_embedding") or len(p_urls) > 0),
            "created_at": emp.get("created_at"),
            "updated_at": emp.get("updated_at")
        })
    return employees


@router.get("/employees/{emp_id}")
async def get_employee(emp_id: str):
    db = get_database()
    emp = await db["employees"].find_one({"emp_id": emp_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    p_urls = emp.get("photo_urls") or ([emp.get("photo_url")] if emp.get("photo_url") else [])
    return {
        "emp_id": emp.get("emp_id"),
        "name": emp.get("name"),
        "email": emp.get("email", ""),
        "department": emp.get("department", "General"),
        "status": (emp.get("status") or "authorised").lower(),
        "photo_url": emp.get("photo_url") or (p_urls[0] if p_urls else None),
        "photo_urls": p_urls,
        "photos_count": len(p_urls),
        "has_face_embedding": bool(emp.get("face_embeddings") or emp.get("face_embedding") or len(p_urls) > 0),
        "created_at": emp.get("created_at"),
        "updated_at": emp.get("updated_at")
    }


@router.post("/employees")
async def create_employee(
    name: str = Form(...),
    email: str = Form(""),
    department: str = Form("General"),
    status: str = Form("authorised"),
    photo: Optional[UploadFile] = File(None),
    photos: Optional[List[UploadFile]] = File(None)
):
    """
    Enrolls a new employee with up to 5 multi-angle face photos (frontal and profile sides)
    using YuNet face detector and SFace feature embeddings to prevent false positives.
    """
    from datetime import datetime
    import logging
    import cv2
    _logger = logging.getLogger(__name__)

    db = get_database()
    emp_id = f"emp_{uuid4().hex[:8]}"

    # Gather all uploaded files (max 5)
    upload_items = []
    if photos:
        upload_items.extend([p for p in photos if p and getattr(p, 'filename', None)])
    if photo and getattr(photo, 'filename', None) and photo not in upload_items:
        upload_items.insert(0, photo)

    upload_items = upload_items[:5]

    photo_urls = []
    face_embeddings = []
    errors = []

    if upload_items:
        from app.engine.face_recognizer import FaceEmbeddingEngine
        rec_engine = FaceEmbeddingEngine()

        for idx, item in enumerate(upload_items):
            try:
                photo_bytes = await item.read()
                if not photo_bytes:
                    continue
                vector, aligned_face = rec_engine.extract_probe_embedding(photo_bytes)
                photo_filename = f"{emp_id}_{idx}.jpg"
                disk_path = settings.FACE_THUMBS_DIR / photo_filename
                with open(str(disk_path), "wb") as pf:
                    pf.write(photo_bytes)
                photo_urls.append(f"/face-static/{photo_filename}")
                if vector is not None:
                    face_embeddings.append(vector.tolist())
                    _logger.info(f"[EmployeeEnroll] Extracted embedding for photo #{idx+1} of {name} ({emp_id})")
                else:
                    _logger.info(f"[EmployeeEnroll] Photo #{idx+1} stored as gallery photo (profile angle).")
            except Exception as fe:
                _logger.warning(f"[EmployeeEnroll] Photo #{idx+1} for {name} failed: {fe}")
                errors.append(f"Photo {idx+1}: {fe}")

        if not face_embeddings and upload_items:
            raise HTTPException(status_code=400, detail=f"No faces detected in photos: {'; '.join(errors)}")

    status_val = status.lower() if status.lower() in ["authorised", "suspended"] else "authorised"
    now_iso = datetime.now().astimezone().isoformat()
    primary_photo = photo_urls[0] if photo_urls else None
    primary_embedding = face_embeddings[0] if face_embeddings else None

    doc = {
        "emp_id": emp_id,
        "name": name.strip(),
        "email": email.strip(),
        "department": department.strip() or "General",
        "status": status_val,
        "photo_url": primary_photo,
        "photo_urls": photo_urls,
        "face_embedding": primary_embedding,
        "face_embeddings": face_embeddings,
        "photos_count": len(photo_urls),
        "created_at": now_iso,
        "updated_at": now_iso
    }

    await db["employees"].insert_one(doc)
    return {
        "emp_id": emp_id,
        "name": doc["name"],
        "email": doc["email"],
        "department": doc["department"],
        "status": doc["status"],
        "photo_url": doc["photo_url"],
        "photo_urls": doc["photo_urls"],
        "photos_count": len(photo_urls),
        "has_face_embedding": bool(face_embeddings or primary_embedding),
        "created_at": now_iso
    }


@router.put("/employees/{emp_id}")
async def update_employee(
    emp_id: str,
    name: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    department: Optional[str] = Form(None),
    status: Optional[str] = Form(None),
    existing_photos: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None),
    photos: Optional[List[UploadFile]] = File(None)
):
    from datetime import datetime
    import logging
    import cv2
    import json
    import time
    _logger = logging.getLogger(__name__)

    db = get_database()
    emp = await db["employees"].find_one({"emp_id": emp_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    update_fields = {"updated_at": datetime.now().astimezone().isoformat()}
    if name is not None:
        update_fields["name"] = name.strip()
    if email is not None:
        update_fields["email"] = email.strip()
    if department is not None:
        update_fields["department"] = department.strip()
    if status is not None:
        update_fields["status"] = status.lower() if status.lower() in ["authorised", "suspended"] else "authorised"

    # Current photos & embeddings in DB
    cur_urls = emp.get("photo_urls") or ([emp.get("photo_url")] if emp.get("photo_url") else [])
    cur_embs = emp.get("face_embeddings") or ([emp.get("face_embedding")] if emp.get("face_embedding") else [])

    url_to_emb = {}
    for i, u in enumerate(cur_urls):
        if u and i < len(cur_embs) and cur_embs[i]:
            url_to_emb[u] = cur_embs[i]

    # Parse kept existing photos (supports JSON array, comma-separated, or single URL)
    kept_urls = None
    if existing_photos is not None:
        raw_val = existing_photos.strip()
        if raw_val:
            try:
                parsed = json.loads(raw_val) if isinstance(raw_val, str) else raw_val
                if isinstance(parsed, list):
                    kept_urls = [u for u in parsed if isinstance(u, str) and u.strip()]
                elif isinstance(parsed, str):
                    kept_urls = [parsed.strip()]
            except Exception:
                chars_to_strip = "[]'\" \t\r\n"
                cleaned = raw_val.strip(chars_to_strip)
                if cleaned:
                    parts = [p.strip(chars_to_strip) for p in cleaned.split(",")]
                    kept_urls = [p for p in parts if p]
                else:
                    kept_urls = []
        else:
            kept_urls = []

    if kept_urls is None:
        kept_urls = list(cur_urls)

    # Backfill embedding for any kept photo that doesn't have an embedding
    for u in kept_urls:
        if u not in url_to_emb:
            candidates = []
            if u.startswith("/face-static/"):
                candidates.append(settings.FACE_THUMBS_DIR / u.replace("/face-static/", ""))
            elif u.startswith("/api/faces/"):
                candidates.append(settings.BASE_DIR / "onvif-backend" / "app" / "static" / "faces" / u.replace("/api/faces/", ""))
                candidates.append(settings.FACE_THUMBS_DIR / u.replace("/api/faces/", ""))
            else:
                base = os.path.basename(u)
                candidates.append(settings.FACE_THUMBS_DIR / base)
                candidates.append(settings.BASE_DIR / "onvif-backend" / "app" / "static" / "faces" / base)

            for cand in candidates:
                if os.path.exists(str(cand)):
                    try:
                        with open(str(cand), "rb") as pf:
                            b = pf.read()
                        from app.engine.face_recognizer import FaceEmbeddingEngine
                        rec = FaceEmbeddingEngine()
                        vec, _ = rec.extract_probe_embedding(b)
                        url_to_emb[u] = vec.tolist()
                        break
                    except Exception as fe:
                        _logger.warning(f"[EmployeeUpdate] Backfill embedding failed for {cand}: {fe}")

    # Deduplicate newly uploaded photos
    upload_items = []
    seen_names = set()
    for p in (photos or []):
        if p and getattr(p, "filename", None):
            fn = getattr(p, "filename")
            if fn not in seen_names:
                seen_names.add(fn)
                upload_items.append(p)
    if photo and getattr(photo, "filename", None):
        fn = getattr(photo, "filename")
        if fn not in seen_names:
            seen_names.add(fn)
            upload_items.append(photo)

    slots_available = max(0, 5 - len(kept_urls))
    upload_items = upload_items[:slots_available]

    new_urls = []
    new_embs = []
    if upload_items:
        from app.engine.face_recognizer import FaceEmbeddingEngine
        rec_engine = FaceEmbeddingEngine()
        ts = int(time.time() * 1000)

        for idx, item in enumerate(upload_items):
            try:
                photo_bytes = await item.read()
                if not photo_bytes:
                    continue
                vector, aligned_face = rec_engine.extract_probe_embedding(photo_bytes)
                photo_filename = f"{emp_id}_{ts}_{idx}.jpg"
                disk_path = settings.FACE_THUMBS_DIR / photo_filename
                with open(str(disk_path), "wb") as pf:
                    pf.write(photo_bytes)
                new_urls.append(f"/face-static/{photo_filename}")
                if vector is not None:
                    new_embs.append(vector.tolist())
                    _logger.info(f"[EmployeeUpdate] Extracted embedding for photo #{idx+1} of {emp_id}")
                else:
                    _logger.info(f"[EmployeeUpdate] Photo #{idx+1} stored as gallery photo (profile angle).")
            except Exception as fe:
                _logger.warning(f"[EmployeeUpdate] Photo #{idx+1} failed: {fe}")

    if existing_photos is not None or upload_items:
        final_urls = []
        final_embs = []
        for u in kept_urls:
            final_urls.append(u)
            emb = url_to_emb.get(u)
            if emb:
                final_embs.append(emb)

        final_urls.extend(new_urls)
        final_embs.extend(new_embs)

        final_urls = final_urls[:5]
        final_embs = final_embs[:len(final_urls)]

        update_fields["photo_urls"] = final_urls
        update_fields["face_embeddings"] = final_embs
        update_fields["photo_url"] = final_urls[0] if final_urls else None
        update_fields["face_embedding"] = final_embs[0] if final_embs else None
        update_fields["photos_count"] = len(final_urls)

    await db["employees"].update_one({"emp_id": emp_id}, {"$set": update_fields})
    updated_emp = await db["employees"].find_one({"emp_id": emp_id})
    p_urls = updated_emp.get("photo_urls") or ([updated_emp.get("photo_url")] if updated_emp.get("photo_url") else [])
    has_emb = bool(updated_emp.get("face_embeddings") or updated_emp.get("face_embedding") or len(p_urls) > 0)
    return {
        "emp_id": emp_id,
        "name": updated_emp.get("name"),
        "email": updated_emp.get("email"),
        "department": updated_emp.get("department"),
        "status": updated_emp.get("status"),
        "photo_url": updated_emp.get("photo_url") or (p_urls[0] if p_urls else None),
        "photo_urls": p_urls,
        "photos_count": len(p_urls),
        "has_face_embedding": has_emb,
        "created_at": updated_emp.get("created_at"),
        "updated_at": updated_emp.get("updated_at")
    }


@router.delete("/employees/{emp_id}")
async def delete_employee(emp_id: str):
    db = get_database()
    emp = await db["employees"].find_one({"emp_id": emp_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    import glob
    import os
    pattern = str(settings.FACE_THUMBS_DIR / f"{emp_id}*.jpg")
    for fpath in glob.glob(pattern):
        try:
            os.remove(fpath)
        except Exception:
            pass

    await db["employees"].delete_one({"emp_id": emp_id})
    return {"success": True, "message": f"Employee {emp.get('name')} deleted successfully"}


@router.post("/face-jobs/{job_id}/identify")
async def reidentify_face_job(job_id: str):
    """
    Re-evaluates an existing face detection job against the current employee database.
    """
    db = get_database()
    jobs_col = db["face_jobs"]
    job = await jobs_col.find_one({"job_id": job_id})
    if not job:
        raise HTTPException(status_code=404, detail="Face job not found")

    faces = job.get("faces", [])
    if not faces:
        return {"job_id": job_id, "faces": [], "message": "No faces in this job"}

    from app.engine.face_recognizer import identify_faces_against_employees
    updated_faces = await identify_faces_against_employees(faces, db, str(settings.FACE_THUMBS_DIR))

    await jobs_col.update_one({"job_id": job_id}, {"$set": {"faces": updated_faces}})
    return {"job_id": job_id, "faces": updated_faces, "status": "completed"}
