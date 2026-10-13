import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { NAV_CONFIG } from "../../data/navConfig";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useUserSettings } from "../../context/UserSettingsContext";
import { useNotifications } from "../../context/NotificationContext";
import logoImg from "../../assets/logo.jpg";
import { useI18n } from "../../i18n";
import { Icon, iconSvg } from "./topbarIcons";
import Dock from "../shared/Dock/Dock";
import "./TopBar.css";
import "./SupervisorModal.css";

const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "";

// ---- Language Selector ----
const LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English", sub: "English · LTR", flag: "EN" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", sub: "Arabic · RTL", flag: "AR" },
];

// ---- Fullscreen toggle (icon button, same look as the language button) ----
function FullscreenButton() {
  const { t } = useI18n();
  const [isFullscreen, setIsFullscreen] = useState(
    () => !!document.fullscreenElement
  );

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Hide where the Fullscreen API isn't available (e.g. iPhone Safari)
  if (!document.documentElement.requestFullscreen) return null;

  const toggle = () => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen?.()?.catch?.(() => {});
      } else {
        document.documentElement.requestFullscreen()?.catch?.(() => {});
      }
    } catch (e) {
      // Browser refused (permissions policy / not a user gesture) — ignore
    }
  };

  const label = t(isFullscreen ? "topbar.exitFullscreen" : "topbar.enterFullscreen");

  return (
    <button
      type="button"
      className="topbar__lang-btn topbar__fullscreen-btn"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={isFullscreen}
    >
      <Icon name={isFullscreen ? "fullscreenExit" : "fullscreen"} width="20" height="20" />
    </button>
  );
}

