import { useState, useEffect } from "react";
import "./StreamProfilesPage.css";
import { getNumber, apiUrl } from '../../config/appConfig';


const LABEL_STYLES = {
  MAIN:  { bg: "rgba(59, 130, 246, 0.15)", color: "#60a5fa",  border: "rgba(59, 130, 246, 0.4)" },
  SUB:   { bg: "rgba(139, 92, 246, 0.15)", color: "#c4b5fd",  border: "rgba(139, 92, 246, 0.4)" },
  EXTRA: { bg: "rgba(74, 222, 128, 0.15)", color: "#4ade80",  border: "rgba(74, 222, 128, 0.4)" },
};

function getLabelStyle(label) {
  if (!label) return { bg: "rgba(100, 116, 139, 0.15)", color: "#94a3b8", border: "rgba(100, 116, 139, 0.35)" };
  return LABEL_STYLES[label.toUpperCase()] || { bg: "rgba(100, 116, 139, 0.15)", color: "#94a3b8", border: "rgba(100, 116, 139, 0.35)" };
}

function loadDevicesFromStorage() {
  try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
  catch { return []; }
}

function loadOverrides() {
  try { return JSON.parse(localStorage.getItem("miradorai_stream_profile_overrides") || "{}"); }
  catch { return {}; }
}

function saveOverride(cameraKey, profileToken, fields) {
  const overrides = loadOverrides();
  if (!overrides[cameraKey]) overrides[cameraKey] = {};
  overrides[cameraKey][profileToken] = { ...(overrides[cameraKey][profileToken] || {}), ...fields };
  localStorage.setItem("miradorai_stream_profile_overrides", JSON.stringify(overrides));
}

function profileMeta(p) {
  return [p.resolution, p.encoding, p.fps ? `${p.fps} fps` : null, p.bitrate ? `${p.bitrate} kbps` : null]
    .filter(Boolean).join(" · ");
}

function resolveIdx(profs, savedName, preferredLabels, fallbackIdx) {
  if (savedName) {
    const idx = profs.findIndex((p) => p.name === savedName || p.token === savedName);
    if (idx !== -1) return idx;
  }
  for (const label of preferredLabels) {
    const idx = profs.findIndex((p) => p.label?.toUpperCase() === label);
    if (idx !== -1) return idx;
  }
  return Math.min(fallbackIdx, profs.length - 1);
}

