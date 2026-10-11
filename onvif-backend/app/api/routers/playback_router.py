from fastapi import APIRouter, Request, Response, Depends, HTTPException, Query, Path
from typing import Optional
import json, os, re, tempfile, urllib.parse
from datetime import datetime, timezone, timedelta
from fastapi.responses import FileResponse
from app.core.security import verify_token
from app.core.database import db as _db
from recorder import rtsp_recorder as recorder
from recorder import encrypt_service
from app.utils.ffmpeg_utils import FFMPEG_BIN


router = APIRouter(tags=["playback"])

def _normalize_enc_path(path: str) -> str:
    if not path:
        return path
    normalized = path.replace("\\", "/").replace("local:", "")
    if not normalized.endswith(".enc"):
        if normalized.startswith("minio:"):
            from app.utils.minio_client import object_exists
            minio_key = normalized.replace("minio:", "")
            try:
                if object_exists(minio_key + ".enc"):
                    return normalized + ".enc"
            except:
                pass
        else:
            if os.path.exists(normalized + ".enc"):
                return normalized + ".enc"
    return normalized

def _find_local_fallback_file(rec_dir: str, ip_prefix: str, alert_local_date: str, alert_local_secs: int, CHUNK_SECONDS: int) -> str | None:
    best_file = None
    best_diff = None
    if not os.path.exists(rec_dir):
        return None
        
    for entry in os.listdir(rec_dir):
        entry_path = os.path.join(rec_dir, entry)
        if not os.path.isdir(entry_path):
            continue
            
        # Sharded folders walk fallback
        if entry.startswith("shard"):
            try:
                for cam_folder in os.listdir(entry_path):
                    if not cam_folder.startswith(ip_prefix):
                        continue
                    date_dir = os.path.join(entry_path, cam_folder, alert_local_date)
                    if not os.path.isdir(date_dir):
                        continue
                    for fname in os.listdir(date_dir):
                        if not (fname.endswith(".enc") or fname.endswith(".mp4")):
                            continue
                        stem = fname.replace(".enc", "").replace(".mp4", "")
                        if "_" in stem:
                            stem = stem.split("_")[-1]
                        try:
                            fparts = re.split(r"[-:]", stem)
                            fh, fm, fs = int(fparts[0]), int(fparts[1]), int(fparts[2])
                            file_secs  = fh * 3600 + fm * 60 + fs
                        except:
                            continue
                        diff = alert_local_secs - file_secs
                        if 0 <= diff <= CHUNK_SECONDS + 30:
                            if best_diff is None or diff < best_diff:
                                best_diff = diff
                                best_file = os.path.join(date_dir, fname)
            except:
                pass
        # Legacy/direct fallback
        elif entry.startswith(ip_prefix):
            date_dir = os.path.join(rec_dir, entry, alert_local_date)
            if os.path.isdir(date_dir):
                for fname in os.listdir(date_dir):
                        if not (fname.endswith(".enc") or fname.endswith(".mp4")):
                            continue
                        stem = fname.replace(".enc", "").replace(".mp4", "")
                        if "_" in stem:
                            stem = stem.split("_")[-1]
                        try:
                            fparts = re.split(r"[-:]", stem)
                            fh, fm, fs = int(fparts[0]), int(fparts[1]), int(fparts[2])
                            file_secs  = fh * 3600 + fm * 60 + fs
                        except:
                            continue
                        diff = alert_local_secs - file_secs
                        if 0 <= diff <= CHUNK_SECONDS + 30:
                            if best_diff is None or diff < best_diff:
                                best_diff = diff
                                best_file = os.path.join(date_dir, fname)
                            
    return best_file

