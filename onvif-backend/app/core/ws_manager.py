import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Dict, Set, List, Optional, Any
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("ws_manager")

class ConnectionManager:
    """
    Centralized WebSocket ConnectionManager for real-time VMS events.
    Supports topic-based subscription, standardized event envelopes, heartbeats,
    and automatic cleanup of disconnected clients.
    """
    DEFAULT_TOPICS = {"alerts", "camera_status", "system_metrics", "maps", "designer"}

    def __init__(self):
        # Maps active WebSocket connection to set of subscribed topic strings
        self._connections: Dict[WebSocket, Set[str]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, initial_topics: Optional[List[str]] = None) -> None:
        """Accepts a new WebSocket connection and initializes its topic subscriptions."""
        await websocket.accept()
        topics = set(initial_topics) if initial_topics else set(self.DEFAULT_TOPICS)
        async with self._lock:
            self._connections[websocket] = topics
        logger.info(f"[WS] Client connected. Subscribed topics: {topics}. Total active clients: {len(self._connections)}")

    async def disconnect(self, websocket: WebSocket) -> None:
        """Removes a disconnected client safely."""
        async with self._lock:
            if websocket in self._connections:
                del self._connections[websocket]
                logger.info(f"[WS] Client disconnected. Remaining active clients: {len(self._connections)}")

    async def subscribe(self, websocket: WebSocket, topics: List[str]) -> None:
        """Adds topics to an active client's subscription list."""
        async with self._lock:
            if websocket in self._connections:
                self._connections[websocket].update(topics)
                logger.info(f"[WS] Client updated subscriptions: {self._connections[websocket]}")

    async def unsubscribe(self, websocket: WebSocket, topics: List[str]) -> None:
        """Removes topics from an active client's subscription list."""
        async with self._lock:
            if websocket in self._connections:
                self._connections[websocket].difference_update(topics)
                logger.info(f"[WS] Client updated subscriptions: {self._connections[websocket]}")

    async def broadcast(
        self,
        topic: str,
        event: str,
        data: Any,
        event_id: Optional[str] = None
    ) -> None:
        """
        Broadcasts an event message to all clients subscribed to `topic`.
        Enforces standard event envelope:
        {
          "topic": str,
          "event": str,
          "timestamp": ISO-string,
          "event_id": str,
          "data": dict | any
        }
        """
        envelope = {
            "topic": topic,
            "event": event,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "event_id": event_id or f"evt_{uuid.uuid4().hex[:12]}",
            "data": data
        }

        disconnected_sockets = []

        async with self._lock:
            targets = [
                ws for ws, topics in self._connections.items()
                if topic in topics or "*" in topics
            ]

        for ws in targets:
            try:
                await ws.send_json(envelope)
            except Exception as e:
                logger.warning(f"[WS] Error sending message to client: {e}")
                disconnected_sockets.append(ws)

        if disconnected_sockets:
            for ws in disconnected_sockets:
                await self.disconnect(ws)

    def publish_sync(
        self,
        topic: str,
        event: str,
        data: Any,
        event_id: Optional[str] = None
    ) -> None:
        """
        Thread-safe synchronous wrapper for publishing events from synchronous
        background workers or thread pools.
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    self.broadcast(topic, event, data, event_id), loop
                )
            else:
                loop.run_until_complete(self.broadcast(topic, event, data, event_id))
        except RuntimeError:
            new_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(new_loop)
            new_loop.run_until_complete(self.broadcast(topic, event, data, event_id))
            new_loop.close()

# Global singleton instance
ws_manager = ConnectionManager()
