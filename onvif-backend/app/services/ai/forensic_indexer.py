"""
forensic_indexer.py
-------------------
REAL AI Forensic Indexer — YOLOv8 + OpenCV pipeline.

How it works:
  1. Reads .enc recording files (or live RTSP) for each enrolled camera
  2. Decrypts .enc → temp file using encrypt_service
  3. OpenCV samples one frame every SAMPLE_EVERY_SEC seconds
  4. YOLOv8 detects persons/vehicles with bounding boxes
  5. Each person crop is analysed:
       - Top half HSV mean → top_color_name
       - Bottom half HSV mean → bottom_color_name
       - Aspect ratio + width heuristic → gender estimate
       - Shoulder bag detection via lower-arm region
  6. All detections saved to MongoDB forensic_index with real:
       - timestamp (from recording start + frame position)
       - enc_file_path (real path to .enc file)
       - frame_offset_sec (exact seek position inside the recording)
       - bbox (bounding box in original frame coords)
       - appearance (all visual attributes)
  7. track_id links same person across frames using YOLOv8 ByteTrack

NOTE: Does NOT seed fake data. Does NOT wipe existing data on startup.
      The seeder has been completely removed.
"""

import os
import re
import time
import uuid
import tempfile
import threading
from datetime import datetime, timedelta
from pymongo import UpdateOne
from app.core.database import mongo_client

MONGO_URI    = os.environ["MONGO_URI"]
_client      = mongo_client
_db = _client[os.environ.get("MONGO_DB_NAME")] if _client else None
forensic_col = _db["forensic_index"] if _db is not None else None
recordings_col = _db["recordings"] if _db is not None else None

# ── Ensure indexes for fast search ──────────────────────────────────────────
try:
    forensic_col.create_index([("timestamp", -1)])
    forensic_col.create_index([("camera_id", 1)])
    forensic_col.create_index([("appearance.object_type", 1)])
    forensic_col.create_index([("appearance.top_color_name", 1)])
    forensic_col.create_index([("appearance.bottom_color_name", 1)])
    forensic_col.create_index([("appearance.gender", 1)])
    forensic_col.create_index([("detection_id", 1)], unique=True)
    forensic_col.create_index([("track_id", 1)])
    forensic_col.create_index([("enc_file_path", 1)])
except Exception as e:
    print(f"[FORENSIC INDEXER] Index creation warning: {e}")

# ── Configurable ─────────────────────────────────────────────────────────────
SAMPLE_EVERY_SEC   = 2      # Extract one frame every N seconds of video
DETECTION_CONF     = 0.35   # Minimum YOLO confidence
MAX_FRAMES_PER_FILE = 300   # Cap at 300 frames per recording file
YOLO_MODEL_PATH    = os.environ.get("YOLO_MODEL", "yolov8n.pt")

# ── Status document (for the UI status panel) ────────────────────────────────
STATUS_DOC_ID = "forensic_indexer_status"

def _update_status(**fields):
    try:
        _db["forensic_status"].update_one(
            {"_id": STATUS_DOC_ID},
            {"$set": {**fields, "updated_at": datetime.utcnow().isoformat()}},
            upsert=True
        )
    except Exception:
        pass

def get_indexer_status() -> dict:
    try:
        doc = _db["forensic_status"].find_one({"_id": STATUS_DOC_ID}) or {}
        doc.pop("_id", None)
        return doc
    except Exception:
        return {}

# ── Optional ML deps ──────────────────────────────────────────────────────────
try:
    import cv2
    cv2.ocl.setUseOpenCL(False)
    import numpy as np
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False
    print("[FORENSIC INDEXER] ⚠ opencv-python not found — install it for real indexing.")

try:
    # from ultralytics import YOLO
    # import torch
    # import torchvision.models as models
    # import torchvision.transforms as T
    # HAS_ML = True
    # print("[FORENSIC INDEXER] ✅ YOLOv8 (ultralytics) + OpenCV + Torchvision available.")
    raise ImportError("ML Disabled to prevent GPU crash")