@router.get("/api/event-playback")
def event_playback(
    ip: str = Query(..., max_length=255, pattern=r"^[a-zA-Z0-9._-]+$"), 
    time: str = Query(..., max_length=255), 
    request: Request = None, 
    stream: int = 0
):
    """
    stream=0 (default): returns JSON with clipUrl
    stream=1: returns video/mp4 bytes directly (used by <video src="...">)
    """
    import re, tempfile, subprocess, os
    from datetime import datetime, timezone, timedelta

    CHUNK_SECONDS = 300

    try:
        # print("\n========== ALERT PLAYBACK ==========")
        # print("IP   :", ip)
        # print("TIME :", time)
        # print("STREAM:", stream)

        # ── 1. Parse timestamp ────────────────────────────────────────
        t = time.strip()
        if " " in t:
            t = t.replace(" ", "+")
        t = re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", t)

        try:
            alert_dt = datetime.fromisoformat(t)
        except ValueError:
            t_clean  = re.sub(r"[+-]\d{2}:\d{2}$", "", t).rstrip("Z").strip()
            alert_dt = datetime.fromisoformat(t_clean)

        alert_local_hms  = alert_dt.strftime("%H-%M-%S")
        alert_local_date = alert_dt.strftime("%Y-%m-%d")
        alert_local_secs = (
            alert_dt.hour * 3600 + alert_dt.minute * 60 + alert_dt.second
        )

        if alert_dt.tzinfo is not None:
            alert_utc = alert_dt.astimezone(timezone.utc).replace(tzinfo=None)
        else:
            alert_utc = alert_dt

        print(f"Alert local : {alert_local_date} {alert_local_hms}  ({alert_local_secs}s)")

        # ── 2. Build candidate camera_id list ────────────────────────
        ip_prefix = ip.strip().replace(".", "_")
        recordings_col = _db["recordings"]

        all_cam_ids = recordings_col.distinct(
            "camera_id",
            {"camera_id": {"$regex": f"^{re.escape(ip_prefix)}"}}
        )
        if not all_cam_ids:
            all_cam_ids = [ip_prefix, ip.strip()]

        print(f"Camera IDs  : {all_cam_ids}")

        # ── 3. Find the best chunk in DB ──────────────────────────────
        def find_best_chunk_db(date_str, hms_str):
            query_hms = hms_str.replace("-", ":")
            best = None
            for cam_id in all_cam_ids:
                candidate = recordings_col.find_one(
                    {
                        "camera_id":  cam_id,
                        "date":       date_str,
                        "start_time": {"$lte": query_hms},
                        "status":     {"$in": ["COMPLETE", "INCOMPLETE", "RECORDING"]}
                    },
                    sort=[("start_time", -1)],
                )
                if candidate:
                    if best is None or candidate["start_time"] > best["start_time"]:
                        best = candidate
            return best

        doc = find_best_chunk_db(alert_local_date, alert_local_hms)

        if not doc:
            prev = (alert_dt - timedelta(days=1)).strftime("%Y-%m-%d")
            doc  = find_best_chunk_db(prev, "23-59-59")

        if not doc:
            doc = find_best_chunk_db(
                alert_utc.strftime("%Y-%m-%d"),
                alert_utc.strftime("%H-%M-%S"),
            )

        # ── 4. Validate chunk ─────────────────────────────────────────
        enc_path = None

        if doc:
            try:
                parts = re.split(r"[-:]", doc["start_time"])
                ch, cm, cs = int(parts[0]), int(parts[1]), int(parts[2])
                chunk_secs  = ch * 3600 + cm * 60 + cs
                elapsed     = alert_local_secs - chunk_secs
                print(f"DB chunk    : {doc['start_time']}  elapsed={elapsed:.0f}s")

                actual_duration = float(doc.get("duration_seconds", CHUNK_SECONDS))

                if elapsed <= actual_duration + 2:
                    enc_path = _normalize_enc_path(doc.get("file_path", ""))
                    print(f"DB chunk OK : {enc_path}")
                else:
                    print(f"DB chunk too old ({elapsed:.0f}s > {CHUNK_SECONDS}s) — scanning filesystem")
                    doc = None
            except Exception as e:
                print(f"Elapsed calc error: {e}")

        # ── 5. Filesystem fallback ────────────────────────────────────
        if not enc_path:
            rec_dir   = recorder.get_recordings_dir()
            best_file = None
            best_diff = None

            # First try local filesystem (sharded & legacy support)
            best_file = _find_local_fallback_file(rec_dir, ip_prefix, alert_local_date, alert_local_secs, CHUNK_SECONDS)
            if best_file:
                print(f"FS candidate: {best_file}")
            
            # Then try MinIO
            if not best_file:
                from app.utils import minio_client
                shard = "shard1"
                try:
                    cameras_col = _db["cameras"]
                    cam_doc = cameras_col.find_one({"stream_key": ip_prefix})
                    if cam_doc and cam_doc.get("assigned_worker"):
                        worker_id = cam_doc["assigned_worker"]
                        if "standby" in worker_id:
                            shard = f"shard_{worker_id}"
                        else:
                            idx_val = worker_id.split("-")[-1]
                            shard = f"shard{idx_val}"
                except Exception as ex:
                    print(f"Error resolving camera shard: {ex}")

                parent = minio_client.get_parent_folder()
                prefix = f"{parent}/{shard}/{ip_prefix}/{alert_local_date}/" if parent else f"{shard}/{ip_prefix}/{alert_local_date}/"
                try:
                    objects = minio_client.list_objects(prefix)
                    for obj in objects:
                        if not obj.endswith(".enc"):
                            continue
                        fname = os.path.basename(obj)
                        stem = fname.replace(".enc", "")
                        try:
                            fparts = re.split(r"[-:]", stem)
                            fh, fm, fs = int(fparts[0]), int(fparts[1]), int(fparts[2])
                            file_secs  = fh * 3600 + fm * 60 + fs
                        except Exception:
                            continue
                        diff = alert_local_secs - file_secs
                        if 0 <= diff <= CHUNK_SECONDS + 30:
                            if best_diff is None or diff < best_diff:
                                best_diff = diff
                                best_file = f"minio:{obj}"
                                print(f"MinIO candidate: {best_file} diff={diff:.0f}s")
                except Exception as e:
                    print(f"MinIO fallback error: {e}")

            if best_file:
                enc_path = best_file
                stem     = os.path.basename(best_file).replace(".enc", "")
                fparts   = re.split(r"[-:]", stem)
                fh, fm, fs = int(fparts[0]), int(fparts[1]), int(fparts[2])
                elapsed  = alert_local_secs - (fh * 3600 + fm * 60 + fs)
                print(f"Fallback chunk OK : {enc_path}  elapsed={elapsed:.0f}s")
            else:
                msg = (
                    f"No recording found for IP={ip_prefix} "
                    f"date={alert_local_date} time={alert_local_hms}. "
                    f"Recording may not exist for this alert time."
                )
                print(f"[PLAYBACK] ERROR: {msg}")
                return Response(
                    content=f'{{"error":"{msg}"}}'.encode(),
                    status_code=404,
                    media_type="application/json"
                )

        if not enc_path.startswith("minio:") and not os.path.exists(enc_path):
            return Response(
                content=f'{{"error":"File not found on disk or MinIO: {enc_path}"}}'.encode(),
                status_code=404,
                media_type="application/json",
            )

        # ── 6. Seek offset ────────────────────────────────────────────
        BEFORE   = 10
        AFTER    = 10
        offset   = max(0.0, elapsed - BEFORE)
        duration = BEFORE + AFTER

        print(f"Seek        : offset={offset:.1f}s  duration={duration}s")

        # ── 7 & 8. Decrypt & Extract clip with ffmpeg ─────────────────
        output_path = tempfile.mktemp(suffix=".mp4")
        temp_in_path = tempfile.mktemp(suffix="_decrypted_input.mp4")
        needs_temp_cleanup = True

        try:
            if enc_path.endswith(".mp4") and not enc_path.startswith("minio:"):
                # Instant Playback Fallback: File is a live unencrypted fMP4 chunk
                temp_in_path = enc_path
                needs_temp_cleanup = False
            else:
                if enc_path.startswith("minio:"):
                    from app.utils import minio_client
                    object_key = enc_path.replace("minio:", "")
                    stream = minio_client.get_file_stream(object_key)
                    raw_bytes = stream.read()
                    stream.close()
                    stream.release_conn()
                else:
                    with open(enc_path, "rb") as f:
                        raw_bytes = f.read()

                decrypted_data = encrypt_service.decrypt_bytes_to_io(raw_bytes).getvalue()
                
                # Write decrypted data to a temporary file for fast FFmpeg input seeking
                with open(temp_in_path, "wb") as temp_f:
                    temp_f.write(decrypted_data)
                    
                # Clear decrypted_data from memory now that it's on disk
                del decrypted_data
                
        except Exception as dec_err:
            print(f"[PLAYBACK] Decryption failed: {dec_err}")
            return Response(
                content=f'{{"error":"Decryption failed: {str(dec_err)}"}}'.encode(),
                status_code=500,
                media_type="application/json",
            )

        ffmpeg_cmd = [
            FFMPEG_BIN, "-y",
            "-ss",     str(offset),   # Input seek (instant)
            "-i",      temp_in_path,
            "-t",      str(duration),
            "-c",      "copy",
            "-an",
            "-movflags", "+faststart",
            output_path,
        ]

        try:
            from app.utils.ffmpeg_utils import run_ffmpeg_sync
            success, _, stderr_data = run_ffmpeg_sync(ffmpeg_cmd, timeout=30)
        except Exception as ffmpeg_err:
            print(f"[PLAYBACK] ffmpeg run failed: {ffmpeg_err}")
            success = False
            stderr_data = str(ffmpeg_err).encode()

        if not success:
            print(f"[PLAYBACK] ffmpeg rc error: "
                  f"{stderr_data.decode(errors='replace')[-300:]}")

        if not os.path.exists(output_path) or os.path.getsize(output_path) < 500:
            print("[PLAYBACK] Retrying ffmpeg with offset=0")
            ffmpeg_cmd2 = [
                FFMPEG_BIN, "-y",
                "-i",      temp_in_path,
                "-t",      str(duration),
                "-c",      "copy",
                "-an",
                "-movflags", "+faststart",
                output_path,
            ]
            try:
                run_ffmpeg_sync(ffmpeg_cmd2, timeout=30)
            except Exception:
                pass
                
        # Clean up the temporary input file
        if needs_temp_cleanup and os.path.exists(temp_in_path):
            try:
                os.remove(temp_in_path)
            except Exception as e:
                print(f"[PLAYBACK] Could not remove temp input file: {e}")

        if not os.path.exists(output_path) or os.path.getsize(output_path) < 500:
            return Response(
                content=b'{"error":"Failed to extract clip from recording"}',
                status_code=500,
                media_type="application/json",
            )

        # ── 9. Save clip as encrypted .enc ────────────────────────────
        event_clips_col = _db["event_clips"]

        clips_base    = os.path.join(recorder.get_recordings_dir(), "event_clips")
        ip_folder     = ip.strip().replace(".", "_")
        clip_date     = alert_local_date
        clip_ts       = alert_dt.strftime("%H-%M-%S")
        clip_dir      = os.path.join(clips_base, ip_folder, clip_date)
        os.makedirs(clip_dir, exist_ok=True)

        clip_filename = f"{ip_folder}_{clip_ts}.enc"
        clip_enc_path = os.path.join(clip_dir, clip_filename)
        
        minio_clip_key = f"event_clips/{ip_folder}/{clip_date}/{clip_filename}"

        already_saved = os.path.exists(clip_enc_path)
        # Note: If it's already in MinIO, we might recreate it here but that's fine for caching.
        
        if not already_saved:
            try:
                with open(output_path, "rb") as f:
                    raw_mp4 = f.read()
                encrypted_clip = encrypt_service._aes_encrypt(raw_mp4)
                with open(clip_enc_path, "wb") as f:
                    f.write(encrypted_clip)
                print(f"[CLIP] ✅ Saved encrypted clip locally: {clip_enc_path}")
                
                # Upload event clip to MinIO
                from app.utils import minio_client
                try:
                    minio_client.upload_file(minio_clip_key, clip_enc_path)
                    print(f"[CLIP] ✅ Uploaded event clip to MinIO: {minio_clip_key}")
                except Exception as me:
                    print(f"[CLIP] ❌ MinIO upload failed for clip: {me}")

                event_clips_col.update_one(
                    {"ip": ip, "time": time},
                    {"$set": {
                        "ip":         ip,
                        "time":       time,
                        "date":       clip_date,
                        "file_path":  f"minio:{minio_clip_key}",
                        "saved_at":   datetime.utcnow(),
                        "size_bytes": os.path.getsize(clip_enc_path),
                    }},
                    upsert=True
                )
            except Exception as save_err:
                print(f"[CLIP]  Auto-save failed (non-fatal): {save_err}")
        else:
            print(f"[CLIP] ℹ Clip already exists: {clip_enc_path}")

        # ── 10. Return URL or video bytes based on stream param ───────
        # stream=1 → return video bytes directly (for <video src="...">)
        # stream=0 → return JSON with clip_url (default, for other team)
        if stream == 1:
            # Return video bytes directly
            with open(output_path, "rb") as f:
                clip_data = f.read()
            try:
                os.remove(output_path)
            except Exception:
                pass

            print(f"[STREAM=1] Returning video bytes: {len(clip_data):,} bytes")

            return Response(
                content=clip_data,
                media_type="video/mp4",
                headers={
                    "Content-Type":        "video/mp4",
                    "Content-Length":      str(len(clip_data)),
                    "Content-Disposition": "inline",
                    "Accept-Ranges":       "bytes",
                    "Cache-Control":       "no-store",
                    "Access-Control-Expose-Headers": "Content-Length, Content-Type, X-Server-IP, X-Camera-IP",
                    "X-Server-IP": "192.168.126.200",
                    "X-Camera-IP": ip,
                },
            )

        # stream=0 → return JSON with playable URL
        try:
            os.remove(output_path)
        except Exception:
            pass

        # Dynamically build base URL from the incoming request, fallback to old static IP if request not provided
        if request:
            base_url = str(request.base_url).rstrip("/")
        else:
            base_url = "http://192.168.126.200"

        encoded_time = urllib.parse.quote(time)
        clipUrl = f"{base_url}/api/event-playback/hls/{ip}/{encoded_time}/index.m3u8"

        print(f"[STREAM=0] Returning JSON with HLS clipUrl: {clipUrl}")

        return Response(
                    content=json.dumps({
                        "clipUrl": clipUrl,
                    }).encode(),
                    media_type="application/json",
                )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response(
            content=f'{{"error":"{str(e)}"}}'.encode(),
            status_code=500,
            media_type="application/json",
        )

