import React, { useState } from "react";
import { layoutToWorld } from "./LayoutCalibrationEngine";

/**
 * CameraItem
 * Single camera card in the sidebar list.
 * Supports:
 *   - click to select for placement / expand datasheet specs
 *   - drag-and-drop onto canvas (when unplaced)
 *   - shows online/offline status
 *   - shows "placed" badge if already on map
 *   - expandable datasheet specifications with full contrast in light/dark themes
 *   - fallback datasheet spec generation for all cameras
 */

function getCamType(name) {
  if (!name) return "Dome";
  const n = name.toLowerCase();
  if (n.includes("bullet") || n.includes("bllt")) return "Bullet";
  if (n.includes("ptz")) return "PTZ";
  if (n.includes("fish")) return "Fisheye";
  if (n.includes("box")) return "Box";
  if (n.includes("turret")) return "Turret";
  return "Dome";
}

function getEffectiveSpecs(cam) {
  if (cam.specs && Object.keys(cam.specs).length > 0) {
    return {
      model: cam.specs.model || cam.model || cam.name || "IP Camera",
      type: cam.specs.type || getCamType(cam.model || cam.name),
      hfov: cam.specs.hfov || cam.fovAngle || 60,
      rangeDay: cam.specs.rangeDay || 30,
      sensor: cam.specs.sensor || '1/2.8" Progressive Scan CMOS',
      megapixels: cam.specs.megapixels || (cam.model?.toLowerCase().includes("4k") ? 8 : 2),
      resolution: cam.specs.resolution || (cam.model?.toLowerCase().includes("4k") ? "4K UHD (3840x2160)" : "1080p Full HD (1920x1080)"),
      isMatched: true
    };
  }
  const type = getCamType(cam.name || cam.model || "");
  const is4k = (cam.model || cam.name || "").toLowerCase().includes("4k") || (cam.name || "").toLowerCase().includes("8mp");
  return {
    model: cam.model || cam.name || "Standard IP Camera",
    type: type,
    hfov: cam.fovAngle || 60,
    rangeDay: 30,
    sensor: '1/2.8" Progressive Scan CMOS',
    megapixels: is4k ? 8 : 2,
    resolution: is4k ? "4K UHD (3840x2160)" : "1080p Full HD (1920x1080)",
    isMatched: false
  };
}

export default function CameraItem({ cam, isPlaced, isActive, onSelect, onDragStart, marker = null, calibration = null }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const specs = getEffectiveSpecs(cam);
  const showSpecs = isActive || isExpanded;

  const handleClick = (e) => {
    setIsExpanded(prev => !prev);
    onSelect?.(cam);
  };

  const toggleSpecs = (e) => {
    e.stopPropagation();
    setIsExpanded(prev => !prev);
  };

  return (
    <div
      className={[
        "mv-cam-item",
        isPlaced ? "mv-cam-item--placed" : "",
        isActive ? "mv-cam-item--active" : "",
        showSpecs ? "mv-cam-item--expanded" : "",
      ].filter(Boolean).join(" ")}
      style={{
        flexDirection: "column",
        alignItems: "stretch",
        paddingBottom: showSpecs ? "12px" : "10px",
        opacity: isPlaced && !showSpecs && !isActive ? 0.75 : 1,
        cursor: isPlaced ? "pointer" : "grab",
        transition: "all 0.15s ease",
      }}
      draggable={!isPlaced}
      onDragStart={() => onDragStart?.(cam)}
      onClick={handleClick}
      title={`${cam.name} — ${cam.ip} — ${cam.status}`}
    >
      <div style={{ display: "flex", alignItems: "center", width: "100%", gap: "8px" }}>
        <span className={`mv-cam-dot mv-cam-dot--${cam.status}`} />
        <div className="mv-cam-info" style={{ flex: 1, minWidth: 0 }}>
          <span className="mv-cam-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cam.name}
          </span>
          <span className="mv-cam-ip">{cam.ip}</span>
        </div>
        {isPlaced && <span className="mv-cam-badge">placed</span>}
        <button
          type="button"
          onClick={toggleSpecs}
          title={showSpecs ? "Hide datasheet specs" : "Show datasheet specs"}
          style={{
            marginLeft: "auto",
            fontSize: "11px",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: "4px",
            color: showSpecs ? "var(--teal, #10b981)" : "var(--text-muted, #718096)",
            transition: "transform 0.2s ease, color 0.2s ease",
            transform: showSpecs ? "rotate(180deg)" : "rotate(0deg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          ▼
        </button>
      </div>
      
      {/* Show Model Specs when camera is clicked/active or expanded */}
      {showSpecs && (
        <div
          className="mv-cam-specs"
          style={{
            marginTop: "8px",
            fontSize: "11.5px",
            color: "var(--text-secondary)",
            borderTop: "1px solid var(--border)",
            paddingTop: "10px",
            width: "100%",
            animation: "fadeIn 0.2s ease-in-out"
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: "14px", rowGap: "8px" }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "var(--text-muted)", fontSize: "9.5px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Model</strong>
              <span style={{ color: "var(--text-primary)", fontWeight: "600", fontSize: "11.5px" }}>{specs.model}</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "var(--text-muted)", fontSize: "9.5px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Type</strong>
              <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>{specs.type || "N/A"}</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "var(--text-muted)", fontSize: "9.5px", textTransform: "uppercase", letterSpacing: "0.5px" }}>FOV</strong>
              <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>{specs.hfov || "N/A"}°</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "var(--text-muted)", fontSize: "9.5px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Range</strong>
              <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>{specs.rangeDay || "N/A"}m</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "var(--text-muted)", fontSize: "9.5px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Sensor</strong>
              <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>{specs.sensor || "N/A"}</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ color: "var(--text-muted)", fontSize: "9.5px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Resolution</strong>
              <span style={{ color: "var(--text-primary)", fontWeight: "500" }}>{specs.megapixels ? `${specs.megapixels}MP` : (specs.resolution || "N/A")}</span>
            </span>
            {marker && (
              <span style={{ display: "flex", flexDirection: "column", gridColumn: "span 2" }}>
                <strong style={{ color: "var(--text-muted)", fontSize: "9.5px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Coordinates</strong>
                <span style={{ color: "#60a5fa", fontWeight: "600", fontSize: "11px", fontFamily: "monospace" }}>
                  {calibration?.enabled
                    ? (() => {
                        const wp = layoutToWorld(calibration, marker.x, marker.y);
                        return `X: ${wp.x} m, Y: ${wp.y} m (calibrated)`;
                      })()
                    : `X: ${Math.round(marker.x)} px, Y: ${Math.round(marker.y)} px`
                  }
                </span>
              </span>
            )}
          </div>
          <div style={{ marginTop: "10px", fontStyle: "italic", color: "var(--teal)", fontSize: "10.5px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--teal)" }}></span>
            {specs.isMatched ? "Beam matched to datasheet" : "Standard camera datasheet specifications"}
          </div>
        </div>
      )}
    </div>
  );
}