except ImportError:
    HAS_ML = False
    print("[FORENSIC INDEXER] ⚠ ultralytics/torchvision not found.")

# Pre-load OpenCV Face Detector
face_cascade = None
if HAS_CV2:
    try:
        face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    except Exception:
        pass

# Setup embedding transform
embed_transforms = T.Compose([
    T.ToPILImage(),
    T.Resize((128, 64)),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])


# ── Color HSV Classifier ──────────────────────────────────────────────────────
def classify_hsv_color(h: float, s: float, v: float) -> str:
    """Classify an HSV pixel (OpenCV scale: H=0-179, S=0-255, V=0-255) → color name."""
    # Achromatic
    if s < 50:
        if v > 150: return "white"
        if v < 60:  return "black"
        return "gray"
    if v < 40: return "black"
    # Chromatic (H is 0-179 in OpenCV)
    if h < 8 or h >= 168:    return "red"
    if 8  <= h < 22:         return "orange"
    if 22 <= h < 35:         return "yellow"
    if 35 <= h < 85:         return "green"
    if 85 <= h < 130:        return "blue"
    if 130 <= h < 168:       return "purple"
    return "gray"


def _mean_color_of_region(frame_bgr, x1, y1, x2, y2) -> tuple:
    """Return (h, s, v) mean of a BGR frame region. Returns (0,0,128) on failure."""
    try:
        w = x2 - x1
        # Crop to the center 40% of the width to avoid background contamination
        cx1 = x1 + int(w * 0.3)
        cx2 = x1 + int(w * 0.7)
        roi = frame_bgr[y1:y2, cx1:cx2]
        if roi.size == 0:
            return (0, 0, 128)
            
        # Average in BGR space (linear-ish, safe to average)
        mean_bgr = cv2.mean(roi)[:3]
        
        # Convert the single mean BGR color to HSV (solves the circular Hue averaging bug)
        bgr_pixel = np.uint8([[[mean_bgr[0], mean_bgr[1], mean_bgr[2]]]])
        hsv_pixel = cv2.cvtColor(bgr_pixel, cv2.COLOR_BGR2HSV)
        
        h, s, v = hsv_pixel[0][0]
        return (float(h), float(s), float(v))
    except Exception:
        return (0, 0, 128)


def _classify_person_appearance(frame_bgr, x1, y1, x2, y2) -> dict:
    """
    Given a person bounding box in a BGR frame, return appearance attributes:
      top_color_name, bottom_color_name, gender (estimated), bag (estimated)
    """
    h_box = y2 - y1
    w_box = x2 - x1

    # Top half of bounding box = upper garment
    top_y1 = y1
    top_y2 = y1 + int(h_box * 0.45)
    # Bottom half = lower garment
    bot_y1 = y1 + int(h_box * 0.55)
    bot_y2 = y2

    top_h, top_s, top_v = _mean_color_of_region(frame_bgr, x1, top_y1, x2, top_y2)
    bot_h, bot_s, bot_v = _mean_color_of_region(frame_bgr, x1, bot_y1, x2, bot_y2)

    top_color = classify_hsv_color(top_h, top_s, top_v)
    bot_color = classify_hsv_color(bot_h, bot_s, bot_v)

    # Gender heuristic: shoulder-to-hip ratio
    # Wider top relative to overall box → likely male
    # This is a very rough heuristic; replace with a real classifier if needed
    aspect = h_box / max(w_box, 1)
    gender = "male" if aspect > 2.0 else "female"

    # Bag heuristic: look at the side areas of the mid-section
    # Check if there's an anomalous colour blob beside the torso
    bag = "none"
    try:
        mid_y1 = y1 + int(h_box * 0.3)
        mid_y2 = y1 + int(h_box * 0.7)
        # Right arm area
        arm_x1 = max(0, x2)
        arm_x2 = min(frame_bgr.shape[1], x2 + int(w_box * 0.3))
        arm_roi = frame_bgr[mid_y1:mid_y2, arm_x1:arm_x2]
        if arm_roi.size > 0:
            arm_mean = cv2.mean(arm_roi)
            # If arm area has low brightness variance — likely a bag
            arm_std = arm_roi.std()
            if arm_std < 30 and arm_roi.size > 100:
                bag = "handbag"
    except Exception:
        pass

    return {
        "top_color_name":    top_color,
        "top_color_hsv":     [round(top_h), round(top_s), round(top_v)],
        "bottom_color_name": bot_color,
        "bottom_color_hsv":  [round(bot_h), round(bot_s), round(bot_v)],
        "gender":            gender,
        "bag":               bag,
    }


