import React from "react";
import { useJoystick } from "../../context/JoystickContext";
import "./JoystickOSD.css";

export default function JoystickOSD() {
  const { osd, gamepadConnected, activeMode, activeCamera } = useJoystick();

  if (!osd.visible && !gamepadConnected) return null;

  return (
    <>
      {/* Floating Action / Mode OSD */}
      {osd.visible && (
        <div className="vms-joy-osd">
          <div className="vms-joy-osd__icon">{osd.icon}</div>
          <div className="vms-joy-osd__content">
            <span className="vms-joy-osd__title">{osd.title}</span>
            {osd.subtext && <span className="vms-joy-osd__subtext">{osd.subtext}</span>}
          </div>
        </div>
      )}

      {/* Persistent Mini Controller Mode HUD (Only when joystick is connected and on LiveView) */}
      {gamepadConnected && (
        <div className="vms-joy-mini-hud">
          <div className="vms-joy-mini-hud__dot" />
          <span className="vms-joy-mini-hud__mode">
            {activeMode === "ptz" ? "PTZ CONTROL" : "GRID NAV"}
          </span>
          {activeCamera && (
            <span className="vms-joy-mini-hud__cam">
              {activeCamera.name || activeCamera.ip}
            </span>
          )}
        </div>
      )}
    </>
  );
}
