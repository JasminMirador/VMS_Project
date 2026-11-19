import React, { useState, useEffect } from "react";
import Toggle from "../../components/shared/Toggle";
import Button from "../../components/shared/Button";
import { useAuth } from "../../context/AuthContext";
import useActivityLogger from "../../hooks/useActivityLogger";
import { apiUrl } from "../../config/appConfig";
import "./ClientSettingsPage.css";

const LANGUAGES = [
  "English", "French", "German", "Spanish", "Italian",
  "Portuguese", "Japanese", "Chinese (Simplified)", "Arabic",
];

const THEMES = [
  {
    id: "system",
    label: "System",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Left half — light */}
        <rect x="4"  y="4"  width="28" height="56" fill="#f0f2f5" />
        <rect x="4"  y="4"  width="28" height="14" fill="#e0e0e0" />
        <rect x="8"  y="22" width="12" height="30" fill="#eeeeee" />
        <rect x="22" y="22" width="8"  height="6"  fill="#e0e0e0" />
        <rect x="22" y="32" width="8"  height="4"  fill="#e0e0e0" />
        {/* Right half — dark */}
        <rect x="32" y="4"  width="28" height="56" fill="#0d0f14" />
        <rect x="32" y="4"  width="28" height="14" fill="#13161e" />
        <rect x="36" y="22" width="12" height="30" fill="#1a1e28" />
        <rect x="50" y="22" width="8"  height="6"  fill="#252a38" />
        <rect x="50" y="32" width="8"  height="4"  fill="#252a38" />
        {/* Center divider */}
        <rect x="31" y="4"  width="2"  height="56" fill="#00c8a0" opacity="0.6" />
      </svg>
    ),
  },
  {
    id: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4"  y="4"  width="56" height="56" fill="#f0f2f5" />
        <rect x="4"  y="4"  width="56" height="14" fill="#e0e0e0" />
        <rect x="8"  y="22" width="20" height="34" fill="#eeeeee" />
        <rect x="32" y="22" width="24" height="8"  fill="#e0e0e0" />
        <rect x="32" y="34" width="24" height="4"  fill="#e0e0e0" />
        <rect x="32" y="42" width="16" height="4"  fill="#e0e0e0" />
        {/* Sun icon hint */}
        <circle cx="52" cy="10" r="4" fill="#ffb340" opacity="0.8" />
      </svg>
    ),
  },
  {
    id: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4"  y="4"  width="56" height="56" fill="#0d0f14" />
        <rect x="4"  y="4"  width="56" height="14" fill="#13161e" />
        <rect x="8"  y="22" width="20" height="34" fill="#1a1e28" />
        <rect x="32" y="22" width="24" height="8"  fill="#252a38" />
        <rect x="32" y="34" width="24" height="4"  fill="#252a38" />
        <rect x="32" y="42" width="16" height="4"  fill="#252a38" />
        {/* Moon icon hint */}
        <path d="M52 7 a5 5 0 0 1 0 8 a6 6 0 0 1 0-8z" fill="#8892a4" opacity="0.7" />
      </svg>
    ),
  },
];

/* ── Theme CSS variable sets ─────────────────────────────────── */
const THEME_VARS = {
  dark: {
    "--bg-base":        "#0d0f14",
    "--bg-surface":     "#13161e",
    "--bg-elevated":    "#1a1e28",
    "--bg-hover":       "#1f2433",
    "--bg-active":      "#1e2d3d",
    "--border":         "#252a38",
    "--border-light":   "#2e3548",
    "--text-primary":   "#e8eaf0",
    "--text-secondary": "#8892a4",
    "--text-muted":     "#505870",
  },
  light: {
    "--bg-base":        "#f0f2f5",
    "--bg-surface":     "#ffffff",
    "--bg-elevated":    "#f8f9fb",
    "--bg-hover":       "#edf0f5",
    "--bg-active":      "#dde3ee",
    "--border":         "#d0d6e0",
    "--border-light":   "#c0c8d8",
    "--text-primary":   "#111827",
    "--text-secondary": "#374151",
    "--text-muted":     "#6b7280",
  },
  system: {
    // resolved at runtime based on OS preference
  },
};