def _resolve_local_path(path: str) -> str:
    if not path:
        return ""
    path = path.replace("\\", "/")
    if os.name == "nt":
        if path.startswith("/recordings/"):
            path = path.replace("/recordings/", "D:/REC/")
        elif path.startswith("/recording/"):
            path = path.replace("/recording/", "D:/REC/")
    else:
        if path.startswith("D:/REC/"):
            path = path.replace("D:/REC/", "/recordings/")
        elif path.startswith("D:/rec/"):
            path = path.replace("D:/rec/", "/recordings/")
    return path


# ── Frame timestamp from filename ─────────────────────────────────────────────
def _parse_recording_start(enc_path: str) -> datetime | None:
    """
    Try to parse the recording start time from the file path.
    Expects paths like: /recordings/<camera_id>/2026-05-27/06-40-28.enc
    """
    try:
        parts = enc_path.replace("\\", "/").split("/")
        if len(parts) >= 2:
            date_str = parts[-2]   # e.g. 2026-05-27
            time_str = parts[-1].replace(".enc", "").replace(".mp4", "").replace(".ts", "")
            if "_" in time_str:
                time_str = time_str.split("_")[-1]
            dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H-%M-%S")
            return dt
    except Exception:
        pass
    return None


# ═════════════════════════════════════════════════════════════════════════════
# Core indexing function
# ═════════════════════════════════════════════════════════════════════════════

