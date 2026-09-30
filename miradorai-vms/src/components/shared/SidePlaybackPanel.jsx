import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Hls from "hls.js";
import DatePicker from "./DatePicker";
import { useDigitalZoom } from "../../hooks/useDigitalZoom";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useAuth } from "../../context/AuthContext";
import { logUIAction } from "../../hooks/useActivityLogger";
import { formatEventName } from "../../pages/liveview/LiveViewPage";
import { createPortal } from "react-dom";
import "./SidePlaybackPanel.css";

const API = import.meta.env.VITE_API_URL || "";
function getToken() {
  return (
    (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token")) ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    ""
  );
}

function getAuthHeaders() {
  const token = getToken();
  return token ? { "Authorization": "Bearer " + token } : {};
}

async function fetchLiveSnapshotForIp(ip) {
  if (!ip) return null;
  try {
    const ipDot = (ip || "").replace(/_/g, ".");
    const res = await fetch(`${API}/api/camera/brand/snapshot/${encodeURIComponent(ipDot)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.snapshot || null;
  } catch (e) {
    return null;
  }
}

// ── Read enabled alert types from Action Rules ────────────────────
function getEnabledAlertTypes() {
  try {
    const rules = JSON.parse(localStorage.getItem("miradorai_action_rules") || "[]");
    if (rules.length === 0) {
      return ["motion", "object", "device", "occupancy", "linecrossing", "objectinarea", "tampering"];
    }
    return rules
      .filter((r) => r.enabled)
      .map((r) => (r.trigger || "").toLowerCase());
  } catch {
    return ["motion", "object", "device", "occupancy", "linecrossing", "objectinarea", "tampering"];
  }
}

// ── Check if a single alert passes the enabled filter ─────────────
function isAlertAllowed(alert) {
  const enabledTypes = getEnabledAlertTypes();
  const type     = (alert.type     || "").toLowerCase();
  const scenario = (alert.scenario || "").toLowerCase();

  if (enabledTypes.length === 0) return true;

  return enabledTypes.some((t) => {
    const key = t.toLowerCase();
    if (key.includes("motion"))       return type.includes("motion")       || scenario.includes("motion");
    if (key.includes("tamper"))       return type.includes("tamper")       || scenario.includes("tamper");
    if (key.includes("object"))       return type.includes("object")       || type.includes("objectinarea") || type.includes("detection");
    if (key.includes("occupancy"))    return type.includes("occupancy")    || scenario.includes("occupancy");
    if (key.includes("linecrossing")) return type.includes("linecrossing") || type.includes("crossing");
    if (key.includes("loitering"))    return type.includes("loitering")    || scenario.includes("loitering");
    if (key.includes("intrusion"))    return type.includes("intrusion")    || scenario.includes("intrusion");
    return true;
  });
}

function extractHour(file) {
  const raw = file.start_time || file.name || "";
  const dashColon = raw.match(/^(\d{2})[-:]/);
  if (dashColon) return parseInt(dashColon[1], 10);
  const segments = raw.split("_");
  if (segments.length >= 2) {
    const h = parseInt(segments[1], 10);
    if (!isNaN(h) && h >= 0 && h <= 23) return h;
  }
  return 0;
}

function fmt(s) {
  if (!s || isNaN(s)) return "00:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function SidePlaybackPanel({ camera, onClose, alertSource = "builtin" }) {
  const videoRef = useRef(null);
  const playerWrap = useRef(null);
  const hlsRef = useRef(null);

  const { zoom, zoomTransform, handlers } = useDigitalZoom(playerWrap, videoRef);
  const { isConnected: isWsConnected, eventsByTopic } = useWebSocket(["alerts"]);
  const { user } = useAuth();

  // Tab State
  const [activeTab, setActiveTab] = useState("alerts"); // 'archive' | 'alerts'

  // Archive Mode State
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [playingFile, setPlayingFile] = useState(null);
  const [expandedHours, setExpandedHours] = useState(new Set());
  const [motionRanges, setMotionRanges] = useState([]);

  // Alerts Mode State
  const [alerts, setAlerts] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [playingAlert, setPlayingAlert] = useState(null);

  // Common Video State
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [speed, setSpeed] = useState(1);
  const [toast, setToast] = useState(null);
  const [sharpness, setSharpness] = useState(0);

  const cssFilter = useMemo(() => {
    const sharpnessContrast = 1 + (sharpness / 400);
    return `contrast(${sharpnessContrast.toFixed(3)})`;
  }, [sharpness]);

  const progressRef = useRef(null);
  const isDraggingScrubber = useRef(false);
  const timelineRef = useRef(null);
  const isTimelineDragging = useRef(false);

  const cameraIp = useMemo(() => {
    return (camera?.ip || "").replace(/_/g, ".");
  }, [camera]);

  const playbackIp = useMemo(() => {
    return (camera?.ip || "").replace(/\./g, "_");
  }, [camera]);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Fetch Alerts for this Camera ────────────────────────────────
  const fetchCameraAlerts = useCallback(async () => {
    if (!cameraIp) return;
    setLoadingAlerts(true);
    try {
      if (alertSource === "external") {
        const readerId = camera?.reader_id;
        if (!readerId) return; // no reader_id registered for this camera yet
        const res = await fetch(`/external-ai-api/getalert?readerIds=${encodeURIComponent(readerId)}&page=1&size=500`, {
          headers: {
            "Authorization": localStorage.getItem('miradorai_sso_token') || '',
            "Content-Type": "application/json"
          }
        });
        if (res.ok) {
          const extData = await res.ok ? await res.json() : { data: [] };
          const items = extData.data || [];
          const mapped = items.map(item => {
            // Format sourceType e.g. "identity_management" -> "Identity Management"
            let eventType = item.sourceType || item.subType || "AI Event";
            eventType = eventType
              .split(/[_-]/)
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(" ");

            const personName = item.empName || item.employeeName || item.personName || item.name || item.label || "Unknown";
            const isUnknown = personName.toLowerCase().includes("unknown");
            const eventText = isUnknown ? "Unknown" : `${eventType} — ${personName}`;

            return {
              ip: item.readerIp || "",
              serial: item.readerId || "",
              time: item.detectionTime || "",
              received_at: item.detectionTime || "",
              type: eventText,
              eventType: isUnknown ? "Unknown" : eventType,
              personName: isUnknown ? "" : personName,
              isExternal: true,
              rawData: item
            };
          });
          mapped.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
          setAlerts(mapped);
        }
      } else {
        const urlParam = alertSource === "mqtt_ai" ? "&source=external_ai" : "";
        const res = await fetch(`${API}/api/alerts?limit=5000${urlParam}`, {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          const filtered = (data.alerts || [])
            .filter(a => (a.ip || a.serial || "").replace(/_/g, ".") === cameraIp)
            .filter((a) => {
               const t = (a.type || "").toLowerCase();
               return !t.includes("motion") && t !== "unknown" && t !== "" && !t.includes("tns1:");
            })
            .filter(isAlertAllowed)
            .sort((a, b) => {
              const tA = new Date(a.time || a.received_at).getTime() || 0;
              const tB = new Date(b.time || b.received_at).getTime() || 0;
              return tB - tA;
            })
            .slice(0, 500);
          setAlerts(filtered);

                      // Non-blocking: fetch live snapshots for recent alerts and attach
                      (async () => {
                        try {
                          const toFetch = filtered.slice(0, 20);
                          await Promise.all(toFetch.map(async (a) => {
                            if (a.isExternal) return;
                            const ip = a.ip || a.serial || "";
                            const snap = await fetchLiveSnapshotForIp(ip);
                            if (snap) {
                              setAlerts((prev) => prev.map((p) => (p === a ? { ...p, liveSnapshot: snap } : p)));
                            }
                          }));
                        } catch (e) {
                          // ignore
                        }
                      })();
        }
      }
    } catch (e) {
      console.error("[SidePlaybackPanel] fetch alerts failed:", e);
    } finally {
      setLoadingAlerts(false);
    }
  }, [cameraIp, alertSource, camera]);

  useEffect(() => {
    if (alertSource === "mqtt_ai") return;
    const alertEnvelope = eventsByTopic.alerts;
    if (activeTab === "alerts" && alertEnvelope && alertEnvelope.data) {
      const payload = alertEnvelope.data;
      const wsType = (payload.type || "").toLowerCase();
      if (wsType.includes("motion")) return;
      if (wsType.includes("tns1:")) return;
      
      const payloadIp = (payload.ip || payload.serial || "").replace(/_/g, ".");
      if (payloadIp !== cameraIp) return;

      const newAlert = { ...payload };

      (async () => {
        try {
          if (!newAlert.isExternal) {
            const ip = newAlert.ip || newAlert.serial || "";
            const snap = await fetchLiveSnapshotForIp(ip);
            if (snap) newAlert.liveSnapshot = snap;
          }
        } catch (e) {}
        setAlerts((prev) => {
          const newId = newAlert.alert_id || newAlert._id || newAlert.id;
          const exists = newId ? prev.some((a) => (a.alert_id || a._id || a.id) === newId) : false;
          if (exists) return prev;
          return [newAlert, ...prev].slice(0, 500);
        });
      })();
    }
  }, [eventsByTopic.alerts, cameraIp, activeTab]);

  useEffect(() => {
    if (activeTab === "alerts") {
      fetchCameraAlerts();
      if (isWsConnected) return;
      const interval = setInterval(fetchCameraAlerts, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab, fetchCameraAlerts, isWsConnected, cameraIp]);

  // ── Fetch Files for this Camera & Date ─────────────────────────
  useEffect(() => {
    const streamKey = camera?.stream_key || camera?.stream_key || camera?.id;
    if (!streamKey || activeTab !== "archive") return;

    let cancelled = false;
    (async () => {
      setLoadingFiles(true);
      setFiles([]);
      try {
        const res = await fetch(
          `${API}/api/recordings/${streamKey}?date=${selectedDate}`,
          { headers: getAuthHeaders() }
        );
        if (!cancelled && res.ok) {
          const data = await res.json();
          const raw = Array.isArray(data) ? data : (data.files || []);
          setFiles(raw.map((rec) => ({
            name: rec.start_time || rec.name || "",
            camera_id: rec.camera_id,
            date: rec.date,
            start_time: rec.start_time,
            size: rec.file_size || "—",
            file_path: rec.file_path,
          })));
        }
      } catch (err) {
        if (!cancelled) setFiles([]);
      } finally {
        if (!cancelled) setLoadingFiles(false);
      }
    })();

    return () => { cancelled = true; };
  }, [camera, selectedDate, activeTab]);

  // ── Video Lifecycle & HLS.js Binding ───────────────────────────
  useEffect(() => {
    if (!videoUrl) return;

    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHls = videoUrl.includes(".m3u8");

    if (isHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });
        hlsRef.current = hls;
        hls.loadSource(videoUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {});
          }
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                hlsRef.current = null;
                setVideoError("Playback stream failed");
                break;
            }
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = videoUrl;
        video.addEventListener("loadedmetadata", () => {
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {});
          }
        }, { once: true });
      } else {
        setVideoError("HLS not supported on this browser.");
      }
    } else {
      video.src = videoUrl;
    }

    return () => {
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [videoUrl]);

  // ── Sync Video State Listeners ─────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => setCurrentTime(v.currentTime);
    const onMeta = () => setDuration(v.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onLoadStart = () => setVideoLoading(true);
    const onCanPlay = () => setVideoLoading(false);

    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("loadstart", onLoadStart);
    v.addEventListener("canplay", onCanPlay);

    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("loadstart", onLoadStart);
      v.removeEventListener("canplay", onCanPlay);
    };
  }, [videoUrl]);

  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);

  // ── Fetch Motion Alerts for Timeline ───────────────────────────
  useEffect(() => {
    if (!playingFile || !duration || playingFile.camera_id === "Uploaded File") {
      setMotionRanges([]);
      return;
    }

    let cancelled = false;
    const fetchMotionAlerts = async () => {
      try {
        if (!cameraIp) return;
        const res = await fetch(`${API}/api/alerts?limit=1000&include_software_motion=true`, {
          headers: getAuthHeaders()
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          const alertsList = data.alerts || [];

          const match = playingFile.start_time.match(/(\d{2})[-:_](\d{2})[-:_](\d{2})/);
          if (!match) return;
          const [_, hh, mm, ss] = match;

          const matchDate = playingFile.date.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
          if (!matchDate) return;
          const [__, year, month, day] = matchDate;

          const fileStart = new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hh, 10),
            parseInt(mm, 10),
            parseInt(ss, 10)
          );
          const fileStartMs = fileStart.getTime();
          const fileEndMs = fileStartMs + duration * 1000;

          const parseLocalMs = (timeStr) => {
            if (!timeStr) return null;
            const d = new Date(timeStr);
            if (isNaN(d.getTime())) return null;
            return new Date(
              d.getFullYear(), d.getMonth(), d.getDate(),
              d.getHours(), d.getMinutes(), d.getSeconds()
            ).getTime();
          };

          const ranges = [];
          alertsList.forEach((alert) => {
            const alertIpNormalized = alert.ip?.replace(/_/g, ".");
            if (alertIpNormalized === cameraIp && alert.source === "software_motion") {
              const startMs = parseLocalMs(alert.motion_start || alert.time);
              if (startMs === null) return;
              const endMs = parseLocalMs(alert.motion_end) || (startMs + 5000);

              if (endMs >= fileStartMs && startMs <= fileEndMs) {
                const startOffset = Math.max(0, (startMs - fileStartMs) / 1000);
                const endOffset = Math.min(duration, (endMs - fileStartMs) / 1000);
                if (endOffset > startOffset) {
                  ranges.push({ start: startOffset, end: endOffset });
                }
              }
            }
          });
          setMotionRanges(ranges);
        }
      } catch (err) {
        console.error("Error fetching motion alerts for side timeline:", err);
      }
    };

    fetchMotionAlerts();
    return () => { cancelled = true; };
  }, [playingFile, duration, cameraIp]);

  // ── Scrubber & Timeline Drags ───────────────────────────────────
  useEffect(() => {
    const handleMove = (e) => {
      if (isDraggingScrubber.current && progressRef.current && duration) {
        const rect = progressRef.current.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (videoRef.current) {
          videoRef.current.currentTime = pct * duration;
          setCurrentTime(pct * duration);
        }
      }
      if (isTimelineDragging.current && timelineRef.current && duration) {
        const rect = timelineRef.current.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (videoRef.current) {
          videoRef.current.currentTime = pct * duration;
          setCurrentTime(pct * duration);
        }
      }
    };
    const handleUp = () => {
      isDraggingScrubber.current = false;
      isTimelineDragging.current = false;
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [duration]);

  // ── Play Continuous Archive File ───────────────────────────────
  const playFile = (file) => {
    setPlayingAlert(null);
    setPlayingFile(file);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setVideoError(null);
    setVideoLoading(true);
    
    logUIAction(user, `Played Archive Segment: ${file.start_time}`, "recording", {
      file: file.start_time,
      camera_id: file.camera_id,
      date: file.date
    });

    const cb = Date.now();
    const tk = getToken();
    const url = `${API}/api/recordings/play`
      + `?camera_id=${encodeURIComponent(file.camera_id)}`
      + `&date=${encodeURIComponent(file.date)}`
      + `&start_time=${encodeURIComponent(file.start_time)}`
      + `&_cb=${cb}`
      + (tk ? `&token=${encodeURIComponent(tk)}` : "");
    
    setVideoUrl(url);
  };

  // ── Play Alert Event Clip ──────────────────────────────────────
  const playAlert = async (alert) => {
    setPlayingFile(null);
    setPlayingAlert(alert);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setVideoError(null);
    setVideoLoading(true);
    
    logUIAction(user, `Played Alert Event Clip: ${alert.type || 'Event'}`, "recording", {
      alert_type: alert.type || alert.eventType || 'unknown',
      time: alert.time || alert.received_at
    });

    try {
      const time = alert.time || alert.received_at;
      if (!time) throw new Error("Alert has no timestamp");

      const url = `${API}/api/event-playback`
        + `?ip=${encodeURIComponent(playbackIp)}`
        + `&time=${encodeURIComponent(time)}`;

      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) {
        let errMsg = `Server error ${res.status}`;
        try { const e = await res.json(); errMsg = e.error || errMsg; } catch {}
        throw new Error(errMsg);
      }

      const data = await res.json();
      setVideoUrl(data.clipUrl);
    } catch (e) {
      console.error("[SidePlaybackPanel] playback error:", e);
      setVideoError(e.message || "Playback failed");
    } finally {
      setVideoLoading(false);
    }
  };

  // ── Control Actions ────────────────────────────────────────────
  const togglePlay = () => {
    if (!videoRef.current) return;
    playing ? videoRef.current.pause() : videoRef.current.play();
  };

  const skip = (secs) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + secs));
  };

  const handleSnapshot = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");

    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const timestamp = fmt(currentTime).replace(/:/g, "-");
      const camName = camera?.name || "camera";
      const filename = `snapshot_${camName}_${timestamp}.png`;

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("Canvas toBlob error"));
        }, "image/png");
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);

      showToast("Snapshot saved!");
    } catch (err) {
      console.error("Snapshot error:", err);
      showToast("Snapshot failed: " + err.message, "error");
    }
  };

  const handleDownloadVideo = async () => {
  if (!playingFile && !playingAlert) {
    showToast("Select a file or alert to download", "error");
    return;
  }

  if (playingAlert) {
    if (!videoUrl) return;
    try {
      const time = playingAlert.time || playingAlert.received_at;
      if (!time) throw new Error("Alert has no timestamp");

      const isHls = videoUrl.includes(".m3u8");

      if (isHls) {
        // videoUrl is an HLS playlist — fetch it, then fetch + stitch
        // together every .ts segment it references into one real file.
        const playlistRes = await fetch(videoUrl, { headers: getAuthHeaders() });
        if (!playlistRes.ok) throw new Error(`Server returned ${playlistRes.status}`);
        const playlistText = await playlistRes.text();

        const segmentNames = playlistText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));

        if (segmentNames.length === 0) {
          throw new Error("Playlist has no video segments");
        }

        const baseUrl = videoUrl.substring(0, videoUrl.lastIndexOf("/") + 1);

        const segmentBuffers = [];
        for (const name of segmentNames) {
          const segUrl = /^https?:\/\//.test(name) ? name : baseUrl + name;
          const segRes = await fetch(segUrl, { headers: getAuthHeaders() });
          if (!segRes.ok) throw new Error(`Failed to fetch segment ${name} (${segRes.status})`);
          segmentBuffers.push(await segRes.arrayBuffer());
        }

        const blob = new Blob(segmentBuffers, { type: "video/mp2t" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        const safeTime = time.replace(/[:\/]/g, "-");
        // Real container is MPEG-TS, not MP4 — labeling it .mp4 would
        // still fail to open in players that check the container format.
        a.download = `Alert_${camera?.name || cameraIp}_${safeTime}.ts`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        showToast(`Video downloaded for ${camera?.name || cameraIp || "camera"}.`);
        logUIAction(user, "Video Downloaded", "download", { filename: a.download, file_type: "alert_ts" });
      } else {
        // Not HLS — a direct fetch+blob is safe as-is.
        const response = await fetch(videoUrl, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        const safeTime = time.replace(/[:\/]/g, "-");
        a.download = `Alert_${camera?.name || cameraIp}_${safeTime}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        showToast(`Video downloaded for ${camera?.name || cameraIp || "camera"}.`);
        logUIAction(user, "Video Downloaded", "download", { filename: a.download, file_type: "alert" });
      }
    } catch (err) {
      console.error("Alert download error:", err);
      showToast("Download failed: " + err.message, "error");
    }
    return;
  }

  // ...rest (playingFile branch) unchanged

    const safeTime = playingFile.start_time.replace(/[:\/]/g, "-");
    const safeDate = playingFile.date.replace(/[:\/]/g, "-");
    const filename = `${playingFile.camera_id}_${safeDate}_${safeTime}.zip`;
    const url = `${API}/api/recordings/download`
      + `?camera_id=${encodeURIComponent(playingFile.camera_id)}`
      + `&date=${encodeURIComponent(playingFile.date)}`
      + `&start_time=${encodeURIComponent(playingFile.start_time)}`;

    try {
      const response = await fetch(url, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const blob = await response.blob();
      
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      showToast(`Video downloaded for ${camera?.name || cameraIp || "camera"}.`);
      logUIAction(user, "Video Downloaded", "download", { filename, file_type: "archive" });
    } catch (err) {
      console.error("Download error:", err);
      showToast("Download failed: " + err.message, "error");
    }
  };

  const seek = (e) => {
    if (!videoRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.current.currentTime = pct * duration;
    setCurrentTime(pct * duration);
  };

  const handleTimelineMouseDown = (e) => {
    isTimelineDragging.current = true;
    seek(e);
  };

  const toggleHourOpen = (hour) => {
    setExpandedHours((prev) => {
      const next = new Set(prev);
      next.has(hour) ? next.delete(hour) : next.add(hour);
      return next;
    });
  };

  const getAbsoluteTime = (secondsOffset) => {
    if (!playingFile?.start_time) return "";
    const match = playingFile.start_time.match(/(\d{2})[-:_](\d{2})[-:_](\d{2})/);
    if (!match) return "";
    const [_, hh, mm, ss] = match;
    const d = new Date(selectedDate);
    d.setHours(parseInt(hh, 10), parseInt(mm, 10), parseInt(ss, 10), 0);
    d.setSeconds(d.getSeconds() + Math.floor(secondsOffset));
    return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  // ── Group files by hour ─────────────────────────────────────────
function formatEventTimestamp(value) {
  if (!value) return "";
  const match = String(value).match(/(?:T|\s)(\d{2}[:\-]\d{2}[:\-]\d{2})/);
  const time = (match?.[1] || String(value).match(/\d{2}[:\-]\d{2}[:\-]\d{2}/)?.[0] || "").replace(/-/g, ":");
  const date = String(value).match(/(\d{4}[-/]\d{2}[-/]\d{2})/)?.[1]?.replace(/\//g, "-");
  return time && date ? `${time} (${date})` : time || date || String(value);
}
  const groupedFiles = useMemo(() => {
    const groups = files.reduce((acc, f) => {
      const h = String(extractHour(f)).padStart(2, "0");
      (acc[h] = acc[h] || []).push(f);
      return acc;
    }, {});
    
    // Sort files within each hour descending
    Object.values(groups).forEach(arr => {
      arr.sort((a, b) => {
        const timeA = a.start_time || a.name || "";
        const timeB = b.start_time || b.name || "";
        return timeB.localeCompare(timeA);
      });
    });
    
    return groups;
  }, [files]);
  const eventTimestamp = formatEventTimestamp(playingAlert?.time || playingAlert?.received_at);

  return (
    <div className="side-playback-panel">
      {/* Toast Notification */}
      {toast && createPortal(
        <div className={`side-playback-toast ${toast.type === "error" ? "toast-error" : ""}`}>
          {toast.type === "error" ? (
            <span className="side-playback-toast__icon side-playback-toast__icon--error">!</span>
          ) : (
            <span className="side-playback-toast__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="9" />
                <path d="m8 12 2.5 2.5L16 9" />
              </svg>
            </span>
          )}
          <div className="side-playback-toast__content">
            <strong>{toast.type === "error" ? "ERROR" : "SUCCESS"}</strong>
            <span>{toast.msg}</span>
          </div>
          <div className="side-playback-toast__progress" aria-hidden="true" />
        </div>,
        document.body
      )}

      {/* Header */}
      <div className="side-playback-header">
        <div className="side-playback-header__info">
          <span className="side-playback-title">{camera?.name || "Camera Playback"}</span>
          <span className="side-playback-subtitle">
            {cameraIp}
            {playingAlert && eventTimestamp && (
              <span style={{ marginLeft: "8px", fontWeight: "600", color: "var(--teal)" }}>
                {eventTimestamp}
              </span>
            )}
          </span>
        </div>
        <button className="side-playback-close-btn" onClick={onClose} title="Close playback panel">✕</button>
      </div>

      {/* Video Viewport */}
      <div className="side-playback-video-container">
        <div
          ref={playerWrap}
          {...handlers}
          style={{ overflow: "hidden", cursor: zoom > 1 ? "grab" : "default", width: "100%", height: "100%" }}
        >
          <video
            ref={videoRef}
            className="side-playback-video"
            playsInline
            crossOrigin="anonymous"
            disablePictureInPicture
            disableRemotePlayback
            style={{ transform: zoomTransform, filter: cssFilter, transition: "filter 0.1s ease" }}
          />
        </div>

        {videoLoading && (
          <div className="side-playback-loading-overlay">
            <div className="side-playback-spinner" />
            <span style={{ fontSize: "11.5px" }}>Loading video segment...</span>
          </div>
        )}

        {videoError && (
          <div className="side-playback-error-overlay">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span style={{ fontSize: "12px", fontWeight: "600" }}>{videoError}</span>
          </div>
        )}

        {!videoUrl && !videoLoading && (
          <div className="side-playback-empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="48" height="48">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
            <p>Select an alert event or an archive recording segment to begin side-by-side playback</p>
          </div>
        )}
      </div>

      {/* Custom Scrubber Control Bar */}
      {videoUrl && (
        <div className="side-playback-controls-bar">
          <div className="side-playback-progress-row">
            <span className="side-playback-time-label">{fmt(currentTime)}</span>
            <div
              className="side-playback-scrubber-track"
              ref={progressRef}
              onMouseDown={(e) => { isDraggingScrubber.current = true; seek(e); }}
            >
              <div
                className="side-playback-scrubber-fill"
                style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
              />
              <div
                className="side-playback-scrubber-thumb"
                style={{ left: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
              />
            </div>
            <span className="side-playback-time-label">{fmt(duration)}</span>
          </div>

          <div className="side-playback-btns-row">
            <button className="side-playback-btn" onClick={() => skip(-10)} disabled={!videoUrl} title="Rewind 10s">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M2.5 12h19M2.5 12L8 6.5M2.5 12l5.5 5.5" />
              </svg>
            </button>

            <button className="side-playback-btn play-btn" onClick={togglePlay} disabled={!videoUrl} title="Play/Pause">
              {playing ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                  <rect x="5" y="4" width="4" height="16" rx="1" />
                  <rect x="15" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
              )}
            </button>

            <button className="side-playback-btn" onClick={() => skip(10)} disabled={!videoUrl} title="Fast Forward 10s">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M21.5 12h-19M21.5 12L16 6.5M21.5 12l-5.5 5.5" />
              </svg>
            </button>

            <div className="side-playback-vol-container">
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" style={{ color: "var(--text-muted)" }}>
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
              </svg>
              <input
                type="range"
                className="side-playback-vol-slider"
                min="0" max="1" step="0.05"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </div>

            <div className="side-playback-sharpness-container">
              <span className="side-playback-sharpness-label" title="Sharpen Video">SHARP:</span>
              <input
                type="range"
                className="side-playback-sharpness-slider"
                min="-100"
                max="100"
                step="5"
                value={sharpness}
                onChange={(e) => setSharpness(Number(e.target.value))}
              />
              <span className="side-playback-sharpness-value">{sharpness > 0 ? "+" : ""}{sharpness}</span>
            </div>

            {[1, 2].map((s) => (
              <button
                key={s}
                className={`side-playback-speed-btn ${speed === s ? "active" : ""}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}

            <button className="side-playback-btn" onClick={handleSnapshot} disabled={!videoUrl} title="Capture Frame">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>

            <button className="side-playback-btn side-playback-download-btn" onClick={handleDownloadVideo} disabled={!videoUrl || (!playingFile && !playingAlert)} title="Download Video" aria-label="Download video">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </div>

          {/* Integrated Mini-Timeline Timescale with motion highlights */}
          {playingFile && duration > 0 && (
            <div className="side-playback-timescale-box">
              <span className="side-playback-filter-label" style={{ fontSize: "9.5px" }}>Scrub timescale</span>
              <div
                className="side-playback-timeline-track"
                ref={timelineRef}
                onMouseDown={handleTimelineMouseDown}
              >
                <div
                  className="side-playback-timeline-fill"
                  style={{ width: `${(currentTime / duration) * 100}%` }}
                />
                {motionRanges.map((range, idx) => {
                  const leftPct = (range.start / duration) * 100;
                  const widthPct = Math.max(1, ((range.end - range.start) / duration) * 100);
                  return (
                    <div
                      key={idx}
                      className="side-playback-timeline-motion"
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      title="Motion segment"
                    />
                  );
                })}
                <div
                  className="side-playback-timeline-needle"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tabs Menu */}
      <div className="side-playback-tabs">
        <button
          className={`side-playback-tab-btn ${activeTab === "alerts" ? "active" : ""}`}
          onClick={() => { setActiveTab("alerts"); }}
        >
          Recent Alerts
        </button>
        <button
          className={`side-playback-tab-btn ${activeTab === "archive" ? "active" : ""}`}
          onClick={() => { setActiveTab("archive"); }}
        >
           Playback
        </button>
      </div>

      {/* Tab Panelssss */}
      <div className="side-playback-content">
        {activeTab === "archive" && (
          <div className="side-playback-archive-panel">
            <div className="side-playback-filter-row">
              <span className="side-playback-filter-label">Select Date</span>
              <DatePicker
                value={selectedDate}
                onChange={(val) => {
                  setSelectedDate(val);
                  setPlayingFile(null);
                  setVideoUrl(null);
                }}
              />
            </div>

            <div className="side-playback-files-container">
              <span className="side-playback-filter-label">Hour Blocks & Files</span>
              {loadingFiles && <div className="side-playback-spinner" style={{ margin: "20px auto" }} />}
              {!loadingFiles && files.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", padding: "24px 0" }}>
                  No recordings found for this date.
                </div>
              )}

              <div style={{ flex: 1, overflowY: "auto" }}>
                {Object.entries(groupedFiles).sort((a, b) => Number(b[0]) - Number(a[0])).map(([hour, hourFiles]) => {
                  const isOpen = expandedHours.has(hour);
                  return (
                    <div key={hour} className="side-playback-hour-group">
                      <button
                        className={`side-playback-hour-header ${isOpen ? "open" : ""}`}
                        onClick={() => toggleHourOpen(hour)}
                      >
                        <span className="side-playback-hour-chevron">{isOpen ? "▼" : "▶"}</span>
                        <span>{hour}:00 h</span>
                        <span className="side-playback-hour-count">({hourFiles.length})</span>
                      </button>
                      {isOpen && hourFiles.map((file) => (
                        <div
                          key={file.start_time}
                          className={`side-playback-file-item ${playingFile?.start_time === file.start_time ? "playing" : ""}`}
                          onClick={() => playFile(file)}
                        >
                          <div className="side-playback-file-icon">▶</div>
                          <div className="side-playback-file-name">
                            {file.start_time}
                            {file.file_path && file.file_path.includes("_motion_based") && (
                              <span className="side-playback-file-motion-badge">Motion</span>
                            )}
                          </div>
                          <div className="side-playback-file-size">{file.size}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === "alerts" && (
          <div className="side-playback-alerts-panel">
            <div className="side-playback-alerts-scroll">
              {loadingAlerts && <div className="side-playback-spinner" style={{ margin: "20px auto" }} />}
              {!loadingAlerts && alerts.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", padding: "24px 0" }}>
                  No recent alerts active on this camera.
                </div>
              )}

              {alerts.map((alert, i) => {
                const rawTime = alert.time || alert.received_at || "";
                const timeOnly = rawTime.includes("T")
                  ? rawTime.split("T")[1]?.split("+")[0]?.split(".")[0]
                  : rawTime;
                const dateOnly = rawTime.includes("T")
                  ? rawTime.split("T")[0]
                  : "";
                // Prefer persisted snapshot on the alert if available, else fallback to recorded extraction or external image
                const alertIpRaw = (alert.ip || "").replace(/_/g, ".");
                const persisted = alert.snapshot_url || alert.snapshotUrl || alert.snapshot || alert.face_url || alert.image || null;
                const alertThumbnailUrl = persisted || (!alert.isExternal && alertIpRaw && rawTime
                  ? `${API}/api/event-playback/snapshot?ip=${encodeURIComponent(alertIpRaw)}&time=${encodeURIComponent(rawTime)}`
                  : null);
                

                return (
                  <div
                    key={i}
                    className={`side-playback-alert-row ${playingAlert === alert ? "is-playing" : ""}`}
                  >
                    {(alert.liveSnapshot || alertThumbnailUrl) && (
                      <div className="side-playback-alert-thumb-wrap" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {alert.liveSnapshot && (
                          <img
                            src={alert.liveSnapshot}
                            alt="Live snapshot"
                            className="side-playback-alert-live-thumb"
                            loading="lazy"
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                          />
                        )}

                        {alertThumbnailUrl && (
                          <img
                            src={alertThumbnailUrl}
                            alt="Alert snapshot"
                            className="side-playback-alert-thumb"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              if (e.currentTarget.parentElement) {
                                // keep the live snapshot visible if it exists
                                const live = e.currentTarget.parentElement.querySelector('.side-playback-alert-live-thumb');
                                if (!live) {
                                  e.currentTarget.parentElement.style.display = "none";
                                }
                              }
                            }}
                          />
                        )}
                      </div>
                    )}
                    <div className="side-playback-alert-info">
                      <div className="side-playback-alert-event">
                        {alert.isExternal ? (
                          <>
                            <span className="side-playback-alert-type">{alert.eventType || "AI Event"}</span>
                            {alert.personName && (
                              <span className="side-playback-alert-person">👤 {alert.personName}</span>
                            )}
                          </>
                        ) : (
                          <span className="side-playback-alert-type">{formatEventName(alert.type || "Active Alert")}</span>
                        )}
                      </div>
                      <div className="side-playback-alert-time">
                        <span>{timeOnly || "—"}</span>
                        {dateOnly && <span className="side-playback-alert-date">({dateOnly})</span>}
                      </div>
                    </div>
                    <button className="m-btn m-btn--primary" style={{ padding: "4px 10px", fontSize: "11.5px" }} onClick={() => playAlert(alert)}>
                      <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" style={{ marginRight: "4px" }}>
                        <polygon points="6 3 20 12 6 21 6 3" />
                      </svg>
                      Play
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}