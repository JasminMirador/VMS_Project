import { useEffect, useRef, useState, memo } from "react";
import Hls from "hls.js";
import { Volume2, VolumeX } from "lucide-react";
import { useImageConfig } from "../../hooks/useImageConfig";
import LiveSpinner from "./LiveSpinner";

function HlsPlayer({ streamKey, streamUrl, muted = true, autoplay = true, className = "", onConnectChange, objectFit = "contain" }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);

  const [status, setStatus] = useState("connecting");
  const [errorMsg, setErrorMsg] = useState("");
  const [hovered, setHovered] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  // Still apply standard image CSS filters if available, but NOT digital zoom (disables WebRTC specific zoom)
  const { cssFilter, cssTransform } = useImageConfig(streamKey);

  // Use env var if provided, otherwise fallback to standard MediaMTX HLS on the same hostname
  const HLS_BASE_URL = import.meta.env.VITE_HLS_BASE_URL || `${window.location.protocol}//${window.location.hostname}/hls`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const url = streamUrl || `${HLS_BASE_URL}/${streamKey}/index.m3u8`;

    setStatus("connecting");
    setIsVideoPlaying(false);
    onConnectChange?.(false);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        // Tune for lower latency
        lowLatencyMode: true,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
      });
      hlsRef.current = hls;

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setStatus("connected");
        onConnectChange?.(true);
        if (autoplay) {
          video.play().catch(() => {});
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Stream not yet available — wait and retry
              setStatus("reconnecting");
              setIsVideoPlaying(false);
              setTimeout(() => {
                if (hlsRef.current) hlsRef.current.startLoad();
              }, 5000);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              setStatus("failed");
              setIsVideoPlaying(false);
              setErrorMsg("Stream failed");
              onConnectChange?.(false);
              break;
          }
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native Safari support
      video.src = url;
      video.addEventListener("loadedmetadata", () => {
        setStatus("connected");
        onConnectChange?.(true);
        if (autoplay) video.play().catch(() => {});
      });
      video.addEventListener("error", () => {
        setStatus("failed");
        setIsVideoPlaying(false);
        setErrorMsg("Stream failed");
        onConnectChange?.(false);
      });
    } else {
      setStatus("failed");
      setIsVideoPlaying(false);
      setErrorMsg("HLS not supported");
      onConnectChange?.(false);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      onConnectChange?.(false);
    };
  }, [streamKey, streamUrl, autoplay, HLS_BASE_URL, onConnectChange]);

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

  return (
    <div
      ref={containerRef}
      className={className}
      style={wrapStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <video
        ref={videoRef}
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
          transform: cssTransform || "none",
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
      {status === "failed" && (
        <div style={centreStyle}>
          <span style={{ color: "#ef4444", fontSize: 20 }}>⚠</span>
          <span style={{ color: "#94a3b8", fontSize: 11 }}>{errorMsg || "Connection failed"}</span>
        </div>
      )}
    </div>
  );
}

export default memo(HlsPlayer);