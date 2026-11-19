import React from "react";
import { useJoystick } from "../../context/JoystickContext";
import "./JoystickStatusBadge.css";

export default function JoystickStatusBadge() {
  const { gamepadConnected, gamepadName, setIsSettingsOpen } = useJoystick();

  return (
    <button
      type="button"
      className={`topbar__joy-btn ${gamepadConnected ? "topbar__joy-btn--connected" : ""}`}
      onClick={() => setIsSettingsOpen(true)}
      title={gamepadConnected ? `Joystick Connected: ${gamepadName} (Click to Configure)` : "No Joystick Detected (Click to Configure)"}
      aria-label="Joystick Controller Status"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="topbar__joy-icon"
      >
        <line x1="6" y1="12" x2="10" y2="12"></line>
        <line x1="8" y1="10" x2="8" y2="14"></line>
        <line x1="15" y1="13" x2="15.01" y2="13"></line>
        <line x1="18" y1="11" x2="18.01" y2="11"></line>
        <rect x="2" y="6" width="20" height="12" rx="2"></rect>
      </svg>
      <span className={`topbar__joy-dot ${gamepadConnected ? "topbar__joy-dot--active" : ""}`} />
    </button>
  );
}
