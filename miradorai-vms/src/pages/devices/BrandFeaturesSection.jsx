/**
 * BrandFeaturesSection.jsx
 *
 * Controls motion detection, smart events, and snapshots
 * directly from VMS UI using the camera's native HTTP API.
 *
 * ADD TO NAV_SECTIONS in CameraFeaturesPage.jsx under "Intelligence":
 *   { id: "brand-features", label: "Event Settings", icon: "◉", capKey: null }
 *
 * ADD TO renderContent() switch:
 *   case "brand-features": return <BrandFeaturesSection {...props} />;
 */

import { useState, useEffect } from "react";
import { getNumber, apiUrl } from '../../config/appConfig';


// Brand display config — purely cosmetic
const BRAND_META = {
  dahua:     { color: "#f4a261", label: "Dahua CGI API"   },
  hikvision: { color: "#e63946", label: "Hikvision ISAPI" },
  axis:      { color: "#2a9d8f", label: "Axis VAPIX"      },
  bosch:     { color: "#4361ee", label: "Bosch REST"      },
  generic:   { color: "#6b7a99", label: "ONVIF Only"      },
};

// Smart event labels per brand
const SMART_EVENT_LABELS = {
  LineDetection:       { label: "Line Crossing",       icon: "⟋" },
  FieldDetection:      { label: "Intrusion Detection", icon: "⬡" },
  FaceDetect:          { label: "Face Detection",      icon: "◉" },
  CrossRegionDetection:{ label: "Region Detection",    icon: "⬢" },
  SmartMotionDetect:   { label: "Smart Motion",        icon: "◈" },
};

// ── Safe fetch helper ─────────────────────────────────────────────
// Returns parsed JSON or null. Never throws.
async function safeFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      console.error(`[BrandFeatures] HTTP ${res.status} for ${url}`);
      return null;
    }
    const text = await res.text();
    if (!text || !text.trim()) {
      console.error(`[BrandFeatures] Empty response for ${url}`);
      return null;
    }
    return JSON.parse(text);
  } catch (e) {
    console.error(`[BrandFeatures] fetch/parse error for ${url}:`, e);
    return null;
  }
}

