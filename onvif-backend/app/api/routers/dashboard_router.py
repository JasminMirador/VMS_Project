from fastapi import APIRouter, Depends, Response, HTTPException, Request, Query, UploadFile, File, Form
from typing import Optional, List
import json
from app.core.database import db as _db, analytics_col, watch_collection, cameras_col
from app.core.security import verify_token
from bson import ObjectId
import math
import os
from datetime import datetime, timedelta
from recorder import rtsp_recorder as recorder
from recorder import encrypt_service
from app.api.routers.playback_router import event_snapshot as playback_snapshot

router = APIRouter(prefix="/api", tags=["dashboard"])

@router.get("/dashboard/summary", )
def get_dashboard_summary():
    if cameras_col is None or analytics_col is None:
        return {}

    # total_cameras = cameras_col.count_documents({})
    total_cameras = cameras_col.count_documents({"is_deleted": {"$ne": True}})

    active_streams = cameras_col.count_documents({
        # "enabled": {"$ne": False}
        "enabled": {"$ne": False},
        "is_deleted": {"$ne": True}
    })

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_iso = today_start.isoformat()

    alarms_today = analytics_col.count_documents({
        "received_at": {"$gte": today_start_iso},
        "is_deleted": {"$ne": True}
    })

    latest_health = _db["health_logs"].find_one(
        {"type": "system"},
        sort=[("timestamp", -1)]
    )

    cpu = latest_health.get("cpu", 0) if latest_health else 0
    ram = latest_health.get("ram", 0) if latest_health else 0
    disk = latest_health.get("disk", 0) if latest_health else 0

    # 🔥 ADD ALERT LOGIC
    alerts = []

    if cpu > 85:
        alerts.append("High CPU Usage")

    if ram > 85:
        alerts.append("High RAM Usage")

    if disk > 90:
        alerts.append("Disk Almost Full")

    # 🔥 SYSTEM STATUS
    status = "Healthy"
    if cpu > 85 or ram > 85 or disk > 90:
        status = "Critical"
    elif cpu > 60 or ram > 60 or disk > 75:
        status = "Warning"

    return {
        "total_cameras": total_cameras,
        "active_streams": active_streams,
        "alarms_today": alarms_today,

        "cpu": cpu,
        "ram": ram,
        "disk": disk,

        "alerts": alerts,
        "status": status
    }

@router.get("/action-rules", )
def get_action_rules():
    rules = list(_db["action_rules"].find({}, {"_id": 0}))
    return {"rules": rules}

@router.get("/dashboard/events", )
def get_dashboard_events(limit: int = 20):
    if analytics_col is None:
        return []
    docs = list(
        # analytics_col.find({}, {"_id": 0})
        analytics_col.find({"is_deleted": {"$ne": True}}, {"_id": 0})
        
        .sort("received_at", -1)
        .limit(limit)
    )
    for d in docs:
        if "received_at" in d:
            if hasattr(d["received_at"], "isoformat"):
                d["received_at"] = d["received_at"].isoformat()
    return docs

