import { useState, useEffect, useCallback } from "react";
import "./Toast.css";

const TOAST_DURATION = 4000;

export default function Toast({ message, subtitle, type = "success", spinning = false, icon, onClose }) {
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(onClose, 350);
  }, [onClose]);

  useEffect(() => {
    const t = setTimeout(dismiss, TOAST_DURATION);
    return () => clearTimeout(t);
  }, [dismiss]);

  const configs = {
    success: {
      label: "Success",
      gradient: "linear-gradient(135deg, #00c48c 0%, #00a878 100%)",
      glow: "rgba(0, 196, 140, 0.35)",
      bar: "#00e6b8",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="rgba(0,196,140,0.2)" />
          <circle cx="12" cy="12" r="11" stroke="#00d4aa" strokeWidth="1.5" fill="none" />
          <polyline points="7 12.5 10.5 16 17 9" stroke="#00d4aa" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    error: {
      label: "Error",
      gradient: "linear-gradient(135deg, #ff5555 0%, #cc3333 100%)",
      glow: "rgba(255, 85, 85, 0.35)",
      bar: "#ff6b6b",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="rgba(255,85,85,0.2)" />
          <circle cx="12" cy="12" r="11" stroke="#ff5555" strokeWidth="1.5" fill="none" />
          <line x1="8" y1="8" x2="16" y2="16" stroke="#ff5555" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="16" y1="8" x2="8" y2="16" stroke="#ff5555" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      ),
    },
  };

  const cfg = configs[type] || configs.success;

  const renderIcon = () => {
    if (icon) return icon;
    if (spinning) {
      return (
        <div className="toast-v2__spinner-container">
          <div className="toast-v2__spinner" />
          <svg
            className="toast-v2__spinner-check"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      );
    }
    return cfg.icon;
  };

  return (
    <div className={`toast-v2${exiting ? " toast-v2--exit" : ""}`}>
      <div className="toast-v2__accent" style={{ background: cfg.gradient }} />
      <div className="toast-v2__icon">{renderIcon()}</div>
      <div className="toast-v2__body">
        <span className="toast-v2__label">{cfg.label}</span>
        <span className="toast-v2__msg">{message}</span>
        {subtitle && <span className="toast-v2__sub">{subtitle}</span>}
      </div>
      <button className="toast-v2__close" onClick={dismiss} title="Dismiss">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <div
        className="toast-v2__progress"
        style={{ "--toast-duration": `${TOAST_DURATION}ms`, "--toast-bar-color": cfg.bar }}
      />
    </div>
  );
}
