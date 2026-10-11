"""
ai_alerts_router.py
Router to handle incoming alert notifications from the external AI Backend team.
Endpoint: POST /api/v1/ai/alerts
"""
from fastapi import Path, APIRouter, HTTPException, Depends, Header, status, Request
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import os
import logging
import json
import base64
import uuid
from app.core.ws_manager import ws_manager


try:
    from app.core.database import analytics_col, db
except ImportError:
    analytics_col = None
    db = None

router = APIRouter(prefix="/api/v1/ai", tags=["AI Alerts Webhook"])
logger = logging.getLogger(__name__)

# Collection to store incoming alerts
# ai_alerts_col = analytics_col if analytics_col is not None else (db["analytics_events"] if db is not None else None)
ai_alerts_col = None

# class AIAlertPayload(BaseModel):
#     camera_id: Optional[str] = Field(None, description="Camera ID or IP Address")
#     reader_id: Optional[str] = Field(None, description="Reader ID or Serial")
#     alert_type: str = Field(..., description="Type of alert e.g. INTRUSION_DETECTION, FACE_RECOGNITION, MOTION")
#     severity: Optional[str] = Field("INFO", description="Severity level e.g. INFO, WARNING, CRITICAL")
#     timestamp: Optional[str] = Field(None, description="Timestamp of the event")
#     confidence: Optional[float] = Field(None, description="Confidence score from AI model")
#     snapshot_url: Optional[str] = Field(None, description="URL or path to alert snapshot image")
#     details: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Additional metadata or alert details")

#     class Config:
#         extra = "allow"  # Allows additional fields sent by AI team without raising validation errors

class AIAlertResponse(BaseModel):
    status: str
    message: str
    alert_id: Optional[str] = None

def verify_bearer_token(authorization: Optional[str] = Header(None)):
    """
    Verifies incoming Authorization: Bearer <token> header against AI_API_BEARER_TOKEN env variable.
    If AI_API_BEARER_TOKEN is not configured, token verification is bypassed.
    """
    expected_token = os.environ.get("AI_API_BEARER_TOKEN", "").strip()
    if expected_token:
        if not authorization:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing Authorization header",
                headers={"WWW-Authenticate": "Bearer"}
            )
        parts = authorization.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Authorization header format. Expected 'Bearer <token>'",
                headers={"WWW-Authenticate": "Bearer"}
            )
        token = parts[1]
        if token != expected_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid secret bearer token",
                headers={"WWW-Authenticate": "Bearer"}
            )
    return True

