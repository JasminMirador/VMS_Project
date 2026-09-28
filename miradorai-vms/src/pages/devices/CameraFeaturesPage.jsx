/**
 * CameraFeaturesPage.jsx
 *
 * Auto-renders every capability the connected camera actually supports.
 * Bosch → Bosch features. Hikvision → Hikvision features. Any ONVIF camera works.
 *
 * Usage in your router:
 *   case "camera-features": return <CameraFeaturesPage onNavigate={onNavigate} />;
 *
 * Reads camera id from localStorage key "miradorai_selected_camera_id"
 * and camera list from "miradorai_devices"
 */

import { useState, useEffect, useCallback, useRef } from "react";
import MaskingSection, { MASKING_CSS } from "./MaskingSection";
import BrandFeaturesSection from "./BrandFeaturesSection";
const API = import.meta.env.VITE_API_URL;

// ── tiny helpers ─────────────────────────────────────────────────
const cls = (...args) => args.filter(Boolean).join(" ");
const fmt = (v) => (v === null || v === undefined ? "—" : String(v));

// ── CSS ──────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,400&family=Syne:wght@600;700;800&display=swap');

.cfp-root {
  font-family: 'DM Mono', monospace;
  background: #080c12;
  min-height: 100vh;
  color: #c9d4e8;
}

