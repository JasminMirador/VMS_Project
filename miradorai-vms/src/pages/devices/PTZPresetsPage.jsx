import { useState, useRef, useEffect, useCallback } from "react";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import WebRTCPlayer from "../../components/shared/WebRTCPlayer_MediaMTX";
import "./PTZPresetsPage.css";

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

const PTZ_API = import.meta.env.VITE_API_URL || "";

async function sendPTZMove(device, pan, tilt, zoom) {
  if (!device?.ip) return;
  try {
    await fetch(`${PTZ_API}/api/onvif/ptz/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ip:       device.ip,
        port:     80,
        username: device.username || "",
        password: device.password || "",
        pan:      parseFloat((pan  / 180).toFixed(3)),
        tilt:     parseFloat((tilt / 90).toFixed(3)),
        zoom:     parseFloat((zoom / 100).toFixed(3)),
      }),
    });
  } catch (err) {
    console.error("[PTZ] Move failed:", err);
  }
}

function loadPresetsForCamera(cameraId) {
  try {
    const saved = localStorage.getItem(`miradorai_presets_${cameraId}`);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function savePresetsForCamera(cameraId, presets) {
  try {
    localStorage.setItem(`miradorai_presets_${cameraId}`, JSON.stringify(presets));
  } catch {}
}

export default function PTZPresetsPage() {
  const [filter, setFilter]       = useState("");
  const [selected, setSelected]   = useState(() => localStorage.getItem("miradorai_selected_camera_id") || null);
  const [presets, setPresets]     = useState([]);
  const [selPreset, setSelPreset] = useState(null);
  const [speed, setSpeed]         = useState(50);
  const [pan, setPan]             = useState(0);
  const [tilt, setTilt]           = useState(0);
  const [zoom, setZoom]           = useState(0);
  const [focus, setFocus]         = useState(50);
  const [activeBtn, setActiveBtn] = useState(null);
  const [moving, setMoving]       = useState(false);
  const [ctxMenu, setCtxMenu]     = useState(null);
  const [ctxStep, setCtxStep]     = useState("menu");
  const [ctxName, setCtxName]     = useState("");

  const intervalRef  = useRef(null);
  const videoWrapRef = useRef(null);
  const ctxInputRef  = useRef(null);

  const panRef  = useRef(pan);
  const tiltRef = useRef(tilt);
  const zoomRef = useRef(zoom);
  useEffect(() => { panRef.current  = pan;  }, [pan]);
  useEffect(() => { tiltRef.current = tilt; }, [tilt]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const devices = loadDevices();
  const selectedDevice = devices.find((d) => String(d.id) === String(selected));
  const wsUrl = selectedDevice?.ws_url || null;

  useEffect(() => {
    if (selected) {
      const camPresets = loadPresetsForCamera(selected);
      setPresets(camPresets);
      setSelPreset(null);
    } else {
      setPresets([]);
      setSelPreset(null);
    }
    setPan(0); setTilt(0); setZoom(0); setFocus(50);
  }, [selected]);

  useEffect(() => {
    if (selected) savePresetsForCamera(selected, presets);
  }, [presets, selected]);

  // ── FIX: Only show the selected camera in this feature page ──
  const rows = devices
    .filter((d) => !selected || String(d.id) === String(selected))
    .map((d) => ({
      id: String(d.id),
      name: d.name,
      ip: d.ip || "—",
      manufacturer: d.manufacturer || "—",
      model: d.model || "—",
    }));

  const filteredRows = rows.filter((r) =>
    !filter ||
    [r.name, r.ip, r.manufacturer, r.model].some((c) =>
      c.toLowerCase().includes(filter.toLowerCase())
    )
  );

  const getStep = () => Math.max(1, Math.round(speed / 20));

  const move = useCallback((dir) => {
    const s = getStep();
    let nextPan  = panRef.current;
    let nextTilt = tiltRef.current;

    if (dir === "up")         { nextTilt = Math.min(90,   tiltRef.current + s); }
    if (dir === "down")       { nextTilt = Math.max(-90,  tiltRef.current - s); }
    if (dir === "left")       { nextPan  = Math.max(-180, panRef.current  - s); }
    if (dir === "right")      { nextPan  = Math.min(180,  panRef.current  + s); }
    if (dir === "up-left")    { nextTilt = Math.min(90,   tiltRef.current + s); nextPan = Math.max(-180, panRef.current - s); }
    if (dir === "up-right")   { nextTilt = Math.min(90,   tiltRef.current + s); nextPan = Math.min(180,  panRef.current + s); }
    if (dir === "down-left")  { nextTilt = Math.max(-90,  tiltRef.current - s); nextPan = Math.max(-180, panRef.current - s); }
    if (dir === "down-right") { nextTilt = Math.max(-90,  tiltRef.current - s); nextPan = Math.min(180,  panRef.current + s); }

    setPan(nextPan);
    setTilt(nextTilt);
    sendPTZMove(selectedDevice, nextPan, nextTilt, zoomRef.current);
  }, [selectedDevice, speed]);

  const startMove = useCallback((dir) => {
    if (!selected) return;
    setActiveBtn(dir);
    move(dir);
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => move(dir), 150);
  }, [selected, move]);

  const stopMove = useCallback(() => {
    setActiveBtn(null);
    clearInterval(intervalRef.current);
  }, []);

  useEffect(() => () => clearInterval(intervalRef.current), []);

  const handleHome = () => { setPan(0); setTilt(0); setZoom(0); setFocus(50); };

  const gotoPreset = (preset) => {
    setSelPreset(preset.id);
    setMoving(true);
    const startPan  = panRef.current;
    const startTilt = tiltRef.current;
    const startZoom = zoomRef.current;
    const duration  = 800;
    const startTime = Date.now();
    const animate = () => {
      const elapsed  = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = progress < 0.5
        ? 2 * progress * progress
        : -1 + (4 - 2 * progress) * progress;
      setPan(Math.round(startPan   + (preset.pan  - startPan)  * ease));
      setTilt(Math.round(startTilt + (preset.tilt - startTilt) * ease));
      setZoom(Math.round(startZoom + (preset.zoom - startZoom) * ease));
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setMoving(false);
        sendPTZMove(selectedDevice, preset.pan, preset.tilt, preset.zoom);
      }
    };
    requestAnimationFrame(animate);
  };

  const removePreset = () => {
    setPresets((p) => p.filter((x) => x.id !== selPreset));
    setSelPreset(null);
  };

  const handleVideoRightClick = (e) => {
    e.preventDefault();
    if (!selected || !wsUrl) return;
    const rect = videoWrapRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width)  * 100;
    const py = ((e.clientY - rect.top)  / rect.height) * 100;
    setCtxMenu({ screenX: e.clientX - rect.left, screenY: e.clientY - rect.top, videoX: px, videoY: py });
    setCtxStep("menu");
    setCtxName("");
  };

  const handleCtxAddPreset = () => {
    setCtxStep("naming");
    setTimeout(() => ctxInputRef.current?.focus(), 50);
  };

  const handleCtxSavePreset = () => {
    if (!ctxName.trim() || !ctxMenu) return;
    if (!/^[a-zA-Z0-9 _-]+$/.test(ctxName.trim())) {
      alert("Preset Name can only contain alphanumeric characters, spaces, dashes, and underscores.");
      return;
    }
    const newPan  = Math.round((ctxMenu.videoX - 50) * 3.6);
    const newTilt = Math.round((50 - ctxMenu.videoY) * 1.8);
    setPresets((p) => [...p, {
      id: Date.now(), name: ctxName.trim(),
      pan: newPan, tilt: newTilt, zoom,
      x: ctxMenu.videoX, y: ctxMenu.videoY,
    }]);
    setCtxMenu(null); setCtxName(""); setCtxStep("menu");
  };

  const handleCtxGoHere = () => {
    if (!ctxMenu) return;
    setPan(Math.round((ctxMenu.videoX - 50) * 3.6));
    setTilt(Math.round((50 - ctxMenu.videoY) * 1.8));
    setCtxMenu(null);
  };

  useEffect(() => {
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  function JoystickBtn({ dir, children, label }) {
    return (
      <button
        className={`ptz-joy-btn ${activeBtn === dir ? "ptz-joy-btn--active" : ""}`}
        onMouseDown={() => selected && startMove(dir)}
        onMouseUp={stopMove} onMouseLeave={stopMove}
        onTouchStart={(e) => { e.preventDefault(); selected && startMove(dir); }}
        onTouchEnd={stopMove}
        disabled={!selected} title={label}
      >{children}</button>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">PTZ <span>Presets</span></h1>
          <p className="page-desc">Pan, tilt and zoom cameras. Right-click the live video to drop a preset pin at any position.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      <div className="card" style={{ maxHeight: "calc(3 * 48px + 48px)", overflowY: "auto", flexShrink: 0, scrollbarWidth: "thin", scrollbarColor: "#334155 transparent" }}>
        <table className="m-table">
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>{["Camera Name", "IP Address", "Manufacturer", "Model"].map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr><td colSpan={4} className="m-table__empty">No cameras enrolled. Go to Add Devices first.</td></tr>
            ) : filteredRows.map((cam) => {
              const isSel = selected === cam.id;
              return (
                <tr key={cam.id}
                  className={`m-table__row ${isSel ? "m-table__row--selected" : ""}`}
                  onClick={() => {
                    const next = isSel ? null : cam.id;
                    setSelected(next);
                    if (next) localStorage.setItem("miradorai_selected_camera_id", String(next));
                    else localStorage.removeItem("miradorai_selected_camera_id");
                  }}>
                  <td className="m-table__primary">{cam.name}</td>
                  <td>{cam.ip}</td>
                  <td>{cam.manufacturer}</td>
                  <td>{cam.model}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ptz-layout">
        <div className="ptz-video-card card">
          {!selected ? (
            <div className="ptz-no-cam">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8">
                <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
              </svg>
              <span>Select a camera to control</span>
            </div>
          ) : (
            <>
              <div className="ptz-video-header">
                <span className="ptz-live-dot" />
                <span className="ptz-cam-name">{selectedDevice?.name}</span>
                <span className="ptz-live-tag">{moving ? "MOVING" : "LIVE"}</span>
                <span className="ptz-coord-badge">P {pan > 0 ? "+" : ""}{pan}°</span>
                <span className="ptz-coord-badge">T {tilt > 0 ? "+" : ""}{tilt}°</span>
                <span className="ptz-coord-badge">Z {zoom}%</span>
                {selectedDevice?.ip && (
                  <code className="ic-preview__ip">{selectedDevice.ip}</code>
                )}
                {!wsUrl && (
                  <span style={{ fontSize: 10, color: "#ef4444", marginLeft: 8 }}>
                    ⚠ No stream registered
                  </span>
                )}
                {wsUrl && <span className="ptz-hint">Right-click video to add preset</span>}
              </div>

              <div className="ptz-video-wrap" ref={videoWrapRef} onContextMenu={handleVideoRightClick}>
                {wsUrl ? (
                  <WebRTCPlayer serverUrl={wsUrl} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", height: "100%", gap: 8, color: "#64748b" }}>
                    <span style={{ fontSize: 32 }}>📡</span>
                    <span style={{ fontSize: 12 }}>Stream not registered with OME.</span>
                    <span style={{ fontSize: 11, color: "#475569" }}>
                      Re-enroll this camera to register its RTSP stream.
                    </span>
                  </div>
                )}

                {wsUrl && (
                  <div className="ptz-crosshair">
                    <div className="ptz-ch-h" /><div className="ptz-ch-v" />
                    <div className="ptz-ch-dot" />
                  </div>
                )}

                {wsUrl && presets.map((p) => (
                  <div key={p.id}
                    className={`ptz-pin ${selPreset === p.id ? "ptz-pin--active" : ""}`}
                    style={{ left: `${p.x}%`, top: `${p.y}%` }}
                    onClick={(e) => { e.stopPropagation(); gotoPreset(p); }}
                    title={`Go to: ${p.name}`}>
                    <div className="ptz-pin__dot" />
                    <div className="ptz-pin__label">{p.name}</div>
                  </div>
                ))}

                {moving && (
                  <div className="ptz-moving-badge">
                    <div className="ptz-moving-spinner" />
                    Moving to preset...
                  </div>
                )}

                {ctxMenu && (
                  <div className="ptz-ctx-menu"
                    style={{ left: ctxMenu.screenX, top: ctxMenu.screenY }}
                    onClick={(e) => e.stopPropagation()}>
                    {ctxStep === "menu" ? (
                      <>
                        <div className="ptz-ctx-header">
                          Position {Math.round(ctxMenu.videoX)}%, {Math.round(ctxMenu.videoY)}%
                        </div>
                        <button className="ptz-ctx-item" onClick={handleCtxAddPreset}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
                          Add Preset Here
                        </button>
                        <button className="ptz-ctx-item" onClick={handleCtxGoHere}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg>
                          Move Camera Here
                        </button>
                        <button className="ptz-ctx-item ptz-ctx-item--cancel" onClick={() => setCtxMenu(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="ptz-ctx-header">Name this preset</div>
                        <div className="ptz-ctx-input-row">
                          <input ref={ctxInputRef} className="ptz-ctx-input"
                            placeholder="e.g. Front Gate"
                            value={ctxName}
                            onChange={(e) => setCtxName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleCtxSavePreset();
                              if (e.key === "Escape") setCtxMenu(null);
                            }} />
                        </div>
                        <div className="ptz-ctx-actions">
                          <button className="ptz-ctx-save" onClick={handleCtxSavePreset} disabled={!ctxName.trim()}>
                            Save Preset
                          </button>
                          <button className="ptz-ctx-item ptz-ctx-item--cancel" onClick={() => setCtxMenu(null)}>
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {wsUrl && (
                  <div className="ptz-video-overlay">
                    {selectedDevice?.name} · {selectedDevice?.model || selectedDevice?.ip}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="ptz-controls-col">
          <div className="ptz-joystick-card card">
            <div className="ptz-joy-title">Pan / Tilt</div>
            <div className="ptz-joy-grid">
              <JoystickBtn dir="up-left"    label="Up-Left">↖</JoystickBtn>
              <JoystickBtn dir="up"         label="Up">▲</JoystickBtn>
              <JoystickBtn dir="up-right"   label="Up-Right">↗</JoystickBtn>
              <JoystickBtn dir="left"       label="Left">◀</JoystickBtn>
              <button className="ptz-joy-home" onClick={handleHome} disabled={!selected} title="Home">⌂</button>
              <JoystickBtn dir="right"      label="Right">▶</JoystickBtn>
              <JoystickBtn dir="down-left"  label="Down-Left">↙</JoystickBtn>
              <JoystickBtn dir="down"       label="Down">▼</JoystickBtn>
              <JoystickBtn dir="down-right" label="Down-Right">↘</JoystickBtn>
            </div>
          </div>

          <div className="ptz-sliders-card card">
            {[
              { label: "Zoom",  value: zoom,  onChange: setZoom,  min: 0,    max: 100, color: "#00c8a0", icon: "⊕" },
              { label: "Focus", value: focus, onChange: setFocus, min: 0,    max: 100, color: "#4d9fff", icon: "◎" },
              { label: "Pan",   value: pan,   onChange: setPan,   min: -180, max: 180, color: "#ffb340", icon: "↔" },
              { label: "Tilt",  value: tilt,  onChange: setTilt,  min: -90,  max: 90,  color: "#c084fc", icon: "↕" },
            ].map(({ label, value, onChange, min, max, color, icon }) => (
              <div key={label} className="ptz-slider-row">
                <span className="ptz-slider-icon" style={{ color }}>{icon}</span>
                <span className="ptz-slider-label">{label}</span>
                <button className="ptz-arrow-btn" onClick={() => selected && onChange((v) => Math.max(min, v - 5))} disabled={!selected}>‹</button>
                <div className="ptz-slider-wrap">
                  <input type="range" min={min} max={max} value={value} disabled={!selected}
                    onChange={(e) => onChange(Number(e.target.value))}
                    style={{ accentColor: color }} className="ptz-slider" />
                </div>
                <button className="ptz-arrow-btn" onClick={() => selected && onChange((v) => Math.min(max, v + 5))} disabled={!selected}>›</button>
                <span className="ptz-slider-val" style={{ color }}>
                  {value > 0 && label !== "Zoom" && label !== "Focus" ? "+" : ""}{value}{label === "Zoom" || label === "Focus" ? "%" : "°"}
                </span>
              </div>
            ))}
            <div className="ptz-divider" />
            <div className="ptz-slider-row">
              <span className="ptz-slider-icon" style={{ color: "#8892a4" }}>⚡</span>
              <span className="ptz-slider-label">Speed</span>
              <button className="ptz-arrow-btn" onClick={() => setSpeed((v) => Math.max(1, v - 10))}>‹</button>
              <div className="ptz-slider-wrap">
                <input type="range" min={1} max={100} value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  style={{ accentColor: "#8892a4" }} className="ptz-slider" />
              </div>
              <button className="ptz-arrow-btn" onClick={() => setSpeed((v) => Math.min(100, v + 10))}>›</button>
              <span className="ptz-slider-val" style={{ color: "#8892a4" }}>{speed}%</span>
            </div>
          </div>
        </div>

        <div className="ptz-presets-card card">
          <div className="ptz-presets-title">
            Saved Presets
            <span className="ptz-presets-count">{presets.length}</span>
          </div>
          <div className="ptz-presets-list">
            {!selected ? (
              <div className="ptz-empty">Select a camera to view its presets</div>
            ) : presets.length === 0 ? (
              <div className="ptz-empty">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
                </svg>
                No presets for this camera yet
              </div>
            ) : presets.map((p) => (
              <div key={p.id}
                className={`ptz-preset-item ${selPreset === p.id ? "ptz-preset-item--active" : ""}`}
                onClick={() => gotoPreset(p)}>
                <div className="ptz-preset-pin" />
                <div className="ptz-preset-info">
                  <span className="ptz-preset-name">{p.name}</span>
                  <span className="ptz-preset-coords">P{p.pan > 0 ? "+" : ""}{p.pan}° T{p.tilt > 0 ? "+" : ""}{p.tilt}° Z{p.zoom}%</span>
                </div>
                {selPreset === p.id && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
            ))}
          </div>
          <div className="ptz-presets-actions">
            <Button label="Go To" variant="primary" disabled={!selPreset || !selected}
              onClick={() => { const p = presets.find(x => x.id === selPreset); if (p) gotoPreset(p); }} />
            <Button label="Remove" variant="danger" disabled={!selPreset} onClick={removePreset} />
          </div>
          <div className="ptz-presets-tip">
            💡 Right-click the live video to place a preset pin at any position
          </div>
        </div>
      </div>
    </div>
  );
}