@router.get("/alerts", dependencies=[Depends(verify_token)])
def get_alerts(
    limit: int = 50,
    camera_ip: str = None,
    include_software_motion: bool = False,
    from_date: str = None,
    to_date: str = None,
    source: str = None,
    status: str = None
):
    if _db is None:
        return {"alerts": []}

    try:
        query = {}
        if camera_ip:
            query["ip"] = camera_ip
            
        if not include_software_motion:
            query["source"] = {"$ne": "software_motion"}
            
        if status and status.lower() != "all":
            if status.lower() == "active":
                query["status"] = {"": [None, "Active", ""]}
            else:
                query["status"] = status
            
        if from_date or to_date:
            query["received_at"] = {}
            if from_date:
                try:
                    norm_from = from_date.replace("Z", "+00:00").replace(" ", "T")
                    dt_from = datetime.fromisoformat(norm_from).astimezone()
                    query["received_at"]["$gte"] = dt_from.isoformat()
                except Exception:
                    pass
            if to_date:
                try:
                    norm_to = to_date.replace("Z", "+00:00").replace(" ", "T")
                    dt_to = datetime.fromisoformat(norm_to).astimezone()
                    query["received_at"]["$lte"] = dt_to.isoformat()
                except Exception:
                    pass

        docs = []
        if source == "external_ai":
            ai_query = dict(query)
            ai_query["topic"] = "vms/analytics/alerts"
            docs.extend(list(_db["external_ai_alerts"].find(ai_query).sort("received_at", -1).limit(limit)))
        elif source == "built_in":
            docs.extend(list(_db["mqtt_logs"].find(query).sort("received_at", -1).limit(limit)))
        else: # "all" or None
            ai_query = dict(query)
            ai_query["topic"] = "vms/analytics/alerts"
            docs.extend(list(_db["external_ai_alerts"].find(ai_query).sort("received_at", -1).limit(limit)))
            docs.extend(list(_db["mqtt_logs"].find(query).sort("received_at", -1).limit(limit)))
            
            # Sort combined and limit
            docs.sort(key=lambda x: x.get("received_at", ""), reverse=True)
            docs = docs[:limit]

        # ── Sources that share the same flat document schema ─────────
        # Mosquitto by mqtt_publisher.py (unified pipeline).
        FLAT_SOURCES = {"bosch", "dahua", "hikvision"}
        formatted = []
        for d in docs:
            if "_id" in d:
                d["id"] = str(d["_id"])
                del d["_id"]
                
            source = d.get("source", "")
            
            if source == "external_ai":
                formatted.append(d)
            elif source in FLAT_SOURCES:
                t = d.get("type")
                if not t or str(t).strip().lower() == "none":
                    t = "Object Detection"
                s = d.get("scenario")
                if not s or str(s).strip().lower() == "none":
                    s = "Detect Any Object"
                formatted.append({
                    "ip":          d.get("ip"),
                    "serial":      d.get("serial"),
                    "time":        d.get("time"),
                    "scenario":    s,
                    "type":        t,
                    "human":       d.get("human"),
                    "total":       d.get("total"),
                    "status":      d.get("status", "Active"),
                    "received_at": d.get("received_at"),
                    "topic":       d.get("topic", ""),
                    "source":      source,
                })
            elif source == "software_motion":
                formatted.append({
                    "ip":           d.get("ip"),
                    "serial":       d.get("serial"),
                    "time":         d.get("time"),
                    "motion_start": d.get("motion_start"),
                    "motion_end":   d.get("motion_end"),
                    "scenario":     d.get("scenario", "Software Motion"),
                    "type":         d.get("type", "Motion"),
                    "status":       d.get("status", "Active"),
                    "received_at":  d.get("received_at"),
                    "source":       "software_motion",
                    "face_url":     d.get("face_url"),
                })
            else:
                # Original MQTT / Axis nested format
                msg  = d.get("message", {})
                data = msg.get("data", {})
                
                t = d.get("type") or data.get("scenarioType")
                if not t or str(t).strip().lower() == "none":
                    t = "Object Detection"
                s = d.get("scenario") or data.get("scenario")
                if not s or str(s).strip().lower() == "none":
                    s = "Detect Any Object"
                    
                formatted.append({
                    "ip":        d.get("ip"),
                    "serial":    d.get("serial"),
                    "time":      data.get("triggerTime") or d.get("time"),
                    "scenario":  s,
                    "type":      t,
                    "human":     data.get("human"),
                    "total":     data.get("total"),
                    "class":     data.get("classTypes"),
                    "object_id": data.get("objectId"),
                    "status":    "Active",
                    "received_at": d.get("received_at"),
                    "source":    d.get("source"),
                })

        for i, item in enumerate(formatted):
            d = docs[i]
            item["id"] = d.get("id")
            item["status"] = d.get("status", "Active")
            item["acknowledged_at"] = d.get("acknowledged_at")
            item["acknowlege_note"] = d.get("acknowlege_note")
            item["resolved_at"] = d.get("resolved_at")
            item["resolve_note"] = d.get("resolve_note")

        return {"alerts": formatted}

    except Exception as e:
        print(f"[ALERTS] ❌ {e}")
        return {"alerts": []}
    
