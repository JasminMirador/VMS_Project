import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useUserSettings } from "./UserSettingsContext";
import { useNotificationPermission } from "../hooks/useNotificationPermission";
import { useWebSocket } from "../hooks/useWebSocket";
import { apiUrl } from "../config/appConfig";
import "./NotificationContext.css";

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

  const showToast = useCallback(({ title, body, variant = "info", persistent = false, playSound = true }) => {
    if (isBlockedPage()) return;
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, title: '', body: body || title || '', variant, persistent }]);
    if (playSound) {
      playSoundForType('alarm');
    }
    if (!persistent) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 5000);
    }
  }, [isBlockedPage, playSoundForType]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
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
        showToast({
           title: '',
           body: `${payloadType}: ${payload.ip || payload.serial || 'Unknown'}`,
           variant
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
        <div className="toast-container-box">
          <button 
            className="toast-box-close-all" 
            title="Dismiss all notifications" 
            onClick={() => setToasts([])}
          >
            &times;
          </button>
          <div className="toast-list">
            {toasts.map(t => (
              <div key={t.id} className={`toast-item toast-${t.variant}`}>
                <div className="toast-content">
                  <p className="toast-body">{t.body || t.title}</p>
                </div>
                <button className="toast-close" title="Dismiss" onClick={() => removeToast(t.id)}>&times;</button>
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