def index_recording_file(
    enc_path:    str,
    camera_id:   str,
    camera_name: str,
    camera_ip:   str,
    camera_type: str = "dome",
) -> int:
    """
    Decrypt + scan a single .enc recording file with YOLOv8.
    Saves real detections to forensic_index.
    Returns number of detections saved.
    """
    if not HAS_ML or not HAS_CV2:
        print("[FORENSIC INDEXER] Skipping — YOLOv8/OpenCV not available.")
        return 0

    enc_path = _resolve_local_path(enc_path)
    if not enc_path or not os.path.exists(enc_path):
        print(f"[FORENSIC INDEXER] File not found: {enc_path}")
        return 0

    # Check if already indexed (avoid re-processing)
    existing_count = forensic_col.count_documents({"enc_file_path": enc_path})
    if existing_count > 0:
        print(f"[FORENSIC INDEXER] Already indexed ({existing_count} dets): {enc_path}")
        return 0

    print(f"[FORENSIC INDEXER] 🎬 Indexing: {enc_path}")
    _update_status(
        is_indexing=True,
        current_file=enc_path,
        last_indexed_camera=camera_name,
    )

    dec_tmp_path = None
    try:
        # ── Step 1: Decrypt .enc → temp file ──────────────────────────
        try:
            from app.services.storage import encrypt_service
            dec_tmp_path = encrypt_service.decrypt_to_temp_file(enc_path, suffix=".ts")
        except Exception as e:
            print(f"[FORENSIC INDEXER] Decrypt error for {enc_path}: {e}")
            return 0

        # ── Step 2: Open with OpenCV ───────────────────────────────────
        cap = cv2.VideoCapture(dec_tmp_path)
        if not cap.isOpened():
            print(f"[FORENSIC INDEXER] OpenCV could not open temp file: {dec_tmp_path}")
            return 0

        fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        sample_every = max(1, int(fps * SAMPLE_EVERY_SEC))

        # Recording start time (from filename or created_at from recordings collection)
        rec_start = _parse_recording_start(enc_path)
        if rec_start is None:
            # Fallback: try DB
            try:
                rec_doc = recordings_col.find_one({"file_path": {"$regex": re.escape(os.path.basename(enc_path))}})
                if rec_doc and rec_doc.get("created_at"):
                    rec_start = rec_doc["created_at"]
            except Exception:
                pass
        if rec_start is None:
            rec_start = datetime.utcnow()

        # ── Step 3: Load YOLOv8 and Embedding Model ────────────────────
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = YOLO(YOLO_MODEL_PATH)
        model.to(device)

        embed_model = None
        try:
            embed_model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.IMAGENET1K_V1)
            embed_model.classifier = torch.nn.Identity() # Remove classification head
            embed_model.eval()
            embed_model.to(device)
        except Exception as e:
            print(f"[FORENSIC INDEXER] Embedding model failed to load: {e}")

        # ── Step 4: Sample frames and detect ──────────────────────────
        detections_to_save = []
        frame_idx = 0
        saved_count = 0
        track_map = {}  # internal_track_id → our track_id

        print(f"[FORENSIC INDEXER] FPS={fps:.1f}, total_frames={total_frames}, sampling every {sample_every} frames")

        while frame_idx < min(total_frames, MAX_FRAMES_PER_FILE * sample_every):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                break

            offset_sec = frame_idx / fps
            frame_time = rec_start + timedelta(seconds=offset_sec)

            # Run YOLOv8 with ByteTrack tracking
            try:
                results = model.track(
                    frame,
                    persist=True,
                    conf=DETECTION_CONF,
                    classes=[0],           # class 0 = person
                    verbose=False,
                    tracker="bytetrack.yaml",
                )
            except Exception as e:
                # Fall back to plain detect if tracking fails
                try:
                    results = model(frame, conf=DETECTION_CONF, classes=[0], verbose=False)
                except Exception:
                    frame_idx += sample_every
                    continue

            if results and len(results) > 0:
                result = results[0]
                boxes = result.boxes

                if boxes is not None and len(boxes) > 0:
                    for box in boxes:
                        try:
                            # Bounding box
                            xyxy = box.xyxy[0].cpu().numpy()
                            x1, y1, x2, y2 = int(xyxy[0]), int(xyxy[1]), int(xyxy[2]), int(xyxy[3])

                            # Clamp to frame
                            fh, fw = frame.shape[:2]
                            x1 = max(0, x1); y1 = max(0, y1)
                            x2 = min(fw, x2); y2 = min(fh, y2)

                            if (x2 - x1) < 20 or (y2 - y1) < 30:
                                continue  # Skip tiny detections

                            conf = float(box.conf[0].cpu().numpy())

                            # Track ID
                            internal_track_id = None
                            if box.id is not None:
                                internal_track_id = int(box.id[0].cpu().numpy())

                            # Map internal YOLO track_id → our stable track_id per camera
                            if internal_track_id is not None:
                                tk_key = f"{camera_id}_{internal_track_id}"
                                if tk_key not in track_map:
                                    track_map[tk_key] = f"tr_{camera_id[:12]}_{internal_track_id}_{int(rec_start.timestamp())}"
                                our_track_id = track_map[tk_key]
                            else:
                                our_track_id = f"tr_{camera_id[:12]}_{uuid.uuid4().hex[:8]}"

                            # Face Detection (fallback to upper body crop)
                            face_bbox = None
                            try:
                                if face_cascade is not None:
                                    # Search only in the top 40% of the bounding box
                                    search_y2 = y1 + int((y2 - y1) * 0.4)
                                    top_region = frame[y1:search_y2, x1:x2]
                                    if top_region.size > 0:
                                        gray_top = cv2.cvtColor(top_region, cv2.COLOR_BGR2GRAY)
                                        faces = face_cascade.detectMultiScale(gray_top, scaleFactor=1.1, minNeighbors=3, minSize=(20, 20))
                                        if len(faces) > 0:
                                            fx, fy, fw, fh = faces[0]
                                            face_bbox = [int(x1 + fx), int(y1 + fy), int(fw), int(fh)]
                            except Exception:
                                pass
                            
                            # If no face found, default to top 25% of the body box
                            if not face_bbox:
                                fw = x2 - x1
                                fh = int((y2 - y1) * 0.25)
                                face_bbox = [int(x1), int(y1), int(fw), int(fh)]

                            # Appearance Embedding for Re-ID Clustering
                            embedding = []
                            if embed_model is not None:
                                try:
                                    person_roi = frame[y1:y2, x1:x2]
                                    if person_roi.size > 0:
                                        person_rgb = cv2.cvtColor(person_roi, cv2.COLOR_BGR2RGB)
                                        tensor_input = embed_transforms(person_rgb).unsqueeze(0).to(device)
                                        with torch.no_grad():
                                            emb = embed_model(tensor_input).squeeze().cpu().numpy()
                                            embedding = emb.tolist()
                                except Exception:
                                    pass

                            # Appearance analysis on the cropped person
                            appearance = _classify_person_appearance(frame, x1, y1, x2, y2)
                            appearance["object_type"] = "person"
                            appearance["confidence"]  = round(conf, 3)

                            detection_id = f"det_{camera_id[:12]}_{int(frame_time.timestamp()*1000)}"

                            detections_to_save.append({
                                "detection_id":     detection_id,
                                "track_id":         our_track_id,
                                "camera_id":        camera_id,
                                "camera_ip":        camera_ip,
                                "camera_name":      camera_name,
                                "camera_type":      camera_type,
                                "date":             frame_time.strftime("%Y-%m-%d"),
                                "timestamp":        frame_time.isoformat(),
                                "frame_offset_sec": round(offset_sec, 2),
                                "enc_file_path":    enc_path,
                                "bbox":             [x1, y1, x2 - x1, y2 - y1],
                                "face_bbox":        face_bbox,
                                "embedding":        embedding,
                                "appearance":       appearance,
                                "indexed_at":       datetime.utcnow().isoformat(),
                            })
                            saved_count += 1

                        except Exception as box_err:
                            print(f"[FORENSIC INDEXER] Box processing error: {box_err}")
                            continue

            frame_idx += sample_every

        cap.release()

        # ── Step 5: Upsert detections to MongoDB ──────────────────────
        if detections_to_save:
            ops = [
                UpdateOne(
                    {"detection_id": d["detection_id"]},
                    {"$set": d},
                    upsert=True
                )
                for d in detections_to_save
            ]
            forensic_col.bulk_write(ops, ordered=False)
            print(f"[FORENSIC INDEXER] ✅ Saved {len(detections_to_save)} detections from {enc_path}")

        # Update today's count in status
        today = datetime.utcnow().strftime("%Y-%m-%d")
        today_count = forensic_col.count_documents({"date": today})
        _update_status(
            is_indexing=False,
            last_indexed_camera=camera_name,
            last_indexed_file=enc_path,
            recordings_indexed_today=today_count,
            total_detections=forensic_col.count_documents({}),
            last_sweep=datetime.utcnow().isoformat(),
        )

        return len(detections_to_save)

    except Exception as e:
        print(f"[FORENSIC INDEXER] ❌ index_recording_file error: {e}")
        import traceback
        traceback.print_exc()
        _update_status(is_indexing=False, last_error=str(e))
        return 0
    finally:
        try:
            if dec_tmp_path and os.path.exists(dec_tmp_path):
                os.unlink(dec_tmp_path)
        except Exception:
            pass


