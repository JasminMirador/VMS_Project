"""
brand_control.py
────────────────────────────────────────────────────────────────
Brand-specific camera control using the detected api_profile.
Handles: Motion Detection, Smart Events, Line Crossing, Intrusion
for Dahua, Hikvision, Axis, Bosch — all via their native HTTP APIs.

Add to main.py:
    from app.api.routers.brand_control import brand_router
    
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import requests
import urllib3
from requests.auth import HTTPDigestAuth, HTTPBasicAuth

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

brand_router = APIRouter(prefix="/api/camera/brand", tags=["brand-control"])

# ─────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────

class BrandControlRequest(BaseModel):
    ip:       str
    port:     int    = 80
    username: str    = ""
    password: str    = ""
    brand:    str    = ""   # auto-detected if empty


class MotionDetectRequest(BrandControlRequest):
    channel:  int  = 1
    enabled:  bool = True
    sensitivity: int = 60   # 0-100


class SmartEventRequest(BrandControlRequest):
    channel:   int  = 1
    event_type: str = "LineDetection"  # LineDetection, FieldDetection, FaceDetect
    enabled:   bool = True


class ChannelRequest(BrandControlRequest):
    channel: int = 1


# ─────────────────────────────────────────────────────────────────
# Auth helper
# ─────────────────────────────────────────────────────────────────

def _auth(username, password, method="digest"):
    if method == "basic":
        return HTTPBasicAuth(username, password)
    return HTTPDigestAuth(username, password)


def _get(url, username, password, auth_method="digest", timeout=5):
    for auth in [_auth(username, password, auth_method),
                 _auth(username, password, "basic")]:
        try:
            r = requests.get(url, auth=auth, verify=False, timeout=timeout)
            if r.status_code != 401:
                return r
        except Exception:
            pass
    return None


def _post(url, username, password, data=None, json=None, auth_method="digest", timeout=5):
    for auth in [_auth(username, password, auth_method),
                 _auth(username, password, "basic")]:
        try:
            r = requests.post(url, auth=auth, data=data, json=json,
                              verify=False, timeout=timeout)
            if r.status_code != 401:
                return r
        except Exception:
            pass
    return None


def _put(url, username, password, json=None, xml=None, auth_method="digest", timeout=5):
    headers={}
    if xml:
        headers["Content-Type"] = "application/xml"
    for auth in [_auth(username, password, auth_method),
                 _auth(username, password, "basic")]:
        try:
            r = requests.put(url, auth=auth, json=json,
                             data=xml, headers=headers,
                             verify=False, timeout=timeout)
            if r.status_code != 401:
                return r
        except Exception:
            pass
    return None


# ─────────────────────────────────────────────────────────────────
# DAHUA handlers
# ─────────────────────────────────────────────────────────────────

def _dahua_get_config(ip, username, password, config_name):
    url = f"http://{ip}/cgi-bin/configManager.cgi?action=getConfig&name={config_name}"
    r = _get(url, username, password)
    if not r or r.status_code != 200:
        return None
    # Parse key=value lines into dict
    result = {}
    for line in r.text.strip().split("\n"):
        line = line.strip()
        if "=" in line:
            k, _, v = line.partition("=")
            result[k.strip()] = v.strip()
    return result


def _dahua_set_config(ip, username, password, params: dict):
    """Send multiple config params in one CGI request."""
    param_str = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"http://{ip}/cgi-bin/configManager.cgi?action=setConfig&{param_str}"
    r = _get(url, username, password)
    return r and r.status_code == 200 and "OK" in r.text


def _dahua_get_motion(ip, username, password, channel=1):
    idx = channel - 1
    cfg = _dahua_get_config(ip, username, password, "MotionDetect")
    if cfg is None:
        return None
    enabled_key = f"table.MotionDetect[{idx}].Enable"
    sensitivity_key = f"table.MotionDetect[{idx}].Level"
    return {
        "enabled":     cfg.get(enabled_key, "false").lower() == "true",
        "sensitivity": int(cfg.get(sensitivity_key, "60")),
        "channel":     channel,
    }


def _dahua_set_motion(ip, username, password, channel=1, enabled=True, sensitivity=60):
    idx = channel - 1
    params = {
        f"table.MotionDetect[{idx}].Enable":          "true" if enabled else "false",
        f"table.MotionDetect[{idx}].Level":            str(max(0, min(6, sensitivity // 17))),  # 0-6 scale
        f"table.MotionDetect[{idx}].SensitiveLevel":   str(sensitivity),
    }
    return _dahua_set_config(ip, username, password, params)


def _dahua_get_smart_event(ip, username, password, event_type, channel=1):
    """Get smart event config: LineDetection, FieldDetection, FaceDetect"""
    cfg = _dahua_get_config(ip, username, password, event_type)
    if cfg is None:
        return None
    idx = channel - 1
    key = f"table.{event_type}[{idx}].Enable"
    return {
        "event_type": event_type,
        "enabled":    cfg.get(key, "false").lower() == "true",
        "channel":    channel,
    }


def _dahua_set_smart_event(ip, username, password, event_type, channel=1, enabled=True):
    idx = channel - 1
    params = {f"table.{event_type}[{idx}].Enable": "true" if enabled else "false"}
    return _dahua_set_config(ip, username, password, params)


def _dahua_get_snapshot(ip, username, password, channel=1):
    url = f"http://{ip}/cgi-bin/snapshot.cgi?channel={channel}"
    r = _get(url, username, password)
    if r and r.status_code == 200 and r.content:
        import base64
        return base64.b64encode(r.content).decode()
    return None


# ─────────────────────────────────────────────────────────────────
# HIKVISION handlers
# ─────────────────────────────────────────────────────────────────

def _hik_get_motion(ip, username, password, channel=1):
    url = f"http://{ip}/ISAPI/System/Video/inputs/channels/{channel}/motionDetection"
    r = _get(url, username, password, "digest")
    if not r or r.status_code != 200:
        return None
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(r.text)
        ns = {"h": "http://www.hikvision.com/ver20/XMLSchema"}
        # try with and without namespace
        enabled_el = root.find(".//enabled") or root.find(".//h:enabled", ns)
        sensitivity_el = root.find(".//sensitivityLevel") or root.find(".//h:sensitivityLevel", ns)
        return {
            "enabled":     enabled_el.text.lower() == "true" if enabled_el is not None else False,
            "sensitivity": int(sensitivity_el.text) if sensitivity_el is not None else 50,
            "channel":     channel,
            "raw_xml":     r.text,
        }
    except Exception as e:
        return {"enabled": False, "sensitivity": 50, "channel": channel, "parse_error": str(e)}


def _hik_set_motion(ip, username, password, channel=1, enabled=True, sensitivity=50):
    # First GET current config, then PUT with modified values
    url = f"http://{ip}/ISAPI/System/Video/inputs/channels/{channel}/motionDetection"
    r = _get(url, username, password, "digest")
    if not r or r.status_code != 200:
        return False
    import re
    xml = r.text
    xml = re.sub(r"<enabled>.*?</enabled>", f"<enabled>{'true' if enabled else 'false'}</enabled>", xml)
    xml = re.sub(r"<sensitivityLevel>.*?</sensitivityLevel>", f"<sensitivityLevel>{sensitivity}</sensitivityLevel>", xml)
    resp = _put(url, username, password, xml=xml.encode(), auth_method="digest")
    return resp and resp.status_code in (200, 204)


def _hik_get_smart_event(ip, username, password, event_type, channel=1):
    """event_type: LineDetection, FieldDetection, FaceDetect"""
    url = f"http://{ip}/ISAPI/Smart/{event_type}/{channel}"
    r = _get(url, username, password, "digest")
    if not r or r.status_code != 200:
        return None
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(r.text)
        enabled_el = root.find(".//enabled")
        return {
            "event_type": event_type,
            "enabled":    enabled_el.text.lower() == "true" if enabled_el is not None else False,
            "channel":    channel,
        }
    except Exception:
        return {"event_type": event_type, "enabled": False, "channel": channel}


def _hik_set_smart_event(ip, username, password, event_type, channel=1, enabled=True):
    url = f"http://{ip}/ISAPI/Smart/{event_type}/{channel}"
    r = _get(url, username, password, "digest")
    if not r or r.status_code != 200:
        return False
    import re
    xml = r.text
    xml = re.sub(r"<enabled>.*?</enabled>", f"<enabled>{'true' if enabled else 'false'}</enabled>", xml)
    resp = _put(url, username, password, xml=xml.encode(), auth_method="digest")
    return resp and resp.status_code in (200, 204)


def _hik_snapshot(ip, username, password, channel=1):
    url = f"http://{ip}/ISAPI/Streaming/channels/{channel}01/picture"
    r = _get(url, username, password, "digest")
    if r and r.status_code == 200 and r.content:
        import base64
        return base64.b64encode(r.content).decode()
    return None


# ─────────────────────────────────────────────────────────────────
# Auto-detect brand from db or ip
# ─────────────────────────────────────────────────────────────────

def _resolve_brand(ip: str, hint: str, cameras_col) -> str:
    """Get brand from MongoDB api_profile or use hint."""
    if hint:
        return hint.lower()
    if cameras_col is not None:
        doc = cameras_col.find_one({"$or": [{"ip": ip}, {"ip_address": ip}]}, {"api_profile": 1})
        if doc and doc.get("api_profile"):
            return doc["api_profile"].get("brand", "generic")
    return "generic"


# ─────────────────────────────────────────────────────────────────
# FASTAPI ROUTES
# ─────────────────────────────────────────────────────────────────

# We import cameras_col lazily to avoid circular imports
def _get_cameras_col():
    try:
        from main import cameras_col
        return cameras_col
    except Exception:
        return None


@brand_router.get("/motion/{ip}")
async def get_motion_detection(ip: str, channel: int = 1,
                                username: str = "", password: str = ""):
    """Get current motion detection state for any brand."""
    cameras_col = _get_cameras_col()
    if not username or not password:
        doc = cameras_col.find_one({"$or": [{"ip": ip}, {"ip_address": ip}]}, {"_id": 0}) if cameras_col else {}
        username = (doc or {}).get("username", "")
        password = (doc or {}).get("password", "")

    brand = _resolve_brand(ip, "", cameras_col)
    print(f"[BRAND] GET motion {ip} brand={brand}")

    if brand == "dahua":
        state = _dahua_get_motion(ip, username, password, channel)
        return {"success": True, "brand": brand, "ip": ip,
                "motion": state}
    elif brand == "hikvision":
        state = _hik_get_motion(ip, username, password, channel)
        return {"success": True, "brand": brand, "ip": ip,
                "motion": state}
    else:
        return {"success": False,
                "error": f"Brand '{brand}' motion detection not supported via HTTP",
                "brand": brand}


@brand_router.post("/motion/set")
async def set_motion_detection(req: MotionDetectRequest):
    cameras_col = _get_cameras_col()
    brand = _resolve_brand(req.ip, req.brand, cameras_col)
    print(f"[BRAND] SET motion {req.ip} enabled={req.enabled} brand={brand}")

    username = req.username
    password = req.password
    if not username or not password:
        doc = cameras_col.find_one({"$or": [{"ip": req.ip}, {"ip_address": req.ip}]}, {"_id": 0}) if cameras_col else {}
        username = (doc or {}).get("username", "")
        password = (doc or {}).get("password", "")

    if brand == "dahua":
        ok = _dahua_set_motion(req.ip, username, password,
                               req.channel, req.enabled, req.sensitivity)
    elif brand == "hikvision":
        ok = _hik_set_motion(req.ip, username, password,
                              req.channel, req.enabled)
    else:
        return {"success": False, "error": f"Brand '{brand}' set motion not supported",
                "brand": brand}

    return {"success": ok, "brand": brand, "ip": req.ip}


@brand_router.get("/smart-events/{ip}")
async def get_smart_events(ip: str, channel: int = 1,
                            username: str = "", password: str = ""):
    """Get all smart event states for any brand."""
    cameras_col = _get_cameras_col()
    if not username or not password:
        doc = cameras_col.find_one({"$or": [{"ip": ip}, {"ip_address": ip}]}, {"_id": 0}) if cameras_col else {}
        username = (doc or {}).get("username", "")
        password = (doc or {}).get("password", "")

    brand = _resolve_brand(ip, "", cameras_col)

    DAHUA_EVENTS = ["LineDetection", "FieldDetection", "FaceDetect",
                    "CrossRegionDetection", "SmartMotionDetect"]
    HIK_EVENTS   = ["LineDetection", "FieldDetection", "FaceDetect"]

    results = {}

    if brand == "dahua":
        for ev in DAHUA_EVENTS:
            r = _dahua_get_smart_event(ip, username, password, ev, channel)
            if r is not None:
                results[ev] = r
    elif brand == "hikvision":
        for ev in HIK_EVENTS:
            r = _hik_get_smart_event(ip, username, password, ev, channel)
            if r is not None:
                results[ev] = r
    else:
        return {"success": False,
                "error": f"Brand '{brand}' smart events not supported",
                "brand": brand}

    return {"success": True, "brand": brand, "ip": ip,
            "channel": channel, "smart_events": results}


@brand_router.post("/smart-events/set")
async def set_smart_event(req: SmartEventRequest):
    cameras_col = _get_cameras_col()
    brand = _resolve_brand(req.ip, req.brand, cameras_col)
    print(f"[BRAND] SET smart event {req.ip} {req.event_type}={req.enabled} brand={brand}")

    username = req.username
    password = req.password
    if not username or not password:
        doc = cameras_col.find_one({"$or": [{"ip": req.ip}, {"ip_address": req.ip}]}, {"_id": 0}) if cameras_col else {}
        username = (doc or {}).get("username", "")
        password = (doc or {}).get("password", "")

    if brand == "dahua":
        ok = _dahua_set_smart_event(req.ip, username, password,
                                    req.event_type, req.channel, req.enabled)
    elif brand == "hikvision":
        ok = _hik_set_smart_event(req.ip, username, password,
                                  req.event_type, req.channel, req.enabled)
    else:
        return {"success": False, "error": f"Brand '{brand}' smart events not supported",
                "brand": brand}

    return {"success": ok, "brand": brand, "ip": req.ip, "event_type": req.event_type}


@brand_router.get("/snapshot/{ip}")
async def get_snapshot(ip: str, channel: int = 1,
                        username: str = "", password: str = ""):
    """Get a live snapshot as base64 JPEG."""
    cameras_col = _get_cameras_col()
    if not username or not password:
        doc = cameras_col.find_one({"ip": ip}, {"_id": 0}) if cameras_col else {}
        username = (doc or {}).get("username", "")
        password = (doc or {}).get("password", "")

    brand = _resolve_brand(ip, "", cameras_col)

    if brand == "dahua":
        b64 = _dahua_get_snapshot(ip, username, password, channel)
    elif brand == "hikvision":
        b64 = _hik_snapshot(ip, username, password, channel)
    else:
        return {"success": False, "error": f"Snapshot not supported for brand '{brand}'"}

    if not b64:
        return {"success": False, "error": "Snapshot failed — camera may not support HTTP snapshot"}

    return {"success": True, "brand": brand,
            "snapshot": f"data:image/jpeg;base64,{b64}"}


@brand_router.get("/capabilities/{ip}")
async def get_brand_capabilities(ip: str, username: str = "", password: str = ""):
    """
    Returns what this specific camera can do via its native API.
    Frontend uses this to show/hide controls.
    """
    cameras_col = _get_cameras_col()
    if not username or not password:
        doc = cameras_col.find_one({"ip": ip}, {"_id": 0}) if cameras_col else {}
        username = (doc or {}).get("username", "")
        password = (doc or {}).get("password", "")

    brand = _resolve_brand(ip, "", cameras_col)

    caps = {
        "brand":             brand,
        "motion_detect":     False,
        "line_crossing":     False,
        "intrusion":         False,
        "face_detect":       False,
        "smart_motion":      False,
        "snapshot":          False,
        "ptz_native":        False,
    }

    if brand == "dahua":
        # Quick probe each capability
        for event, key in [
            ("MotionDetect",        "motion_detect"),
            ("LineDetection",       "line_crossing"),
            ("FieldDetection",      "intrusion"),
            ("FaceDetect",          "face_detect"),
            ("SmartMotionDetect",   "smart_motion"),
        ]:
            r = _dahua_get_config(ip, username, password, event)
            caps[key] = r is not None

        snap = _dahua_get_snapshot(ip, username, password)
        caps["snapshot"] = snap is not None

    elif brand == "hikvision":
        motion = _hik_get_motion(ip, username, password)
        caps["motion_detect"] = motion is not None
        for ev, key in [("LineDetection", "line_crossing"),
                         ("FieldDetection", "intrusion"),
                         ("FaceDetect", "face_detect")]:
            r = _hik_get_smart_event(ip, username, password, ev)
            caps[key] = r is not None
        snap = _hik_snapshot(ip, username, password)
        caps["snapshot"] = snap is not None

    return {"success": True, "ip": ip, "capabilities": caps}