@router.post("/api/event-playback")
async def event_playback_post(
    request: Request,
    ip: Optional[str] = Query(None),
    time: Optional[str] = Query(None),
    stream: int = Query(0)
):
    body_data = {}
    content_type = request.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        try:
            body_data = await request.json()
        except Exception:
            pass
    elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        try:
            form = await request.form()
            body_data = dict(form)
        except Exception:
            pass

    final_ip = ip or body_data.get("ip")
    final_time = time or body_data.get("time")

    stream_val = body_data.get("stream", stream)
    try:
        final_stream = int(stream_val)
    except (ValueError, TypeError):
        final_stream = 0

    if not final_ip or not final_time:
        raise HTTPException(status_code=400, detail="Missing required query or body parameters: 'ip' and 'time'")

    return event_playback(ip=str(final_ip), time=str(final_time), request=request, stream=final_stream)


@router.get("/api/event-playback/hls/{ip}/{time_str}/{filename}")
def event_playback_hls(ip: str = Path(..., max_length=255, pattern=r"^[a-zA-Z0-9._-]+$"), time_str: str = Path(..., max_length=255), filename: str = Path(..., max_length=1024)):
    """
    Dynamically serves/generates cached HLS chunks (.m3u8 playlist or .ts segments)
    for the 20-second event clip.
    """
    import re, tempfile, subprocess, os, urllib.parse
    from datetime import datetime, timezone, timedelta
    from fastapi.responses import FileResponse
    headers={}


    try:
        time_val = urllib.parse.unquote(time_str)
        ip_folder = ip.strip().replace(".", "_")

        # ── 1. Parse timestamp ────────────────────────────────────────
        t = time_val.strip()
        if " " in t:
            t = t.replace(" ", "+")
        t = re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", t)

        try:
            alert_dt = datetime.fromisoformat(t)
        except ValueError:
            t_clean  = re.sub(r"[+-]\d{2}:\d{2}$", "", t).rstrip("Z").strip()
            alert_dt = datetime.fromisoformat(t_clean)

        alert_local_hms  = alert_dt.strftime("%H-%M-%S")
        alert_local_date = alert_dt.strftime("%Y-%m-%d")
        clip_ts = alert_dt.strftime("%H-%M-%S")
        alert_local_secs = (
            alert_dt.hour * 3600 + alert_dt.minute * 60 + alert_dt.second
        )

        if alert_dt.tzinfo is not None:
            alert_utc = alert_dt.astimezone(timezone.utc).replace(tzinfo=None)
        else:
            alert_utc = alert_dt

        # Path where HLS files are cached on disk
        hls_dir = os.path.join(recorder.get_recordings_dir(), "hls_playback", ip_folder, alert_local_date, clip_ts)
        hls_file_path = os.path.join(hls_dir, filename)

        # ── 2. Dynamic generation if index.m3u8 or requested file is missing ──
        if not os.path.exists(hls_file_path):
            CHUNK_SECONDS = 300
            
            # Find candidate camera IDs
            ip_prefix = ip.strip().replace(".", "_")
            recordings_col = _db["recordings"]

            all_cam_ids = recordings_col.distinct(
                "camera_id",
                {"camera_id": {"$regex": f"^{re.escape(ip_prefix)}"}}
            )
            if not all_cam_ids:
                all_cam_ids = [ip_prefix, ip.strip()]

            def find_best_chunk_db(date_str, hms_str):
                query_hms = hms_str.replace("-", ":")
                best = None
                for cam_id in all_cam_ids:
                    candidate = recordings_col.find_one(
                        {
                            "camera_id":  cam_id,
                            "date":       date_str,
                            "start_time": {"$lte": query_hms},
                            "status":     {"$in": ["COMPLETE", "INCOMPLETE", "RECORDING"]}
                        },
                        sort=[("start_time", -1)],
                    )
                    if candidate:
                        if best is None or candidate["start_time"] > best["start_time"]:
                            best = candidate
                return best

            doc = find_best_chunk_db(alert_local_date, alert_local_hms)

            if not doc:
                prev = (alert_dt - timedelta(days=1)).strftime("%Y-%m-%d")
                doc  = find_best_chunk_db(prev, "23-59-59")

            if not doc:
                doc = find_best_chunk_db(
                    alert_utc.strftime("%Y-%m-%d"),
                    alert_utc.strftime("%H-%M-%S"),
                )

            enc_path = None
            if doc:
                try:
                    parts = re.split(r"[-:]", doc["start_time"])
                    ch, cm, cs = int(parts[0]), int(parts[1]), int(parts[2])
                    chunk_secs  = ch * 3600 + cm * 60 + cs
                    elapsed     = alert_local_secs - chunk_secs

                    actual_duration = float(doc.get("duration_seconds", CHUNK_SECONDS))

                    if elapsed <= actual_duration + 2:
                        enc_path = _normalize_enc_path(doc.get("file_path", ""))
                except Exception:
                    pass

            if not enc_path:
                rec_dir   = recorder.get_recordings_dir()
                best_file = None
                best_diff = None

                # First try local filesystem (sharded & legacy support)
                best_file = _find_local_fallback_file(rec_dir, ip_prefix, alert_local_date, alert_local_secs, CHUNK_SECONDS)

                # Then try MinIO
                if not best_file:
                    from app.utils import minio_client
                    shard = "shard1"
                    try:
                        cameras_col = _db["cameras"]
                        cam_doc = cameras_col.find_one({"stream_key": ip_prefix})
                        if cam_doc and cam_doc.get("assigned_worker"):
                            worker_id = cam_doc["assigned_worker"]
                            if "standby" in worker_id:
                                shard = f"shard_{worker_id}"
                            else:
                                idx_val = worker_id.split("-")[-1]
                                shard = f"shard{idx_val}"
                    except Exception as ex:
                        print(f"Error resolving camera shard in HLS: {ex}")

                    parent = minio_client.get_parent_folder()
                    prefix = f"{parent}/{shard}/{ip_prefix}/{alert_local_date}/" if parent else f"{shard}/{ip_prefix}/{alert_local_date}/"
                    try:
                        objects = minio_client.list_objects(prefix)
                        for obj in objects:
                            if not obj.endswith(".enc"):
                                continue
                            fname = os.path.basename(obj)
                            stem = fname.replace(".enc", "")
                            try:
                                fparts = re.split(r"[-:]", stem)
                                fh, fm, fs = int(fparts[0]), int(fparts[1]), int(fparts[2])
                                file_secs  = fh * 3600 + fm * 60 + fs
                            except Exception:
                                continue
                            diff = alert_local_secs - file_secs
                            if 0 <= diff <= CHUNK_SECONDS + 30:
                                if best_diff is None or diff < best_diff:
                                    best_diff = diff
                                    best_file = f"minio:{obj}"
                    except Exception:
                        pass

                if best_file:
                    enc_path = best_file
                    stem     = os.path.basename(best_file).replace(".enc", "")
                    fparts   = re.split(r"[-:]", stem)
                    fh, fm, fs = int(fparts[0]), int(fparts[1]), int(fparts[2])
                    elapsed  = alert_local_secs - (fh * 3600 + fm * 60 + fs)
                else:
                    return Response(
                        content=b'{"error":"No recording found for this alert"}',
                        status_code=404,
                        media_type="application/json",
                        headers=headers,
                    )

            if not enc_path.startswith("minio:") and not os.path.exists(enc_path):
                return Response(
                    content=f'{{"error":"File not found on disk or MinIO: {enc_path}"}}'.encode(),
                    status_code=404,
                    media_type="application/json",
                    headers=headers,
                )

            # Seek offset parameters (10s before, 10s after)
            BEFORE   = 10
            AFTER    = 10
            offset   = max(0.0, elapsed - BEFORE)
            duration = BEFORE + AFTER

            # Decrypt recording
            # Extract 20s clip to temporary MP4
            output_path = tempfile.mktemp(suffix=".mp4")
            temp_in_path = tempfile.mktemp(suffix="_decrypted_input.mp4")

            try:
                # Write fully decrypted data to temporary file for fast FFmpeg input seeking
                with open(temp_in_path, "wb") as temp_f:
                    for chunk in encrypt_service.decrypt_file_stream(enc_path):
                        temp_f.write(chunk)
            except Exception as dec_err:
                if os.path.exists(temp_in_path):
                    os.remove(temp_in_path)
                return Response(
                    content=f'{{"error":"Decryption failed: {str(dec_err)}"}}'.encode(),
                    status_code=500,
                    media_type="application/json",
                    headers=headers,
                )

            ffmpeg_cmd = [
                FFMPEG_BIN, "-y",
                "-ss",     str(offset),   # Input seek
                "-i",      temp_in_path,
                "-t",      str(duration),
                "-c",      "copy",
                "-an",
                "-movflags", "+faststart",
                output_path,
            ]

            try:
                from app.utils.ffmpeg_utils import run_ffmpeg_sync
                run_ffmpeg_sync(ffmpeg_cmd, timeout=30)
            except Exception:
                pass

            if not os.path.exists(output_path) or os.path.getsize(output_path) < 500:
                # Retry with offset=0
                ffmpeg_cmd2 = [
                    FFMPEG_BIN, "-y",
                    "-i",      temp_in_path,
                    "-t",      str(duration),
                    "-c",      "copy",
                    "-an",
                    "-movflags", "+faststart",
                    output_path,
                ]
                try:
                    run_ffmpeg_sync(ffmpeg_cmd2, timeout=30)
                except Exception:
                    pass
                    
            if os.path.exists(temp_in_path):
                try:
                    os.remove(temp_in_path)
                except Exception:
                    pass

            if not os.path.exists(output_path) or os.path.getsize(output_path) < 500:
                return Response(
                    content=b'{"error":"Failed to extract MP4 clip from recording"}',
                    status_code=500,
                    media_type="application/json",
                    headers=headers,
                )

            # Segment MP4 into HLS format inside hls_dir
            os.makedirs(hls_dir, exist_ok=True)
            ffmpeg_hls = [
                FFMPEG_BIN, "-y",
                "-i", output_path,
                "-codec", "copy",
                "-start_number", "0",
                "-hls_time", "2",
                "-hls_list_size", "0",
                "-f", "hls",
                os.path.join(hls_dir, "index.m3u8")
            ]
            from app.utils.ffmpeg_utils import run_ffmpeg_sync
            run_ffmpeg_sync(ffmpeg_hls, capture_stderr=False)

            # Cleanup temp MP4
            try:
                os.remove(output_path)
            except Exception:
                pass

        if not os.path.exists(hls_file_path):
            return Response(
                content=b'{"error":"HLS file not found on disk"}',
                status_code=404,
                media_type="application/json",
                headers=headers,
            )

        # Serve the requested HLS index or segment
        if filename.endswith(".m3u8"):
            return FileResponse(hls_file_path, media_type="application/x-mpegURL", headers=headers)
        elif filename.endswith(".ts"):
            return FileResponse(hls_file_path, media_type="video/MP2T", headers=headers)
        else:
            return FileResponse(hls_file_path, headers=headers)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response(
            content=f'{{"error":"{str(e)}"}}'.encode(),
            status_code=500,
            media_type="application/json",
            headers=headers,
        )


