import { useState, useEffect, useRef } from "react";

const API_BASE = import.meta.env.VITE_API_URL;

const css = `
  .msm-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(6,8,14,0.82);
    backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    animation: fadeIn .18s ease;
  }
  @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }

  .msm-card {
    font-family: var(--font-ui);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    width: 480px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    animation: slideUp .22s cubic-bezier(.22,1,.36,1);
    overflow: hidden;
  }
  @keyframes slideUp { from { transform:translateY(24px); opacity:0 } to { transform:translateY(0); opacity:1 } }

  .msm-header {
    padding: 22px 24px 18px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: flex-start; justify-content: space-between;
    flex-shrink: 0;
  }
  .msm-eyebrow {
    font-size: 13px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--teal); font-weight: 600; margin-bottom: 4px;
  }
  .msm-title {
    font-size: var(--font-size-subheading); font-weight: 700; color: var(--text-primary); margin: 0;
  }
  .msm-close {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); padding: 2px; transition: color var(--transition);
  }
  .msm-close:hover { color: var(--teal); }

  .msm-body {
    padding: 24px;
    display: flex; flex-direction: column; gap: 16px;
    overflow-y: auto;
    flex: 1;
  }

  .msm-body::-webkit-scrollbar { width: 6px; }
  .msm-body::-webkit-scrollbar-track { background: transparent; }
  .msm-body::-webkit-scrollbar-thumb { background: var(--border-light); border-radius: 3px; }
  .msm-body::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

  .msm-row { display: flex; gap: 12px; }
  .msm-field { display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .msm-field--port { flex: 0 0 160px; }

  .msm-label {
    font-size: 13px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--text-secondary); font-weight: 600;
  }
  .msm-input {
    background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-primary); font-family: inherit; font-size: var(--font-size-content);
    padding: 10px 13px; outline: none;
    transition: border-color var(--transition), box-shadow var(--transition);
    width: 100%; box-sizing: border-box;
  }
  .msm-input::placeholder { color: var(--text-muted); }
  .msm-input:focus { border-color: var(--teal); box-shadow: 0 0 0 3px var(--teal-glow); }
  .msm-input.error { border-color: var(--red); box-shadow: 0 0 0 3px rgba(239,68,68,.15); }

  .msm-custom-select { position: relative; width: 100%; }
  .msm-select-btn {
    background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-primary); font-family: inherit; font-size: var(--font-size-content);
    padding: 10px 13px; outline: none; width: 100%; text-align: left;
    display: flex; justify-content: space-between; align-items: center;
    cursor: pointer; transition: border-color var(--transition), box-shadow var(--transition);
  }
  .msm-select-btn:focus { border-color: var(--teal); box-shadow: 0 0 0 3px var(--teal-glow); }
  .msm-dropdown-menu {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg); z-index: 999;
    padding: 6px; list-style: none; margin: 0;
    max-height: 200px; overflow-y: auto;
  }
  .msm-dropdown-menu::-webkit-scrollbar { width: 6px; }
  .msm-dropdown-menu::-webkit-scrollbar-track { background: transparent; }
  .msm-dropdown-menu::-webkit-scrollbar-thumb { background: var(--border-light); border-radius: 3px; }
  .msm-dropdown-menu::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  .msm-dropdown-item {
    padding: 8px 12px; color: var(--text-secondary); font-size: var(--font-size-content); cursor: pointer;
    border-radius: 4px; display: flex; align-items: center; transition: all var(--transition);
  }
  .msm-dropdown-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .msm-dropdown-item.active { background: var(--teal-subtle); color: var(--teal); font-weight: 500; }

  .msm-password-wrapper {
    position: relative;
  }
  .msm-password-input {
    padding-right: 40px;
  }
  .msm-eye-btn {
    position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); padding: 2px; transition: color var(--transition);
  }
  .msm-eye-btn:hover { color: var(--teal); }

  .msm-divider {
    display: flex; align-items: center; gap: 10px;
    color: var(--text-muted); font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
  }
  .msm-divider::before, .msm-divider::after {
    content: ''; flex: 1; height: 1px; background: var(--border);
  }

  .msm-probe {
    background: var(--bg-base); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 12px 14px;
    display: flex; align-items: center; gap: 10px;
    font-size: var(--font-size-content); color: var(--text-secondary); min-height: 44px;
  }
  .msm-probe.probing { color: var(--teal); border-color: var(--teal); }
  .msm-probe.success { color: var(--teal); border-color: var(--teal); background: var(--teal-subtle); }
  .msm-probe.fail    { color: var(--red); border-color: var(--red); background: rgba(239, 68, 68, 0.05); }

  .msm-spinner {
    width: 14px; height: 14px; border: 2px solid var(--border-light);
    border-top-color: var(--teal); border-radius: 50%;
    animation: spin .7s linear infinite; flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg) } }

  .msm-probe-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: currentColor; }

  .msm-info-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    background: var(--bg-base); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 12px 14px;
  }
  .msm-info-item { display: flex; flex-direction: column; gap: 2px; }
  .msm-info-key  { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); }
  .msm-info-val  { font-size: var(--font-size-content); color: var(--text-primary); }
  .msm-info-val--highlight { color: var(--teal); font-weight: 600; }

  .msm-profiles { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; display: flex; flex-direction: column; }
  .msm-profiles-scroll {
    max-height: 180px;
    overflow-y: auto;
  }
  .msm-profiles-scroll::-webkit-scrollbar { width: 6px; }
  .msm-profiles-scroll::-webkit-scrollbar-track { background: transparent; }
  .msm-profiles-scroll::-webkit-scrollbar-thumb { background: var(--border-light); border-radius: 3px; }
  .msm-profiles-scroll::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  .msm-profiles-header {
    background: var(--bg-elevated); padding: 7px 12px;
    font-size: 12px; letter-spacing: .12em; text-transform: uppercase;
    color: var(--text-muted); border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
  }
  .msm-profiles-badge {
    background: var(--teal-subtle); color: var(--teal);
    border: 1px solid var(--teal-glow); border-radius: 4px;
    padding: 2px 7px; font-size: 13px; font-weight: 600; letter-spacing: .05em;
  }
  .msm-profile-row {
    background: var(--bg-base); padding: 9px 12px;
    display: grid; grid-template-columns: 1fr 80px 55px 58px;
    gap: 8px; align-items: center;
    border-bottom: 1px solid var(--border); font-size: 14px;
  }
  .msm-profile-row:last-child { border-bottom: none; }
  .msm-profile-name { color: var(--text-primary); font-weight: 600; }
  .msm-profile-res  { color: var(--text-secondary); font-size: 13px; margin-top: 2px; }
  .msm-profile-meta { color: var(--text-secondary); font-size: 13px; }
  .msm-profile-tag {
    font-size: 12px; padding: 2px 6px; border-radius: 4px;
    text-align: center; font-weight: 600;
    letter-spacing: .04em; text-transform: uppercase;
  }
  .msm-profile-tag--main  { background: var(--teal-subtle); color: var(--teal); border: 1px solid var(--teal-glow); }
  .msm-profile-tag--sub   { background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.2); }
  .msm-profile-tag--extra { background: rgba(255, 255, 255, 0.05); color: var(--text-secondary); border: 1px solid var(--border-light); }

  .msm-routing-hint {
    background: var(--bg-base); border: 1px solid var(--border);
    border-left: 2px solid var(--teal);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    padding: 8px 12px; font-size: 14px;
    color: var(--text-secondary); line-height: 1.5;
  }
  .msm-routing-hint span { color: var(--teal); font-weight: 600; }

  .msm-footer {
    padding: 16px 24px 20px; border-top: 1px solid var(--border);
    display: flex; justify-content: flex-end; gap: 10px;
    flex-shrink: 0;
  }

  input[type="password"]::-ms-reveal,
  input[type="password"]::-ms-clear { display: none; }
  input[type="password"]::-webkit-credentials-auto-fill-button,
  input[type="password"]::-webkit-textfield-decoration-container { display: none !important; }
  input[type="password"]::-webkit-contacts-auto-fill-button { display: none !important; }

  .msm-btn {
    font-family: inherit; font-size: var(--font-size-content); font-weight: 600;
    padding: 9px 18px; border-radius: var(--radius-sm); cursor: pointer;
    border: 1px solid transparent; transition: all var(--transition);
  }
  .msm-btn--ghost  { background: transparent; border-color: var(--border-light); color: var(--text-primary); }
  .msm-btn--ghost:hover { border-color: var(--teal); color: var(--teal); }
  .msm-btn--probe  { background: var(--teal-subtle); border-color: var(--teal); color: var(--teal); }
  .msm-btn--probe:hover:not(:disabled) { background: var(--teal-glow); }
  .msm-btn--enroll { background: var(--teal); border-color: var(--teal); color: #fff; }
  .msm-btn--enroll:hover:not(:disabled) { background: var(--teal-dim); }
  .msm-btn:disabled { opacity: .35; cursor: not-allowed; }

  /* Channel picker */
  .msm-channels { display: flex; flex-direction: column; gap: 6px; }
  .msm-channel-header {
    font-size: 13px; letter-spacing: .12em; text-transform: uppercase;
    color: var(--text-muted); margin-bottom: 2px;
  }
  .msm-channel-row {
    display: flex; align-items: center; justify-content: space-between;
    background: var(--bg-base); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 10px 14px;
    cursor: pointer; transition: all var(--transition);
  }
  .msm-channel-row:hover { border-color: var(--teal); background: var(--bg-hover); }
  .msm-channel-row.selected { border-color: var(--teal); background: var(--teal-subtle); }
  .msm-channel-left { display: flex; align-items: center; gap: 10px; }
  .msm-channel-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--teal); flex-shrink: 0; }
  .msm-channel-name { color: var(--text-primary); font-size: var(--font-size-content); font-weight: 600; }
  .msm-channel-sub { color: var(--text-secondary); font-size: 13px; margin-top: 2px; }
  .msm-channel-check {
    width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid var(--teal); display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .msm-channel-check.filled { background: var(--teal); }
  .msm-channel-check svg { display: none; }
  .msm-channel-check.filled svg { display: block; }

  .msm-error-msg {
    color: var(--red);
    font-size: 12px;
    line-height: 1.35;
    margin-top: 0;
  }
  .msm-error-msg::before { content: '⚠ '; }

  .msm-ui-alert {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: var(--red);
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-content);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    animation: alertFadeIn 0.2s ease;
    margin-bottom: 4px;
  }
  @keyframes alertFadeIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .msm-ui-alert-icon {
    flex-shrink: 0; color: var(--red); margin-top: 1px;
  }
  .msm-ui-alert-text {
    flex: 1; line-height: 1.5;
  }
  .msm-ui-alert-close {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); font-size: 18px; line-height: 1; padding: 2px;
    transition: color var(--transition);
  }
  .msm-ui-alert-close:hover { color: var(--red); }
`;

