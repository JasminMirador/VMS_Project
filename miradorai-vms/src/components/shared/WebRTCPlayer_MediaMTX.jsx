import { useEffect, useRef, useState, memo } from "react";
import { useImageConfig } from "../../hooks/useImageConfig";
import { Volume2, VolumeX } from "lucide-react";
import { useDigitalZoom } from "../../hooks/useDigitalZoom";
import LiveSpinner from "./LiveSpinner";
import { whepUrl, whepSessionUrl, getEnv } from "../../config/appConfig";

// ─── SDP Bandwidth Injection ──────────────────────────────────────────────────
// Inserts a b=TIAS (Transport Independent Application Specific) line into
// each video media section of the SDP offer. This is a real network-layer
// constraint — the browser's WebRTC engine uses REMB/TWCC feedback to signal
// to MediaMTX that it should not exceed this rate. The camera hardware and
// MediaMTX source stream are completely untouched.
function injectBandwidthIntoSdp(sdp, maxKbps) {
  if (!maxKbps || maxKbps <= 0) return sdp;

  const tiasLine = `b=TIAS:${maxKbps * 1000}`; // TIAS is in bits per second
  const asBandwidth = `b=AS:${maxKbps}`;        // AS is in kbps (legacy compat)

  return sdp
    .split("\r\n")
    .map((line, idx, lines) => {
      // After the "m=video" line, insert bandwidth constraints
      if (line.startsWith("m=video")) {
        return [line, tiasLine, asBandwidth].join("\r\n");
      }
      return line;
    })
    .join("\r\n");
}

// ─── Apply Bitrate Limit via RTCRtpSender.setParameters ──────────────────────
// After the connection is established, this sets a hard bitrate cap on the
// RTP receiver's codec parameters. This is the most reliable method on modern
// browsers (Chrome, Edge, Firefox) and works alongside the SDP constraint.
async function applyBitrateLimit(pc, maxKbps) {
  if (!pc || !maxKbps) return;
  try {
    const receivers = pc.getReceivers();
    for (const receiver of receivers) {
      if (receiver.track?.kind === "video") {
        const params = receiver.getParameters?.();
        // Note: setParameters on receiver is not universally supported yet.
        // The SDP injection (above) is the primary enforcement mechanism.
        // This is a belt-and-suspenders approach.
        if (params && params.encodings && params.encodings.length > 0) {
          params.encodings[0].maxBitrate = maxKbps * 1000;
          try {
            await receiver.setParameters?.(params);
          } catch {
            // Not all browsers support setParameters on receivers — that's OK,
            // SDP b=TIAS is the real constraint.
          }
        }
      }
    }
  } catch (e) {
    // Non-fatal — SDP injection already handles the primary throttle.
  }
}

// ─── WHEP URL Helper ──────────────────────────────────────────────────────────
// Always route through nginx /whep/ proxy, for both localhost and
// public IP. MediaMTX CORS is disabled (allowOrigins: []) so nginx is the sole
// CORS controller — going direct to MediaMTX would get zero CORS headers.
// nginx listens on the default web port on the same machine, so http://localhost/whep/ works
// even during local dev on frontend port.
function getWhepBaseUrl(streamKey) {
  return whepUrl(streamKey);


}