@router.get("/alerts/thumbnail")
def get_alert_thumbnail(ip: str, time: str, crop: int = 1, request: Request = None):
    """
    Legacy alert thumbnail endpoint.
    Proxy to the event playback snapshot endpoint so built-in alerts return the exact recorded frame.
    """
    if not ip or not time:
        return Response(
            content=b'{"error":"Missing ip or time"}',
            status_code=400,
            media_type="application/json"

        )

    try:
        # First try to find a persisted snapshot for this alert in mqtt_logs
        try:
            mqtt_col = _db["mqtt_logs"]
            # Find document with same ip and time (allow small variations)
            candidates = list(mqtt_col.find({"ip": ip}).sort([("received_at", -1)]).limit(20))
            found_doc = None
            from datetime import datetime
            try:
                query_dt = datetime.fromisoformat(time.replace(" ", "T").replace("Z", "+00:00"))
            except Exception:
                query_dt = None
            if query_dt:
                for doc in candidates:
                    doc_time = None
                    if doc.get("time"):
                        try:
                            doc_time = datetime.fromisoformat(doc.get("time").replace(" ", "T").replace("Z", "+00:00"))
                        except Exception:
                            doc_time = None
                    if doc_time and abs((doc_time - query_dt).total_seconds()) <= 5:
                        found_doc = doc
                        break
            if not found_doc and candidates:
                # fallback: use latest candidate
                found_doc = candidates[0]

            if found_doc and found_doc.get("snapshot_url"):
                snap_url = found_doc.get("snapshot_url")
                # If it's an internal /api/snapshots path, map to filesystem
                if snap_url.startswith("/api/snapshots/"):
                    fname = snap_url.split("/api/snapshots/", 1)[1]
                    snapshots_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static", "snapshots")
                    fpath = os.path.join(snapshots_dir, fname)
                    if os.path.exists(fpath):
                        return Response(content=open(fpath, "rb").read(), media_type="image/jpeg")
        except Exception as lookup_err:
            print(f"[ALERT THUMBNAIL] Snapshot lookup error: {lookup_err}")

        return playback_snapshot(ip=ip, time=time)
    except Exception as e:
        print(f"[ALERT THUMBNAIL] Proxy failed: {e}")
        return Response(
            content=b'{"error":"Snapshot proxy failed"}',
            status_code=500,
            media_type="application/json"

        )

    # Helper function for fallback SVG silhouette
    def fallback_svg(alert_type="Alert"):
        svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90" width="120" height="90">
  <rect width="120" height="90" fill="#0F172A" rx="4"/>
  <circle cx="60" cy="40" r="16" fill="#1E293B" stroke="#38BDF8" stroke-width="1.5"/>
  <path d="M48,68 L72,68 C72,60 48,60 48,68 Z" fill="#38BDF8"/>
  <text x="60" y="80" font-size="8" fill="#94A3B8" font-family="monospace" text-anchor="middle">{alert_type[:18]}</text>