function LanguageSelector({ language, onLanguageChange }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const currentLang =
    LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);

    return () => {
      document.removeEventListener("mousedown", handler);
    };
  }, []);

  const handleSelect = (code) => {
    onLanguageChange(code);

    document.documentElement.dir = code === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = code;

    setOpen(false);
  };

  return (
    <div
      className="topbar__lang-wrap notranslate"
      translate="no"
      dir="ltr"
      ref={wrapRef}
    >
      <button
        type="button"
        className={`topbar__lang-btn notranslate ${open ? "topbar__lang-btn--active" : ""}`}
        translate="no"
        dir="ltr"
        onClick={() => setOpen((p) => !p)}
        title={t("topbar.switchLanguage")}
        aria-label={t("topbar.switchLanguage")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* languages icon */}
        <Icon name="language" width="20" height="20" />
      </button>

      {open && (
        <div className="topbar__lang-dropdown" role="menu">
          {LANGUAGES.map((lang) => {
            const selected = currentLang.code === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                className={`topbar__lang-option ${selected ? "topbar__lang-option--selected" : ""}`}
                onClick={() => handleSelect(lang.code)}
                role="menuitemradio"
                aria-checked={selected}
              >
                <span className="topbar__lang-text notranslate" translate="no">
                  <span className="topbar__lang-name">{lang.nativeLabel}</span>
                  <span className="topbar__lang-sub">{lang.sub}</span>
                </span>

                {selected && (
                  <svg
                    className="topbar__lang-check"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function loadDevices() {
  try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
  catch { return []; }
}
function loadAlarms() {
  try { return JSON.parse(localStorage.getItem("miradorai_alarms") || "[]"); }
  catch { return []; }
}



// ---- Supervisor Details Modal ----
function SupervisorDetailsModal({ onClose, onStatusChange }) {
  const { t } = useI18n();
  const [newPass, setNewPass]   = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showPass, setShowPass] = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [status, setStatus]     = useState(null); // { exists, updatedAt, setBy }
  const [statusLoading, setStatusLoading] = useState(true);

  // Load supervisor password status on mount
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
        const res = await fetch(`${API_BASE}/api/auth/supervisor-status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (err) {
        console.error("[AUTH] Supervisor status check failed:", err);
      } finally {
        setStatusLoading(false);
      }
    };
    fetchStatus();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    if (newPass.length < 4) {
      setError(t("supervisor.minLength"));
      return;
    }
    if (newPass !== confirm) {
      setError(t("supervisor.mismatch"));
      return;
    }

    setLoading(true);
    try {
      const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
      const res = await fetch(`${API_BASE}/api/auth/supervisor-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ password: newPass, confirm_password: confirm }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || t("supervisor.saveFailed"));
      }
      setSaved(true);
      setNewPass("");
      setConfirm("");
      setStatus({ exists: true, updatedAt: new Date().toISOString() });
      if (onStatusChange) onStatusChange(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("[AUTH] Supervisor save error:", err);
      setError(err.message || t("supervisor.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(t("supervisor.resetConfirm"))) return;
    setError("");
    setLoading(true);
    try {
      const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
      const res = await fetch(`${API_BASE}/api/auth/supervisor-password`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || t("supervisor.resetFailed"));
      }
      setStatus({ exists: false });
      if (onStatusChange) onStatusChange(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("[AUTH] Supervisor reset error:", err);
      setError(err.message || t("supervisor.resetFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sv-overlay" role="dialog" aria-modal="true">
      <div className="sv-backdrop" onClick={onClose} />
      <div className="sv-modal" style={{ maxWidth: 420 }}>
        {/* Icon */}
        <div className="sv-icon-wrap">
          <svg className="sv-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 className="sv-title">{t("supervisor.title")}</h2>

        {/* Status Indicator */}
        {!statusLoading && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "8px 14px", borderRadius: 8, margin: "0 auto 12px",
            background: status?.exists ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.08)",
            border: `1px solid ${status?.exists ? "rgba(16, 185, 129, 0.2)" : "rgba(245, 158, 11, 0.2)"}`,
            fontSize: 12, fontWeight: 600, width: "fit-content",
            color: status?.exists ? "#34d399" : "#fbbf24",
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              {status?.exists ? (
                <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>
              ) : (
                <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
              )}
            </svg>
            {status?.exists ? t("supervisor.configured") : t("supervisor.notConfiguredDefault")}
          </div>
        )}

        <form onSubmit={handleSave} className="sv-form">
          <div className="sv-field">
            <label className="sv-label">{status?.exists ? t("supervisor.updatePassword") : t("supervisor.newPassword")}</label>
            <div className="sv-input-wrap">
              <input
                type={showPass ? "text" : "password"}
                className="sv-input"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder={t("supervisor.enterNewPassword")}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="sv-eye-btn"
                onClick={() => setShowPass((p) => !p)}
                tabIndex={-1}
              >
                {showPass ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="sv-field">
            <label className="sv-label">{t("supervisor.confirmPassword")}</label>
            <div className="sv-input-wrap">
              <input
                type={showPass ? "text" : "password"}
                className="sv-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("supervisor.confirmNewPassword")}
                autoComplete="new-password"
              />
            </div>
          </div>

          {error && <div className="sv-error">{error}</div>}
          {saved && <div className="sv-success">{status?.exists === false ? t("supervisor.resetDone") : t("supervisor.saved")}</div>}

          <div className="sv-actions">
            <button type="button" className="sv-btn-cancel" onClick={onClose}>{t("common.cancel")}</button>
            {status?.exists && (
              <button type="button" className="sv-btn-cancel" onClick={handleReset} disabled={loading} style={{ color: "#f87171", borderColor: "rgba(239,68,68,0.2)" }}>
                {t("common.reset")}
              </button>
            )}
            <button type="submit" className="sv-btn-verify" disabled={!newPass || !confirm || loading}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v14z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {status?.exists ? t("supervisor.updatePassword") : t("supervisor.savePassword")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TopBar({
  activePage,
  onNavigate,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onAlarmsClick,
  alarmsOpen,
  language,
  onLanguageChange,
}) {
  const [camCount,   setCamCount]   = useState(0);
  const [alarmCount, setAlarmCount] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showSupervisorDetails, setShowSupervisorDetails] = useState(false);
  const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);
  const [supervisorConfigured, setSupervisorConfigured] = useState(null); // null=loading, true/false
  const [isAiActive, setIsAiActive] = useState(false);
  const [aiIp, setAiIp] = useState("");

  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { settings } = useUserSettings();
  const { showToast } = useNotifications();
  const [isCapturing, setIsCapturing] = useState(false);
  const [snapshotPreview, setSnapshotPreview] = useState(null);
  const navigate = useNavigate();
  const role = user?.role;
  const { t, tText } = useI18n();
  
  // Sidebar open/closed state (owned by Sidebar.jsx, mirrored here for the toggle button)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "true"
  );
  useEffect(() => {
    const onState = (e) => setSidebarCollapsed(!!e.detail?.collapsed);
    window.addEventListener("sidebar-state", onState);
    return () => window.removeEventListener("sidebar-state", onState);
  }, []);

  const userRef = useRef(null);
  const settingsRef = useRef(null);

  // Keep the account menu anchored to the user button and above all page layers.
  const [userMenuPosition, setUserMenuPosition] = useState({
  top: 0,
  left: "auto",
  right: 0,
});

const updateUserMenuPosition = () => {
  if (!userRef.current) return;

  const rect = userRef.current.getBoundingClientRect();
  const isRTL = document.documentElement.dir === "rtl";

  if (isRTL) {
    setUserMenuPosition({
      top: Math.round(rect.bottom + 10),
      left: Math.max(12, Math.round(rect.left)),
      right: "auto",
    });
  } else {
    setUserMenuPosition({
      top: Math.round(rect.bottom + 10),
      left: "auto",
      right: Math.max(
        12,
        Math.round(window.innerWidth - rect.right)
      ),
    });
  }
};

  useEffect(() => {
    if (!userMenuOpen) return;

    updateUserMenuPosition();

    const handlePositionChange = () => updateUserMenuPosition();
    window.addEventListener("resize", handlePositionChange);
    window.addEventListener("scroll", handlePositionChange, true);

    return () => {
      window.removeEventListener("resize", handlePositionChange);
      window.removeEventListener("scroll", handlePositionChange, true);
    };
  }, [userMenuOpen]);

  const handleAppSnapshot = async () => {
    if (isCapturing) return;
    setIsCapturing(true);

    try {
      const html2canvas = (await import("html2canvas")).default;
      const targetEl = document.getElementById("root") || document.body;
      const isLight = document.documentElement.getAttribute("data-theme") === "light";
      const canvas = await html2canvas(targetEl, {
        useCORS: true,
        allowTaint: true,
        scale: window.devicePixelRatio || 2,
        logging: false,
        backgroundColor: isLight ? "#f8fafc" : "#0a0c10",
        onclone: (clonedDoc) => {
          const styleOverride = clonedDoc.createElement("style");
          styleOverride.textContent = `
            h1, h2, h3, h4, h5, h6,
            [class*="page-title"],
            [class*="title"],
            [class*="heading"],
            .us-page-title,
            .lv-page-title,
            .dv-page-title {
              background: none !important;
              background-image: none !important;
              -webkit-background-clip: initial !important;
              background-clip: initial !important;
              -webkit-text-fill-color: initial !important;
              color: ${isLight ? "#0d7844" : "#10b981"} !important;
            }
          `;
          clonedDoc.head.appendChild(styleOverride);

          const allElements = clonedDoc.querySelectorAll("*");
          allElements.forEach((el) => {
            const comp = window.getComputedStyle(el);
            const webkitFill = comp.webkitTextFillColor || "";
            const webkitClip = comp.webkitBackgroundClip || comp.backgroundClip || "";
            const className = typeof el.className === "string" ? el.className : "";
            
            if (
              webkitClip === "text" ||
              webkitFill === "transparent" ||
              webkitFill.includes("rgba(0, 0, 0, 0)") ||
              className.includes("title") ||
              className.includes("heading") ||
              /^H[1-6]$/.test(el.tagName)
            ) {
              el.style.setProperty("background", "none", "important");
              el.style.setProperty("background-image", "none", "important");
              el.style.setProperty("-webkit-background-clip", "border-box", "important");
              el.style.setProperty("background-clip", "border-box", "important");
              el.style.setProperty("-webkit-text-fill-color", isLight ? "#0d7844" : "#10b981", "important");
              el.style.setProperty("color", isLight ? "#0d7844" : "#10b981", "important");
            }
          });
        },
      });

      const base64Data = canvas.toDataURL("image/jpeg", 0.95);
      const pageName = window.location.pathname.split('/').pop() || 'ui';

      // Instantly show the captured image popup for exactly 0.5s (500ms)
      setSnapshotPreview(base64Data);
      setTimeout(() => {
        setSnapshotPreview(null);
      }, 500);

      const { saveSnapshotToBackend } = await import("../../utils/snapshotUtils");
      saveSnapshotToBackend(base64Data, 'AppSnapshot_' + pageName, settings, (msg, type, persistent) => {
         showToast({ title: '', body: t("topbar.snapshotCaptured"), variant: type || 'success', persistent });
      });
    } catch (err) {
      console.error("[SNAPSHOT] App snapshot failed:", err);
      showToast({ title: '', body: err.message || t("topbar.snapshotFailed"), variant: 'error' });
    } finally {
      setIsCapturing(false);
    }
  };

  useEffect(() => {
    const fetchAiStatus = async () => {
      try {
        const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token")) || localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/api/integrations`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          const hasAi = data.find(i => i.isActive && (i.type?.toLowerCase().includes('ai') || i.serverName?.toLowerCase().includes('ai') || i.serverIp));
          setIsAiActive(!!hasAi);
          if (hasAi && hasAi.serverIp) {
            setAiIp(hasAi.serverIp.split(':')[0]);
          }
        }
      } catch (err) {}
    };
    fetchAiStatus();

    window.addEventListener("integrationsUpdated", fetchAiStatus);
    window.addEventListener("storage", fetchAiStatus);
    return () => {
      window.removeEventListener("integrationsUpdated", fetchAiStatus);
      window.removeEventListener("storage", fetchAiStatus);
    };
  }, []);

  // Fetch supervisor password status on mount (admin only)
  useEffect(() => {
    if (role !== "admin") return;
    const fetchSvStatus = async () => {
      try {
        const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
        const res = await fetch(`${API_BASE}/api/auth/supervisor-status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setSupervisorConfigured(data.exists === true);
        }
      } catch (err) {
        console.error("[AUTH] Supervisor status fetch failed:", err);
      }
    };
    fetchSvStatus();
  }, [role]);

  useEffect(() => {
    const update = () => {
      setCamCount(loadDevices().length);
      setAlarmCount(loadAlarms().filter((a) => !a.read && !(a.category && a.category.toLowerCase().includes("motion"))).length);
    };
    update();
    const interval = setInterval(update, 5000);
    window.addEventListener("storage", update);
    return () => { clearInterval(interval); window.removeEventListener("storage", update); };
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e) => {
      if (userRef.current && !userRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const basePage = activePage ? activePage.split("/")[0] : "";
  const section = NAV_CONFIG.find((s) => {
    if (s.page === activePage || s.page === basePage) return true;
    if (s.items?.some((i) => i.page === activePage || i.page === basePage || (i.page && activePage.startsWith(i.page)))) return true;
    return false;
  });
  const item = section?.items?.find((i) => i.page === activePage || (i.page && activePage.startsWith(i.page))) || 
               (section?.page === activePage || section?.page === basePage ? { label: section.section } : null);

  // ---- Settings items per role ----
  const ADMIN_SETTINGS_ITEMS = [
    // { label: "Add Device",      page: "add-devices",     icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>` },
    // { label: "Storage Management", page: "storage-mgmt", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/></svg>` },
    { label: "User Settings",   page: "user-settings",   icon: iconSvg("userSettings") },
    { label: "User Management", page: "user-management", icon: iconSvg("userManagement") },
    { label: "Email Schedules", page: "email-schedules", icon: iconSvg("emailSchedules") },
    { label: "Logs",            page: "logs",            icon: iconSvg("logs") },
    { label: "Recycle Bin",     page: "recycle-bin",     icon: iconSvg("recycleBin") },
    

  ];

  const CLIENT_SETTINGS_ITEMS = [
    // { label: "Add Device",      page: "add-devices",     icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>` },
    // { label: "Storage Management", page: "storage-mgmt", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/></svg>` },
    { label: "Client Settings", page: "client-settings", icon: iconSvg("clientSettings") },
    { label: "Email Schedules", page: "email-schedules", icon: iconSvg("emailSchedules") },
    { label: "Logs",            page: "logs",            icon: iconSvg("logs") },
  ];

  const OPERATOR_SETTINGS_ITEMS = [
    { label: "Device Management",      page: "add-devices",     icon: iconSvg("deviceManagement") },
  ];

  const settingsItems = role === "admin"
    ? ADMIN_SETTINGS_ITEMS
    : role === "operator"
      ? OPERATOR_SETTINGS_ITEMS
      : CLIENT_SETTINGS_ITEMS;

  // Close every open top-bar dropdown (user menu + settings mega-menu)
  const closeMenus = () => {
    setUserMenuOpen(false);
    setSettingsDropdownOpen(false);
  };

  // Also close them whenever the route changes (e.g. sidebar item clicked)
  useEffect(() => { closeMenus(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage]);

  const navigateTo = (page) => {
    navigate(`/${page}`);
    setUserMenuOpen(false);
    setSettingsDropdownOpen(false);
  };

  return (
    <header className="topbar">
      {/* ===== LEFT ===== */}
      <div className="topbar__left">
        {/* Sidebar toggle (hamburger) */}
        <button
          type="button"
          className="topbar__menu-btn"
          onClick={() => window.dispatchEvent(new Event("toggle-sidebar"))}
          aria-label={t("sidebar.toggle")}
          aria-expanded={!sidebarCollapsed}
          title={t("sidebar.toggle")}
        >
          <Icon name={sidebarCollapsed ? "panelOpen" : "panelClose"} width="20" height="20" />
        </button>

        {/* AI Analytics pill */}
        {isAiActive && (
          <div className="topbar__ai-wrap">
            <button 
              className="topbar__ai-btn" 
              onClick={() => navigate('/ai-analytics')}
            >
              <div className="topbar__ai-logo-mark">
                <img src={logoImg} alt="MIRADOR AI" className="topbar__ai-logo-img" />
              </div>
              <div className="topbar__ai-logo-text">
                <span className="topbar__ai-logo-name">MIRADOR AI</span>
                <span className="topbar__ai-logo-sub">{t("topbar.analytics")}</span>
              </div>
            </button>
            <div className="topbar__ai-info">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <div className="topbar__ai-tooltip">
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>{t("topbar.aiAnalyticsTitle")}</strong>
                {t("topbar.aiAnalyticsDesc")}
              </div>
            </div>
          </div>
        )}

          {/* Datasheet Button — temporarily hidden */}
          {/* <button 
            className="topbar__datasheet-btn" 
            onClick={() => navigate('/manual')}
            title="Open User Manual"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            Datasheet
          </button> */}
        </div>


      {/* ===== RIGHT ===== */}
      <div className="topbar__right">

        {/* Dock Icons */}
        <div className="topbar__settings-wrap" ref={settingsRef}>
          <Dock
            direction="horizontal"
            panelHeight={48}
            baseItemSize={36}
            magnification={50}
            distance={100}
            className="topbar-dock"
            items={[
              {
                icon: (
                  <Icon name="snapshot" />
                ),
                label: isCapturing ? t("topbar.capturing") : t("topbar.snapshot"),
                onClick: () => { closeMenus(); handleAppSnapshot(); }
              },
              {
                icon: theme === "dark" ? (
                  <Icon name="sun" />
                ) : (
                  <Icon name="moon" />
                ),
                label: t("common.theme"),
                onClick: () => { closeMenus(); toggleTheme(); }
              },
              {
                icon: (
                  <Icon name="refresh" />
                ),
                label: t("common.refresh"),
                onClick: () => { closeMenus(); window.dispatchEvent(new CustomEvent('appRefresh')); }
              },
              ...(role === "admin" ? [{
                icon: (
                  <Icon name="profile" />
                ),
                label: t("nav.profile"),
                onClick: () => { closeMenus(); navigate("/profile"); }
              }] : []),
              ...([{
                icon: (
                  <Icon name="settings" />
                ),
                label: t("nav.settings"),
                onClick: () => {
                  // Client and Operator: go directly to client settings
                  if (role === "client" || role === "operator") {
                    navigate("/client-settings");
                    return;
                  }
                  setSettingsDropdownOpen(!settingsDropdownOpen);
                  setUserMenuOpen(false);
                }
              }])
            ]}
          />
          {settingsDropdownOpen && (
            <div className="topbar__settings-dropdown">
              {settingsItems.map((si) => (
                <button
                  key={si.page}
                  className="topbar__settings-dropdown-item"
                  onClick={() => navigateTo(si.page)}
                >
                  <span dangerouslySetInnerHTML={{ __html: si.icon }} />
                  <span>{tText(si.label)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="topbar__divider" />

        {/* Language Selector — Translation */}
        <LanguageSelector
          language={language}
          onLanguageChange={onLanguageChange}
        />

        {/* Fullscreen toggle */}
        <FullscreenButton />

        <div className="topbar__divider" />

        {/* User menu */}
        <div className="topbar__user-wrap" ref={userRef}>
          <div 
            className={`topbar__user ${userMenuOpen ? "topbar__user--active" : ""}`}
            onClick={() => {
              const nextOpen = !userMenuOpen;
              setUserMenuOpen(nextOpen);
              setSettingsDropdownOpen(false);
              if (nextOpen) {
                requestAnimationFrame(updateUserMenuPosition);
              }
            }}
          >
            <div className="topbar__avatar">
              {user?.email?.charAt(0).toUpperCase() || "A"}
            </div>
          </div>

          {userMenuOpen && (
            <div
              className="topbar__user-dropdown topbar__user-dropdown--account-fixed"
             style={{
  position: "fixed",
  top: `${userMenuPosition.top}px`,
  left:
    userMenuPosition.left === "auto"
      ? "auto"
      : `${userMenuPosition.left}px`,
  right:
    userMenuPosition.right === "auto"
      ? "auto"
      : `${userMenuPosition.right}px`,
  width: "256px",
  maxWidth: "calc(100vw - 24px)",
  zIndex: 2147483647,
}}
            >
              {/* Header */}
              <div className="topbar__user-dropdown-header">
                <div className="topbar__user-dropdown-info">
                  <div className="topbar__user-dropdown-name">{user?.email?.split("@")[0] || t("topbar.administrator")}</div>
                  {user?.email && (
                    <div className="topbar__user-dropdown-email">{user.email}</div>
                  )}
                </div>
                <span className={`topbar__user-badge ${user?.role || "admin"}`}>
                  {tText(user?.role?.toUpperCase() || "ADMIN")}
                </span>
              </div>
              
              <div className="topbar__user-dropdown-body">
                {/* About (All roles) */}
                <div
                  className="topbar__user-dropdown-item"
                  onClick={() => navigateTo("about")}
                >
                  <Icon name="about" />
                  <span>{t("topbar.about")}</span>
                </div>

                {/* Admin Only Tools */}
                {role === "admin" && (
                  <>
                    <div className="topbar__settings-dropdown-divider" role="separator" />
                    <div
                      className="topbar__user-dropdown-item topbar__user-dropdown-item--supervisor"
                      onClick={() => navigateTo("approvals")}
                    >
                      <Icon name="approvals" />
                      <span>{t("topbar.pendingApprovals")}</span>
                    </div>

                    <div
                      className="topbar__user-dropdown-item topbar__user-dropdown-item--supervisor"
                      onClick={() => {
                        setShowSupervisorDetails(true);
                        setUserMenuOpen(false);
                      }}
                    >
                      <Icon name="supervisor" />
                      <span>{t("topbar.supervisorDetails")}</span>
                      {/* Status dot */}
                      {supervisorConfigured !== null && (
                        <span style={{
                          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                          background: supervisorConfigured ? "#34d399" : "#fbbf24",
                          boxShadow: supervisorConfigured ? "0 0 6px rgba(52,211,153,0.4)" : "0 0 6px rgba(251,191,36,0.4)",
                          marginLeft: 4,
                        }} title={supervisorConfigured ? t("topbar.pwConfiguredTip") : t("topbar.pwNotConfiguredTip")} />
                      )}
                      <span className="topbar__supervisor-badge">{t("roles.admin")}</span>
                    </div>
                  </>
                )}

                {/* Divider if last login exists */}
                {user?.loginDate && (
                  <div className="topbar__settings-dropdown-divider" role="separator" />
                )}

                {/* Last login */}
                {user?.loginDate && (
                  <div className="topbar__user-dropdown-meta">
                    <div className="topbar__user-dropdown-meta-label">{t("topbar.lastLogin")}</div>
                    <div className="topbar__user-dropdown-meta-value">{user.loginDate}</div>
                  </div>
                )}
              </div>

              <div className="topbar__user-dropdown-footer">
                <div className="topbar__settings-dropdown-divider" role="separator" />
                <button
                  type="button"
                  className="topbar__user-dropdown-item topbar__user-dropdown-item--danger"
                  onClick={() => setShowLogoutConfirm(true)}
                >
                  <Icon name="logout" />
                  <span>{t("topbar.logout")}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="logout-modal-overlay">
          <div className="logout-modal">
            <div className="logout-modal__header">
              <h2>{t("topbar.confirmLogout")}</h2>
            </div>
            <div className="logout-modal__body">
              <p>{t("topbar.confirmLogoutMsg")}</p>
            </div>
            <div className="logout-modal__footer">
              <button
                className="logout-modal__btn logout-modal__btn--cancel"
                onClick={() => setShowLogoutConfirm(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="logout-modal__btn logout-modal__btn--confirm"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  logout();
                }}
              >
                {t("topbar.logout")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supervisor Details Modal (admin only) */}
      {showSupervisorDetails && (
        <SupervisorDetailsModal
          onClose={() => setShowSupervisorDetails(false)}
          onStatusChange={(configured) => setSupervisorConfigured(configured)}
        />
      )}

      {/* 0.5s Snapshot Shutter Flash Preview Overlay */}
      {snapshotPreview && (
        <div className="snapshot-flash-overlay">
          <div className="snapshot-flash-card">
            <img src={snapshotPreview} alt={t("topbar.snapshotPreview")} className="snapshot-flash-img" />
            <div className="snapshot-flash-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>{t("topbar.snapshotCapturedBadge")}</span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}