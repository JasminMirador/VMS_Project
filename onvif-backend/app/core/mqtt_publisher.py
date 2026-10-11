"""
mqtt_publisher.py
─────────────────
Lightweight MQTT publisher singleton used by the VMS to forward
camera alerts (Bosch, Dahua, Hikvision) into Mosquitto so they
flow through the unified mqtt_to_db_worker pipeline → mqtt_logs → UI.

Topic scheme published by this module:
    vms/{brand}/{ip_underscored}/event

Examples:
    vms/bosch/192_168_1_100/event
    vms/dahua/192_168_1_101/event
    vms/hikvision/192_168_1_102/event

The mqtt_to_db_worker.py subscribes to both:
    axis/#   ← Axis cameras (push directly)
    vms/#    ← All other brands (VMS publishes on their behalf)
"""

import json
import os
import logging
import threading
from datetime import datetime, timezone, timedelta

try:
    import paho.mqtt.client as mqtt
    PAHO_AVAILABLE = True
except ImportError:
    PAHO_AVAILABLE = False

logger = logging.getLogger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────
MQTT_BROKER = os.environ["MQTT_BROKER"]
MQTT_PORT   = int(os.environ.get("MQTT_PORT", 1883))
IST         = timezone(timedelta(hours=5, minutes=30))


class _MQTTPublisher:
    """
    Thread-safe MQTT publisher with auto-reconnect.
    Uses a single persistent connection shared across all brand pollers.
    """

    def __init__(self):
        self._client = None
        self._connected = False
        self._lock = threading.Lock()
        self._connect()

    def _connect(self):
        if not PAHO_AVAILABLE:
            logger.warning("[MQTT_PUB] paho-mqtt not installed — alert publishing disabled.")
            return

        try:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="vms-publisher")
            client.on_connect    = self._on_connect
            client.on_disconnect = self._on_disconnect

            client.connect_async(MQTT_BROKER, MQTT_PORT, keepalive=60)
            client.loop_start()   # background thread — non-blocking
            self._client = client
            logger.info(f"[MQTT_PUB] Connecting to {MQTT_BROKER}:{MQTT_PORT} ...")
        except Exception as e:
            logger.error(f"[MQTT_PUB] Connection failed: {e}")

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        self._connected = (reason_code == 0)
        if self._connected:
            logger.info(f"[MQTT_PUB] ✅ Connected to {MQTT_BROKER}:{MQTT_PORT}")
        else:
            logger.warning(f"[MQTT_PUB] ⚠️ Connect returned rc={reason_code}")

    def _on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties):
        self._connected = False
        logger.warning(f"[MQTT_PUB] Disconnected (rc={reason_code}). Paho will auto-reconnect.")

    def publish_alert(self, brand: str, ip: str, alert: dict) -> bool:
        """
        Publish a normalized alert to Mosquitto.

        Args:
            brand  : "bosch" | "dahua" | "hikvision" (lowercase)
            ip     : Camera IP address e.g. "192.168.1.100"
            alert  : Dict with at least: type, scenario, received_at

        Returns:
            True if published successfully, False otherwise.
        """
        if not PAHO_AVAILABLE or self._client is None:
            return False

        ip_slug = ip.replace(".", "_")
        topic   = f"vms/{brand}/{ip_slug}/event"

        # Build standardized payload compatible with mqtt_to_db_worker parser
        payload = {
            "brand":       brand,
            "ip":          ip,
            "serial":      alert.get("serial", ip_slug),
            "type":        alert.get("type", "Unknown"),
            "scenario":    alert.get("scenario", ""),
            "status":      alert.get("status", "Active"),
            "source":      brand,
            "topic":       alert.get("topic", topic),
            "received_at": alert.get("received_at", datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S+05:30")),
            "time":        alert.get("time", ""),
            "human":       alert.get("human"),
            "total":       alert.get("total"),
            "raw":         alert.get("raw", {}),
            "imageUrl":    alert.get("imageUrl"),
        }

        try:
            result = self._client.publish(
                topic,
                json.dumps(payload, default=str),
                qos=1,
                retain=False,
            )
            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                logger.debug(f"[MQTT_PUB] Published → {topic} | type={payload['type']}")
                return True
            else:
                logger.warning(f"[MQTT_PUB] Publish failed rc={result.rc} for {topic}")
                return False
        except Exception as e:
            logger.error(f"[MQTT_PUB] Exception publishing to {topic}: {e}")
            return False


# ── Singleton ─────────────────────────────────────────────────────────────────
_publisher_instance: _MQTTPublisher | None = None
_init_lock = threading.Lock()


def get_publisher() -> _MQTTPublisher:
    """Return the shared MQTT publisher singleton (lazy-initialized)."""
    global _publisher_instance
    if _publisher_instance is None:
        with _init_lock:
            if _publisher_instance is None:
                _publisher_instance = _MQTTPublisher()
    return _publisher_instance


def publish_alert(brand: str, ip: str, alert: dict) -> bool:
    """Module-level convenience wrapper around the singleton."""
    return get_publisher().publish_alert(brand, ip, alert)