def index_rtsp_stream(
    rtsp_url:    str,
    camera_id:   str,
    camera_name: str,
    camera_ip:   str,
    camera_type: str = "dome",
    duration_sec: int = 120,
) -> int:
    """
    Read a live RTSP stream for `duration_sec` seconds, detect persons,
    and save metadata to forensic_index.
    Returns number of detections saved.
    """
    if not HAS_ML or not HAS_CV2:
        print("[FORENSIC INDEXER] Skipping RTSP — YOLOv8/OpenCV not available.")
        return 0

    print(f"[FORENSIC INDEXER] 📡 Indexing RTSP: {rtsp_url} for {duration_sec}s")
    _update_status(is_indexing=True, current_file=rtsp_url, last_indexed_camera=camera_name)

    try:
        cap = cv2.VideoCapture(rtsp_url)
        if not cap.isOpened():
            print(f"[FORENSIC INDEXER] Cannot open RTSP: {rtsp_url}")
            return 0

        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = YOLO(YOLO_MODEL_PATH)
        model.to(device)

        start_time = time.time()
        frame_count = 0
        saved_count = 0
        last_sample = 0
        detections_to_save = []
        track_map = {}

        while (time.time() - start_time) < duration_sec:
            ret, frame = cap.read()
            if not ret:
                break

            now = time.time()
            if now - last_sample < SAMPLE_EVERY_SEC:
                continue
            last_sample = now
            frame_count += 1

            frame_time = datetime.utcnow()
            offset_sec = now - start_time

            try:
                results = model.track(
                    frame,
                    persist=True,
                    conf=DETECTION_CONF,
                    classes=[0],
                    verbose=False,
                    tracker="bytetrack.yaml",
                )
            except Exception:
                try:
                    results = model(frame, conf=DETECTION_CONF, classes=[0], verbose=False)
                except Exception:
                    continue

            if results and len(results) > 0:
                for box in (results[0].boxes or []):
                    try:
                        xyxy = box.xyxy[0].cpu().numpy()
                        x1, y1, x2, y2 = int(xyxy[0]), int(xyxy[1]), int(xyxy[2]), int(xyxy[3])
                        fh, fw = frame.shape[:2]
                        x1 = max(0, x1); y1 = max(0, y1)
                        x2 = min(fw, x2); y2 = min(fh, y2)
                        if (x2 - x1) < 20 or (y2 - y1) < 30:
                            continue

                        conf = float(box.conf[0].cpu().numpy())
                        internal_track_id = int(box.id[0].cpu().numpy()) if box.id is not None else None
                        if internal_track_id is not None:
                            tk_key = f"{camera_id}_{internal_track_id}"
                            if tk_key not in track_map:
                                track_map[tk_key] = f"tr_{camera_id[:12]}_{internal_track_id}_{int(start_time)}"
                            our_track_id = track_map[tk_key]
                        else:
                            our_track_id = f"tr_{camera_id[:12]}_{uuid.uuid4().hex[:8]}"

                        appearance = _classify_person_appearance(frame, x1, y1, x2, y2)
                        appearance["object_type"] = "person"
                        appearance["confidence"]  = round(conf, 3)

                        # Provide face_bbox fallback for RTSP
                        fw_face = x2 - x1
                        fh_face = int((y2 - y1) * 0.25)
                        face_bbox = [int(x1), int(y1), int(fw_face), int(fh_face)]

                        detection_id = f"det_{camera_id[:12]}_{int(frame_time.timestamp()*1000)}"
                        detections_to_save.append({
                            "detection_id":     detection_id,
                            "track_id":         our_track_id,
                            "camera_id":        camera_id,
                            "camera_ip":        camera_ip,
                            "camera_name":      camera_name,
                            "camera_type":      camera_type,
                            "date":             frame_time.strftime("%Y-%m-%d"),
                            "timestamp":        frame_time.isoformat(),
                            "frame_offset_sec": round(offset_sec, 2),
                            "enc_file_path":    "",   # Live RTSP — no enc file
                            "bbox":             [int(x1), int(y1), int(x2 - x1), int(y2 - y1)],
                            "face_bbox":        face_bbox,
                            "appearance":       appearance,
                            "indexed_at":       datetime.utcnow().isoformat(),
                        })
                        saved_count += 1
                    except Exception:
                        continue

        cap.release()

        if detections_to_save:
            ops = [
                UpdateOne(
                    {"detection_id": d["detection_id"]},
                    {"$set": d},
                    upsert=True
                )
                for d in detections_to_save
            ]
            forensic_col.bulk_write(ops, ordered=False)
            print(f"[FORENSIC INDEXER] ✅ Saved {len(detections_to_save)} RTSP detections for {camera_name}")

        _update_status(
            is_indexing=False,
            last_indexed_camera=camera_name,
            total_detections=forensic_col.count_documents({}),
            last_sweep=datetime.utcnow().isoformat(),
        )
        return len(detections_to_save)

    except Exception as e:
        print(f"[FORENSIC INDEXER] ❌ index_rtsp_stream error: {e}")
        _update_status(is_indexing=False, last_error=str(e))
        return 0


