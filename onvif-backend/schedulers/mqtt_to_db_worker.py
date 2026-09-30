import os
import json
import asyncio
import paho.mqtt.client as mqtt
from app.core.database import mongo_client
from datetime import datetime, timezone, timedelta

# ── Config ─────────────────────────────────────────────────────────
MQTT_BROKER  = "192.168.126.2"
MQTT_PORT    = int(os.environ.get("MQTT_PORT", 1883))

# Topics to subscribe:
#   axis/#  → Axis cameras pushing their own MQTT events (existing)
#   vms/#   → VMS-published events for Bosch, Dahua, Hikvision
#   vms/analytics/alerts/#    → External AI system publishes real-time alerts here
MQTT_TOPICS  = [
    ("axis/#", 1),
    ("vms/#",  1),
    ("vms/analytics/response/#", 1),
    ("vms/analytics/alerts/#", 1),
]

MONGO_URI    = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB     = os.environ.get("MONGO_DB_NAME", "vms_demo")
MONGO_COL    = "mqtt_logs"

SKIP_TOPICS  = {"connection", "status", "birth", "lwt"}

# ───────────────────────────────────────────────────────────────────
IST = timezone(timedelta(hours=5, minutes=30))

collection   = mongo_client[MONGO_DB][MONGO_COL]
external_collection = mongo_client[MONGO_DB]["external_ai_alerts"]


def break_topic(topic: str) -> dict:
    try:
        if "tns:axis/" in topic:
            topic = topic.split("tns:axis/")[-1]
            topic = f"axis:{topic}"

        stripped = topic.replace("axis:", "")
        parts = stripped.split("/")

        return {
            "topic": topic,
            "topic_platform": parts[0] if len(parts) > 0 else None,
            "topic_analytics": parts[1] if len(parts) > 1 else None,
            "topic_event": parts[2] if len(parts) > 2 else None,
        }

    except Exception:
        return {
            "topic": topic,
            "topic_platform": None,
            "topic_analytics": None,
            "topic_event": None,
        }


