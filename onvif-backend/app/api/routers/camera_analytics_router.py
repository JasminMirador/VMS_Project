"""
camera_analytics_router.py

Add this router to your main.py:
    from app.api.routers.camera_analytics_router import camera_analytics_router
    

Endpoint: GET /api/camera-analytics/{device_id}

How it works:
  1. device_id can be camera IP or serial number
  2. Queries mqtt_logs collection for that camera
  3. Returns unique analytics types/scenarios found in MQTT logs
  4. If none found → returns empty list (frontend shows "No Built-in Analytics Supported")
"""

from fastapi import APIRouter
from app.core.database import mongo_client
import os

camera_analytics_router = APIRouter()

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")

try:
    _mongo = mongo_client
    _db_name = os.environ.get("MONGO_DB_NAME")
    _db = _mongo[_db_name] if _mongo else None
    mqtt_logs_col = _db["mqtt_logs"]
except Exception as e:
    print(f"[CAMERA_ANALYTICS] ❌ MongoDB connection failed: {e}")
    mqtt_logs_col = None


# ── Friendly descriptions for known analytics types ───────────────
ANALYTICS_DESCRIPTIONS = {
    "ObjectInArea":       "Triggered when an object is detected inside a defined area.",
    "OccupancyCount":     "Triggered based on the number of people/objects in a defined zone.",
    "CrossLine":          "Triggered when an object crosses a virtual line.",
    "MotionDetection":    "Triggered when motion is detected in the camera view.",
    "Tampering":          "Triggered when camera tampering is detected.",
    "FaceDetection":      "Triggered when a face is detected in the camera view.",
    "VehicleDetection":   "Triggered when a vehicle is detected in the defined area.",
    "LoiteringGuard":     "Triggered when an object lingers in a defined area for too long.",
    "IntrusionDetection": "Triggered when an intrusion event is detected.",
    "SoundDetection":     "Triggered when a specific sound level or type is detected.",
}

def get_description(event_type: str, scenario: str) -> str:
    """Return a human-readable description for the analytic type."""
    # Try exact match first
    desc = ANALYTICS_DESCRIPTIONS.get(event_type) or ANALYTICS_DESCRIPTIONS.get(scenario)
    if desc:
        return desc
    # Fallback: generic
    label = event_type or scenario or "Unknown"
    return f"Triggered by {label} events reported by this camera via MQTT."


@camera_analytics_router.get("/api/camera-analytics/{device_id}")
async def get_camera_analytics(device_id: str):
    """
    Returns unique built-in analytics types found in MQTT logs for a given
    camera (matched by IP or serial number).

    Response:
      { "analytics": [ { "type": "...", "scenario": "...", "description": "..." } ] }
    
    If no MQTT logs found for this camera → { "analytics": [] }
    """
    if mqtt_logs_col is None:
        return {"analytics": [], "error": "Database not connected"}

    # Match by IP or serial.
    # Axis native MQTT stores ip as underscore-format (192_168_1_100).
    # VMS-published events (Bosch/Dahua/Hikvision) also use underscore format.
    # We accept both dot and underscore from the caller.
    ip_dot   = device_id.replace("_", ".")
    ip_slug  = device_id.replace(".", "_")

    query = {
        "$or": [
            {"ip":     device_id},
            {"ip":     ip_dot},
            {"ip":     ip_slug},
            {"serial": device_id},
            {"serial": ip_slug},
        ]
    }

    try:
        # Get all distinct type+scenario combinations for this camera (most recent first)
        docs = list(
            mqtt_logs_col.find(
                query,
                {"_id": 0, "type": 1, "scenario": 1, "topic_analytics": 1, "topic_event": 1}
            ).sort("time", -1).limit(2000)
        )

        if not docs:
            return {"analytics": []}

        # Deduplicate: build a set of unique (type, scenario) pairs
        seen = set()
        analytics = []

        for doc in docs:
            event_type = (doc.get("type") or "").strip()
            scenario   = (doc.get("scenario") or "").strip()

            # Fallback to topic fields
            if not event_type:
                event_type = (doc.get("topic_event") or doc.get("topic_analytics") or "").strip()
            if not scenario:
                scenario = (doc.get("topic_analytics") or "").strip()

            # Skip empty
            if not event_type and not scenario:
                continue

            # Use event_type as the primary display label
            display_type = event_type or scenario
            key = display_type.lower()

            # Ignore motion and counter analytics per user request
            if "motion" in key or "counter" in key:
                continue

            if key in seen:
                continue
            seen.add(key)

            analytics.append({
                "type":        display_type,
                "scenario":    scenario,
                "description": get_description(event_type, scenario),
            })

        return {"analytics": analytics}

    except Exception as e:
        print(f"[CAMERA_ANALYTICS] ❌ Query failed for {device_id}: {e}")
        return {"analytics": [], "error": str(e)}

@camera_analytics_router.get("/api/camera-analytics/{device_id}/preferences")
async def get_camera_analytics_preferences(device_id: str):
    """
    Returns the enabled analytics for a given camera.
    """
    try:
        _mongo = mongo_client
        _db_name = os.environ.get("MONGO_DB_NAME")
        _db = _mongo[_db_name] if _mongo else None
        subs_col = _db["analytics_subscriptions"] if _db is not None else None
        
        if subs_col is None:
             return {"enabled": []}
             
        doc = subs_col.find_one({"device_id": device_id})
        if doc:
            return {"enabled": doc.get("enabled", [])}
        return {"enabled": []}
    except Exception as e:
        print(f"[CAMERA_ANALYTICS] ❌ Failed to get preferences for {device_id}: {e}")
        return {"enabled": []}

from pydantic import BaseModel
from typing import List

class PreferencesPayload(BaseModel):
    enabled: List[str]

@camera_analytics_router.put("/api/camera-analytics/{device_id}/preferences")
async def set_camera_analytics_preferences(device_id: str, payload: PreferencesPayload):
    """
    Sets the enabled analytics for a given camera.
    """
    try:
        _mongo = mongo_client
        _db_name = os.environ.get("MONGO_DB_NAME")
        _db = _mongo[_db_name] if _mongo else None
        subs_col = _db["analytics_subscriptions"] if _db is not None else None
        
        if subs_col is None:
             return {"success": False, "error": "Database not connected"}
             
        subs_col.update_one(
            {"device_id": device_id},
            {"$set": {"enabled": payload.enabled}},
            upsert=True
        )
        return {"success": True}
    except Exception as e:
        print(f"[CAMERA_ANALYTICS] ❌ Failed to set preferences for {device_id}: {e}")
        return {"success": False, "error": str(e)}

@camera_analytics_router.get("/api/camera-analytics-preferences")
async def get_all_camera_analytics_preferences():
    """
    Returns the enabled analytics for all cameras.
    """
    try:
        _mongo = mongo_client
        _db_name = os.environ.get("MONGO_DB_NAME")
        _db = _mongo[_db_name] if _mongo else None
        subs_col = _db["analytics_subscriptions"] if _db is not None else None
        
        if subs_col is None:
             return {"preferences": []}
             
        docs = list(subs_col.find({}, {"_id": 0, "device_id": 1, "enabled": 1}))
        return {"preferences": docs}
    except Exception as e:
        print(f"[CAMERA_ANALYTICS] ❌ Failed to get all preferences: {e}")
        return {"preferences": []}