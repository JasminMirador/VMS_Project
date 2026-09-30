import React, { useState, useRef, useCallback, useEffect } from "react";
import "./PTZControls.css";

const API = import.meta.env.VITE_API_URL || "";

function getAuthHeaders() {
  const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
  return token ? { Authorization: "Bearer " + token } : {};
}

// ─────────────────────────────────────────────────
// PTZ API helpers
// ─────────────────────────────────────────────────
async function apiPTZMove(camera, pan, tilt, zoom) {
  try {
    await fetch(`${API}/api/onvif/ptz/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        ip:       camera.ip || camera.address || "",
        port:     camera.port || 80,
        username: camera.username || "admin",
        password: camera.password || "",
        pan, tilt, zoom,
      }),
    });
  } catch (err) {
    console.error("[PTZ] move error:", err);
  }
}

async function apiPTZHome(camera) {
  try {
    await fetch(`${API}/api/camera/ptz/home`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        ip:       camera.ip || camera.address || "",
        port:     camera.port || 80,
        username: camera.username || "admin",
        password: camera.password || "",
      }),
    });
  } catch (err) {
    // fallback: send a stop move
    await apiPTZMove(camera, 0, 0, 0);
  }
}

async function apiGotoPreset(camera, presetToken) {
  try {
    await fetch(`${API}/api/camera/ptz/preset/goto`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        ip:           camera.ip || camera.address || "",
        port:         camera.port || 80,
        username:     camera.username || "admin",
        password:     camera.password || "",
        preset_token: presetToken,
      }),
    });
  } catch (err) {
    console.error("[PTZ] goto preset error:", err);
  }
}

async function apiSavePreset(camera, presetName) {
  try {
    const res = await fetch(`${API}/api/camera/ptz/preset/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        ip:          camera.ip || camera.address || "",
        port:        camera.port || 80,
        username:    camera.username || "admin",
        password:    camera.password || "",
        preset_name: presetName,
      }),
    });
    return await res.json();
  } catch (err) {
    console.error("[PTZ] save preset error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────
// Local preset storage helpers
// ─────────────────────────────────────────────────
function getPresetKey(camera) {
  return `miradorai_presets_${camera.id || camera.ip}`;
}
function loadLocalPresets(camera) {
  try {
    const raw = localStorage.getItem(getPresetKey(camera));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveLocalPresets(camera, presets) {
  try {
    localStorage.setItem(getPresetKey(camera), JSON.stringify(presets));
  } catch {}
}

// ─────────────────────────────────────────────────
// Direction SVG icons
// ─────────────────────────────────────────────────
const Icons = {
  UpLeft:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><path d="M7 17L17 7M7 7h10v10"/></svg>,
  Up:        () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><path d="M12 19V5M5 12l7-7 7 7"/></svg>,
  UpRight:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><path d="M17 17L7 7M17 7H7v10"/></svg>,
  Left:      () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>,
  Home:      () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  Right:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><path d="M5 12h14M12 5l7 7-7 7"/></svg>,
  DownLeft:  () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><path d="M17 7L7 17M7 17h10V7"/></svg>,
  Down:      () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>,
  DownRight: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><path d="M7 7l10 10M17 17V7H7"/></svg>,
  ZoomIn:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/></svg>,
  ZoomOut:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35M8 11h6"/></svg>,
  Preset:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>,
  Add:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>,
  Trash:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>,
  Close:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><path d="M18 6L6 18M6 6l12 12"/></svg>,
};

// ─────────────────────────────────────────────────
// Main PTZControls component
// ─────────────────────────────────────────────────
export default function PTZControls({ camera, onClose }) {
  const [speed,       setSpeed]       = useState(50);
  const [zoom,        setZoom]        = useState(0);
  const [activeDir,   setActiveDir]   = useState(null);
  const [status,      setStatus]      = useState("");
  const [presets,     setPresets]     = useState(() => loadLocalPresets(camera));
  const [presetInput, setPresetInput] = useState("");
  const [addingPreset, setAddingPreset] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [tab,         setTab]         = useState("joystick"); // "joystick" | "presets"

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const intervalRef = useRef(null);

  const handleMouseDown = (e) => {
    if (e.target.closest('.ptz2-close-btn')) return;
    e.preventDefault(); // Stop native drag/selection
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e) => {
      setPosition({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    };
    const handleMouseUp = () => {
      setIsDragging(false);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Save presets locally whenever they change
  useEffect(() => {
    if (camera) saveLocalPresets(camera, presets);
  }, [presets, camera]);

  // Reload presets when camera changes
  useEffect(() => {
    if (camera) setPresets(loadLocalPresets(camera));
  }, [camera?.id, camera?.ip]);

  const getSpeedFactor = () => Math.max(0.1, speed / 100);

  const doPTZMove = useCallback((dir) => {
    if (!camera) return;
    const s = getSpeedFactor();
    const DIRS = {
      up:         { pan: 0,    tilt: s,   zoom: 0 },
      down:       { pan: 0,    tilt: -s,  zoom: 0 },
      left:       { pan: -s,   tilt: 0,   zoom: 0 },
      right:      { pan: s,    tilt: 0,   zoom: 0 },
      "up-left":  { pan: -s,   tilt: s,   zoom: 0 },
      "up-right": { pan: s,    tilt: s,   zoom: 0 },
      "down-left":{ pan: -s,   tilt: -s,  zoom: 0 },
      "down-right":{ pan: s,   tilt: -s,  zoom: 0 },
      "zoom-in":  { pan: 0,    tilt: 0,   zoom: s * 0.5 },
      "zoom-out": { pan: 0,    tilt: 0,   zoom: -s * 0.5 },
    };
    const vec = DIRS[dir];
    if (vec) apiPTZMove(camera, vec.pan, vec.tilt, vec.zoom);
  }, [camera, speed]);

  const startMove = useCallback((dir) => {
    if (!camera) return;
    setActiveDir(dir);
    doPTZMove(dir);
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => doPTZMove(dir), 180);
  }, [camera, doPTZMove]);

  const stopMove = useCallback(() => {
    setActiveDir(null);
    clearInterval(intervalRef.current);
    if (camera) apiPTZMove(camera, 0, 0, 0);
  }, [camera]);

  useEffect(() => () => clearInterval(intervalRef.current), []);

  const handleHome = async () => {
    if (!camera) return;
    setStatus("Going home…");
    await apiPTZHome(camera);
    setZoom(0);
    setTimeout(() => setStatus(""), 1500);
  };

  const handleZoomChange = (e) => {
    const val = Number(e.target.value);
    setZoom(val);
    const normalizedZoom = val / 100;
    if (camera) apiPTZMove(camera, 0, 0, normalizedZoom > 0 ? normalizedZoom * 0.5 : normalizedZoom * 0.5);
  };

  const handleSavePreset = async () => {
    if (!presetInput.trim() || !camera) return;
    setSavingPreset(true);
    setStatus("Saving preset…");
    const result = await apiSavePreset(camera, presetInput.trim());
    const token = result?.token || result?.preset_token || String(Date.now());
    const newPreset = { id: Date.now(), name: presetInput.trim(), token };
    setPresets(p => [...p, newPreset]);
    setPresetInput("");
    setAddingPreset(false);
    setSavingPreset(false);
    setStatus("Preset saved!");
    setTimeout(() => setStatus(""), 2000);
  };

  const handleGotoPreset = async (preset) => {
    if (!camera) return;
    setStatus(`Going to "${preset.name}"…`);
    await apiGotoPreset(camera, preset.token);
    setTimeout(() => setStatus(""), 2000);
  };

  const handleDeletePreset = (id) => {
    setPresets(p => p.filter(x => x.id !== id));
  };

  function JoyBtn({ dir, children, title }) {
    const isActive = activeDir === dir;
    return (
      <button
        className={`ptz2-joy-btn ${isActive ? "ptz2-joy-btn--active" : ""}`}
        onMouseDown={() => startMove(dir)}
        onMouseUp={stopMove}
        onMouseLeave={() => { if (activeDir === dir) stopMove(); }}
        onTouchStart={(e) => { e.preventDefault(); startMove(dir); }}
        onTouchEnd={stopMove}
        title={title}
        type="button"
        disabled={!camera}
      >
        {children}
      </button>
    );
  }

  if (!camera) return null;

  return (
    <div 
      className="ptz2-panel" 
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      style={{ 
        transform: `translate(${position.x}px, ${position.y}px)`,
        bottom: '20px',
        left: '20px'
      }}
    >
      {/* Header */}
      <div 
        className="ptz2-header"
        onMouseDown={handleMouseDown}
        style={{ cursor: isDragging ? "grabbing" : "grab" }}
      >
        <div className="ptz2-header-left">
          <span className="ptz2-icon-dot" />
          <span className="ptz2-title">PTZ Control</span>
          <span className="ptz2-cam-name">{camera.name || camera.ip}</span>
        </div>
        <button 
          className="ptz2-close-btn" 
          onClick={onClose} 
          title="Close PTZ" 
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Icons.Close />
        </button>
      </div>

      {/* Tab bar */}
      <div className="ptz2-tabs">
        <button
          className={`ptz2-tab ${tab === "joystick" ? "ptz2-tab--active" : ""}`}
          onClick={() => setTab("joystick")}
          type="button"
        >
          Joystick
        </button>
        <button
          className={`ptz2-tab ${tab === "presets" ? "ptz2-tab--active" : ""}`}
          onClick={() => setTab("presets")}
          type="button"
        >
          Presets
          {presets.length > 0 && <span className="ptz2-preset-count">{presets.length}</span>}
        </button>
      </div>

      {/* Status bar */}
      {status && <div className="ptz2-status">{status}</div>}

      {tab === "joystick" && (
        <div className="ptz2-body">
          {/* 3×3 Joystick grid */}
          <div className="ptz2-joystick">
            <JoyBtn dir="up-left"    title="Up-Left">   <Icons.UpLeft /></JoyBtn>
            <JoyBtn dir="up"         title="Up">        <Icons.Up /></JoyBtn>
            <JoyBtn dir="up-right"   title="Up-Right">  <Icons.UpRight /></JoyBtn>
            <JoyBtn dir="left"       title="Left">      <Icons.Left /></JoyBtn>

            {/* Home center button */}
            <button
              className="ptz2-home-btn"
              onClick={handleHome}
              title="Go Home"
              type="button"
              disabled={!camera}
            >
              <Icons.Home />
            </button>

            <JoyBtn dir="right"      title="Right">     <Icons.Right /></JoyBtn>
            <JoyBtn dir="down-left"  title="Down-Left"> <Icons.DownLeft /></JoyBtn>
            <JoyBtn dir="down"       title="Down">      <Icons.Down /></JoyBtn>
            <JoyBtn dir="down-right" title="Down-Right"><Icons.DownRight /></JoyBtn>
          </div>

        </div>
      )}

      {tab === "presets" && (
        <div className="ptz2-body ptz2-presets-body">
          {presets.length === 0 ? (
            <div className="ptz2-presets-empty">
              <Icons.Preset />
              <span>No presets saved yet</span>
            </div>
          ) : (
            <div className="ptz2-presets-list">
              {presets.map((p) => (
                <div key={p.id} className="ptz2-preset-row">
                  <button
                    className="ptz2-preset-goto"
                    onClick={() => handleGotoPreset(p)}
                    title={`Go to: ${p.name}`}
                    type="button"
                    disabled={!camera}
                  >
                    <Icons.Preset />
                    <span>{p.name}</span>
                  </button>
                  <button
                    className="ptz2-preset-del"
                    onClick={() => handleDeletePreset(p.id)}
                    title="Remove preset"
                    type="button"
                  >
                    <Icons.Trash />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add preset form */}
          {addingPreset ? (
            <div className="ptz2-add-preset-form">
              <input
                className="ptz2-preset-input"
                placeholder="Preset name…"
                value={presetInput}
                onChange={(e) => setPresetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSavePreset();
                  if (e.key === "Escape") { setAddingPreset(false); setPresetInput(""); }
                }}
                autoFocus
                maxLength={32}
              />
              <div className="ptz2-add-preset-actions">
                <button
                  className="ptz2-btn-save"
                  onClick={handleSavePreset}
                  disabled={!presetInput.trim() || savingPreset}
                  type="button"
                >
                  {savingPreset ? "Saving…" : "Save"}
                </button>
                <button
                  className="ptz2-btn-cancel"
                  onClick={() => { setAddingPreset(false); setPresetInput(""); }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="ptz2-add-btn"
              onClick={() => setAddingPreset(true)}
              type="button"
              disabled={!camera}
            >
              <Icons.Add />
              Save Current Position as Preset
            </button>
          )}
        </div>
      )}
    </div>
  );
}