# ── MQTT Callbacks ─────────────────────────────────────────────────
def on_connect(client, userdata, flags, reason_code, properties):
    print(f"[MQTT] Connected to {MQTT_BROKER}:{MQTT_PORT} (rc={reason_code})")
    for topic, qos in MQTT_TOPICS:
        client.subscribe(topic, qos=qos)
        print(f"[MQTT] Subscribed: {topic}")


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode("utf-8"))
    except Exception:
        print(f"[SKIP] Invalid JSON: {msg.topic}")
        return

    # ── VMS-published events (Bosch / Dahua / Hikvision) ───────────
    # Topic format: vms/{brand}/{ip_underscored}/event
    # Payload is already normalized by mqtt_publisher.py
    if msg.topic.startswith("vms/") and not msg.topic.startswith("vms/analytics/response") and not msg.topic.startswith("vms/analytics/alerts"):
        parts = msg.topic.split("/")   # ['vms', brand, ip_slug, 'event']
        brand   = parts[1] if len(parts) > 1 else "unknown"
        ip_slug = parts[2] if len(parts) > 2 else None
        ip_addr = ip_slug.replace("_", ".") if ip_slug else payload.get("ip", "")

        recv_at = payload.get("received_at", datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S+05:30"))
        if isinstance(recv_at, str) and "." in recv_at:
            recv_at = recv_at.split(".")[0]

        time_val = payload.get("time", "")
        if isinstance(time_val, str) and "." in time_val:
            time_val = time_val.split(".")[0]

        document = {
            "received_at":      recv_at,
            "topic":            msg.topic,
            "topic_platform":   brand,
            "topic_analytics":  payload.get("type", ""),
            "topic_event":      payload.get("scenario", ""),
            "timestamp":        payload.get("received_at"),
            "ip":               ip_slug,          # stored in underscore format (same as Axis)
            "serial":           payload.get("serial", ip_slug),
            "time":             time_val,
            "scenario":         payload.get("scenario", ""),
            "type":             payload.get("type", "Unknown"),
            "human":            payload.get("human"),
            "total":            payload.get("total"),
            "class":            payload.get("class"),
            "object_id":        payload.get("object_id"),
            "active":           payload.get("active"),
            "status":           "Active",
            "source":           brand,
            "raw":              payload.get("raw", {}),
            "message":          {"data": payload},
        }

        try:
            result = collection.insert_one(document)
            print(f"[{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')}] [SAVED/{brand.upper()}] {result.inserted_id} | ip={ip_addr} | type={document['type']}")
        except Exception as e:
            print(f"[{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')}] [DB ERROR/{brand.upper()}] Failed to insert document: {e}")
        return

    # ── External AI System sync response ──────────────────────────
    if msg.topic.startswith("vms/analytics/response"):
        print(f"[SYNC] Received analytics sync configuration, skipping DB insert for now.")
        return

    # ── External AI System alerts ──────────────────────────
    # Topic format: vms/analytics/alerts
    if msg.topic.startswith("vms/analytics/alerts"):
        cam_ip   = payload.get("ip_address") or payload.get("camera_ip") or payload.get("readerIp") or "unknown"
        ip_slug  = cam_ip.replace(".", "_")

        alert_type = (
            payload.get("alert_type")
            or payload.get("type")
            or payload.get("event_type")
            or "AI Alert"
        )
        scenario = (
            payload.get("scenario")
            or payload.get("description")
            or payload.get("label")
            or alert_type
        )

        # Save the exact payload keys to the root document, plus the nested raw payload
        document = {
            "received_at": datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S+05:30"),
            "topic": msg.topic,
            "source": "external_ai",
            "ip": ip_slug,
            "raw": payload
        }
        # Merge existing keys from the queue payload directly into the document
        for k, v in payload.items():
            if k not in document:
                document[k] = v

        try:
            result = external_collection.insert_one(document)
            print(f"[{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')}] [SAVED/AI] {result.inserted_id} | ip={cam_ip} | type={alert_type}")
        except Exception as e:
            print(f"[{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')}] [DB ERROR/AI] Failed to insert document: {e}")
        return

    # ── Axis-native MQTT events (existing logic) ────────────────────
    # Skip unwanted topics
    if msg.topic.split("/")[-1].lower() in SKIP_TOPICS:
        print(f"[SKIP] {msg.topic}")
        return

    print("\n========== NEW EVENT ==========")
    print("TOPIC:", msg.topic)

    data = payload.get("message", {}).get("data", {})
    print("DATA:", json.dumps(data, indent=2))

    # ✅ Accept only valid events
    if not data:
        return

    # ✅ Convert topic
    topic_parts = break_topic(msg.topic)

    # ─────────────────────────────────────────
    # 🔥 EXTRACT IP FROM TOPIC (IMPORTANT FIX)
    # ─────────────────────────────────────────
    topic_ip = None
    try:
        parts = msg.topic.split("/")
        # Example: axis/192.168.126.240/event/...
        if len(parts) > 1:
            topic_ip = parts[1]
    except Exception:
        topic_ip = None

    # Convert to folder format
    if topic_ip:
        topic_ip = topic_ip.replace(".", "_")

    print(f"[IP EXTRACTED] {topic_ip}")

    # ─────────────────────────────────────────
    # ✅ Event name + type
    # ─────────────────────────────────────────
    scenario      = data.get("scenario")
    scenario_type = data.get("scenarioType")

    event_type = scenario_type or topic_parts.get("topic_event") or "Unknown"
    event_name = scenario or scenario_type or topic_parts.get("topic_event") or "Unknown"

    event_type = str(event_type).strip()
    event_name = str(event_name).strip()

    # ─────────────────────────────────────────
    # ✅ FINAL DOCUMENT
    # ─────────────────────────────────────────
    document = {
        "received_at": datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S+05:30"),

        "topic": topic_parts["topic"],
        "topic_platform": topic_parts["topic_platform"],
        "topic_analytics": topic_parts["topic_analytics"],
        "topic_event": topic_parts["topic_event"],

        "timestamp": payload.get("timestamp"),

        # ✅ FIXED (NOW WILL NOT BE NULL)
        "ip": topic_ip,

        "serial": payload.get("serial"),

        "time": str(data.get("triggerTime")).split(".")[0] if isinstance(data.get("triggerTime"), str) and "." in data.get("triggerTime") else data.get("triggerTime"),
        "scenario": event_name,
        "type": event_type,

        "human": data.get("human"),
        "total": data.get("total"),
        "class": data.get("classTypes"),
        "object_id": data.get("objectId"),

        "active": data.get("active"),
        "status": "Active",

        "message": {
            "source": payload.get("message", {}).get("source", {}),
            "key": payload.get("message", {}).get("key", {}),
            "data": data
        }
    }

    try:
        result = collection.insert_one(document)
        print(f"[{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')}] [SAVED] {result.inserted_id} | type={event_type} | scenario={event_name}")
    except Exception as e:
        print(f"[{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')}] [DB ERROR] Failed to insert document: {e}")


# ── Run Client ─────────────────────────────────────────────────────
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.on_connect = on_connect
client.on_message = on_message

def start_mqtt():
    print(f"[MQTT] Connecting to {MQTT_BROKER}:{MQTT_PORT} ...")
    client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
    client.loop_forever()

if __name__ == "__main__":
    start_mqtt()
