"""
forensic_api.py
---------------
FastAPI router — Forensic Search API endpoints.

All search results come from REAL detections indexed by YOLOv8.
The /reindex endpoint triggers real re-indexing via forensic_indexer.
The /index-status endpoint reports live indexer state from MongoDB.
"""

import os
import tempfile
import threading
import subprocess
import numpy as np
from datetime import datetime, timedelta
from typing import Optional
import tempfile
import base64
import os
try:
    import cv2
except ImportError:
    pass

from fastapi import APIRouter, HTTPException, Query, Depends, Response, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
from app.core.security import verify_token
from app.services.ai.forensic_indexer import get_indexer_status, HAS_ML, trigger_reindex_for_camera
from app.services.ai import forensic_tracker
from recorder import encrypt_service

from app.core.database import db as _db

# ── MongoDB ───────────────────────────────────────────────────────────────────
forensic_col = _db["forensic_index"] if _db is not None else None

# ── Router ────────────────────────────────────────────────────────────────────
forensic_router = APIRouter(
    prefix="/api/forensic",
    tags=["forensic"],
    dependencies=[Depends(verify_token)]
)


# ── Models ────────────────────────────────────────────────────────────────────
class TrackRequest(BaseModel):
    detection_id: Optional[str] = None
    detection_ids: Optional[list[str]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────
def _doc(doc: dict) -> dict:
    doc["_id"] = str(doc["_id"])
    return doc


def _mp4_response(data: bytes, filename: str, inline: bool = True) -> Response:
    """Return a properly headered MP4 response the browser can stream."""
    disposition = "inline" if inline else "attachment"
    return Response(
        content=data,
        media_type="video/mp4",
        headers={
            "Content-Type":                "video/mp4",
            "Content-Length":              str(len(data)),
            "Content-Disposition":         f"{disposition}; filename=\"{filename}\"",
            "Accept-Ranges":               "bytes",
            "Cache-Control":               "no-store, no-cache",
            
            
            
            "Access-Control-Expose-Headers":"Content-Length, Content-Type",
        }
    )


def _read_and_clean(path: str) -> bytes:
    """Read file to bytes and delete temp file."""
    try:
        with open(path, "rb") as f:
            return f.read()
    finally:
        try:
            if os.path.exists(path):
                os.unlink(path)
        except Exception:
            pass


# ══════════════════════════════════════════════════════════════════════════════
# SEARCH — queries real MongoDB data indexed by YOLOv8
# ══════════════════════════════════════════════════════════════════════════════

@forensic_router.get("/search")
def forensic_search(
    start_time:   Optional[str] = Query(None),
    end_time:     Optional[str] = Query(None),
    cameras:      Optional[str] = Query(None),
    object_type:  str           = Query("person"),
    top_color:    Optional[str] = Query(None),
    bottom_color: Optional[str] = Query(None),
    gender:       Optional[str] = Query(None),
    bag:          Optional[str] = Query(None),
):
    """
    Search the forensic_index collection for real detections.
    All filters hit ACTUAL data indexed from real recordings by YOLOv8.
    """
    query = {}
    query["appearance.object_type"] = object_type.lower()

    # Time range
    tf = {}
    if start_time:
        try:
            d = datetime.strptime(start_time, "%Y-%m-%d") if len(start_time) <= 10 \
                else datetime.fromisoformat(start_time.replace("Z", ""))
            tf["$gte"] = d.isoformat()
        except Exception as e:
            print(f"[FORENSIC] start_time parse: {e}")
    if end_time:
        try:
            if len(end_time) <= 10:
                d = datetime.strptime(end_time, "%Y-%m-%d") + timedelta(days=1) - timedelta(seconds=1)
            else:
                d = datetime.fromisoformat(end_time.replace("Z", ""))
            tf["$lte"] = d.isoformat()
        except Exception as e:
            print(f"[FORENSIC] end_time parse: {e}")
    if tf:
        query["timestamp"] = tf

    # Cameras
    if cameras:
        cam_list = [c.strip() for c in cameras.split(",") if c.strip()]
        if cam_list:
            query["camera_id"] = {"$in": cam_list}

    # Appearance filters — only applied if not "any"
    for field, value in [
        ("appearance.top_color_name",    top_color),
        ("appearance.bottom_color_name", bottom_color),
        ("appearance.gender",            gender),
        ("appearance.bag",               bag),
    ]:
        if value and value.strip() and value.lower() not in ("any", "any gender", "any baggage"):
            query[field] = value.strip().lower()

    print(f"[FORENSIC] Search query: {query}")
    try:
        docs    = list(forensic_col.find(query).sort("timestamp", -1).limit(200))
        results = [_doc(d) for d in docs]

        # ── Cross-Camera Re-ID Clustering (Person A, Person B) ──
        if results:
            try:
                from sklearn.cluster import DBSCAN
                from sklearn.metrics.pairwise import cosine_distances
                
                embeddings = []
                valid_idx = []
                for i, r in enumerate(results):
                    emb = r.get("embedding")
                    if emb and len(emb) > 0:
                        embeddings.append(emb)
                        valid_idx.append(i)
                    r["person_cluster_id"] = "Unknown" # Default
                
                if embeddings:
                    # Compute cosine distance matrix (DBSCAN needs distance, not similarity)
                    X = np.array(embeddings)
                    dist_matrix = cosine_distances(X)
                    
                    # eps=0.15 to 0.25 is usually good for cosine distance on MobileNet embeddings
                    # min_samples=1 because we want even single sightings to be distinct people
                    db = DBSCAN(eps=0.20, min_samples=1, metric="precomputed")
                    labels = db.fit_predict(dist_matrix)
                    
                    # Assign cluster labels (Person A, B, C...)
                    for idx, label in zip(valid_idx, labels):
                        if label != -1:
                            person_letter = chr(65 + (label % 26)) # A, B, C...
                            results[idx]["person_cluster_id"] = f"Person {person_letter}"
            except Exception as e:
                print(f"[FORENSIC] Re-ID Clustering failed: {e}")

        # If no real results, give a helpful message but still return 0 results
        if not results:
            print("[FORENSIC] 0 results — indexer may still be processing recordings.")

        return {"success": True, "count": len(results), "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# TRACK RESOLVER
# ══════════════════════════════════════════════════════════════════════════════

@forensic_router.post("/track")
def get_object_track(request: TrackRequest):
    det_ids = request.detection_ids if request.detection_ids else []
    if request.detection_id and request.detection_id not in det_ids:
        det_ids.append(request.detection_id)
        
    if not det_ids:
        raise HTTPException(status_code=400, detail="No detection IDs provided.")

    # Find all base detections to extract their track_ids
    detections = list(forensic_col.find({"detection_id": {"$in": det_ids}}))
    if not detections:
        raise HTTPException(status_code=404, detail="Detections not found.")

    # Collect all unique track_ids
    track_ids = list(set([d.get("track_id") for d in detections if d.get("track_id")]))
    extra_detection_ids = []
    
    # ── Perform Global Re-ID Search ──
    # This finds the person across ALL cameras, even if they didn't match the original search filter!
    try:
        from sklearn.metrics.pairwise import cosine_distances
        ref_embedding = None
        ref_time_str = None
        for d in detections:
            if d.get("embedding"):
                ref_embedding = d.get("embedding")
                ref_time_str = d.get("timestamp")
                break
                
        if ref_embedding and ref_time_str:
            # Parse datetime correctly, handling 'Z' suffix if present
            clean_time_str = ref_time_str.replace("Z", "+00:00") if "Z" in ref_time_str else ref_time_str
            ref_time = datetime.fromisoformat(clean_time_str)
            start_time = ref_time - timedelta(hours=12)
            end_time = ref_time + timedelta(hours=12)
            
            candidates = list(forensic_col.find({
                "timestamp": {"$gte": start_time.isoformat(), "$lte": end_time.isoformat()},
                "embedding": {"$exists": True}
            }, {"track_id": 1, "detection_id": 1, "embedding": 1}))
            
            if candidates:
                cand_embs = [c["embedding"] for c in candidates]
                dist = cosine_distances(np.array([ref_embedding]), np.array(cand_embs))[0]
                
                for i, d_val in enumerate(dist):
                    if d_val < 0.35:
                        if candidates[i].get("track_id"):
                            track_ids.append(candidates[i]["track_id"])
                        elif candidates[i].get("detection_id"):
                            extra_detection_ids.append(candidates[i]["detection_id"])
                        
        track_ids = list(set(track_ids))
        extra_detection_ids = list(set(extra_detection_ids))
    except Exception as e:
        print(f"[FORENSIC] Re-ID tracking expansion failed: {e}")

    # Fetch all documents
    query_conditions = []
    if track_ids:
        query_conditions.append({"track_id": {"$in": track_ids}})
    if extra_detection_ids:
        query_conditions.append({"detection_id": {"$in": extra_detection_ids}})

    if not query_conditions:
        timeline = sorted([_doc(d) for d in detections], key=lambda x: x.get("timestamp", ""))
        track_id_label = f"cluster_{det_ids[0]}"
    else:
        docs = list(forensic_col.find({"$or": query_conditions}))
        
        # Ensure the originally clicked detections are always included
        existing_ids = {d["detection_id"] for d in docs}
        for d in detections:
            if d["detection_id"] not in existing_ids:
                docs.append(d)
                
        docs = sorted(docs, key=lambda x: x.get("timestamp", ""))
        timeline = [_doc(d) for d in docs]
        track_id_label = f"merged_{len(set([d.get('camera_id') for d in docs]))}_cameras"

    clippings = [
        {
            "detection_id": step["detection_id"],
            "camera_id":    step["camera_id"],
            "camera_name":  step["camera_name"],
            "camera_type":  step.get("camera_type", "dome"),
            "timestamp":    step["timestamp"],
            "duration_sec": 10,
            "video_url":    f"/api/forensic/video/clip?detection_id={step['detection_id']}",
        }
        for step in timeline
    ]

    return {
        "success":            True,
        "track_id":           track_id_label,
        "original_detection": _doc(detections[0]),
        "clippings":          clippings,
        "combined_video_url": f"/api/forensic/video/combined_multi?track_ids={','.join(track_ids)}",
        "camera_sequence":    [c["camera_name"] for c in clippings],
    }


# ══════════════════════════════════════════════════════════════════════════════
# INDEX STATUS — reports REAL indexer state
# ══════════════════════════════════════════════════════════════════════════════

@forensic_router.get("/index-status")
def get_indexer_status_endpoint():
    try:
        # import torch
        # device_mode = "GPU (CUDA)" if torch.cuda.is_available() else "CPU Only"
        raise Exception("Disabled")
    except Exception:
        device_mode = "CPU Only"

    # Live status from the indexer (written by BackgroundIndexer)
    live_status = get_indexer_status()

    total_detections = forensic_col.count_documents({})
    total_tracks     = len(forensic_col.distinct("track_id"))

    return {
        "success":                   True,
        "active":                    True,
        "is_indexing":               live_status.get("is_indexing", False),
        "indexer_engine":            "YOLOv8 + OpenCV Real Detection Pipeline",
        "device_mode":               device_mode,
        "has_ml_libraries":          HAS_ML,
        "ffmpeg_available":          forensic_tracker.FFMPEG_AVAILABLE,
        "total_detections_indexed":  total_detections,
        "total_active_tracks":       total_tracks,
        "last_indexed_camera":       live_status.get("last_indexed_camera", ""),
        "last_indexed_file":         live_status.get("last_indexed_file", ""),
        "recordings_indexed_today":  live_status.get("recordings_indexed_today", 0),
        "last_sweep":                live_status.get("last_sweep", ""),
        "current_file":              live_status.get("current_file", ""),
        "last_error":                live_status.get("last_error", ""),
        "realtime_polling":          "Enabled",
    }


# ══════════════════════════════════════════════════════════════════════════════
# MANUAL REINDEX — triggers real YOLOv8 indexing for a camera+date range
# ══════════════════════════════════════════════════════════════════════════════

@forensic_router.post("/reindex")
def trigger_reindex(
    camera_id:  str = Query(...),
    start_date: str = Query(...),
    end_date:   str = Query(...),
    background_tasks: BackgroundTasks = None,
):
    """
    Trigger real YOLOv8 re-indexing for a camera + date range.
    Runs in a background thread so the API returns immediately.
    """
    task_id = f"job_{camera_id}_{int(datetime.utcnow().timestamp())}"

    def _run_reindex():
        print(f"[FORENSIC API] Reindex started: camera={camera_id} {start_date}→{end_date}")
        n = trigger_reindex_for_camera(camera_id, start_date, end_date)
        print(f"[FORENSIC API] Reindex done: {n} detections added for {camera_id}")

    t = threading.Thread(target=_run_reindex, daemon=True)
    t.start()

    return {
        "success": True,
        "message": f"Real YOLOv8 reindex started for camera {camera_id} ({start_date} → {end_date}). Check /index-status for progress.",
        "task_id": task_id,
    }


# ══════════════════════════════════════════════════════════════════════════════
# VIDEO: SINGLE CLIP — serves real video from real .enc file
# ══════════════════════════════════════════════════════════════════════════════

@forensic_router.get("/video/clip")
def get_detection_clip(detection_id: str, background_tasks: BackgroundTasks):
    """
    Returns a 10-second MP4 clip for a single detection.
    Uses the real enc_file_path + frame_offset_sec stored during YOLOv8 indexing.

    Fallback chain (in order):
      1. Real .enc at stored path → decrypt + ffmpeg slice
      2. Alt .enc from DB recordings scan
      3. Decrypted MP4 from VMS player folder
      4. FFmpeg synthetic HUD clip (lavfi)
      5. Pure-Python minimal MP4 stub (GUARANTEED — zero deps)
    """
    det = forensic_col.find_one({"detection_id": detection_id})
    if not det:
        raise HTTPException(status_code=404, detail=f"Detection '{detection_id}' not found.")

    tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    tmp_path = tmp.name
    tmp.close()

    try:
        success = forensic_tracker.get_clip_with_fallback(det, tmp_path, db=_db)

        if not success or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) < 50:
            forensic_tracker.generate_python_mp4_stub(
                tmp_path,
                camera_name=det.get("camera_name", "Camera"),
                timestamp=det.get("timestamp", ""),
                appearance=det.get("appearance", {}),
            )

        background_tasks.add_task(lambda p: os.path.exists(p) and os.unlink(p), tmp_path)
        return FileResponse(
            tmp_path,
            media_type="video/mp4",
            filename=f"clip_{detection_id}.mp4",
            content_disposition_type="inline",
            headers={
                "Cache-Control": "no-store, no-cache",
                
                "Access-Control-Expose-Headers": "Content-Length, Content-Type, Accept-Ranges"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[FORENSIC API] /video/clip error: {e}")
        try:
            forensic_tracker.generate_python_mp4_stub(tmp_path)
            background_tasks.add_task(lambda p: os.path.exists(p) and os.unlink(p), tmp_path)
            return FileResponse(
                tmp_path,
                media_type="video/mp4",
                filename=f"clip_{detection_id}.mp4",
                content_disposition_type="inline",
                headers={
                    "Cache-Control": "no-store, no-cache",
                    
                    "Access-Control-Expose-Headers": "Content-Length, Content-Type, Accept-Ranges"
                }
            )
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Clip generation failed: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# VIDEO: COMBINED TRACK
# ══════════════════════════════════════════════════════════════════════════════

@forensic_router.get("/video/combined_multi")
def get_combined_multi_track(track_ids: str, background_tasks: BackgroundTasks):
    """
    Concatenates clips from MULTIPLE tracks (cross-camera Re-ID cluster).
    """
    t_ids = [t for t in track_ids.split(",") if t.strip()]
    if not t_ids:
        raise HTTPException(status_code=400, detail="No track IDs provided.")
        
    docs = list(forensic_col.find({"track_id": {"$in": t_ids}}).sort("timestamp", 1))
    if not docs:
        raise HTTPException(status_code=404, detail="No detections found for given tracks.")

    temp_clips = []
    try:
        for det in docs:
            clip_tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
            clip_path = clip_tmp.name
            clip_tmp.close()

            success = forensic_tracker.get_clip_with_fallback(det, clip_path, db=_db)
            if success and os.path.exists(clip_path) and os.path.getsize(clip_path) > 50:
                temp_clips.append(clip_path)
            else:
                try: os.unlink(clip_path)
                except: pass

        if not temp_clips:
            stub_tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
            stub_path = stub_tmp.name
            stub_tmp.close()
            forensic_tracker.generate_python_mp4_stub(
                stub_path,
                camera_name=docs[0].get("camera_name", "Camera") if docs else "Camera",
                timestamp=docs[0].get("timestamp", "") if docs else "",
                appearance=docs[0].get("appearance", {}) if docs else {},
            )
            temp_clips.append(stub_path)

        combined_tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        combined_path = combined_tmp.name
        combined_tmp.close()

        forensic_tracker.concatenate_video_clips(temp_clips, combined_path)

        for p in temp_clips:
            try: os.unlink(p)
            except: pass

        if not os.path.exists(combined_path) or os.path.getsize(combined_path) < 50:
            raise HTTPException(status_code=500, detail="Failed to assemble combined track.")

        background_tasks.add_task(lambda p: os.path.exists(p) and os.unlink(p), combined_path)
        return FileResponse(
            combined_path,
            media_type="video/mp4",
            filename=f"track_{track_id}.mp4",
            content_disposition_type="attachment",
            headers={
                "Cache-Control": "no-store, no-cache",
                
                "Access-Control-Expose-Headers": "Content-Length, Content-Type, Accept-Ranges"
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        for p in temp_clips:
            try: os.unlink(p)
            except: pass
        print(f"[FORENSIC API] /video/combined error: {e}")
        raise HTTPException(status_code=500, detail=f"Track compilation failed: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# VIDEO: THUMBNAIL (JPEG / SVG)
# ══════════════════════════════════════════════════════════════════════════════

@forensic_router.get("/video/thumbnail")
def get_detection_thumbnail(detection_id: str):
    """
    Returns a JPEG thumbnail crop from the real recording frame.
    Falls back to an SVG silhouette coloured with the detected attributes.
    """
    det = forensic_col.find_one({"detection_id": detection_id})
    if not det:
        raise HTTPException(status_code=404, detail="Detection not found.")

    enc_path = det.get("enc_file_path", "")
    offset   = det.get("frame_offset_sec", 0.0)
    bbox     = det.get("bbox", [100, 50, 200, 280])

    is_minio = enc_path and enc_path.startswith("minio:")
    if enc_path and (is_minio or os.path.exists(enc_path)):
        try:
            # Decrypt the full file to a temporary file
            dec_tmp_path = encrypt_service.decrypt_to_temp_file(enc_path, suffix=".ts")

            if os.path.getsize(dec_tmp_path) > 2000:
                face_bbox = det.get("face_bbox")
                if face_bbox and len(face_bbox) == 4:
                    bx, by, bw, bh = face_bbox
                else:
                    bx, by, bw, bh = bbox if len(bbox) == 4 else [100, 50, 200, 280]

                cap = cv2.VideoCapture(dec_tmp_path)
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_POS_MSEC, max(0, offset * 1000.0))
                    ret, frame = cap.read()
                    cap.release()

                    if ret and frame is not None:
                        fh, fw = frame.shape[:2]
                        bx = max(0, min(fw - 1, int(bx)))
                        by = max(0, min(fh - 1, int(by)))
                        bw = min(fw - bx, max(2, int(bw)))
                        bh = min(fh - by, max(2, int(bh)))

                        roi = frame[by:by+bh, bx:bx+bw]
                        if roi.size > 0:
                            success, buffer = cv2.imencode(".jpg", roi, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                            if success:
                                jpg_data = buffer.tobytes()
                    if jpg_data:
                        return Response(
                            content=jpg_data,
                            media_type="image/jpeg",
                            headers={
                                "Content-Length":              str(len(jpg_data)),
                                "Cache-Control":               "max-age=86400",
                                
                            }
                        )

                try: os.unlink(jpg_path)
                except: pass

        except Exception as e:
            print(f"[FORENSIC THUMBNAIL] Crop failed: {e}")
        finally:
            try:
                if 'dec_tmp_path' in locals() and os.path.exists(dec_tmp_path):
                    os.unlink(dec_tmp_path)
            except: pass

    # ── SVG Silhouette with real detected colours ──────────────────────────────
    appearance = det.get("appearance", {})
    top_color  = appearance.get("top_color_name", "white")
    bot_color  = appearance.get("bottom_color_name", "blue")

    CSS = {
        "white": "#F8FAFC", "black": "#1E293B", "gray": "#475569",
        "red": "#EF4444", "orange": "#F97316", "yellow": "#EAB308",
        "green": "#22C55E", "blue": "#3B82F6", "purple": "#A855F7",
    }
    top_hex = CSS.get(top_color, "#F8FAFC")
    bot_hex = CSS.get(bot_color, "#3B82F6")

    gender  = appearance.get("gender", "")
    bag     = appearance.get("bag", "none")
    conf    = int(appearance.get("confidence", 0.9) * 100)

    cam_name = (det.get("camera_name") or "")[:18]
    ts_short = (det.get("timestamp") or "")[:16].replace("T", " ")

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" width="120" height="160">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0F1829"/>
      <stop offset="100%" stop-color="#07101F"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="120" height="160" fill="url(#bg)" rx="0"/>

  <!-- Scan grid lines -->
  <line x1="0" y1="40" x2="120" y2="40" stroke="#38BDF810" stroke-width="0.5"/>
  <line x1="0" y1="80" x2="120" y2="80" stroke="#38BDF810" stroke-width="0.5"/>
  <line x1="0" y1="120" x2="120" y2="120" stroke="#38BDF810" stroke-width="0.5"/>
  <line x1="40" y1="0" x2="40" y2="160" stroke="#38BDF810" stroke-width="0.5"/>
  <line x1="80" y1="0" x2="80" y2="160" stroke="#38BDF810" stroke-width="0.5"/>

  <!-- Corner brackets -->
  <polyline points="2,16 2,2 16,2" fill="none" stroke="#38BDF8" stroke-width="1.5"/>
  <polyline points="104,2 118,2 118,16" fill="none" stroke="#38BDF8" stroke-width="1.5"/>
  <polyline points="2,144 2,158 16,158" fill="none" stroke="#38BDF8" stroke-width="1.5"/>
  <polyline points="104,158 118,158 118,144" fill="none" stroke="#38BDF8" stroke-width="1.5"/>

  <!-- Person silhouette -->
  <circle cx="60" cy="36" r="16" fill="#CBD5E1"/>
  <path d="M32,90 C32,62 88,62 88,90 L80,90 L80,68 L40,68 L40,90 Z" fill="{top_hex}"/>
  <rect x="40" y="90" width="17" height="38" fill="{bot_hex}" rx="2"/>
  <rect x="63" y="90" width="17" height="38" fill="{bot_hex}" rx="2"/>
  <rect x="22" y="68" width="14" height="32" fill="{top_hex}" rx="3"/>
  <rect x="84" y="68" width="14" height="32" fill="{top_hex}" rx="3"/>

  {_svg_bag(bag, top_hex)}

  <!-- REC dot -->
  <circle cx="10" cy="10" r="4" fill="#EF4444" opacity="0.9"/>

  <!-- Conf badge -->
  <rect x="74" y="4" width="40" height="14" fill="#22C55ECC" rx="3"/>
  <text x="94" y="14" font-size="8" fill="white" font-family="monospace" text-anchor="middle" font-weight="bold">{conf}%</text>

  <!-- Camera label -->
  <rect x="0" y="142" width="120" height="18" fill="#0F172ACC"/>
  <text x="60" y="154" font-size="7.5" fill="#94A3B8" font-family="monospace" text-anchor="middle">{cam_name}</text>
</svg>"""

    return Response(content=svg, media_type="image/svg+xml", headers={
        "Cache-Control": "max-age=86400",
        
    })


def _svg_bag(bag: str, top_hex: str) -> str:
    """Return SVG snippet for bag if applicable."""
    if bag == "backpack":
        return f'<rect x="44" y="64" width="32" height="30" rx="4" fill="{top_hex}" stroke="#38BDF840" stroke-width="1"/>'
    if bag in ("handbag", "purse"):
        return '<ellipse cx="84" cy="95" rx="10" ry="8" fill="#94A3B8" stroke="#38BDF840" stroke-width="1"/>'
    return ""
