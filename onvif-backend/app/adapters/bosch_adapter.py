"""
bosch_adapter.py
────────────────
Bosch camera analytics via ONVIF PullPoint subscription.

Handles Bosch firmware quirks:
  - "Argument Value Invalid" when Timeout != PT0S
  - Subscription reference address binding
  - Initialized vs Changed event filtering
  - Persistent subscription to avoid losing buffered events

Requirements:
    pip install onvif-zeep
"""

from __future__ import annotations
import traceback
from datetime import datetime, timedelta
from typing import Any

# ── ONVIF topic → human-readable event type map ──────────────────────────────
TOPIC_MAP: dict[str, str] = {
    "tns1:VideoAnalytics/Motion/MotionAlarm":          "Motion",
    "tns1:VideoAnalytics/MotionDetection":             "Motion",
    "tns1:VideoAnalytics/ObjectInField":               "Object Detection",
    "tns1:VideoAnalytics/LineCrossing":                "LineCrossing",
    "tns1:VideoAnalytics/TamperDetection":             "Tamper",
    "tns1:RuleEngine/MotionDetector/Motion":           "Motion",
    "tns1:RuleEngine/FieldDetector/ObjectsInside":     "Object Detection",
    "tns1:RuleEngine/LineDetector/Crossed":            "LineCrossing",
    "tns1:RuleEngine/TamperDetector/Tamper":           "Tamper",
    "tns1:VideoSource/MotionAlarm":                    "Motion",
    "tns1:RuleEngine/MyRuleDetector":                  "Motion",
    "tns1:Device/Trigger":                             "Motion",
}

# Topics to IGNORE (stream stats/technical status, not alerts)
IGNORE_TOPICS = {
    "tns1:Monitoring/Profile/ActiveConnections",
    "tns1:Device/Trigger/Relay",
    "tns1:Device/Trigger/DigitalInput",
    "tns1:VideoSource/ImageTooBright/AnalyticsService",
    "tns1:VideoSource/ImageTooDark/AnalyticsService",
    "tns1:VideoSource/SignalLoss/AnalyticsService",
}

# ── Persistent subscription cache  { ip → {...} } ────────────────────────────
_subscriptions: dict[str, dict] = {}
_SUB_LIFETIME_SECONDS = 300   # 5 minutes; renew 60 s before expiry

# Timeout values to try for PullMessages, in order.
# Many Bosch firmwares reject anything > PT0S.
_TIMEOUT_CANDIDATES = ["PT0S", "PT1S", "PT5S"]


def _topic_str(notif: Any) -> str:
    if notif is None:
        return ""

    # 1. Try to get it from the raw XML of the Message element (extremely robust fallback for zeep quirks)
    try:
        msg = getattr(notif, "Message", None)
        if msg and hasattr(msg, "_value_1"):
            el = msg._value_1
            # Check if el is an lxml/etree Element
            if hasattr(el, "getparent"):
                parent = el.getparent()
                if parent is not None:
                    grandparent = parent.getparent()
                    if grandparent is not None:
                        topic_els = grandparent.xpath(".//*[local-name()='Topic']")
                        if topic_els and topic_els[0].text:
                            return topic_els[0].text.strip()
    except Exception:
        pass

    # 2. Try the default zeep parsing
    obj = getattr(notif, "Topic", None)
    if obj is None:
        return ""
    if isinstance(obj, str):
        return obj.strip()
    if hasattr(obj, "_value_1") and obj._value_1 is not None:
        val = str(obj._value_1).strip()
        if val.lower() != "none":
            return val
    val = str(obj).strip()
    return val if val.lower() != "none" else ""


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if hasattr(value, "_value_1"):
        return str(value._value_1)
    return str(value)


def _map_event_type(topic: str) -> str:
    topic_lower = topic.lower()
    if "motion" in topic_lower:
        return "Motion"
    if "occupancy" in topic_lower:
        return "OccupancyCount"
    if "leavingfield" in topic_lower or "leaving" in topic_lower:
        return "LeavingField"
    if "enteringfield" in topic_lower or "entering" in topic_lower:
        return "EnteringField"
    if "linecounter" in topic_lower or "countaggregation" in topic_lower:
        return "Counter"
    if "idleobject" in topic_lower or "stationaryobject" in topic_lower or "idle" in topic_lower:
        return "IdleObject"
    if "objectinfield" in topic_lower or "objectsinside" in topic_lower or "fielddetector" in topic_lower:
        return "Object Detection"
    if "crossingline" in topic_lower or "linedetector" in topic_lower or "linecrossing" in topic_lower or "crossed" in topic_lower:
        return "LineCrossing"
    if "loitering" in topic_lower:
        return "Loitering"
    if "tamper" in topic_lower:
        return "Tamper"

    for key, label in TOPIC_MAP.items():
        if key in topic:
            return label
    parts = topic.replace("//", "/").rstrip("/").split("/")
    if len(parts) >= 2:
        category = parts[-2]
        if category.lower() in ("iva", "ruleengine", "videosource", "device", "monitoring"):
            return parts[-1]
        return category
    return parts[-1] if parts else "Unknown"