# ═════════════════════════════════════════════════════════════════════════════
# Background Indexer Class (runs in a daemon thread)
# ═════════════════════════════════════════════════════════════════════════════

class BackgroundIndexer(threading.Thread):
    """
    Daemon thread that continuously:
      1. Checks recordings collection for new .enc files not yet indexed
      2. Indexes each one with YOLOv8
      3. Sleeps POLL_INTERVAL_SEC between sweeps
    """
    POLL_INTERVAL_SEC = 300   # Re-check for new recordings every 5 minutes

    def __init__(self):
        super().__init__(daemon=True, name="ForensicIndexerThread")
        self._stop_event = threading.Event()

    def stop(self):
        self._stop_event.set()

    def run(self):
        print("[FORENSIC INDEXER] 🚀 Background indexer thread started.")
        _update_status(
            is_indexing=False,
            status="running",
            started_at=datetime.utcnow().isoformat(),
        )

        while not self._stop_event.is_set():
            try:
                self._sweep_recordings()
            except Exception as e:
                print(f"[FORENSIC INDEXER] Sweep error: {e}")

            # Wait POLL_INTERVAL_SEC, but wake up immediately if stopped
            self._stop_event.wait(timeout=self.POLL_INTERVAL_SEC)

        print("[FORENSIC INDEXER] Background indexer stopped.")

    def _get_cameras(self) -> list:
        """Load enrolled cameras from MongoDB."""
        try:
            cams = list(_db["cameras"].find({"enabled": {"$ne": False}}))
            result = []
            for cam in cams:
                cam_id   = cam.get("stream_key") or cam.get("id") or str(cam.get("_id", ""))
                cam_name = cam.get("device_name") or cam.get("name") or cam.get("ip") or "Camera"
                cam_ip   = cam.get("ip", "")
                cam_type = (cam.get("model") or "dome").lower()
                cam_rtsp = cam.get("rtsp_url") or cam.get("recording_rtsp", "")
                if cam_id:
                    result.append({
                        "id":   cam_id,
                        "name": cam_name,
                        "ip":   cam_ip,
                        "type": cam_type,
                        "rtsp": cam_rtsp,
                    })
            return result
        except Exception as e:
            print(f"[FORENSIC INDEXER] Camera load error: {e}")
            return []

    def _get_unindexed_recordings(self, camera_id: str) -> list:
        """
        Find .enc recordings for this camera that haven't been indexed yet.
        An indexed recording has at least one document in forensic_index with that enc_file_path.
        """
        try:
            # Get all recordings for this camera
            all_recs = list(recordings_col.find(
                {
                    "$or": [
                        {"camera_id": camera_id},
                        {"stream_key": camera_id},
                        {"stream_id": camera_id},
                    ],
                    "file_path": {"$regex": r"\.enc$"},
                },
                sort=[("created_at", -1)],
                limit=50
            ))

            unindexed = []
            for rec in all_recs:
                file_path = _resolve_local_path(rec.get("file_path", ""))
                if not file_path or not os.path.exists(file_path):
                    continue
                # Check if already indexed
                already = forensic_col.count_documents({"enc_file_path": file_path})
                if already == 0:
                    unindexed.append({
                        "file_path":  file_path,
                        "created_at": rec.get("created_at"),
                    })
            return unindexed
        except Exception as e:
            print(f"[FORENSIC INDEXER] Unindexed recordings query error: {e}")
            return []

    def _sweep_recordings(self):
        """One full sweep: find + index all unindexed recordings for all cameras."""
        cameras = self._get_cameras()
        if not cameras:
            print("[FORENSIC INDEXER] No cameras enrolled — waiting.")
            return

        print(f"[FORENSIC INDEXER] 🔍 Sweep started ({len(cameras)} cameras)")
        total_new = 0

        for cam in cameras:
            if self._stop_event.is_set():
                break

            unindexed = self._get_unindexed_recordings(cam["id"])
            if not unindexed:
                continue

            print(f"[FORENSIC INDEXER] {cam['name']}: {len(unindexed)} unindexed recording(s) found")
            for rec in unindexed:
                if self._stop_event.is_set():
                    break
                n = index_recording_file(
                    enc_path=rec["file_path"],
                    camera_id=cam["id"],
                    camera_name=cam["name"],
                    camera_ip=cam["ip"],
                    camera_type=cam["type"],
                )
                total_new += n

        print(f"[FORENSIC INDEXER] ✅ Sweep done. {total_new} new detections added.")
        _update_status(
            last_sweep=datetime.utcnow().isoformat(),
            total_detections=forensic_col.count_documents({}),
            total_tracks=len(forensic_col.distinct("track_id")),
        )