/* ── Header ── */
.cfp-header {
  padding: 24px 32px 20px;
  border-bottom: 1px solid #1a2332;
  display: flex; align-items: center; gap: 16px;
  background: #0a0f1a;
}
.cfp-back {
  background: #0d1420; border: 1px solid #1e2d42;
  border-radius: 8px; color: #6b7a99;
  padding: 7px 10px; cursor: pointer;
  transition: all .15s; display: flex; align-items: center;
}
.cfp-back:hover { color: #c9d4e8; border-color: #2e3d55; }
.cfp-header-info { flex: 1; }
.cfp-eyebrow { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #2563eb; }
.cfp-title { font-family: 'Syne', sans-serif; font-size: 20px; font-weight: 700; color: #e8edf5; margin: 2px 0 0; }
.cfp-subtitle { font-size: 11px; color: #4a5a72; margin-top: 2px; }
.cfp-status-pill {
  padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 500;
  border: 1px solid;
}
.cfp-status-pill--online { background: #0a1f0f; color: #22c55e; border-color: #14532d; }
.cfp-status-pill--loading { background: #0f1f3d; color: #3b82f6; border-color: #1e3a5f; }
.cfp-status-pill--error { background: #1a0a0a; color: #f87171; border-color: #4c1d1d; }

/* ── Layout ── */
.cfp-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: calc(100vh - 73px);
}

/* ── Sidebar ── */
.cfp-sidebar {
  border-right: 1px solid #1a2332;
  background: #090e18;
  padding: 16px 0;
}
.cfp-nav-section { margin-bottom: 4px; }
.cfp-nav-label {
  font-size: 9px; letter-spacing: .14em; text-transform: uppercase;
  color: #2e3d55; padding: 8px 16px 4px; display: block;
}
.cfp-nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 16px; cursor: pointer; font-size: 12px;
  color: #4a5a72; transition: all .12s; border: none; background: none;
  width: 100%; text-align: left; position: relative;
}
.cfp-nav-item:hover { color: #c9d4e8; background: #0d1420; }
.cfp-nav-item.active {
  color: #3b82f6; background: #0d1f3d;
  border-right: 2px solid #2563eb;
}
.cfp-nav-item.disabled { opacity: .35; cursor: not-allowed; }
.cfp-nav-badge {
  margin-left: auto; background: #0f1f3d; color: #3b82f6;
  border: 1px solid #1e3a5f; border-radius: 4px;
  font-size: 9px; padding: 1px 5px;
}
.cfp-nav-badge--green { background: #0a1f0f; color: #22c55e; border-color: #14532d; }

/* ── Content ── */
.cfp-content {
  padding: 28px 32px;
  overflow-y: auto;
}

/* ── Section titles ── */
.cfp-section-title {
  font-family: 'Syne', sans-serif;
  font-size: 14px; font-weight: 700; color: #e8edf5;
  margin: 0 0 4px;
}
.cfp-section-desc { font-size: 11px; color: #4a5a72; margin-bottom: 20px; }

/* ── Cards ── */
.cfp-card {
  background: #0d1420; border: 1px solid #1a2332;
  border-radius: 10px; padding: 18px 20px; margin-bottom: 14px;
}
.cfp-card-title {
  font-size: 11px; font-weight: 500; color: #6b7a99;
  text-transform: uppercase; letter-spacing: .08em;
  margin-bottom: 14px; display: flex; align-items: center; gap: 8px;
}
.cfp-card-title svg { color: #3b82f6; }

/* ── Sliders ── */
.cfp-slider-row {
  display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
}
.cfp-slider-label { font-size: 11px; color: #6b7a99; width: 120px; flex-shrink: 0; }
.cfp-slider {
  flex: 1; -webkit-appearance: none; height: 4px;
  background: #1a2332; border-radius: 2px; outline: none; cursor: pointer;
}
.cfp-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px;
  background: #2563eb; border-radius: 50%; cursor: pointer;
  border: 2px solid #0d1420; transition: background .15s;
}
.cfp-slider:hover::-webkit-slider-thumb { background: #3b82f6; }
.cfp-slider-val {
  width: 40px; text-align: right; font-size: 12px; color: #c9d4e8; flex-shrink: 0;
}

/* ── Toggle switch ── */
.cfp-toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 0; border-bottom: 1px solid #111923;
}
.cfp-toggle-row:last-child { border-bottom: none; }
.cfp-toggle-info { flex: 1; }
.cfp-toggle-name { font-size: 12px; color: #c9d4e8; }
.cfp-toggle-desc { font-size: 10px; color: #4a5a72; margin-top: 2px; }
.cfp-switch {
  position: relative; width: 36px; height: 20px; flex-shrink: 0; margin-left: 12px;
}
.cfp-switch input { opacity: 0; width: 0; height: 0; }
.cfp-switch-slider {
  position: absolute; cursor: pointer; inset: 0;
  background: #1a2332; border-radius: 20px; transition: .2s;
}
.cfp-switch-slider:before {
  position: absolute; content: "";
  height: 14px; width: 14px; left: 3px; bottom: 3px;
  background: #4a5a72; border-radius: 50%; transition: .2s;
}
input:checked + .cfp-switch-slider { background: #1d4ed8; }
input:checked + .cfp-switch-slider:before { transform: translateX(16px); background: #fff; }

/* ── Select ── */
.cfp-select {
  background: #080c12; border: 1px solid #1a2332; border-radius: 6px;
  color: #c9d4e8; font-family: 'DM Mono', monospace; font-size: 12px;
  padding: 7px 10px; outline: none; cursor: pointer; width: 100%;
  transition: border-color .15s;
}
.cfp-select:focus { border-color: #2563eb; }

/* ── Preset grid ── */
.cfp-preset-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px; margin-top: 4px;
}
.cfp-preset-btn {
  background: #080c12; border: 1px solid #1a2332;
  border-radius: 8px; padding: 10px 12px;
  text-align: left; cursor: pointer; transition: all .15s;
  font-family: 'DM Mono', monospace; color: #6b7a99; font-size: 11px;
}
.cfp-preset-btn:hover { border-color: #2563eb; color: #3b82f6; background: #0d1f3d; }
.cfp-preset-btn-name { color: #c9d4e8; font-size: 12px; margin-bottom: 2px; }
.cfp-preset-btn-token { font-size: 9px; color: #2e3d55; }

/* ── PTZ joystick ── */
.cfp-ptz-wrap { display: flex; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
.cfp-joystick {
  display: grid; grid-template-areas: ". up ." "left home right" ". down .";
  grid-template-columns: 44px 44px 44px; gap: 4px;
}
.cfp-joy-btn {
  width: 44px; height: 44px; background: #0d1420; border: 1px solid #1a2332;
  border-radius: 8px; cursor: pointer; display: flex;
  align-items: center; justify-content: center;
  color: #6b7a99; transition: all .12s; font-family: 'DM Mono', monospace;
}
.cfp-joy-btn:hover { background: #0d1f3d; border-color: #2563eb; color: #3b82f6; }
.cfp-joy-btn--home { background: #0a0f1a; font-size: 10px; color: #4a5a72; grid-area: home; }
.cfp-joy-btn[data-area="up"]    { grid-area: up; }
.cfp-joy-btn[data-area="down"]  { grid-area: down; }
.cfp-joy-btn[data-area="left"]  { grid-area: left; }
.cfp-joy-btn[data-area="right"] { grid-area: right; }

.cfp-zoom-wrap { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.cfp-zoom-label { font-size: 9px; color: #2e3d55; text-transform: uppercase; letter-spacing: .1em; }
.cfp-zoom-btn {
  width: 44px; height: 44px; background: #0d1420; border: 1px solid #1a2332;
  border-radius: 8px; cursor: pointer; display: flex; align-items: center;
  justify-content: center; color: #6b7a99; font-size: 18px;
  transition: all .12s; font-family: 'DM Mono', monospace;
}
.cfp-zoom-btn:hover { background: #0d1f3d; border-color: #2563eb; color: #3b82f6; }

/* ── Info grid ── */
.cfp-info-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.cfp-info-item { display: flex; flex-direction: column; gap: 3px; }
.cfp-info-key { font-size: 9px; text-transform: uppercase; letter-spacing: .1em; color: #2e3d55; }
.cfp-info-val { font-size: 12px; color: #c9d4e8; }
.cfp-info-val--blue { color: #3b82f6; }
.cfp-info-val--green { color: #22c55e; }

/* ── IO relay ── */
.cfp-relay-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 0; border-bottom: 1px solid #111923;
}
.cfp-relay-row:last-child { border-bottom: none; }
.cfp-relay-btn {
  font-family: 'DM Mono', monospace; font-size: 11px; font-weight: 500;
  padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid;
  transition: all .15s;
}
.cfp-relay-btn--active { background: #0a2f14; color: #22c55e; border-color: #14532d; }
.cfp-relay-btn--active:hover { background: #0f3d1a; }
.cfp-relay-btn--inactive { background: #1a0a0a; color: #f87171; border-color: #4c1d1d; }
.cfp-relay-btn--inactive:hover { background: #220e0e; }

/* ── Events capability chips ── */
.cfp-event-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.cfp-chip {
  padding: 4px 10px; border-radius: 5px; font-size: 10px; font-weight: 500;
  letter-spacing: .04em; text-transform: uppercase; border: 1px solid;
}
.cfp-chip--on  { background: #0a1f0f; color: #22c55e; border-color: #14532d; }
.cfp-chip--off { background: #0d1420; color: #2e3d55; border-color: #1a2332; }

/* ── Loading / empty ── */
.cfp-loading {
  display: flex; align-items: center; justify-content: center;
  min-height: 400px; flex-direction: column; gap: 16px;
}
.cfp-spinner {
  width: 32px; height: 32px; border: 3px solid #1a2332;
  border-top-color: #2563eb; border-radius: 50%;
  animation: cfp-spin .7s linear infinite;
}
@keyframes cfp-spin { to { transform: rotate(360deg); } }
.cfp-loading-text { font-size: 12px; color: #4a5a72; }

/* ── Action button ── */
.cfp-action-btn {
  font-family: 'DM Mono', monospace; font-size: 11px; font-weight: 500;
  padding: 7px 16px; border-radius: 7px; cursor: pointer;
  border: 1px solid #2563eb; background: #0f1f3d; color: #3b82f6;
  transition: all .15s;
}
.cfp-action-btn:hover { background: #1a3260; }
.cfp-action-btn:disabled { opacity: .4; cursor: not-allowed; }
.cfp-action-btn--danger { border-color: #dc2626; background: #1a0808; color: #f87171; }
.cfp-action-btn--danger:hover { background: #220e0e; }

/* ── Toast ── */
.cfp-toast {
  position: fixed; bottom: 24px; right: 24px;
  background: #0d1f3d; border: 1px solid #2563eb;
  border-radius: 8px; padding: 10px 16px; font-size: 12px;
  color: #3b82f6; z-index: 9999;
  animation: cfp-toast-in .2s ease;
}
.cfp-toast--error { background: #1a0808; border-color: #dc2626; color: #f87171; }
.cfp-toast--success { background: #0a1f0f; border-color: #14532d; color: #22c55e; }
@keyframes cfp-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; } }

/* ── Network table ── */
.cfp-net-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cfp-net-table td { padding: 8px 0; border-bottom: 1px solid #111923; }
.cfp-net-table td:first-child { color: #4a5a72; width: 160px; }
.cfp-net-table tr:last-child td { border-bottom: none; }

/* ── Save preset input ── */
.cfp-preset-input {
  background: #080c12; border: 1px solid #1a2332; border-radius: 6px;
  color: #c9d4e8; font-family: 'DM Mono', monospace; font-size: 12px;
  padding: 7px 10px; outline: none; flex: 1;
  transition: border-color .15s;
}
.cfp-preset-input:focus { border-color: #2563eb; }
.cfp-save-preset-row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
  ${MASKING_CSS}

`;

// ── NAV CONFIG ────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    label: "Device",
    items: [
      { id: "overview",  label: "Overview",      icon: "⊞", capKey: null },
      { id: "network",   label: "Network",       icon: "⌘", capKey: null },
    ],
  },
  {
    label: "Video",
    items: [
      { id: "imaging",   label: "Image Settings",icon: "◑", capKey: "imaging" },
      { id: "streams",   label: "Stream Profiles",icon: "▶", capKey: null },
    ],
  },
  {
    label: "Control",
    items: [
      { id: "ptz",       label: "PTZ Control",   icon: "✛", capKey: "ptz" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { id: "events",    label: "Events & Alarms",icon: "◎", capKey: "null" },
      { id: "analytics", label: "Analytics",     icon: "◈", capKey: "null" },
          { id: "masking",   label: "Privacy Masks",   icon: "▣", capKey: null  },  // ← ADD THIS
          { id: "brand-features", label: "Event Settings", icon: "◉", capKey: null }

    ],
  },
  {
    label: "I/O",
    items: [
      { id: "audio",     label: "Audio",         icon: "♪", capKey: "audio_in" },
      { id: "io",        label: "Relay / I/O",   icon: "⚡", capKey: "io" },
    ],
  },
];

// ── TOAST ─────────────────────────────────────────────────────────
function Toast({ msg, type = "info", onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className={cls("cfp-toast", type === "error" && "cfp-toast--error", type === "success" && "cfp-toast--success")}>
      {msg}
    </div>
  );
}

// ── SLIDER CONTROL ────────────────────────────────────────────────
function SliderControl({ label, value, min = 0, max = 100, step = 1, onCommit }) {
  const [local, setLocal] = useState(value ?? Math.round((min + max) / 2));

  useEffect(() => { if (value !== null && value !== undefined) setLocal(value); }, [value]);

  return (
    <div className="cfp-slider-row">
      <span className="cfp-slider-label">{label}</span>
      <input
        type="range" className="cfp-slider"
        min={min} max={max} step={step}
        value={local}
        onChange={e => setLocal(Number(e.target.value))}
        onMouseUp={() => onCommit(local)}
        onTouchEnd={() => onCommit(local)}
      />
      <span className="cfp-slider-val">{local}</span>
    </div>
  );
}

// ── TOGGLE CONTROL ────────────────────────────────────────────────
function ToggleControl({ name, desc, checked, onChange }) {
  const id = `toggle-${name.replace(/\s/g, "")}`;
  return (
    <div className="cfp-toggle-row">
      <div className="cfp-toggle-info">
        <div className="cfp-toggle-name">{name}</div>
        {desc && <div className="cfp-toggle-desc">{desc}</div>}
      </div>
      <label className="cfp-switch">
        <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
        <span className="cfp-switch-slider" />
      </label>
    </div>
  );
}

// ── SECTIONS ──────────────────────────────────────────────────────

function OverviewSection({ device, caps }) {
  const c = caps?.capabilities || {};
  const featureFlags = [
    { key: "ptz",       label: "PTZ"         },
    { key: "imaging",   label: "Imaging"     },
    { key: "events",    label: "Events"      },
    { key: "analytics", label: "Analytics"   },
    { key: "audio_in",  label: "Audio In"    },
    { key: "audio_out", label: "Audio Out"   },
    { key: "io",        label: "I/O Relay"   },
  ];

  return (
    <>
      <div className="cfp-section-title">Device Overview</div>
      <div className="cfp-section-desc">Hardware identity and supported feature summary</div>

      <div className="cfp-card">
        <div className="cfp-card-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
          </svg>
          Device Identity
        </div>
        <div className="cfp-info-grid">
          {[
            ["Manufacturer", caps?.manufacturer || device?.manufacturer],
            ["Model",        caps?.model        || device?.model],
            ["Firmware",     caps?.firmware],
            ["Serial",       caps?.serial],
            ["Hardware ID",  caps?.hardware],
            ["MAC Address",  caps?.mac          || device?.mac],
            ["IP Address",   device?.ip],
            ["Streams",      caps?.stream_count != null ? `${caps.stream_count} profiles` : "—"],
          ].map(([k, v]) => (
            <div key={k} className="cfp-info-item">
              <span className="cfp-info-key">{k}</span>
              <span className="cfp-info-val">{fmt(v)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="cfp-card">
        <div className="cfp-card-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          Supported Features
        </div>
        <div className="cfp-event-chips">
          {featureFlags.map(({ key, label }) => (
            <span key={key} className={cls("cfp-chip", c[key] ? "cfp-chip--on" : "cfp-chip--off")}>
              {label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

function ImagingSection({ device, caps, onCall, showToast }) {
  const imaging = caps?.capabilities?.imaging_settings || {};
  const opts    = imaging.options || {};
  if (!imaging.supported) {
    return (
      <div className="cfp-card">
        <div style={{ color: "#4a5a72", fontSize: 12 }}>
          This camera does not expose ONVIF imaging settings.
        </div>
      </div>
    );
  }

  const apply = async (setting, value) => {
    const res = await onCall("/api/camera/imaging/set", {
      ip: device.ip, port: device.port || 80,
      username: device.username || "", password: device.password || "",
      setting, value,
    });
    showToast(res.success ? `${setting} updated` : res.error || "Failed", res.success ? "success" : "error");
  };

  const bRange = opts.brightness_range || { min: 0, max: 100 };
  const sRange = opts.sharpness_range  || { min: 0, max: 100 };
  const satRange = opts.saturation_range || { min: 0, max: 100 };

  return (
    <>
      <div className="cfp-section-title">Image Settings</div>
      <div className="cfp-section-desc">Real-time camera image controls — changes apply immediately</div>

      <div className="cfp-card">
        <div className="cfp-card-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
          Basic Adjustments
        </div>
        <SliderControl
          label="Brightness"
          value={imaging.brightness}
          min={bRange.min} max={bRange.max}
          onCommit={v => apply("brightness", v)}
        />
        <SliderControl
          label="Sharpness"
          value={imaging.sharpness}
          min={sRange.min} max={sRange.max}
          onCommit={v => apply("sharpness", v)}
        />
        <SliderControl
          label="Saturation"
          value={imaging.saturation}
          min={satRange.min} max={satRange.max}
          onCommit={v => apply("saturation", v)}
        />
      </div>

      {/* IR Cut Filter */}
      {imaging.ir_cut_filter !== null && (
        <div className="cfp-card">
          <div className="cfp-card-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>
            </svg>
            Day/Night Mode
          </div>
          <div style={{ marginBottom: 10 }}>
            <div className="cfp-slider-label" style={{ marginBottom: 6, display: "block" }}>IR Cut Filter</div>
            <select
              className="cfp-select"
              value={imaging.ir_cut_filter || ""}
              onChange={e => apply("ir_cut_filter", e.target.value)}
            >
              {(opts.ir_cut_modes?.length ? opts.ir_cut_modes : ["AUTO", "ON", "OFF"]).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* WDR */}
      {imaging.wide_dynamic_range !== null && (
        <div className="cfp-card">
          <div className="cfp-card-title">Wide Dynamic Range (WDR)</div>
          <div style={{ marginBottom: 10 }}>
            <select
              className="cfp-select"
              value={imaging.wide_dynamic_range || ""}
              onChange={e => apply("wdr", e.target.value)}
            >
              {(opts.wdr_modes?.length ? opts.wdr_modes : ["OFF", "ON"]).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          {imaging.wdr_level !== null && (
            <SliderControl
              label="WDR Level"
              value={imaging.wdr_level}
              min={0} max={100}
              onCommit={v => apply("wdr_level", v)}
            />
          )}
        </div>
      )}

      {/* Exposure */}
      {imaging.exposure_mode !== null && (
        <div className="cfp-card">
          <div className="cfp-card-title">Exposure</div>
          <div style={{ marginBottom: 10 }}>
            <div className="cfp-slider-label" style={{ marginBottom: 6, display: "block" }}>Mode</div>
            <select
              className="cfp-select"
              value={imaging.exposure_mode || ""}
              onChange={e => apply("exposure_mode", e.target.value)}
            >
              {(opts.exposure_modes?.length ? opts.exposure_modes : ["AUTO", "MANUAL"]).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* White Balance */}
      {imaging.white_balance_mode !== null && (
        <div className="cfp-card">
          <div className="cfp-card-title">White Balance</div>
          <select
            className="cfp-select"
            value={imaging.white_balance_mode || ""}
            onChange={e => apply("white_balance", e.target.value)}
          >
            {(opts.white_balance_modes?.length ? opts.white_balance_modes : ["AUTO", "MANUAL", "INDOOR", "OUTDOOR"]).map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* Backlight Compensation */}
      {imaging.backlight_compensation && (
        <div className="cfp-card">
          <div className="cfp-card-title">Backlight Compensation</div>
          <select
            className="cfp-select"
            value={imaging.backlight_compensation.mode || ""}
            onChange={e => apply("backlight_compensation", e.target.value)}
          >
            {["OFF", "ON"].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

function PTZSection({ device, caps, onCall, showToast }) {
  const ptz = caps?.capabilities?.ptz_info || {};
  const [pan, setPan]   = useState(0);
  const [tilt, setTilt] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [newPresetName, setNewPresetName] = useState("");

  if (!ptz.supported) {
    return (
      <div className="cfp-card">
        <div style={{ color: "#4a5a72", fontSize: 12 }}>
          PTZ not supported on this camera.
        </div>
      </div>
    );
  }

  const move = async (p, t, z) => {
    const res = await onCall("/api/camera/ptz/move", {
      ip: device.ip, port: device.port || 80,
      username: device.username || "", password: device.password || "",
      pan: p, tilt: t, zoom: z,
    });
    if (!res.success) showToast(res.error || "Move failed", "error");
  };

  const gotoPreset = async (token) => {
    const res = await onCall("/api/camera/ptz/preset/goto", {
      ip: device.ip, port: device.port || 80,
      username: device.username || "", password: device.password || "",
      preset_token: token,
    });
    showToast(res.success ? "Moved to preset" : res.error || "Failed", res.success ? "success" : "error");
  };

  const savePreset = async () => {
    if (!newPresetName.trim()) return;
    if (!/^[a-zA-Z0-9 _-]+$/.test(newPresetName.trim())) {
      showToast("Preset Name can only contain alphanumeric characters, spaces, dashes, and underscores.", "error");
      return;
    }
    const res = await onCall("/api/camera/ptz/preset/save", {
      ip: device.ip, port: device.port || 80,
      username: device.username || "", password: device.password || "",
      preset_name: newPresetName.trim(),
    });
    showToast(res.success ? `Preset "${newPresetName}" saved` : res.error || "Failed", res.success ? "success" : "error");
    if (res.success) setNewPresetName("");
  };

  const goHome = async () => {
    const res = await onCall("/api/camera/ptz/home", {
      ip: device.ip, port: device.port || 80,
      username: device.username || "", password: device.password || "",
    });
    showToast(res.success ? "Moved to home" : res.error || "Failed", res.success ? "success" : "error");
  };

  const STEP = 0.15;

  return (
    <>
      <div className="cfp-section-title">PTZ Control</div>
      <div className="cfp-section-desc">Pan, tilt, zoom and preset management</div>

      <div className="cfp-card">
        <div className="cfp-card-title">Live Joystick</div>
        <div className="cfp-ptz-wrap">
          {/* Directional pad */}
          <div className="cfp-joystick">
            <button className="cfp-joy-btn" data-area="up"
              onClick={() => { const t = Math.min(1, tilt + STEP); setTilt(t); move(pan, t, zoom); }}>
              ▲
            </button>
            <button className="cfp-joy-btn" data-area="left"
              onClick={() => { const p = Math.max(-1, pan - STEP); setPan(p); move(p, tilt, zoom); }}>
              ◀
            </button>
            <button className="cfp-joy-btn cfp-joy-btn--home" onClick={goHome}>HOME</button>
            <button className="cfp-joy-btn" data-area="right"
              onClick={() => { const p = Math.min(1, pan + STEP); setPan(p); move(p, tilt, zoom); }}>
              ▶
            </button>
            <button className="cfp-joy-btn" data-area="down"
              onClick={() => { const t = Math.max(-1, tilt - STEP); setTilt(t); move(pan, t, zoom); }}>
              ▼
            </button>
          </div>

          {/* Zoom */}
          <div className="cfp-zoom-wrap">
            <button className="cfp-zoom-btn"
              onClick={() => { const z = Math.min(1, zoom + 0.1); setZoom(z); move(pan, tilt, z); }}>
              +
            </button>
            <span className="cfp-zoom-label">ZOOM</span>
            <button className="cfp-zoom-btn"
              onClick={() => { const z = Math.max(0, zoom - 0.1); setZoom(z); move(pan, tilt, z); }}>
              −
            </button>
          </div>

          {/* Current position */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[["Pan", pan], ["Tilt", tilt], ["Zoom", zoom]].map(([l, v]) => (
              <div key={l} className="cfp-info-item">
                <span className="cfp-info-key">{l}</span>
                <span className="cfp-info-val cfp-info-val--blue">{v.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Presets */}
      {ptz.presets?.length > 0 && (
        <div className="cfp-card">
          <div className="cfp-card-title">
            Saved Presets
            <span className="cfp-nav-badge">{ptz.presets.length}</span>
          </div>
          <div className="cfp-preset-grid">
            {ptz.presets.map((p) => (
              <button key={p.token} className="cfp-preset-btn" onClick={() => gotoPreset(p.token)}>
                <div className="cfp-preset-btn-name">{p.name}</div>
                <div className="cfp-preset-btn-token">token: {p.token}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Save current position */}
      <div className="cfp-card">
        <div className="cfp-card-title">Save Current Position as Preset</div>
        <div className="cfp-save-preset-row">
          <input
            className="cfp-preset-input"
            placeholder="Preset name (e.g. Entrance, Gate 1)"
            value={newPresetName}
            onChange={e => setNewPresetName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && savePreset()}
          />
          <button className="cfp-action-btn" onClick={savePreset}>Save</button>
        </div>
      </div>
    </>
  );
}

function EventsSection({ caps }) {
  const ev = caps?.capabilities?.event_info || {};
  if (!ev.supported) {
    return (
      <div className="cfp-card">
        <div style={{ color: "#4a5a72", fontSize: 12 }}>
          This camera does not expose ONVIF event properties.
        </div>
      </div>
    );
  }

  const detections = [
    { key: "motion_detection", label: "Motion Detection" },
    { key: "tampering",        label: "Camera Tampering" },
    { key: "line_crossing",    label: "Line Crossing" },
    { key: "intrusion",        label: "Intrusion / Field Detection" },
    { key: "face_detection",   label: "Face Detection" },
    { key: "audio_detection",  label: "Audio Detection" },
  ];

  return (
    <>
      <div className="cfp-section-title">Events & Alarms</div>
      <div className="cfp-section-desc">Camera-reported event capabilities (read from ONVIF event topology)</div>

      <div className="cfp-card">
        <div className="cfp-card-title">Detection Capabilities</div>
        <div className="cfp-event-chips">
          {detections.map(({ key, label }) => (
            <span key={key} className={cls("cfp-chip", ev[key] ? "cfp-chip--on" : "cfp-chip--off")}>
              {label}
            </span>
          ))}
        </div>
      </div>

      {ev.topics?.length > 0 && (
        <div className="cfp-card">
          <div className="cfp-card-title">Raw Event Topics</div>
          <div className="cfp-event-chips">
            {ev.topics.map(t => (
              <span key={t} className="cfp-chip cfp-chip--off">{t}</span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AudioSection({ caps }) {
  const audio = caps?.capabilities?.audio_info || {};
  return (
    <>
      <div className="cfp-section-title">Audio</div>
      <div className="cfp-section-desc">Audio input/output capabilities detected from camera profiles</div>
      <div className="cfp-card">
        <div className="cfp-info-grid">
          {[
            ["Audio Input",  audio.input_supported  ? "Supported ✓" : "Not available"],
            ["Audio Output", audio.output_supported ? "Supported ✓" : "Not available"],
            ["Encoding",     audio.encoding],
            ["Sample Rate",  audio.sample_rate ? `${audio.sample_rate} Hz` : null],
            ["Bitrate",      audio.bitrate     ? `${audio.bitrate} kbps`  : null],
          ].map(([k, v]) => (
            <div key={k} className="cfp-info-item">
              <span className="cfp-info-key">{k}</span>
              <span className={cls("cfp-info-val", String(v).includes("✓") && "cfp-info-val--green")}>
                {fmt(v)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function IOSection({ device, caps, onCall, showToast }) {
  const io = caps?.capabilities?.io_info || {};
  const relays = io.relay_outputs || [];
  const inputs = io.alarm_inputs  || [];

  const triggerRelay = async (token, state) => {
    const res = await onCall("/api/camera/io/relay", {
      ip: device.ip, port: device.port || 80,
      username: device.username || "", password: device.password || "",
      relay_token: token, state,
    });
    showToast(res.success ? `Relay ${token} → ${state}` : res.error || "Failed",
              res.success ? "success" : "error");
  };

  if (!relays.length && !inputs.length) {
    return (
      <div className="cfp-card">
        <div style={{ color: "#4a5a72", fontSize: 12 }}>
          No digital I/O relay outputs or alarm inputs detected.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="cfp-section-title">Relay / Digital I/O</div>
      <div className="cfp-section-desc">Control alarm outputs and read alarm input states</div>

      {relays.length > 0 && (
        <div className="cfp-card">
          <div className="cfp-card-title">Relay Outputs</div>
          {relays.map(r => (
            <div key={r.token} className="cfp-relay-row">
              <div>
                <div className="cfp-toggle-name">Relay {r.token}</div>
                <div className="cfp-toggle-desc">Mode: {r.mode || "—"} · Idle: {r.idle_state || "—"}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="cfp-relay-btn cfp-relay-btn--active"
                  onClick={() => triggerRelay(r.token, "Active")}>
                  Activate
                </button>
                <button className="cfp-relay-btn cfp-relay-btn--inactive"
                  onClick={() => triggerRelay(r.token, "Inactive")}>
                  Deactivate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {inputs.length > 0 && (
        <div className="cfp-card">
          <div className="cfp-card-title">Alarm Inputs</div>
          {inputs.map(inp => (
            <div key={inp.token} className="cfp-relay-row">
              <div>
                <div className="cfp-toggle-name">Input {inp.token}</div>
                <div className="cfp-toggle-desc">Idle state: {inp.idle_state || "—"}</div>
              </div>
              <span className="cfp-chip cfp-chip--off">Read-only</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function NetworkSection({ caps }) {
  const net = caps?.capabilities?.network_info || {};
  const rows = [
    ["Hostname",    net.hostname],
    ["DHCP",        net.dhcp != null ? (net.dhcp ? "Enabled" : "Disabled") : null],
    ["IP Address",  net.ip_address],
    ["Gateway",     net.gateway],
    ["DNS Servers", net.dns?.join(", ")],
    ["NTP Servers", net.ntp?.join(", ")],
    ["HTTP Port",   net.http_port],
    ["RTSP Port",   net.rtsp_port],
  ];

  return (
    <>
      <div className="cfp-section-title">Network Configuration</div>
      <div className="cfp-section-desc">Network settings reported by the camera via ONVIF</div>
      <div className="cfp-card">
        <table className="cfp-net-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td style={{ color: "#c9d4e8" }}>{fmt(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StreamsSection({ caps }) {
  const profiles = caps?.profiles || [];
  if (!profiles.length) {
    return <div className="cfp-card"><div style={{ color: "#4a5a72", fontSize: 12 }}>No stream profiles.</div></div>;
  }
  const LABELS = { MAIN: "cfp-chip--on", SUB: "cfp-chip--off", EXTRA: "cfp-chip--off" };
  return (
    <>
      <div className="cfp-section-title">Stream Profiles</div>
      <div className="cfp-section-desc">ONVIF video stream profiles available on this camera</div>
      {profiles.map((p, i) => (
        <div key={i} className="cfp-card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span className={cls("cfp-chip", LABELS[p.label] || "cfp-chip--off")}>{p.label}</span>
            <span style={{ fontSize: 13, color: "#e8edf5", fontWeight: 500 }}>{p.name}</span>
          </div>
          <div className="cfp-info-grid">
            {[
              ["Resolution", p.resolution],
              ["Encoding",   p.encoding],
              ["FPS",        p.fps ? `${p.fps} fps` : null],
              ["Bitrate",    p.bitrate ? `${p.bitrate} kbps` : null],
              ["Token",      p.token],
            ].map(([k, v]) => (
              <div key={k} className="cfp-info-item">
                <span className="cfp-info-key">{k}</span>
                <span className="cfp-info-val">{fmt(v)}</span>
              </div>
            ))}
          </div>
          {p.rtsp_url && (
            <div style={{ marginTop: 10, fontSize: 10, color: "#2563eb", wordBreak: "break-all" }}>
              {p.rtsp_url}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function AnalyticsSection({ device, caps, onCall, showToast }) {
  const an = caps?.capabilities?.analytics_info || {};
  const [enabled, setEnabled]   = useState(false);
  const [events,  setEvents]    = useState([]);
  const [loading, setLoading]   = useState(true);
  const [toggling, setToggling] = useState(false);

  const EVENT_COLORS = {
    motion:       { chip: "cfp-chip--on",  label: "Motion"       },
    tampering:    { chip: "cfp-chip--off", label: "Tampering"     },
    line_crossing:{ chip: "cfp-chip--on",  label: "Line Crossing" },
    intrusion:    { chip: "cfp-chip--on",  label: "Intrusion"     },
    face_detection:{ chip: "cfp-chip--on", label: "Face"          },
    audio_detection:{ chip: "cfp-chip--off",label: "Audio"        },
    other:        { chip: "cfp-chip--off", label: "Event"         },
  };

  // Check current status on mount
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/camera/analytics/status/${device.ip}`);
        const d   = await res.json();
        setEnabled(d.running);

        if (d.running) {
          const evRes = await fetch(`${API}/api/camera/analytics/events/${device.ip}?limit=30`);
          const evData = await evRes.json();
          setEvents(evData.events || []);
        }
      } catch(e) {}
      setLoading(false);
    })();
  }, [device.ip]);

  // Poll for new events every 5s if enabled
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/camera/analytics/events/${device.ip}?limit=30`);
        const d   = await res.json();
        setEvents(d.events || []);
      } catch(e) {}
    }, 5000);
    return () => clearInterval(interval);
  }, [enabled, device.ip]);

  const toggle = async () => {
    setToggling(true);
    const endpoint = enabled ? "/api/camera/analytics/disable" : "/api/camera/analytics/enable";
    const res = await onCall(endpoint, {
      ip: device.ip, port: device.port || 80,
      username: device.username || "", password: device.password || "",
    });
    if (res.success) {
      setEnabled(!enabled);
      if (!enabled) setEvents([]);
      showToast(res.message, "success");
    } else {
      showToast(res.error || "Failed", "error");
    }
    setToggling(false);
  };

  return (
    <>
      <div className="cfp-section-title">Analytics & Intelligence</div>
      <div className="cfp-section-desc">
        Enable to start receiving live events from this camera into the VMS
      </div>

      {/* Enable / Disable toggle card */}
      <div className="cfp-card">
        <div className="cfp-toggle-row">
          <div className="cfp-toggle-info">
            <div className="cfp-toggle-name">Analytics Engine</div>
            <div className="cfp-toggle-desc">
              {enabled
                ? "Polling camera for live events every 5s"
                : "Enable to start receiving motion, intrusion, and alarm events"}
            </div>
          </div>
          <label className="cfp-switch">
            <input
              type="checkbox"
              checked={enabled}
              disabled={toggling || loading}
              onChange={toggle}
            />
            <span className="cfp-switch-slider" />
          </label>
        </div>

        {/* Capability chips */}
        <div style={{ marginTop: 14 }}>
          <div className="cfp-info-key" style={{ marginBottom: 8 }}>Camera Supports</div>
          <div className="cfp-event-chips">
            {[
              ["Motion Detection",  caps?.capabilities?.event_info?.motion_detection],
              ["Tampering",         caps?.capabilities?.event_info?.tampering],
              ["Line Crossing",     caps?.capabilities?.event_info?.line_crossing],
              ["Intrusion",         caps?.capabilities?.event_info?.intrusion],
              ["Face Detection",    caps?.capabilities?.event_info?.face_detection],
              ["Audio Detection",   caps?.capabilities?.event_info?.audio_detection],
            ].map(([label, supported]) => (
              <span key={label} className={cls("cfp-chip", supported ? "cfp-chip--on" : "cfp-chip--off")}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Live event feed */}
      {enabled && (
        <div className="cfp-card">
          <div className="cfp-card-title">
            Live Event Feed
            <span className="cfp-nav-badge cfp-nav-badge--green">{events.length}</span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: "#22c55e" }}>● LIVE</span>
          </div>

          {events.length === 0 ? (
            <div style={{ color: "#4a5a72", fontSize: 12, padding: "8px 0" }}>
              Waiting for events from camera…
            </div>
          ) : (
            events.map((ev, i) => {
              const meta = EVENT_COLORS[ev.event_type] || EVENT_COLORS.other;
              const time = ev.received_at
                ? new Date(ev.received_at).toLocaleTimeString()
                : ev.utc_time;
              return (
                <div key={i} className="cfp-relay-row">
                  <div>
                    <div className="cfp-toggle-name">{meta.label}</div>
                    <div className="cfp-toggle-desc">{time}</div>
                  </div>
                  <span className={cls("cfp-chip", meta.chip)}
                    style={{ fontSize: 9, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {ev.topic?.split("/").slice(-2).join("/")}
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────
export default function CameraFeaturesPage({ onNavigate }) {
  const [device, setDevice]     = useState(null);
  const [caps, setCaps]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [toast, setToast]       = useState(null);

  // Load device from localStorage
 useEffect(() => {
  (async () => {
    try {
      const id      = localStorage.getItem("miradorai_selected_camera_id");
      const devices = JSON.parse(localStorage.getItem("miradorai_devices") || "[]");
      const dev     = devices.find(d => String(d.id) === String(id));
      if (!dev?.ip) { setError("Camera not found"); setLoading(false); return; }

      // Fetch full camera data including credentials from backend
      const res  = await fetch(`${API}/api/cameras/by-ip/${dev.ip}`);
      const full = await res.json();
      setDevice({ ...dev, ...full }); // merge — full DB record overrides localStorage
    } catch (e) {
      setError("Failed to load camera"); setLoading(false);
    }
  })();
}, []);

  // Fetch capabilities once device is loaded
  useEffect(() => {
    if (!device) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API}/api/camera/capabilities`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            ip:       device.ip,
            port:     device.port || 80,
            username: device.username || "",
            password: device.password || "",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Probe failed");
        setCaps(data);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [device]);

  // Generic API caller used by sub-sections
  const onCall = useCallback(async (endpoint, body) => {
    try {
      const res  = await fetch(`${API}${endpoint}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, []);

  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type, key: Date.now() });
  }, []);

  // Build nav — items without capKey always visible;
  // items with capKey only shown if camera supports it
  const c = caps?.capabilities || {};
  const visibleNav = NAV_SECTIONS.map(sec => ({
    ...sec,
    items: sec.items.filter(item => {
      if (!item.capKey) return true;
      if (!caps) return true; // still loading — show all grayed
      return c[item.capKey];
    }),
  })).filter(sec => sec.items.length > 0);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="cfp-loading">
          <div className="cfp-spinner" />
          <div className="cfp-loading-text">
            Probing {device?.name || device?.ip} — fetching all capabilities…
          </div>
        </div>
      );
    }
    if (error) {
      return (
        <div className="cfp-loading">
          <div style={{ color: "#f87171", fontSize: 13 }}>⚠ {error}</div>
          <button className="cfp-action-btn" onClick={() => window.location.reload()}>Retry</button>
        </div>
      );
    }

    const props = { device, caps, onCall, showToast };
    switch (activeTab) {
      case "overview":   return <OverviewSection  {...props} />;
      case "imaging":    return <ImagingSection   {...props} />;
      case "ptz":        return <PTZSection       {...props} />;
      case "events":     return <EventsSection    {...props} />;
      case "audio":      return <AudioSection     {...props} />;
      case "io":         return <IOSection        {...props} />;
      case "network":    return <NetworkSection   {...props} />;
      case "streams":    return <StreamsSection   {...props} />;
      case "analytics":  return <AnalyticsSection {...props} />;
case "masking":
  return <MaskingSection device={device} showToast={showToast} />;
        case "brand-features": return <BrandFeaturesSection {...props} />;
      default:           return <OverviewSection  {...props} />;

    }
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="cfp-root">

        {/* Header */}
        <div className="cfp-header">
          <button className="cfp-back" onClick={() => onNavigate?.("add-devices")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>
          <div className="cfp-header-info">
            <div className="cfp-eyebrow">Camera Features</div>
            <div className="cfp-title">
              {caps?.manufacturer || device?.manufacturer || "—"}{" "}
              {caps?.model        || device?.model        || ""}
            </div>
            <div className="cfp-subtitle">
              {device?.ip} · {device?.name}
            </div>
          </div>
          <div className={cls(
            "cfp-status-pill",
            loading ? "cfp-status-pill--loading" :
            error   ? "cfp-status-pill--error"   :
                      "cfp-status-pill--online"
          )}>
            {loading ? "Probing…" : error ? "Error" : "Connected"}
          </div>
        </div>

        <div className="cfp-layout">

          {/* Sidebar nav */}
          <nav className="cfp-sidebar">
            {visibleNav.map(sec => (
              <div key={sec.label} className="cfp-nav-section">
                <span className="cfp-nav-label">{sec.label}</span>
                {sec.items.map(item => {
                  const enabled = !item.capKey || !caps || c[item.capKey];
                  return (
                    <button
                      key={item.id}
                      className={cls(
                        "cfp-nav-item",
                        activeTab === item.id && "active",
                        !enabled && "disabled"
                      )}
                      onClick={() => enabled && setActiveTab(item.id)}
                    >
                      <span style={{ width: 16, textAlign: "center" }}>{item.icon}</span>
                      {item.label}
                      {item.id === "ptz" && caps?.capabilities?.ptz_info?.presets?.length > 0 && (
                        <span className="cfp-nav-badge cfp-nav-badge--green">
                          {caps.capabilities.ptz_info.presets.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Main content */}
          <main className="cfp-content">
            {renderContent()}
          </main>
        </div>

        {/* Toast */}
        {toast && (
          <Toast
            key={toast.key}
            msg={toast.msg}
            type={toast.type}
            onDone={() => setToast(null)}
          />
        )}
      </div>
    </>
  );
}