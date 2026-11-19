import React, { useEffect, useState } from "react";
import { useJoystick } from "../../context/JoystickContext";
import "./JoystickSettingsModal.css";

export default function JoystickSettingsModal() {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    gamepadConnected,
    gamepadName,
    deadzone,
    setDeadzone,
    sensitivity,
    setSensitivity,
    invertTilt,
    setInvertTilt,
    activeMode,
    setActiveMode,
  } = useJoystick();

  const [liveAxes, setLiveAxes] = useState([0, 0, 0, 0]);
  const [pressedButtons, setPressedButtons] = useState([]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    let animId;

    const readState = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i] && gamepads[i].connected) {
          gp = gamepads[i];
          break;
        }
      }

      if (gp) {
        setLiveAxes(gp.axes.slice(0, 4).map((a) => (typeof a === "number" ? a : 0)));
        const pressed = [];
        gp.buttons.forEach((b, idx) => {
          const isP = typeof b === "object" ? b.pressed : b === 1.0;
          if (isP) pressed.push(idx);
        });
        setPressedButtons(pressed);
      } else {
        setLiveAxes([0, 0, 0, 0]);
        setPressedButtons([]);
      }

      animId = requestAnimationFrame(readState);
    };

    animId = requestAnimationFrame(readState);
    return () => cancelAnimationFrame(animId);
  }, [isSettingsOpen]);

  if (!isSettingsOpen) return null;

  return (
    <div className="vms-joy-modal__backdrop" onClick={() => setIsSettingsOpen(false)}>
      <div className="vms-joy-modal__window" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="vms-joy-modal__header">
          <div className="vms-joy-modal__title-row">
            <span className="vms-joy-modal__badge">🎮 CONTROLLER SETTINGS</span>
            <h3>CCTV Joystick & Gamepad Config</h3>
          </div>
          <button
            type="button"
            className="vms-joy-modal__close"
            onClick={() => setIsSettingsOpen(false)}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="vms-joy-modal__body">
          {/* Status Bar */}
          <div className={`vms-joy-modal__status ${gamepadConnected ? "connected" : "disconnected"}`}>
            <div className="vms-joy-modal__status-dot" />
            <div>
              <strong>{gamepadConnected ? "Controller Connected" : "No Controller Detected"}</strong>
              <div className="vms-joy-modal__sub">{gamepadName || "Plug in any USB Joystick or Gamepad to begin"}</div>
            </div>
          </div>

          {/* Live Axis Meters */}
          <div className="vms-joy-modal__section">
            <label className="vms-joy-modal__label">Live Axis Deflection</label>
            <div className="vms-joy-modal__axes-grid">
              {["Pan (Axis 0)", "Tilt (Axis 1)", "Twist/Zoom (Axis 2)", "Slider (Axis 3)"].map((label, idx) => {
                const val = liveAxes[idx] || 0;
                const percent = Math.min(100, Math.max(0, ((val + 1) / 2) * 100));
                return (
                  <div key={idx} className="vms-joy-modal__axis-card">
                    <div className="vms-joy-modal__axis-header">
                      <span>{label}</span>
                      <code>{val.toFixed(2)}</code>
                    </div>
                    <div className="vms-joy-modal__axis-bar-bg">
                      <div
                        className="vms-joy-modal__axis-bar-fill"
                        style={{ left: `${Math.min(percent, 50)}%`, width: `${Math.abs(percent - 50)}%` }}
                      />
                      <div className="vms-joy-modal__axis-center-line" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pressed Buttons */}
          <div className="vms-joy-modal__section">
            <label className="vms-joy-modal__label">Live Pressed Buttons</label>
            <div className="vms-joy-modal__buttons-list">
              {pressedButtons.length > 0 ? (
                pressedButtons.map((b) => (
                  <span key={b} className="vms-joy-modal__button-tag">
                    Button {b}
                  </span>
                ))
              ) : (
                <span className="vms-joy-modal__muted">Press any joystick button to test...</span>
              )}
            </div>
          </div>

          {/* Calibration Sliders */}
          <div className="vms-joy-modal__section">
            <label className="vms-joy-modal__label">Tuning & Calibration</label>

            {/* Deadzone */}
            <div className="vms-joy-modal__slider-row">
              <div className="vms-joy-modal__slider-info">
                <span>Deadzone</span>
                <code>{(deadzone * 100).toFixed(0)}%</code>
              </div>
              <input
                type="range"
                min="0.02"
                max="0.30"
                step="0.01"
                value={deadzone}
                onChange={(e) => setDeadzone(parseFloat(e.target.value))}
                className="vms-joy-modal__slider"
              />
              <span className="vms-joy-modal__hint">Prevents unwanted camera drift when stick is centered.</span>
            </div>

            {/* Sensitivity */}
            <div className="vms-joy-modal__slider-row">
              <div className="vms-joy-modal__slider-info">
                <span>PTZ Speed Sensitivity</span>
                <code>{sensitivity.toFixed(1)}x</code>
              </div>
              <input
                type="range"
                min="0.4"
                max="2.5"
                step="0.1"
                value={sensitivity}
                onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                className="vms-joy-modal__slider"
              />
            </div>

            {/* Invert Tilt */}
            <div className="vms-joy-modal__toggle-row">
              <div>
                <span>Invert Tilt (Y-Axis)</span>
                <div className="vms-joy-modal__hint">Push forward to tilt camera up (surveillance standard).</div>
              </div>
              <label className="vms-joy-modal__switch">
                <input
                  type="checkbox"
                  checked={invertTilt}
                  onChange={(e) => setInvertTilt(e.target.checked)}
                />
                <span className="vms-joy-modal__switch-slider" />
              </label>
            </div>
          </div>

          {/* Quick Mapping Reference */}
          <div className="vms-joy-modal__section">
            <label className="vms-joy-modal__label">Hardware Shortcut Reference</label>
            <div className="vms-joy-modal__shortcuts-table">
              <div><span>LB / RB</span><span>Cycle Previous / Next Page</span></div>
              <div><span>Button A (0)</span><span>Toggle Fullscreen / Play-Pause</span></div>
              <div><span>Button X (2)</span><span>Cycle Grid Layout (1x1, 2x2, 3x3, 4x4)</span></div>
              <div><span>Button Y (3)</span><span>Toggle PTZ Mode (Stick controls Pan/Tilt)</span></div>
              <div><span>RT / LT / Twist</span><span>Optical Zoom In / Out</span></div>
              <div><span>D-Pad</span><span>Grid Navigation or Presets</span></div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="vms-joy-modal__footer">
          <button
            type="button"
            className="vms-joy-modal__done-btn"
            onClick={() => setIsSettingsOpen(false)}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
