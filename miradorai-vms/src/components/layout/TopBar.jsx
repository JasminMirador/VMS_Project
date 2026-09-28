import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { NAV_CONFIG } from "../../data/navConfig";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { useUserSettings } from "../../context/UserSettingsContext";
import { useNotifications } from "../../context/NotificationContext";
import logoImg from "../../assets/logo.jpg";
import Dock from "../shared/Dock/Dock";
import "./TopBar.css";
import "./SupervisorModal.css";

const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "";

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
        const token = localStorage.getItem("miradorai_token");
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
      setError("Password must be at least 4 characters.");
      return;
    }
    if (newPass !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem("miradorai_token");
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
        throw new Error(data.detail || data.message || "Failed to save supervisor password.");
      }
      setSaved(true);
      setNewPass("");
      setConfirm("");
      setStatus({ exists: true, updatedAt: new Date().toISOString() });
      if (onStatusChange) onStatusChange(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("[AUTH] Supervisor save error:", err);
      setError(err.message || "Failed to save supervisor password.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Are you sure you want to reset the supervisor password? Clients will use the default fallback password until a new one is set.")) return;
    setError("");
    setLoading(true);
    try {
      const token = localStorage.getItem("miradorai_token");
      const res = await fetch(`${API_BASE}/api/auth/supervisor-password`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Failed to reset supervisor password.");
      }
      setStatus({ exists: false });
      if (onStatusChange) onStatusChange(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("[AUTH] Supervisor reset error:", err);
      setError(err.message || "Failed to reset supervisor password.");
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
        <h2 className="sv-title">Supervisor Password</h2>

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
            {status?.exists ? "Password Configured" : "Not Configured — Using Default"}
          </div>
        )}

        <form onSubmit={handleSave} className="sv-form">
          <div className="sv-field">
            <label className="sv-label">{status?.exists ? "Update Password" : "New Password"}</label>
            <div className="sv-input-wrap">
              <input
                type={showPass ? "text" : "password"}
                className="sv-input"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Enter new password"
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
            <label className="sv-label">Confirm Password</label>
            <div className="sv-input-wrap">
              <input
                type={showPass ? "text" : "password"}
                className="sv-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
              />
            </div>
          </div>

          {error && <div className="sv-error">{error}</div>}
          {saved && <div className="sv-success">{status?.exists === false ? "Supervisor password has been reset." : "Password saved successfully!"}</div>}

          <div className="sv-actions">
            <button type="button" className="sv-btn-cancel" onClick={onClose}>Cancel</button>
            {status?.exists && (
              <button type="button" className="sv-btn-cancel" onClick={handleReset} disabled={loading} style={{ color: "#f87171", borderColor: "rgba(239,68,68,0.2)" }}>
                Reset
              </button>
            )}
            <button type="submit" className="sv-btn-verify" disabled={!newPass || !confirm || loading}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v14z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {status?.exists ? "Update Password" : "Save Password"}
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
}) {
  const [camCount,   setCamCount]   = useState(0);
  const [alarmCount, setAlarmCount] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showSupervisorDetails, setShowSupervisorDetails] = useState(false);
  const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);
  const [supervisorConfigured, setSupervisorConfigured] = useState(null); // null=loading, true/false
  const [isAiActive, setIsAiActive] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { settings } = useUserSettings();
  const { showToast } = useNotifications();
  const [isCapturing, setIsCapturing] = useState(false);
  const [snapshotPreview, setSnapshotPreview] = useState(null);
  const navigate = useNavigate();
  const role = user?.role;
  
  const userRef = useRef(null);
  const settingsRef = useRef(null);

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
         showToast({ title: '', body: 'Snapshot captured', variant: type || 'success', persistent });
      });
    } catch (err) {
      console.error("[SNAPSHOT] App snapshot failed:", err);
      showToast({ title: '', body: err.message || 'Snapshot failed', variant: 'error' });
    } finally {
      setIsCapturing(false);
    }
  };

  useEffect(() => {
    const fetchAiStatus = async () => {
      try {
        const token = localStorage.getItem('miradorai_token') || localStorage.getItem('token');
        const res = await fetch(`${API_BASE}/api/integrations`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          const hasAi = data.find(i => i.isActive && (i.type?.toLowerCase().includes('ai') || i.serverName?.toLowerCase().includes('ai') || i.serverIp));
          setIsAiActive(!!hasAi);
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
        const token = localStorage.getItem("miradorai_token");
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
    { label: "User Settings",   page: "user-settings",   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 10-16 0"/></svg>` },
    { label: "User Management", page: "user-management", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>` },
    { label: "Email Schedules", page: "email-schedules", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>` },
    { label: "Logs",            page: "logs",            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>` },
    { label: "Recycle Bin",     page: "recycle-bin",     icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>` },
    

  ];

  const CLIENT_SETTINGS_ITEMS = [
    // { label: "Add Device",      page: "add-devices",     icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>` },
    // { label: "Storage Management", page: "storage-mgmt", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/></svg>` },
    { label: "Client Settings", page: "client-settings", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>` },
    { label: "Email Schedules", page: "email-schedules", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>` },
    { label: "Logs",            page: "logs",            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>` },
  ];

  const OPERATOR_SETTINGS_ITEMS = [
    { label: "Device Management",      page: "add-devices",     icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>` },
  ];

  const settingsItems = role === "admin"
    ? ADMIN_SETTINGS_ITEMS
    : role === "operator"
      ? OPERATOR_SETTINGS_ITEMS
      : CLIENT_SETTINGS_ITEMS;

  const navigateTo = (page) => {
    navigate(`/${page}`);
    setUserMenuOpen(false);
    setSettingsDropdownOpen(false);
  };

  return (
    <header className="topbar">
      {/* ===== LEFT ===== */}
      <div className="topbar__left">
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
                <span className="topbar__ai-logo-sub">Analytics</span>
              </div>
            </button>
            <div className="topbar__ai-info">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <div className="topbar__ai-tooltip">
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>AI Analytics Dashboard</strong>
                Access advanced AI-driven insights, behavioral metrics, and data visualizations.
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                ),
                label: isCapturing ? "Capturing..." : "Snapshot",
                onClick: handleAppSnapshot
              },
              {
                icon: theme === "dark" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/>
                    <line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/>
                    <line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
                ),
                label: `Theme`,
                onClick: toggleTheme
              },
              {
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                  </svg>
                ),
                label: "Refresh",
                onClick: () => window.location.reload()
              },
              ...(role === "admin" ? [{
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                ),
                label: "Profile",
                onClick: () => navigate("/profile")
              }] : []),
              ...([{
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
                  </svg>
                ),
                label: "Settings",
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
                  <span>{si.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="topbar__divider" />

        {/* User menu */}
        <div className="topbar__user-wrap" ref={userRef}>
          <div 
            className={`topbar__user ${userMenuOpen ? "topbar__user--active" : ""}`}
            onClick={() => { setUserMenuOpen(!userMenuOpen); setSettingsDropdownOpen(false); }}
          >
            <div className="topbar__avatar">
              {user?.email?.charAt(0).toUpperCase() || "A"}
            </div>
          </div>

          {userMenuOpen && (
            <div className="topbar__user-dropdown">
              {/* Header */}
              <div className="topbar__user-dropdown-header">
                <div className="topbar__user-dropdown-avatar">
                  {user?.email?.charAt(0).toUpperCase() || "A"}
                </div>
                <div className="topbar__user-dropdown-info">
                  <div className="topbar__user-dropdown-name">{user?.email?.split("@")[0] || "Administrator"}</div>
                  <div className="topbar__user-dropdown-role-row">
                    <span className={`topbar__user-badge ${user?.role || "admin"}`}>
                      {user?.role?.toUpperCase() || "ADMIN"}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="topbar__user-dropdown-body">
                {/* About (All roles) */}
                <div
                  className="topbar__user-dropdown-item"
                  onClick={() => navigateTo("about")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4M12 8h.01"/>
                  </svg>
                  <span>About</span>
                </div>

                {/* Supervisor Details (Admin only) */}
                {role === "admin" && (
                  <>
                    <div className="topbar__settings-dropdown-divider" style={{ margin: "6px 4px" }} />
                    <div
                      className="topbar__user-dropdown-item topbar__user-dropdown-item--supervisor"
                      onClick={() => {
                        setShowSupervisorDetails(true);
                        setUserMenuOpen(false);
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                      <span>Supervisor Details</span>
                      {/* Status dot */}
                      {supervisorConfigured !== null && (
                        <span style={{
                          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                          background: supervisorConfigured ? "#34d399" : "#fbbf24",
                          boxShadow: supervisorConfigured ? "0 0 6px rgba(52,211,153,0.4)" : "0 0 6px rgba(251,191,36,0.4)",
                          marginLeft: 4,
                        }} title={supervisorConfigured ? "Password configured" : "Not configured"} />
                      )}
                      <span className="topbar__supervisor-badge">ADMIN</span>
                    </div>
                  </>
                )}

                {/* Divider if last login exists */}
                {user?.loginDate && (
                  <div className="topbar__settings-dropdown-divider" style={{ margin: "8px 4px" }} />
                )}

                {/* Last login */}
                {user?.loginDate && (
                  <div className="topbar__user-dropdown-meta">
                    <div className="topbar__user-dropdown-meta-label">Last Login:</div>
                    <div className="topbar__user-dropdown-meta-value">{user.loginDate}</div>
                  </div>
                )}
              </div>

              <div className="topbar__user-dropdown-footer">
                <button 
                  className="topbar__logout-btn"
                  onClick={() => setShowLogoutConfirm(true)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
                  </svg>
                  <span>LOGOUT</span>
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
              <h2>Confirm Logout</h2>
            </div>
            <div className="logout-modal__body">
              <p>Are you sure you want to logout?</p>
            </div>
            <div className="logout-modal__footer">
              <button
                className="logout-modal__btn logout-modal__btn--cancel"
                onClick={() => setShowLogoutConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="logout-modal__btn logout-modal__btn--confirm"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  logout();
                }}
              >
                Logout
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
            <img src={snapshotPreview} alt="Snapshot Preview" className="snapshot-flash-img" />
            <div className="snapshot-flash-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>Snapshot Captured</span>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
