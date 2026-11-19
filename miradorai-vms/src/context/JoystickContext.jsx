import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { apiUrl, getNumber } from "../config/appConfig";

const JoystickContext = createContext(null);

// Main pages for sequential navigation via bumper buttons (LB / RB)
const MAIN_PAGES = [
  { path: "/live-view", label: "Live View", icon: "live" },
  { path: "/media-player", label: "Playback", icon: "playback" },
  { path: "/ai-analytics", label: "AI Analytics", icon: "ai" },
  { path: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { path: "/add-devices", label: "Device Management", icon: "devices" },
  { path: "/cameras", label: "Group Management", icon: "groups" },
  { path: "/storage-management", label: "Storage Management", icon: "storage" },
  { path: "/settings", label: "Settings", icon: "settings" },
];

function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token");
  return token ? { Authorization: "Bearer " + token } : {};
}

// Global PTZ continuous move API caller
async function apiPTZMove(camera, pan, tilt, zoom) {
  if (!camera || (!camera.ip && !camera.address)) return;
  try {
    await fetch(apiUrl("/onvif/ptz/move"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        ip: camera.ip || camera.address,
        port: camera.port || getNumber("CAMERA_DEFAULT_PORT", 80),
        username: camera.username || "admin",
        password: camera.password || "",
        pan,
        tilt,
        zoom,
      }),
    });
  } catch (err) {
    console.error("[Joystick PTZ Error]", err);
  }
}