@router.post("/alerts", response_model=AIAlertResponse, dependencies=[Depends(verify_bearer_token)])
@router.post("/alerts/", response_model=AIAlertResponse, dependencies=[Depends(verify_bearer_token)], include_in_schema=False)
# async def process_ai_alert(payload: AIAlertPayload):
async def process_ai_alert(request: Request):
    try:
        from app.core.database import cameras_col as current_cameras_col, db as current_db
        col = current_cameras_col if current_cameras_col is not None else (current_db["cameras"] if current_db is not None else None)

        if col is None:
            logger.error("Database connection unavailable for AI alerts endpoint.")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database connection unavailable"
            )

        # alert_data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        
        alert_data = await request.json()
        # Log the exact payload received from the AI team
        logger.info("===== RAW AI PAYLOAD =====")
        logger.info(json.dumps(alert_data, indent=4))
        logger.info("==========================")
        now_iso = datetime.utcnow().isoformat() + "Z"
        alert_data["received_at"] = now_iso
        if not alert_data.get("timestamp"):
            alert_data["timestamp"] = now_iso
        alert_data["source"] = "AI_WEBHOOK"

        cam_ip = alert_data.get("ip_address") or alert_data.get("ip") or alert_data.get("camera_id")
        if cam_ip:
            alert_data["ip"] = cam_ip
            alert_data["ip_address"] = cam_ip
            if not alert_data.get("stream_key"):
                alert_data["stream_key"] = cam_ip.replace(".", "_")

        result = col.insert_one(alert_data)
        alert_id = str(result.inserted_id)

        # Try to capture and persist a live snapshot at alert time if none provided
        try:
            if not alert_data.get("snapshot_url") and cam_ip:
                try:
                    from app.api.routers.brand_control import get_snapshot as brand_get_snapshot
                    snap_resp = await brand_get_snapshot(cam_ip)
                    if isinstance(snap_resp, dict) and snap_resp.get("success") and snap_resp.get("snapshot"):
                        b64 = snap_resp.get("snapshot")
                        # snapshot is like 'data:image/jpeg;base64,...'
                        if b64.startswith("data:") and "," in b64:
                            parts = b64.split(",", 1)
                            b64data = parts[1]
                        else:
                            b64data = b64
                        try:
                            img_bytes = base64.b64decode(b64data)
                            # save to snapshots dir
                            snapshots_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static", "snapshots")
                            snapshots_dir = os.path.abspath(snapshots_dir)
                            os.makedirs(snapshots_dir, exist_ok=True)
                            filename = f"snapshot_ai_{alert_id}_{uuid.uuid4().hex[:8]}.jpg"
                            filepath = os.path.join(snapshots_dir, filename)
                            with open(filepath, "wb") as f:
                                f.write(img_bytes)
                            # expose URL
                            snapshot_url = f"/api/snapshots/{filename}"
                            alert_data["snapshot_url"] = snapshot_url
                            alert_data["snapshot_time"] = datetime.utcnow().isoformat() + "Z"
                            logger.info(f"[AI_ALERT] Persisted snapshot for alert {alert_id} -> {snapshot_url}")
                        except Exception as save_err:
                            logger.warning(f"[AI_ALERT] Failed to save snapshot image for alert {alert_id}: {save_err}")
                except Exception as snap_err:
                    logger.warning(f"[AI_ALERT] Snapshot capture failed for {cam_ip}: {snap_err}")
        except Exception:
            pass

        # Broadcast via WebSocket after persisting to MongoDB
        ws_payload = {**alert_data}
        if "_id" in ws_payload:
            ws_payload["_id"] = alert_id
        ws_payload["alert_id"] = alert_id

        try:
            await ws_manager.broadcast("alerts", "ai_alert", ws_payload, event_id=alert_id)
            logger.info(f"[AI_ALERT] Broadcast alert {alert_id} over WebSocket topic 'alerts'")
        except Exception as ws_err:
            logger.warning(f"[AI_ALERT] Failed to broadcast over WebSocket: {ws_err}")
        logger.info(f"[AI_ALERT] Payload saved: {alert_data}")

        # Register stream with MediaMTX and start RTSP recorder
        rtsp_url = alert_data.get("rtsp_url")
        if cam_ip and rtsp_url:
            stream_name = alert_data.get("stream_key") or cam_ip.replace(".", "_")
            alert_data["enabled"] = alert_data.get("enabled", True)

            # 1. Register with MediaMTX for Live View WebRTC player
            try:
                from app.services.camera import mediamtx_service
                mediamtx_service.register_stream(stream_name, rtsp_url)
                logger.info(f"[AI_ALERT] Registered MediaMTX path: {stream_name}")
            except Exception as mtx_err:
                logger.warning(f"[AI_ALERT] Could not register MediaMTX stream {stream_name}: {mtx_err}")

            # 2. Start recording engine
            try:
                from app.services.storage import rtsp_recorder
                rtsp_recorder.start_camera(stream_name, rtsp_url, alert_data)
                logger.info(f"[AI_ALERT] Automatically started recording stream: {stream_name}")
            except Exception as rec_err:
                logger.warning(f"[AI_ALERT] Could not auto-start recording for {cam_ip}: {rec_err}")

        return AIAlertResponse(
            status="success",
            message="Alert received and processed successfully",
            alert_id=alert_id
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[AI_ALERT] Error processing AI alert: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process alert: {str(e)}"
        )


@router.put("/alerts", response_model=AIAlertResponse, dependencies=[Depends(verify_bearer_token)])
@router.put("/alerts/", response_model=AIAlertResponse, dependencies=[Depends(verify_bearer_token)], include_in_schema=False)
@router.put("/alerts/{reader_id}", response_model=AIAlertResponse, dependencies=[Depends(verify_bearer_token)])
async def update_ai_alert(request: Request, alert_id: Optional[str] = None):
    try:
        from app.core.database import cameras_col as current_cameras_col, db as current_db
        from bson import ObjectId
        col = current_cameras_col if current_cameras_col is not None else (current_db["cameras"] if current_db is not None else None)

        if col is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database connection unavailable"
            )

        update_data = await request.json()
        logger.info("===== RAW AI UPDATE PAYLOAD =====")
        logger.info(json.dumps(update_data, indent=4))
        logger.info("=================================")

        target_id = alert_id or update_data.get("alert_id") or update_data.get("_id") or update_data.get("id") or update_data.get("reader_id")
        cam_ip = update_data.get("ip_address") or update_data.get("ip") or update_data.get("camera_id") or request.query_params.get("ip")

        if cam_ip:
            update_data["ip"] = cam_ip
            update_data["ip_address"] = cam_ip

        update_data["updated_at"] = datetime.utcnow().isoformat() + "Z"

        if target_id:
            result = None
            try:
                result = col.update_many({"_id": ObjectId(target_id)}, {"$set": update_data})
            except Exception:
                result = None

            if not result or result.matched_count == 0:
                result = col.update_many({
                    "$or": [
                        {"reader_id": target_id},
                        {"camera_id": target_id},
                        {"ip_address": target_id},
                        {"ip": target_id},
                        {"alert_id": target_id},
                        {"_id": target_id}
                    ]
                }, {"$set": update_data})

            return AIAlertResponse(
                status="success",
                message=f"Updated {result.modified_count if result else 0} alert(s) for '{target_id}'",
                alert_id=str(target_id)
            )
        elif cam_ip:
            query = {"$or": [{"ip": cam_ip}, {"ip_address": cam_ip}, {"camera_id": cam_ip}]}
            result = col.update_many(query, {"$set": update_data})
            return AIAlertResponse(
                status="success",
                message=f"Updated {result.modified_count} alert(s) for camera '{cam_ip}'",
                alert_id=cam_ip
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Must provide reader_id, alert_id (_id), or camera_id/ip_address/ip in payload or URL to update"
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[AI_ALERT] Error updating AI alert: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update alert: {str(e)}"
        )