const PROFILE_TAGS = ["main", "sub", "extra"];

function getRoutingHint(profiles) {
  if (!profiles || profiles.length === 0) return null;
  if (profiles.length === 1) {
    return (
      <>
        <span>Live, Record & Remote</span> will all share the single available stream.
      </>
    );
  }
  if (profiles.length === 2) {
    return (
      <>
        <span>Live + Record</span> → {profiles[0].name} ({profiles[0].resolution})
        &nbsp;·&nbsp;
        <span>Remote Access</span> → {profiles[1].name} ({profiles[1].resolution})
      </>
    );
  }
  return (
    <>
      <span>Record</span> → {profiles[0].name} &nbsp;·&nbsp;
      <span>Live</span> → {profiles[1].name} &nbsp;·&nbsp;
      <span>Remote</span> → {profiles[2].name}
    </>
  );
}

function validateIP(ip) {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split(".").every((n) => +n >= 0 && +n <= 255)
  );
}

export default function ManualSearchModal({
  onClose,
  onEnroll,
  groups,
  selectedGroupId,
  setSelectedGroupId
}) {
  // ✅ FIX 3 STEP 1: Added cameraName state
  const [cameraName, setCameraName] = useState("");
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("80");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rtspUrl, setRtspUrl] = useState("");
  const [urlLabel, setUrlLabel] = useState("");
  const [mode] = useState("onvif");
  const [probe, setProbe] = useState("idle");
  const [discovered, setDiscovered] = useState(null);
  const [detectedPort, setDetectedPort] = useState(null);
  const [errors, setErrors] = useState({});
  const [alertMsg, setAlertMsg] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName !== 'INPUT') return;
      const inputs = document.querySelectorAll('.msm-card input[tabindex]');
      const currentIndex = Array.from(inputs).findIndex(input => input === e.target);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % inputs.length;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + inputs.length) % inputs.length;
      } else {
        return;
      }
      e.preventDefault();
      inputs[nextIndex].focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const validate = () => {
    const e = {};
    if (!ip.trim()) e.ip = "Please enter the IP address.";
    else if (!validateIP(ip)) e.ip = "Invalid IP address";
    if (!user.trim()) e.user = "Please enter the username.";
    if (!pass.trim()) e.pass = "Please enter the password.";
    if (port && (isNaN(port) || +port < 1 || +port > 65535)) e.port = "1–65535";
    return e;
  };

  const validateDirectUrl = () => {
    const e = {};
    if (!rtspUrl.trim()) e.rtspUrl = "RTSP URL is required";
    else if (!rtspUrl.toLowerCase().startsWith("rtsp://")) e.rtspUrl = "URL must start with rtsp://";
    return e;
  };

  const handleProbe = async () => {
    const e = validate();
    if (Object.keys(e).length) {
      setAlertMsg("");
      setErrors(e);
      return;
    }
    setErrors({});
    setProbe("probing");
    setDiscovered(null);
    setSelectedChannels([]);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch(`${API_BASE}/api/onvif/probe`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": "Bearer " + (localStorage.getItem("miradorai_token") || "")
        },
        body: JSON.stringify({
          ip,
          port: port ? Number(port) : 80,
          username: user,
          password: pass,
          group_id: selectedGroupId,
          save_to_db: false 
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const json = await res.json();
      if (!res.ok) {
        setAlertMsg(json.detail || "Camera limit exceeded");
        setProbe("fail");
        setErrors({ ip: json.detail || "Camera limit exceeded" });
        return;
      }
      if (json.success) {
        setProbe("success");
        setDetectedPort(json.port || port);
        const allProfiles = json.all_profiles || json.profiles || [];
        setDiscovered({
          manufacturer: json.manufacturer,
          model: json.model,
          firmware: json.firmware,
          serial: json.serial,
          ptz: (json.ptz === "Yes" || json.ptz === true) ? "Yes" : "No",
          profiles: json.profiles || [],
          all_profiles: allProfiles,
          stream_count: json.stream_count ?? (json.profiles?.length || 0),
          ws_url: json.ws_url || null,
          rtsp_url: json.rtsp_url || null,
          stream_key: json.stream_key || json.stream_key || null,
        });
      } else {
        setProbe("fail");
        setDetectedPort(null);
      }
    } catch (error) {
      setProbe("fail");
      if (error.name === "AbortError") {
        setErrors({ ip: "Probe timeout — camera may be offline or not responding" });
      } else {
        setErrors({ ip: "Failed to connect to camera" });
      }
    }
  };

  const handleDirectUrl = async () => {
    const e = validateDirectUrl();
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setProbe("probing");
    setDiscovered(null);

    try {
      const res = await fetch(`${API_BASE}/api/streams/register-direct`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": "Bearer " + (localStorage.getItem("miradorai_token") || "")
        },
        body: JSON.stringify({ 
          rtsp_url: rtspUrl.trim(),
          device_name: cameraName || urlLabel || "Direct Stream",
          group_id: selectedGroupId || "default"
        }),
      });
      const json = await res.json();
      if (json.success) {
        setProbe("success");
        setDiscovered({
          manufacturer: "Manual Entry",
          model: urlLabel || "Direct Stream",
          firmware: "N/A",
          serial: json.ip || "N/A",
          ptz: "N/A",
          profiles: [],
          stream_count: 1,
          ws_url: json.ws_url || null,
          rtsp_url: rtspUrl.trim(),
          stream_key: json.stream_key || null,
        });
      } else {
        setProbe("fail");
        setErrors({ rtspUrl: json.error || "Failed to register stream" });
      }
    } catch (err) {
      setProbe("fail");
      setErrors({ rtspUrl: err.message });
    }
  };

  const handlePasswordKeyDown = (e) => {
    if (e.key === "Enter" && probe !== "probing") {
      mode === "onvif" ? handleProbe() : handleDirectUrl();
    }
  };

  const [selectedChannels, setSelectedChannels] = useState([]);

  // Group all_profiles by source (camera channel)
  const channelList = (() => {
    if (!discovered?.all_profiles?.length) return [];
    const map = {};
    for (const p of discovered.all_profiles) {
      // ✅ Safety check: skip profiles that are clearly empty/inactive
      const isPlaceholder = !p.resolution || p.resolution === "0x0" || !p.rtsp_url;
      if (isPlaceholder) continue;

      const src = p.source ?? 1;
      if (!map[src]) map[src] = { source: src, label: `Cam ${src}`, profiles: [] };
      map[src].profiles.push(p);
    }
    return Object.values(map).sort((a, b) => a.source - b.source);
  })();

  const handleEnroll = () => {
    // Use selectedChannels if available, else fallback to a default array with source=1
    const channelsToEnroll = selectedChannels.length > 0 
      ? selectedChannels 
      : [{ source: 1, profiles: discovered?.profiles || [] }];

    if (mode === "onvif") {
      const enrollPort = detectedPort || port || "80";
      onEnroll?.({
        cameraName,
        ip,
        group_id: selectedGroupId,
        port: enrollPort,
        user,
        pass,
        discovered,
        channels: channelsToEnroll
      });
    } else {
      onEnroll?.({
        cameraName,
        rtspUrl,
        group_id: selectedGroupId,
        label: urlLabel,
        discovered,
        stream_profiles: activeProfiles,
        stream_count: activeProfiles.length,
        ws_url: discovered?.ws_url || null,
        rtsp_url: discovered?.rtsp_url || rtspUrl,
        stream_key: discovered?.stream_key || null,
      });
    }
    onClose?.();
  };

  const infoFields = ["manufacturer", "model", "firmware", "serial", "ptz"];

  return (
    <>
      <style>{css}</style>

      <div className="msm-overlay">
        <div className="msm-card">

          {/* Header */}
          <div className="msm-header">
            <div>
              <div className="msm-eyebrow">ONVIF Discovery</div>
              <h2 className="msm-title">Manual Camera Search</h2>
            </div>
            <button className="msm-close" onClick={onClose} tabIndex={9}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="msm-body">
            {alertMsg && (
              <div className="msm-ui-alert">
                <svg className="msm-ui-alert-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div className="msm-ui-alert-text">{alertMsg}</div>
                <button className="msm-ui-alert-close" onClick={() => setAlertMsg("")}>✕</button>
              </div>
            )}

            {/* Camera Name */}
            <div className="msm-field">
              <label className="msm-label">
                CAMERA NAME <span style={{ textTransform: "none", opacity: 0.7 }}>(OPTIONAL)</span>
              </label>
              <input
                tabIndex={1}
                className="msm-input"
                placeholder="e.g. Front Gate Camera"
                value={cameraName}
                onChange={(e) => setCameraName(e.target.value)}
              />
            </div>

            {/* Group */}
            <div className="msm-field">
              <label className="msm-label">SELECT GROUP</label>
              <div className="msm-custom-select" ref={dropdownRef}>
                <button
                  type="button"
                  tabIndex={2}
                  className="msm-select-btn"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  <span>{selectedGroupId === "default" ? "Default" : groups?.find(g => g.id === selectedGroupId)?.name || "Default"}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 255, 255, 0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>
                {dropdownOpen && (
                  <ul className="msm-dropdown-menu">
                    <li
                      className={`msm-dropdown-item ${selectedGroupId === "default" ? "active" : ""}`}
                      onClick={() => { setSelectedGroupId("default"); setDropdownOpen(false); }}
                    >
                      Default
                    </li>
                    {groups?.map((g) => (
                      <li
                        key={g.id}
                        className={`msm-dropdown-item ${selectedGroupId === g.id ? "active" : ""}`}
                        onClick={() => { setSelectedGroupId(g.id); setDropdownOpen(false); }}
                      >
                        {g.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* IP + Port */}
            <div className="msm-row">
              <div className="msm-field">
                <label className="msm-label">IP Address <span style={{ color: "#f87171", marginLeft: "2px" }}>*</span></label>
                <input
                  tabIndex={2}
                  className={`msm-input ${errors.ip ? "error" : ""}`}
                  placeholder="192.168.1.64"
                  value={ip}
                  onChange={(e) => {
                    setIp(e.target.value);
                    setErrors((s) => ({ ...s, ip: "" }));
                    setProbe("idle");
                    setDiscovered(null);
                  }}
                />
                {errors.ip && <span className="msm-error-msg">{errors.ip}</span>}
              </div>
              <div className="msm-field msm-field--port">
                <label className="msm-label">
                  Port{" "}
                </label>
                <input
                  tabIndex={3}
                  className={`msm-input ${errors.port ? "error" : ""}`}
                  placeholder="80"
                  value={port}
                  onChange={(e) => { setPort(e.target.value); setErrors((s) => ({ ...s, port: "" })); }}
                  onBlur={() => { if (!port) setPort("80"); }}
                />
                {errors.port && <span className="msm-error-msg">{errors.port}</span>}
              </div>
            </div>

            {/* Credentials */}
            <div className="msm-divider">Credentials</div>
            <div className="msm-row">
              <div className="msm-field">
                <label className="msm-label">Username <span style={{ color: "#f87171", marginLeft: "2px" }}>*</span></label>
                <input
                  tabIndex={4}
                  className={`msm-input ${errors.user ? "error" : ""}`}
                  placeholder="admin"
                  value={user}
                  onChange={(e) => {
                    setUser(e.target.value);
                    setErrors((s) => ({ ...s, user: "" }));
                  }}
                />
                {errors.user && <span className="msm-error-msg">{errors.user}</span>}
              </div>
              <div className="msm-field">
                <label className="msm-label">Password <span style={{ color: "#f87171", marginLeft: "2px" }}>*</span></label>
                <div className="msm-password-wrapper">
                  <input
                    tabIndex={5}
                    className={`msm-input msm-password-input ${errors.pass ? "error" : ""}`}
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={pass}
                    onChange={(e) => {
                      setPass(e.target.value);
                      setErrors((s) => ({ ...s, pass: "" }));
                    }}
                    onKeyDown={handlePasswordKeyDown}
                  />
                  <button
                    type="button"
                    className="msm-eye-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    )}
                  </button>
                </div>
                {errors.pass && <span className="msm-error-msg">{errors.pass}</span>}
              </div>
            </div>

            {/* Probe status */}
            {probe === "idle" && (
              <div className="msm-probe">
                <div className="msm-probe-dot" style={{ background: "#2e3d55" }} />
                Enter IP address and port, then probe the device.
              </div>
            )}
            {probe === "probing" && (
              <div className="msm-probe probing">
                <div className="msm-spinner" />
                {`Probing ${ip}:${port} via ONVIF…`}
              </div>
            )}
            {probe === "fail" && (
              <div className="msm-probe fail">
                <div className="msm-probe-dot" />
                {errors.ip || `No ONVIF device found at ${ip}${port ? `:${port}` : ""}`}
              </div>
            )}

            {probe === "success" && discovered && (
              <>
                <div className="msm-probe success">
                  <div className="msm-probe-dot" />
                  ONVIF device discovered — {discovered.manufacturer} {discovered.model}
                  {detectedPort && !port && (
                    <span style={{ fontSize: "15px", color: "#60a5fa", marginLeft: "8px" }}>
                      on port {detectedPort}
                    </span>
                  )}
                </div>

                <div className="msm-info-grid">
                  {infoFields.map((k) => (
                    <div key={k} className="msm-info-item">
                      <span className="msm-info-key">{k}</span>
                      <span className="msm-info-val">{discovered[k]}</span>
                    </div>
                  ))}
                  <div className="msm-info-item">
                    <span className="msm-info-key">Streams available</span>
                    <span className="msm-info-val msm-info-val--highlight">
                      {discovered.stream_count}{" "}
                      {typeof discovered.stream_count === "number"
                        ? discovered.stream_count === 1 ? "stream" : "streams"
                        : ""}
                    </span>
                  </div>
                </div>

                {discovered.profiles?.length > 0 && (
                  <div className="msm-profiles">
                    <div className="msm-profiles-header">
                      Stream profiles
                      <span className="msm-profiles-badge">
                        {discovered.profiles.length} detected
                      </span>
                    </div>
                    <div className="msm-profiles-scroll">
                      {discovered.profiles.map((p, i) => (
                        <div key={i} className="msm-profile-row">
                          <div>
                            <div className="msm-profile-name">{p.name}</div>
                            <div className="msm-profile-res">{p.resolution}</div>
                          </div>
                          <div className="msm-profile-meta">{p.encoding}</div>
                          <div className="msm-profile-meta">
                            {p.fps ? `${p.fps} fps` : "—"}
                          </div>
                          <span className={`msm-profile-tag msm-profile-tag--${PROFILE_TAGS[i] ?? "extra"}`}>
                            {PROFILE_TAGS[i] ?? `Stream ${i + 1}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Camera Channel Picker — only shown on multi-channel devices */}
                {channelList.length > 1 && (
                  <div className="msm-channels">
                    <div className="msm-channel-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Select Cameras to Add</span>
                      <span 
                        style={{ cursor: 'pointer', color: 'var(--teal)' }}
                        onClick={() => {
                          if (selectedChannels.length === channelList.length) {
                            setSelectedChannels([]);
                          } else {
                            setSelectedChannels([...channelList]);
                          }
                        }}
                      >
                        {selectedChannels.length === channelList.length ? "Deselect All" : "Select All"}
                      </span>
                    </div>
                    {channelList.map((ch) => {
                      const isSelected = selectedChannels.some(sc => sc.source === ch.source);
                      return (
                        <div
                          key={ch.source}
                          className={`msm-channel-row ${isSelected ? "selected" : ""}`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedChannels(selectedChannels.filter(sc => sc.source !== ch.source));
                            } else {
                              setSelectedChannels([...selectedChannels, ch]);
                            }
                          }}
                        >
                          <div className="msm-channel-left">
                            <div className="msm-channel-dot" />
                            <div>
                              <div className="msm-channel-name">{ch.label}</div>
                              <div className="msm-channel-sub">{ch.profiles.length} stream{ch.profiles.length !== 1 ? "s" : ""} · {ch.profiles[0]?.resolution || "Unknown"}</div>
                            </div>
                          </div>
                          <div className={`msm-channel-check ${isSelected ? "filled" : ""}`}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {(channelList.length <= 1) && discovered.profiles?.length > 0 && (
                  <div className="msm-routing-hint">
                    {getRoutingHint(discovered.profiles)}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="msm-footer">
            <button tabIndex={6} className="msm-btn msm-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
            tabIndex={7}
            className="msm-btn msm-btn--probe"
            onClick={() => (mode === "onvif" ? handleProbe() : handleDirectUrl())}
              disabled={probe === "probing"}
            >
              {probe === "probing" ? "Probing…" : "Probe "}
            </button>
            <button
              tabIndex={8}
              className="msm-btn msm-btn--enroll"
              onClick={() => {
                if (probe !== "success") {
                  setAlertMsg("Please probe and verify the camera connection successfully before enrolling!");
                  return;
                }
                if (channelList.length > 1 && selectedChannels.length === 0) {
                  setAlertMsg("Please select at least one camera from the list below!");
                  return;
                }
                setAlertMsg("");
                handleEnroll();
              }}
            >
              {channelList.length > 1 && selectedChannels.length === 0 
                ? "Select a Camera" 
                : (channelList.length > 1 ? `Enroll ${selectedChannels.length} Cameras` : "Enroll Camera")}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}