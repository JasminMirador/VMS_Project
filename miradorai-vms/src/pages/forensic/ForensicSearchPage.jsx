import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useDigitalZoom } from "../../hooks/useDigitalZoom";
import { useAuth } from "../../context/AuthContext";
import "./ForensicSearchPage.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

const COLORS = [
  { name: "white",  hex: "#f8fafc", textDark: true  },
  { name: "black",  hex: "#0f172a", textDark: false },
  { name: "gray",   hex: "#64748b", textDark: false },
  { name: "red",    hex: "#ef4444", textDark: false },
  { name: "orange", hex: "#f97316", textDark: false },
  { name: "yellow", hex: "#eab308", textDark: true  },
  { name: "green",  hex: "#22c55e", textDark: false },
  { name: "blue",   hex: "#3b82f6", textDark: false },
  { name: "purple", hex: "#a855f7", textDark: false },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAuthHeaders() {
  const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authUrl(path) {
  const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
  const separator = path.includes("?") ? "&" : "?";
  return token
    ? `${API_BASE}${path}${separator}token=${encodeURIComponent(token)}`
    : `${API_BASE}${path}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CameraIcon({ type, size = 18 }) {
  if (type === "bullet") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2">
        <rect x="2" y="7" width="20" height="10" rx="2"/>
        <path d="M6 17v2M18 17v2M6 7V5M18 7V5"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 22a10 10 0 0 0 10-10H2a10 10 0 0 0 10 10z"/>
      <circle cx="12" cy="8" r="4"/>
    </svg>
  );
}

function ColorDot({ name }) {
  const c = COLORS.find(x => x.name === name);
  if (!c) return <span className="color-label">{name}</span>;
  return (
    <span
      className="color-dot"
      title={name}
      style={{ background: c.hex, border: name === "white" ? "1px solid #334155" : "none" }}
    />
  );
}

function DetectionThumbnail({ detectionId, appearance }) {
  const [failed, setFailed] = useState(false);
  const top    = appearance?.top_color_name    || "white";
  const bottom = appearance?.bottom_color_name || "blue";

  const CSS_COLORS = {
    white: "#F8FAFC", black: "#0F172A", gray: "#64748B",
    red: "#EF4444", orange: "#F97316", yellow: "#EAB308",
    green: "#22C55E", blue: "#3B82F6", purple: "#A855F7",
  };
  const topHex = CSS_COLORS[top]    || "#F8FAFC";
  const botHex = CSS_COLORS[bottom] || "#3B82F6";

  if (failed) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className="card-thumbnail-svg">
        <rect width="100" height="100" fill="#1E293B" rx="0"/>
        <circle cx="50" cy="28" r="14" fill="#CBD5E1"/>
        <path d="M22,78 C22,52 78,52 78,78 L68,78 L68,56 L32,56 L32,78 Z" fill={topHex}/>
        <path d="M32,78 L46,78 L46,98 L32,98 Z" fill={botHex}/>
        <path d="M54,78 L68,78 L68,98 L54,98 Z" fill={botHex}/>
        <path d="M8,22 L8,8 L22,8"  stroke="#38BDF8" strokeWidth="2.5" fill="none"/>
        <path d="M92,22 L92,8 L78,8" stroke="#38BDF8" strokeWidth="2.5" fill="none"/>
        <path d="M8,78 L8,92 L22,92" stroke="#38BDF8" strokeWidth="2.5" fill="none"/>
        <path d="M92,78 L92,92 L78,92" stroke="#38BDF8" strokeWidth="2.5" fill="none"/>
      </svg>
    );
  }

  return (
    <img
      src={authUrl(`/api/forensic/video/thumbnail?detection_id=${detectionId}`)}
      alt="Detection snapshot"
      className="card-thumbnail-img"
      onError={() => setFailed(true)}
    />
  );
}

// ── Indexer Status Panel ──────────────────────────────────────────────────────
function IndexerStatusPanel({ status }) {
  if (!status) return null;

  const isIndexing = status.is_indexing;
  const total      = status.total_detections_indexed || 0;
  const tracks     = status.total_active_tracks || 0;
  const hasML      = status.has_ml_libraries;
  const lastCamera = status.last_indexed_camera || "—";
  const lastSweep  = status.last_sweep
    ? new Date(status.last_sweep).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Not started";

  return (
    <div className="indexer-status-panel">
      <div className="status-panel-header">
        <span className={`status-live-dot ${isIndexing ? "pulsing" : ""}`} />
        <span className="status-panel-title">
          {isIndexing ? "Indexing…" : "AI Indexer"}
        </span>
        <span className={`status-engine-badge ${hasML ? "ml-active" : "ml-fallback"}`}>
          {hasML ? "YOLOv8" : "No ML"}
        </span>
      </div>
      <div className="status-panel-grid">
        <div className="status-stat">
          <div className="stat-value">{total.toLocaleString()}</div>
          <div className="stat-label">Detections</div>
        </div>
        <div className="status-stat">
          <div className="stat-value">{tracks.toLocaleString()}</div>
          <div className="stat-label">Tracks</div>
        </div>
      </div>
      <div className="status-panel-meta">
        <div className="meta-row">
          <span>Last camera</span>
          <span className="meta-val">{lastCamera}</span>
        </div>
        <div className="meta-row">
          <span>Last sweep</span>
          <span className="meta-val">{lastSweep}</span>
        </div>
        {status.device_mode && (
          <div className="meta-row">
            <span>Mode</span>
            <span className="meta-val">{status.device_mode}</span>
          </div>
        )}
        {status.last_error && (
          <div className="meta-row meta-error">
            <span>Error</span>
            <span className="meta-val">{status.last_error.slice(0, 40)}…</span>
          </div>
        )}
      </div>
      {isIndexing && status.current_file && (
        <div className="status-current-file">
          <span className="current-file-label">Processing:</span>
          <span className="current-file-name">
            {status.current_file.split("/").pop().split("\\").pop()}
          </span>
        </div>
      )}
    </div>
  );
}

// ── ReIndex Modal ─────────────────────────────────────────────────────────────
function ReindexModal({ cameras, onClose, onTrigger }) {
  const [camId, setCamId]     = useState(cameras[0]?.id || "");
  const [startDate, setStart] = useState(new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0]);
  const [endDate, setEnd]     = useState(new Date().toISOString().split("T")[0]);
  const [busy, setBusy]       = useState(false);
  const [done, setDone]       = useState(false);

  const handleTrigger = async () => {
    if (!camId) return;
    setBusy(true);
    // await onTrigger(camId, startDate, endDate);
        // If 'all', loop through all cameras and trigger them sequentially
    if (camId === "all") {
      for (const cam of cameras) {
        await onTrigger(cam.id, startDate, endDate);
      }
    } else {
      await onTrigger(camId, startDate, endDate);
    }
    
    setBusy(false);
    setDone(true);
    setTimeout(onClose, 1500);
  };

  return (
    <div className="reindex-modal-overlay" onClick={onClose}>
      <div className="reindex-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#38bdf8" strokeWidth="2.2">
            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
          </svg>
          Trigger Re-Index
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-field">
            <label>Camera</label>
            <select value={camId} onChange={e => setCamId(e.target.value)} className="datetime-input">
               <option value="all">-- All Cameras --</option>
              
              {cameras.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="modal-field">
            <label>From Date</label>
            <input type="date" className="datetime-input" value={startDate} onChange={e => setStart(e.target.value)}/>
          </div>
          <div className="modal-field">
            <label>To Date</label>
            <input type="date" className="datetime-input" value={endDate} onChange={e => setEnd(e.target.value)}/>
          </div>
        </div>
        <div className="modal-footer">
          {done ? (
            <div className="modal-success">✅ Reindex task started!</div>
          ) : (
            <button
              className="scan-btn"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={handleTrigger}
              disabled={busy}
            >
              {busy ? <><div className="loading-spinner" style={{width:14,height:14,borderWidth:2}}/> Starting…</> : "Start Re-Index"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ForensicSearchPage() {
  const { user } = useAuth();
  // Filter state
  const [startDate,    setStartDate]    = useState("");
  const [endDate,      setEndDate]      = useState("");
  const [selectedCams, setSelectedCams] = useState({});
  const [objectType,   setObjectType]   = useState("person");
  const [topColor,     setTopColor]     = useState("any");
  const [bottomColor,  setBottomColor]  = useState("any");
  const [gender,       setGender]       = useState("any");
  const [bag,          setBag]          = useState("any");

  // Data state
  const [camerasList,  setCamerasList]  = useState([]);
  const [results,      setResults]      = useState([]);
  const [loading,      setLoading]      = useState(false);

  const filteredCamerasList = useMemo(() => {
    if (user?.role === "admin" || !user?.allowedCameras || user?.allowedCameras.length === 0) {
      return camerasList;
    }
    return camerasList.filter(c => {
      const stored = localStorage.getItem("miradorai_devices");
      const devices = stored ? JSON.parse(stored) : [];
      const dev = devices.find(d => 
        String(d.id) === String(c.id) || 
        d.stream_key === c.id || 
        d.ip === c.id
      );
      if (!dev) return false;
      return user.allowedCameras.includes(String(dev.id));
    });
  }, [camerasList, user]);
  const [statusData,   setStatusData]   = useState(null);
  const [hasSearched,  setHasSearched]  = useState(false);

  // Tracking workspace state
  const [activeTrack,  setActiveTrack]  = useState(null);
  const [trackLoading, setTrackLoading] = useState(false);

  // Video player state
  const [playbackMode, setPlaybackMode] = useState("unified");
  const [selectedClip, setSelectedClip] = useState(null);
  const [videoError,   setVideoError]   = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [sharpness,    setSharpness]    = useState(0);

  const cssFilter = useMemo(() => {
    const sharpnessContrast = 1 + (sharpness / 400);
    return `contrast(${sharpnessContrast.toFixed(3)})`;
  }, [sharpness]);

  // ReIndex modal
  const [showReindex,  setShowReindex]  = useState(false);

  const videoRef = useRef(null);
  const playerWrap = useRef(null);
  const { zoom, zoomTransform, handlers } = useDigitalZoom(playerWrap, videoRef);

  // ── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const today     = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    setStartDate(yesterday.toISOString().split("T")[0]);
    setEndDate(today.toISOString().split("T")[0]);
    fetchCameras();
    fetchStatus();

    // Poll indexer status every 8 seconds
    const pollId = setInterval(fetchStatus, 8000);
    return () => clearInterval(pollId);
  }, []);

  // ── Camera Loader ─────────────────────────────────────────────────────────

  const fetchCameras = async () => {
    let camList = [];
    try {
      const res  = await fetch(`${API_BASE}/api/cameras`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          camList = data.map(cam => ({
            id:   cam.stream_key || cam.id || cam.ip,
            name: cam.device_name || cam.name || cam.ip,
            type: (cam.model || "dome").toLowerCase(),
          })).filter(c => c.id);
        }
      }
    } catch (_) {}

    if (!camList.length) {
      try {
        const saved    = localStorage.getItem("miradorai_devices");
        const enrolled = saved ? JSON.parse(saved) : [];
        camList = enrolled.length > 0
          ? enrolled.map(c => ({ id: c.stream_key || c.id || c.ip, name: c.name || c.ip, type: "dome" })).filter(c=>c.id)
          : [];
      } catch (_) {}
    }

    setCamerasList(camList);
    const all = {};
    camList.forEach(c => { all[c.id] = true; });
    setSelectedCams(all);
  };

  const fetchStatus = async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/forensic/index-status`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStatusData(data);
      }
    } catch (_) {}
  };

  // ── Search ────────────────────────────────────────────────────────────────

  const handleSearch = async () => {
    setLoading(true);
    setResults([]);
    setActiveTrack(null);
    setHasSearched(true);
    try {
      const activeCams  = Object.keys(selectedCams).filter(k => selectedCams[k]);
      const cameraQuery = activeCams.length ? `&cameras=${activeCams.join(",")}` : "";
      const qs = [
        `start_time=${startDate}`,
        `end_time=${endDate}`,
        `object_type=${objectType}`,
        `top_color=${topColor}`,
        `bottom_color=${bottomColor}`,
        `gender=${gender}`,
        `bag=${bag}`,
      ].join("&") + cameraQuery;

      const res  = await fetch(`${API_BASE}/api/forensic/search?${qs}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.success) setResults(data.results || []);
      fetchStatus();
    } catch (err) {
      console.error("[FORENSIC] Search failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Reindex trigger ───────────────────────────────────────────────────────

  const handleReindex = async (camId, startDate, endDate) => {
    try {
      await fetch(
        `${API_BASE}/api/forensic/reindex?camera_id=${encodeURIComponent(camId)}&start_date=${startDate}&end_date=${endDate}`,
        { method: "POST", headers: getAuthHeaders() }
      );
    } catch (e) {
      console.error("[FORENSIC] Reindex failed:", e);
    }
  };

  // ── Video Player Control ──────────────────────────────────────────────────

  const setVideoSource = useCallback((url) => {
    const vid = videoRef.current;
    if (!vid) return;
    setVideoError(false);
    setVideoLoading(true);
    vid.pause();
    vid.src = url;
    vid.load();
    vid.play().catch(() => {});
  }, []);

  const handlePlayUnified = useCallback(() => {
    if (!activeTrack) return;
    setPlaybackMode("unified");
    setSelectedClip(null);
    setVideoSource(authUrl(activeTrack.combined_video_url));
  }, [activeTrack, setVideoSource]);

  const handlePlayClip = useCallback((clip) => {
    setPlaybackMode("clip");
    setSelectedClip(clip);
    setVideoSource(authUrl(clip.video_url));
  }, [setVideoSource]);

  useEffect(() => {
    if (activeTrack && !trackLoading) {
      const t = setTimeout(() => handlePlayUnified(), 150);
      return () => clearTimeout(t);
    }
  }, [activeTrack, trackLoading]); // eslint-disable-line

  // ── Track Resolver ────────────────────────────────────────────────────────

  const handleSelectDetection = async (detIdsArray) => {
    setTrackLoading(true);
    setActiveTrack(null);
    setVideoError(false);
    try {
      const res  = await fetch(`${API_BASE}/api/forensic/track`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body:    JSON.stringify({ detection_ids: detIdsArray, detection_id: detIdsArray[0] }),
      });
      const data = await res.json();
      if (data.success) {
        setActiveTrack(data);
        setPlaybackMode("unified");
        setSelectedClip(null);
      }
    } catch (err) {
      console.error("[FORENSIC] Track load failed:", err);
    } finally {
      setTrackLoading(false);
    }
  };

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownloadTrack = () => {
    if (!activeTrack) return;
    const url  = authUrl(activeTrack.combined_video_url);
    const link = document.createElement("a");
    link.href  = url;
    link.download = `forensic_evidence_${activeTrack.track_id}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Group results by person_cluster_id (Cross-Camera Identity) ──────────
  const groupedSubjects = (() => {
    const map = new Map();
    for (const det of results) {
      // Use person_cluster_id if available, fallback to track_id or detection_id
      const key = det.person_cluster_id && det.person_cluster_id !== "Unknown" 
                  ? det.person_cluster_id 
                  : (det.track_id || det.detection_id);
                  
      if (!map.has(key)) {
        map.set(key, { 
            ...det, 
            _count: 1,
            _detection_ids: [det.detection_id],
            _cluster_label: key
        });
      } else {
        const group = map.get(key);
        group._count += 1;
        group._detection_ids.push(det.detection_id);
      }
    }
    return Array.from(map.values());
  })();

  const totalIndexed = statusData?.total_detections_indexed || 0;
  const isIndexing   = statusData?.is_indexing || false;
  const hasML        = statusData?.has_ml_libraries;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="forensic-page-shell">
      {/* ── Page Header ── */}
      <div className="page-header" style={{ padding: "16px 20px 8px 20px" }}>
        <div>
          <h1 className="page-title">Forensic <span>Scan</span></h1>
          <p className="page-desc">AI Multi-Camera Forensic Search — powered by YOLOv8 real detection.</p>
        </div>
        {/* Live indexed count badge */}
        {totalIndexed > 0 && (
          <div className="indexed-count-badge">
            <span className={`indexed-dot ${isIndexing ? "pulsing" : ""}`}/>
            {totalIndexed.toLocaleString()} detections indexed
          </div>
        )}
      </div>

      <div className="forensic-container">
        {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
        <aside className="forensic-sidebar">
          <div className="sidebar-title">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35M11 8v6M8 11h6"/>
            </svg>
            Forensic Scan
          </div>

          {/* Indexer Status */}
          <IndexerStatusPanel status={statusData} />

          {/* Target Category */}
          <div className="filter-group">
            <div className="filter-label">Target Category</div>
            <select className="datetime-input" value={objectType} onChange={e => setObjectType(e.target.value)}>
              <option value="person">Person (Re-ID Tracker)</option>
              <option value="vehicle">Vehicle (Plate Index)</option>
            </select>
          </div>

          {/* Date Range */}
          <div className="filter-group">
            <div className="filter-label">From Date</div>
            <input type="date" className="datetime-input" value={startDate} onChange={e => setStartDate(e.target.value)}/>
          </div>
          <div className="filter-group">
            <div className="filter-label">To Date</div>
            <input type="date" className="datetime-input" value={endDate} onChange={e => setEndDate(e.target.value)}/>
          </div>

          {/* Camera Checklist */}
          <div className="filter-group">
            <div className="filter-label" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Cameras</span>
              <span
                style={{ cursor: "pointer", color: "#38bdf8", fontSize: "0.72rem" }}
                onClick={() => {
                  const allOn = filteredCamerasList.every(c => selectedCams[c.id]);
                  const next  = {};
                  filteredCamerasList.forEach(c => { next[c.id] = !allOn; });
                  setSelectedCams(next);
                }}
              >
                {filteredCamerasList.every(c => selectedCams[c.id]) ? "Deselect All" : "Select All"}
              </span>
            </div>
            <div className="cam-selector-box">
              {filteredCamerasList.length === 0 ? (
                <div className="no-cams-msg">No cameras enrolled</div>
              ) : (
                filteredCamerasList.map(cam => (
                  <label key={cam.id} className="cam-checkbox-row">
                    <input
                      type="checkbox"
                      checked={!!selectedCams[cam.id]}
                      onChange={() => setSelectedCams(p => ({ ...p, [cam.id]: !p[cam.id] }))}
                    />
                    <CameraIcon type={cam.type} size={13}/>
                    <span>{cam.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Person Attributes */}
          {objectType === "person" ? (
            <>
              <div className="filter-group">
                <div className="filter-label">Upper Color</div>
                <ColorSwatches value={topColor} onChange={setTopColor}/>
              </div>
              <div className="filter-group">
                <div className="filter-label">Lower Color</div>
                <ColorSwatches value={bottomColor} onChange={setBottomColor}/>
              </div>
              <div className="filter-group">
                <div className="filter-label">Gender</div>
                <select className="datetime-input" value={gender} onChange={e => setGender(e.target.value)}>
                  <option value="any">Any Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div className="filter-group">
                <div className="filter-label">Bag Carrying</div>
                <select className="datetime-input" value={bag} onChange={e => setBag(e.target.value)}>
                  <option value="any">Any Baggage</option>
                  <option value="backpack">Backpack</option>
                  <option value="handbag">Handbag / Purse</option>
                  <option value="none">No Bag</option>
                </select>
              </div>
            </>
          ) : (
            <div className="filter-group">
              <div className="filter-label">Vehicle Color</div>
              <ColorSwatches value={topColor} onChange={setTopColor}/>
            </div>
          )}

          <button className="scan-btn" onClick={handleSearch} disabled={loading}>
            {loading ? (
              <><div className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }}/> Scanning...</>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>
                </svg>
                Run Forensic Scan
              </>
            )}
          </button>

          {/* Re-Index Button */}
          {camerasList.length > 0 && (
            <button
              className="reindex-btn"
              onClick={() => setShowReindex(true)}
              title="Manually trigger YOLOv8 re-indexing for a camera"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
              </svg>
              Manual Re-Index
            </button>
          )}
        </aside>

        {/* ── RESULTS MAIN ──────────────────────────────────────────────────── */}
        <div className="forensic-main">
          <div className="forensic-header">
            <div className="header-title-section">
              <div className="header-main-title">Visual Forensic Results</div>
              <div className="header-subtitle">
                {results.length > 0
                  ? `${groupedSubjects.length} unique subject${groupedSubjects.length !== 1 ? "s" : ""} resolved across ${results.length} detections`
                  : "Matched subjects appear as cards. Click any card to view full camera tracking path."}
              </div>
            </div>
            {results.length > 0 && (
              <span className="results-count-badge">{results.length} Detections</span>
            )}
          </div>

          <div className="forensic-grid-wrap">
            {loading ? (
              <div className="grid-empty-state">
                <div className="scan-radar">
                  <div className="radar-ring r1"/>
                  <div className="radar-ring r2"/>
                  <div className="radar-ring r3"/>
                  <div className="radar-dot"/>
                </div>
                <div className="loading-text" style={{ fontSize: "1rem" }}>Executing AI Multi-Camera Forensic Scan...</div>
                <div style={{ fontSize: "0.78rem", color: "#475569" }}>Querying real YOLOv8 detections index</div>
              </div>
            ) : groupedSubjects.length > 0 ? (
              <div className="detections-grid">
                {groupedSubjects.map(det => (
                  <DetectionCard
                    key={det._cluster_label || det.detection_id}
                    det={det}
                    onClick={() => handleSelectDetection(det._detection_ids)}
                  />
                ))}
              </div>
            ) : hasSearched ? (
              /* ── Empty state after a search ── */
              <div className="grid-empty-state">
                <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="#334155" strokeWidth="1.2">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <div style={{ fontSize: "1rem", fontWeight: 600, color: "#94a3b8" }}>
                  No detections found
                </div>
                <div style={{ fontSize: "0.82rem", color: "#475569", maxWidth: 320, textAlign: "center", lineHeight: 1.7 }}>
                  {totalIndexed === 0 ? (
                    <>
                      <strong style={{ color: "#f97316" }}>The forensic index is empty.</strong>
                      <br/>
                      The YOLOv8 indexer is running in the background and will process recordings automatically.
                      <br/>
                      You can also trigger a manual re-index using the button on the left.
                    </>
                  ) : hasML ? (
                    <>
                      No real detections match your filters.
                      <br/>
                      Try broadening the color or date range, or trigger a re-index for additional recordings.
                    </>
                  ) : (
                    <>
                      <strong style={{ color: "#f97316" }}>YOLOv8 not installed.</strong>
                      <br/>
                      Install <code>ultralytics</code> and <code>torch</code> in your backend venv, then restart the server.
                    </>
                  )}
                </div>
                {camerasList.length > 0 && (
                  <button className="reindex-btn" style={{ marginTop: 16 }} onClick={() => setShowReindex(true)}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                    </svg>
                    Trigger Manual Re-Index
                  </button>
                )}
              </div>
            ) : (
              /* ── Initial state (before first search) ── */
              <div className="grid-empty-state">
                <svg className="radar-sweep-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 2a10 10 0 0110 10"/>
                  <line x1="12" y1="12" x2="22" y2="12"/>
                </svg>
                <div style={{ fontSize: "1rem", fontWeight: 600 }}>No Forensic Searches Yet</div>
                <div style={{ fontSize: "0.82rem", color: "#475569", maxWidth: 280, textAlign: "center", lineHeight: 1.6 }}>
                  {totalIndexed > 0
                    ? `${totalIndexed.toLocaleString()} real detections indexed. Set visual filters and click "Run Forensic Scan".`
                    : "Configure visual attributes in the left panel and click \"Run Forensic Scan\" to search the index."}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── TRACK WORKSPACE OVERLAY ──────────────────────────────────────── */}
        {(trackLoading || activeTrack) && (
          <div className="forensic-workspace">
            {/* Workspace Header */}
            <div className="workspace-header">
              <button className="ws-back-btn" onClick={() => { setActiveTrack(null); setTrackLoading(false); }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                Back to Results
              </button>

              {activeTrack && (
                <div className="ws-title">
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                  Forensic Auto-Track —{" "}
                  <span style={{ color: "#94a3b8", fontWeight: 500 }}>{activeTrack.camera_sequence?.join(" → ")}</span>
                </div>
              )}

              {activeTrack && (
                <span style={{ fontSize: "0.75rem", color: "#475569", fontWeight: 600 }}>
                  ID: {activeTrack.track_id}
                </span>
              )}
            </div>

            {/* Workspace Body */}
            <div className="ws-body">
              {trackLoading ? (
                <div className="ws-player-loading" style={{ flex: 1 }}>
                  <div className="loading-spinner"/>
                  <div className="loading-text">Resolving Multi-Camera Track Sequence...</div>
                  <div style={{ fontSize: "0.75rem", color: "#475569" }}>Compiling chronological camera path</div>
                </div>
              ) : activeTrack ? (
                <>
                  {/* ── Left: Video Player ── */}
                  <div className="ws-left-panel">
                    <div 
                      className="ws-player-container"
                      ref={playerWrap}
                      {...handlers}
                      style={{ overflow: 'hidden', cursor: zoom > 1 ? 'grab' : 'default', position: 'relative' }}
                    >
                      {videoLoading && !videoError && (
                        <div className="video-spinner-overlay">
                          <div className="loading-spinner"/>
                        </div>
                      )}
                      {videoError && (
                        <div className="video-error-overlay">
                          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#ef4444" strokeWidth="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 8v4M12 16h.01"/>
                          </svg>
                          <div>Could not load video clip</div>
                          <div style={{ fontSize: "0.72rem", color: "#64748b" }}>
                            Check that FFmpeg is installed and the recording file exists
                          </div>
                        </div>
                      )}
                      <video
                        ref={videoRef}
                        className="ws-video-element"
                        controls
                        playsInline
                        onWaiting={() => setVideoLoading(true)}
                        onCanPlay={() => setVideoLoading(false)}
                        onPlaying={() => setVideoLoading(false)}
                        onError={() => { setVideoLoading(false); setVideoError(true); }}
                        style={{ transform: zoomTransform, filter: cssFilter, transition: "filter 0.1s ease" }}
                      />

                      {/* HUD Overlay */}
                      <div className="ws-hud-overlay">
                        <span className="hud-rec-dot"/>
                        {playbackMode === "unified"
                          ? <span><span className="hud-track-tag">MASTER TRACK</span> · {activeTrack.clippings?.length} cameras</span>
                          : <span><span className="hud-track-tag">CLIP</span> · {selectedClip?.camera_name}</span>
                        }
                      </div>
                    </div>

                    {/* Sharpness Slider */}
                    <div className="forensic-sharpness-container" style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginTop: "10px",
                      background: "rgba(255,255,255,0.03)",
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid rgba(255,255,255,0.06)",
                      marginBottom: "10px"
                    }}>
                      <span style={{ fontSize: "11px", fontWeight: "600", color: "#94a3b8" }}>SHARPNESS:</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        step="5"
                        value={sharpness}
                        onChange={(e) => setSharpness(Number(e.target.value))}
                        style={{ flex: 1, height: "3px", accentColor: "#38bdf8", cursor: "pointer" }}
                      />
                      <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#38bdf8", minWidth: "28px", textAlign: "right" }}>
                        {sharpness > 0 ? "+" : ""}{sharpness}
                      </span>
                    </div>

                    {/* Action Buttons */}
                    <div className="ws-actions-row">
                      <button
                        className={`ws-action-btn ${playbackMode === "unified" ? "active-primary" : "outline"}`}
                        onClick={handlePlayUnified}
                      >
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                        Play Full Track
                      </button>
                      <button className="ws-action-btn export-btn" onClick={handleDownloadTrack}>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                        </svg>
                        Export Evidence (MP4)
                      </button>
                    </div>

                    {/* Subject Attributes Summary */}
                    {activeTrack.original_detection?.appearance && (
                      <div className="subject-attr-panel">
                        <div className="attr-panel-title">Subject Attributes</div>
                        <div className="attr-grid">
                          <AttrPill label="Top"    value={activeTrack.original_detection.appearance.top_color_name}    showDot/>
                          <AttrPill label="Bottom" value={activeTrack.original_detection.appearance.bottom_color_name} showDot/>
                          <AttrPill label="Gender" value={activeTrack.original_detection.appearance.gender}/>
                          <AttrPill label="Bag"    value={activeTrack.original_detection.appearance.bag}/>
                          <AttrPill
                            label="Confidence"
                            value={`${Math.round((activeTrack.original_detection.appearance.confidence || 0) * 100)}%`}
                            highlight
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Right: Timeline ── */}
                  <div className="ws-right-panel">
                    <div className="timeline-section-title">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      Camera Timeline · {activeTrack.clippings?.length} stops
                    </div>

                    <div className="timeline-flow">
                      {activeTrack.clippings?.map((clip, idx) => (
                        <div key={clip.detection_id}>
                          <div
                            className={`timeline-node ${selectedClip?.detection_id === clip.detection_id ? "active" : ""}`}
                            onClick={() => handlePlayClip(clip)}
                          >
                            <div className="node-thumb">
                              <TimelineThumbnail detectionId={clip.detection_id}/>
                            </div>

                            <div className="node-icon-wrap">
                              <CameraIcon type={clip.camera_type} size={16}/>
                            </div>

                            <div className="node-details">
                              <div className="node-cam-name">{clip.camera_name}</div>
                              <div className="node-time">
                                {clip.timestamp
                                  ? new Date(clip.timestamp).toLocaleString(undefined, {
                                      month: "short", day: "numeric",
                                      hour: "2-digit", minute: "2-digit", second: "2-digit"
                                    })
                                  : clip.timestamp}
                              </div>
                            </div>

                            <span className="node-play-badge">
                              {selectedClip?.detection_id === clip.detection_id ? "▶ Playing" : `Clip ${idx + 1}`}
                            </span>
                          </div>
                          {idx < activeTrack.clippings.length - 1 && (
                            <div className="timeline-connector">
                              <div className="connector-arrow"/>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* ── ReIndex Modal ── */}
      {showReindex && (
        <ReindexModal
          cameras={filteredCamerasList}
          onClose={() => setShowReindex(false)}
          onTrigger={handleReindex}
        />
      )}
    </div>
  );
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function ColorSwatches({ value, onChange }) {
  return (
    <div className="swatches-grid">
      <div
        className={`color-swatch any-swatch ${value === "any" ? "active" : ""}`}
        onClick={() => onChange("any")}
        title="Any color"
      >
        {value === "any" && <span className="swatch-check" style={{ color: "white" }}>✓</span>}
      </div>
      {COLORS.map(c => (
        <div
          key={c.name}
          className={`color-swatch ${value === c.name ? "active" : ""}`}
          style={{ background: c.hex, border: c.name === "white" ? "1px solid #33415580" : "none" }}
          onClick={() => onChange(c.name)}
          title={c.name}
        >
          {value === c.name && (
            <span className="swatch-check" style={{ color: c.textDark ? "#0f172a" : "white" }}>✓</span>
          )}
        </div>
      ))}
    </div>
  );
}

function DetectionCard({ det, onClick }) {
  const camCount = det._count || 1;
  return (
    <div className="detection-card" onClick={onClick}>
      <div className="card-img-wrap">
        <DetectionThumbnail detectionId={det.detection_id} appearance={det.appearance}/>
        <span className="card-confidence">{Math.round((det.appearance?.confidence || 0) * 100)}%</span>
        {camCount > 1 && (
          <span className="card-cam-count" title={`Seen across ${camCount} cameras`}>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
            </svg>
            {camCount}
          </span>
        )}
      </div>
      <div className="card-body">
        <div className="card-cam-name">
          <CameraIcon type={det.camera_type} size={13}/>
          {det.camera_name}
        </div>
        <div className="card-time">
          {det.timestamp
            ? new Date(det.timestamp).toLocaleString(undefined, {
                month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit"
              })
            : det.timestamp}
        </div>
        <div className="card-tags">
          {det.appearance?.top_color_name && (
            <span className="card-tag card-tag--top">
              <ColorDot name={det.appearance.top_color_name}/>
              {det.appearance.top_color_name}
            </span>
          )}
          {det.appearance?.bottom_color_name && (
            <span className="card-tag card-tag--bottom">
              <ColorDot name={det.appearance.bottom_color_name}/>
              {det.appearance.bottom_color_name}
            </span>
          )}
          {det.appearance?.gender && det.appearance.gender !== "unknown" && (
            <span className="card-tag card-tag--meta">{det.appearance.gender}</span>
          )}
          {det.appearance?.bag && det.appearance.bag !== "none" && (
            <span className="card-tag card-tag--meta">{det.appearance.bag}</span>
          )}
        </div>
        <div className="card-track-cta">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          View tracking path
        </div>
      </div>
    </div>
  );
}

function TimelineThumbnail({ detectionId }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="node-thumb-fallback">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#38bdf8" strokeWidth="1.8">
          <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
      </div>
    );
  }
  return (
    <img
      src={authUrl(`/api/forensic/video/thumbnail?detection_id=${detectionId}`)}
      alt=""
      className="node-thumb-img"
      onError={() => setFailed(true)}
    />
  );
}

function AttrPill({ label, value, showDot, highlight }) {
  return (
    <div className={`attr-pill ${highlight ? "attr-pill--highlight" : ""}`}>
      <span className="attr-label">{label}</span>
      <span className="attr-value">
        {showDot && <ColorDot name={value}/>}
        {value}
      </span>
    </div>
  );
}