# ------------------------------------------------------------------
# Debug
# ------------------------------------------------------------------

@router.get("/api/event-clips", dependencies=[Depends(verify_token)])
def list_event_clips(ip: str = None, limit: int = 50):
    """List all saved event clips, optionally filtered by IP."""
    event_clips_col = _db["event_clips"]
    query = {}
    if ip:
        query["ip"] = ip
    docs = list(
        event_clips_col.find(query, {"_id": 0})
        .sort("saved_at", -1)
        .limit(limit)
    )
    for d in docs:
        if "saved_at" in d and hasattr(d["saved_at"], "isoformat"):
            d["saved_at"] = d["saved_at"].isoformat()
    return {"clips": docs}


@router.get("/api/event-clip/play", dependencies=[Depends(verify_token)])
def play_event_clip(ip: str = Path(..., max_length=255, pattern=r"^[a-zA-Z0-9.-]+$"), time: str = Path(..., max_length=255)):
    """Decrypt and stream a saved event clip."""
    event_clips_col = _db["event_clips"]

    doc = event_clips_col.find_one({"ip": ip, "time": time})
    if not doc:
        return Response(
            content=b'{"error":"Clip not found"}',
            status_code=404,
            media_type="application/json",
        )

    enc_path = doc.get("file_path", "")
    if not enc_path.startswith("minio:") and not os.path.exists(enc_path):
        return Response(
            content=b'{"error":"Clip file missing on disk or MinIO"}',
            status_code=404,
            media_type="application/json",
        )

    from fastapi.responses import StreamingResponse

    def stream_generator():
        try:
            yield from encrypt_service.decrypt_file_stream(enc_path)
        except Exception as e:
            print(f"[PLAY EVENT CLIP] Stream error: {e}")

    return StreamingResponse(
        stream_generator(),
        media_type="video/mp4",
        headers={
            "Content-Disposition": "inline",
            "Accept-Ranges":       "bytes",
            "Cache-Control":       "no-store",
            "Access-Control-Expose-Headers": "Content-Length, Content-Type",
        },
    )


