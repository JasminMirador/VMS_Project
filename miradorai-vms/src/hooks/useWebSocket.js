import { useState, useEffect, useRef, useCallback } from 'react';
import { wsEventsUrl } from '../config/appConfig';

/**
 * Custom React hook for connecting to the VMS WebSocket events stream.
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat (ping/pong) monitoring
 * - Topic-based event filtering
 * - Standalone fallback state when WS is unavailable
 */
export function useWebSocket(initialTopics = ['alerts', 'camera_status', 'system_metrics']) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const [eventsByTopic, setEventsByTopic] = useState({
    alerts: null,
    camera_status: null,
    system_metrics: null
  });
  const [systemMetrics, setSystemMetrics] = useState(null);

  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const topicsRef = useRef(initialTopics);

  // Compute WebSocket URL derived from runtime config
  const getWebSocketUrl = useCallback(() => {
    return wsEventsUrl(topicsRef.current.join(','));
  }, []);

  const connect = useCallback(() => {
    if (socketRef.current && (socketRef.current.readyState === WebSocket.CONNECTING || socketRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      const url = getWebSocketUrl();
      console.log(`[WS] Connecting to ${url}...`);
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected successfully');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;

        // Send subscribe action for topics
        if (topicsRef.current.length > 0) {
          ws.send(JSON.stringify({
            action: 'subscribe',
            topics: topicsRef.current
          }));
        }

        // Start periodic ping heartbeat every 25 seconds
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'ping', timestamp: new Date().toISOString() }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data);
          if (envelope.event === 'pong') {
            return;
          }

          setLastEvent(envelope);

          if (envelope.topic) {
            setEventsByTopic((prev) => ({
              ...prev,
              [envelope.topic]: envelope
            }));
          }

          if (envelope.topic === 'system_metrics' && envelope.event === 'metrics_tick') {
            setSystemMetrics(envelope.data);
          }
        } catch (err) {
          console.warn('[WS] Failed to parse message:', err);
        }
      };

      ws.onerror = (err) => {
        console.warn('[WS] Error encountered:', err);
      };

      ws.onclose = (event) => {
        console.log(`[WS] Connection closed (code: ${event.code}). Cleaning up...`);
        setIsConnected(false);

        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }

        // Exponential backoff reconnect: 1s, 2s, 4s, 8s, max 30s
        const attempts = reconnectAttemptsRef.current;
        const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
        reconnectAttemptsRef.current += 1;

        console.log(`[WS] Will attempt reconnection in ${delay}ms (Attempt #${reconnectAttemptsRef.current})`);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

    } catch (e) {
      console.error('[WS] Connection exception:', e);
      setIsConnected(false);
    }
  }, [getWebSocketUrl]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (socketRef.current) {
        socketRef.current.onclose = null; // Prevent reconnect on unmount
        socketRef.current.close();
      }
    };
  }, [connect]);

  const subscribe = useCallback((newTopics) => {
    const topicsArr = Array.isArray(newTopics) ? newTopics : [newTopics];
    topicsRef.current = Array.from(new Set([...topicsRef.current, ...topicsArr]));

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        action: 'subscribe',
        topics: topicsArr
      }));
    }
  }, []);

  const unsubscribe = useCallback((removeTopics) => {
    const topicsArr = Array.isArray(removeTopics) ? removeTopics : [removeTopics];
    topicsRef.current = topicsRef.current.filter((t) => !topicsArr.includes(t));

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        action: 'unsubscribe',
        topics: topicsArr
      }));
    }
  }, []);

  return {
    isConnected,
    lastEvent,
    eventsByTopic,
    systemMetrics,
    subscribe,
    unsubscribe
  };
}