</svg>"""
        return Response(content=svg, media_type="image/svg+xml", headers=headers)

    try:
        print("\n========== ALERT THUMBNAIL ==========")
        print("IP   :", ip)
        print("TIME :", time)
        print("CROP :", crop)

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

        # Ensure alert_dt is aware; if not, assume local system time
        if alert_dt.tzinfo is None:
            alert_dt = alert_dt.replace(tzinfo=datetime.now().astimezone().tzinfo)

        # Convert alert_dt to local system time (since chunks are saved in local time)
        alert_local = alert_dt.astimezone()
        alert_local_naive = alert_local.replace(tzinfo=None)

        alert_local_hms  = alert_local_naive.strftime("%H-%M-%S")
        alert_local_date = alert_local_naive.strftime("%Y-%m-%d")
        alert_local_secs = (
            alert_local_naive.hour * 3600 + alert_local_naive.minute * 60 + alert_local_naive.second
        )

        alert_utc = alert_dt.astimezone(timezone.utc).replace(tzinfo=None)

        # ── 2. Find any bbox coordinates in the db ────────────────────
        bbox = None
        alert_type_str = "Alert"
        try:
            ip_norm = ip.strip().replace(".", "_")
            ip_dot = ip.strip()
            ip_candidates = [v for v in {ip_norm, ip_dot} if v]

            def parse_db_datetime(value):
                if isinstance(value, datetime):
                    return value
                if not isinstance(value, str):
                    return None
                v = value.strip()
                if " " in v:
                    v = v.replace(" ", "T")
                v = re.sub(r"([+-])(\d{2})(\d{2})$", r"\1\2:\3", v)
                if v.endswith("Z"):
                    try:
                        return datetime.fromisoformat(v[:-1]).replace(tzinfo=timezone.utc)
                    except ValueError:
                        return None
                try:
                    return datetime.fromisoformat(v)
                except ValueError:
                    pass
                if re.match(r"^\d{2}:\d{2}:\d{2}(\.\d+)?$", v):
                    try:
                        time_part = datetime.strptime(v.split(".")[0], "%H:%M:%S").time()
                        return datetime(
                            alert_local_naive.year,
                            alert_local_naive.month,
                            alert_local_naive.day,
                            time_part.hour,
                            time_part.minute,
                            time_part.second
                        )
                    except Exception:
                        return None
                return None

            def choose_best_alert_doc(docs):
                best = None
                best_diff = None
                for doc in docs:
                    parsed_dt = None
                    for field in ("received_at", "time", "timestamp"):
                        parsed_dt = parse_db_datetime(doc.get(field))
                        if parsed_dt is not None:
                            break
                    if parsed_dt is None:
                        continue
                    if parsed_dt.tzinfo is None:
                        parsed_dt = parsed_dt.replace(tzinfo=alert_dt.tzinfo or datetime.now().astimezone().tzinfo)
                    diff = abs((parsed_dt - alert_dt).total_seconds())
                    if best_diff is None or diff < best_diff:
                        best_diff = diff
                        best = doc
                return best

            date_prefix = alert_local_naive.strftime("%Y-%m-%d")
            candidates = list(_db["mqtt_logs"].find({
                "ip": {"$in": ip_candidates},
                "received_at": {"$regex": f"^{re.escape(date_prefix)}"}
            }).sort("received_at", -1).limit(100))
            alert_doc = choose_best_alert_doc(candidates)

            if not alert_doc:
                alert_doc = _db["mqtt_logs"].find_one({
                    "ip": {"$in": ip_candidates},
                    "received_at": {"$regex": f"^{re.escape(time[:16])}"}
                })
            if not alert_doc:
                alert_doc = _db["mqtt_logs"].find_one({
                    "ip": {"$in": ip_candidates},
                    "time": {"$regex": f"^{re.escape(time[:16])}"}
                })
            
            if alert_doc:
                alert_type_str = alert_doc.get("type", "Alert")
                msg_data = alert_doc.get("message", {}).get("data", {})
                
                if isinstance(msg_data, dict):
                    box_data = msg_data.get("box") or msg_data.get("bbox") or msg_data.get("rect") or msg_data.get("rectangle")
                    if box_data:
                        if isinstance(box_data, list) and len(box_data) == 4:
                            bbox = box_data
                        elif isinstance(box_data, dict):
                            x = box_data.get("x")
                            y = box_data.get("y")
                            w = box_data.get("w") or box_data.get("width")
                            h = box_data.get("h") or box_data.get("height")
                            if all(v is not None for v in [x, y, w, h]):
                                bbox = [x, y, w, h]
        except Exception as db_err:
            print("[ALERT THUMBNAIL] DB search error:", db_err)

        # ── 3. Find the best chunk in DB ──────────────────────────────
        CHUNK_SECONDS = 300
        ip_prefix = ip.strip().replace(".", "_")
        recordings_col = _db["recordings"]

        all_cam_ids = recordings_col.distinct(
            "camera_id",
            {"camera_id": {"$regex": f"^{re.escape(ip_prefix)}"}}
        )
        if not all_cam_ids:
            all_cam_ids = [ip_prefix, ip.strip()]

        def find_best_chunk_db(date_str, hms_str):
            best = None
            for cam_id in all_cam_ids:
                candidate = recordings_col.find_one(
                    {
                        "camera_id":  cam_id,
                        "date":       date_str,
                        "start_time": {"$lte": hms_str},
                        "status":     {"$in": ["COMPLETE", "INCOMPLETE"]}
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
                doc_date_str = doc["date"]
                doc_time_str = doc["start_time"]
                
                cy, cmo, cd = map(int, re.split(r"[-:]", doc_date_str))
                ch, cm, cs = map(int, re.split(r"[-:]", doc_time_str))
                
                chunk_naive_dt = datetime(cy, cmo, cd, ch, cm, cs)
                elapsed = (alert_local_naive - chunk_naive_dt).total_seconds()

                actual_duration = float(doc.get("duration_seconds", CHUNK_SECONDS))

                if elapsed <= actual_duration + 2:
                    enc_path = doc.get("file_path", "").replace("\\", "/")
            except Exception:
                pass

        # Filesystem fallback scan
        if not enc_path:
            rec_dir   = recorder.get_recordings_dir()
            best_file = None
            best_diff = None

            for cam_folder in os.listdir(rec_dir):
                if not cam_folder.startswith(ip_prefix):
                    continue
                date_dir = os.path.join(rec_dir, cam_folder, alert_local_date)
                if not os.path.isdir(date_dir):
                    continue
                for fname in os.listdir(date_dir):
                    if not fname.endswith(".enc"):
                        continue
                    stem = fname.replace(".enc", "")
                    try:
                        fparts = re.split(r"[-:]", stem)
                        fh, fm, fs = int(fparts[0]), int(fparts[1]), int(fparts[2])
                        file_naive_dt = datetime(alert_local_naive.year, alert_local_naive.month, alert_local_naive.day, fh, fm, fs)
                        diff = (alert_local_naive - file_naive_dt).total_seconds()
                    except Exception:
                        continue
                    if 0 <= diff <= CHUNK_SECONDS + 30:
                        if best_diff is None or diff < best_diff:
                            best_diff = diff
                            best_file = os.path.join(date_dir, fname)

            if best_file:
                enc_path = best_file
                stem     = os.path.basename(best_file).replace(".enc", "")
                fparts   = re.split(r"[-:]", stem)
                fh, fm, fs = int(fparts[0]), int(fparts[1]), int(fparts[2])
                file_naive_dt = datetime(alert_local_naive.year, alert_local_naive.month, alert_local_naive.day, fh, fm, fs)
                elapsed = (alert_local_naive - file_naive_dt).total_seconds()

        is_minio = enc_path and enc_path.startswith("minio:")
        if not enc_path or (not is_minio and not os.path.exists(enc_path)):
            print(f"[ALERT THUMBNAIL] No recording found for {ip} at {time}")
            return fallback_svg(alert_type_str)

        # ── 4. Decrypt ────────────────────────────────────────────────
        # Decryption will be streamed directly into ffmpeg stdin

        # ── 5. Extract frame ──────────────────────────────────────────
        jpg_tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        jpg_path = jpg_tmp.name
        jpg_tmp.close()

        vf_filters = []
        if bbox:
            try:
                bx, by, bw, bh = [float(v) for v in bbox]
                if any(0.0 <= v <= 1.0 for v in [bx, by, bw, bh]):
                    vf_filters.append(f"scale=640:360")
                    bx_px = max(0, int(bx * 640))
                    by_px = max(0, int(by * 360))
                    bw_px = max(20, int(bw * 640))
                    bh_px = max(20, int(bh * 360))
                    vf_filters.append(f"drawbox=x={bx_px}:y={by_px}:w={bw_px}:h={bh_px}:color=0x22C55E@0.8:t=2")
                    if crop == 1:
                        pad_w = int(bw_px * 0.25)
                        pad_h = int(bh_px * 0.25)
                        crop_x = max(0, bx_px - pad_w)
                        crop_y = max(0, by_px - pad_h)
                        crop_w = min(640 - crop_x, bw_px + 2 * pad_w)
                        crop_h = min(360 - crop_y, bh_px + 2 * pad_h)
                        vf_filters.append(f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}")                    
                else:
                    bx, by, bw, bh = int(bx), int(by), int(bw), int(bh)
                    vf_filters.append(f"drawbox=x={bx}:y={by}:w={bw}:h={bh}:color=0x22C55E@0.8:t=2")
                    if crop == 1:
                        pad_w = int(bw * 0.25)
                        pad_h = int(bh * 0.25)
                        crop_x = max(0, int(bx - pad_w))
                        crop_y = max(0, int(by - pad_h))
                        crop_w = min(1920 - crop_x, int(bw + 2 * pad_w))
                        crop_h = min(1080 - crop_y, int(bh + 2 * pad_h))
                        vf_filters.append(f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}")
                    else:
                        vf_filters.append("scale=640:-1")
            except Exception as filter_err:
                print("[ALERT THUMBNAIL] Filter parse error:", filter_err)
                vf_filters = ["scale=320:-1"]
        else:
            vf_filters.append("scale=320:-1")

        ffmpeg_cmd = [
            FFMPEG_BIN, "-y",
            "-ss", str(max(0, elapsed)),
            "-i", "pipe:0",
            "-vframes", "1",
            "-vf", ",".join(vf_filters),
            "-f", "image2",
            jpg_path
        ]

        try:
            from app.utils.ffmpeg_utils import stream_to_ffmpeg_sync
            success, _ = stream_to_ffmpeg_sync(ffmpeg_cmd, encrypt_service.decrypt_file_stream(enc_path))
        except Exception as dec_err:
            print(f"[ALERT THUMBNAIL] Extraction failed: {dec_err}")
            success = False

        if success and os.path.exists(jpg_path) and os.path.getsize(jpg_path) > 200:
            with open(jpg_path, "rb") as f:
                img_data = f.read()
            try:
                os.remove(jpg_path)
            except Exception:
                pass

            return Response(
                content=img_data,
                media_type="image/jpeg",
                headers={
                    "Content-Length":              str(len(img_data)),
                    "Cache-Control":               "max-age=60",
                }
            )
        else:
            ffmpeg_cmd_retry = [
                FFMPEG_BIN, "-y",
                "-i", "pipe:0",
                "-vframes", "1",
                "-vf", ",".join(vf_filters),
                "-f", "image2",
                jpg_path
            ]
            try:
                stream_to_ffmpeg_sync(ffmpeg_cmd_retry, encrypt_service.decrypt_file_stream(enc_path))
            except Exception:
                pass
                
            if os.path.exists(jpg_path) and os.path.getsize(jpg_path) > 200:
                with open(jpg_path, "rb") as f:
                    img_data = f.read()
                try:
                    os.remove(jpg_path)
                except Exception:
                    pass
                return Response(
                    content=img_data,
                    media_type="image/jpeg",
                    headers={
                        "Content-Length":              str(len(img_data)),
                        "Cache-Control":               "max-age=60",
                    }
                )

        try:
            os.remove(jpg_path)
        except Exception:
            pass
        return fallback_svg(alert_type_str)

    except Exception as e:
        print(f"[ALERT THUMBNAIL] Error: {e}")
        return fallback_svg("Error")

from pydantic import BaseModel, Field
from typing import List

class ReportScheduleSchema(BaseModel):
    report_type: str = Field(..., max_length=255)
    schedule_type: str = Field(..., max_length=255)
    recipients: List[str]
    format: str = Field(..., max_length=255)
    send_time: str = "09:00"
    enabled: bool = True

@router.get("/reports/schedules", )
def get_report_schedules():
    try:
        col = _db["report_schedules"]
        schedules = list(col.find({"is_deleted": {"$ne": True}}))
        # Convert ObjectId -> string
        for s in schedules:
            s["id"] = str(s["_id"])
            del s["_id"]
        return {"success": True, "schedules": schedules}
    except Exception as e:
        return {"success": False, "error": str(e), "schedules": []}

@router.post("/reports/schedules", )
def save_report_schedule(schedule: ReportScheduleSchema):
    try:
        col = _db["report_schedules"]
        doc = schedule.dict()
        doc["updated_at"] = datetime.utcnow().isoformat()
        doc["created_at"] = datetime.utcnow().isoformat()
        doc["last_run"] = None
        col.insert_one(doc)
            
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.delete("/reports/schedules/{schedule_id}", )
def delete_report_schedule(schedule_id: str):
    try:
        col = _db["report_schedules"]
        res = col.update_one({"_id": ObjectId(schedule_id)}, {"$set": {"is_deleted": True}})
        if res.modified_count > 0:
            return {"success": True}
        return {"success": False, "error": "Schedule not found"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ── PROCESS MONITOR & HARDWARE SCALING ENDPOINTS ─────────────────────────────
@router.get("/dashboard/system-metrics/processes", )
def get_system_process_metrics():
    try:
        from app.services.monitoring.process_monitor import get_vms_process_metrics
        return get_vms_process_metrics()
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/dashboard/hardware-scaling-report", )
def get_hardware_scaling_report():
    try:
        from app.services.monitoring.process_monitor import calculate_hardware_scaling_report
        return calculate_hardware_scaling_report()
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.post("/dashboard/system-metrics/kill-orphaned-ffmpeg", )
def kill_orphaned_ffmpeg():
    try:
        from app.services.monitoring.process_monitor import kill_orphaned_ffmpeg_processes
        return kill_orphaned_ffmpeg_processes()
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/dashboard/process-history", )
def get_process_history(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    service: Optional[str] = Query("all"),
    status: Optional[str] = Query("all"),
    limit: Optional[int] = Query(100)
):
    try:
        from app.services.monitoring.process_monitor import get_process_history_logs
        return get_process_history_logs(
            start_date=start_date,
            end_date=end_date,
            service=service,
            status=status,
            limit=limit
        )
    except Exception as e:
        return {"success": False, "error": str(e), "logs": []}




@router.post("/reports/send-manual", )
async def send_manual_email_endpoint(
    to: str = Form(...),
    cc: Optional[str] = Form(None),
    subject: str = Form(""),
    body: str = Form(""),
    files: List[UploadFile] = File(None)
):
    try:
        from app.services.email_service import send_manual_email
        recipients = [r.strip() for r in to.split(",") if r.strip()]
        
        if cc:
            cc_recipients = [r.strip() for r in cc.split(",") if r.strip()]
            recipients.extend(cc_recipients)
            
        attachments = []
        if files:
            for f in files:
                if f.filename:
                    data = await f.read()
                    attachments.append({
                        "filename": f.filename,
                        "data": data
                    })
                    
        success, msg = send_manual_email(recipients, subject, body, attachments)
        if success:
            try:
                # Save to history
                col = _db["manual_emails_history"]
                col.insert_one({
                    "to": to,
                    "cc": cc or "",
                    "subject": subject,
                    "body": body,
                    "timestamp": datetime.utcnow().isoformat(),
                    "has_attachments": bool(attachments),
                    "attachment_names": [a["filename"] for a in attachments] if attachments else []
                })
            except Exception as dberr:
                print(f"Failed to log email history: {dberr}")
            return {"success": True}
        else:
            return {"success": False, "error": msg}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/reports/manual-history", )
def get_manual_email_history():
    try:
        col = _db["manual_emails_history"]
        history = list(col.find({}).sort("timestamp", -1).limit(50))
        for h in history:
            h["id"] = str(h["_id"])
            del h["_id"]
        return {"success": True, "history": history}
    except Exception as e:
        return {"success": False, "error": str(e)}


from bson import ObjectId

@router.get('/alerts/details/{alert_id}', dependencies=[Depends(verify_token)])
def get_alert_details(alert_id: str):
    if _db is None:
        return {'error': 'No DB'}
    try:
        # First check analytics_events
        doc = _db['analytics_events'].find_one({'_id': ObjectId(alert_id)})
        if not doc:
            doc = _db['mqtt_logs'].find_one({'_id': ObjectId(alert_id)})
        if not doc:
            # Fallback search by string if it was custom id
            doc = _db['analytics_events'].find_one({'id': alert_id})
        if not doc:
            doc = _db['mqtt_logs'].find_one({'id': alert_id})
            
        if not doc:
            return {'error': 'Not found'}
            
        doc['_id'] = str(doc['_id'])
        
        # Fetch camera details
        cam = None
        if doc.get('ip'):
            cam = _db['cameras'].find_one({'ip': doc['ip']}, {'_id': 0, 'name': 1})
            
        return {
            'id': doc['_id'],
            'ip': doc.get('ip', 'Unknown'),
            'camera_name': cam['name'] if cam and 'name' in cam else 'Unknown',
            'event_name': doc.get('type') or doc.get('scenario', 'Unknown'),
            'status': doc.get('status', 'Active'),
            'received_at': doc.get('received_at', doc.get('time', 'Unknown'))
        }
    except Exception as e:
        return {'error': str(e)}

@router.put('/alerts/{alert_id}/status', dependencies=[Depends(verify_token)])
def update_alert_status(alert_id: str, payload: dict):
    if _db is None:
        return {'error': 'No DB'}
    status = payload.get('status', 'Active')
    action = payload.get('action', status)
    note = payload.get('note', '')
    from datetime import datetime
    now_str = datetime.now().isoformat()
    update_dict = {'status': status}
    
    if action == 'Acknowledged':
        update_dict['acknowledge_at'] = now_str
        update_dict['acknowlege_note'] = note
    elif action == 'Resolved':
        update_dict['resolved_at'] = now_str
        update_dict['notes'] = note
        
    try:
        res = _db['analytics_events'].update_one({'_id': ObjectId(alert_id)}, {'$set': update_dict})
        if res.matched_count == 0:
            res = _db['mqtt_logs'].update_one({'_id': ObjectId(alert_id)}, {'$set': update_dict})
        if res.matched_count == 0:
            res = _db['external_ai_alerts'].update_one({'_id': ObjectId(alert_id)}, {'$set': update_dict})
        
        # fallback string match
        if res.matched_count == 0:
            res = _db['analytics_events'].update_one({'id': alert_id}, {'$set': update_dict})
        if res.matched_count == 0:
            res = _db['mqtt_logs'].update_one({'id': alert_id}, {'$set': update_dict})
        if res.matched_count == 0:
            res = _db['external_ai_alerts'].update_one({'id': alert_id}, {'$set': update_dict})
        # Send full payload to Redis for external AI alerts
        try:
            query = {'$or': [{'_id': ObjectId(alert_id)}, {'id': alert_id}]}
            updated_doc = _db['external_ai_alerts'].find_one(query)
            if not updated_doc:
                updated_doc = _db['analytics_events'].find_one(query)
            if not updated_doc:
                updated_doc = _db['mqtt_logs'].find_one(query)

            if updated_doc:
                updated_doc['_id'] = str(updated_doc['_id'])
                import redis
                import json
                import uuid
                from datetime import datetime, timezone
                r = redis.Redis(host='127.0.0.1', port=6379, decode_responses=True)
                import os
                stream_name = os.environ.get("REDIS_STREAM_OTHER_EVENTS", "vms:events:otherevent")
                msg = {
                    "version": "1.0",
                    "event_id": str(uuid.uuid4()),
                    "event_type": "alerts",
                    "source": "vms",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "payload": json.dumps(updated_doc, default=str),
                }
                print(f"=== SENDING TO REDIS STREAM '{stream_name}' ===")
                print(json.dumps(msg, indent=2))
                print("===============================================")
                r.xadd(stream_name, msg, maxlen=10000, approximate=True)
                r.close()
        except Exception as redis_err:
            print(f"Failed to publish to redis: {redis_err}")
            
            
        return {'success': True, 'status': status, 'action': action, 'note': note, 'updated_at': now_str}
    except Exception as e:
        return {'error': str(e)}