@router.post("/api/event-clip/save", dependencies=[Depends(verify_token)])
async def manual_save_clip(request: Request):
    """
    Manual save — called from UI Save button.
    Body: { "ip": "...", "time": "..." }
    Triggers event-playback internally and saves the clip.
    """
    body = await request.json()
    ip   = body.get("ip")
    time_str = body.get("time")

    if not ip or not time_str:
        raise HTTPException(status_code=400, detail="ip and time required")

    event_clips_col = _db["event_clips"]

    # Check if already saved
    existing = event_clips_col.find_one({"ip": ip, "time": time_str})
    if existing and os.path.exists(existing.get("file_path", "")):
        return {"success": True, "message": "Already saved", "already_existed": True}

    # Re-use the playback logic to get the clip bytes, then save
    from datetime import datetime as dt
    import re as _re

    try:
        # Parse time
        t = time_str.strip()
        if " " in t:
            t = t.replace(" ", "+")
        t = _re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", t)
        try:
            alert_dt = dt.fromisoformat(t)
        except ValueError:
            t_clean  = _re.sub(r"[+-]\d{2}:\d{2}$", "", t).rstrip("Z").strip()
            alert_dt = dt.fromisoformat(t_clean)

        clip_date  = alert_dt.strftime("%Y-%m-%d")
        clip_ts    = alert_dt.strftime("%H-%M-%S")
        ip_folder  = ip.strip().replace(".", "_")
        clips_base = os.path.join(recorder.get_recordings_dir(), "event_clips")
        clip_dir   = os.path.join(clips_base, ip_folder, clip_date)
        os.makedirs(clip_dir, exist_ok=True)

        clip_enc_path = os.path.join(clip_dir, f"{ip_folder}_{clip_ts}.enc")

        # Call event_playback internally to get the raw mp4 bytes
        # We do this by calling the function directly
        resp = event_playback(ip=ip, time=time_str)

        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="Recording not found for this alert")

        raw_mp4 = resp.body

        # Encrypt and save
        encrypted_clip = encrypt_service._aes_encrypt(raw_mp4)
        with open(clip_enc_path, "wb") as f:
            f.write(encrypted_clip)

        event_clips_col.update_one(
            {"ip": ip, "time": time_str},
            {"$set": {
                "ip":         ip,
                "time":       time_str,
                "date":       clip_date,
                "file_path":  clip_enc_path.replace("\\", "/"),
                "saved_at":   dt.utcnow(),
                "size_bytes": len(encrypted_clip),
            }},
            upsert=True
        )

        print(f"[CLIP] ✅ Manually saved: {clip_enc_path}")
        return {"success": True, "message": "Clip saved", "file": clip_enc_path}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Save failed: {str(e)}")

