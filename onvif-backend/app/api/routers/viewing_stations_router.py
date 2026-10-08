"""
viewing_stations_router.py — Viewing Station management and remote layout pushing.
Persists viewing stations in MongoDB with JSON fallback.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional
import os
import json
import time

from app.core.security import verify_token
from app.core.database import db as _db

router = APIRouter(prefix="/api/viewing-stations", tags=["viewing-stations"])

# ── Storage Backend ──────────────────────────────────────────────────
_stations_col = None
try:
    from app.core.database import mongo_client
    if mongo_client:
        _stations_col = mongo_client[os.environ.get("MONGO_DB_NAME")]["viewing_stations"]
        print("[STATIONS] ✅ MongoDB backend ready")
except Exception as e:
    print(f"[STATIONS] ⚠️ MongoDB unavailable ({e}) — using JSON fallback")

STATIONS_FILE = os.environ.get(
    "STATIONS_FILE",
    os.path.join(os.path.dirname(__file__), "..", "..", "devices_data", "viewing_stations.json")
)

def _load_file() -> dict:
    """Load all stations from JSON file → {station_id: station_doc}"""
    try:
        if os.path.exists(STATIONS_FILE):
            with open(STATIONS_FILE) as f:
                return json.load(f)
    except Exception as e:
        print(f"[STATIONS] JSON load error: {e}")
    return {}

def _save_file(data: dict):
    try:
        os.makedirs(os.path.dirname(STATIONS_FILE), exist_ok=True)
        with open(STATIONS_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[STATIONS] JSON save error: {e}")

# ── Helpers ──────────────────────────────────────────────────────────

def _get_station(station_id: str) -> Optional[dict]:
    if _stations_col is not None:
        try:
            return _stations_col.find_one({"station_id": station_id}, {"_id": 0})
        except Exception as e:
            print(f"[STATIONS] MongoDB get error: {e}")

    data = _load_file()
    return data.get(station_id)

def _save_station(station: dict):
    station_id = station["station_id"]
    if _stations_col is not None:
        try:
            _stations_col.update_one(
                {"station_id": station_id},
                {"$set": station},
                upsert=True
            )
            return
        except Exception as e:
            print(f"[STATIONS] MongoDB save error: {e}")

    data = _load_file()
    data[station_id] = station
    _save_file(data)

def _get_all_stations() -> List[dict]:
    if _stations_col is not None:
        try:
            return list(_stations_col.find({}, {"_id": 0}))
        except Exception as e:
            print(f"[STATIONS] MongoDB list error: {e}")

    data = _load_file()
    return list(data.values())

# ── Pydantic Models ──────────────────────────────────────────────────
from pydantic import BaseModel, Field, field_validator
import re
from fastapi import HTTPException

NAME_REGEX = re.compile(r"^[a-zA-Z0-9 _.-]+$")
class HeartbeatRequest(BaseModel):
    station_id: str = Field(..., max_length=255)
    name: str = Field(..., max_length=255)
    grid: str = Field(..., max_length=255)
    device_order: List[Optional[str]]
    applied_timestamp: Optional[float] = 0.0
    active_feeds_count: Optional[int] = 0

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if v and not NAME_REGEX.match(v):
            raise ValueError("Name contains invalid characters")
        return v

class PushLayoutRequest(BaseModel):
    station_id: str = Field(..., max_length=255)
    grid: str = Field(..., max_length=255)
    device_order: List[Optional[str]]

# ── Routes ───────────────────────────────────────────────────────────

@router.post("/heartbeat")
def heartbeat(req: HeartbeatRequest, payload: dict = Depends(verify_token)):
    """
    Heartbeat endpoint. Receives current status from a station,
    updates last_seen, and checks if a layout push is pending.
    """
    now = time.time()
    existing = _get_station(req.station_id)

    email = "Unknown"
    role = payload.get("role", "Unknown")
    user_id = payload.get("sub")
    if _db is not None and user_id:
        from bson.objectid import ObjectId
        try:
            user = _db["users"].find_one({"_id": ObjectId(user_id)})
            if user:
                email = user.get("email", "Unknown")
                role = user.get("role", role)
        except Exception:
            pass

    if existing:
        station = existing
    else:
        # Register new station
        station = {
            "station_id": req.station_id,
            "name": req.name,
            "pushed_layout": None,
        }

    # Update active status
    station["name"] = req.name
    station["last_seen"] = now
    station["active_layout"] = {
        "grid": req.grid,
        "device_order": req.device_order
    }
    station["active_feeds_count"] = req.active_feeds_count
    station["email"] = email
    station["role"] = role

    _save_station(station)

    # Check for pending pushed layout
    pushed = station.get("pushed_layout")
    if pushed and pushed.get("timestamp", 0.0) > req.applied_timestamp:
        return {
            "success": True,
            "pushed_layout": {
                "grid": pushed["grid"],
                "device_order": pushed["device_order"],
                "timestamp": pushed["timestamp"]
            }
        }

    return {
        "success": True,
        "pushed_layout": None
    }

@router.get("")
def list_stations():
    """List all registered stations and calculate online status."""
    now = time.time()
    stations = _get_all_stations()
    result = []
    
    for s in stations:
        last_seen = s.get("last_seen", 0.0)
        # Online if checked in during the last 12 seconds
        is_online = (now - last_seen) < 12.0
        
        if is_online:
            result.append({
                "station_id": s.get("station_id"),
                "name": s.get("name", "Unknown Terminal"),
                "is_online": is_online,
                "last_seen": last_seen,
                "active_layout": s.get("active_layout"),
                "pushed_layout": s.get("pushed_layout"),
                "active_feeds_count": s.get("active_feeds_count", 0),
                "email": s.get("email", "Unknown"),
                "role": s.get("role", "Unknown")
            })
        
    return {"success": True, "stations": result}

@router.post("/push")
def push_layout(req: PushLayoutRequest):
    """Push a layout layout (grid mode + camera order) to a station."""
    station = _get_station(req.station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")

    station["pushed_layout"] = {
        "grid": req.grid,
        "device_order": req.device_order,
        "timestamp": time.time()
    }
    
    _save_station(station)
    return {"success": True, "message": f"Layout successfully pushed to {station.get('name')}"}


# ── Twilio STUN/TURN ICE Servers Endpoint ───────────────────────────
_ice_cache = {"expires_at": 0.0, "servers": []}

@router.get("/ice-servers")
def get_ice_servers():
    """Returns dynamic Twilio STUN/TURN ICE servers for WebRTC."""
    import requests
    now = time.time()
    if _ice_cache["servers"] and now < _ice_cache["expires_at"]:
        return {"success": True, "iceServers": _ice_cache["servers"]}

    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "AC92f79e34bd75672bb4ba8f3e4a5350ef")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "fd3b6227050c3a02568f0ba30cbfa4b0")

    try:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Tokens.json"
        res = requests.post(url, auth=(account_sid, auth_token), timeout=5)
        if res.status_code in (200, 201):
            data = res.json()
            ice_servers = data.get("ice_servers", [])
            _ice_cache["servers"] = ice_servers
            _ice_cache["expires_at"] = now + 3600 * 6  # cache for 6 hours
            return {"success": True, "iceServers": ice_servers}
        else:
            print(f"[TWILIO] Token fetch failed ({res.status_code}): {res.text}")
    except Exception as e:
        print(f"[TWILIO] Error requesting tokens: {e}")

    # Fallback to Google and Twilio public STUN
    return {
        "success": True,
        "iceServers": [
            {"urls": "stun:global.stun.twilio.com:3478"},
            {"urls": "stun:stun.l.google.com:19302"}
        ]
    }

 