@router.delete("/alerts", response_model=AIAlertResponse, dependencies=[Depends(verify_bearer_token)])
@router.delete("/alerts/", response_model=AIAlertResponse, dependencies=[Depends(verify_bearer_token)], include_in_schema=False)
@router.delete("/alerts/{reader_id}", response_model=AIAlertResponse, dependencies=[Depends(verify_bearer_token)])
async def delete_ai_alert(request: Request, alert_id: Optional[str] = None):
    try:
        from app.core.database import cameras_col as current_cameras_col, db as current_db
        from bson import ObjectId
        col = current_cameras_col if current_cameras_col is not None else (current_db["cameras"] if current_db is not None else None)

        if col is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Database connection unavailable"
            )

        body_data = {}
        try:
            body_data = await request.json()
        except Exception:
            pass

        target_id = alert_id or body_data.get("alert_id") or body_data.get("_id") or body_data.get("id") or body_data.get("reader_id") or request.query_params.get("reader_id")
        cam_ip = body_data.get("ip_address") or body_data.get("ip") or body_data.get("camera_id") or request.query_params.get("ip") or request.query_params.get("camera_id")

        if target_id:
            result = None
            try:
                result = col.update_many({"_id": ObjectId(target_id)}, {"$set": {"is_deleted": True}})
            except Exception:
                result = None

            if not result or result.modified_count == 0:
                result = col.update_many({
                    "$or": [
                        {"reader_id": target_id},
                        {"camera_id": target_id},
                        {"ip_address": target_id},
                        {"ip": target_id},
                        {"alert_id": target_id},
                        {"_id": target_id}
                    ]
                }, {"$set": {"is_deleted": True}})

            return AIAlertResponse(
                status="success",
                message=f"Deleted {result.modified_count if result else 0} alert(s) for '{target_id}'",
                alert_id=str(target_id)
            )
        elif cam_ip:
            query = {"$or": [{"ip": cam_ip}, {"ip_address": cam_ip}, {"camera_id": cam_ip}]}
            result = col.update_many(query, {"$set": {"is_deleted": True}})
            return AIAlertResponse(
                status="success",
                message=f"Deleted {result.modified_count} alert(s) for camera '{cam_ip}'",
                alert_id=cam_ip
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Must provide reader_id, alert_id (_id), or camera_id/ip_address/ip in payload, query params, or URL to delete"
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[AI_ALERT] Error deleting AI alert: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete alert: {str(e)}"
        )


# Reader Analytics route to retrieve alerts by reader_id
reader_router = APIRouter(prefix="/api", tags=["Reader Analytics"])

@reader_router.get("/reader/{reader_id}/analytics")
@router.get("/alerts/by-reader/{reader_id}")
def get_alerts_by_reader(reader_id: str):
    from app.core.database import cameras_col as current_cameras_col, db as current_db
    col = current_cameras_col if current_cameras_col is not None else (current_db["cameras"] if current_db is not None else None)
    if col is None:
        raise HTTPException(status_code=500, detail="Database connection unavailable")

    docs = list(col.find(
        {"$or": [{"reader_id": reader_id}, {"camera_id": reader_id}, {"ip": reader_id}, {"ip_address": reader_id}], "is_deleted": {"$ne": True}},
        {"_id": 0}
    ))
    return {
        "success": True,
        "reader_id": reader_id,
        "count": len(docs),
        "alerts": docs
    }


# Python urllib-based media proxy to bypass python.exe socket blocks on port 9000
from fastapi.responses import StreamingResponse
import urllib.request

@router.get("/media/{path:path}")
def proxy_external_ai_media(path: str = Path(..., max_length=1024)):
    target_url = f"http://192.168.126.201:9000/{path}"
    try:
        # Fetch directly using standard urllib which is allowed on system level
        req = urllib.request.Request(target_url, method="GET")
        response = urllib.request.urlopen(req, timeout=10)
        
        content_type = response.headers.get("Content-Type", "image/jpeg")
        
        def iter_file():
            while True:
                chunk = response.read(16384)
                if not chunk:
                    break
                yield chunk
                
        return StreamingResponse(iter_file(), media_type=content_type)
    except Exception as e:
        logger.error(f"[AI_MEDIA_PROXY] urllib fetch failed for {target_url}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to stream media: {e}")
