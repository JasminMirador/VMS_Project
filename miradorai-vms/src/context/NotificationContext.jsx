import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useUserSettings } from "./UserSettingsContext";
import { useNotificationPermission } from "../hooks/useNotificationPermission";
import { useWebSocket } from "../hooks/useWebSocket";
import { apiUrl, getEnv } from "../config/appConfig";
import "./NotificationContext.css";

export function isMotionAlert(data) {
  if (!data) return false;
  const raw = data.rawData || data.raw || {};
  const values = [
    data.type,
    data.eventType,
    data.event,
    data.scenario,
    data.scenario_name,
    data.category,
    data.description,
    data.topic,
    data.feature,
    data.alertType,
    raw.type,
    raw.feature,
    raw.scenario,
    raw.category,
    raw.description,
  ].filter(Boolean).join(" ").toLowerCase();
  return values.includes("motion") || values.includes("tns1:videosource/motionalarm");
}

function formatEventTitle(name) {
  if (!name || name === "N/A" || name === "unknown") return "Security Alert";
  let formatted = String(name).trim();
  if (formatted.toLowerCase() === "face_recognition") return "Face Recognition";
  if (formatted.toLowerCase() === "intrusion") return "Intrusion";
  if (formatted.startsWith("fr-")) formatted = formatted.substring(3);
  formatted = formatted.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatDateTime(timeStr) {
  if (!timeStr) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  return String(timeStr).replace("T", " ").split(".")[0].split("+")[0];
}

function resolveCameraName(ipOrSerial, payload) {
  if (payload?.camera_name) return payload.camera_name;
  if (payload?.cameraName) return payload.cameraName;
  if (payload?.readerName) return payload.readerName;
  if (payload?.reader_name) return payload.reader_name;
  if (payload?.device) return payload.device;
  if (!ipOrSerial) return "";
  try {
    const devices = JSON.parse(localStorage.getItem("miradorai_devices") || "[]");
    const norm = ipOrSerial.replace(/_/g, ".");
    const found = devices.find(
      (d) =>
        (d.ip && d.ip.replace(/_/g, ".") === norm) ||
        (d.serial && d.serial === ipOrSerial) ||
        String(d.id) === String(ipOrSerial) ||
        (d.reader_id && String(d.reader_id) === String(ipOrSerial))
    );
    if (found?.name) return found.name;
  } catch (e) {}
  return "";
}

function resolveAlertThumbnail(payload) {
  if (!payload) return null;
  const raw = payload.rawData || payload.raw || {};
  const dataObj = payload.data || raw.data || {};
  
  const findLoc = (obj) => {
    if (!obj) return null;
    const key = Object.keys(obj).find(k => k.toLowerCase().replace(/_/g, '') === 'imagelocation' || k.toLowerCase().replace(/_/g, '') === 'imglocation' || k.toLowerCase().replace(/_/g, '') === 'imgelocation');
    return key ? obj[key] : null;
  };
  
  const imgLoc = findLoc(payload) || findLoc(raw) || findLoc(dataObj);
  if (imgLoc) {
    if (imgLoc.startsWith("http")) return imgLoc;
    const cleanLoc = imgLoc.startsWith("/") ? imgLoc.substring(1) : imgLoc;
    const minioPort = getEnv("MINIO_PORT") || "9000";
    const externalAiHost = getEnv("EXTERNAL_AI_HOST") || window.location.hostname;
    return `http://${externalAiHost}:${minioPort}/${cleanLoc}`;
  }
  
  let thumb = payload.image || payload.thumbnailUrl || payload.imageUrl || payload.snapshot_url || payload.snapshotUrl || payload.snapshot || null;
  if (thumb && typeof thumb === "string" && thumb.startsWith("/") && !thumb.startsWith("//")) {
    thumb = apiUrl(thumb);
  }
  return thumb;
}

const NotificationContext = createContext({});
export const useNotifications = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }) => {
  const { settings } = useUserSettings();
  const { permission } = useNotificationPermission();
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const [toasts, setToasts] = useState([]);
  const [intercomCall, setIntercomCall] = useState(null);
  const [firmwareUpdateCount, setFirmwareUpdateCount] = useState(0);

  const clearFirmwareBadge = useCallback(() => setFirmwareUpdateCount(0), []);

  const isBlockedPage = useCallback(() => {
    if (isLoading || !isAuthenticated) return true;
    const rawPath = location?.pathname || (typeof window !== "undefined" ? window.location.pathname : "");
    const cleanPath = rawPath.replace(/^\/|\/$/g, '').toLowerCase();
    const page = cleanPath || "dashboard";
    if (page === "dashboard" || page === "login" || page === "splash" || page === "start") {
      return true;
    }
    if (typeof document !== "undefined" && document.querySelector('.splash')) {
      return true;
    }
    return false;
  }, [isLoading, isAuthenticated, location]);

  const playSoundForType = useCallback((type) => {
    const s = settingsRef.current;
    if (!s) return;

    let soundType = s.alarmSound || "no-sound";
    let filePath = s.alarmFile || "";

    if (type === "intercom") {
        soundType = s.callSound || "no-sound";
        filePath = s.callFile || "";
    }

    if (soundType === "beep") {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 300);
      } catch(e) {}
    } else if (soundType === "file" && filePath) {
      try {
        const url = apiUrl(`/stream-audio?path=${encodeURIComponent(filePath)}`);
        const audio = new Audio(url);
        audio.play().catch(e => console.error("Audio play failed:", e));
      } catch(e) {}
    }
  }, []);

  const showToast = useCallback((toastData) => {
    if (isBlockedPage()) return;
    
    const opts = typeof toastData === "string" ? { body: toastData } : (toastData || {});

    // Filter out motion alerts from notifications completely
    if (isMotionAlert(opts) || isMotionAlert(opts.raw)) {
      return;
    }
    if (typeof opts.body === "string" && /motion/i.test(opts.body) && /alert|detect/i.test(opts.body)) {
      return;
    }
    if (typeof opts.alertType === "string" && /motion/i.test(opts.alertType)) {
      return;
    }

    const id = Date.now() + Math.random();
    const isAlert = Boolean(opts.isAlert);
    const variant = opts.variant || (isAlert ? "warning" : "info");
    const persistent = Boolean(opts.persistent);
    const duration = opts.duration || (isAlert ? 6000 : 4500);

    const item = {
      id,
      isAlert,
      title: opts.title || "",
      body: opts.body || "",
      variant,
      cameraName: opts.cameraName || "",
      ip: opts.ip || "",
      alertType: opts.alertType || "",
      rawType: opts.rawType || opts.alertType || "",
      time: opts.time || "",
      thumbnailUrl: opts.thumbnailUrl || null,
      raw: opts.raw || null,
      persistent,
      duration,
    };

    setToasts((prev) => [item, ...prev].slice(0, 5));

    if (opts.playSound !== false) {
      playSoundForType('alarm');
    }

    if (!persistent) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, [isBlockedPage, playSoundForType]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const lastSnapshotTimeRef = useRef(0);

  const handleSnapshot = useCallback((base64) => {
    if (isBlockedPage()) return;
    const now = Date.now();
    const lastSnap = parseInt(localStorage.getItem('miradorai_last_snapshot') || '0', 10);
    if (now - lastSnap < 5000) return;
    localStorage.setItem('miradorai_last_snapshot', now.toString());
    lastSnapshotTimeRef.current = now;

    import('../utils/snapshotUtils').then(({ saveSnapshotToBackend }) => {
        const pageName = location?.pathname?.split('/').pop() || window.location.pathname.split('/').pop() || 'dashboard';
        saveSnapshotToBackend(base64, 'Screenshot_' + pageName, settingsRef.current, (msg, type, persistent) => {
            if (!isBlockedPage()) {
              showToast({ 
                  title: '', 
                  body: 'Snapshot captured', 
                  variant: type || 'success', 
                  persistent 
              });
            }
        });
    }).catch(err => console.error("Snapshot error:", err));
  }, [showToast, isBlockedPage, location]);

  const notify = useCallback((event) => {
    if (isBlockedPage()) return;
    const payload = event.data;
    if (!payload) return;

    // Filter out motion alerts completely from all notifications and sounds
    if (isMotionAlert(payload)) {
      return;
    }

    const isSystem = event.topic === 'system';
    const payloadType = payload.type || 'Analytics Event';

    const envelope = { topic: isSystem ? 'system' : 'alerts', event: 'notification', data: payload };
    window.dispatchEvent(new CustomEvent(`ws-event-${envelope.topic}`, { detail: envelope }));

    if (payloadType === 'os_screenshot') {
       handleSnapshot(payload.base64);
       return;
    }

    if (payloadType === 'intercom_call') {
        setIntercomCall({ deviceName: payload.device || 'Unknown' });
        playSoundForType('intercom');
        return;
    }

    if (payloadType === 'firmware_available') {
        setFirmwareUpdateCount(c => c + 1);
        if (!isBlockedPage()) {
          showToast({ title: '', body: 'New firmware available', variant: 'info' });
        }
        return;
    }

    const DEVICE_FAILURES = ["Device Offline", "Video Stream Lost", "Recording Stopped", "Storage Full", "Storage Failure"];
    const DEVICE_RECOVERIES = ["Device Online / Recovered", "Video Stream Restored", "Recording Resumed", "Storage Restored"];
    const SYSTEM_FAILURES = ["Backend Service Unavailable", "Database Connection Failure"];

    let variant = 'warning';
    if (DEVICE_FAILURES.includes(payloadType) || SYSTEM_FAILURES.includes(payloadType)) variant = 'error';
    else if (DEVICE_RECOVERIES.includes(payloadType)) variant = 'success';

    if (isSystem && settingsRef.current?.notifTasks !== false && !isBlockedPage()) {
        showToast({ title: '', body: payload.description || payloadType, variant: 'info' });
    }
    if (!isSystem && settingsRef.current?.notifAlarms !== false && !isBlockedPage()) {
        const ipVal = payload.ip || payload.serial || payload.readerIp || payload.reader_ip || "";
        const displayIp = ipVal ? ipVal.replace(/_/g, ".") : "";
        const camName = resolveCameraName(displayIp || ipVal, payload);
        const rawAlert = payload.rawData || payload.raw || payload;
        const rawType = payload.type || rawAlert.type || payload.feature || rawAlert.feature || payload.scenario || "Alert";
        const alertType = formatEventTitle(rawType);
        const timeVal = formatDateTime(payload.detectionTime || payload.time || payload.received_at || rawAlert.detectionTime || "");
        const thumb = resolveAlertThumbnail(payload);

        let alertVariant = 'warning';
        const typeLower = String(rawType).toLowerCase();
        if (DEVICE_FAILURES.includes(payloadType) || SYSTEM_FAILURES.includes(payloadType) || typeLower.includes("intrusion") || typeLower.includes("tamper") || typeLower.includes("tripwire") || typeLower.includes("offline")) {
          alertVariant = 'error';
        } else if (DEVICE_RECOVERIES.includes(payloadType) || typeLower.includes("restore") || typeLower.includes("online")) {
          alertVariant = 'success';
        } else if (typeLower.includes("idle") || typeLower.includes("loiter") || typeLower.includes("unattended")) {
          alertVariant = 'warning';
        } else if (typeLower.includes("crossing") || typeLower.includes("field") || typeLower.includes("zone")) {
          alertVariant = 'info';
        } else {
          alertVariant = variant || 'warning';
        }

        showToast({
           isAlert: true,
           cameraName: camName,
           ip: displayIp,
           alertType,
           rawType,
           time: timeVal,
           thumbnailUrl: thumb,
           variant: alertVariant,
           raw: payload,
           playSound: true,
        });
    }
  }, [showToast, playSoundForType, handleSnapshot, isBlockedPage]);

  const { lastEvent } = useWebSocket(['alerts', 'system']);

  const isCapturingRef = useRef(false);

  useEffect(() => {
    const handleKeyUp = async (e) => {
      if (e.key === "PrintScreen") {
        if (isBlockedPage() || isCapturingRef.current) return;
        isCapturingRef.current = true;
        
        try {
          const html2canvas = (await import("html2canvas")).default;
          const targetEl = document.getElementById("root") || document.body;
          const canvas = await html2canvas(targetEl, {
            useCORS: true,
            allowTaint: true,
            scale: window.devicePixelRatio || 2,
            logging: false,
            backgroundColor: document.documentElement.getAttribute("data-theme") === "light" ? "#f8fafc" : "#0a0c10",
            onclone: (clonedDoc) => {
              const isLight = document.documentElement.getAttribute("data-theme") === "light";
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
          const base64 = canvas.toDataURL("image/png");
          handleSnapshot(base64);
        } catch (error) {
          console.error("Screenshot capture failed:", error);
          showToast({ title: '', body: "Capture failed.", variant: "error" });
        } finally {
          isCapturingRef.current = false;
        }
      }
    };
    window.addEventListener("keyup", handleKeyUp);
    return () => window.removeEventListener("keyup", handleKeyUp);
  }, [handleSnapshot, showToast, isBlockedPage]);

  useEffect(() => {
    if (lastEvent && lastEvent.data && lastEvent.data.type) {
      notify(lastEvent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  return (
    <NotificationContext.Provider value={{ notify, firmwareUpdateCount, clearFirmwareBadge, showToast }}>
      {children}
      {!isBlockedPage() && toasts.length > 0 && (
        <div className="modern-toast-container" role="region" aria-label="Notifications">
          {toasts.length > 1 && (
            <div className="modern-toast-header">
              <span className="modern-toast-count">
                <span className="modern-toast-live-dot" />
                {toasts.length} Alerts
              </span>
              <button 
                className="modern-toast-dismiss-all" 
                title="Dismiss all alerts" 
                aria-label="Dismiss all alerts"
                onClick={() => setToasts([])}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
          <div className="modern-toast-list">
            {toasts.map((t) => (
              <div 
                key={t.id} 
                className={`modern-toast-card modern-toast-card--${t.variant} ${t.isAlert ? "modern-toast-card--alert" : ""}`}
                onClick={() => {
                  if (t.isAlert && t.raw) {
                    window.dispatchEvent(new CustomEvent('vms-toast-alert-clicked', { detail: t.raw }));
                  }
                }}
              >
                <div className="modern-toast-indicator" />
                
                <div className="modern-toast-main">
                  {t.isAlert ? (
                    <>
                      <div className="modern-toast-top-row">
                        <div className="modern-toast-badge-group">
                          <span className="modern-toast-pill-alert">
                            <span className="modern-toast-live-dot" />
                            {t.alertType || "Alert"}
                          </span>
                        </div>
                        <button 
                          className="modern-toast-close-btn" 
                          title="Dismiss" 
                          onClick={(e) => {
                            e.stopPropagation();
                            removeToast(t.id);
                          }}
                        >
                          &times;
                        </button>
                      </div>

                      <div className="modern-toast-content-row">
                        <div className="modern-toast-details">
                          <div className="modern-toast-cam-row" title={t.cameraName ? `${t.cameraName} (${t.ip})` : t.ip}>
                            <svg className="modern-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M23 7l-7 5 7 5V7z" />
                              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                            </svg>
                            <span className="modern-toast-cam-name">
                              {t.cameraName || "Camera"}
                            </span>
                            {t.ip && <span className="modern-toast-ip-tag">{t.ip}</span>}
                          </div>

                          <div className="modern-toast-time-row">
                            <svg className="modern-toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10" />
                              <polyline points="12 6 12 12 16 14" />
                            </svg>
                            <span className="modern-toast-time-text">{t.time}</span>
                          </div>
                        </div>

                        {t.thumbnailUrl && (
                          <div className="modern-toast-thumb-wrap">
                            <img 
                              src={t.thumbnailUrl} 
                              alt="Alert Preview" 
                              className="modern-toast-thumb"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="modern-toast-system-row">
                      <div className="modern-toast-details">
                        {t.title && <div className="modern-toast-title">{t.title}</div>}
                        <div className="modern-toast-body-text">{t.body}</div>
                      </div>
                      <button 
                        className="modern-toast-close-btn" 
                        title="Dismiss" 
                        onClick={(e) => {
                          e.stopPropagation();
                          removeToast(t.id);
                        }}
                      >
                        &times;
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {intercomCall && !isBlockedPage() && (
        <div className="intercom-modal-overlay">
          <div className="intercom-modal">
            <h2>Incoming Intercom Call</h2>
            <p>From: {intercomCall.deviceName || 'Unknown Device'}</p>
            <div className="intercom-video-preview">
              <div className="video-placeholder">Audio/Video feed...</div>
            </div>
            <div className="intercom-actions">
              <button className="btn-accept" onClick={() => setIntercomCall(null)}>Accept</button>
              <button className="btn-decline" onClick={() => setIntercomCall(null)}>Decline</button>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
};