# ------------------------------------------------------------------
# Register features router last (routes are defined above)
# ------------------------------------------------------------------

import glob
from fastapi import HTTPException

# -----------------------------------------------------------------
# NEW ISOLATED INSTANT BUFFER PLAYBACK LOGIC
# -----------------------------------------------------------------

@router.get("/api/instant-buffer/hls/{ip}/{time_str}/index.m3u8")
def instant_buffer_m3u8(ip: str, time_str: str, request: Request):
    """
    Generates a dynamic 20-second HLS playlist from the rolling buffer.
    """
    import urllib.parse
    
    time_val = urllib.parse.unquote(time_str)
    t = time_val.strip()
    if " " in t: t = t.replace(" ", "+")
    t = re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", t)
    
    try:
        alert_dt = datetime.fromisoformat(t)
    except ValueError:
        t_clean  = re.sub(r"[+-]\d{2}:\d{2}$", "", t).rstrip("Z").strip()
        alert_dt = datetime.fromisoformat(t_clean)
        
    ip_folder = ip.strip().replace(".", "_")
    cam_dir = os.path.join(recorder.get_recordings_dir(), "instant_buffer", ip_folder)
    
    if not os.path.exists(cam_dir):
        raise HTTPException(status_code=404, detail="Instant buffer not found for this camera")
        
    enc_files = glob.glob(os.path.join(cam_dir, "*.ts.enc"))
    if not enc_files:
        raise HTTPException(status_code=404, detail="No segments currently in buffer")
        
    enc_files.sort()
    
    target_start = alert_dt - timedelta(seconds=10)
    target_end = alert_dt + timedelta(seconds=10)
    
    selected_files = []
    
    for fpath in enc_files:
        fname = os.path.basename(fpath)
        try:
            time_part = fname.replace(".ts.enc", "")
            file_dt = datetime.strptime(time_part, "%Y%m%d_%H%M%S")
            file_end_dt = file_dt + timedelta(seconds=10)
            
            if file_dt <= target_end and file_end_dt >= target_start:
                selected_files.append(fname)
        except Exception:
            continue
            
    if not selected_files:
        raise HTTPException(status_code=404, detail="No segments overlap with the alert time")
        
    base_url = str(request.base_url).rstrip("/")
    m3u8_content = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:10",
        "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:EVENT"
    ]
    
    for fname in selected_files:
        m3u8_content.append("#EXTINF:10.0,")
        m3u8_content.append(f"{base_url}/api/instant-buffer/hls/{ip}/{time_str}/{fname}")
        
    m3u8_content.append("#EXT-X-ENDLIST")
    
    return Response(
        content="\n".join(m3u8_content).encode(),
        media_type="application/vnd.apple.mpegurl",
        headers={"Access-Control-Allow-Origin": "*"}
    )

@router.get("/api/instant-buffer/hls/{ip}/{time_str}/{filename}")
def instant_buffer_segment(ip: str, time_str: str, filename: str):
    """
    Serves a specific .ts.enc segment from the rolling buffer, decrypting it on the fly.
    """
    ip_folder = ip.strip().replace(".", "_")
    file_path = os.path.join(recorder.get_recordings_dir(), "instant_buffer", ip_folder, filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Segment not found")
        
    try:
        with open(file_path, "rb") as f:
            enc_data = f.read()
            
        from app.services.encryption_service import encrypt_service
        dec_data = encrypt_service._aes_decrypt(enc_data)
        
        return Response(
            content=dec_data,
            media_type="video/mp2t",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Decryption failed: {str(e)}")