export default function BrandFeaturesSection({ device, caps, showToast }) {
  const [brandCaps,   setBrandCaps]   = useState(null);
  const [motion,      setMotion]      = useState(null);
  const [smartEvents, setSmartEvents] = useState({});
  const [snapshot,    setSnapshot]    = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [applying,    setApplying]    = useState({});
  const [snapLoading, setSnapLoading] = useState(false);
  const [brand,       setBrand]       = useState("generic");

  // ── Load everything on mount ──────────────────────────────────
  useEffect(() => {
    if (!device?.ip) return;

    (async () => {
      setLoading(true);
      try {
        const authQuery =
          `username=${encodeURIComponent(device.username || "")}&password=${encodeURIComponent(device.password || "")}`;

        // 1. Get brand capabilities
        const capData = await safeFetch(
          apiUrl(`/camera/brand/capabilities/${device.ip}?${authQuery}`)
        );

        if (!capData) {
          console.warn("[BrandFeatures] Could not load brand capabilities.");
          setLoading(false);
          return;
        }

        const capabilities = capData.capabilities || {};
        const detectedBrand = capabilities.brand || "generic";

        setBrandCaps(capabilities);
        setBrand(detectedBrand);

        // 2. Get motion state
        if (capabilities.motion_detect) {
          const mData = await safeFetch(
            apiUrl(`/camera/brand/motion/${device.ip}?${authQuery}`)
          );
          if (mData?.success) {
            setMotion(mData.motion || null);
          }
        }

        // 3. Get smart events state
        const evData = await safeFetch(
          apiUrl(`/camera/brand/smart-events/${device.ip}?${authQuery}`)
        );
        if (evData?.success) {
          setSmartEvents(evData.smart_events || {});
        }

      } catch (e) {
        console.error("[BrandFeatures] load failed:", e);
      }

      setLoading(false);
    })();
  }, [device?.ip]);

  // ── Toggle motion detection ───────────────────────────────────
  const toggleMotion = async (enabled) => {
    setApplying(a => ({ ...a, motion: true }));
    try {
      const data = await safeFetch(apiUrl('/camera/brand/motion/set'), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip:          device.ip,
          port:        device.port || getNumber("CAMERA_DEFAULT_PORT", 80),
          username:    device.username || "",
          password:    device.password || "",
          enabled,
          sensitivity: motion?.sensitivity ?? 60,
          channel:     1,
        }),
      });

      if (!data) {
        showToast("No response from server — check camera connection", "error");
      } else if (data.success) {
        setMotion(m => ({ ...m, enabled }));
        showToast(`Motion detection ${enabled ? "enabled" : "disabled"}`, "success");
      } else {
        showToast(data.error || "Failed to update motion detection", "error");
      }
    } catch (e) {
      showToast("Request failed: " + e.message, "error");
    }
    setApplying(a => ({ ...a, motion: false }));
  };

  // ── Toggle smart event ────────────────────────────────────────
  const toggleSmartEvent = async (eventType, enabled) => {
    setApplying(a => ({ ...a, [eventType]: true }));
    try {
      const data = await safeFetch(apiUrl('/camera/brand/smart-events/set'), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip:         device.ip,
          port:       device.port || getNumber("CAMERA_DEFAULT_PORT", 80),
          username:   device.username || "",
          password:   device.password || "",
          event_type: eventType,
          enabled,
          channel:    1,
        }),
      });

      if (!data) {
        showToast("No response from server", "error");
      } else if (data.success) {
        setSmartEvents(ev => ({
          ...ev,
          [eventType]: { ...ev[eventType], enabled },
        }));
        showToast(
          `${SMART_EVENT_LABELS[eventType]?.label || eventType} ${enabled ? "enabled" : "disabled"}`,
          "success"
        );
      } else {
        showToast(data.error || "Failed to update smart event", "error");
      }
    } catch (e) {
      showToast("Request failed: " + e.message, "error");
    }
    setApplying(a => ({ ...a, [eventType]: false }));
  };

  // ── Take snapshot ─────────────────────────────────────────────
  const takeSnapshot = async () => {
    setSnapLoading(true);
    try {
      const authQuery =
        `username=${encodeURIComponent(device.username || "")}&password=${encodeURIComponent(device.password || "")}`;

      const data = await safeFetch(
        apiUrl(`/camera/brand/snapshot/${device.ip}?${authQuery}`)
      );

      if (!data) {
        showToast("No response from server", "error");
      } else if (data.success) {
        setSnapshot(data.snapshot);
        // NEW INTEGRATION: Send to backend to save to folder
        import('../../utils/snapshotUtils').then(({ saveSnapshotToBackend }) => {
          saveSnapshotToBackend(data.snapshot, device.name, settings, showToast);
        });
      } else {
        showToast(data.error || "Snapshot failed", "error");
      }
    } catch (e) {
      showToast("Snapshot failed: " + e.message, "error");
    }
    setSnapLoading(false);
  };

  // ── Sensitivity slider commit ─────────────────────────────────
  const applySensitivity = async (value) => {
    setApplying(a => ({ ...a, sensitivity: true }));
    try {
      const data = await safeFetch(apiUrl('/camera/brand/motion/set'), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip:          device.ip,
          port:        device.port || getNumber("CAMERA_DEFAULT_PORT", 80),
          username:    device.username || "",
          password:    device.password || "",
          enabled:     motion?.enabled ?? true,
          sensitivity: value,
          channel:     1,
        }),
      });

      if (!data) {
        showToast("No response from server", "error");
      } else if (data.success) {
        setMotion(m => ({ ...m, sensitivity: value }));
        showToast(`Sensitivity set to ${value}`, "success");
      } else {
        showToast(data.error || "Failed to set sensitivity", "error");
      }
    } catch (e) {
      showToast("Failed: " + e.message, "error");
    }
    setApplying(a => ({ ...a, sensitivity: false }));
  };

  // ─────────────────────────────────────────────────────────────
  const brandMeta = BRAND_META[brand] || BRAND_META.generic;

  if (loading) {
    return (
      <div className="cfp-loading">
        <div className="cfp-spinner" />
        <div className="cfp-loading-text">Fetching camera event settings…</div>
      </div>
    );
  }

  // Generic / unsupported brand
  if (brand === "generic" || !brandCaps) {
    return (
      <>
        <div className="cfp-section-title">Event Settings</div>
        <div className="cfp-section-desc">Native camera event configuration</div>
        <div className="cfp-card" style={{ borderColor: "#f59e0b40" }}>
          <div style={{ color: "#f59e0b", fontSize: 13, marginBottom: 8 }}>
            ⚠ Brand API not detected for this camera
          </div>
          <div style={{ color: "#4a5a72", fontSize: 11, lineHeight: 1.6 }}>
            Go to <strong style={{ color: "#c9d4e8" }}>API Profile tab</strong> and click
            <strong style={{ color: "#3b82f6" }}> Re-scan</strong> to detect the camera's
            native API. Once detected, all event controls will appear here.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="cfp-section-title">Event Settings</div>
      <div className="cfp-section-desc">
        Configure camera events directly — no need to open the camera web UI
      </div>

      {/* Brand badge */}
      <div className="cfp-card" style={{ borderColor: brandMeta.color + "40", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            background:    brandMeta.color + "18",
            border:        `1px solid ${brandMeta.color}40`,
            borderRadius:  6,
            padding:       "4px 12px",
            color:         brandMeta.color,
            fontSize:      11,
            fontWeight:    600,
            letterSpacing: "0.06em",
          }}>
            {brandMeta.label}
          </div>
          <span style={{ color: "#4a5a72", fontSize: 11 }}>
            {device.ip} · Changes apply immediately to camera
          </span>
        </div>
      </div>

      {/* ── Motion Detection ── */}
      {brandCaps.motion_detect && (
        <div className="cfp-card">
          <div className="cfp-card-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
            Motion Detection
          </div>

          <div className="cfp-toggle-row">
            <div className="cfp-toggle-info">
              <div className="cfp-toggle-name">Enable Motion Detection</div>
              <div className="cfp-toggle-desc">
                {motion?.enabled
                  ? "Camera is detecting motion and sending alerts"
                  : "Motion detection is off — no motion events will be generated"}
              </div>
            </div>
            <label className="cfp-switch">
              <input
                type="checkbox"
                checked={!!motion?.enabled}
                disabled={!!applying.motion}
                onChange={e => toggleMotion(e.target.checked)}
              />
              <span className="cfp-switch-slider" />
            </label>
          </div>

          {motion?.enabled && (
            <div style={{ marginTop: 14 }}>
              <SensitivitySlider
                value={motion?.sensitivity ?? 60}
                disabled={!!applying.sensitivity}
                onCommit={applySensitivity}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Smart Events ── */}
      {Object.keys(smartEvents).length > 0 && (
        <div className="cfp-card">
          <div className="cfp-card-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            Smart Events
          </div>

          {Object.entries(smartEvents).map(([eventType, state]) => {
            const meta = SMART_EVENT_LABELS[eventType] || { label: eventType, icon: "◎" };
            return (
              <div key={eventType} className="cfp-toggle-row">
                <div className="cfp-toggle-info">
                  <div className="cfp-toggle-name">
                    <span style={{ marginRight: 8, opacity: 0.7 }}>{meta.icon}</span>
                    {meta.label}
                  </div>
                  <div className="cfp-toggle-desc">
                    {state.enabled
                      ? "Active — camera will trigger alerts for this event"
                      : "Inactive — enable to start receiving these alerts in VMS"}
                  </div>
                </div>
                <label className="cfp-switch">
                  <input
                    type="checkbox"
                    checked={!!state.enabled}
                    disabled={!!applying[eventType]}
                    onChange={e => toggleSmartEvent(eventType, e.target.checked)}
                  />
                  <span className="cfp-switch-slider" />
                </label>
              </div>
            );
          })}
        </div>
      )}

      {/* No smart events detected */}
      {Object.keys(smartEvents).length === 0 && brandCaps.motion_detect && (
        <div className="cfp-card">
          <div style={{ color: "#4a5a72", fontSize: 12 }}>
            No smart events detected on this camera model.
            Only basic motion detection is available.
          </div>
        </div>
      )}

      {/* ── Snapshot ── */}
      {brandCaps.snapshot && (
        <div className="cfp-card">
          <div className="cfp-card-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Live Snapshot
          </div>

          <button
            className="cfp-action-btn"
            onClick={takeSnapshot}
            disabled={snapLoading}
            style={{ marginBottom: snapshot ? 12 : 0 }}
          >
            {snapLoading ? "Capturing…" : "Take Snapshot"}
          </button>

          {snapshot && (
            <div style={{ marginTop: 12 }}>
              <img
                src={snapshot}
                alt="Camera snapshot"
                style={{
                  width: "100%", borderRadius: 8,
                  border: "1px solid #1a2332",
                  display: "block",
                }}
              />
              <div style={{ fontSize: 10, color: "#2e3d55", marginTop: 6 }}>
                Captured at {new Date().toLocaleTimeString()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Nothing available ── */}
      {!brandCaps.motion_detect && Object.keys(smartEvents).length === 0 && !brandCaps.snapshot && (
        <div className="cfp-card" style={{ borderColor: "#f59e0b40" }}>
          <div style={{ color: "#f59e0b", fontSize: 12, marginBottom: 6 }}>
            ⚠ Camera API detected but no controllable features found
          </div>
          <div style={{ color: "#4a5a72", fontSize: 11 }}>
            This may be a basic camera model that only supports streaming.
            Try the Analytics tab to receive ONVIF events instead.
          </div>
        </div>
      )}
    </>
  );
}

// ── Sensitivity slider sub-component ─────────────────────────────
function SensitivitySlider({ value, disabled, onCommit }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  const level =
    local < 30 ? "Low" :
    local < 60 ? "Medium" :
    local < 85 ? "High" : "Very High";

  const levelColor =
    local < 30 ? "#4a5a72" :
    local < 60 ? "#f4a261" :
    local < 85 ? "#f97316" : "#ef4444";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", marginBottom: 8 }}>
        <span className="cfp-slider-label">Sensitivity</span>
        <span style={{ fontSize: 11, color: levelColor, fontWeight: 500 }}>
          {level} ({local})
        </span>
      </div>
      <input
        type="range"
        className="cfp-slider"
        min={0} max={100} step={5}
        value={local}
        disabled={disabled}
        onChange={e => setLocal(Number(e.target.value))}
        onMouseUp={() => onCommit(local)}
        onTouchEnd={() => onCommit(local)}
        style={{ opacity: disabled ? 0.5 : 1 }}
      />
      <div style={{ display: "flex", justifyContent: "space-between",
                    fontSize: 9, color: "#2e3d55", marginTop: 4 }}>
        <span>Low</span><span>Medium</span><span>High</span><span>Very High</span>
      </div>
    </div>
  );
}