// ─────────────────────────────────────────────────────────────────────────────
// maxBitrate: number (Kbps)
//   - Grid view:       pass 2000  (2 Mbps)
//   - Fullscreen view: pass 10000 (10 Mbps)
//   - Not passed:      no throttle applied (full native camera bitrate)
// ─────────────────────────────────────────────────────────────────────────────
function WebRTCPlayer_MediaMTX({ streamKey, cameraId, onConnectChange, onError, maxBitrate, badgeMode = "normal", muted = true, hideBandwidth = false, objectFit = "contain" }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);

  const [status, setStatus] = useState("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [hovered, setHovered] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [receivedMbps, setReceivedMbps] = useState(null);
  const [videoResolution, setVideoResolution] = useState(null);
  const lastBytesRef = useRef({ bytes: 0, ts: 0 });

  const [currentStreamKey, setCurrentStreamKey] = useState(streamKey);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  useEffect(() => {
    setCurrentStreamKey(streamKey);
  }, [streamKey]);

  // When maxBitrate changes on an already-connected stream (e.g. user enters/exits fullscreen),
  // apply the new limit immediately without reconnecting.
  useEffect(() => {
    if (pcRef.current && status === "connected") {
      applyBitrateLimit(pcRef.current, maxBitrate);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxBitrate]);

  const { cssFilter, cssTransform } = useImageConfig(cameraId || streamKey);
  const { zoom, zoomTransform, handlers } = useDigitalZoom(containerRef, videoRef);

  const pcRef = useRef(null);
  const whepLocationRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const isComponentMounted = useRef(true);
  // Keep latest maxBitrate accessible inside async startConnection
  const maxBitrateRef = useRef(maxBitrate);
  useEffect(() => { maxBitrateRef.current = maxBitrate; }, [maxBitrate]);

  const cleanupConnection = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (whepLocationRef.current) {
      try {
        const whepUrl = new URL(whepLocationRef.current, getWhepBaseUrl(currentStreamKey));
        fetch(whepUrl.toString(), { method: "DELETE", keepalive: true }).catch(() => {});
      } catch {
        // ignore
      }
      whepLocationRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.ontrack = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const startConnection = async () => {
    if (!isComponentMounted.current) return;

    cleanupConnection();

    setStatus((prev) => (prev === "failed" || prev === "reconnecting" ? "reconnecting" : "connecting"));
    setErrorMsg("");

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: getEnv("STUN_SERVER") }],
      });
      pcRef.current = pc;

      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      pc.ontrack = (event) => {
        if (videoRef.current && videoRef.current.srcObject !== event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          videoRef.current.play().catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        if (!isComponentMounted.current) return;

        if (pc.connectionState === "connected") {
          setStatus("connected");
          onConnectChange?.(true);
          // Apply bitrate cap once connection is live
          applyBitrateLimit(pc, maxBitrateRef.current);
        } else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          setStatus("reconnecting");
          setIsVideoPlaying(false);
          onConnectChange?.(false);

          if (!reconnectTimeoutRef.current) {
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectTimeoutRef.current = null;
              startConnection();
            }, 5000);
          }
        }
      };

      // ── Create offer and inject real SDP bandwidth constraint ────────────
      const offer = await pc.createOffer();

      // Inject b=TIAS and b=AS bandwidth lines into video section of SDP.
      // This is the real network-level throttle: the browser sends REMB/TWCC
      // feedback to MediaMTX telling it to cap delivery at maxBitrate Kbps.
      const constrainedSdp = injectBandwidthIntoSdp(offer.sdp, maxBitrateRef.current);

      await pc.setLocalDescription({
        type: offer.type,
        sdp: constrainedSdp,
      });

      // Port present (dev/LAN) → direct MediaMTX; no port (prod) → nginx /whep/ proxy
      const response = await fetch(getWhepBaseUrl(currentStreamKey), {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
        },
        body: constrainedSdp,
      });

      if (!response.ok) {

        const isStreamError = response.status === 400 || response.status === 404;
        const err = new Error(`WHEP error: ${response.status}`);
        err.isStreamError = isStreamError;
        throw err;
      }

      const locationHeader = response.headers.get("Location");
      if (locationHeader) {
        whepLocationRef.current = locationHeader;
      }

      const answer = await response.text();
      await pc.setRemoteDescription({
        type: "answer",
        sdp: answer,
      });
    } catch (err) {
      if (!isComponentMounted.current) return;

      const isStreamError = err.isStreamError;

      if (isStreamError) {
        setStatus("offline");
        setErrorMsg("Stream unavailable");
        onConnectChange?.(false);
        if (onError) onError(err);
      } else {
        setStatus("failed");
        setErrorMsg("Connection failed");
        onConnectChange?.(false);
        if (onError) onError(err);
      }

      if (!reconnectTimeoutRef.current) {
        const delay = isStreamError ? 10000 : 5000;
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (isComponentMounted.current) startConnection();
        }, delay);
      }
    }
  };

  useEffect(() => {
    isComponentMounted.current = true;
    startConnection();

    return () => {
      isComponentMounted.current = false;
      cleanupConnection();
      onConnectChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStreamKey]);

  // ── Real-time bandwidth + resolution measurement via RTCPeerConnection.getStats ──
  useEffect(() => {
    if (status !== "connected") {
      setReceivedMbps(null);
      setVideoResolution(null);
      lastBytesRef.current = { bytes: 0, ts: 0 };
      return;
    }
    const interval = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        stats.forEach(report => {
          if (report.type === "inbound-rtp" && report.kind === "video") {
            const now = Date.now();
            const bytes = report.bytesReceived || 0;
            const prev = lastBytesRef.current;
            if (prev.ts > 0) {
              const dtMs = now - prev.ts;
              const dbytes = bytes - prev.bytes;
              if (dtMs > 0 && dbytes >= 0) {
                const mbps = (dbytes * 8) / (dtMs * 1000); // Mbps
                setReceivedMbps(mbps);
              }
            }
            lastBytesRef.current = { bytes, ts: now };
          }
        });
      } catch { /* pc may have closed */ }

      // Read actual decoded resolution from the <video> element
      if (videoRef.current) {
        const vw = videoRef.current.videoWidth;
        const vh = videoRef.current.videoHeight;
        if (vw > 0 && vh > 0) {
          setVideoResolution(`${vw}×${vh}`);
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const wrapStyle = {
    position: "relative",
    width: "100%",
    height: "100%",
    background: "var(--bg-elevated)",
    borderRadius: 6,
    overflow: "hidden",
  };

  const centreStyle = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: 8,
    pointerEvents: "none",
  };

  const volumeBtnStyle = {
    position: "absolute",
    bottom: "8px",
    right: "8px",
    background: btnHovered ? "rgba(20, 184, 166, 0.95)" : "rgba(15, 23, 42, 0.75)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: "50%",
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#ffffff",
    cursor: "pointer",
    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
    zIndex: 20,
    outline: "none",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
    opacity: hovered ? 1 : 0,
    transform: hovered ? "scale(1)" : "scale(0.85)",
    pointerEvents: hovered ? "auto" : "none",
  };

  // Colour-codes the badge: green < 3 Mbps, amber 3–8, red > 8
  const bwColor = receivedMbps === null
    ? "#64748b"
    : receivedMbps < 3 ? "#22c55e"
    : receivedMbps < 8 ? "#f59e0b"
    : "#ef4444";

  const isMicro = badgeMode === "micro";
  const isCompact = badgeMode === "compact" || isMicro;

  const bwBadgeStyle = {
    position: "absolute",
    bottom: isMicro ? "4px" : isCompact ? "6px" : "12px",
    left: isMicro ? "4px" : isCompact ? "6px" : "12px",
    background: "rgba(8, 12, 24, 0.85)",
    backdropFilter: "blur(8px)",
    border: `1.5px solid ${bwColor}66`,
    borderRadius: isMicro ? "3px" : isCompact ? "4px" : "8px",
    padding: isMicro ? "2px 4px" : isCompact ? "3px 6px" : "5px 12px 5px 10px",
    fontSize: isMicro ? "8.5px" : isCompact ? "10px" : "13px",
    fontWeight: "700",
    fontFamily: "'SF Mono', 'Fira Mono', 'Consolas', monospace",
    color: bwColor,
    letterSpacing: isCompact ? "0.03em" : "0.06em",
    zIndex: 20,
    pointerEvents: "none",
    lineHeight: "1.4",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    boxShadow: `0 4px 16px rgba(0,0,0,0.6), 0 0 0 1px ${bwColor}22`,
    textShadow: `0 0 10px ${bwColor}88`,
    transition: "color 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease",
  };

  return (
    <div
      ref={containerRef}
      style={{ ...wrapStyle, cursor: zoom > 1 ? "grab" : "default" }}
      {...handlers}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        disablePictureInPicture
        disableRemotePlayback
        style={{
          width: "100%",
          height: "100%",
          objectFit: objectFit,
          display: "block",
          filter: cssFilter || "none",
          transform: `${cssTransform !== "none" && cssTransform ? cssTransform : ""} ${
            zoomTransform !== "none" && zoomTransform ? zoomTransform : ""
          }`.trim() || "none",
          transition: "filter 0.1s ease",
        }}
        onPlaying={() => setIsVideoPlaying(true)}
        onWaiting={() => setIsVideoPlaying(false)}
      />
      {(status === "connecting" || status === "reconnecting" || (status === "connected" && !isVideoPlaying)) && (
        <div style={centreStyle}>
          <LiveSpinner />
        </div>
      )}
      {status === "offline" && (
        <div style={centreStyle}>
          <span style={{ color: "#64748b", fontSize: 11 }}>
            {errorMsg || "Stream unavailable"}
          </span>
          <span style={{ color: "#475569", fontSize: 10 }}>
            Retrying…
          </span>
        </div>
      )}
      {status === "failed" && (
        <div style={centreStyle}>
          <span style={{ color: "#ef4444", fontSize: 20 }}>⚠</span>
          <span style={{ color: "#94a3b8", fontSize: 11 }}>
            {errorMsg || "Connection failed"}
          </span>
        </div>
      )}
      {status === "connected" && !hideBandwidth && (
        <>
          {/* ── Bandwidth + resolution badge ───────────────────────────────── */}
          <div style={bwBadgeStyle}>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0 }}>
              <circle cx="5" cy="5" r="5" fill={bwColor} opacity="0.95" />
            </svg>
            {receivedMbps !== null
              ? receivedMbps >= 1
                ? `${receivedMbps.toFixed(1)} Mbps`
                : `${(receivedMbps * 1000).toFixed(0)} Kbps`
              : "— Mbps"}
          </div>
        </>
      )}
    </div>
  );
}

export default memo(WebRTCPlayer_MediaMTX);