# ── Subscription helpers ──────────────────────────────────────────────────────

def _create_subscription(ip: str, port: int, username: str, password: str) -> dict:
    """
    Create a brand-new PullPoint subscription and return a cache entry dict.
    Also probes which PullMessages Timeout value this firmware accepts.
    """
    from onvif import ONVIFCamera

    print(f"[BOSCH] 🔗 Creating PullPoint subscription for {ip}")
    cam = ONVIFCamera(ip, port, username, password)
    event_service = cam.create_events_service()

    # Try with lifetime arg first; some old Bosch firmwares reject it
    try:
        subscription = event_service.CreatePullPointSubscription(
            {"InitialTerminationTime": f"PT{_SUB_LIFETIME_SECONDS}S"}
        )
    except Exception:
        try:
            subscription = event_service.CreatePullPointSubscription({})
        except Exception as e:
            raise RuntimeError(f"Cannot create PullPoint subscription: {e}") from e

    pullpoint = cam.create_pullpoint_service()

    # Bind to the subscription's own address if the camera returned one
    sub_addr = ""
    try:
        addr = subscription.SubscriptionReference.Address
        sub_addr = _safe_str(addr)
        if sub_addr:
            pullpoint._client._binding_options["address"] = sub_addr
            print(f"[BOSCH] {ip} → sub address: {sub_addr}")
    except Exception:
        pass

    # ── Probe which Timeout value this firmware accepts ───────────────
    working_timeout = "PT0S"
    for t in _TIMEOUT_CANDIDATES:
        try:
            pullpoint.PullMessages({"MessageLimit": 1, "Timeout": t})
            working_timeout = t
            print(f"[BOSCH] {ip} → working Timeout: {t}")
            break
        except Exception as probe_err:
            err_str = str(probe_err).lower()
            if "argument value invalid" in err_str or "invalid" in err_str:
                continue   # try next
            # Any other error (network, soap fault unrelated to timeout) — just use PT0S
            print(f"[BOSCH] {ip} → timeout probe {t} failed ({probe_err}), trying next")

    now = datetime.utcnow()
    return {
        "pullpoint":       pullpoint,
        "event_service":   event_service,
        "cam":             cam,
        "working_timeout": working_timeout,
        "expires_at":      now + timedelta(seconds=_SUB_LIFETIME_SECONDS - 60),
        "sub_addr":        sub_addr,
    }


def _get_subscription(ip: str, port: int, username: str, password: str) -> dict:
    """Return a valid cached subscription entry, creating one if needed."""
    cached = _subscriptions.get(ip)
    if cached and datetime.utcnow() < cached["expires_at"]:
        return cached

    # Stale or missing — create fresh
    if cached:
        try:
            cached["event_service"].Unsubscribe({})
        except Exception:
            pass
        del _subscriptions[ip]

    entry = _create_subscription(ip, port, username, password)
    _subscriptions[ip] = entry
    return entry


def _invalidate(ip: str) -> None:
    if ip not in _subscriptions:
        return
    try:
        _subscriptions[ip]["event_service"].Unsubscribe({})
    except Exception:
        pass
    del _subscriptions[ip]
    print(f"[BOSCH] 🗑  Cleared subscription for {ip}")


# ── Public API ────────────────────────────────────────────────────────────────

