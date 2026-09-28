import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { analyzeGltfParts } from "./GltfPartAnalyzer.js";
import { getDoriDistances } from "./CctvCalculators.js";
import logoImg from "../../assets/logo.jpg";

let cachedLogo3D = null;
function getCachedLogo3D() {
  if (!cachedLogo3D && typeof Image !== "undefined") {
    cachedLogo3D = new Image();
    cachedLogo3D.src = logoImg;
  }
  return cachedLogo3D;
}

function isThemeLight() {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light";
}

/**
 * Creates a simple canvas texture for the camera sprite.
 */
function getCamType(name) {
  if (!name) return "dome";
  const n = name.toLowerCase();
  if (n.includes("bullet") || n.includes("bllt")) return "bullet";
  if (n.includes("ptz")) return "ptz";
  if (n.includes("fish")) return "fisheye";
  if (n.includes("box")) return "box";
  if (n.includes("turret")) return "turret";
  return "dome";
}

function createDoriLabelSprite(text, colorHex) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");

  // Rounded pill background
  ctx.fillStyle = colorHex;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  const r = 24;
  const w = 248, h = 88, x = 4, y = 4;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // White text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 38px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 48);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.4, 0.525, 1);
  return sprite;
}



function createCameraTexture(type, color = "#1D9E75", number = "") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  
  ctx.translate(64, 64);
  const S = 1.6;

  ctx.shadowColor = color;
  ctx.shadowBlur = 10;

  if (type === "bullet") {
    const bS = S * 0.9;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(5*bS, 10*bS); ctx.lineTo(10*bS, 8*bS); ctx.lineTo(10*bS, 18*bS); ctx.lineTo(5*bS, 20*bS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
    
    ctx.beginPath(); ctx.moveTo(5*bS, 10*bS); ctx.lineTo(2*bS, 11*bS); ctx.lineTo(2*bS, 21*bS); ctx.lineTo(5*bS, 20*bS); ctx.closePath();
    ctx.fillStyle = "#f5f5f5"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(-2*bS, 14*bS); ctx.lineTo(5*bS, 12*bS); ctx.lineTo(5*bS, 15*bS); ctx.lineTo(-2*bS, 17*bS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
    
    ctx.beginPath(); ctx.moveTo(-4*bS, 0); ctx.lineTo(0*bS, -1*bS); ctx.lineTo(0*bS, 14*bS); ctx.lineTo(-4*bS, 15*bS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
    ctx.restore();

    ctx.beginPath(); ctx.moveTo(-12*bS, -7*bS); ctx.lineTo(8*bS, -7*bS); ctx.bezierCurveTo(12*bS, -7*bS, 12*bS, 7*bS, 8*bS, 7*bS); ctx.lineTo(-12*bS, 7*bS); ctx.bezierCurveTo(-8*bS, 7*bS, -8*bS, -7*bS, -12*bS, -7*bS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(-14*bS, -8*bS); ctx.lineTo(10*bS, -8*bS); ctx.bezierCurveTo(16*bS, -8*bS, 16*bS, -1*bS, 10*bS, -1*bS); ctx.lineTo(-14*bS, -1*bS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();

    ctx.beginPath(); ctx.ellipse(8*bS, 0, 2.5*bS, 6.5*bS, 0, 0, Math.PI*2); ctx.fillStyle = "#1b3039"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(8*bS, 0, 1.2*bS, 3.5*bS, 0, 0, Math.PI*2); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(8*bS, 0, 0.5*bS, 1.5*bS, 0, 0, Math.PI*2); ctx.fillStyle = "#000000"; ctx.fill();

  } else if (type === "ptz") {
    const pS = S * 0.9;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(-10*pS, -6*pS); ctx.lineTo(-10*pS, 10*pS); ctx.lineTo(-14*pS, 12*pS); ctx.lineTo(-14*pS, -8*pS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(-10*pS, 0); ctx.lineTo(-4*pS, -2*pS); ctx.lineTo(-4*pS, 2*pS); ctx.lineTo(-10*pS, 4*pS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
    ctx.restore();

    ctx.beginPath(); ctx.moveTo(-4*pS, -3*pS); ctx.lineTo(-4*pS, 3*pS); ctx.lineTo(-2*pS, 3*pS); ctx.lineTo(-2*pS, -3*pS);
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(-2*pS, -3*pS); ctx.lineTo(-2*pS, 3*pS); ctx.bezierCurveTo(4*pS, 8*pS, 6*pS, 9*pS, 8*pS, 9*pS); ctx.lineTo(8*pS, -9*pS); ctx.bezierCurveTo(6*pS, -9*pS, 4*pS, -8*pS, -2*pS, -3*pS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(8*pS, -8*pS); ctx.lineTo(8*pS, 8*pS); ctx.bezierCurveTo(14*pS, 8*pS, 16*pS, 4*pS, 16*pS, 0); ctx.bezierCurveTo(16*pS, -4*pS, 14*pS, -8*pS, 8*pS, -8*pS); ctx.closePath();
    ctx.fillStyle = "#1a1a1a"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();

    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(8*pS, -3*pS, 4*pS, 6*pS, 1); ctx.fillStyle = "#262626"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(10*pS, 0, 1.8*pS, 0, Math.PI*2); ctx.fillStyle = "#000000"; ctx.fill();

  } else {
    if (type === "dome" || type === "turret") {
      ctx.beginPath(); ctx.arc(0, 0, 11 * S, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(3 * S, 0, 8.5 * S, 0, Math.PI * 2); ctx.fillStyle = "#222222"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(3 * S, 0, 8.5 * S, 0, Math.PI * 2); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(4 * S, 0, 5 * S, 0, Math.PI * 2); ctx.fillStyle = "#111111"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(4 * S, 0, 2 * S, 0, Math.PI * 2); ctx.fillStyle = "#000000"; ctx.fill();
      ctx.beginPath(); ctx.arc(4.5 * S, -0.5 * S, 0.5 * S, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fill();
    } else if (type === "fisheye") {
      ctx.beginPath(); ctx.arc(0, 0, 12 * S, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 8 * S, 0, Math.PI * 2); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 3.5 * S, 0, Math.PI * 2); ctx.fillStyle = "#0e0e0e"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 1.5 * S, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.stroke();
    } else {
      const shift = 14 * S; ctx.translate(-shift, 0);
      ctx.beginPath(); ctx.arc(-14 * S, 0, 5 * S, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-14 * S, -2.5 * S, 7 * S, 5 * S, 1.5); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-7 * S, -7 * S, 20 * S, 14 * S, 2) : ctx.rect(-7 * S, -7 * S, 20 * S, 14 * S); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(13 * S, -5 * S, 6 * S, 10 * S, 1) : ctx.rect(13 * S, -5 * S, 6 * S, 10 * S); ctx.fillStyle = "#111111"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
      ctx.translate(shift, 0);
    }
  }

  ctx.shadowBlur = 0;
  if (number) {
    ctx.fillStyle = color === "#1D9E75" ? "#000000" : "#666666";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(number.toString(), -2 * S, 0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDimensionSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  
  // Background pill
  ctx.fillStyle = "rgba(13, 17, 23, 0.75)";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(0, 0, 512, 128, 64);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, 512, 128);
  }

  // Border
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#10b981";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(3, 3, 506, 122, 60);
    ctx.stroke();
  }

  // Text
  ctx.font = "bold 56px Inter, sans-serif";
  ctx.fillStyle = "#10b981";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 8;
  ctx.fillText(text, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(6, 1.5, 1);
  return sprite;
}

function createCameraLabelSprite(label, borderColor = "#a855f7") {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  // High-DPI measurement
  ctx.font = "bold 32px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const metrics = ctx.measureText(label);
  const textWidth = Math.max(metrics.width, 80);

  const padX = 24;
  const padY = 14;
  const w = Math.ceil(textWidth + padX * 2);
  const h = 64;

  canvas.width = w;
  canvas.height = h;

  // Background pill / box
  ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
  const cornerR = 12;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(3, 3, w - 6, h - 6, cornerR);
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
  } else {
    ctx.fillRect(3, 3, w - 6, h - 6);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = borderColor;
    ctx.strokeRect(3, 3, w - 6, h - 6);
  }

  // Label text
  ctx.font = "bold 32px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.fillText(label, w / 2, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(mat);

  const aspect = w / h;
  return { sprite, aspect };
}

function createRotationHandleSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.translate(32, 32);

  // Outer dark background badge
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15, 23, 42, 0.90)";
  ctx.fill();

  // Outer subtle accent ring
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.40)";
  ctx.stroke();

  // Primary accent ring
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#38bdf8";
  ctx.stroke();

  // Inner solid grip core dot
  ctx.beginPath();
  ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = "#38bdf8";
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  return new THREE.Sprite(mat);
}

function exportReportAsJSON(report, filename = 'parts_report.json') {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportReportAsCSV(report, filename = 'parts_report.csv') {
  const headers = ['name', 'width_m', 'height_m', 'depth_m'];
  const rows = report.parts.map(p => [
    p.name || p.groupId,
    p.dimensions.width.toFixed(4),
    p.dimensions.height.toFixed(4),
    p.dimensions.depth.toFixed(4),
  ]);

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function PartsMeasurementPanel({ report, floorPanelCollapsed }) {
  const [collapsed, setCollapsed] = useState(true);
  const [showUnits, setShowUnits] = useState(false);

  if (!report || !report.parts || report.parts.length === 0) return null;

  return (
    <div
      className="mv-parts-panel"
      style={{
        top: 14,
        left: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontWeight: "700", color: "var(--teal, #10b981)" }}>Parts: {report.parts.length}</span>
          <span style={{ fontSize: "10px", color: "var(--text-muted, #94a3b8)" }}>({report.strategy})</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button className="mv-parts-btn" onClick={() => exportReportAsJSON(report)}>JSON</button>
          <button className="mv-parts-btn" onClick={() => exportReportAsCSV(report)}>CSV</button>
          <button className="mv-parts-btn" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? "▾ Expand" : "▴ Hide"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {report.warning && (
            <div style={{
              marginTop: "6px", padding: "4px 6px",
              background: "rgba(245, 158, 11, 0.15)", color: "#d97706",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              borderRadius: "4px", fontSize: "11px"
            }}>
              ⚠ {report.warning}
            </div>
          )}

          <div style={{ marginTop: "8px", display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => setShowUnits(!showUnits)} style={{ fontSize: "10.5px", cursor: "pointer", background: "none", border: "none", color: "var(--teal, #059669)", fontWeight: "600" }}>
              {showUnits ? "Hide dimensions table" : "Show dimensions table"}
            </button>
          </div>

          {showUnits && (
            <div style={{ maxHeight: "220px", overflowY: "auto", marginTop: "6px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                <thead>
                  <tr style={{ color: "var(--text-muted, #94a3b8)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px 4px 0" }}>Name</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>W (m)</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>H (m)</th>
                    <th style={{ padding: "4px 0 4px 6px", textAlign: "right" }}>D (m)</th>
                  </tr>
                </thead>
                <tbody>
                  {report.parts.map((p, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border-light, rgba(255,255,255,0.05))" }}>
                      <td style={{ padding: "4px 8px 4px 0", maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{p.name || p.groupId}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text-secondary)" }}>{p.dimensions.width.toFixed(2)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text-secondary)" }}>{p.dimensions.height.toFixed(2)}</td>
                      <td style={{ padding: "4px 0 4px 6px", textAlign: "right", color: "var(--text-secondary)" }}>{p.dimensions.depth.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const Gltf3DViewer = forwardRef(function Gltf3DViewer({
  modelUrl,
  markers = [],
  cameras = [],
  imageSize = { width: 0, height: 0 },
  updateMarkers,
  showHeatmap = false,
  floorPanelCollapsed = false,
  iconScale = 1.20,
  showPpm = false,
  showMetricsVisibility = false,
  selectedIdx = null,
  onSelectCamera = null,
  isPanLocked = false
}, ref) {
  const containerRef = useRef(null);
  const [report, setReport] = useState(null);
  
    // Persist Three.js core objects so we can attach events to them
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const modelDataRef = useRef(null);
  const ambientLightRef = useRef(null);
  const dirLightRef = useRef(null);
  const fillLightRef = useRef(null);
  const dimensionSpritesRef = useRef([]);
  
  // Groups
  const camerasGroupRef = useRef(null);
  const gridHelperRef = useRef(null);
  
  // State for internal marker updates while dragging
  const [localMarkers, setLocalMarkers] = useState([]);
  const [hoverTooltip, setHoverTooltip] = useState(null);
  const localMarkersRef = useRef([]);
  localMarkersRef.current = localMarkers;
  const isDraggingRef = useRef(false);
  const draggingIdxRef = useRef(-1);
  const rotatingIdxRef = useRef(-1);
  const draggingLabelIdxRef = useRef(-1);
  const pointerDownPosRef = useRef({ x: 0, y: 0, idx: null });

  // Sync external markers to local state initially
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalMarkers(JSON.parse(JSON.stringify(markers)));
    }
  }, [markers]);

  // Sync pan lock state to OrbitControls
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.enablePan = !isPanLocked;
      controlsRef.current.enableRotate = !isPanLocked;
    }
  }, [isPanLocked]);

  // ── Fit 3D Model in Viewport ──
  const fitView = () => {
    if (!cameraRef.current || !controlsRef.current || !modelDataRef.current) return;
    const { maxDim } = modelDataRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const fovRad = camera.fov * (Math.PI / 180);
    const cameraDist = Math.abs((maxDim / 2) / Math.tan(fovRad / 2));
    camera.position.set(maxDim * 0.5, maxDim * 0.8, cameraDist * 1.5);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  // ── Export full 3D GLB model with cameras and volumetric FOV beams ──
  const exportGLB = (floorName = "Floor") => {
    if (!modelDataRef.current?.currentModel) {
      alert("No 3D model loaded to export.");
      return;
    }

    const { currentModel, upAxis, spanW, boxMaxY, boxMaxZ } = modelDataRef.current;
    const imgW = imageSize?.width || 2048;
    const imgH = imageSize?.height || 2048;
    const exportScaleX = (spanW * 1.05) / imgW;
    const spriteSize = spanW * 1.2 * 0.05;

    const exportScene = new THREE.Scene();
    exportScene.name = `Mirador_${(floorName || "Floor").replace(/\s+/g, "_")}`;

    // 1. Clone architectural base model with clean materials
    const baseModelClone = currentModel.clone(true);
    baseModelClone.traverse((node) => {
      if (node.isMesh) {
        if (node.userData.originalMaterial) {
          node.material = node.userData.originalMaterial;
        }
        if (node.userData?.isMiradorCamera || node.userData?.isMiradorFovBeam || node.name?.startsWith("MiradorCamera_") || node.name?.startsWith("FOV_Beam_")) {
          node.visible = false;
        }
      }
    });
    exportScene.add(baseModelClone);

    const raycaster = new THREE.Raycaster();

    // 2. Add each camera as a 3D camera body + 3D Volumetric FOV Mesh
    localMarkersRef.current.forEach((marker, idx) => {
      const cam = cameras.find(c => c.id === marker.camId);
      const isOnline = cam?.status === "online";
      const colorHex = isOnline ? 0x1D9E75 : 0x666666;

      const dx = marker.x - imgW / 2;
      const dy = marker.y - imgH / 2;
      const mapX = dx * exportScaleX;
      let mapY, mapZ;
      if (upAxis === "y") {
        mapZ = dy * exportScaleX;
        mapY = boxMaxY * 0.95;
      } else {
        mapY = -dy * exportScaleX;
        mapZ = boxMaxZ * 0.95;
      }

      const camGroup = new THREE.Group();
      camGroup.name = `MiradorCamera_${marker.camId || idx + 1}`;
      camGroup.position.set(mapX, mapY, mapZ);
      camGroup.userData = {
        isMiradorCamera: true,
        camId: marker.camId,
        camName: cam?.name || marker.camName || `Camera ${idx + 1}`,
        x: marker.x,
        y: marker.y,
        direction: marker.direction || 0,
        fovAngle: marker.fovAngle || cam?.specs?.hfov || 60,
        status: cam?.status || "online",
        ...(marker.labelOffset ? { labelOffset: marker.labelOffset } : {})
      };

      // ── Physical 3D Camera Body ──
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.3, metalness: 0.1 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.2, metalness: 0.8 });
      const lensMat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.4, roughness: 0.1 });

      const baseR = spriteSize * 0.35;
      const baseH = spriteSize * 0.15;
      
      const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(baseR * 0.85, baseR, baseH, 16), bodyMat);
      const domeMesh = new THREE.Mesh(new THREE.SphereGeometry(baseR * 0.75, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), darkMat);
      domeMesh.position.y = -baseH * 0.5;
      domeMesh.rotation.x = Math.PI;

      const lensMesh = new THREE.Mesh(new THREE.SphereGeometry(baseR * 0.22, 12, 12), lensMat);
      lensMesh.position.y = -baseH * 0.75;

      const camBodyGroup = new THREE.Group();
      camBodyGroup.name = "CameraBody";
      camBodyGroup.add(baseMesh);
      camBodyGroup.add(domeMesh);
      camBodyGroup.add(lensMesh);
      camGroup.add(camBodyGroup);

      // ── 3D Volumetric FOV Beam (Collision-accurate Visibility Polygon) ──
      const fovAngle = marker.fovAngle || cam?.specs?.hfov || marker.camera?.hfov || 60;
      const direction = marker.direction || 0;
      const fovRad = fovAngle * (Math.PI / 180);
      const dirRad = direction * (Math.PI / 180);
      const vFovRad = cam?.specs?.vfov ? cam.specs.vfov * (Math.PI / 180) : 40 * (Math.PI / 180);
      const nominalRange = Number(cam?.specs?.rangeDay || cam?.rangeDay || marker.camera?.rangeDay || marker.camera?.specs?.rangeDay || (cam?.specs?.rangeNight ? cam.specs.rangeNight : null) || 25);
      const effectivePpm = (typeof showPpm === "number" && showPpm > 0) ? showPpm : ((imageSize?.width || 2048) / Math.max(1, spanW));
      const worldUnitsPerMeter = effectivePpm * exportScaleX;
      const rayMaxDist = Math.max(2.0, nominalRange * worldUnitsPerMeter);

      const floorLevel = upAxis === "y" ? (modelDataRef.current?.boxMinY ?? 0) : (modelDataRef.current?.boxMinZ ?? 0);
      const camWorldY = upAxis === "y" ? camGroup.position.y : camGroup.position.z;
      const heightAboveFloor = Math.max(0.1, camWorldY - floorLevel);

      const pitchRad = Math.atan2(heightAboveFloor, Math.max(1.0, rayMaxDist * 0.55));
      const tiltTop = Math.max(0.01, pitchRad - (vFovRad / 2));
      const tiltBottom = pitchRad + (vFovRad / 2);

      const origin = new THREE.Vector3(0, 0, 0);
      const topPoints = [];
      const bottomPoints = [];
      const numRays = 64; // High-resolution smooth visibility polygon
      const furnitureKeywords = /chair|table|desk|seat|computer|pc|screen|monitor|laptop|mouse|keyboard|phone|lamp|plant|flower|prop|decor|cabinet|drawer|cushion|sofa|person|human|avatar|trash|bin|cup|mug|bottle|gadget|particle|bench|shelf|bookshelf|server|tv|mat|carpet|light|fixture|fitting|outlet|switch|sign|wire|cable/i;
      const exportCollisionTarget = modelDataRef.current?.collisionTarget;
      const targetsToIntersect = Array.isArray(exportCollisionTarget) && exportCollisionTarget.length > 0
        ? exportCollisionTarget
        : (currentModel ? [currentModel] : []);
      const exportRaycaster = new THREE.Raycaster();
      const worldCamPos = camGroup.position.clone();
      const worldEyePos = worldCamPos.clone();
      if (upAxis === "y") {
        worldEyePos.y = worldCamPos.y - Math.min(0.25, heightAboveFloor * 0.1);
      } else {
        worldEyePos.z = worldCamPos.z - Math.min(0.25, heightAboveFloor * 0.1);
      }

      for (let i = 0; i <= numRays; i++) {
        const angle = dirRad - (fovRad / 2) + (fovRad * (i / numRays));
        const getHit = (tilt) => {
          let rx, ry, rz;
          if (upAxis === "y") {
            rx = Math.cos(angle) * Math.cos(tilt);
            ry = -Math.sin(tilt);
            rz = Math.sin(angle) * Math.cos(tilt);
          } else {
            rx = Math.cos(angle) * Math.cos(tilt);
            ry = -Math.sin(angle) * Math.cos(tilt);
            rz = -Math.sin(tilt);
          }
          const rayDir = new THREE.Vector3(rx, ry, rz).normalize();
          
          // 1. Calculate floor intersection limit (rays cannot penetrate below floorLevel)
          let groundDist = rayMaxDist;
          const downComponent = upAxis === "y" ? -rayDir.y : -rayDir.z;
          if (downComponent > 0.05) {
            groundDist = heightAboveFloor / downComponent;
          }
          const effectiveMaxDist = Math.min(rayMaxDist, groundDist);

          // 2. Physical wall / obstacle collision raycasting (stops dead at walls only)
          // Skip horizontal surfaces (floor, ceiling, desk tops) by checking world face normal.
          let hitDist = effectiveMaxDist;
          if (targetsToIntersect.length > 0) {
            exportRaycaster.set(worldEyePos, rayDir);
            const hits = exportRaycaster.intersectObjects(targetsToIntersect, true);
            for (const hit of hits) {
              if (hit.distance < 0.05) continue;
              if (hit.object?.userData?.isMiradorCamera || hit.object?.userData?.isMiradorFovBeam) continue;
              if (hit.object?.isSprite) continue;

              // Skip horizontal surfaces (floor, ceiling, desk/cubicle tops)
              if (hit.face && hit.object) {
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
                const worldNormal = hit.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
                const upComponent = upAxis === "y" ? Math.abs(worldNormal.y) : Math.abs(worldNormal.z);
                if (upComponent > 0.5) continue;
              }

              const hitName = (hit.object?.name || "").toLowerCase();
              if (furnitureKeywords.test(hitName)) continue;

              hitDist = Math.min(hitDist, hit.distance);
              break;
            }
          }
          const finalDist = Math.min(effectiveMaxDist, hitDist);

          const pt = rayDir.clone().multiplyScalar(finalDist);
          if (upAxis === "y") {
            if (pt.y < -heightAboveFloor) pt.y = -heightAboveFloor;
          } else {
            if (pt.z < -heightAboveFloor) pt.z = -heightAboveFloor;
          }
          return pt;
        };

        topPoints.push(getHit(tiltTop));
        bottomPoints.push(getHit(tiltBottom));
      }

      // Realistic solid blue (0x2563eb) or emerald (0x10b981)
      const baseColorHex = showHeatmap ? 0x10B981 : 0x2563eb;
      const baseColor = new THREE.Color(baseColorHex);

      const vertices = [];
      const colors = [];

      const pushVertexWithGradient = (p) => {
        vertices.push(p.x, p.y, p.z);
        const d = Math.hypot(p.x, p.y, p.z);
        const t = Math.min(1.0, d / (rayMaxDist || 1));
        const intensity = Math.max(0.45, Math.pow(1.0 - t, 0.55));
        colors.push(baseColor.r * intensity, baseColor.g * intensity, baseColor.b * intensity);
      };

      const pushTrisWithGradient = (p1, p2, p3) => {
        pushVertexWithGradient(p1);
        pushVertexWithGradient(p2);
        pushVertexWithGradient(p3);
      };

      for (let i = 0; i < numRays; i++) {
        const t0 = topPoints[i];
        const t1 = topPoints[i + 1];
        const b0 = bottomPoints[i];
        const b1 = bottomPoints[i + 1];
        pushTrisWithGradient(origin, t0, t1);
        pushTrisWithGradient(origin, b1, b0);
        pushTrisWithGradient(t0, b0, b1);
        pushTrisWithGradient(t0, b1, t1);
      }
      pushTrisWithGradient(origin, bottomPoints[0], topPoints[0]);
      pushTrisWithGradient(origin, topPoints[numRays], bottomPoints[numRays]);

      const fovGeo = new THREE.BufferGeometry();
      fovGeo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      fovGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      fovGeo.computeVertexNormals();

      const fovMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: showHeatmap ? 0.42 : 0.36,
        roughness: 0.20,
        metalness: 0.10,
        emissive: baseColorHex,
        emissiveIntensity: showHeatmap ? 0.35 : 0.28,
        side: THREE.DoubleSide,
        depthWrite: false
      });

      const fovMesh = new THREE.Mesh(fovGeo, fovMaterial);
      fovMesh.name = `FOV_Beam_${marker.camId || idx + 1}`;
      fovMesh.userData = { isMiradorFovBeam: true, camId: marker.camId };
      camGroup.add(fovMesh);

      // Floor Footprint Decal for export
      const footprintVertices = [];
      const groundY = upAxis === "y" ? (-heightAboveFloor + 0.02) : 0;
      const groundCenter = upAxis === "y" ? new THREE.Vector3(0, groundY, 0) : new THREE.Vector3(0, 0, -heightAboveFloor + 0.02);
      for (let i = 0; i < numRays; i++) {
        const pA = bottomPoints[i].clone();
        const pB = bottomPoints[i + 1].clone();
        if (upAxis === "y") { pA.y = groundY; pB.y = groundY; }
        else { pA.z = groundCenter.z; pB.z = groundCenter.z; }
        footprintVertices.push(groundCenter.x, groundCenter.y, groundCenter.z);
        footprintVertices.push(pA.x, pA.y, pA.z);
        footprintVertices.push(pB.x, pB.y, pB.z);
      }
      const fpGeo = new THREE.BufferGeometry();
      fpGeo.setAttribute('position', new THREE.Float32BufferAttribute(footprintVertices, 3));
      fpGeo.computeVertexNormals();
      const fpMat = new THREE.MeshStandardMaterial({
        color: baseColorHex,
        emissive: baseColorHex,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: showHeatmap ? 0.32 : 0.25,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const fpMesh = new THREE.Mesh(fpGeo, fpMat);
      camGroup.add(fpMesh);

      exportScene.add(camGroup);
    });

    // 3. Attach full metadata to scene for seamless round-trip re-import
    exportScene.userData = {
      generator: "Mirador VMS 3D Designer",
      mirador_version: "2.0",
      exported_at: new Date().toISOString(),
      floor_name: floorName,
      markers: localMarkersRef.current.map(m => ({
        camId: m.camId,
        x: m.x,
        y: m.y,
        direction: m.direction || 0,
        fovAngle: m.fovAngle || 60,
        camName: m.camName || "",
        ...(m.labelOffset ? { labelOffset: m.labelOffset } : {})
      }))
    };

    // 4. Perform GLB Binary Export
    const exporter = new GLTFExporter();
    exporter.parse(
      exportScene,
      (glbArrayBuffer) => {
        const blob = new Blob([glbArrayBuffer], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const cleanName = (floorName || "Floor").replace(/\s+/g, "_");
        link.download = `${cleanName}_design.glb`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      },
      (err) => {
        console.error("[GLTFExporter] Export failed:", err);
        alert("Failed to export GLB file: " + (err.message || err));
      },
      { binary: true, embedImages: true }
    );
  };

  // ── Export exact 3D viewport snapshot as PNG ──
  const exportSnapshot = (floorName = "Floor", isHeatmap = false) => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) {
      alert("3D view is not ready for snapshot.");
      return;
    }
    // Render current scene directly to WebGL canvas buffer
    rendererRef.current.render(sceneRef.current, cameraRef.current);
    const webglCvs = rendererRef.current.domElement;
    
    const padBottom = 46;
    const oc = document.createElement("canvas");
    oc.width = webglCvs.width;
    oc.height = webglCvs.height + padBottom;
    const ctx = oc.getContext("2d");

    // Background
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, oc.width, oc.height);
    ctx.drawImage(webglCvs, 0, 0);

    // Footer Bar
    const footY = webglCvs.height + 6;
    const footH = 34;

    // Divider Line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, webglCvs.height + 2);
    ctx.lineTo(oc.width - 16, webglCvs.height + 2);
    ctx.stroke();

    // Logo
    const logo = getCachedLogo3D();
    let textStartX = 22;
    if (logo && logo.complete && logo.naturalWidth > 0) {
      const logoSize = 22;
      const logoY = footY + (footH - logoSize) / 2;
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(16, logoY, logoSize, logoSize, 4);
      else ctx.rect(16, logoY, logoSize, logoSize);
      ctx.clip();
      ctx.drawImage(logo, 16, logoY, logoSize, logoSize);
      ctx.restore();
      textStartX = 16 + logoSize + 8;
    }

    // Company Name
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 12.5px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("MIRADOR VMS", textStartX, footY + footH / 2);

    // Mode
    const titleW = ctx.measureText("MIRADOR VMS").width;
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.font = "500 11px Inter, sans-serif";
    ctx.fillText("•", textStartX + titleW + 8, footY + footH / 2);

    const modeText = isHeatmap ? "3D COVERAGE HEATMAP" : "3D DESIGN VIEWPORT";
    const badgeColor = isHeatmap ? "#10b981" : "#38bdf8";
    ctx.fillStyle = badgeColor;
    ctx.font = "bold 11px Inter, sans-serif";
    ctx.fillText(modeText, textStartX + titleW + 18, footY + footH / 2);

    // Right side stats
    let rightX = oc.width - 16;
    if (isHeatmap) {
      // Blindspots
      ctx.fillStyle = "#94a3b8";
      ctx.font = "500 11px Inter, sans-serif";
      ctx.textAlign = "right";
      const blindText = "Blindspots";
      ctx.fillText(blindText, rightX, footY + footH / 2);
      rightX -= (ctx.measureText(blindText).width + 6);

      ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
      ctx.strokeStyle = "rgba(100, 116, 139, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(rightX - 12, footY + footH / 2 - 5, 10, 10, 2);
      else ctx.rect(rightX - 12, footY + footH / 2 - 5, 10, 10);
      ctx.fill();
      ctx.stroke();
      rightX -= 22;

      // Active Coverage
      ctx.fillStyle = "#f8fafc";
      ctx.font = "500 11px Inter, sans-serif";
      const covText = "Active Coverage";
      ctx.fillText(covText, rightX, footY + footH / 2);
      rightX -= (ctx.measureText(covText).width + 6);

      ctx.fillStyle = "#10b981";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(rightX - 12, footY + footH / 2 - 5, 10, 10, 2);
      else ctx.rect(rightX - 12, footY + footH / 2 - 5, 10, 10);
      ctx.fill();
    } else {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "500 11px Inter, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`•  3D Viewport Export`, rightX, footY + footH / 2);
    }

    const cleanName = (floorName || "Floor").replace(/\s+/g, "_");
    const link = document.createElement("a");
    link.download = isHeatmap ? `${cleanName}_3d_heatmap.png` : `${cleanName}_3d_snapshot.png`;
    link.href = oc.toDataURL("image/png");
    link.click();
  };

  // ── Export automatic pristine 2D top-down view (without affecting live 3D camera angle) ──
  const exportTopDownSnapshot = (floorName = "Floor", isHeatmap = false) => {
    if (!sceneRef.current) {
      alert("3D view is not ready for 2D snapshot.");
      return;
    }

    try {
      // 1. Calculate bounding box of the 3D scene
      const box = new THREE.Box3().setFromObject(sceneRef.current);
      const center = box.getCenter(new THREE.Vector3());
      const boxSize = box.getSize(new THREE.Vector3());

      const spanW = Math.max(boxSize.x, 10);
      const spanH = Math.max(boxSize.z, 10);
      const aspect = spanW / spanH;
      const maxDim = 2048;
      let outW, outH;
      if (aspect >= 1) {
        outW = maxDim;
        outH = Math.round(maxDim / aspect);
      } else {
        outH = maxDim;
        outW = Math.round(maxDim * aspect);
      }
      outW = Math.max(outW, 256);
      outH = Math.max(outH, 256);

      // 2. Create offscreen WebGL renderer
      const offRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
      offRenderer.setSize(outW, outH);
      offRenderer.setPixelRatio(1);
      offRenderer.outputColorSpace = THREE.SRGBColorSpace;
      offRenderer.setClearColor(isHeatmap ? 0x0f172a : 0xffffff, 1);

      // 3. Create top-down Orthographic camera
      const padding = 1.08;
      const halfW = (spanW * padding) / 2;
      const halfH = (spanH * padding) / 2;
      const far = boxSize.x + boxSize.y + boxSize.z + 1000;

      const orthoCamera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, far);
      orthoCamera.position.set(center.x, box.max.y + 200, center.z);
      orthoCamera.up.set(0, 0, -1);
      orthoCamera.lookAt(center.x, center.y, center.z);
      orthoCamera.updateProjectionMatrix();

      // 4. Render to offscreen canvas
      offRenderer.render(sceneRef.current, orthoCamera);

      // 5. Composite onto 2D canvas with branding footer
      const padBottom = 46;
      const oc = document.createElement("canvas");
      oc.width = outW;
      oc.height = outH + padBottom;
      const ctx = oc.getContext("2d");

      ctx.fillStyle = "#090d16";
      ctx.fillRect(0, 0, oc.width, oc.height);
      ctx.drawImage(offRenderer.domElement, 0, 0);

      // Footer
      const footY = outH + 6;
      const footH = 34;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(16, outH + 2);
      ctx.lineTo(oc.width - 16, outH + 2);
      ctx.stroke();

      const logo = getCachedLogo3D();
      let textStartX = 22;
      if (logo && logo.complete && logo.naturalWidth > 0) {
        const logoSize = 22;
        const logoY = footY + (footH - logoSize) / 2;
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(16, logoY, logoSize, logoSize, 4);
        else ctx.rect(16, logoY, logoSize, logoSize);
        ctx.clip();
        ctx.drawImage(logo, 16, logoY, logoSize, logoSize);
        ctx.restore();
        textStartX = 16 + logoSize + 8;
      }

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12.5px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("MIRADOR VMS", textStartX, footY + footH / 2);

      const titleW = ctx.measureText("MIRADOR VMS").width;
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.font = "500 11px Inter, sans-serif";
      ctx.fillText("•", textStartX + titleW + 8, footY + footH / 2);

      const modeText = isHeatmap ? "COVERAGE HEATMAP" : "2D DESIGN LAYOUT";
      const badgeColor = isHeatmap ? "#10b981" : "#38bdf8";
      ctx.fillStyle = badgeColor;
      ctx.font = "bold 11px Inter, sans-serif";
      ctx.fillText(modeText, textStartX + titleW + 18, footY + footH / 2);

      let rightX = oc.width - 16;
      if (isHeatmap) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "500 11px Inter, sans-serif";
        ctx.textAlign = "right";
        const blindText = "Blindspots";
        ctx.fillText(blindText, rightX, footY + footH / 2);
        rightX -= (ctx.measureText(blindText).width + 6);

        ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
        ctx.strokeStyle = "rgba(100, 116, 139, 0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(rightX - 12, footY + footH / 2 - 5, 10, 10, 2);
        else ctx.rect(rightX - 12, footY + footH / 2 - 5, 10, 10);
        ctx.fill();
        ctx.stroke();
        rightX -= 22;

        ctx.fillStyle = "#f8fafc";
        ctx.font = "500 11px Inter, sans-serif";
        const covText = "Active Coverage";
        ctx.fillText(covText, rightX, footY + footH / 2);
        rightX -= (ctx.measureText(covText).width + 6);

        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(rightX - 12, footY + footH / 2 - 5, 10, 10, 2);
        else ctx.rect(rightX - 12, footY + footH / 2 - 5, 10, 10);
        ctx.fill();
      } else {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "500 11px Inter, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(`•  2D Top View Export`, rightX, footY + footH / 2);
      }

      const cleanName = (floorName || "Floor").replace(/\s+/g, "_");
      const link = document.createElement("a");
      link.download = isHeatmap ? `${cleanName}_heatmap_2d.png` : `${cleanName}_design_2d.png`;
      link.href = oc.toDataURL("image/png");
      link.click();

      offRenderer.dispose();
    } catch (err) {
      console.error("[3D Export TopDown] Error:", err);
      alert("Failed to export 2D top view snapshot: " + err.message);
    }
  };

  useImperativeHandle(ref, () => ({
    exportGLB,
    exportSnapshot,
    exportTopDownSnapshot,
    fitView,
    get3DCameraScreenPos: (camId) => {
      if (!cameraRef.current || !containerRef.current || !camerasGroupRef.current) return null;
      const camWrapper = camerasGroupRef.current.children.find(c => c.userData?.camId === camId);
      if (!camWrapper) return null;
      const tempVec = new THREE.Vector3();
      camWrapper.getWorldPosition(tempVec);
      tempVec.project(cameraRef.current);
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      const sx = ((tempVec.x + 1) / 2) * w;
      const sy = ((-tempVec.y + 1) / 2) * h;
      const isVisible = tempVec.z < 1.0;
      return { sx, sy, isVisible };
    }
  }));

  // ── 1. Init Engine ───────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !modelUrl) return;

    const container = containerRef.current;
    let width = container.clientWidth || 800;
    let height = container.clientHeight || 600;
    const isThemeLight = () => document.documentElement.getAttribute("data-theme") === "light";
    const getBgColor = () => isThemeLight() ? "#cbd5e1" : "#0d1117";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getBgColor());
    sceneRef.current = scene;

    const camerasGroup = new THREE.Group();
    scene.add(camerasGroup);
    camerasGroupRef.current = camerasGroup;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = !isPanLocked;
    controls.enableRotate = !isPanLocked;
    controlsRef.current = controls;

    // Lighting
    const isL = isThemeLight();
    const ambientLight = new THREE.AmbientLight(0xffffff, isL ? 0.85 : 0.7);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(100, 200, 50);
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-100, -50, -50);
    scene.add(fillLight);
    fillLightRef.current = fillLight;

    // Load Model
    const loader = new GLTFLoader();
    let currentModel = null;

    loader.load(
      modelUrl,
      (gltf) => {
        currentModel = gltf.scene;

        // Remove any previously baked static camera/beam meshes so bounding box is calculated strictly on building geometry
        const nodesToRemove = [];
        currentModel.traverse((node) => {
          if (node.userData?.isMiradorCamera || node.userData?.isMiradorFovBeam || node.name?.startsWith("MiradorCamera_") || node.name?.startsWith("FOV_Beam_")) {
            nodesToRemove.push(node);
          }
        });
        nodesToRemove.forEach((n) => {
          if (n.parent) n.parent.remove(n);
        });

        scene.add(currentModel);

        // new: analyze parts
        const gltfReport = analyzeGltfParts(gltf.scene);
        setReport(gltfReport);

        const box = new THREE.Box3().setFromObject(currentModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        currentModel.position.x -= center.x;
        currentModel.position.y -= center.y;
        currentModel.position.z -= center.z;
        box.setFromObject(currentModel);

        const ratioYZ = size.y > 0 && size.z > 0 ? Math.min(size.y, size.z) / Math.max(size.y, size.z) : 1;
        let upAxis = "y";
        if (ratioYZ > 0.8) upAxis = "y";
        else if (size.y <= size.x && size.y <= size.z) upAxis = "y";
        else if (size.z <= size.x && size.z <= size.y) upAxis = "z";

        const spanW = upAxis === "y" ? size.x : size.x;
        const maxDim = Math.max(size.x, size.y, size.z);
        
        const fovRad = camera.fov * (Math.PI / 180);
        let cameraDist = Math.abs((maxDim / 2) / Math.tan(fovRad / 2));
        camera.position.set(maxDim * 0.5, maxDim * 0.8, cameraDist * 1.5);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();

        // ── Visual Scale Overlays ──
        
        // 1. Grid
        const gridHelper = new THREE.GridHelper(
          Math.ceil(maxDim * 1.5),
          Math.ceil(maxDim * 1.5),
          0x3b82f6,
          isThemeLight() ? 0x94a3b8 : 0x444444
        );
        gridHelperRef.current = gridHelper;
        if (upAxis === "z") {
          gridHelper.rotation.x = Math.PI / 2;
          gridHelper.position.set(0, 0, box.min.z);
        } else {
          gridHelper.position.set(0, box.min.y, 0);
        }
        scene.add(gridHelper);

        // 2. Physical Metric Sprites
        const widthM = size.x.toFixed(1);
        const depthM = (upAxis === "y" ? size.z : size.y).toFixed(1);

        const widthLabel = createDimensionSprite(`↔ ${widthM} m`);
        const depthLabel = createDimensionSprite(`↕ ${depthM} m`);

        if (upAxis === "y") {
          widthLabel.position.set(0, box.min.y, box.max.z + maxDim * 0.05);
          depthLabel.position.set(box.max.x + maxDim * 0.05, box.min.y, 0);
        } else {
          widthLabel.position.set(0, box.max.y + maxDim * 0.05, box.min.z);
          depthLabel.position.set(box.max.x + maxDim * 0.05, 0, box.min.z);
        }
        
        widthLabel.visible = showMetricsVisibility;
        depthLabel.visible = showMetricsVisibility;
        dimensionSpritesRef.current = [widthLabel, depthLabel];

        scene.add(widthLabel);
        scene.add(depthLabel);

        // ── 3. Classify Structural Walls & Perimeter Boundaries ──
        // Only full-height room walls (height/top >= 1.75m) block the beam.
        // Office tables, desks, and low cubicle partitions/dividers (< 1.6m) are EXCLUDED so they do not clip or fragment the beam.
        const wallMeshes = [];
        const smallItemKeywords = /chair|table|desk|seat|computer|pc|screen|monitor|laptop|mouse|keyboard|phone|lamp|plant|flower|prop|decor|cabinet|drawer|cushion|sofa|person|human|avatar|trash|bin|cup|mug|bottle|gadget|particle|bench|shelf|bookshelf|server|tv|mat|carpet|light|fitting|outlet|switch|sign|board|stand|case|box|bag|device|wire|cable|rack|door_knob|handle|cubicle|partition|divider/i;
        const structuralWallKeywords = /wall|mur|wand|pared|facade|envelope|column|pillar|building_shell|exterior|interior_wall|room_boundary|concrete|masonry/i;

        const totalH = upAxis === "y" ? size.y : size.z;
        const ceilingLevel = upAxis === "y" ? box.max.y : box.max.z;
        const floorLevel_build = upAxis === "y" ? box.min.y : box.min.z;
        const roomHeight = Math.max(0.01, ceilingLevel - floorLevel_build);

        currentModel.traverse((node) => {
          if (node.isMesh) {
            node.updateWorldMatrix(true, false);
            const nodeBox = new THREE.Box3().setFromObject(node);
            const nodeSize = new THREE.Vector3();
            nodeBox.getSize(nodeSize);
            const nodeH = upAxis === "y" ? nodeSize.y : nodeSize.z;
            const nodeTopY = upAxis === "y" ? nodeBox.max.y : nodeBox.max.z;
            const name = (node.name || "").toLowerCase();

            const isExplicitSmallItem = smallItemKeywords.test(name);
            const isExplicitStructure = structuralWallKeywords.test(name);

            // Height of top edge above floor level
            const topHeightAboveFloor = nodeTopY - floorLevel_build;
            
            // Wall height cutoff: Full architectural room walls (>= 1.75m tall / top height >= 1.75m above floor)
            const wallCutoff = Math.max(1.75, roomHeight * 0.55);
            const isTallWall = (topHeightAboveFloor >= wallCutoff) || (nodeH >= wallCutoff);

            if (isExplicitStructure && !isExplicitSmallItem) {
              wallMeshes.push(node);
            } else if (!isExplicitSmallItem && isTallWall) {
              wallMeshes.push(node);
            }

            // Dim small furniture slightly so realistic beam remains pristine
            if (isExplicitSmallItem && node.material) {
              if (Array.isArray(node.material)) {
                node.material.forEach(m => {
                  m.roughness = 0.65;
                  if (m.color) m.color.multiplyScalar(0.95);
                });
              } else {
                node.material.roughness = 0.65;
                if (node.material.color) node.material.color.multiplyScalar(0.95);
              }
            }
          }
        });

        const collisionTarget = wallMeshes.length > 0 ? wallMeshes : [currentModel];

        modelDataRef.current = {
          currentModel, collisionTarget, upAxis, spanW, maxDim,
          totalH,
          boxMaxY: box.max.y, boxMaxZ: box.max.z,
          boxMinY: box.min.y, boxMinZ: box.min.z
        };
        
        // Force a state update to trigger marker rendering now that model is loaded
        setLocalMarkers(prev => [...prev]);
      },
      undefined,
      (error) => console.error("Error loading 3D model:", error)
    );

    const themeObserver = new MutationObserver(() => {
      const isL = isThemeLight();
      if (sceneRef.current) {
        sceneRef.current.background = new THREE.Color(isL ? "#cbd5e1" : "#0d1117");
      }
      if (gridHelperRef.current && gridHelperRef.current.geometry?.attributes?.color) {
        const colors = gridHelperRef.current.geometry.attributes.color;
        const cCenter = new THREE.Color(0x3b82f6);
        const cGrid = new THREE.Color(isL ? 0x94a3b8 : 0x444444);
        for (let i = 0; i < colors.count; i++) {
          const isCenter = (i < 4);
          const c = isCenter ? cCenter : cGrid;
          colors.setXYZ(i, c.r, c.g, c.b);
        }
        colors.needsUpdate = true;
      }
      if (ambientLightRef.current) {
        ambientLightRef.current.intensity = isL ? 0.85 : 0.7;
      }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Expose 3D camera screen projection on container's parent (canvas wrap)
    const get3DScreenPos = (camId, markerIdx) => {
      if (!cameraRef.current || !containerRef.current || !camerasGroupRef.current) return null;
      const camWrapper = camerasGroupRef.current.children.find(c => {
        if (!c.userData) return false;
        if (markerIdx !== undefined && markerIdx !== null && c.userData.markerIndex === markerIdx) return true;
        if (camId) {
          const cidStr = String(camId).toLowerCase();
          if (c.userData.camId && String(c.userData.camId).toLowerCase() === cidStr) return true;
          if (c.userData.camIp && String(c.userData.camIp).toLowerCase() === cidStr) return true;
          if (c.userData.camName && String(c.userData.camName).toLowerCase() === cidStr) return true;
        }
        return false;
      });
      if (!camWrapper) return null;
      cameraRef.current.updateMatrixWorld(true);
      camWrapper.updateWorldMatrix(true, false);
      const tempVec = new THREE.Vector3();
      camWrapper.getWorldPosition(tempVec);
      tempVec.project(cameraRef.current);
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      const sx = ((tempVec.x + 1) / 2) * w;
      const sy = ((-tempVec.y + 1) / 2) * h;
      const isVisible = tempVec.z < 1.0;
      return { sx, sy, isVisible };
    };

    if (container.parentElement) {
      container.parentElement.__get3DCameraScreenPos = get3DScreenPos;
      container.parentElement.__is3DViewer = true;
    }

    const onControlsChange = () => {
      container.parentElement?.__vtReposition?.();
    };
    controls.addEventListener("change", onControlsChange);

    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const changed = controls.update();
      if (changed && container.parentElement?.__vtReposition) {
        container.parentElement.__vtReposition();
      }
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      container.parentElement?.__vtReposition?.();
    };
    
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);

    return () => {
      themeObserver.disconnect();
      resizeObserver.disconnect();
      controls.removeEventListener("change", onControlsChange);
      if (container.parentElement) {
        delete container.parentElement.__get3DCameraScreenPos;
      }
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      
      if (currentModel) {
        scene.remove(currentModel);
        currentModel.traverse((node) => {
          if (node.isMesh) {
            node.geometry?.dispose();
            if (Array.isArray(node.material)) {
              node.material.forEach((m) => m.dispose());
            } else if (node.material) {
              node.material.dispose();
            }
          }
        });
      }
      
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [modelUrl]);

  // ── Metrics Visibility Effect ──
  useEffect(() => {
    dimensionSpritesRef.current.forEach(sprite => {
      if (sprite) sprite.visible = showMetricsVisibility;
    });
  }, [showMetricsVisibility]);

  // ── 2. Build Cameras Geometry ────────────────────────────────────
  useEffect(() => {
    if (!modelDataRef.current || !camerasGroupRef.current) return;
    
    // Clear old markers
    while (camerasGroupRef.current.children.length > 0) {
      camerasGroupRef.current.remove(camerasGroupRef.current.children[0]);
    }

    const imgW = imageSize?.width || 2048;
    const imgH = imageSize?.height || 2048;
    const { currentModel, collisionTarget, upAxis, spanW, boxMaxY, boxMaxZ } = modelDataRef.current;
    const maxDim = spanW * 1.2;
    const scaleX = (spanW * 1.05) / imgW;
    const spriteSize = maxDim * 0.05 * (iconScale || 1.2); 
    
    // Invisible material for hitboxes so Raycaster can still hit them!
    const invisibleMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

    // Volumetric FOV Beam Material: Realistic 3D covering (professional vibrant blue or emerald green)
    const beamColor = showHeatmap ? 0x10B981 : 0x0ea5e9;
    const fovMat = new THREE.MeshStandardMaterial({ 
      color: beamColor, 
      emissive: beamColor,
      emissiveIntensity: showHeatmap ? 0.25 : 0.20,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true, 
      opacity: showHeatmap ? 0.38 : 0.32, 
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    const raycaster = new THREE.Raycaster();
    const furnitureKeywords = /chair|table|desk|seat|computer|pc|screen|monitor|laptop|mouse|keyboard|phone|lamp|plant|flower|prop|decor|cabinet|drawer|cushion|sofa|person|human|avatar|trash|bin|cup|mug|bottle|gadget|particle|bench|shelf|bookshelf|server|tv|mat|carpet|light|fixture|fitting|outlet|switch|sign|wire|cable/i;
    // Use pre-filtered collisionTarget (only full-height room walls, not short cubicle partitions).
    // Falls back to currentModel if no walls were classified (e.g. unnamed geometry).
    const targetsToIntersect = Array.isArray(collisionTarget) && collisionTarget.length > 0
      ? collisionTarget
      : (currentModel ? [currentModel] : []);

    localMarkers.forEach((marker, idx) => {
      const cam = cameras.find(c => c.id === marker.camId);
      const type = getCamType(cam?.name);
      const isOnline = cam?.status === "online";
      const color = isOnline ? (showHeatmap ? "#10B981" : "#0284C7") : "#666666";
      
      const tex = createCameraTexture(type, color, (idx + 1).toString());
      // We apply rotation to the sprite material so it faces the correct 2D direction!
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, rotation: -(marker.direction || 0) * (Math.PI / 180) });

      const dx = marker.x - imgW / 2;
      const dy = marker.y - imgH / 2;
      const mapX = dx * scaleX;
      
      let mapY, mapZ;
      if (upAxis === "y") {
        mapZ = dy * scaleX;
        mapY = boxMaxY * 0.95; // hover near ceiling
      } else {
        mapY = -dy * scaleX;
        mapZ = boxMaxZ * 0.95;
      }

      const camWrapper = new THREE.Group();
      camWrapper.position.set(mapX, mapY, mapZ);
      camWrapper.userData = {
        camId: marker.camId,
        camIp: marker.camIp || cam?.ip,
        camName: marker.camName || cam?.name,
        markerIndex: idx
      };
      camerasGroupRef.current.add(camWrapper);
      
      // The camera icon
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(spriteSize, spriteSize, 1);
      sprite.renderOrder = 999; 
      camWrapper.add(sprite);

      // ── CAD Circular Rotation Handle (↻) for live 3D camera rotation ──
      const eyeSprite = createRotationHandleSprite();
      const eyeSize = spriteSize * 0.45;
      eyeSprite.scale.set(eyeSize, eyeSize, 1);
      eyeSprite.renderOrder = 1010;
      
      const eyeDirRad = (marker.direction || 0) * (Math.PI / 180);
      const eyeDist = spriteSize * 0.95;
      let eyeDx = Math.cos(eyeDirRad) * eyeDist;
      let eyeDz = Math.sin(eyeDirRad) * eyeDist;
      if (upAxis === "y") {
        eyeSprite.position.set(eyeDx, 0, eyeDz);
      } else {
        eyeSprite.position.set(eyeDx, -eyeDz, 0);
      }
      camWrapper.add(eyeSprite);

      // Invisible Raycast Hitbox for Eye Rotate Handle
      const eyeHitbox = new THREE.Mesh(new THREE.SphereGeometry(eyeSize * 1.3), invisibleMat);
      eyeHitbox.position.copy(eyeSprite.position);
      eyeHitbox.userData = { isEyeRotateHandle: true, index: idx };
      camWrapper.add(eyeHitbox);

      // Invisible Raycast Hitbox
      const hitbox = new THREE.Mesh(new THREE.SphereGeometry(spriteSize * 1.2), invisibleMat);
      hitbox.userData = { isCameraHitbox: true, index: idx };
      camWrapper.add(hitbox);

      // ── Camera Model/Name Label Badge (Floating 3D pill badge matching 2D style) ──
      const labelText = marker.camName || cam?.model || cam?.name || marker.camera?.model || `Camera ${idx + 1}`;
      const borderColor = selectedIdx === idx ? "#38bdf8" : "#a855f7";
      const { sprite: labelSprite, aspect: labelAspect } = createCameraLabelSprite(labelText, borderColor);
      const labelH = spriteSize * 0.42;
      const labelW = labelH * labelAspect;
      labelSprite.scale.set(labelW, labelH, 1);
      labelSprite.renderOrder = 1001;

      // Position badge floating above & slightly offset with user labelOffset
      const lo = marker.labelOffset || { dx: 0, dy: 0, dz: 0 };
      let defaultLx, defaultLy, defaultLz;
      if (upAxis === "y") {
        defaultLx = -spriteSize * 0.45;
        defaultLy = spriteSize * 0.75;
        defaultLz = -spriteSize * 0.45;
      } else {
        defaultLx = -spriteSize * 0.45;
        defaultLy = spriteSize * 0.45;
        defaultLz = spriteSize * 0.75;
      }
      const lx = defaultLx + (lo.dx || 0);
      const ly = defaultLy + (lo.dy || 0);
      const lz = defaultLz + (lo.dz || 0);

      labelSprite.position.set(lx, ly, lz);
      camWrapper.add(labelSprite);

      // Invisible Raycast Hitbox for Label Badge (easy dragging)
      const labelHitbox = new THREE.Mesh(new THREE.BoxGeometry(labelW * 1.2, labelH * 1.4, spriteSize * 0.5), invisibleMat);
      labelHitbox.position.set(lx, ly, lz);
      labelHitbox.userData = { isCameraLabelHitbox: true, index: idx };
      camWrapper.add(labelHitbox);

      // Subtle dashed leader line connecting camera center to label badge
      const leaderLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(lx, ly, lz)
      ]);
      const leaderLineMat = new THREE.LineDashedMaterial({
        color: selectedIdx === idx ? 0x38bdf8 : 0xa855f7,
        dashSize: spriteSize * 0.08,
        gapSize: spriteSize * 0.05,
        transparent: true,
        opacity: 0.75,
        depthTest: false
      });
      const leaderLine = new THREE.Line(leaderLineGeo, leaderLineMat);
      leaderLine.computeLineDistances();
      camWrapper.add(leaderLine);

      const fovAngle = marker.fovAngle || cam?.specs?.hfov || marker.camera?.hfov || 60;
      const direction = marker.direction || 0;
      const fovRad = fovAngle * (Math.PI / 180);
      const dirRad = direction * (Math.PI / 180);
      const vFovRad = cam?.specs?.vfov ? cam.specs.vfov * (Math.PI / 180) : 40 * (Math.PI / 180); 
      const nominalRange = Number(cam?.specs?.rangeDay || cam?.rangeDay || marker.camera?.rangeDay || marker.camera?.specs?.rangeDay || (cam?.specs?.rangeNight ? cam.specs.rangeNight : null) || 25);
      const effectivePpm = (typeof showPpm === "number" && showPpm > 0) ? showPpm : (imgW / Math.max(1, spanW));
      const worldUnitsPerMeter = effectivePpm * scaleX;
      // Real physical range in 3D world units matching datasheet rangeDay spec
      const rayMaxDist = Math.max(2.0, nominalRange * worldUnitsPerMeter);

      const floorLevel = upAxis === "y" ? (modelDataRef.current?.boxMinY ?? 0) : (modelDataRef.current?.boxMinZ ?? 0);
      const camWorldY = upAxis === "y" ? camWrapper.position.y : camWrapper.position.z;
      const heightAboveFloor = Math.max(0.1, camWorldY - floorLevel);

      // Dynamically scale downward pitch angle based on camera range so the beam extends to its full datasheet range (e.g. 15m, 30m, 50m, 100m)
      const pitchRad = Math.atan2(heightAboveFloor, Math.max(1.0, rayMaxDist * 0.55));
      const tiltTop = Math.max(0.01, pitchRad - (vFovRad / 2));
      const tiltBottom = pitchRad + (vFovRad / 2);

      const origin = new THREE.Vector3(0, 0, 0); 
      const topPoints = [];
      const bottomPoints = [];
      const numRays = 64; // High-resolution smooth visibility polygon
      const camWorldPos = camWrapper.position.clone();
      const camEyePos = camWorldPos.clone();
      if (upAxis === "y") {
        camEyePos.y = camWorldPos.y - Math.min(0.25, heightAboveFloor * 0.1);
      } else {
        camEyePos.z = camWorldPos.z - Math.min(0.25, heightAboveFloor * 0.1);
      }

      for (let i = 0; i <= numRays; i++) {
        const angle = dirRad - (fovRad / 2) + (fovRad * (i / numRays));
        
        const computeRay = (tilt) => {
          let rx, ry, rz;
          if (upAxis === "y") {
            rx = Math.cos(angle) * Math.cos(tilt);
            ry = -Math.sin(tilt);
            rz = Math.sin(angle) * Math.cos(tilt);
          } else {
            rx = Math.cos(angle) * Math.cos(tilt);
            ry = -Math.sin(angle) * Math.cos(tilt);
            rz = -Math.sin(tilt);
          }
          const rayDir = new THREE.Vector3(rx, ry, rz).normalize();

          // 1. Calculate floor intersection limit (rays cannot penetrate below floorLevel)
          let groundDist = rayMaxDist;
          const downComponent = upAxis === "y" ? -rayDir.y : -rayDir.z;
          if (downComponent > 0.05) {
            groundDist = heightAboveFloor / downComponent;
          }
          const effectiveMaxDist = Math.min(rayMaxDist, groundDist);

          // 2. Physical wall / obstacle collision raycasting (stops dead at walls only)
          // We convert hit.face.normal to true WORLD space coordinates so transformed GLTF wall meshes block rays properly.
          let hitDist = effectiveMaxDist;
          if (targetsToIntersect && targetsToIntersect.length > 0) {
            raycaster.set(camEyePos, rayDir);
            const hits = raycaster.intersectObjects(targetsToIntersect, true);
            for (const hit of hits) {
              if (hit.distance < 0.05) continue;
              if (hit.object?.userData?.isMiradorCamera || hit.object?.userData?.isMiradorFovBeam) continue;
              if (hit.object?.isSprite) continue;

              // Transform face normal to WORLD space to accurately detect vertical walls vs horizontal floors/ceilings
              if (hit.face && hit.object) {
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
                const worldNormal = hit.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
                const upComponent = upAxis === "y" ? Math.abs(worldNormal.y) : Math.abs(worldNormal.z);
                if (upComponent > 0.5) continue; // skip floors, ceilings, desk tops
              }

              const hitName = (hit.object?.name || "").toLowerCase();
              if (furnitureKeywords.test(hitName)) continue;

              hitDist = Math.min(hitDist, hit.distance);
              break;
            }
          }
          const finalDist = Math.min(effectiveMaxDist, hitDist);
          
          // 3. Construct point in local camera coordinates
          const pt = rayDir.clone().multiplyScalar(finalDist);

          if (upAxis === "y") {
            if (pt.y < -heightAboveFloor) pt.y = -heightAboveFloor;
          } else {
            if (pt.z < -heightAboveFloor) pt.z = -heightAboveFloor;
          }
          return pt;
        };

        topPoints.push(computeRay(tiltTop));
        bottomPoints.push(computeRay(tiltBottom));
      }

      // ── Build Realistic 3D Volumetric FOV Beam (Solid High-Fidelity Optical Volume) ──
      const baseColorHex = showHeatmap ? 0x10B981 : 0x2563eb;
      const baseColor = new THREE.Color(baseColorHex);

      const vertices = [];
      const colors = [];

      const pushVertexWithGradient = (p) => {
        vertices.push(p.x, p.y, p.z);
        const d = Math.hypot(p.x, p.y, p.z);
        const t = Math.min(1.0, d / (rayMaxDist || 1));
        // Realistic optical intensity: Brightest at lens (1.0), gentle falloff to 0.45 at floor
        const intensity = Math.max(0.45, Math.pow(1.0 - t, 0.55));
        colors.push(baseColor.r * intensity, baseColor.g * intensity, baseColor.b * intensity);
      };

      const pushTrisWithGradient = (p1, p2, p3) => {
        pushVertexWithGradient(p1);
        pushVertexWithGradient(p2);
        pushVertexWithGradient(p3);
      };

      for (let i = 0; i < numRays; i++) {
        const t0 = topPoints[i];
        const t1 = topPoints[i + 1];
        const b0 = bottomPoints[i];
        const b1 = bottomPoints[i + 1];

        // Top face
        pushTrisWithGradient(origin, t0, t1);
        // Bottom face (clamped flush to floor)
        pushTrisWithGradient(origin, b1, b0);
        // Front / Far face quad
        pushTrisWithGradient(t0, b0, b1);
        pushTrisWithGradient(t0, b1, t1);
      }
      // Left and Right side faces
      pushTrisWithGradient(origin, bottomPoints[0], topPoints[0]);
      pushTrisWithGradient(origin, topPoints[numRays], bottomPoints[numRays]);

      const fovGeo = new THREE.BufferGeometry();
      fovGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      fovGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      fovGeo.computeVertexNormals();

      // Solid, realistic 3D volumetric material with standard PBR shading and soft glow
      const fovVolumetricMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: showHeatmap ? 0.42 : 0.36,
        roughness: 0.20,
        metalness: 0.10,
        emissive: baseColorHex,
        emissiveIntensity: showHeatmap ? 0.35 : 0.28,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1.0,
        polygonOffsetUnits: -4.0
      });

      if (!showPpm) {
        const fovMesh = new THREE.Mesh(fovGeo, fovVolumetricMat);
        fovMesh.name = `FOV_Beam_${marker.camId || idx + 1}`;
        fovMesh.userData = { isMiradorFovBeam: true, camId: marker.camId };
        camWrapper.add(fovMesh);
      }

      // ── 3D Clarity Zones (DORI Bands with Ground Clamping) ──
      if (showPpm) {
        const doriMeterMap = getDoriDistances(cam || marker.camera || { megapixels: 2, hfov: fovAngle, rangeDay: nominalRange });

        // DORI zones sorted from closest to furthest: Identification (Purple), Recognition (Red), Observation (Yellow), Detection (Blue)
        const rawZones = [
          { label: "Identification", color: 0xa855f7, opacity: 0.65, distMeters: doriMeterMap.identification },
          { label: "Recognition", color: 0xef4444, opacity: 0.60, distMeters: doriMeterMap.recognition },
          { label: "Observation", color: 0xeab308, opacity: 0.55, distMeters: doriMeterMap.observation },
          { label: "Detection", color: 0x3b82f6, opacity: 0.45, distMeters: doriMeterMap.detection }
        ];

        let prevDist = 0;
        const doriBands = [];
        for (const z of rawZones) {
          const outerDist = Math.max(0.1, Math.min(rayMaxDist, z.distMeters * worldUnitsPerMeter));
          if (outerDist > prevDist + 0.05) {
            doriBands.push({
              ...z,
              distInner: prevDist,
              distOuter: outerDist
            });
            prevDist = outerDist;
          }
        }

        doriBands.forEach(band => {
          const bandVertices = [];
          const bTopInPts = [];
          const bBotInPts = [];
          const bTopOutPts = [];
          const bBotOutPts = [];
          const bandRays = 24;

          const computeRayPt = (bAngle, tilt, targetDist) => {
            if (targetDist <= 0.001) return new THREE.Vector3(0, 0, 0);
            let rx, ry, rz;
            if (upAxis === "y") {
              rx = Math.cos(bAngle) * Math.cos(tilt);
              ry = -Math.sin(tilt);
              rz = Math.sin(bAngle) * Math.cos(tilt);
            } else {
              rx = Math.cos(bAngle) * Math.cos(tilt);
              ry = -Math.sin(bAngle) * Math.cos(tilt);
              rz = -Math.sin(tilt);
            }
            const rayDir = new THREE.Vector3(rx, ry, rz).normalize();

            let groundDist = targetDist;
            const downComp = upAxis === "y" ? -rayDir.y : -rayDir.z;
            if (downComp > 0.001) {
              groundDist = heightAboveFloor / downComp;
            }
            const effectiveMaxDist = Math.min(targetDist, groundDist);

            raycaster.set(camEyePos, rayDir);
            const hits = raycaster.intersectObjects(targetsToIntersect, true);
            let hitDist = effectiveMaxDist;
            for (const hit of hits) {
              if (hit.distance < 0.05) continue;
              if (hit.object?.userData?.isMiradorCamera || hit.object?.userData?.isMiradorFovBeam) continue;
              if (hit.object?.isSprite) continue;

              if (hit.face) {
                const upComp = upAxis === "y" ? Math.abs(hit.face.normal.y) : Math.abs(hit.face.normal.z);
                if (upComp > 0.5) continue;
              }
              const hitName = (hit.object?.name || "").toLowerCase();
              if (furnitureKeywords.test(hitName)) continue;

              hitDist = Math.min(hitDist, hit.distance);
              break;
            }
            const finalDist = Math.min(effectiveMaxDist, hitDist);
            const pt = rayDir.clone().multiplyScalar(finalDist);
            if (upAxis === "y") {
              if (pt.y < -heightAboveFloor) pt.y = -heightAboveFloor;
            } else {
              if (pt.z < -heightAboveFloor) pt.z = -heightAboveFloor;
            }
            return pt;
          };

          for (let bi = 0; bi <= bandRays; bi++) {
            const bAngle = dirRad - (fovRad / 2) + (fovRad * (bi / bandRays));
            bTopInPts.push(computeRayPt(bAngle, tiltTop, band.distInner));
            bBotInPts.push(computeRayPt(bAngle, tiltBottom, band.distInner));
            bTopOutPts.push(computeRayPt(bAngle, tiltTop, band.distOuter));
            bBotOutPts.push(computeRayPt(bAngle, tiltBottom, band.distOuter));
          }

          // Measure actual outer hit distance to ensure the band is not completely behind a wall
          let maxOuterHit = 0;
          bTopOutPts.forEach(pt => { const d = pt.length(); if (d > maxOuterHit) maxOuterHit = d; });
          bBotOutPts.forEach(pt => { const d = pt.length(); if (d > maxOuterHit) maxOuterHit = d; });

          // Skip drawing if the entire band is behind a wall or obstacle
          if (maxOuterHit <= band.distInner + 0.15) return;

          const pushTris = (...pts) => pts.forEach(p => bandVertices.push(p.x, p.y, p.z));
          const pushQuad = (p1, p2, p3, p4) => {
            pushTris(p1, p2, p3);
            pushTris(p1, p3, p4);
          };

          for (let bi = 0; bi < bandRays; bi++) {
            const tIn0  = bTopInPts[bi];
            const tIn1  = bTopInPts[bi + 1];
            const bIn0  = bBotInPts[bi];
            const bIn1  = bBotInPts[bi + 1];
            const tOut0 = bTopOutPts[bi];
            const tOut1 = bTopOutPts[bi + 1];
            const bOut0 = bBotOutPts[bi];
            const bOut1 = bBotOutPts[bi + 1];

            // Top surface
            pushQuad(tIn0, tOut0, tOut1, tIn1);
            // Bottom surface
            pushQuad(bIn0, bIn1, bOut1, bOut0);
            // Outer cap
            pushQuad(tOut0, bOut0, bOut1, tOut1);
            // Inner cap (if not at origin)
            if (band.distInner > 0.05) {
              pushQuad(tIn0, tIn1, bIn1, bIn0);
            }
          }

          // Side caps
          pushQuad(bTopInPts[0], bBotInPts[0], bBotOutPts[0], bTopOutPts[0]);
          pushQuad(bTopInPts[bandRays], bTopOutPts[bandRays], bBotOutPts[bandRays], bBotInPts[bandRays]);

          const bandGeo = new THREE.BufferGeometry();
          bandGeo.setAttribute("position", new THREE.Float32BufferAttribute(bandVertices, 3));
          bandGeo.computeVertexNormals();
          const bandMat = new THREE.MeshBasicMaterial({
            color: band.color,
            transparent: true,
            opacity: band.opacity,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          const bandMesh = new THREE.Mesh(bandGeo, bandMat);
          bandMesh.renderOrder = 850;
          camWrapper.add(bandMesh);

          // ── Attach 3D DORI Meter Text Label Sprite onto the beam ──
          const centerPt = computeRayPt(dirRad, (tiltTop + tiltBottom) / 2, band.distOuter);
          if (centerPt && centerPt.length() > band.distInner + 0.1) {
            const labelText = `${band.distMeters.toFixed(1)} m`;
            const hexColorStr = `#${band.color.toString(16).padStart(6, '0')}`;
            const labelSprite = createDoriLabelSprite(labelText, hexColorStr);
            labelSprite.position.copy(centerPt);
            if (upAxis === "y") labelSprite.position.y += 0.25;
            else labelSprite.position.z += 0.25;
            camWrapper.add(labelSprite);
          }
        });
      }

      // In Heatmap mode: Add soft directional illumination so covered floor/objects physically glow in emerald green
      if (showHeatmap && isOnline) {
        const spot = new THREE.SpotLight(0x10B981, 2.8, rayMaxDist * 1.5, (fovAngle * 0.5) * (Math.PI / 180), 0.5, 1.2);
        spot.position.set(0, 0, 0);
        const targetObj = new THREE.Object3D();
        let tx, ty, tz;
        if (upAxis === "y") {
          tx = Math.cos(dirRad) * (rayMaxDist * 0.5);
          ty = -Math.sin(pitchRad) * (rayMaxDist * 0.5);
          tz = Math.sin(dirRad) * (rayMaxDist * 0.5);
        } else {
          tx = Math.cos(dirRad) * (rayMaxDist * 0.5);
          ty = -Math.sin(dirRad) * (rayMaxDist * 0.5);
          tz = -Math.sin(pitchRad) * (rayMaxDist * 0.5);
        }
        targetObj.position.set(tx, ty, tz);
        camWrapper.add(targetObj);
        spot.target = targetObj;
        camWrapper.add(spot);
      }
    });
  }, [localMarkers, imageSize, showHeatmap, iconScale, showPpm, selectedIdx]);

  // ── Dynamic scene lighting for 3D Heatmap: Dims blind spots to dark slate / dullish gray ──
  useEffect(() => {
    if (!ambientLightRef.current || !dirLightRef.current || !fillLightRef.current) return;
    const isL = isThemeLight();
    if (showHeatmap) {
      // Uncovered areas & blind spots become dull/grayish atmospheric shadow
      ambientLightRef.current.intensity = 0.22;
      ambientLightRef.current.color.setHex(0x64748b);
      dirLightRef.current.intensity = 0.30;
      fillLightRef.current.intensity = 0.10;
    } else {
      // Normal full daylight
      ambientLightRef.current.intensity = isL ? 0.85 : 0.7;
      ambientLightRef.current.color.setHex(0xffffff);
      dirLightRef.current.intensity = 1.0;
      fillLightRef.current.intensity = 0.3;
    }
  }, [showHeatmap]);

  // ── 3. Drag and Rotate Interactivity ─────────────────────────────
  useEffect(() => {
    if (!rendererRef.current || !cameraRef.current) return;
    const canvas = rendererRef.current.domElement;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let plane = new THREE.Plane(); 

    const getIntersects = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, cameraRef.current);
      if (!camerasGroupRef.current) return [];
      return raycaster.intersectObjects(camerasGroupRef.current.children, true);
    };

    const onPointerDown = (e) => {
      const hits = getIntersects(e);
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY, idx: null };
      if (hits.length > 0) {
        const eyeHit = hits.find(h => h.object.userData.isEyeRotateHandle);
        const hit = hits.find(h => h.object.userData.isCameraHitbox || h.object.userData.isCameraLabelHitbox || h.object.userData.isEyeRotateHandle);
        if (hit) {
          e.preventDefault();
          controlsRef.current.enabled = false;
          isDraggingRef.current = true;
          const hitIdx = hit.object.userData.index;
          pointerDownPosRef.current.idx = hitIdx;
          
          if (eyeHit) {
            rotatingIdxRef.current = hitIdx;
          } else if (hit.object.userData.isCameraLabelHitbox) {
            draggingLabelIdxRef.current = hitIdx;
          } else {
            draggingIdxRef.current = hitIdx;
          }

          const upAxis = modelDataRef.current?.upAxis || "y";
          const normal = upAxis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
          plane.setFromNormalAndCoplanarPoint(normal, hit.object.parent.position);
        }
      }
    };

    const onPointerMove = (e) => {
      const hits = getIntersects(e);
      
      if (!isDraggingRef.current) {
        const interactive = hits.find(h => h.object.userData.isCameraHitbox || h.object.userData.isCameraLabelHitbox || h.object.userData.isEyeRotateHandle);
        canvas.style.cursor = interactive ? (hits.find(h => h.object.userData.isCameraLabelHitbox) ? "grab" : "pointer") : "default";
        return;
      }
      
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, cameraRef.current);
      
      const targetPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, targetPoint);
      
      if (!targetPoint || !modelDataRef.current) return;
      
      const { upAxis, spanW } = modelDataRef.current;
      const scaleX = (spanW * 1.05) / imageSize.width;
      const spriteSize = (spanW * 1.2) * 0.05;

      if (rotatingIdxRef.current !== -1) {
        // Rotate camera direction live via Eye handle drag
        const idx = rotatingIdxRef.current;
        const camWrapper = camerasGroupRef.current?.children[idx];
        if (camWrapper) {
          const camPos = camWrapper.position;
          let dx = targetPoint.x - camPos.x;
          let dz = upAxis === "y" ? (targetPoint.z - camPos.z) : (-targetPoint.y - camPos.y);
          let deg = Math.atan2(dz, dx) * (180 / Math.PI);
          if (deg < 0) deg += 360;

          setLocalMarkers(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], direction: Math.round(deg) };
            return next;
          });
        }
      } else if (draggingLabelIdxRef.current !== -1) {
        // Drag label offset
        const idx = draggingLabelIdxRef.current;
        const camWrapper = camerasGroupRef.current?.children[idx];
        if (camWrapper) {
          const camWorldPos = camWrapper.position;
          let defaultLx, defaultLy, defaultLz;
          if (upAxis === "y") {
            defaultLx = -spriteSize * 0.45;
            defaultLy = spriteSize * 0.75;
            defaultLz = -spriteSize * 0.45;
          } else {
            defaultLx = -spriteSize * 0.45;
            defaultLy = spriteSize * 0.45;
            defaultLz = spriteSize * 0.75;
          }
          const relX = targetPoint.x - camWorldPos.x;
          const relY = targetPoint.y - camWorldPos.y;
          const relZ = targetPoint.z - camWorldPos.z;

          const dx = relX - defaultLx;
          const dy = relY - defaultLy;
          const dz = relZ - defaultLz;

          setLocalMarkers(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], labelOffset: { dx, dy, dz } };
            return next;
          });
        }
      } else if (draggingIdxRef.current !== -1) {
        // Update Position
        setLocalMarkers(prev => {
          const next = [...prev];
          const m = { ...next[draggingIdxRef.current] };
          
          let dx, dy;
          if (upAxis === "y") {
            dx = targetPoint.x / scaleX;
            dy = targetPoint.z / scaleX;
          } else {
            dx = targetPoint.x / scaleX;
            dy = -targetPoint.y / scaleX;
          }
          
          m.x = dx + imageSize.width / 2;
          m.y = dy + imageSize.height / 2;
          next[draggingIdxRef.current] = m;
          return next;
        });
      }
    };

    const onPointerUp = (e) => {
      const pDown = pointerDownPosRef.current;
      const moveDist = Math.hypot(e.clientX - pDown.x, e.clientY - pDown.y);

      if (pDown.idx !== null && moveDist < 6) {
        // User clicked camera on 3D canvas
        if (typeof onSelectCamera === "function") {
          onSelectCamera(pDown.idx);
        }
      }

      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        draggingIdxRef.current = -1;
        rotatingIdxRef.current = -1;
        draggingLabelIdxRef.current = -1;
        controlsRef.current.enabled = true;
        
        if (updateMarkers && moveDist >= 6) {
           setLocalMarkers(current => {
             updateMarkers(current);
             return current;
           });
        }
      }
      pointerDownPosRef.current = { x: 0, y: 0, idx: null };
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [imageSize, updateMarkers, cameras, onSelectCamera]);

  return (
    <>
      <div 
        ref={containerRef} 
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0, zIndex: 1, overflow: "hidden" }} 
      />
      {hoverTooltip && (() => {
        const cam = cameras?.find(c => c.id === hoverTooltip.camId);
        if (!cam) return null;
        return (
          <div style={{
            position: "fixed",
            left: hoverTooltip.x + 15,
            top: hoverTooltip.y + 15,
            background: "var(--bg-surface, #0d1117)",
            color: "var(--text-primary, #e8edf5)",
            padding: "8px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            fontFamily: "inherit",
            pointerEvents: "none",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.3))",
            border: "1px solid var(--border)"
          }}>
            <div style={{ fontWeight: "bold" }}>{cam.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: cam.status === "online" ? "var(--teal, #10b981)" : "var(--text-muted, #a0aec0)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: cam.status === "online" ? "var(--teal, #10b981)" : "var(--text-muted, #a0aec0)" }} />
              {cam.status}
            </div>
          </div>
          );
        })()}
      {report && <PartsMeasurementPanel report={report} floorPanelCollapsed={floorPanelCollapsed} />}
    </>
  );
});

export default Gltf3DViewer;
