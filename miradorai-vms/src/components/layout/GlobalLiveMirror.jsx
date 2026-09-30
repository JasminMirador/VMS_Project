import React, { useEffect, useRef } from 'react';
import * as rrweb from 'rrweb';

export default function GlobalLiveMirror() {
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const isRecordingRef = useRef(false);
  const stopRrwebRef = useRef(null);

  useEffect(() => {
    let ws = null;
    let keepAliveInterval = null;
    let globalHeartbeatInterval = null;
    let initTimeout = null;
    let mounted = true;
    const apiBase = import.meta.env.VITE_API_URL || '';

    const getRtcConfig = async () => {
      try {
        const res = await fetch(`${apiBase}/api/viewing-stations/ice-servers`);
        if (res.ok) {
          const data = await res.json();
          if (data.iceServers && data.iceServers.length > 0) {
            console.log("[GlobalLiveMirror] Loaded Twilio ICE servers:", data.iceServers.length);
            return { iceServers: data.iceServers };
          }
        }
      } catch (e) {
        console.warn("[GlobalLiveMirror] Error fetching dynamic ICE servers:", e);
      }
      return {
        iceServers: [
          { urls: "stun:global.stun.twilio.com:3478" },
          { urls: "stun:stun.l.google.com:19302" },
          {
            urls: "turn:global.turn.twilio.com:3478?transport=udp",
            username: "d3caa20dc03b96f465cf78ae677e43a12842daa2b27febcef8d41ac2ee74db84",
            credential: "iPnaKnb4WYyxGP6nlQap2K5Adx4resPtdbt6hxK/YSw="
          },
          {
            urls: "turn:global.turn.twilio.com:3478?transport=tcp",
            username: "d3caa20dc03b96f465cf78ae677e43a12842daa2b27febcef8d41ac2ee74db84",
            credential: "iPnaKnb4WYyxGP6nlQap2K5Adx4resPtdbt6hxK/YSw="
          },
          {
            urls: "turn:global.turn.twilio.com:443?transport=tcp",
            username: "d3caa20dc03b96f465cf78ae677e43a12842daa2b27febcef8d41ac2ee74db84",
            credential: "iPnaKnb4WYyxGP6nlQap2K5Adx4resPtdbt6hxK/YSw="
          }
        ]
      };
    };

    const cleanupWebRTC = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };

    const stopRrweb = () => {
      if (isRecordingRef.current && stopRrwebRef.current) {
        stopRrwebRef.current();
        stopRrwebRef.current = null;
        isRecordingRef.current = false;
        console.log("[GlobalLiveMirror] Stopped rrweb recording");
      }
    };

    const checkAndConnect = () => {
      if (!mounted) return;
      
      let sid = sessionStorage.getItem("miradorai_workstation_id");
      if (!sid) {
        sid = "ws-" + Math.random().toString(36).substring(2, 8);
        sessionStorage.setItem("miradorai_workstation_id", sid);
      }
      let sname = sessionStorage.getItem("miradorai_workstation_name");
      if (!sname) {
        sname = "Terminal " + sid.split("-")[1].toUpperCase();
        sessionStorage.setItem("miradorai_workstation_name", sname);
      }

      const stationDetails = { sid, sname };
      
      const apiBase = import.meta.env.VITE_API_URL || '';
      
      const sendGlobalHeartbeat = async () => {
        const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
        if (!token || window.location.pathname.includes('/live-view')) return;
        try {
          await fetch(`${apiBase}/api/viewing-stations/heartbeat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
              station_id: sid,
              name: sname,
              grid: "Background",
              device_order: [],
              applied_timestamp: 0,
              active_feeds_count: 0
            })
          });
        } catch (e) {}
      };
      
      globalHeartbeatInterval = setInterval(sendGlobalHeartbeat, 5000);
      sendGlobalHeartbeat();

      const connect = () => {
        if (!mounted) return;
        const apiBase = import.meta.env.VITE_API_URL || '';
        let wsUrl = '';
        if (apiBase) {
          wsUrl = apiBase.replace(/^http/, 'ws') + '/ws/events?topics=station_' + stationDetails.sid;
        } else {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = protocol + '//' + window.location.host + '/ws/events?topics=station_' + stationDetails.sid;
        }

        console.log("[GlobalLiveMirror] Connecting to WebSocket:", wsUrl);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log("[GlobalLiveMirror] Connected to:", stationDetails.sid);
          keepAliveInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ action: "ping" }));
            }
          }, 15000);
        };

        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);

            // ── rrweb mode: app-level, no user permission required ──────────
            if (msg.event === "start_record") {
              if (isRecordingRef.current) return;
              isRecordingRef.current = true;
              console.log("[GlobalLiveMirror] Starting rrweb recording");
              try {
                stopRrwebRef.current = rrweb.record({
                  blockSelector: null,
                  inlineStylesheet: false,
                  sampling: { mousemove: 150, scroll: 200 },
                  emit(rr_event) {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                      ws.send(JSON.stringify({
                        action: "publish",
                        topic: `station_${stationDetails.sid}_stream`,
                        pub_event: "rrweb_event",
                        data: rr_event
                      }));
                    }
                  }
                });
              } catch (err) {
                console.error("[GlobalLiveMirror] rrweb.record error:", err);
                isRecordingRef.current = false;
              }

            // ── WebRTC mode: system-level, requires browser permission ──────
            } else if (msg.event === "start_webrtc") {
              console.log("[GlobalLiveMirror] Starting WebRTC system screen capture");
              cleanupWebRTC();
              try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                  console.error("[GlobalLiveMirror] getDisplayMedia not supported. Use HTTPS or localhost.");
                  return;
                }
                const stream = await navigator.mediaDevices.getDisplayMedia({
                  video: { displaySurface: "monitor" },
                  audio: false
                });
                streamRef.current = stream;

                const rtcConfig = await getRtcConfig();
                const pc = new RTCPeerConnection(rtcConfig);
                pcRef.current = pc;
                pcRef.current.remoteDescriptionSet = false;
                pcRef.current.iceQueue = [];

                stream.getTracks().forEach(track => pc.addTrack(track, stream));

                pc.onconnectionstatechange = () =>
                  console.log("[GlobalLiveMirror] RTC state:", pc.connectionState);

                pc.onicecandidate = (e) => {
                  if (e.candidate && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                      action: "publish",
                      topic: `station_${stationDetails.sid}_stream`,
                      pub_event: "webrtc_ice_candidate",
                      data: e.candidate
                    }));
                  }
                };

                stream.getVideoTracks()[0].onended = () => cleanupWebRTC();

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    action: "publish",
                    topic: `station_${stationDetails.sid}_stream`,
                    pub_event: "webrtc_offer",
                    data: offer
                  }));
                }
              } catch (err) {
                console.error("[GlobalLiveMirror] Display media error:", err);
              }

            // ── WebRTC signalling ───────────────────────────────────────────
            } else if (msg.event === "webrtc_answer") {
              if (pcRef.current) {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.data));
                pcRef.current.remoteDescriptionSet = true;
                for (let c of pcRef.current.iceQueue) {
                  await pcRef.current.addIceCandidate(c);
                }
              }
            } else if (msg.event === "webrtc_ice_candidate") {
              if (pcRef.current) {
                const candidate = new RTCIceCandidate(msg.data);
                if (pcRef.current.remoteDescriptionSet) {
                  await pcRef.current.addIceCandidate(candidate);
                } else {
                  pcRef.current.iceQueue.push(candidate);
                }
              }

            // ── Stop all modes ──────────────────────────────────────────────
            } else if (msg.event === "stop_record") {
              stopRrweb();
              cleanupWebRTC();
            }

          } catch (e) {
            console.error("[GlobalLiveMirror] WebSocket message parse error:", e);
          }
        };

        ws.onclose = () => {
          console.log("[GlobalLiveMirror] WebSocket closed, retrying in 5s...");
          stopRrweb();
          cleanupWebRTC();
          if (keepAliveInterval) clearInterval(keepAliveInterval);
          if (mounted) setTimeout(connect, 5000);
        };
      };

      connect();
    };

    checkAndConnect();

    return () => {
      mounted = false;
      if (initTimeout) clearTimeout(initTimeout);
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      if (globalHeartbeatInterval) clearInterval(globalHeartbeatInterval);
      if (ws) ws.close();
      stopRrweb();
      cleanupWebRTC();
    };
  }, []);

  return null;
}