/* ── Icons ───────────────────────────────────────────────── */
const GearIcon = ({ size = 16, color = "currentColor" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" width={size} height={size}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

/* ── Single profile row ──────────────────────────────────── */
function ProfileRow({ profile, index, isSelected, onSelect, onEdit }) {
  const ls = getLabelStyle(profile.label);
  return (
    <div
      className={`sp-profile-row${isSelected ? " sp-profile-row--active" : ""}`}
      onClick={() => onSelect(index)}
    >
      {/* Radio */}
      <div className="sp-profile-radio">
        <div className={`sp-profile-radio-fill${isSelected ? " sp-profile-radio-fill--on" : ""}`} />
      </div>

      {/* Name */}
      <div className="sp-profile-col sp-profile-col--name">
        <span className="sp-profile-name">{profile.name || `Profile ${index + 1}`}</span>
        {profile.token && <span className="sp-profile-token">{profile.token}</span>}
      </div>

      {/* Resolution */}
      <div className="sp-profile-col">
        <span className="sp-profile-res">{profile.resolution || "—"}</span>
      </div>

      {/* Encoding */}
      <div className="sp-profile-col">
        <span className="sp-profile-enc">{profile.encoding || "—"}</span>
      </div>

      {/* FPS */}
      <div className="sp-profile-col">
        <span className="sp-profile-fps">{profile.fps ? `${profile.fps} fps` : "—"}</span>
      </div>

      {/* Bitrate */}
      <div className="sp-profile-col">
        <span className="sp-profile-bitrate">{profile.bitrate ? `${profile.bitrate} kbps` : "—"}</span>
      </div>

      {/* Role badge */}
      <div className="sp-profile-col sp-profile-col--role">
        <span
          className="sp-profile-badge"
          style={{ background: ls.bg, color: ls.color, borderColor: ls.border }}
        >
          {profile.label || `S${index + 1}`}
        </span>
      </div>

      {/* Edit button */}
      {onEdit && (
        <button
          className="sp-profile-edit-btn"
          title="Configure Encoder"
          onClick={(e) => { e.stopPropagation(); onEdit(profile); }}
        >
          <GearIcon size={13} />
        </button>
      )}
    </div>
  );
}

/* ── Camera info card ────────────────────────────────────── */
function ONVIFProfilesCard({ camera, profiles, recIdx, onSelectRec, onEdit, applying, canApply, applyResult, onApply }) {
  if (!camera || !profiles?.length) return null;
  const recProfile = recIdx !== null ? profiles[recIdx] : null;

  return (
    <div className="sp-card">
      {/* ── Card Header ── */}
      <div className="sp-card-header">
        <div className="sp-card-header-left">
          <div className="sp-card-eyebrow">
            <span className="sp-card-eyebrow-dot" />
            ONVIF Detected · Live from Database
          </div>
          <div className="sp-card-title">
            <span className="sp-card-cam-name">
              {camera.manufacturer || "Unknown"} {camera.model || ""}
            </span>
            {camera.device_name && camera.device_name !== `${camera.manufacturer} ${camera.model}` && (
              <span className="sp-card-cam-alias">({camera.device_name})</span>
            )}
            <span className="sp-card-cam-ip">{camera.ip}</span>
            {camera.ptz === "Yes" && <span className="sp-card-ptz-badge">PTZ</span>}
          </div>
        </div>
        <div className="sp-card-stream-count">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
          {profiles.length} stream{profiles.length !== 1 ? "s" : ""} detected
        </div>
      </div>

      {/* ── Meta Strip ── */}
      <div className="sp-meta-strip">
        {[
          { k: "MAC Address",    v: camera.mac !== "—" ? camera.mac : null },
          { k: "Firmware",       v: camera.firmware },
          { k: "Serial No.",     v: camera.serial },
          { k: "Total Streams",  v: camera.stream_count, accent: true },
          { k: "PTZ Support",    v: camera.ptz },
        ].filter((x) => x.v).map(({ k, v, accent }) => (
          <div key={k} className="sp-meta-item">
            <span className="sp-meta-key">{k}</span>
            <span className={`sp-meta-val${accent ? " sp-meta-val--accent" : ""}`}>{v}</span>
          </div>
        ))}
      </div>

      {/* ── Section Label ── */}
      <div className="sp-section-label">
        <div className="sp-section-label-left">
          <span className="sp-section-dot" />
          <span className="sp-section-title">Recording Stream</span>
          <span className="sp-section-hint">Select the profile used for recording and live view</span>
        </div>
      </div>

      {/* ── Table Header ── */}
      <div className="sp-table-head">
        <div className="sp-th-radio" />
        <div className="sp-th">Profile Name</div>
        <div className="sp-th">Resolution</div>
        <div className="sp-th">Encoding</div>
        <div className="sp-th">FPS</div>
        <div className="sp-th">Bitrate</div>
        <div className="sp-th">Role</div>
        <div className="sp-th-action" />
      </div>

      {/* ── Profile Rows ── */}
      <div className="sp-table-body">
        {profiles.map((p, i) => (
          <ProfileRow
            key={i} profile={p} index={i}
            isSelected={recIdx === i}
            onSelect={onSelectRec}
            onEdit={onEdit}
          />
        ))}
      </div>

      {/* ── RTSP Strip ── */}
      {recProfile?.rtsp_url && (
        <div className="sp-rtsp-bar">
          <span className="sp-rtsp-label">RTSP</span>
          <code className="sp-rtsp-url">{recProfile.rtsp_url}</code>
        </div>
      )}

      {/* ── Active Selection Summary ── */}
      {recProfile && (
        <div className="sp-selection-bar">
          <div className="sp-selection-info">
            <div className="sp-selection-left">
              <div className="sp-selection-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" width="14" height="14">
                  <circle cx="12" cy="12" r="5" fill="rgba(96,165,250,0.2)"/>
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                </svg>
              </div>
              <div>
                <div className="sp-selection-label">Selected for Recording</div>
                <div className="sp-selection-name">{recProfile.name}</div>
              </div>
            </div>
            <div className="sp-selection-meta">{profileMeta(recProfile)}</div>
          </div>

          {/* Apply button lives here, inside the card */}
          <div className="sp-action-area">
            {applyResult && (
              <div className={`sp-toast${applyResult.ok ? " sp-toast--ok" : " sp-toast--err"}`}>
                {applyResult.ok ? <CheckIcon /> : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                  </svg>
                )}
                <span>{applyResult.msg}</span>
              </div>
            )}
            <button
              className={`sp-apply-btn${applying ? " sp-apply-btn--loading" : applyResult?.ok ? " sp-apply-btn--success" : ""}`}
              disabled={!canApply}
              onClick={onApply}
            >
              {applying ? (
                <><span className="sp-spinner" />Applying…</>
              ) : applyResult?.ok ? (
                <><CheckIcon />Applied</>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                    <path d="M5 12l5 5L20 7"/>
                  </svg>
                  Apply Configuration
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── No camera selected state ────────────────────────────── */
function NoCameraState() {
  return (
    <div className="sp-empty-state">
      <div className="sp-empty-icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="52" height="52">
          <path d="M23 7l-7 5 7 5V7z" strokeLinejoin="round"/>
          <rect x="1" y="5" width="15" height="14" rx="2.5"/>
          <circle cx="8.5" cy="12" r="2.5" strokeWidth="1" opacity="0.5"/>
        </svg>
      </div>
      <p className="sp-empty-title">No camera selected</p>
      <p className="sp-empty-sub">
        Go to <strong>Manage Camera Groups</strong>, select a camera, then click <strong>Stream Profiles</strong> to view and configure ONVIF streams.
      </p>
    </div>
  );
}

/* ── Configure Encoder Modal ─────────────────────────────── */
function ConfigureEncoderModal({ camera, profile, onClose, onSaved }) {
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [codec,          setCodec]          = useState(profile.encoding || "H264");
  const [resolution,     setResolution]     = useState(profile.resolution || "1920x1080");
  const [fps,            setFps]            = useState(profile.fps || 15);
  const [bitrateType,    setBitrateType]    = useState(profile.bitrate_type || "CBR");
  const [bitrateMode,    setBitrateMode]    = useState("Customized");
  const [bitrate,        setBitrate]        = useState(profile.bitrate || 2048);
  const [iframeInterval, setIframeInterval] = useState(profile.iframe_interval || 25);

  const handleSave = (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const finalBitrate = bitrateMode === "Customized" ? parseInt(bitrate) : parseInt(bitrateMode);
    const cameraKey = camera.ip || String(camera.id);
    try {
      saveOverride(cameraKey, profile.token, {
        encoding: codec, resolution,
        fps: parseInt(fps),
        bitrate: finalBitrate,
        bitrate_type: bitrateType,
        iframe_interval: parseInt(iframeInterval),
      });
      onSaved();
    } catch {
      setError("Failed to save configuration parameters.");
    } finally {
      setLoading(false);
    }
  };

  const handleFpsChange = (e) => {
    const newFps = parseInt(e.target.value);
    setFps(newFps);
    setIframeInterval(newFps * 2);
    
    let recBitrate = 2048;
    if (newFps <= 5) recBitrate = 1024;
    else if (newFps <= 10) recBitrate = 1536;
    else if (newFps <= 15) recBitrate = 2048;
    else if (newFps <= 20) recBitrate = 3072;
    else recBitrate = 4096;
    
    setBitrate(recBitrate);
    setBitrateMode("Customized");
  };

  const resolutions = ["3840x2160","2560x1440","1920x1080","1280x720","704x576","352x288"];
  const fpsOptions  = [5, 10, 15, 20, 25, 30];

  return (
    <div className="cem-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cem-modal">
        {/* Header */}
        <div className="cem-header">
          <div className="cem-header-left">
            <div className="cem-header-icon"><GearIcon size={16} color="#3b82f6" /></div>
            <div>
              <div className="cem-header-title">Configure Stream Encoder</div>
              <div className="cem-header-sub">VMS display layer settings only</div>
            </div>
          </div>
          <button className="cem-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSave}>
          <div className="cem-body">
            {error && <div className="cem-error">{error}</div>}

            {/* Profile info pill */}
            <div className="cem-profile-pill">
              <span className="cem-profile-pill-label">Profile</span>
              <span className="cem-profile-pill-value">{profile.name}</span>
              <span className="cem-profile-pill-token">{profile.token}</span>
            </div>

            {/* 2-col grid */}
            <div className="cem-grid">
              <div className="cem-field">
                <label className="cem-label">Codec</label>
                <select className="cem-select" value={codec} onChange={e => setCodec(e.target.value)}>
                  <option value="H.264">H.264 — AVC</option>
                  <option value="H.265">H.265 — HEVC</option>
                  <option value="MJPEG">MJPEG</option>
                </select>
              </div>
              <div className="cem-field">
                <label className="cem-label">Resolution</label>
                <select className="cem-select" value={resolution} onChange={e => setResolution(e.target.value)}>
                  {resolutions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="cem-field">
                <label className="cem-label">Frame Rate</label>
                <select className="cem-select" value={fps} onChange={handleFpsChange}>
                  {fpsOptions.map(v => <option key={v} value={v}>{v} fps</option>)}
                </select>
              </div>
              <div className="cem-field">
                <label className="cem-label">Bitrate Type</label>
                <select className="cem-select" value={bitrateType} onChange={e => setBitrateType(e.target.value)}>
                  <option value="CBR">CBR — Constant</option>
                  <option value="VBR">VBR — Variable</option>
                </select>
              </div>
            </div>

            {/* Bitrate full-width */}
            <div className="cem-field" style={{ marginTop: 4 }}>
              <div className="cem-label-row">
                <label className="cem-label">Bitrate (Kb/s)</label>
                <span className="cem-live-val">{bitrateMode === "Customized" ? `${bitrate}` : bitrateMode} kbps</span>
              </div>
              <select className="cem-select" value={bitrateMode} onChange={e => setBitrateMode(e.target.value)}>
                <option value="Customized">Customized</option>
                <option value="256">256 kbps</option>
                <option value="512">512 kbps</option>
                <option value="1024">1 Mbps (1024)</option>
                <option value="2048">2 Mbps (2048)</option>
                <option value="4096">4 Mbps (4096)</option>
                <option value="8192">8 Mbps (8192)</option>
              </select>
              {bitrateMode === "Customized" && (
                <input className="cem-input" type="number" style={{ marginTop: 8 }}
                  value={bitrate} min={128} max={16384}
                  onChange={e => setBitrate(e.target.value)}
                  placeholder="Enter custom bitrate (kbps)"
                />
              )}
            </div>

            {/* I-Frame interval */}
            <div className="cem-field" style={{ marginTop: 4 }}>
              <div className="cem-label-row">
                <label className="cem-label">I-Frame Interval</label>
                <span className="cem-live-val">{iframeInterval} frames</span>
              </div>
              <input className="cem-input" type="number" value={iframeInterval} min={2} max={150}
                onChange={e => setIframeInterval(e.target.value)} />
            </div>

            {/* Notice */}
            <div className="cem-notice">
              <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0, marginTop: 1 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span><strong>VMS Override Only</strong> — These settings configure the VMS display layer and do not alter physical encoder hardware on the camera.</span>
            </div>
          </div>

          {/* Footer */}
          <div className="cem-footer">
            <button type="button" className="cem-btn cem-btn-cancel" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="cem-btn cem-btn-save" disabled={loading}>
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="sp-spinner" />Saving…
                </span>
              ) : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────── */
export default function StreamProfilesPage() {
  const [camera,         setCamera]         = useState(null);
  const [profiles,       setProfiles]       = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);
  const [recIdx,         setRecIdx]         = useState(null);
  const [applying,       setApplying]       = useState(false);
  const [applyResult,    setApplyResult]    = useState(null);
  const [editingProfile, setEditingProfile] = useState(null);

  const selectedIp = localStorage.getItem("miradorai_selected_camera_ip") || null;
  const selectedId = localStorage.getItem("miradorai_selected_camera_id") || null;

  function applyDeviceData(data) {
    setCamera(data);
    const cameraKey = data.ip || String(data.id);
    const overrides = loadOverrides();
    const cameraOverrides = overrides[cameraKey] || {};
    let profs = (data.stream_profiles || []).map(p =>
      cameraOverrides[p.token] ? { ...p, ...cameraOverrides[p.token] } : p
    );

    // If no ONVIF profiles exist but we have an RTSP URL (e.g., manually added camera),
    // construct a synthetic profile so the user can still proceed.
    if (profs.length === 0 && data.rtsp_url) {
      profs = [{
        name: "Manual RTSP Stream",
        token: "manual_rtsp",
        label: "MAIN",
        rtsp_url: data.rtsp_url,
        encoding: data.live_codec || "Unknown",
        resolution: data.resolution || "Unknown",
        fps: data.fps || null,
        bitrate: data.bitrate || null,
      }];
    }

    setProfiles(profs);
    if (!profs.length) { setLoading(false); return; }
    const savedRec = data.active_rec_profile || data.active_rec_token || null;
    setRecIdx(resolveIdx(profs, savedRec, ["SUB", "EXTRA"], profs.length > 1 ? 1 : 0));
    setLoading(false);
  }

  const loadCameraData = () => {
    if (!selectedIp && !selectedId) return;
    setLoading(true);
    setError(null);
    setCamera(null);
    setProfiles([]);
    setRecIdx(null);
    setApplyResult(null);

    function fallbackToLocalStorage() {
      const devs = loadDevicesFromStorage();
      const dev = selectedIp
        ? devs.find((d) => d.ip === selectedIp)
        : devs.find((d) => String(d.id) === String(selectedId));
      if (dev) applyDeviceData(dev);
      else { setError("Camera not found. Make sure the backend is running."); setLoading(false); }
    }

    if (selectedIp) {
      fetch(apiUrl(`/cameras/by-ip/${encodeURIComponent(selectedIp)}`))
        .then((r) => { if (!r.ok) throw new Error("not found"); return r.json(); })
        .then(applyDeviceData)
        .catch(fallbackToLocalStorage);
    } else {
      fallbackToLocalStorage();
    }
  };

  useEffect(() => { loadCameraData(); }, []);

  const handleEncoderSaved = () => {
    setEditingProfile(null);
    setApplyResult({ ok: true, msg: "Encoder settings saved locally. Profiles updated." });
    loadCameraData();
    setTimeout(() => setApplyResult(null), 5000);
  };

  const handleApply = async () => {
    if (recIdx === null) return;
    const recProfile  = profiles[recIdx];
    // const liveProfile = recProfile;
    // if (!liveProfile?.rtsp_url || !recProfile?.rtsp_url) {
    // Do NOT overwrite the Live View profile with the recording profile.
    // Preserve the camera's existing live stream settings.
    const liveRtsp = camera.rtsp_url || recProfile?.rtsp_url;
    const liveProfileName = camera.active_live_profile || recProfile?.name;
    const liveCodec = camera.live_codec || recProfile?.encoding || "H.264";

    if (!liveRtsp || !recProfile?.rtsp_url) {
      setApplyResult({ ok: false, msg: "Selected profile(s) have no RTSP URL." });
      setTimeout(() => setApplyResult(null), 4000);
      return;
    }
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await fetch(apiUrl('/streams/assign'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip: camera.ip, port: camera.port || getNumber("CAMERA_DEFAULT_PORT"),
          username: camera.username || "",
          manufacturer: camera.manufacturer || "",
          model: camera.model || "",
          mac: camera.mac || "—",
          device_name: camera.device_name || camera.name || "",
          live_rtsp: liveRtsp,

          recording_rtsp: recProfile.rtsp_url,
          live_profile: liveProfileName,

          recording_profile: recProfile.name,
          live_codec: liveCodec,

          resolution: recProfile.resolution,
          fps: recProfile.fps,
          bitrate: recProfile.bitrate,
          bitrate_type: recProfile.bitrate_type,
        }),
      });
      let data = null;
      try { data = await res.json(); } catch {}
      if (data?.success === true) {
        setApplyResult({ ok: true, msg: `Applied — ${recProfile.name} (${recProfile.resolution || "?"})` });
        const devs = loadDevicesFromStorage();
        const idx = devs.findIndex((d) => d.ip === camera.ip);
        if (idx !== -1) {
          if (data.ws_url)     devs[idx].ws_url     = data.ws_url;
          if (data.stream_key) devs[idx].stream_key = data.stream_key;
          devs[idx].active_live_profile = liveProfileName;

          devs[idx].active_rec_profile  = recProfile.name;
          devs[idx].stream_profiles = profiles;
          localStorage.setItem("miradorai_devices", JSON.stringify(devs));
          window.dispatchEvent(new Event("storage"));
        }
        setCamera((prev) => ({ ...prev, active_live_profile: liveProfileName, active_rec_profile: recProfile.name, stream_profiles: profiles }));

      } else {
        setApplyResult({ ok: false, msg: data?.error || `Server returned HTTP ${res.status}` });
      }
    } catch (e) {
      setApplyResult({ ok: false, msg: `Network error: ${e.message}` });
    } finally {
      setApplying(false);
      setTimeout(() => setApplyResult(null), 6000);
    }
  };

  const recProfile = recIdx !== null ? profiles[recIdx] : null;
  const canApply   = !!(camera && recIdx !== null && !applying);

  return (
    <div className="page-shell">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Stream <span>Profiles</span></h1>
          <p className="page-desc">
            {camera
              ? `ONVIF stream profiles for ${[camera.manufacturer, camera.model].filter(Boolean).join(" ") || camera.ip} · ${camera.ip}`
              : "Select a camera from Manage Camera Groups to view its stream profiles."}
          </p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="sp-loading">
          <div className="sp-spinner" />
          Fetching stream profiles…
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="sp-error-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          {error}
        </div>
      )}

      {/* No camera */}
      {!selectedIp && !selectedId && !loading && <NoCameraState />}

      {/* Main card */}
      {!loading && camera && (
        <ONVIFProfilesCard
          camera={camera}
          profiles={profiles}
          recIdx={recIdx}
          onSelectRec={setRecIdx}
          onEdit={setEditingProfile}
          applying={applying}
          canApply={canApply}
          applyResult={applyResult}
          onApply={handleApply}
        />
      )}

      {/* No profiles */}
      {!loading && camera && profiles.length === 0 && (
        <div className="sp-no-profiles">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22">
            <circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 12v4"/>
          </svg>
          No ONVIF stream profiles found. Re-probe this camera via
          <strong> Add Devices → Manual Search</strong> to discover streams.
        </div>
      )}

      {/* Encoder modal */}
      {editingProfile && (
        <ConfigureEncoderModal
          camera={camera}
          profile={editingProfile}
          onClose={() => setEditingProfile(null)}
          onSaved={handleEncoderSaved}
        />
      )}
    </div>
  );
}