function applyTheme(themeId) {
  const root = document.documentElement;
  let resolved = themeId;

  if (themeId === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  // Set the data-theme attribute, which global.css uses to swap variables
  root.setAttribute("data-theme", resolved);

  // Remove any stale inline style variables that might have been injected previously
  root.removeAttribute("style");
  
  localStorage.setItem("miradorai_theme", themeId);
}

function Section({ title, children }) {
  return (
    <div className="cs-section">
      <div className="cs-section__title">{title}</div>
      <div className="cs-section__body">{children}</div>
    </div>
  );
}

function SettingRow({ label, hint, children }) {
  return (
    <div className="cs-row">
      <div className="cs-row__label">
        <span>{label}</span>
        {hint && <span className="cs-row__hint" title={hint}>ℹ</span>}
      </div>
      <div className="cs-row__control">{children}</div>
    </div>
  );
}

export default function ClientSettingsPage() {
  const { user } = useAuth();
  const { logAction } = useActivityLogger();
  const role = user?.role || "client";
  
  // Format role for display: "operator" -> "Operator", "admin" -> "Admin"
  const roleDisplay = role === "admin" ? "Admin" : 
                      role === "operator" ? "Operator" : "Client";

  const [theme,          setTheme]          = useState(() => localStorage.getItem("miradorai_theme") || "dark");
  const [runOnStart,     setRunOnStart]     = useState(false);
  const [showWhatsNew,   setShowWhatsNew]   = useState(true);
  const [showCamNames,   setShowCamNames]   = useState(() => {
    const val = localStorage.getItem("miradorai_show_cam_names");
    return val !== "false";
  });
  const [showRecInd,     setShowRecInd]     = useState(() => {
    const val = localStorage.getItem("miradorai_show_rec_ind");
    return val !== "false";
  });
  const [showEventInd,   setShowEventInd]   = useState(() => {
    const val = localStorage.getItem("miradorai_show_event_ind");
    return val !== "false";
  });
  const [flashCoverage,  setFlashCoverage]  = useState(true);
  const [language,       setLanguage]       = useState("English");
  const [shareAnonymous, setShareAnonymous] = useState(true);
  const [watermarkText,  setWatermarkText]  = useState(() => localStorage.getItem("miradorai_video_watermark") || "");
  const [watermarkPos,   setWatermarkPos]   = useState(() => localStorage.getItem("miradorai_video_watermark_pos") || "center");
  const [saveStatus,     setSaveStatus]     = useState("");

  // Apply saved theme on mount
  useEffect(() => {
    applyTheme(theme);
  }, []);

  // Fetch watermark settings from backend on mount
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token") || "";
        const res = await fetch(apiUrl("/recordings/watermark-settings"), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data.watermark === "string") {
            if (!localStorage.getItem("miradorai_video_watermark") && data.watermark) {
              setWatermarkText(data.watermark);
              localStorage.setItem("miradorai_video_watermark", data.watermark);
            }
            if (!localStorage.getItem("miradorai_video_watermark_pos") && data.watermark_pos) {
              setWatermarkPos(data.watermark_pos);
              localStorage.setItem("miradorai_video_watermark_pos", data.watermark_pos);
            }
          }
        }
      } catch (_) {}
    })();
  }, []);

  const handleThemeChange = (id) => {
    setTheme(id);
    applyTheme(id);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">{roleDisplay} <span>Settings</span></h1>
          <p className="page-desc">
            These settings apply to all MIRADOR VMS users on this computer.
          </p>
        </div>
      </div>

      <div className="cs-body">

        {/* ── Theme ── */}
        <Section title="Theme">
          <div className="cs-themes">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`cs-theme-card${theme === t.id ? " cs-theme-card--active" : ""}`}
                onClick={() => handleThemeChange(t.id)}
              >
                <div className="cs-theme-card__icon">{t.icon}</div>
                <span className="cs-theme-card__label">{t.label}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* ── General ── */}
        <Section title="General">
          <SettingRow label="Run application when Windows starts">
            <Toggle value={runOnStart} onChange={setRunOnStart} />
          </SettingRow>
          <SettingRow label="Show What's new after each update">
            <Toggle value={showWhatsNew} onChange={setShowWhatsNew} />
          </SettingRow>
        </Section>

        {/* ── Live view ── */}
        <Section title="Live view">
          <SettingRow label="Show camera names in live views">
            <Toggle value={showCamNames} onChange={(val) => {
              setShowCamNames(val);
              localStorage.setItem("miradorai_show_cam_names", val ? "true" : "false");
            }} />
          </SettingRow>
          <SettingRow label="Show recording indicators in live views and maps">
            <Toggle value={showRecInd} onChange={(val) => {
              setShowRecInd(val);
              localStorage.setItem("miradorai_show_rec_ind", val ? "true" : "false");
            }} />
          </SettingRow>
          <SettingRow label="Show event indicators in live views and maps">
            <Toggle value={showEventInd} onChange={(val) => {
              setShowEventInd(val);
              localStorage.setItem("miradorai_show_event_ind", val ? "true" : "false");
            }} />
          </SettingRow>
        </Section>

        {/* ── Maps ── */}
        {/*
        <Section title="Maps">
          <SettingRow
            label="Allow flashing coverage areas for all maps"
            hint="Flashing coverage areas highlight camera fields of view on the map."
          >
            <Toggle value={flashCoverage} onChange={setFlashCoverage} />
          </SettingRow>
        </Section>
        */}

        {/* ── Language ── */}
        <Section title="Language">
          <div className="cs-lang-wrap">
            <select className="cs-select" value={language}
              onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
            </select>
            <p className="cs-lang-hint">
              Language changes will take effect when you restart the application.
            </p>
          </div>
        </Section>

        {/* ── Feedback ── */}
        {/*
        <Section title="Feedback">
          <label className="cs-checkbox-row">
            <input type="checkbox" checked={shareAnonymous}
              onChange={(e) => setShareAnonymous(e.target.checked)} />
            <span>
              Share anonymous client usage data with MIRADOR to help us improve the
              application and your user experience.
            </span>
          </label>
          <p className="cs-feedback-hint">
            Edit anonymous server usage data setting in the Server Settings under the
            Configuration tab.
          </p>
        </Section>
        */}

        {/* ── Video Watermark ── */}
        <Section title="Video Watermark (Overlay on Exports & Downloads)">
          <SettingRow
            label="Watermark Text"
            hint="Watermark text burned into downloaded and exported videos across the system"
          >
            <input
              type="text"
              placeholder="e.g. CONFIDENTIAL or MIRADOR VMS"
              value={watermarkText}
              onChange={(e) => {
                setWatermarkText(e.target.value);
                localStorage.setItem("miradorai_video_watermark", e.target.value);
              }}
              className="cs-select"
              style={{ width: "260px", padding: "8px 12px" }}
            />
          </SettingRow>
          <SettingRow
            label="Watermark Position"
            hint="Placement of watermark on video frames"
          >
            <select
              className="cs-select"
              value={watermarkPos}
              onChange={(e) => {
                setWatermarkPos(e.target.value);
                localStorage.setItem("miradorai_video_watermark_pos", e.target.value);
              }}
              style={{ width: "260px" }}
            >
              <option value="center">Center</option>
              <option value="bottom-right">Bottom-Right</option>
              <option value="bottom-center">Bottom-Center</option>
              <option value="top-center">Top-Center</option>
            </select>
          </SettingRow>
        </Section>

      </div>

      <div className="page-footer">
        {saveStatus && (
          <span style={{ color: "#10b981", fontSize: "14px", fontWeight: "500" }}>{saveStatus}</span>
        )}
        {!saveStatus && <span />}
        <div className="page-footer-right">
          <Button label="Apply" variant="primary" onClick={async () => {
            applyTheme(theme);
            localStorage.setItem("miradorai_video_watermark", watermarkText);
            localStorage.setItem("miradorai_video_watermark_pos", watermarkPos);

            // Also persist to server database so all downloads, exports, and clients share it
            try {
              const token = localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token") || "";
              await fetch(apiUrl("/recordings/watermark-settings"), {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ watermark: watermarkText, watermark_pos: watermarkPos }),
              });
            } catch (err) {
              console.error("Failed to save watermark settings to backend:", err);
            }

            logAction("Updated Client Settings", "settings", { theme, language, showCamNames, watermarkText, watermarkPos });
            setSaveStatus("Settings applied successfully!");
            setTimeout(() => setSaveStatus(""), 3000);
          }} />
        </div>
      </div>
    </div>
  );
}