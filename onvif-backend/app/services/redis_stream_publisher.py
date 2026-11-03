"""
redis_stream_publisher.py
─────────────────────────
VMS Redis Streams Producer.

Design principles:
  • Fire-and-forget  — never blocks the API response.
  • Graceful failure — if Redis is down the API keeps working; a warning is logged.
  • Versioned schema — every message carries version="1.0" so consumers can evolve.
  • Unique event_id  — UUID4 per message; useful for deduplication and log tracing.
  • correlation_id   — optional; pass the same ID back in the MQTT reply so VMS can
                       match AI results to the original request.
  • Stream retention — maxlen=10_000 (approximate) prevents unbounded Redis growth.

Usage (from any async router or service):
    import asyncio
    from app.services.redis_stream_publisher import publish_event

    asyncio.create_task(publish_event(
        stream       = os.environ.get("REDIS_STREAM_CAMERA_EVENTS", "vms:events:camera"),
        event_type   = "camera.updated",
        payload      = {"ip": ip, "updated_fields": ["name"]},
        # correlation_id = some_id_if_needed,
    ))
"""

import os
import json
import asyncio
import uuid
from datetime import datetime, timezone

# ── Schema version ──────────────────────────────────────────────────────────
SCHEMA_VERSION = "1.0"

# ── Stream retention — keep the latest N entries (approximate trim) ─────────
STREAM_MAXLEN = int(os.environ.get("REDIS_STREAM_MAXLEN", 10_000))

# ── Lazy singleton connection ────────────────────────────────────────────────
_redis_client = None
_redis_lock   = asyncio.Lock()


async def _get_client():
    """Return the shared async Redis client, creating it on first call."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client

    async with _redis_lock:
        if _redis_client is not None:          # double-checked locking
            return _redis_client
        try:
            import redis.asyncio as aioredis    # imported lazily so import errors are caught

            host     = os.environ.get("REDIS_HOST")
            port     = int(os.environ.get("REDIS_PORT"))
            password = os.environ.get("REDIS_PASSWORD") or None

            client = aioredis.Redis(
                host=host,
                port=port,
                password=password,
                decode_responses=True,
                socket_connect_timeout=3,       # fail fast on startup if Redis is absent
            )
            await client.ping()
            _redis_client = client
            print(f"[REDIS] ✅ Connected to Redis at {host}:{port}")
        except Exception as exc:
            print(
                f"[REDIS] ⚠ Could not connect to Redis at "
                f"{os.environ.get('REDIS_HOST')}:"
                f"{os.environ.get('REDIS_PORT')} — {exc}\n"
                f"        Stream publishing is disabled until Redis becomes available."
            )

    return _redis_client


async def publish_event(
    stream: str,
    event_type: str,
    payload: dict,
    correlation_id: str | None = None,
) -> None:
    """
    Publish one versioned event to a Redis Stream.

    Always call this with asyncio.create_task() so it does not block the
    API response:
        asyncio.create_task(publish_event(...))

    Parameters
    ----------
    stream         : Redis stream key, e.g. "vms:events:camera"
    event_type     : Dotted namespaced action, e.g. "camera.updated"
    payload        : Dict with event-specific data (single entity, never full lists)
    correlation_id : Optional ID copied from a request; the AI echoes it back over
                     MQTT so VMS can match responses to original requests.
    """
    try:
        client = await _get_client()
        if client is None:
            return                              # Redis unavailable — silently skip

        event_id = str(uuid.uuid4())

        message: dict = {
            "version":    SCHEMA_VERSION,
            "event_id":   event_id,
            "event_type": event_type,
            "source":     "vms",
            "timestamp":  datetime.now(timezone.utc).isoformat(),
            "payload":    json.dumps(payload, default=str),
        }
        if correlation_id:
            message["correlation_id"] = correlation_id

        await client.xadd(
            stream,
            message,
            maxlen=STREAM_MAXLEN,
            approximate=True,               # O(1) trim — no performance impact
        )

        await client.publish("vms_config_updates", "update")
        print(
            f"[REDIS] Published  | stream={stream}"
            f"  event_type={event_type}"
            f"  event_id={event_id}"
            + (f"  correlation_id={correlation_id}" if correlation_id else "")
        )

    except Exception as exc:
        # Never raise — a Redis failure must not break the API
        print(f"[REDIS]  Publish failed | event_type={event_type}  error={exc}")


async def close() -> None:
    """Gracefully close the Redis connection on application shutdown."""
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
            print("[REDIS]  Connection closed.")
        except Exception:
            pass
        _redis_client = None
