import React, { useMemo } from "react";
import { getPixelDistance, calculatePhysicalDistance, generatePreviewGrid, fromMeters } from "./LayoutCalibrationEngine";

const REF_COLORS = [
  "#f59e0b", // Amber
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#a855f7", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#84cc16", // Lime
];

/**
 * CalibrationOverlay
 * 
 * High-performance interactive SVG overlay rendered on top of the map canvas for:
 * 1. Calibrate Mode: Reference lines, draggable endpoint handles, distance tags, deformed preview grid.
 * 2. Measure Mode: Tape measurement line, distance tags, dimension deltas.
 */
export default function CalibrationOverlay({
  mode,
  calibration,
  calibType = "standard",
  references = [],
  activeRefId = null,
  activeHandle = null,
  drawingLine = null,
  measureLine = null,
  showPreviewGrid = false,
  scaleRef,
  offsetRef,
  wrapRef,
  floorImgRef,
  onHandleMouseDown,
  onRefClick,
}) {
  const wrap = wrapRef?.current;
  const img = floorImgRef?.current;
  const scale = scaleRef?.current || 1;
  const offset = offsetRef?.current || { x: 0, y: 0 };

  const W = wrap?.clientWidth || 1000;
  const H = wrap?.clientHeight || 800;

  // Convert image pixel coordinates to screen pixel coordinates
  const toScreen = (ix, iy) => {
    return {
      x: ix * scale + offset.x,
      y: iy * scale + offset.y,
    };
  };

  // Generate deformed metric preview grid
  const previewGridData = useMemo(() => {
    if (!showPreviewGrid || !calibration || !calibration.enabled || !img) return null;
    return generatePreviewGrid(calibration, { width: img.width, height: img.height }, 5);
  }, [showPreviewGrid, calibration, img]);

  if (!img) return null;

  return (
    <svg
      className="mv-calibration-overlay"
      style={{
        position: "absolute",
        inset: 0,
        width: W,
        height: H,
        pointerEvents: "none",
        zIndex: 6,
        userSelect: "none",
      }}
    >
      {/* ── 1. Deformable Preview Metric Grid ── */}
      {showPreviewGrid && previewGridData && (
        <g className="mv-calib-preview-grid">
          {previewGridData.gridLines.map((line, idx) => {
            if (!line.points || line.points.length < 2) return null;
            const pathData = line.points
              .map((p, i) => {
                const sp = toScreen(p.x, p.y);
                return `${i === 0 ? "M" : "L"} ${sp.x} ${sp.y}`;
              })
              .join(" ");

            return (
              <path
                key={`grid-line-${idx}`}
                d={pathData}
                fill="none"
                stroke="rgba(16, 185, 129, 0.45)"
                strokeWidth={line.worldValue % 10 === 0 ? "1.5" : "0.9"}
                strokeDasharray={line.worldValue % 10 === 0 ? "none" : "3 3"}
              />
            );
          })}

          {previewGridData.labels.map((lbl, idx) => {
            const sp = toScreen(lbl.x, lbl.y);
            return (
              <text
                key={`grid-lbl-${idx}`}
                x={sp.x}
                y={sp.y}
                fill="#10b981"
                fontSize="10"
                fontFamily="monospace"
                fontWeight="700"
                textAnchor="middle"
                opacity="0.9"
              >
                {lbl.text}
              </text>
            );
          })}
        </g>
      )}

      {/* ── 2. Calibrate Mode: Reference Lines & Draggable Handles ── */}
      {mode === "calibrate" && (
        <g className="mv-calib-references">
          {references.map((ref, idx) => {
            if (!ref.start || !ref.end) return null;
            const s = toScreen(ref.start.x, ref.start.y);
            const e = toScreen(ref.end.x, ref.end.y);
            const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
            const isActive = ref.id === activeRefId;
            const col = REF_COLORS[idx % REF_COLORS.length];
            const dPx = Math.round(getPixelDistance(ref.start, ref.end));
            const distM = Number(ref.realDistance || (ref.realDistanceMeters || 0)).toFixed(2);
            const unit = ref.unit || "meters";

            return (
              <g key={ref.id || idx} className={`mv-calib-ref-group ${isActive ? "active" : ""}`}>
                {/* Connecting Reference Line (Visual) */}
                <line
                  x1={s.x}
                  y1={s.y}
                  x2={e.x}
                  y2={e.y}
                  stroke={col}
                  strokeWidth={isActive ? 3 : 2}
                  strokeDasharray="5 3"
                  style={{ filter: "drop-shadow(0 0 4px rgba(0,0,0,0.8))" }}
                />

                {/* Hit area for clicking the reference line to select it */}
                <line
                  x1={s.x}
                  y1={s.y}
                  x2={e.x}
                  y2={e.y}
                  stroke="transparent"
                  strokeWidth="18"
                  style={{ pointerEvents: "all", cursor: "pointer" }}
                  onMouseDown={(ev) => {
                    ev.stopPropagation();
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onRefClick?.(ref.id);
                  }}
                />

                {/* Crosshairs at Start */}
                <line x1={s.x - 8} y1={s.y} x2={s.x + 8} y2={s.y} stroke={col} strokeWidth="1.2" opacity="0.8" />
                <line x1={s.x} y1={s.y - 8} x2={s.x} y2={s.y + 8} stroke={col} strokeWidth="1.2" opacity="0.8" />

                {/* Crosshairs at End */}
                <line x1={e.x - 8} y1={e.y} x2={e.x + 8} y2={e.y} stroke={col} strokeWidth="1.2" opacity="0.8" />
                <line x1={e.x} y1={e.y - 8} x2={e.x} y2={e.y + 8} stroke={col} strokeWidth="1.2" opacity="0.8" />

                {/* Start Handle Circle */}
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={activeHandle?.refId === ref.id && activeHandle?.handle === "start" ? 9 : 7}
                  fill={col}
                  stroke="#ffffff"
                  strokeWidth="2.5"
                  style={{ pointerEvents: "all", cursor: "crosshair" }}
                  onMouseDown={(ev) => {
                    ev.stopPropagation();
                    onHandleMouseDown?.(ref.id, "start", ev);
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onRefClick?.(ref.id);
                  }}
                />

                {/* End Handle Circle */}
                <circle
                  cx={e.x}
                  cy={e.y}
                  r={activeHandle?.refId === ref.id && activeHandle?.handle === "end" ? 9 : 7}
                  fill={col}
                  stroke="#ffffff"
                  strokeWidth="2.5"
                  style={{ pointerEvents: "all", cursor: "crosshair" }}
                  onMouseDown={(ev) => {
                    ev.stopPropagation();
                    onHandleMouseDown?.(ref.id, "end", ev);
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onRefClick?.(ref.id);
                  }}
                />

                {/* Distance Badge at Midpoint */}
                <g
                  transform={`translate(${mid.x}, ${mid.y})`}
                  style={{ pointerEvents: "all", cursor: "pointer" }}
                  onMouseDown={(ev) => {
                    ev.stopPropagation();
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onRefClick?.(ref.id);
                  }}
                >
                  <rect
                    x="-54"
                    y="-11"
                    width="108"
                    height="22"
                    rx="6"
                    fill="#10151f"
                    stroke={col}
                    strokeWidth={isActive ? "1.8" : "1"}
                    style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.6))" }}
                  />
                  <text
                    x="0"
                    y="4"
                    fill={col}
                    fontSize="10.5"
                    fontFamily="Inter, sans-serif"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {calibType === "advanced" ? `Ref ${idx + 1}: ` : ""}{distM} {unit === "feet" ? "ft" : "m"}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Live Drawing Reference Line (when dragging to create) */}
          {drawingLine && drawingLine.start && drawingLine.end && (
            <g className="mv-calib-drawing-line">
              {(() => {
                const s = toScreen(drawingLine.start.x, drawingLine.start.y);
                const e = toScreen(drawingLine.end.x, drawingLine.end.y);
                const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
                const dPx = Math.round(getPixelDistance(drawingLine.start, drawingLine.end));

                return (
                  <>
                    <line
                      x1={s.x}
                      y1={s.y}
                      x2={e.x}
                      y2={e.y}
                      stroke="#f59e0b"
                      strokeWidth="2.5"
                      strokeDasharray="4 3"
                    />
                    <circle cx={s.x} cy={s.y} r="6" fill="#f59e0b" stroke="#fff" strokeWidth="2" />
                    <circle cx={e.x} cy={e.y} r="6" fill="#f59e0b" stroke="#fff" strokeWidth="2" />
                    
                    {/* Bounding box guide */}
                    <rect
                      x={Math.min(s.x, e.x)}
                      y={Math.min(s.y, e.y)}
                      width={Math.abs(e.x - s.x)}
                      height={Math.abs(e.y - s.y)}
                      fill="none"
                      stroke="rgba(245, 158, 11, 0.25)"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />

                    {/* Pixel Readout Tag */}
                    <g transform={`translate(${mid.x}, ${mid.y - 14})`}>
                      <rect x="-42" y="-10" width="84" height="20" rx="4" fill="#0d1117ee" stroke="#f59e0b" strokeWidth="1" />
                      <text x="0" y="4" fill="#f59e0b" fontSize="10" fontFamily="monospace" fontWeight="700" textAnchor="middle">
                        {dPx} px
                      </text>
                    </g>
                  </>
                );
              })()}
            </g>
          )}
        </g>
      )}

      {/* ── 3. Measure Mode: Interactive Measurement Tape ── */}
      {mode === "measure" && measureLine && measureLine.start && measureLine.end && (
        <g className="mv-measure-group">
          {(() => {
            const s = toScreen(measureLine.start.x, measureLine.start.y);
            const e = toScreen(measureLine.end.x, measureLine.end.y);
            const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
            const dPx = getPixelDistance(measureLine.start, measureLine.end);
            
            // Calibrated physical distance
            const distMeters = calculatePhysicalDistance(calibration, measureLine.start, measureLine.end);
            const distFeet = fromMeters(distMeters, "feet");

            const dxPx = Math.abs(measureLine.end.x - measureLine.start.x);
            const dyPx = Math.abs(measureLine.end.y - measureLine.start.y);
            const dxM = calculatePhysicalDistance(calibration, measureLine.start, { x: measureLine.end.x, y: measureLine.start.y });
            const dyM = calculatePhysicalDistance(calibration, measureLine.start, { x: measureLine.start.x, y: measureLine.end.y });

            return (
              <>
                {/* Orthogonal Dimension Box */}
                <rect
                  x={Math.min(s.x, e.x)}
                  y={Math.min(s.y, e.y)}
                  width={Math.abs(e.x - s.x)}
                  height={Math.abs(e.y - s.y)}
                  fill="rgba(59, 130, 246, 0.04)"
                  stroke="rgba(59, 130, 246, 0.35)"
                  strokeWidth="1"
                  strokeDasharray="4 3"
                />

                {/* Main Diagonal Distance Line */}
                <line
                  x1={s.x}
                  y1={s.y}
                  x2={e.x}
                  y2={e.y}
                  stroke="#3b82f6"
                  strokeWidth="2.5"
                  strokeDasharray="6 3"
                  style={{ filter: "drop-shadow(0 0 6px rgba(59, 130, 246, 0.5))" }}
                />

                {/* Pins at Start and End */}
                <circle cx={s.x} cy={s.y} r="5.5" fill="#3b82f6" stroke="#ffffff" strokeWidth="2" />
                <circle cx={e.x} cy={e.y} r="5.5" fill="#3b82f6" stroke="#ffffff" strokeWidth="2" />

                {/* Delta X (Width) Readout */}
                {dxPx > 20 && (
                  <g transform={`translate(${mid.x}, ${Math.min(s.y, e.y) - 8})`}>
                    <rect x="-35" y="-8" width="70" height="16" rx="3" fill="#161b22" stroke="rgba(59, 130, 246, 0.6)" strokeWidth="1" />
                    <text x="0" y="4" fill="#60a5fa" fontSize="9" fontFamily="monospace" fontWeight="600" textAnchor="middle">
                      ΔX: {dxM.toFixed(2)} m
                    </text>
                  </g>
                )}

                {/* Delta Y (Height) Readout */}
                {dyPx > 20 && (
                  <g transform={`translate(${Math.max(s.x, e.x) + 38}, ${mid.y})`}>
                    <rect x="-35" y="-8" width="70" height="16" rx="3" fill="#161b22" stroke="rgba(59, 130, 246, 0.6)" strokeWidth="1" />
                    <text x="0" y="4" fill="#60a5fa" fontSize="9" fontFamily="monospace" fontWeight="600" textAnchor="middle">
                      ΔY: {dyM.toFixed(2)} m
                    </text>
                  </g>
                )}

                {/* Main Distance Pill Badge at Midpoint */}
                <g transform={`translate(${mid.x}, ${mid.y})`}>
                  <rect
                    x="-65"
                    y="-14"
                    width="130"
                    height="28"
                    rx="8"
                    fill="#0f172a"
                    stroke="#3b82f6"
                    strokeWidth="1.8"
                    style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.7))" }}
                  />
                  <text
                    x="0"
                    y="-1"
                    fill="#ffffff"
                    fontSize="11.5"
                    fontFamily="Inter, sans-serif"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {distMeters.toFixed(2)} m &nbsp;
                    <tspan fill="#94a3b8" fontSize="9.5">({distFeet.toFixed(1)} ft)</tspan>
                  </text>
                  <text
                    x="0"
                    y="10"
                    fill="#60a5fa"
                    fontSize="8.5"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    {Math.round(dPx)} px
                  </text>
                </g>
              </>
            );
          })()}
        </g>
      )}
    </svg>
  );
}