export function JoystickProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Hardware Connection State
  const [gamepadConnected, setGamepadConnected] = useState(false);
  const [gamepadName, setGamepadName] = useState("");

  // Operating Mode: 'grid' | 'ptz' | 'playback' | 'menu'
  const [activeMode, setActiveMode] = useState("grid");

  // Selected Camera & Grid Tracking
  const [activeCamera, setActiveCamera] = useState(null);
  const [selectedCellIndex, setSelectedCellIndex] = useState(0);

  // Settings & Calibration
  const [deadzone, setDeadzone] = useState(() => {
    return parseFloat(localStorage.getItem("mirador_joy_deadzone") || "0.12");
  });
  const [sensitivity, setSensitivity] = useState(() => {
    return parseFloat(localStorage.getItem("mirador_joy_sensitivity") || "1.0");
  });
  const [invertTilt, setInvertTilt] = useState(() => {
    return localStorage.getItem("mirador_joy_invert_tilt") !== "false";
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // On-Screen Display (OSD) Notification
  const [osd, setOsd] = useState({ visible: false, title: "", subtext: "", icon: "🎮" });
  const osdTimerRef = useRef(null);

  const showOSD = useCallback((title, subtext = "", icon = "🎮", duration = 1800) => {
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    setOsd({ visible: true, title, subtext, icon });
    osdTimerRef.current = setTimeout(() => {
      setOsd((prev) => ({ ...prev, visible: false }));
    }, duration);
  }, []);

  // Registry for page-specific actions (e.g., LiveView or Playback registers callbacks)
  const actionRegistryRef = useRef({});

  const registerActions = useCallback((pageName, actions) => {
    actionRegistryRef.current[pageName] = actions;
    return () => {
      delete actionRegistryRef.current[pageName];
    };
  }, []);

  // Persist Calibration
  useEffect(() => {
    localStorage.setItem("mirador_joy_deadzone", String(deadzone));
  }, [deadzone]);

  useEffect(() => {
    localStorage.setItem("mirador_joy_sensitivity", String(sensitivity));
  }, [sensitivity]);

  useEffect(() => {
    localStorage.setItem("mirador_joy_invert_tilt", String(invertTilt));
  }, [invertTilt]);

  // Handle hardware connect / disconnect events
  useEffect(() => {
    const handleConnected = (e) => {
      setGamepadConnected(true);
      const name = e.gamepad.id || "USB Controller";
      setGamepadName(name);
      showOSD("Joystick Connected", name, "🎮", 3000);
    };

    const handleDisconnected = (e) => {
      setGamepadConnected(false);
      setGamepadName("");
      showOSD("Joystick Disconnected", "", "⚠️", 2500);
    };

    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);

    return () => {
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
    };
  }, [showOSD]);

  // Main Polling Loop Ref State
  const prevButtonsRef = useRef({});
  const lastPTZSendTimeRef = useRef(0);
  const isMovingRef = useRef(false);
  const lastNavTimeRef = useRef(0);

  // Context-aware refs to keep loop updated with fresh values without re-binding loop
  const stateRef = useRef({
    activeMode,
    activeCamera,
    selectedCellIndex,
    deadzone,
    sensitivity,
    invertTilt,
    location,
  });

  useEffect(() => {
    stateRef.current = {
      activeMode,
      activeCamera,
      selectedCellIndex,
      deadzone,
      sensitivity,
      invertTilt,
      location,
    };
  }, [activeMode, activeCamera, selectedCellIndex, deadzone, sensitivity, invertTilt, location]);

  // Page switcher helper
  const switchPage = useCallback((delta) => {
    const currentPath = location.pathname;
    let idx = MAIN_PAGES.findIndex((p) => p.path === currentPath);
    if (idx === -1) idx = 0;
    const nextIdx = (idx + delta + MAIN_PAGES.length) % MAIN_PAGES.length;
    const target = MAIN_PAGES[nextIdx];
    navigate(target.path);
    showOSD(`Navigating to ${target.label}`, target.path, "🧭", 1500);
  }, [location.pathname, navigate, showOSD]);

  // Central Gamepad Polling Engine (60 FPS)
  useEffect(() => {
    let animId;

    const poll = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i] && gamepads[i].connected) {
          gp = gamepads[i];
          break;
        }
      }

      if (gp) {
        if (!gamepadConnected) {
          setGamepadConnected(true);
          setGamepadName(gp.id || "USB Controller");
        }

        const now = performance.now();
        const {
          activeMode: currentMode,
          activeCamera: currentCamera,
          deadzone: currentDeadzone,
          sensitivity: currentSensitivity,
          invertTilt: currentInvertTilt,
        } = stateRef.current;

        // 1. Process Buttons with Edge Detection (Just Pressed)
        const prevButtons = prevButtonsRef.current;
        const currentButtons = gp.buttons.map((b) => (typeof b === "object" ? b.pressed : b === 1.0));

        const justPressed = (idx) => currentButtons[idx] && !prevButtons[idx];

        // Global Navigation: Bumpers LB (4) and RB (5)
        if (justPressed(4)) {
          // LB -> Previous Page
          switchPage(-1);
        } else if (justPressed(5)) {
          // RB -> Next Page
          switchPage(1);
        }

        // Global Alarms Toggle: Button 9 (Start / Menu)
        if (justPressed(9)) {
          window.dispatchEvent(new CustomEvent("toggle-alarms"));
          showOSD("Alarms Panel", "Toggled via Joystick", "🔔");
        }

        // Open Calibration Modal: Button 8 (Select / Share)
        if (justPressed(8)) {
          setIsSettingsOpen((prev) => !prev);
        }

        // Live View Actions & Grid Navigation
        const liveViewActions = actionRegistryRef.current["LiveView"];
        const playbackActions = actionRegistryRef.current["Playback"];

        if (stateRef.current.location.pathname.includes("live-view") || stateRef.current.location.pathname === "/") {
          // Button 3 (Y / Triangle): Toggle PTZ Mode
          if (justPressed(3)) {
            setActiveMode((prev) => {
              const next = prev === "ptz" ? "grid" : "ptz";
              showOSD(next === "ptz" ? "PTZ Control Mode" : "Grid Navigation Mode", next === "ptz" ? "Stick controls camera Pan/Tilt" : "D-Pad navigates tiles", "🎮");
              return next;
            });
          }

          // Button 2 (X / Square): Cycle Grid Layout
          if (justPressed(2)) {
            if (liveViewActions?.onCycleLayout) {
              liveViewActions.onCycleLayout();
            }
          }

          // Button 0 (A / Cross): Toggle Fullscreen on active tile
          if (justPressed(0)) {
            if (liveViewActions?.onToggleFullscreen) {
              liveViewActions.onToggleFullscreen();
            }
          }

          // Button 1 (B / Circle): Home position or Exit Fullscreen
          if (justPressed(1)) {
            if (liveViewActions?.onExitFullscreen) {
              liveViewActions.onExitFullscreen();
            }
            if (currentMode === "ptz" && currentCamera) {
              apiPTZMove(currentCamera, 0, 0, 0);
              showOSD("PTZ Stopped / Reset", currentCamera.name || currentCamera.ip, "🎯");
            }
          }

          // Presets: D-Pad Buttons in PTZ mode or Number Combos
          if (currentMode === "ptz" && liveViewActions?.onGotoPreset) {
            if (justPressed(12)) liveViewActions.onGotoPreset(1); // D-pad Up
            if (justPressed(15)) liveViewActions.onGotoPreset(2); // D-pad Right
            if (justPressed(13)) liveViewActions.onGotoPreset(3); // D-pad Down
            if (justPressed(14)) liveViewActions.onGotoPreset(4); // D-pad Left
          }

          // Grid Navigation (D-Pad or Left Stick in 'grid' mode)
          if (currentMode === "grid") {
            const navDelay = 220; // ms debounce between grid tile jumps
            if (now - lastNavTimeRef.current > navDelay) {
              let dX = 0;
              let dY = 0;

              // Check D-Pad
              if (currentButtons[12]) dY = -1; // Up
              if (currentButtons[13]) dY = 1;  // Down
              if (currentButtons[14]) dX = -1; // Left
              if (currentButtons[15]) dX = 1;  // Right

              // Also check Left Stick
              const rawX = gp.axes[0] || 0;
              const rawY = gp.axes[1] || 0;
              if (Math.abs(rawX) > 0.6) dX = rawX > 0 ? 1 : -1;
              if (Math.abs(rawY) > 0.6) dY = rawY > 0 ? 1 : -1;

              if (dX !== 0 || dY !== 0) {
                if (liveViewActions?.onNavigateGrid) {
                  liveViewActions.onNavigateGrid(dX, dY);
                  lastNavTimeRef.current = now;
                }
              }
            }
          }

          // PTZ Analog Stick Movement (in 'ptz' mode or when camera has PTZ)
          if (currentMode === "ptz" && currentCamera) {
            const rawPan = gp.axes[0] || 0;
            const rawTilt = gp.axes[1] || 0;

            // Zoom: Trigger buttons LT(6), RT(7) or Twist Axis 2/3
            let rawZoom = 0;
            if (currentButtons[7]) rawZoom = 0.8; // RT -> Zoom In
            else if (currentButtons[6]) rawZoom = -0.8; // LT -> Zoom Out
            else if (Math.abs(gp.axes[2] || 0) > 0.2) rawZoom = (gp.axes[2] || 0);
            else if (Math.abs(gp.axes[3] || 0) > 0.2) rawZoom = -(gp.axes[3] || 0);

            // Apply deadzone
            const panVal = Math.abs(rawPan) > currentDeadzone ? rawPan * currentSensitivity : 0;
            const tiltVal = Math.abs(rawTilt) > currentDeadzone ? (currentInvertTilt ? -rawTilt : rawTilt) * currentSensitivity : 0;
            const zoomVal = Math.abs(rawZoom) > currentDeadzone ? rawZoom * currentSensitivity : 0;

            const isCurrentlyDeflected = panVal !== 0 || tiltVal !== 0 || zoomVal !== 0;

            if (isCurrentlyDeflected) {
              isMovingRef.current = true;
              // Throttle to 120ms
              if (now - lastPTZSendTimeRef.current > 120) {
                apiPTZMove(currentCamera, Number(panVal.toFixed(2)), Number(tiltVal.toFixed(2)), Number(zoomVal.toFixed(2)));
                lastPTZSendTimeRef.current = now;
              }
            } else if (isMovingRef.current) {
              // Zero-latch: user released stick -> send immediate STOP
              isMovingRef.current = false;
              apiPTZMove(currentCamera, 0, 0, 0);
              lastPTZSendTimeRef.current = now;
            }
          }
        } else if (stateRef.current.location.pathname.includes("playback") || stateRef.current.location.pathname.includes("media-player")) {
          // Playback / Timeline Scrubbing
          if (playbackActions) {
            if (justPressed(0)) playbackActions.onPlayPause?.(); // A -> Play/Pause
            if (justPressed(14)) playbackActions.onStepFrame?.(-1); // D-Pad Left -> Step Back
            if (justPressed(15)) playbackActions.onStepFrame?.(1);  // D-Pad Right -> Step Fwd

            // Jog / Shuttle Stick Scrubbing
            const scrubAxis = gp.axes[0] || 0;
            if (Math.abs(scrubAxis) > currentDeadzone && now - lastNavTimeRef.current > 150) {
              const deltaSeconds = Math.round(scrubAxis * 10);
              playbackActions.onScrub?.(deltaSeconds);
              lastNavTimeRef.current = now;
            }
          }
        }

        // Save current buttons for edge detection
        prevButtonsRef.current = currentButtons;
      } else {
        if (gamepadConnected) {
          setGamepadConnected(false);
          setGamepadName("");
        }
      }

      animId = requestAnimationFrame(poll);
    };

    animId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(animId);
  }, [gamepadConnected, switchPage, showOSD]);

  const value = {
    gamepadConnected,
    gamepadName,
    activeMode,
    setActiveMode,
    activeCamera,
    setActiveCamera,
    selectedCellIndex,
    setSelectedCellIndex,
    deadzone,
    setDeadzone,
    sensitivity,
    setSensitivity,
    invertTilt,
    setInvertTilt,
    isSettingsOpen,
    setIsSettingsOpen,
    osd,
    showOSD,
    registerActions,
    switchPage,
  };

  return <JoystickContext.Provider value={value}>{children}</JoystickContext.Provider>;
}

const defaultJoystickContext = {
  gamepadConnected: false,
  gamepadName: "",
  activeMode: "grid",
  setActiveMode: () => {},
  activeCamera: null,
  setActiveCamera: () => {},
  selectedCellIndex: 0,
  setSelectedCellIndex: () => {},
  deadzone: 0.12,
  setDeadzone: () => {},
  sensitivity: 1.0,
  setSensitivity: () => {},
  invertTilt: true,
  setInvertTilt: () => {},
  isSettingsOpen: false,
  setIsSettingsOpen: () => {},
  osd: { visible: false, title: "", subtext: "", icon: "🎮" },
  showOSD: () => {},
  registerActions: () => () => {},
  switchPage: () => {},
};

export function useJoystick() {
  const context = useContext(JoystickContext);
  return context || defaultJoystickContext;
}