def pull_bosch_events(
    ip: str,
    port: int = 80,
    username: str = "",
    password: str = "",
    timeout_seconds: int = 5,   # kept for API compat but Bosch may override
    max_messages: int = 50,
) -> dict:
    """
    Pull pending ONVIF events from a Bosch camera.

    Returns {"success": bool, "events": list[dict], "error": str|None}
    """
    try:
        from onvif import ONVIFCamera  # noqa: F401 – just check import
    except ImportError:
        return {
            "success": False,
            "events":  [],
            "error":   "onvif-zeep not installed — run: pip install onvif-zeep",
        }

    events: list[dict] = []

    for attempt in range(2):   # allow one re-subscribe on failure
        try:
            sub = _get_subscription(ip, port, username, password)
            pullpoint       = sub["pullpoint"]
            working_timeout = sub["working_timeout"]

            response = pullpoint.PullMessages({
                "MessageLimit": max_messages,
                "Timeout":      working_timeout,
            })
            break   # success

        except Exception as pull_err:
            err_msg = str(pull_err)
            print(f"[BOSCH] ⚠ PullMessages failed for {ip} (attempt {attempt+1}): {err_msg}")
            _invalidate(ip)

            if attempt == 1:
                # Second attempt also failed
                print(f"[BOSCH] ❌ Giving up on {ip} this cycle")
                return {"success": False, "events": [], "error": err_msg}
            # else: loop again — _get_subscription will rebuild

    notifications = getattr(response, "NotificationMessage", []) or []

    if not notifications:
        print(f"[BOSCH] {ip} reachable, no events currently")
        return {"success": True, "events": [], "error": None}

    print(f"[BOSCH] {ip} → {len(notifications)} raw notification(s)")

    for notif in notifications:
        topic = _topic_str(notif)
        if not topic or topic.lower() == "none":
            continue  # Skip events with missing or None topics

        # ── Timestamp ────────────────────────────────────────────────
        utc_time = datetime.utcnow().isoformat()
        try:
            msg = getattr(notif, "Message", None)
            body = msg._value_1 if msg and hasattr(msg, "_value_1") else None
            if body is not None and hasattr(body, "get"):
                t = body.get("UtcTime")
                if t:
                    utc_time = str(t)
            else:
                # Fallback to zeep parsed attributes
                inner = getattr(msg, "Message", msg) if msg else None
                t = getattr(inner, "UtcTime", None) if inner else None
                if t:
                    utc_time = t.isoformat() if hasattr(t, "isoformat") else str(t)
        except Exception:
            pass

        # ── Raw key-value pairs ───────────────────────────────────────
        raw: dict[str, Any] = {"topic": topic}
        try:
            msg  = getattr(notif, "Message", None)
            body = msg._value_1 if msg and hasattr(msg, "_value_1") else None
            if body is None and msg:
                body = getattr(msg, "Message", msg)

            if body is not None:
                # Case A: body is an XML Element (standard for zeep any element)
                if hasattr(body, "xpath"):
                    prop_op = body.get("PropertyOperation")
                    if prop_op:
                        raw["PropertyOperation"] = str(prop_op)

                    simple_items = body.xpath(".//*[local-name()='SimpleItem']")
                    for item in simple_items:
                        name = item.get("Name")
                        val_attr = item.get("Value")
                        if name:
                            raw[name] = str(val_attr) if val_attr is not None else ""
                # Case B: body is a parsed zeep object (fallback)
                else:
                    for section_name in ("Source", "Data"):
                        section = getattr(body, section_name, None)
                        if section:
                            for item in (getattr(section, "SimpleItem", []) or []):
                                k = _safe_str(getattr(item, "Name",  ""))
                                v = _safe_str(getattr(item, "Value", ""))
                                if k:
                                    raw[k] = v
                    op = getattr(body, "PropertyOperation", None)
                    if op:
                        raw["PropertyOperation"] = _safe_str(op)
        except Exception:
            pass

        # ── Filter out baseline snapshots and "off" states ────────────
        prop_op = raw.get("PropertyOperation", "").lower()

        is_counter_topic  = any(x in topic.lower() for x in ("linecounter", "countaggregation"))
        is_leaving_topic  = any(x in topic.lower() for x in ("leavingfield", "leaving"))

        # Counter: "Initialized" = subscription snapshot (current count), not a new crossing.
        # Only "Changed" means someone actually crossed the line right now.
        if is_counter_topic and prop_op != "changed":
            continue

        # LeavingField: "Initialized" = camera registering its current zone state on subscribe.
        # Only "Changed" + State=true means an object actually exited the zone right now.
        if is_leaving_topic:
            if prop_op != "changed":
                continue
            leaving_state = (raw.get("State") or raw.get("Active") or raw.get("Value") or "").lower()
            if leaving_state in ("false", "0", "inactive", "no", "off"):
                continue  # Zone change ended / object returned — not an exit alert

        # All other topics: drop "Initialized" (subscription snapshot)
        if not is_counter_topic and not is_leaving_topic and prop_op == "initialized" and "occupancy" not in topic.lower():
            continue   # just the camera's current-state snapshot on subscribe

        value = (raw.get("Value") or raw.get("Active") or raw.get("State") or "").lower()
        if not is_counter_topic and not is_leaving_topic and value in ("false", "0", "inactive", "no", "off"):
            continue   # event ended / no trigger

        # ── Filter out technical system/network status logs ───────────
        if topic in IGNORE_TOPICS:
            continue

        event_type = _map_event_type(topic)

        scenario_name = topic.split("/")[-1] if "/" in topic else "Detect Any Object"

        events.append({
            "event_type":    event_type,
            "scenario_name": scenario_name,
            "topic":         topic,
            "utc_time":      utc_time,
            "source":        "bosch",
            "raw":           raw,
        })

    if events:
        print(f"[BOSCH] ✅ {ip} → {len(events)} actionable event(s)")

    return {"success": True, "events": events, "error": None}