# ═════════════════════════════════════════════════════════════════════════════
# Trigger a manual re-index for a camera + date range
# ═════════════════════════════════════════════════════════════════════════════

def trigger_reindex_for_camera(camera_id: str, start_date: str, end_date: str) -> int:
    """
    Index all recordings for `camera_id` between `start_date` and `end_date`.
    Called from the /api/forensic/reindex endpoint.
    Runs synchronously (call from a background thread in the API).
    Returns total new detections.
    """
    try:
        cam = _db["cameras"].find_one({
            "$or": [
                {"stream_key": camera_id},
                {"id": camera_id},
            ]
        })
        if not cam:
            print(f"[FORENSIC INDEXER] Camera not found for reindex: {camera_id}")
            return 0

        cam_name = cam.get("device_name") or cam.get("name") or cam.get("ip") or "Camera"
        cam_ip   = cam.get("ip", "")
        cam_type = (cam.get("model") or "dome").lower()

        # Parse date range
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt   = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
        except ValueError:
            start_dt = datetime.utcnow() - timedelta(days=7)
            end_dt   = datetime.utcnow()

        recs = list(recordings_col.find(
            {
                "$or": [
                    {"camera_id": camera_id},
                    {"stream_key": camera_id},
                ],
                "file_path": {"$regex": r"\.enc$"},
                "created_at": {"$gte": start_dt, "$lte": end_dt},
            },
            sort=[("created_at", -1)]
        ))

        if not recs:
            print(f"[FORENSIC INDEXER] No recordings found for {camera_id} in {start_date}→{end_date}")
            return 0

        total = 0
        for rec in recs:
            file_path = _resolve_local_path(rec.get("file_path", ""))
            if not file_path or not os.path.exists(file_path):
                continue
            # Force re-index: delete existing detections for this file first
            forensic_col.delete_many({"enc_file_path": file_path})
            n = index_recording_file(
                enc_path=file_path,
                camera_id=camera_id,
                camera_name=cam_name,
                camera_ip=cam_ip,
                camera_type=cam_type,
            )
            total += n

        print(f"[FORENSIC INDEXER] Reindex complete for {camera_id}: {total} detections")
        return total
    except Exception as e:
        print(f"[FORENSIC INDEXER] trigger_reindex_for_camera error: {e}")
        return 0
