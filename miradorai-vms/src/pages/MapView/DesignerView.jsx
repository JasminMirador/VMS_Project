import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import "./DesignerView.css";
import { fovDrawParams } from "./CameraModelDB";
import { drawHeatmapToContext, drawHeatmapLegendToCanvas, drawDesignLegendToCanvas } from "./HeatmapLogic";
import HeatmapLayer from "./HeatmapLayer";
import * as CctvCalc from "./CctvCalculators";
import { drawStorageReport } from "./ReportLogic.js";
import logoImg from "../../assets/logo.jpg";
import sentinelLogoImg from "../../assets/sentinel logo.jpg";
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
import jsPDF from "jspdf";
import Gltf3DViewer from "./Gltf3DViewer";
import { renderGltfToImage } from "./GltfFloorRenderer";
import { renderHtmlToImage } from "./HtmlFloorRenderer";
import { saveFloorsDB, loadFloorsDB } from "./mapIndexedDB";
import CalibrationOverlay from "./CalibrationOverlay";
import CalibrationPanel from "./CalibrationPanel";
import {
  getPixelDistance,
  calculatePhysicalDistance,
  buildStandardCalibration,
  buildAdvancedCalibration,
  layoutToWorld
} from "./LayoutCalibrationEngine";
// ── Constants ─────────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || "";
const MAP_ID = "default";
const FLOOR_ID = "floor_1";
const PIXELS_PER_METRE = 22;

function getAuthHeaders() {
  const t = localStorage.getItem("miradorai_token") || "";
  return t
    ? { Authorization: "Bearer " + t, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiSaveLayout({ placed, zones, ppm, floorPlan = null, slides = null, activeSlideId = null }) {
  try {
    const bodyObj = {
      map_id: MAP_ID,
      floor_id: FLOOR_ID,
      placed: placed.map(p => ({ id: p.id, x: p.x, y: p.y, direction: p.direction, camera: p.camera, ...(p.labelOffset ? { labelOffset: p.labelOffset } : {}) })),
      zones: zones.map(z => ({ id: z.id, name: z.name, color: z.color, polygon: z.polygon, isShape: z.isShape || false, isBoomBarrier: z.isBoomBarrier || false })),
      ppm,
      floor_plan: floorPlan,
    };
    if (slides) {
      bodyObj.slides = slides;
    }
    if (activeSlideId) {
      bodyObj.active_slide_id = activeSlideId;
    }
    await fetch(`${API}/api/designer`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(bodyObj),
    });
  } catch (e) {
    console.error("[DESIGNER] ❌ Save failed", e);
  }
}

async function apiSaveZones(zones) {
  try {
    await fetch(`${API}/api/designer/zones?map_id=${MAP_ID}&floor_id=${FLOOR_ID}`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(zones.map(z => ({ id: z.id, name: z.name, color: z.color, polygon: z.polygon, isShape: z.isShape || false, isBoomBarrier: z.isBoomBarrier || false }))),
    });
  } catch (e) {
    console.error("[DESIGNER] ❌ Zone save failed", e);
  }
}

async function apiDeleteZone(zoneId) {
  try {
    await fetch(`${API}/api/designer/zones/${zoneId}?map_id=${MAP_ID}&floor_id=${FLOOR_ID}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("[DESIGNER] ❌ Zone delete failed", e);
  }
}

async function apiSaveFloorPlan(floorPlanDataUrl) {
  if (!floorPlanDataUrl) return;
  try {
    await fetch(`${API}/api/designer/floor-plan`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ map_id: MAP_ID, floor_id: FLOOR_ID, floor_plan: floorPlanDataUrl }),
    });
  } catch (e) {
    console.error("[DESIGNER] ❌ Floor plan save failed", e);
  }
}

// ── NEW: Delete floor plan from backend ───────────────────────────────────────
async function apiDeleteFloorPlan() {
  try {
    await fetch(`${API}/api/designer/floor-plan?map_id=${MAP_ID}&floor_id=${FLOOR_ID}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
  } catch (e) {
    console.error("[DESIGNER] ❌ Floor plan delete failed", e);
  }
}

async function apiLoadLayout() {
  try {
    const r = await fetch(`${API}/api/designer?map_id=${MAP_ID}&floor_id=${FLOOR_ID}`, {
      headers: getAuthHeaders(),
    });
    if (!r.ok) return null;
    return r.json();
  } catch (e) {
    console.error("[DESIGNER] ❌ Load failed", e);
    return null;
  }
}

async function fetchCameraModels({ brand = null, type = null, search = "" } = {}) {
  const params = new URLSearchParams();
  if (brand) params.append("brand", brand);
  if (type) params.append("type", type);
  if (search) params.append("search", search);
  const r = await fetch(`${API}/api/designer/camera-models?${params}`, { headers: getAuthHeaders() });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

const TYPE_ICONS = {
  dome: "⊙", bullet: "▶", ptz: "↻", fisheye: "◎", box: "▪", thermal: "🌡",
};
const TYPE_COLORS = {
  dome: "#3b82f6", bullet: "#f59e0b", ptz: "#8b5cf6",
  fisheye: "#10b981", box: "#f97316", thermal: "#ef4444",

};
const ZONE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#f97316", "#06b6d4"];
const SHAPE_NAMES = new Set(["Rectangle","Circle","Triangle","Hexagon","Diamond","Star","Cross","Arrow","L-Shape","T-Shape","U-Shape","Boom Barrier"]);
const SHAPE_ICONS = {
  Rectangle: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
    </svg>
  ),
  Circle: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" />
    </svg>
  ),
  Triangle: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12,3 2,21 22,21" />
    </svg>
  ),
  Hexagon: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" />
    </svg>
  ),
  Diamond: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12,2 22,12 12,22 2,12" />
    </svg>
  ),
  Star: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" />
    </svg>
  ),
  Cross: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7V3z" />
    </svg>
  ),
  Arrow: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l8 8h-5v12h-6V10H4l8-8z" />
    </svg>
  ),
  "L-Shape": (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6,3 12,3 12,14 18,14 18,20 6,20" />
    </svg>
  ),
  "T-Shape": (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="4,4 20,4 20,10 14,10 14,20 10,20 10,10 4,10" />
    </svg>
  ),
  "U-Shape": (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="4,4 8,4 8,14 16,14 16,4 20,4 20,20 4,20" />
    </svg>
  ),
  "Boom Barrier": (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 18v-6h4v6M8 14h12M18 12l2 2m-6-2l2 2m-6-2l2 2" />
    </svg>
  )
};
function isShapeZone(zone) { return !!(zone.isShape || zone.isBoomBarrier || SHAPE_NAMES.has(zone.name)); }

// ── Point-in-polygon helper ───────────────────────────────────────────────────
function pointInPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── Point-in-polygon or close-to-edge/vertex helper (Boundary matching) ────────
function pointInOrOnPolygon(px, py, polygon) {
  if (!polygon || polygon.length < 3) return false;
  if (pointInPolygon(px, py, polygon)) return true;
  for (let i = 0; i < polygon.length; i++) {
    if (Math.hypot(px - polygon[i].x, py - polygon[i].y) < 3) return true;
  }
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const x1 = polygon[i].x, y1 = polygon[i].y;
    const x2 = polygon[j].x, y2 = polygon[j].y;
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;
    let xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }
    const dist = Math.hypot(px - xx, py - yy);
    if (dist < 3) return true;
  }
  return false;
}


// ── Shoelace formula for polygon area (in square meters) ──────────────────────
function getPolygonArea(polygon, ppm) {
  if (!polygon || polygon.length < 3) return 0;
  let areaPx = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    areaPx += polygon[i].x * polygon[j].y;
    areaPx -= polygon[j].x * polygon[i].y;
  }
  areaPx = Math.abs(areaPx) / 2;
  return areaPx / (ppm * ppm);
}
// ── Loads an image and returns it as a base64 PNG data URL (for embedding in PDFs) ──
function loadImageAsDataUrl(src, cb) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    try { cb(c.toDataURL("image/png"), img.width, img.height); }
    catch (e) { cb(null, 0, 0); }
  };
  img.onerror = () => cb(null, 0, 0);
  img.src = src;
}
// ── Premium Popup Component ─────────────────────────────────────────────
function PremiumPopup({ show, type, title, message, onConfirm, onCancel }) {
  if (!show) return null;
  return (
    <div className="mv-stream-overlay" style={{ zIndex: 99999 }}>
      <div className="mv-zone-name-modal" style={{ maxWidth: 400, border: "1px solid var(--border)", background: "var(--bg-elevated)", backdropFilter: "blur(8px)" }}>
        <div className="mv-zone-name-modal__header" style={{ color: type === "confirm" ? "var(--teal)" : "var(--orange)" }}>
          {type === "confirm" ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="12" cy="12" r="10" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          )}
          <span style={{ fontWeight: 700, fontSize: 18 }}>{title}</span>
        </div>
        <p className="mv-zone-name-modal__sub" style={{ color: "var(--text-primary)", fontSize: 17, marginTop: 8, marginBottom: 20 }}>
          {message}
        </p>
        <div className="mv-zone-name-modal__row" style={{ justifyContent: "flex-end", gap: 10 }}>
          {type === "confirm" && (
            <button className="mv-modal__btn mv-modal__btn--cancel" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="mv-modal__btn mv-modal__btn--confirm" style={{ background: type === "confirm" ? "#3b82f6" : "#1D9E75", borderColor: type === "confirm" ? "#3b82f6" : "#1D9E75" }} onClick={onConfirm}>
            {type === "confirm" ? "Confirm" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
// ── Export Preview Modal — draggable overlays ─────────────────────────
function ExportPreviewModal({ baseDataUrl, exportMode, showDori, isDownloading, onDownload, onCancel, selectedCompany }) {
  const DORI_ITEMS = [
    { color: "#a855f7", label: "Identification (250+ px/m)" },
    { color: "#ef4444", label: "Recognition (125+ px/m)" },
    { color: "#eab308", label: "Observation (62+ px/m)" },
    { color: "#3b82f6", label: "Detection (25+ px/m)" },
  ];

  // Each overlay: { show, x, y, scale }  — null x/y → use CSS default
  const [logo,  setLogo]  = useState({ show: true, x: null, y: null, scale: 1 });
  const [stats, setStats] = useState({ show: true, x: null, y: null, scale: 1 });
  const [dori,  setDori]  = useState({ show: true, x: null, y: null, scale: 1 });
  const [titleOverlay, setTitleOverlay] = useState({ show: true, x: null, y: null, scale: 1 });
  const previewRef = useRef(null);

  // Prevent browser default scroll/zoom when wheeling over overlays
  useEffect(() => {
    const wrap = previewRef.current;
    if (!wrap) return;
    const preventWheel = (e) => {
      if (e.target.closest('[data-zoomable-overlay]')) {
        e.preventDefault();
      }
    };
    wrap.addEventListener("wheel", preventWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", preventWheel);
  }, []);

  const makeWheeler = (setter) => (e) => {
    e.stopPropagation();
    let delta = e.deltaY > 0 ? -0.1 : 0.1;
    if (e.ctrlKey) {
      // Trackpad pinch-to-zoom is finer
      delta = e.deltaY > 0 ? -0.03 : 0.03;
    }
    setter(prev => ({ ...prev, scale: Math.max(0.5, Math.min(3, (prev.scale || 1) + delta)) }));
  };

  // Generic drag handler factory
  const makeDragger = (setter) => (e) => {
    e.preventDefault();
    const wrap = previewRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const el = e.currentTarget.parentElement;
    const elRect = el.getBoundingClientRect();
    const offX = e.clientX - elRect.left;
    const offY = e.clientY - elRect.top;

    const onMove = (mv) => {
      const nx = mv.clientX - rect.left - offX;
      const ny = mv.clientY - rect.top  - offY;
      setter(prev => ({ ...prev, x: Math.max(0, nx), y: Math.max(0, ny) }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  };

  const overlayBase = {
    position: "absolute", userSelect: "none",
    boxShadow: "0 4px 24px rgba(0,0,0,0.55)",
    borderRadius: 8,
  };

  // Collect final overlay positions for caller
  const getOverlayState = () => ({ logo, stats, dori, titleOverlay });

  let titleText = "Designer View";
  if (exportMode === "heatmap") titleText = "Coverage Heatmap";
  else if (exportMode === "dori") titleText = "Clarity Zones";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "rgba(5,8,16,0.88)", backdropFilter: "blur(6px)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    }}>
      {/* Header */}
      <div style={{
        width: "100%", maxWidth: 960, display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "0 20px 10px",
      }}>
        <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 16 }}>
          Export Preview
          <span style={{ marginLeft: 8, fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>
            Drag overlays to reposition · ✕ to remove from export
          </span>
        </div>
        <button onClick={onCancel} style={{
          background: "none", border: "1px solid #2e3d55", color: "#8b9ab0",
          borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 13
        }}>Cancel</button>
      </div>

      {/* Preview area */}
      <div ref={previewRef} data-export-preview style={{
        position: "relative", maxWidth: 960, width: "100%",
        maxHeight: "70vh", overflow: "hidden", borderRadius: 10,
        border: "1px solid var(--border)", background: "var(--bg-base)",
      }}>
        {baseDataUrl && (
          <img src={baseDataUrl} alt="layout preview"
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        )}

        {/* ── Title Overlay ── */}
        {titleOverlay.show && (
          <div data-zoomable-overlay="true" style={{
            ...overlayBase,
            top:   titleOverlay.y !== null ? titleOverlay.y : 12,
            left:  titleOverlay.x !== null ? titleOverlay.x : 12,
            transform: `scale(${titleOverlay.scale || 1})`,
            transformOrigin: "top left",
            background: "rgba(13, 17, 23, 0.9)",
            border: "1px solid rgba(255,255,255,0.15)",
            padding: "12px 16px",
            color: "#e2e8f0",
            fontWeight: 700,
            fontSize: 16,
            textTransform: "uppercase",
            letterSpacing: "1px",
            cursor: "grab",
          }} onWheel={makeWheeler(setTitleOverlay)}>
            <div onMouseDown={makeDragger(setTitleOverlay)} style={{ position: "absolute", inset: 0, cursor: "grab", borderRadius: 8, zIndex: 0 }} />
            <div style={{ position: "relative", zIndex: 1, pointerEvents: "none", paddingRight: 20 }}>
              {titleText}
            </div>
            <button onClick={() => setTitleOverlay(s => ({ ...s, show: false }))} style={{
              position: "absolute", top: 4, right: 6, zIndex: 2, background: "none", border: "none",
              color: "#64748b", cursor: "pointer", fontSize: 13, padding: "2px 4px",
            }} title="Remove from export">✕</button>
          </div>
        )}

        {/* ── Logo Badge overlay ── */}
        {logo.show && (
          <div data-zoomable-overlay="true" style={{
            ...overlayBase,
            top:   logo.y  !== null ? logo.y  : 12,
            right: logo.x  !== null ? undefined : 12,
            left:  logo.x  !== null ? logo.x  : undefined,
            transform: `scale(${logo.scale || 1})`,
            transformOrigin: "top left",
            background: "rgba(255,255,255,0.94)",
            border: "1px solid rgba(0,0,0,0.1)",
            padding: "8px 14px",
            display: "flex", alignItems: "center", gap: 8,
            cursor: "grab", minWidth: 180,
          }} onWheel={makeWheeler(setLogo)}>
            {/* Drag handle */}
            <div onMouseDown={makeDragger(setLogo)} style={{
              position: "absolute", inset: 0, cursor: "grab", borderRadius: 8, zIndex: 0
            }} />
            <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 8, flex: 1, pointerEvents: "none" }}>
              <img src={selectedCompany === "sentinel" ? sentinelLogoImg : logoImg} alt="Logo" style={{
                height: 28, borderRadius: 4, objectFit: "contain"
              }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>
                {selectedCompany === "sentinel" ? "Sentinel Technologies" : "Mirador AI Technologies"}
              </span>
            </div>
            <button onClick={() => setLogo(s => ({ ...s, show: false }))} style={{
              position: "relative", zIndex: 2, background: "none", border: "none",
              color: "#64748b", cursor: "pointer", fontSize: 14, lineHeight: 1,
              padding: "2px 4px", borderRadius: 3,
            }} title="Remove from export">✕</button>
          </div>
        )}

        {/* ── Camera Statistics overlay ── */}
        {stats.show && (
          <div data-zoomable-overlay="true" style={{
            ...overlayBase,
            bottom: stats.y !== null ? undefined : 12,
            right:  stats.x !== null ? undefined : 12,
            top:    stats.y !== null ? stats.y   : undefined,
            left:   stats.x !== null ? stats.x   : undefined,
            transform: `scale(${stats.scale || 1})`,
            transformOrigin: "top left",
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(0,0,0,0.08)",
            padding: "10px 14px", minWidth: 170,
            cursor: "grab",
          }} onWheel={makeWheeler(setStats)}>
            <div onMouseDown={makeDragger(setStats)} style={{
              position: "absolute", inset: 0, cursor: "grab", borderRadius: 8, zIndex: 0
            }} />
            <button onClick={() => setStats(s => ({ ...s, show: false }))} style={{
              position: "absolute", top: 4, right: 6, zIndex: 2,
              background: "none", border: "none", color: "#64748b",
              cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "2px 4px",
            }} title="Remove from export">✕</button>
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
              background: "#1e3a5f", borderRadius: "8px 0 0 8px",
            }} />
            <div style={{ position: "relative", zIndex: 1, paddingLeft: 8, pointerEvents: "none" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>
                Camera Statistics
              </div>
              <div style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 600, marginBottom: 2 }}>
                Total Cameras: —
              </div>
              <div style={{ fontSize: 10, color: "#374151" }}>Per-type breakdown</div>
            </div>
          </div>
        )}

        {/* ── DORI Legend overlay ── */}
        {showDori && dori.show && (
          <div data-zoomable-overlay="true" style={{
            ...overlayBase,
            bottom: dori.y !== null ? undefined : 12,
            left:   dori.x !== null ? dori.x   : 12,
            top:    dori.y !== null ? dori.y   : undefined,
            transform: `scale(${dori.scale || 1})`,
            transformOrigin: "top left",
            background: "rgba(13,20,32,0.92)",
            border: "1px solid rgba(168,85,247,0.5)",
            padding: "10px 14px", minWidth: 200,
            cursor: "grab",
          }} onWheel={makeWheeler(setDori)}>
            <div onMouseDown={makeDragger(setDori)} style={{
              position: "absolute", inset: 0, cursor: "grab", borderRadius: 8, zIndex: 0
            }} />
            <button onClick={() => setDori(s => ({ ...s, show: false }))} style={{
              position: "absolute", top: 4, right: 6, zIndex: 2,
              background: "none", border: "none", color: "#9ca3af",
              cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "2px 4px",
            }} title="Remove from export">✕</button>
            <div style={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
              <div style={{ color: "#c084fc", fontSize: 10, fontWeight: 800, marginBottom: 6 }}>
                DORI ZONES (EN 62676-4)
              </div>
              <div style={{ height: 1, background: "rgba(255,255,255,0.1)", marginBottom: 8 }} />
              {DORI_ITEMS.map(item => (
                <div key={item.color} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", background: item.color,
                    boxShadow: `0 0 5px ${item.color}`, flexShrink: 0,
                  }} />
                  <span style={{ color: "#e2e8f0", fontSize: 10, fontWeight: 600 }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Download buttons */}
      <div style={{
        marginTop: 16, display: "flex", gap: 12, alignItems: "center",
      }}>
        {isDownloading && (
          <span style={{ color: "#3b82f6", fontSize: 13 }}>Generating…</span>
        )}
        <button
          disabled={isDownloading}
          onClick={() => onDownload("jpg", getOverlayState())}
          style={{
            background: "#1D9E75", color: "#fff", border: "none",
            borderRadius: 7, padding: "9px 22px", fontSize: 14, fontWeight: 700,
            cursor: isDownloading ? "not-allowed" : "pointer", opacity: isDownloading ? 0.6 : 1,
          }}>
          ⬇ Download JPG
        </button>
        <button
          disabled={isDownloading}
          onClick={() => onDownload("pdf", getOverlayState())}
          style={{
            background: "transparent", color: "#1D9E75", border: "2px solid #1D9E75",
            borderRadius: 7, padding: "7px 20px", fontSize: 14, fontWeight: 700,
            cursor: isDownloading ? "not-allowed" : "pointer", opacity: isDownloading ? 0.6 : 1,
          }}>
          ⬇ Download PDF
        </button>
      </div>
    </div>
  );
}

// ── Automation Modal Component ──────────────────────────────────────────
// ── Automation Modal Component ──────────────────────────────────────────
function AutomationModal({ zone, ppm, cameraDB, getCameraForType, onConfirm, onCancel }) {
  const [selectedTypes, setSelectedTypes] = useState(["dome"]);
 
  // Dynamic parsing of number from zone name, or fallback to Shoelace
  const [areaSqFtVal, setAreaSqFtVal] = useState(() => {
    const match = zone.name.match(/\d+[,.\d]*/);
    if (match) {
      return match[0];
    }
    const areaSqm = getPolygonArea(zone.polygon, ppm);
    return Math.round(areaSqm * 10.7639).toString();
  });

  const parsedAreaSqm = (parseFloat(areaSqFtVal.replace(/,/g, '')) / 10.7639) || 0;

  // Extract actual unique types present in cameraDB
  const uniqueTypesInDB = [...new Set(cameraDB.map(c => c.type))].filter(Boolean);
 
  const typeLabels = {
    dome: "Dome Camera",
    bullet: "Bullet Camera",
    ptz: "PTZ (Pan-Tilt-Zoom)",
    fisheye: "Fisheye (360°)",
    box: "Box Camera",
    thermal: "Thermal Camera"
  };

  const cameraTypes = uniqueTypesInDB.map(type => ({
    type,
    label: typeLabels[type] || (type.charAt(0).toUpperCase() + type.slice(1) + " Camera")
  }));

  // State to hold the specific user-selected model for each camera type
  const [selectedModels, setSelectedModels] = useState(() => {
    const initial = {};
    uniqueTypesInDB.forEach(t => {
      initial[t] = getCameraForType(t);
    });
    return initial;
  });

  const handleToggleType = (type) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const handleSubmit = () => {
    if (selectedTypes.length === 0) {
      alert("Please select at least one camera type.");
      return;
    }
    const chosenModels = selectedTypes.map(type => selectedModels[type]).filter(Boolean);
    onConfirm(chosenModels);
  };

  return (
    <div className="mv-stream-overlay" onClick={onCancel}>
      <div className="mv-zone-name-modal mv-modal--config" onClick={e => e.stopPropagation()}>
        <div className="mv-zone-name-modal__header">
          <svg viewBox="0 0 24 24" fill="none" stroke="#1D9E75" strokeWidth="2" width="20" height="20">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          <span>Automated Camera Coverage</span>
        </div>
        <p className="mv-zone-name-modal__sub" style={{ marginBottom: 12 }}>
          Automatically place and align cameras to ensure **no blind spots** in **{zone.name}**.
        </p>

        <div style={{
          background: "var(--bg-base)",
          border: "0.5px solid var(--border)",
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: 16,
          fontSize: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>Zone Area (sq. ft.):</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="text"
                value={areaSqFtVal}
                onChange={e => setAreaSqFtVal(e.target.value)}
                style={{
                  background: "var(--bg-input)",
                  border: "0.5px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text-primary)",
                  fontSize: 16,
                  fontWeight: 700,
                  textAlign: "right",
                  padding: "2px 6px",
                  width: 90,
                  outline: "none",
                }}
              />
              <span style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 14 }}>sq ft</span>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>Metric Area:</span>
            <span style={{ color: "#e8edf5", fontWeight: 600 }}>
              {parsedAreaSqm.toLocaleString(undefined, { maximumFractionDigits: 1 })} m²
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>Boundary Vertices:</span>
            <span style={{ color: "#e8edf5", fontWeight: 700 }}>{zone.polygon.length} corners</span>
          </div>
        </div>

        <div className="mv-modal__field">
          <label className="mv-modal__label">Select Camera Types & Models ({cameraTypes.length} Available)</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto", paddingRight: 4 }}>
            {cameraTypes.map(({ type, label }) => {
              const modelsOfType = cameraDB.filter(c => c.type === type);
              const selectedModel = selectedModels[type] || modelsOfType[0];
              const isChecked = selectedTypes.includes(type);
              return (
                <div
                  key={type}
                  onClick={() => handleToggleType(type)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    background: isChecked ? "rgba(29, 158, 117, 0.08)" : "var(--bg-base)",
                    border: isChecked ? "1px solid var(--green)" : "1px solid var(--border)",
                    borderRadius: 6,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}} // Handled by div click
                    style={{
                      cursor: "pointer",
                      accentColor: "#1D9E75",
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{label}</div>
                    {modelsOfType.length > 0 ? (
                      <select
                        value={selectedModel?.id || ""}
                        onClick={e => e.stopPropagation()} // Prevent toggling checkbox
                        onChange={(e) => {
                          const found = modelsOfType.find(m => m.id === e.target.value);
                          if (found) {
                            setSelectedModels(prev => ({ ...prev, [type]: found }));
                          }
                        }}
                        style={{
                          background: "#0b0f1a",
                          border: "0.5px solid #2e3d55",
                          borderRadius: 4,
                          color: "#e8edf5",
                          fontSize: 14,
                          padding: "3px 6px",
                          marginTop: 4,
                          width: "100%",
                          outline: "none",
                          cursor: "pointer",
                          fontFamily: "inherit"
                        }}
                      >
                        {modelsOfType.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.brand} {m.model} ({m.megapixels}MP · HFOV {m.hfov}° · {m.rangeDay}m)
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ fontSize: 14, color: "#8b2222", marginTop: 4 }}>Not available in DB</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mv-zone-name-modal__row" style={{ marginTop: 20 }}>
          <button className="mv-modal__btn mv-modal__btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="mv-modal__btn mv-modal__btn--confirm" onClick={handleSubmit}>Automate</button>
        </div>
      </div>
    </div>
  );
}


// ── CameraIcon SVG ────────────────────────────────────────────────────────────
function CameraIcon({ type, size = 22, color }) {
  const c = color || TYPE_COLORS[type] || "#3b82f6";
  if (type === "ptz") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      <path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M19.07 4.93l-2.83 2.83M7.76 16.24l-2.83 2.83" />
    </svg>
  );
  if (type === "fisheye") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill={c} />
    </svg>
  );
  if (type === "bullet") return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <rect x="3" y="9" width="14" height="6" rx="2" /><path d="M17 12h4" />
      <circle cx="8" cy="12" r="1.5" fill={c} />
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.6">
      <rect x="2" y="7" width="15" height="10" rx="2" /><path d="M17 9l5-2v10l-5-2V9z" />
      <circle cx="9" cy="12" r="2" fill={c + "44"} stroke={c} />
    </svg>
  );
}

// ── Model card (draggable) ────────────────────────────────────────────────────
function ModelCard({ camera, onDragStart, onSelect, isSelected }) {
  const col = TYPE_COLORS[camera.type] || "#3b82f6";
  return (
    <div
      className={`dv-model-card ${isSelected ? "dv-model-card--selected" : ""}`}
      draggable
      onDragStart={e => { e.dataTransfer.setData("cameraId", camera.id); onDragStart(camera); }}
      onClick={() => onSelect(camera)}
      style={{ "--brand-color": col }}
      title={`${camera.brand} ${camera.model}\nHFOV: ${camera.hfov}°\nRange: ${camera.rangeDay} m`}
    >
      <div className="dv-model-card__type-bar" style={{ background: col }} />
      <div className="dv-model-card__icon"><CameraIcon type={camera.type} size={18} color={col} /></div>
      <div className="dv-model-card__info">
        <div className="dv-model-card__model">{camera.model}</div>
        <div className="dv-model-card__brand">{camera.brand} · {camera.series}</div>
        <div className="dv-model-card__specs">
          <span className="dv-spec-pill" style={{ borderColor: col + "55", color: col }}>{camera.megapixels}MP</span>
          <span className="dv-spec-pill">HFOV {camera.hfov}°</span>
          <span className="dv-spec-pill">{camera.rangeDay}m</span>
          {camera.ir > 0 && <span className="dv-spec-pill dv-spec-pill--ir">IR {camera.ir}m</span>}
          {camera.isVarifocal && <span className="dv-spec-pill dv-spec-pill--vari">VF</span>}
          {camera.onboardStorage && <span className="dv-spec-pill" style={{ color: "#10b981", borderColor: "#10b98144" }}>💾 SD</span>}
        </div>
      </div>
    </div>
  );
}

// ── Spec detail panel ─────────────────────────────────────────────────────────
function SpecPanel({ camera, onClose }) {
  if (!camera) return null;
  const col = TYPE_COLORS[camera.type] || "#3b82f6";

  const codecs = camera.codecSupport?.join(", ") ?? "—";
  const bitrateH265 = camera.bitrateTypical ?? null;
  const bitrateH264 = camera.bitrateH264 ?? null;
  const rows = [
    ["Type", camera.type.charAt(0).toUpperCase() + camera.type.slice(1)],
    ["Sensor", camera.sensor],
    ["Resolution", `${camera.megapixels} MP`],
    ["Focal Length", camera.isVarifocal ? `${camera.focalLength}–${camera.focalLengthMax} mm` : `${camera.focalLength} mm`],
    ["H-FOV", camera.isVarifocal ? `${camera.hfovMin}°–${camera.hfov}°` : `${camera.hfov}°`],
    ["V-FOV", `${camera.vfov}°`],
    ["Diagonal FOV", `${camera.dfov}°`],
    ["Day Range", `${camera.rangeDay} m`],
    ["IR Range", camera.ir > 0 ? `${camera.ir} m` : "None"],
    ["Frame Rate", camera.fps ? `${camera.fps} fps` : "—"],
    ["Codecs", codecs],
    ["Bitrate H.265", bitrateH265 ? `${bitrateH265} Mbps` : "—"],
    ["Bitrate H.264", bitrateH264 ? `${bitrateH264} Mbps` : "—"],
    ["Onboard SD", camera.onboardStorage ? `Yes — up to ${camera.onboardStorageMaxGB} GB` : "No"],
    ["PoE", camera.poe ? "Yes" : "No"],
    ["IP Rating", camera.ip],
    // ["Coverage", `≈ ${camera.coverageArea.toLocaleString()} m²`],
    ["Coverage", camera.coverageArea != null ? `≈ ${camera.coverageArea.toLocaleString()} m²` : "—"],

  ];
  return (
    <div className="dv-spec-panel">
      <div className="dv-spec-panel__header" style={{ borderBottom: `1px solid ${col}33` }}>
        <div className="dv-spec-panel__icon-badge" style={{ background: col + "22", border: `1px solid ${col}55` }}>
          <CameraIcon type={camera.type} size={20} color={col} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="dv-spec-panel__model">{camera.model}</div>
          <div className="dv-spec-panel__brand">
            <span style={{ color: col, fontWeight: 600 }}>{camera.brand}</span>
            <span style={{ color: "var(--text-secondary)", margin: "0 4px" }}>·</span>
            <span style={{ color: "var(--text-secondary)" }}>{camera.series}</span>
          </div>
        </div>
        <button className="dv-spec-panel__close" onClick={onClose}>✕</button>
      </div>
      <div style={{ padding: "10px 14px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 4, background: col + "22", color: col, border: `0.5px solid ${col}55` }}>
          {TYPE_ICONS[camera.type]} {camera.type}
        </span>
        {camera.megapixels && (
          <span style={{ fontSize: 15, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "0.5px solid var(--border-light)" }}>
            {camera.megapixels} MP
          </span>
        )}
        {camera.ir > 0 && (
          <span style={{ fontSize: 15, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "#f59e0b18", color: "#f59e0b", border: "0.5px solid #f59e0b44" }}>
            IR {camera.ir}m
          </span>
        )}
      </div>
      {camera.notes && (
        <div style={{ margin: "10px 14px 0", padding: "8px 10px", background: "var(--bg-elevated)", border: "0.5px solid var(--border-light)", borderRadius: 6, fontSize: 16, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          {camera.notes}
        </div>
      )}

      {camera.securityBadges?.length > 0 && (
        <div style={{ padding: "8px 14px 0", display: "flex", flexWrap: "wrap", gap: 5 }}>
          {camera.securityBadges.map(badge => (
            <span key={badge} style={{
              fontSize: 14, fontWeight: 600,
              padding: "2px 7px", borderRadius: 4,
              background: badge === "Thermal" ? "#8b5cf622" : badge.startsWith("IK") ? "#f59e0b22" : badge === "PoE" ? "#3b82f622" : "#10b98122",
              color: badge === "Thermal" ? "#8b5cf6" : badge.startsWith("IK") ? "#f59e0b" : badge === "PoE" ? "#3b82f6" : "#10b981",
              border: `0.5px solid currentColor`,
            }}>
              {badge}
            </span>
          ))}
        </div>
      )}
      <div style={{ padding: "12px 14px 6px" }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "0.5px solid var(--border-light)" }}>
            <span style={{ fontSize: 16, color: "var(--text-secondary)" }}>{k}</span>
            <span style={{ fontSize: 16, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", fontFamily: "monospace" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FOV arc visualizer ────────────────────────────────────────────────────────
function FovVisualizer({ camera }) {
  const ref = useRef(null);
  useEffect(() => {
    const cvs = ref.current; if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const W = cvs.width, H = cvs.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H - 16;
    const col = TYPE_COLORS[camera.type] || "#3b82f6";
    ctx.strokeStyle = "#2e3d55"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    if (camera.type === "fisheye") {
      const r = Math.min(W, H) / 2 - 12;
      ctx.beginPath(); ctx.arc(cx, H / 2, r, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(cx, H / 2, 0, cx, H / 2, r);
      g.addColorStop(0, col + "66"); g.addColorStop(1, col + "11");
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = col + "aa"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = col; ctx.font = "bold 11px monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("360°", cx, H / 2);
      return;
    }
    const hfov = camera.hfov;
    const radius = cy - 16;
    const half = (hfov / 2) * (Math.PI / 180);
    const upAngle = -Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, upAngle - half, upAngle + half);
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, col + "88"); g.addColorStop(1, col + "11");
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = col + "cc"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = col; ctx.font = "bold 11px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(`HFOV ${hfov}°`, cx, 4);
    if (camera.rangeDay > 0) {
      const labelR = radius * 0.72;
      const lx = cx + Math.cos(upAngle + half * 0.6) * labelR;
      const ly = cy + Math.sin(upAngle + half * 0.6) * labelR;
      ctx.fillStyle = "#7a8499"; ctx.font = "9px monospace";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`${camera.rangeDay}m`, lx, ly);
    }
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
  }, [camera]);
  return <canvas ref={ref} width={220} height={130} style={{ display: "block", margin: "0 auto" }} />;
}

// ── Camera drawing ────────────────────────────────────────────────────────────
// FIX 1: clipZone now auto-detects the camera's own zone when no active zone is set.
// This ensures FOV is always clipped to its zone even after refresh.
function drawPlacedCamera(ctx, p, ppm, hovering, selected, zonesRef, activeZoneIdRef, highlightedId, showLabel = true, showPpm = false, hideBeam = false, iconScale = 1.20, renderLayer = "all", canvasScale = 1, showMetricsVisibility = false, showHeatmap = false) {
  const { x, y, direction, camera } = p;
  const col = TYPE_COLORS[camera.type] || "#3b82f6";
  const isHighlit = p.id === highlightedId;
  const origAngle = fovDrawParams(camera, direction).angle;
  const halfRad = fovDrawParams(camera, direction).halfRad;
  const angle = origAngle;
  const radius = camera.rangeDay * ppm;

  const S = iconScale;

  // ★ FIX: origin matches MapCanvas (x + cos*1.5*S, forward) instead of old backward formula
  const originX = x + Math.cos(angle) * (1.5 * S);
  const originY = y + Math.sin(angle) * (1.5 * S);

  if (renderLayer === "all" || renderLayer === "beam") {
    // ── Zone clip — always clip to the camera's own zone ─────────────
    let clipping = false;
    let clipZone = null;
    const boomBarriers = (zonesRef?.current || []).filter(z => z.isBoomBarrier);

    if (zonesRef?.current) {
      if (activeZoneIdRef?.current) {
        const activeZone = zonesRef.current.find(z => z.id === activeZoneIdRef.current);
        if (activeZone && activeZone.polygon?.length >= 3 && pointInPolygon(x, y, activeZone.polygon)) {
          clipZone = activeZone;
        } else {
          hideBeam = true;
        }
      } else {
        const containedZones = zonesRef.current.filter(
          z => z.polygon?.length >= 3 && pointInPolygon(x, y, z.polygon) && !z.isBoomBarrier
        );
        if (containedZones.length > 0) {
          containedZones.sort((a, b) => getPolygonArea(a.polygon, ppm) - getPolygonArea(b.polygon, ppm));
          clipZone = containedZones[0];
        }
      }
    }

    const startClip = () => {
      if ((clipZone && clipZone.polygon.length >= 3) || boomBarriers.length > 0) {
        ctx.save();
        ctx.beginPath();
        let basePoly = clipZone?.polygon;
        
        if (!basePoly) {
           basePoly = [];
           const R = radius + 10;
           for(let i=0; i<=16; i++){
               const a = angle - halfRad + (2*halfRad * (i/16));
               basePoly.push({ x: originX + Math.cos(a)*R, y: originY + Math.sin(a)*R });
           }
           basePoly.push({x: originX, y: originY});
        }

        let polyToClip = basePoly;
        try {
          const obstaclesPolys = boomBarriers.map(z => z.polygon);
          const visPoly = CctvCalc.computeVisibilityPolygon({ x: originX, y: originY }, basePoly, obstaclesPolys);
          if (visPoly && visPoly.length >= 3) {
            polyToClip = visPoly;
          }
        } catch (e) {
          console.error("Visibility clip error:", e);
        }

        polyToClip.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.clip();
        clipping = true;
      }
    };
    const endClip = () => { if (clipping) { ctx.restore(); clipping = false; } };

    // ── Clip everything (DORI zones + FOV cone) inside the drawn zone polygon ──
    startClip();

    // ── DORI Clarity Zones (clipped inside zone boundary) ──
    if (showPpm) {
      const resX = camera.megapixels === 12 ? 4000 :
                   camera.megapixels === 8 ? 3840 :
                   camera.megapixels === 5 ? 2592 :
                   camera.megapixels === 4 ? 2688 :
                   camera.megapixels === 2 ? 1920 :
                   Math.round(Math.sqrt((16 / 9) * (camera.megapixels || 2)) * 1000) || 1920;

      const hfovRad = (camera.hfov * Math.PI) / 180;
      const tanHalf = Math.tan(hfovRad / 2);

      // Returns distance in METRES where the camera achieves a given pixel density
      const getDistMetres = (tPpm) => {
        if (camera.type === "fisheye" || camera.hfov >= 180) {
          return (resX / (Math.PI * tPpm)) * 0.35;
        }
        return resX / (2 * tPpm * tanHalf);
      };

      // Minimum screen-pixel radius per DORI ring (so they're always visible)
      // We compensate for low ppm by enforcing a floor in screen pixels
      const MIN_SCREEN_PX = [60, 40, 25, 14]; // Detection, Observation, Recognition, Identification
      const thresholds = [25, 62, 125, 250];
      const colors     = ["#3b82f6", "#eab308", "#ef4444", "#a855f7"];

      const zonesPpm = thresholds.map((tPpm, i) => {
        const distMetres  = getDistMetres(tPpm);           // metres
        const distCanvas  = distMetres * ppm;              // canvas pixels (world space)
        // Ensure minimum visibility in screen pixels: at least MIN_SCREEN_PX[i] screen px
        const minCanvas   = MIN_SCREEN_PX[i] / Math.max(canvasScale, 0.05);
        return { d: Math.max(distCanvas, minCanvas), c: colors[i], m: distMetres };
      });

      zonesPpm.forEach(z => {
        const dVal = Math.min(z.d, radius);
        if (dVal <= 0) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.arc(originX, originY, dVal, angle - halfRad, angle + halfRad);
        ctx.closePath();
        ctx.fillStyle = z.c + "30";
        ctx.fill();
        ctx.restore();
      });

      zonesPpm.forEach(z => {
        const dVal = Math.min(z.d, radius);
        if (z.d > radius || dVal <= 0) return;

        ctx.beginPath();
        ctx.arc(originX, originY, dVal, angle - halfRad, angle + halfRad);
        ctx.strokeStyle = z.c + "77";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Render DORI meter label badge along beam centerline
        if (dVal > 15) {
          const labelX = originX + Math.cos(angle) * (dVal * 0.88);
          const labelY = originY + Math.sin(angle) * (dVal * 0.88);
          ctx.save();
          ctx.font = "bold 10px Inter, Arial, sans-serif";
          const txt = `${z.m.toFixed(1)} m`;
          const tw = ctx.measureText(txt).width + 8;
          const th = 14;

          ctx.fillStyle = z.c;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(labelX - tw / 2, labelY - th / 2, tw, th, 4);
          else ctx.rect(labelX - tw / 2, labelY - th / 2, tw, th);
          ctx.fill();

          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(txt, labelX, labelY + 0.5);
          ctx.restore();
        }
      });
    }

    // ── FOV cone: Professional realistic blueprint blue / heatmap green (Seamless 2D Beam) ──
    if (!hideBeam) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(originX, originY);
      ctx.arc(originX, originY, radius, angle - halfRad, angle + halfRad);
      ctx.closePath();
      if (!showPpm) {
        const g = ctx.createRadialGradient(originX, originY, 0, originX, originY, radius);
        if (showHeatmap) {
          g.addColorStop(0, "rgba(16, 185, 129, 0.70)");
          g.addColorStop(0.45, "rgba(16, 185, 129, 0.48)");
          g.addColorStop(0.8, "rgba(16, 185, 129, 0.25)");
          g.addColorStop(1, "rgba(16, 185, 129, 0.08)");
        } else {
          g.addColorStop(0, selected ? "rgba(14, 165, 233, 0.75)" : "rgba(14, 165, 233, 0.60)");
          g.addColorStop(0.45, selected ? "rgba(14, 165, 233, 0.52)" : "rgba(14, 165, 233, 0.38)");
          g.addColorStop(0.8, selected ? "rgba(14, 165, 233, 0.30)" : "rgba(14, 165, 233, 0.18)");
          g.addColorStop(1, selected ? "rgba(14, 165, 233, 0.10)" : "rgba(14, 165, 233, 0.04)");
        }
        ctx.fillStyle = g;
        ctx.fill();
      }
      // Boundary stroke lines removed for clean seamless 2D FOV beam presentation
      ctx.restore();
    }
    
    if (showMetricsVisibility && !hideBeam) {
      ctx.save();
      // Center direction dashed line
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.moveTo(originX, originY);
      const dirX = originX + Math.cos(angle) * radius * 1.1;
      const dirY = originY + Math.sin(angle) * radius * 1.1;
      ctx.lineTo(dirX, dirY);
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Arrowhead for center line
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.moveTo(dirX, dirY);
      ctx.lineTo(dirX - Math.cos(angle - 0.3) * 10, dirY - Math.sin(angle - 0.3) * 10);
      ctx.lineTo(dirX - Math.cos(angle + 0.3) * 10, dirY - Math.sin(angle + 0.3) * 10);
      ctx.closePath();
      ctx.fillStyle = "#3b82f6";
      ctx.fill();

      // Helper to draw arc and label
      const drawMetricArc = (r, color, isDashed, text) => {
        ctx.beginPath();
        if (isDashed) ctx.setLineDash([5, 5]);
        ctx.arc(originX, originY, r, angle - halfRad, angle + halfRad);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw label rectangle in the center of the arc
        const lx = originX + Math.cos(angle) * r;
        const ly = originY + Math.sin(angle) * r;
        ctx.font = "bold 10px sans-serif";
        const tw = ctx.measureText(text).width + 10;
        ctx.fillStyle = "white";
        ctx.fillRect(lx - tw/2, ly - 8, tw, 16);
        ctx.strokeStyle = color;
        ctx.strokeRect(lx - tw/2, ly - 8, tw, 16);
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, lx, ly);
      };

      // Draw HFOV arc
      const hfovR = radius * 0.3;
      drawMetricArc(hfovR, "#3b82f6", false, `HFOV ${camera.hfov}°`);

      // Draw IR Range arc
      const irDist = camera.ir || camera.rangeNight || 0;
      if (irDist > 0) {
        const irR = Math.min(radius, irDist * ppm);
        drawMetricArc(irR, "#10b981", true, `${irDist} m IR RANGE`);
      }

      // Draw DORI Detect arc
      const doriDetectMeters = camera.rangeDay || 0;
      if (doriDetectMeters > 0) {
        const doriR = Math.min(radius, doriDetectMeters * ppm);
        drawMetricArc(doriR, "#3b82f6", true, `${doriDetectMeters.toFixed(1)} m DORI DETECT`);
      }

      ctx.restore();
    }

    endClip();

    // ── Range circle (dashed, PTZ only) ───────────────────────────────
    if (camera.type === "ptz") {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = col + "AA"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
  }

  if (renderLayer === "all" || renderLayer === "body") {

  // ── Camera body (Type-specific shapes, S=0.62) ──────────────────
  ctx.save();
  ctx.translate(x, y);
  const type = camera.type || "dome";

  if (type === "bullet") {
    const bS = S * 0.9;
   
    // --- FIXED MOUNT & ARM (Does not rotate with camera) ---
    ctx.save();
    if (p.flip) ctx.scale(-1, 1);
   
    // Wall Plate
    ctx.beginPath();
    ctx.moveTo(5*bS, 10*bS);
    ctx.lineTo(10*bS, 8*bS);
    ctx.lineTo(10*bS, 18*bS);
    ctx.lineTo(5*bS, 20*bS);
    ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
   
    // Wall plate side
    ctx.beginPath();
    ctx.moveTo(5*bS, 10*bS);
    ctx.lineTo(2*bS, 11*bS);
    ctx.lineTo(2*bS, 21*bS);
    ctx.lineTo(5*bS, 20*bS);
    ctx.closePath();
    ctx.fillStyle = "#f5f5f5"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.stroke();

    // Horizontal Arm
    ctx.beginPath();
    ctx.moveTo(-2*bS, 14*bS);
    ctx.lineTo(5*bS, 12*bS);
    ctx.lineTo(5*bS, 15*bS);
    ctx.lineTo(-2*bS, 17*bS);
    ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.stroke();
   
    // Vertical Arm
    ctx.beginPath();
    ctx.moveTo(-4*bS, 0);
    ctx.lineTo(0*bS, -1*bS);
    ctx.lineTo(0*bS, 14*bS);
    ctx.lineTo(-4*bS, 15*bS);
    ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.stroke();

    ctx.restore();

    // --- ROTATING CAMERA BODY ---
    ctx.rotate(angle);
    if (Math.cos(angle) < 0) ctx.scale(1, -1);
   
    // Body Cylinder
    ctx.beginPath();
    ctx.moveTo(-12*bS, -7*bS);
    ctx.lineTo(8*bS, -7*bS);
    ctx.bezierCurveTo(12*bS, -7*bS, 12*bS, 7*bS, 8*bS, 7*bS);
    ctx.lineTo(-12*bS, 7*bS);
    ctx.bezierCurveTo(-8*bS, 7*bS, -8*bS, -7*bS, -12*bS, -7*bS);
    ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

    // Sunshield
    ctx.beginPath();
    ctx.moveTo(-14*bS, -8*bS);
    ctx.lineTo(10*bS, -8*bS);
    ctx.bezierCurveTo(16*bS, -8*bS, 16*bS, -1*bS, 10*bS, -1*bS);
    ctx.lineTo(-14*bS, -1*bS);
    ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.stroke();

    // Front Face (Dark oval)
    ctx.beginPath();
    ctx.ellipse(8*bS, 0, 2.5*bS, 6.5*bS, 0, 0, Math.PI*2);
    ctx.fillStyle = "#1b3039"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.stroke();

    // Lens Outer White Ring
    ctx.beginPath();
    ctx.ellipse(8*bS, 0, 1.2*bS, 3.5*bS, 0, 0, Math.PI*2);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.stroke();
   
    // Lens Inner Dark Center
    ctx.beginPath();
    ctx.ellipse(8*bS, 0, 0.5*bS, 1.5*bS, 0, 0, Math.PI*2);
    ctx.fillStyle = "#000000"; ctx.fill();

  } else if (type === "ptz") {
    const pS = S * 0.9;
   
    // --- FIXED MOUNT & ARM (Does not rotate with camera) ---
    ctx.save();
    if (p.flip) ctx.scale(-1, 1);
   
    // Wall Plate (Left side)
    ctx.beginPath();
    ctx.moveTo(-10*pS, -6*pS);
    ctx.lineTo(-10*pS, 10*pS);
    ctx.lineTo(-14*pS, 12*pS);
    ctx.lineTo(-14*pS, -8*pS);
    ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

    // Arm
    ctx.beginPath();
    ctx.moveTo(-10*pS, 0);
    ctx.lineTo(-4*pS, -2*pS);
    ctx.lineTo(-4*pS, 2*pS);
    ctx.lineTo(-10*pS, 4*pS);
    ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.stroke();
   
    ctx.restore();

    // --- ROTATING CAMERA BODY ---
    ctx.rotate(angle);
   
    // Top cap (small rectangle connecting to arm)
    ctx.beginPath();
    ctx.moveTo(-4*pS, -3*pS);
    ctx.lineTo(-4*pS, 3*pS);
    ctx.lineTo(-2*pS, 3*pS);
    ctx.lineTo(-2*pS, -3*pS);
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

    // Main Bell Housing
    ctx.beginPath();
    ctx.moveTo(-2*pS, -3*pS);
    ctx.lineTo(-2*pS, 3*pS);  
    ctx.bezierCurveTo(4*pS, 8*pS, 6*pS, 9*pS, 8*pS, 9*pS);
    ctx.lineTo(8*pS, -9*pS);
    ctx.bezierCurveTo(6*pS, -9*pS, 4*pS, -8*pS, -2*pS, -3*pS);
    ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.stroke();

    // Lower Dome (Dark glass)
    ctx.beginPath();
    ctx.moveTo(8*pS, -8*pS);
    ctx.lineTo(8*pS, 8*pS);
    ctx.bezierCurveTo(14*pS, 8*pS, 16*pS, 4*pS, 16*pS, 0);
    ctx.bezierCurveTo(16*pS, -4*pS, 14*pS, -8*pS, 8*pS, -8*pS);
    ctx.closePath();
    ctx.fillStyle = "#1a1a1a"; ctx.fill();
    ctx.strokeStyle = "#000000"; ctx.stroke();

    // Lens housing
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(8*pS, -3*pS, 4*pS, 6*pS, 1);
    else ctx.rect(8*pS, -3*pS, 4*pS, 6*pS);
    ctx.fillStyle = "#262626"; ctx.fill();
   
    // Lens
    ctx.beginPath();
    ctx.arc(10*pS, 0, 1.8*pS, 0, Math.PI*2);
    ctx.fillStyle = "#000000"; ctx.fill();

  } else {
    // For all other types, we rotate first
    ctx.rotate(angle);

    if (type === "dome" || type === "turret") {
      // ── NEW DOME (Reference: Image provided by user) ──
      // Top white cover (hemisphere)
      ctx.beginPath();
      ctx.arc(0, 0, 11 * S, Math.PI/2 + 0.3, Math.PI/2 - 0.3 + Math.PI*2);
      // the above makes a pacman shape or we can just draw a circle and then a black circle offset
      ctx.closePath();
     
      // Let's do it simpler: A large white circle for the main body
      ctx.beginPath();
      ctx.arc(0, 0, 11 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
     
      // Cutout for the black dome (shifted forward)
      ctx.beginPath();
      ctx.arc(3 * S, 0, 8.5 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#222222"; ctx.fill();
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
     
      // White rim around the black dome
      ctx.beginPath();
      ctx.arc(3 * S, 0, 8.5 * S, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
     
      // Inner lens housing (darker)
      ctx.beginPath();
      ctx.arc(4 * S, 0, 5 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#111111"; ctx.fill();
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

      // IR LED ring
      for (let i=0; i<12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const lx = 4 * S + Math.cos(a) * 3.8 * S;
        const ly = Math.sin(a) * 3.8 * S;
        ctx.beginPath();
        ctx.arc(lx, ly, 0.6 * S, 0, Math.PI * 2);
        ctx.fillStyle = "#dddddd"; ctx.fill();
      }

      // Center Lens
      ctx.beginPath();
      ctx.arc(4 * S, 0, 2 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#000000"; ctx.fill();
     
      // Lens glint
      ctx.beginPath();
      ctx.arc(4.5 * S, -0.5 * S, 0.5 * S, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fill();
    }
    else if (type === "fisheye") {
      // ── FISHEYE (Reference: Flat UFO-style ceiling mount) ──
      // Outer base
      ctx.beginPath(); ctx.arc(0, 0, 12 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
 
      // Concentric detail ring
      ctx.beginPath(); ctx.arc(0, 0, 8 * S, 0, Math.PI * 2);
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
 
      // Center lens
      ctx.beginPath(); ctx.arc(0, 0, 3.5 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#0e0e0e"; ctx.fill();
      ctx.strokeStyle = "#000000"; ctx.stroke();
 
      // Lens detail (inner ring)
      ctx.beginPath(); ctx.arc(0, 0, 1.5 * S, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.stroke();
    }
    else {
      // ── BOX / THERMAL / OTHER (Rectangular) ──
      const shift = 14 * S;
      ctx.translate(-shift, 0); // Offset
 
      // Mount
      ctx.beginPath(); ctx.arc(-14 * S, 0, 5 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
 
      // Neck
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-14 * S, -2.5 * S, 7 * S, 5 * S, 1.5);
      else ctx.rect(-14 * S, -2.5 * S, 7 * S, 5 * S);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
 
      // Main barrel body
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-7 * S, -5.5 * S, 17 * S, 11 * S, 5 * S);
      else ctx.rect(-7 * S, -5.5 * S, 17 * S, 11 * S);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
 
      // Front bezel ring
      ctx.beginPath(); ctx.arc(10 * S, 0, 5.5 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
 
      // Lens
      ctx.beginPath(); ctx.arc(10 * S, 0, 3.2 * S, 0, Math.PI * 2);
      ctx.fillStyle = "#0e0e0e"; ctx.fill();
 
      // Lens reflection
      ctx.beginPath(); ctx.arc(10.8 * S, -1.1 * S, 1.1 * S, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.60)"; ctx.fill();
    }
  }

  ctx.shadowBlur = 0; ctx.restore();

  // ── Permanent Label with optional dotted leader line ────────────────────
  const displayLabel = p.customName || p.camName || camera.name || camera.model || "Camera";
  const lbl = displayLabel;
  ctx.font = "600 10.5px Inter, sans-serif";
  const tw = ctx.measureText(lbl).width;

  // Apply label offset if present
  const lo = p.labelOffset || { dx: 0, dy: 0 };
  const labelCenterX = x + lo.dx;
  const labelTopY = y - 24 + lo.dy;
  const bx = labelCenterX - tw / 2 - 7;
  const by = labelTopY;
  const labelW = tw + 14;
  const labelH = 18;

  // Draw dotted leader line if label has been moved
  if (lo.dx !== 0 || lo.dy !== 0) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = col + "88";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(labelCenterX, by + labelH / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  ctx.save();
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "#0d1117f2";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, labelW, labelH, 4);
  else ctx.rect(bx, by, labelW, labelH);
  ctx.fill();

  // Highlight border if selected or highlighted
  if (selected || isHighlit) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (lo.dx !== 0 || lo.dy !== 0) {
    // Subtle dashed border when label is offset (visual cue it's draggable)
    ctx.strokeStyle = col + "66";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.15)" : "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Draw camera label text
  ctx.fillStyle = isLight ? "#0f172a" : "#f1f5f9";
  ctx.font = "600 10.5px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(displayLabel, labelCenterX, by + 9);
  ctx.restore();

  // ── Minimalist Accent Grip Dot Rotation Handle ──
  const ang2 = (p.direction || 0) * (Math.PI / 180);
  const R = 8;
  const eyeR = R + 18;
  const hx = x + Math.cos(ang2) * eyeR;
  const hy = y + Math.sin(ang2) * eyeR;

  ctx.save();
  ctx.translate(hx, hy);
  
  // Outer circular badge background
  ctx.beginPath();
  ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
  ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "#0d1117ee";
  ctx.fill();

  // Outer accent ring
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.strokeStyle = col + "66";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Primary accent ring
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Inner solid grip core dot
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();

  ctx.restore();
  }
}


// ── Zone Sidebar Item ─────────────────────────────────────────────────────────
function DvZoneSidebarItem({
  zone, placed, isActive, highlightedId,
  onSelect, onDelete, onRename, onHighlightCam, onRemoveCam, sidebarExpanded,
  onContextMenu,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(zone.name);

  useEffect(() => {
    setEditName(zone.name);
  }, [zone.name]);

  const handleSave = () => {
    const trimmed = editName.trim();
    if (!trimmed) {
      alert("Zone name cannot be empty.");
      setEditName(zone.name);
      setIsEditing(false);
      return;
    }
    if (trimmed !== zone.name) {
      onRename(zone.id, trimmed);
    }
    setIsEditing(false);
  };

  const camsInZone = placed.filter(
    p => zone.polygon.length >= 3 && pointInOrOnPolygon(p.x, p.y, zone.polygon)
  );

  return (
    <div style={{
      borderLeft: isActive ? `2.5px solid ${zone.color}` : "2.5px solid transparent",
      background: isActive ? zone.color + "12" : "transparent",
      borderRadius: 5,
      marginBottom: 2,
      transition: "all 0.15s",
    }}>
      <button
        onClick={() => !isEditing && onSelect(zone)}
        onContextMenu={onContextMenu}
        title={zone.name}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", background: "none", border: "none",
          padding: "5px 6px", cursor: "pointer", color: "var(--text-primary)",
          fontSize: 15, textAlign: "left",
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: 2,
          background: zone.color, flexShrink: 0,
          border: `1px solid ${zone.color}88`,
        }} />

        {sidebarExpanded && (
          isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  handleSave();
                } else if (e.key === "Escape") {
                  setIsEditing(false);
                  setEditName(zone.name);
                }
              }}
              onBlur={handleSave}
              onClick={e => e.stopPropagation()}
              autoFocus
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--teal)",
                borderRadius: "4px",
                color: "var(--text-primary)",
                fontSize: "15px",
                padding: "2px 4px",
                width: "100%",
                outline: "none",
                fontFamily: "inherit"
              }}
            />
          ) : (
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>
              {zone.name}
            </span>
          )
        )}

        {sidebarExpanded && camsInZone.length > 0 && (
          <span style={{
            fontSize: 14, fontWeight: 800, borderRadius: 10,
            padding: "2px 6px", background: zone.color + "28", color: zone.color,
          }}>
            {camsInZone.length}
          </span>
        )}

        {sidebarExpanded && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", zIndex: 5 }} onClick={e => e.stopPropagation()}>
            <span
              className="dv-zone-btn__edit"
              onClick={e => { e.stopPropagation(); setIsEditing(true); }}
              title="Rename zone"
              style={{
                fontSize: "15px",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "2px",
                flexShrink: 0,
                display: "flex",
                alignItems: "center"
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="11" height="11">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
            </span>
            <span
              className="dv-zone-btn__delete"
              onClick={e => { e.stopPropagation(); onDelete(zone.id); }}
              title="Delete zone"
              style={{
                fontSize: "16px",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "2px",
                flexShrink: 0,
                fontWeight: "bold",
                display: "flex",
                alignItems: "center"
              }}
            >✕</span>
          </div>
        )}
      </button>

      {isActive && sidebarExpanded && camsInZone.length > 0 && (
        <div style={{ paddingBottom: 6 }}>
          {camsInZone.map((p) => {
            const col = TYPE_COLORS[p.camera.type] || "#3b82f6";
            const isHighlit = highlightedId === p.id;
            return (
              <div
                key={p.id}
                onClick={e => { e.stopPropagation(); onHighlightCam(p.id); }}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 10px 5px 20px", cursor: "pointer",
                  background: isHighlit ? zone.color + "18" : "transparent",
                  borderLeft: isHighlit ? `2.5px solid ${zone.color}` : "2.5px solid transparent",
                  transition: "all 0.1s",
                }}
              >
                <CameraIcon type={p.camera.type} size={14} color={col} />
                <span style={{
                  flex: 1, fontSize: 16, color: isHighlit ? "var(--text-primary)" : "var(--text-secondary)",
                  fontWeight: isHighlit ? 600 : 400,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {p.customName || p.camera.model}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); onRemoveCam(p.id); }}
                  title="Remove camera"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--text-muted)", fontSize: 13, padding: "0 2px", flexShrink: 0,
                  }}
                >✕</button>
              </div>
            );
          })}
        </div>
      )}

      {isActive && sidebarExpanded && camsInZone.length === 0 && (
        <div style={{ padding: "3px 10px 6px 18px", fontSize: 14, color: "var(--text-muted)" }}>
          No cameras in zone
        </div>
      )}
    </div>
  );
}

// ── DORI Legend Card (Draggable) ─────────────────────────────────────────────
function DoriLegendCard({ show, onClose, camera }) {
  const [position, setPosition] = useState({ x: 300, y: 100 });

  if (!show) return null;

  const dori = CctvCalc.getDoriDistances(camera);

  const handleMouseDown = (e) => {
    e.preventDefault();
    const startX = e.clientX - position.x;
    const startY = e.clientY - position.y;

    const handleMouseMove = (moveEvent) => {
      setPosition({
        x: moveEvent.clientX - startX,
        y: moveEvent.clientY - startY
      });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: position.x,
        top: position.y,
        background: 'rgba(255, 255, 255, 0.96)',
        border: '1px solid rgba(168, 85, 247, 0.4)',
        borderRadius: 8,
        padding: '12px',
        zIndex: 1000,
        cursor: 'grab',
        userSelect: 'none',
        boxShadow: '0 4px 14px rgba(0,0,0,0.1)',
        width: 260
      }}
      onMouseDown={handleMouseDown}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ color: '#7e22ce', fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>
          DORI ZONES (EN 62676-4)
        </div>
        {onClose && (
          <button 
            onClick={(e) => { e.stopPropagation(); onClose(); }} 
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
            title="Close"
          >✕</button>
        )}
      </div>
      {camera && (
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {camera.model || camera.brand ? `${camera.brand || ''} ${camera.model || ''}`.trim() : 'Camera Spec'} ({camera.megapixels || 2}MP)
        </div>
      )}
      <div style={{ height: 1, background: 'rgba(0,0,0,0.1)', marginBottom: 8 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 6px rgba(168,85,247,0.5)', flexShrink: 0 }} />
            <span style={{ color: '#334155', fontSize: 11, fontWeight: 600 }}>Identification (250+ px/m)</span>
          </div>
          <span style={{ color: '#7e22ce', fontSize: 11, fontWeight: 700, marginLeft: 8 }}>{dori.identification.toFixed(1)} m</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px rgba(239,68,68,0.5)', flexShrink: 0 }} />
            <span style={{ color: '#334155', fontSize: 11, fontWeight: 600 }}>Recognition (125+ px/m)</span>
          </div>
          <span style={{ color: '#dc2626', fontSize: 11, fontWeight: 700, marginLeft: 8 }}>{dori.recognition.toFixed(1)} m</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#eab308', boxShadow: '0 0 6px rgba(234,179,8,0.5)', flexShrink: 0 }} />
            <span style={{ color: '#334155', fontSize: 11, fontWeight: 600 }}>Observation (62+ px/m)</span>
          </div>
          <span style={{ color: '#a16207', fontSize: 11, fontWeight: 700, marginLeft: 8 }}>{dori.observation.toFixed(1)} m</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 6px rgba(59,130,246,0.5)', flexShrink: 0 }} />
            <span style={{ color: '#334155', fontSize: 11, fontWeight: 600 }}>Detection (25+ px/m)</span>
          </div>
          <span style={{ color: '#1d4ed8', fontSize: 11, fontWeight: 700, marginLeft: 8 }}>{dori.detection.toFixed(1)} m</span>
        </div>
      </div>
    </div>
  );
}

// ── Main DesignerView ─────────────────────────────────────────────────────────
export default function DesignerView({ onBack }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const jsonFileInputRef = useRef(null);
  const datasheetInputRef = useRef(null);
  const floorImgRef = useRef(null);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef(null);
  const panStartRef = useRef(null);
  const [isPanLocked, setIsPanLocked] = useState(false);
  const isPanLockedRef = useRef(false);
  const togglePanLock = useCallback(() => {
    const next = !isPanLockedRef.current;
    isPanLockedRef.current = next;
    setIsPanLocked(next);
    panStartRef.current = null;
  }, []);
  useEffect(() => { isPanLockedRef.current = isPanLocked; }, [isPanLocked]);
  const draggingIdxRef = useRef(null);
  const rotatingIdxRef = useRef(null);
  const mouseDownPosRef = useRef(null);
  const saveTimerRef = useRef(null);
  const draggingCamZoneRef = useRef(null);
  const draggingDraftZoneIdRef = useRef(null);
  const draggingDraftVertexIdxRef = useRef(null);
  const draggingLabelIdxRef = useRef(null);
  const labelDragStartRef = useRef(null);
  const draggingZoneRef = useRef(null);

  const [ppm, setPpm] = useState(PIXELS_PER_METRE);
  const ppmRef = useRef(ppm);
  useEffect(() => { ppmRef.current = ppm; }, [ppm]);

  const [placed, setPlaced] = useState([]);
  const placedRef = useRef([]);
  useEffect(() => { placedRef.current = placed; }, [placed]);

  const [saveStatus, setSaveStatus] = useState("saved"); // "saving" | "saved" | "failed"

  const [iconScale, setIconScale] = useState(() => {
    const saved = localStorage.getItem("miradorai_iconScale");
    return saved ? parseFloat(saved) : 1.20;
  });
  const iconScaleRef = useRef(iconScale);
  useEffect(() => { iconScaleRef.current = iconScale; }, [iconScale]);
  // Persist iconScale to localStorage whenever it changes
  useEffect(() => { localStorage.setItem("miradorai_iconScale", String(iconScale)); }, [iconScale]);

  const [textNodes, setTextNodes] = useState([]);
  const [editingTextNode, setEditingTextNode] = useState(null);
  const editingTextNodeRef = useRef(null);
  useEffect(() => { editingTextNodeRef.current = editingTextNode; }, [editingTextNode]);
  const [selectedTextNode, setSelectedTextNode] = useState(null);
  const selectedTextNodeRef = useRef(null);
  useEffect(() => { selectedTextNodeRef.current = selectedTextNode; }, [selectedTextNode]);
  const textNodesRef = useRef([]);
  useEffect(() => { textNodesRef.current = textNodes; }, [textNodes]);

  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [tbFontColor, setTbFontColor] = useState(() => localStorage.getItem("miradorai_tbFontColor") || "#e8edf5");
  const [tbFontSize, setTbFontSize] = useState(() => { const s = localStorage.getItem("miradorai_tbFontSize"); return s ? Number(s) : 36; });
  const [tbFontStyle, setTbFontStyle] = useState(() => localStorage.getItem("miradorai_tbFontStyle") || "Arial");
  // Persist text box settings to localStorage whenever they change
  useEffect(() => { localStorage.setItem("miradorai_tbFontColor", tbFontColor); }, [tbFontColor]);
  useEffect(() => { localStorage.setItem("miradorai_tbFontSize", String(tbFontSize)); }, [tbFontSize]);
  useEffect(() => { localStorage.setItem("miradorai_tbFontStyle", tbFontStyle); }, [tbFontStyle]);

  const draggingTextNodeIdRef = useRef(null);
  const draggingTextStartRef = useRef(null);

  // Stateful interactive pricing in Indian Rupees (INR)
  const [cameraPrices, setCameraPrices] = useState({});
  const [accessoryPrices, setAccessoryPrices] = useState({});
  const [nvrPrice, setNvrPrice] = useState(0);
  const [switchUnitPrice, setSwitchUnitPrice] = useState(0);

  useEffect(() => {
    setCameraPrices(prev => {
      const next = { ...prev };
      let changed = false;
      placed.forEach(p => {
        if (next[p.id] === undefined) {
          next[p.id] = 0;
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setAccessoryPrices(prev => {
      const next = { ...prev };
      let changed = false;
      placed.forEach(p => {
        if (next[p.id] === undefined) {
          next[p.id] = 0;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [placed]);

  const [manualCams, setManualCams] = useState(() => {
    try {
      const saved = localStorage.getItem("miradorai_manual_cams_" + MAP_ID);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("miradorai_manual_cams_" + MAP_ID, JSON.stringify(manualCams));
  }, [manualCams]);

  const [newMc, setNewMc] = useState({
    brand: "",
    model: "",
    qty: 1
  });

  const addManualCam = () => {
    if (!newMc.brand || !newMc.model) {
      alert("Please select both Brand and Model.");
      return;
    }
    const newCam = {
      ...newMc,
      id: "manual_" + Date.now(),
      qty: Number(newMc.qty) || 1
    };
    setManualCams(prev => [...prev, newCam]);
    setNewMc({
      brand: "",
      model: "",
      qty: 1
    });
  };

  const updateManualCam = (id, field, value) => {
    setManualCams(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const manualCamsCount = manualCams.reduce((sum, mc) => sum + (Number(mc.qty) || 0), 0);
  const totalCamsCount = placed.length + manualCamsCount;

  const hardware = CctvCalc.getHardwareRecommendations(totalCamsCount);
  const lastNvrRef = useRef("");
  useEffect(() => {
    if (hardware.nvr !== lastNvrRef.current) {
      setNvrPrice(0);
      lastNvrRef.current = hardware.nvr;
    }
  }, [hardware.nvr]);

  const [zones, setZones] = useState([]);
  const zonesRef = useRef([]);
  const [editZoneId, setEditZoneId] = useState(null);
  const editZoneIdRef = useRef(null);
  useEffect(() => { editZoneIdRef.current = editZoneId; }, [editZoneId]);
  const draggingVertexRef = useRef(null); // { zoneId, index }
  const scalingZoneRef = useRef(null); // { zoneId, startX, startY, initialPolygon, centroid }
  const [drawingPoints, setDrawingPoints] = useState([]);
  const drawingPointsRef = useRef([]);
  const [activeZoneId, setActiveZoneId] = useState(null);
  const activeZoneIdRef = useRef(null);

  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { drawingPointsRef.current = drawingPoints; }, [drawingPoints]);
  useEffect(() => { activeZoneIdRef.current = activeZoneId; }, [activeZoneId]);

  const [showZoneNameModal, setShowZoneNameModal] = useState(false);
  const [pendingZonePoly, setPendingZonePoly] = useState(null);

  const [draftZones, setDraftZones] = useState([]);
  const draftZonesRef = useRef([]);
  useEffect(() => { draftZonesRef.current = draftZones; }, [draftZones]);
  const [isDetectingZones, setIsDetectingZones] = useState(false);

  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const [slides, setSlides] = useState([]);
  const slidesRef = useRef([]);
  useEffect(() => { slidesRef.current = slides; }, [slides]);

  const [activeSlideId, setActiveSlideId] = useState(null);
  const activeSlideIdRef = useRef(null);
  useEffect(() => { activeSlideIdRef.current = activeSlideId; }, [activeSlideId]);

  const [editingSlideId, setEditingSlideId] = useState(null);
  const [editingSlideName, setEditingSlideName] = useState("");

  const [expandedVersions, setExpandedVersions] = useState({});
  const [editingVersionId, setEditingVersionId] = useState(null);
  const [editingVersionName, setEditingVersionName] = useState("");

  const recordState = useCallback((p = placedRef.current, z = zonesRef.current, t = textNodesRef.current) => {
    const snapshot = {
      placed: JSON.parse(JSON.stringify(p)),
      zones: JSON.parse(JSON.stringify(z)),
      textNodes: JSON.parse(JSON.stringify(t))
    };
    setUndoStack(prev => [...prev, snapshot]);
    setRedoStack([]);
  }, []);





  const [popupState, setPopupState] = useState({
    show: false,
    type: "alert",
    title: "",
    message: "",
    onConfirm: null,
    onCancel: null
  });

  const showAlert = (title, message) => {
    setPopupState({
      show: true,
      type: "alert",
      title,
      message,
      onConfirm: () => {
        setPopupState(prev => ({ ...prev, show: false }));
      },
      onCancel: null
    });
  };

  const showConfirm = (title, message, onConfirmCallback) => {
    setPopupState({
      show: true,
      type: "confirm",
      title,
      message,
      onConfirm: () => {
        setPopupState(prev => ({ ...prev, show: false }));
        onConfirmCallback();
      },
      onCancel: () => {
        setPopupState(prev => ({ ...prev, show: false }));
      }
    });
  };



  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isSettingsMinimized, setIsSettingsMinimized] = useState(false);
  const [highlightedCamId, setHighlightedCamId] = useState(null);
  const highlightedCamIdRef = useRef(null);
  useEffect(() => { highlightedCamIdRef.current = highlightedCamId; }, [highlightedCamId]);

  const [contextMenu, setContextMenu] = useState(null);
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [automationZone, setAutomationZone] = useState(null);

  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (fileDropRef.current && !fileDropRef.current.contains(e.target)) {
        setFileDropdownOpen(false);
      }
      if (modesDropRef.current && !modesDropRef.current.contains(e.target)) {
        setModesDropdownOpen(false);
      }
      if (layersDropRef.current && !layersDropRef.current.contains(e.target)) {
        setLayersDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const originalAlert = window.alert;
    window.alert = (msg) => showAlert("Designer View Alert", msg);
    return () => {
      window.alert = originalAlert;
    };
  }, []);

  const addShapeToCanvas = (shapeType) => {
    recordState();
    const cx = ((canvasRef.current?.width || 800) / 2 - offsetRef.current.x) / scaleRef.current;
    const cy = ((canvasRef.current?.height || 600) / 2 - offsetRef.current.y) / scaleRef.current;
    const S = 50; // Size factor

    let polygon = [];
    if (shapeType === "Rectangle") {
      polygon = [{x: cx-S, y: cy-S}, {x: cx+S, y: cy-S}, {x: cx+S, y: cy+S}, {x: cx-S, y: cy+S}];
    } else if (shapeType === "Circle") {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        polygon.push({x: cx + Math.cos(a)*S, y: cy + Math.sin(a)*S});
      }
    } else if (shapeType === "Triangle") {
      polygon = [{x: cx, y: cy-S}, {x: cx+S, y: cy+S}, {x: cx-S, y: cy+S}];
    } else if (shapeType === "Diamond") {
      polygon = [{x: cx, y: cy-S}, {x: cx+S, y: cy}, {x: cx, y: cy+S}, {x: cx-S, y: cy}];
    } else if (shapeType === "Star") {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI/2;
        const r = i % 2 === 0 ? S : S/2.5;
        polygon.push({x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r});
      }
    } else if (shapeType === "L-Shape") {
      polygon = [{x: cx-S/2, y: cy-S}, {x: cx+S/2, y: cy-S}, {x: cx+S/2, y: cy+S/2}, {x: cx+S, y: cy+S/2}, {x: cx+S, y: cy+S}, {x: cx-S/2, y: cy+S}];
    } else if (shapeType === "T-Shape") {
      polygon = [{x: cx-S, y: cy-S}, {x: cx+S, y: cy-S}, {x: cx+S, y: cy-S/2}, {x: cx+S/3, y: cy-S/2}, {x: cx+S/3, y: cy+S}, {x: cx-S/3, y: cy+S}, {x: cx-S/3, y: cy-S/2}, {x: cx-S, y: cy-S/2}];
    } else if (shapeType === "U-Shape") {
      polygon = [{x: cx-S, y: cy-S}, {x: cx-S/2, y: cy-S}, {x: cx-S/2, y: cy+S/2}, {x: cx+S/2, y: cy+S/2}, {x: cx+S/2, y: cy-S}, {x: cx+S, y: cy-S}, {x: cx+S, y: cy+S}, {x: cx-S, y: cy+S}];
    } else if (shapeType === "Cross") {
      polygon = [{x: cx-S/3, y: cy-S}, {x: cx+S/3, y: cy-S}, {x: cx+S/3, y: cy-S/3}, {x: cx+S, y: cy-S/3}, {x: cx+S, y: cy+S/3}, {x: cx+S/3, y: cy+S/3}, {x: cx+S/3, y: cy+S}, {x: cx-S/3, y: cy+S}, {x: cx-S/3, y: cy+S/3}, {x: cx-S, y: cy+S/3}, {x: cx-S, y: cy-S/3}, {x: cx-S/3, y: cy-S/3}];
    } else if (shapeType === "Arrow") {
      polygon = [{x: cx-S/2, y: cy+S/2}, {x: cx+S/2, y: cy+S/2}, {x: cx+S/2, y: cy}, {x: cx+S, y: cy}, {x: cx, y: cy-S}, {x: cx-S, y: cy}, {x: cx-S/2, y: cy}];
    } else if (shapeType === "Hexagon") {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        polygon.push({x: cx + Math.cos(a)*S, y: cy + Math.sin(a)*S});
      }
    } else if (shapeType === "Boom Barrier") {
      polygon = [{x: cx-S*2, y: cy-S/4}, {x: cx+S*2, y: cy-S/4}, {x: cx+S*2, y: cy+S/4}, {x: cx-S*2, y: cy+S/4}];
    }

    const newZone = {
      id: "zone_" + Date.now(),
      name: shapeType,
      color: shapeType === "Boom Barrier" ? "#ef4444" : "#8b5cf6",
      polygon,
      isShape: shapeType !== "Boom Barrier",
      isBoomBarrier: shapeType === "Boom Barrier"
    };

    const newZones = [...zonesRef.current, newZone];
    zonesRef.current = newZones;
    setZones(newZones);
    draw();
  };

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [hasFloor, setHasFloor] = useState(false);
  const [brandFilter, setBrandFilter] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [cameraDB, setCameraDB] = useState([]);
  const cameraDBRef = useRef([]);
  useEffect(() => { cameraDBRef.current = cameraDB; }, [cameraDB]);
  const [brands, setBrands] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [dragCamera, setDragCamera] = useState(null); // eslint-disable-line
  const [selectedIdx, setSelectedIdx] = useState(null);
  const selectedIdxRef = useRef(null);
  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);
  const copiedCameraRef = useRef(null);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [mode, setMode] = useState("place");
  const modeRef = useRef("place");
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showFormatModal, setShowFormatModal] = useState(false);
  const [pendingExportMode, setPendingExportMode] = useState(null); // "design" | "heatmap"
  const [isGeneratingExport, setIsGeneratingExport] = useState(false);
  // ── Export preview state ──
  const [exportPreviewOpen,  setExportPreviewOpen]  = useState(false);
  const [exportPreviewDataUrl, setExportPreviewDataUrl] = useState(null);
  const [exportPreviewCanvas,  setExportPreviewCanvas]  = useState(null);
  const [showStats, setShowStats] = useState(false);
  const [showPpm, setShowPpm] = useState(false);
  const [showMetricsVisibility, setShowMetricsVisibility] = useState(false);
  const showMetricsVisibilityRef = useRef(false);
  useEffect(() => { showMetricsVisibilityRef.current = showMetricsVisibility; }, [showMetricsVisibility]);
  const [showConfigDrawer, setShowConfigDrawer] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(true);
  const [inspectorTab, setInspectorTab] = useState("cameras"); // "cameras" | "zones"
  const [retentionDays, setRetentionDays] = useState(30);
  const exportMenuRef = useRef(null);
  const gltfViewerRef = useRef(null);
  
  const [showEarthMap, setShowEarthMap] = useState(false);

  // ── Company Selection for Exports ──
  const [selectedCompany, setSelectedCompany] = useState("mirador");

  // ── Modes / Layers / File dropdown states ──
  const [modesDropdownOpen, setModesDropdownOpen] = useState(false);
  const [layersDropdownOpen, setLayersDropdownOpen] = useState(false);
  const [fileDropdownOpen, setFileDropdownOpen] = useState(false);
  const modesDropRef = useRef(null);
  const layersDropRef = useRef(null);
  const fileDropRef = useRef(null);

  // ── Layout Calibration states (Synchronized with MapView) ──
  const [calibPanelOpen, setCalibPanelOpen] = useState(false);
  const [calibType, setCalibType] = useState("standard");
  const calibTypeRef = useRef("standard");
  useEffect(() => { calibTypeRef.current = calibType; }, [calibType]);
  const [calibRefs, setCalibRefs] = useState([]);
  const calibRefsRef = useRef([]);
  useEffect(() => { calibRefsRef.current = calibRefs; }, [calibRefs]);
  const [activeCalibRefId, setActiveCalibRefId] = useState(null);
  const activeCalibRefIdRef = useRef(null);
  useEffect(() => { activeCalibRefIdRef.current = activeCalibRefId; }, [activeCalibRefId]);
  const [drawingCalibLine, setDrawingCalibLine] = useState(null);
  const drawingCalibLineRef = useRef(null);
  useEffect(() => { drawingCalibLineRef.current = drawingCalibLine; }, [drawingCalibLine]);
  const [showPreviewGrid, setShowPreviewGrid] = useState(false);
  const [calibHandleDrag, setCalibHandleDrag] = useState(null);
  const calibHandleDragRef = useRef(null);

  // ── Calibration Tape Measure states ──
  const [calPts, setCalPts] = useState([]);
  const calPtsRef = useRef([]);
  useEffect(() => { calPtsRef.current = calPts; }, [calPts]);

  const [mouseMapPos, setMouseMapPos] = useState(null);
  const mouseMapPosRef = useRef(null);
  useEffect(() => { mouseMapPosRef.current = mouseMapPos; }, [mouseMapPos]);

  // ── Crop Layout states ──
  const cropStartRef = useRef(null);
  const cropEndRef = useRef(null);
  const [hasCropSelection, setHasCropSelection] = useState(false);

  // Internal shadowed apiSaveLayout that updates React state for cloud save status
  const apiSaveLayout = useCallback(async ({ placed, zones, ppm, floorPlan = null, slides = null, activeSlideId = null }) => {
    setSaveStatus("saving");
    try {
      const bodyObj = {
        map_id: MAP_ID,
        floor_id: FLOOR_ID,
        placed: placed.map(p => ({ id: p.id, x: p.x, y: p.y, direction: p.direction, camera: p.camera, ...(p.labelOffset ? { labelOffset: p.labelOffset } : {}) })),
        zones: zones.map(z => ({ id: z.id, name: z.name, color: z.color, polygon: z.polygon })),
        ppm,
        floor_plan: floorPlan,
      };
      
      const finalSlides = slides || slidesRef.current;
      if (finalSlides && finalSlides.length > 0) {
        bodyObj.slides = finalSlides;
      }
      
      const finalActiveId = activeSlideId || activeSlideIdRef.current;
      if (finalActiveId) {
        bodyObj.active_slide_id = finalActiveId;
      }

      const response = await fetch(`${API}/api/designer`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(bodyObj),
      });
      if (response.ok) {
        setSaveStatus("saved");
      } else {
        setSaveStatus("failed");
      }
    } catch (e) {
      console.error("[DESIGNER] ❌ Save failed", e);
      setSaveStatus("failed");
    }
  }, []);

  // ── Debounced save ────────────────────────────────────────────────────────
  const scheduleSave = useCallback((placedList, zonesList, currentPpm) => {
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      apiSaveLayout({ 
        placed: placedList, 
        zones: zonesList, 
        ppm: currentPpm,
        slides: slidesRef.current,
        activeSlideId: activeSlideIdRef.current
      }).then(() => {
        setSaveStatus("saved");
      }).catch(() => {
        setSaveStatus("failed");
      });
    }, 800);
  }, []);

  // ── Canvas draw ───────────────────────────────────────────────────────────
  const getStripePattern = (ctx) => {
    if (ctx._stripePattern) return ctx._stripePattern;
    const pCvs = document.createElement("canvas");
    pCvs.width = 20; pCvs.height = 20;
    const pCtx = pCvs.getContext("2d");
    pCtx.fillStyle = "#ef4444"; pCtx.fillRect(0,0,20,20);
    pCtx.beginPath(); pCtx.moveTo(0,20); pCtx.lineTo(20,0);
    pCtx.moveTo(-10,10); pCtx.lineTo(10,-10);
    pCtx.moveTo(10,30); pCtx.lineTo(30,10);
    pCtx.lineWidth = 10; pCtx.strokeStyle = "#ffffff"; pCtx.stroke();
    const pat = ctx.createPattern(pCvs, 'repeat');
    ctx._stripePattern = pat;
    return pat;
  };

  const draw = useCallback(() => {
    const cvs = canvasRef.current; if (!cvs) return;
    const wrap = cvs.parentElement; if (!wrap) return;
    cvs.width = wrap.clientWidth; cvs.height = wrap.clientHeight;
    const ctx = cvs.getContext("2d");
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    const { x: ox, y: oy } = offsetRef.current;
    const sc = scaleRef.current;
    ctx.save(); ctx.translate(ox, oy); ctx.scale(sc, sc);

    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    if (floorImgRef.current) ctx.drawImage(floorImgRef.current, 0, 0);
    else {
      ctx.fillStyle = isLight ? "#f1f5f9" : "#0f141c"; ctx.fillRect(0, 0, 2000, 2000);
      ctx.strokeStyle = isLight ? "#cbd5e1" : "#1e2d3e"; ctx.lineWidth = 1;
      for (let gx = 0; gx < 2000; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, 2000); ctx.stroke(); }
      for (let gy = 0; gy < 2000; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(2000, gy); ctx.stroke(); }
      ctx.fillStyle = isLight ? "#94a3b8" : "#1e2d3e"; ctx.font = "14px monospace"; ctx.textAlign = "center";
      ctx.fillText("Import a floor plan or use the grid", 1000, 1000);
    }


    // ── Visual Calibration Tape Measure ──────────────────────────────────────
    if (modeRef.current === "calibrate") {
      const pts = calPtsRef.current;
      const mousePos = mouseMapPosRef.current;
     
      ctx.save();
      // Draw first point
      if (pts.length > 0) {
        const ptA = pts[0];
        ctx.beginPath(); ctx.arc(ptA.x, ptA.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#f59e0b"; ctx.fill();
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();

        // Draw crosshair lines for first point
        ctx.strokeStyle = "#f59e0baa"; ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(ptA.x - 15, ptA.y); ctx.lineTo(ptA.x + 15, ptA.y);
        ctx.moveTo(ptA.x, ptA.y - 15); ctx.lineTo(ptA.x, ptA.y + 15);
        ctx.stroke();

        // Draw live line to mouse or second point
        const ptB = pts.length > 1 ? pts[1] : mousePos;
        if (ptB) {
          // 1. Draw diagonal straight-line measurement
          ctx.beginPath();
          ctx.moveTo(ptA.x, ptA.y);
          ctx.lineTo(ptB.x, ptB.y);
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);

          // 2. Draw bounding box/rectangle showing width and length
          ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
          ctx.lineWidth = 1.2;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(
            Math.min(ptA.x, ptB.x),
            Math.min(ptA.y, ptB.y),
            Math.abs(ptB.x - ptA.x),
            Math.abs(ptB.y - ptA.y)
          );
          ctx.setLineDash([]);

          // Draw second point
          ctx.beginPath(); ctx.arc(ptB.x, ptB.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = pts.length > 1 ? "#f59e0b" : "#ffffff44"; ctx.fill();
          ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();

          // Crosshairs for second point
          ctx.strokeStyle = "#f59e0baa"; ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(ptB.x - 15, ptB.y); ctx.lineTo(ptB.x + 15, ptB.y);
          ctx.moveTo(ptB.x, ptB.y - 15); ctx.lineTo(ptB.x, ptB.y + 15);
          ctx.stroke();

          // Horizontal & Vertical measurements in pixels and meters (dx, dy)
          const dx = Math.abs(ptB.x - ptA.x);
          const dy = Math.abs(ptB.y - ptA.y);
          const currentPpm = ppmRef.current || PIXELS_PER_METRE;

          // Horizontal (Width) Label on bottom or top of the box
          if (dx > 8) {
            const wx = (ptA.x + ptB.x) / 2;
            const wy = Math.min(ptA.y, ptB.y) - 8;
            ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.9)" : "#10151fec";
            const wLbl = `W: ${Math.round(dx)} px (${(dx / currentPpm).toFixed(2)} m)`;
            ctx.font = "bold 9px monospace";
            const wTw = ctx.measureText(wLbl).width;
            ctx.fillRect(wx - wTw / 2 - 4, wy - 6, wTw + 8, 13);
            ctx.strokeStyle = "rgba(245, 158, 11, 0.6)"; ctx.strokeRect(wx - wTw / 2 - 4, wy - 6, wTw + 8, 13);
            ctx.fillStyle = "#f59e0b";
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(wLbl, wx, wy + 1);
          }

          // Vertical (Length) Label on right or left of the box
          if (dy > 8) {
            const lx = Math.max(ptA.x, ptB.x) + 8;
            const ly = (ptA.y + ptB.y) / 2;
            ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.9)" : "#10151fec";
            const lLbl = `L: ${Math.round(dy)} px (${(dy / currentPpm).toFixed(2)} m)`;
            ctx.font = "bold 9px monospace";
            const lTw = ctx.measureText(lLbl).width;
            ctx.fillRect(lx - 4, ly - 6, lTw + 8, 13);
            ctx.strokeStyle = "rgba(245, 158, 11, 0.6)"; ctx.strokeRect(lx - 4, ly - 6, lTw + 8, 13);
            ctx.fillStyle = "#f59e0b";
            ctx.textAlign = "left"; ctx.textBaseline = "middle";
            ctx.fillText(lLbl, lx, ly + 1);
          }

          // Diagonal distance label (placed near the line midpoint)
          const dPx = Math.hypot(ptB.x - ptA.x, ptB.y - ptA.y);
          const midX = (ptA.x + ptB.x) / 2;
          const midY = (ptA.y + ptB.y) / 2;
          ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.9)" : "#10151fec";
          const lbl = `Diag: ${Math.round(dPx)} px (${(dPx / currentPpm).toFixed(2)} m)`;
          ctx.font = "bold 10px monospace";
          const tw = ctx.measureText(lbl).width;
          ctx.fillRect(midX - tw / 2 - 5, midY - 9, tw + 10, 16);
          ctx.strokeStyle = "#f59e0b"; ctx.strokeRect(midX - tw / 2 - 5, midY - 9, tw + 10, 16);
          ctx.fillStyle = "#f59e0b";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(lbl, midX, midY - 1);
        }
      }
      ctx.restore();
    }

    // ── Crop Box ─────────────────────────────────────────────────────────────
    if (modeRef.current === "crop" && cropStartRef.current && cropEndRef.current) {
      const cx = Math.min(cropStartRef.current.x, cropEndRef.current.x);
      const cy = Math.min(cropStartRef.current.y, cropEndRef.current.y);
      const cw = Math.abs(cropStartRef.current.x - cropEndRef.current.x);
      const ch = Math.abs(cropStartRef.current.y - cropEndRef.current.y);
     
      if (cw > 10 && ch > 10) {
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        const imgW = floorImgRef.current?.width || 2000;
        const imgH = floorImgRef.current?.height || 2000;
       
        ctx.fillRect(0, 0, imgW, cy);
        ctx.fillRect(0, cy, cx, ch);
        ctx.fillRect(cx + cw, cy, imgW - (cx + cw), ch);
        ctx.fillRect(0, cy + ch, imgW, imgH - (cy + ch));

        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2 / sc;
        ctx.setLineDash([6 / sc, 4 / sc]);
        ctx.strokeRect(cx, cy, cw, ch);
        ctx.restore();
      }
    }

    // ── Zones ────────────────────────────────────────────────────────────────
    zonesRef.current.forEach(zone => {
      if (zone.polygon.length < 2) return;
      const isEditingZone = zone.id === editZoneIdRef.current;
      const isActive = zone.id === activeZoneIdRef.current || isEditingZone;
      ctx.save();
      ctx.beginPath();
      zone.polygon.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath();
      ctx.closePath();
      
      if (zone.isBoomBarrier) {
        ctx.fillStyle = getStripePattern(ctx);
        ctx.fill();
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = isEditingZone ? 3.5 / sc : (isActive ? 3.5 : 2.5);
      } else if (zone.isShape) {
        ctx.strokeStyle = zone.color + (isActive ? "ff" : "aa");
        ctx.lineWidth = isEditingZone ? 2.5 / sc : (isActive ? 2.5 : 1.5);
      } else {
        // default zone - no fill
        ctx.strokeStyle = zone.color + (isActive ? "ff" : "aa");
        ctx.lineWidth = isEditingZone ? 2.5 / sc : (isActive ? 2.5 : 1.5);
      }

      if (!isActive && !isShapeZone(zone)) ctx.setLineDash([6, 4]);
      ctx.stroke(); ctx.setLineDash([]);
      zone.polygon.forEach((p, i) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, isEditingZone ? 6 / sc : (isActive ? 4 : 3), 0, Math.PI * 2);
        ctx.fillStyle = isEditingZone ? "#3b82f6" : zone.color; ctx.globalAlpha = isActive ? 1.0 : 0.5; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = isEditingZone ? 2 / sc : 1; ctx.stroke(); ctx.globalAlpha = 1;
      });
      // Zone label removed per user request

      ctx.restore();
    });

    // ── Draft (CV Detected) Zones ────────────────────────────────────────────
    draftZonesRef.current.forEach(zone => {
      if (zone.polygon.length < 2) return;

      // Calculate blink phase (opacity oscillating between 0.25 and 0.85)
      const blinkTime = Date.now() * 0.005; // speed multiplier
      const opacity = 0.35 + 0.35 * Math.sin(blinkTime);

      ctx.save();
      ctx.beginPath();
      zone.polygon.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.closePath();
     
      // Subtle constant background fill
      ctx.fillStyle = zone.color + "14";
      ctx.fill();

      ctx.strokeStyle = zone.color;
      ctx.globalAlpha = opacity;
      ctx.lineWidth = 2.0;
      ctx.setLineDash([6, 4]);
      ctx.stroke(); ctx.setLineDash([]);
     
      zone.polygon.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = zone.color;
        ctx.globalAlpha = opacity;
        ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
      });

      // Calculate center to show a nice little label
      let cx = 0, cy = 0;
      zone.polygon.forEach(p => { cx += p.x; cy += p.y; });
      cx /= zone.polygon.length;
      cy /= zone.polygon.length;
      ctx.fillStyle = zone.color;
      ctx.globalAlpha = opacity;
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("CV DRAFT", cx, cy);
      ctx.restore();
    });


    // ── Zone drawing in progress ──────────────────────────────────────────────
    if (drawingPointsRef.current.length > 0) {
      ctx.save();
      ctx.beginPath();
      drawingPointsRef.current.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2; ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]);
      drawingPointsRef.current.forEach((p, i) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, i === 0 ? 7 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? "#f59e0b" : "#fcd34d"; ctx.fill();
        ctx.strokeStyle = "#fff8"; ctx.lineWidth = 1; ctx.stroke();
      });
      if (drawingPointsRef.current.length >= 3) {
        ctx.beginPath();
        ctx.arc(drawingPointsRef.current[0].x, drawingPointsRef.current[0].y, 12 / sc, 0, Math.PI * 2);
        ctx.strokeStyle = "#f59e0baa"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // ── Placed cameras - Pass 1: Draw ALL beams first ─────────────────────────
    placedRef.current.forEach((p, i) => {
      drawPlacedCamera(
        ctx, p, ppm,
        i === hoveredIdx,
        i === selectedIdx,
        zonesRef,
        activeZoneIdRef,
        highlightedCamIdRef.current,
        false,
        showPpm,
        false,
        iconScaleRef.current,
        "beam",
        scaleRef.current,
        showMetricsVisibilityRef.current,
        showHeatmap
      );
    });

    // ── Placed cameras - Pass 2: Draw ALL bodies & labels ─────────────────────
    placedRef.current.forEach((p, i) => {
      drawPlacedCamera(
        ctx, p, ppm,
        i === hoveredIdx,
        i === selectedIdx,
        zonesRef,
        activeZoneIdRef,
        highlightedCamIdRef.current,
        false,
        showPpm,
        false,
        iconScaleRef.current,
        "body",
        scaleRef.current,
        showMetricsVisibilityRef.current,
        showHeatmap
      );
    });

    // ── Rotation handle for selected camera ───────────────────────────────────
    if (selectedIdx !== null && selectedIdx < placedRef.current.length) {
      const p = placedRef.current[selectedIdx];
      const { angle } = fovDrawParams(p.camera, p.direction);
      const hx = p.x + Math.cos(angle) * 26;
      const hy = p.y + Math.sin(angle) * 26;
      const col = TYPE_COLORS[p.camera.type] || "#3b82f6";
      
      ctx.save();
      ctx.translate(hx, hy);

      // Outer halo ring for selected camera handle
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "#0d1117ee";
      ctx.fill();

      // Outer accent ring
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.strokeStyle = col + "55";
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Inner primary ring
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Solid grip core dot
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();

      ctx.restore();
    }

    // ── Zone Hover Tooltip ───────────────────────────────────────────────────
    if (mouseMapPosRef.current && hoveredIdx === null) {
      const hoveredZone = zonesRef.current.find(
        z => z.polygon?.length >= 3 && pointInOrOnPolygon(mouseMapPosRef.current.x, mouseMapPosRef.current.y, z.polygon)
      );

      if (hoveredZone) {
        const lbl = `Zone: ${hoveredZone.name}`;
        ctx.font = "10.5px Inter, sans-serif";
        const tw = ctx.measureText(lbl).width;
        const tx = mouseMapPosRef.current.x;
        const ty = mouseMapPosRef.current.y - 18;
        const bx = tx - tw / 2 - 7;
        const by = ty - 9;
        ctx.save();
        ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(13, 17, 23, 0.95)";
        ctx.strokeStyle = hoveredZone.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, tw + 14, 18, 4);
        else ctx.rect(bx, by, tw + 14, 18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = isLight ? "#1e293b" : "#e8edf5";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(lbl, tx, ty);
        ctx.restore();
      }
    }

    // ── Text Annotations ─────────────────────────────────────────────────────
    textNodesRef.current.forEach(node => {
      const isEditing = node.id === editingTextNodeRef.current;
      const isSelected = node.id === selectedTextNodeRef.current;

      ctx.save();
      ctx.font = `bold ${node.size}px "${node.font}", sans-serif`;
      ctx.fillStyle = node.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
     
      if (!isEditing) {
        ctx.fillText(node.text, node.x, node.y);
      }
     
      const metrics = ctx.measureText(node.text);
      const w = metrics.width;
      const h = node.size;

      if (isSelected || isEditing) {
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2 / sc;
        ctx.setLineDash([4 / sc, 4 / sc]);
        ctx.strokeRect(node.x - 4/sc, node.y - 4/sc, w + 8/sc, h + 8/sc);
        ctx.setLineDash([]);
      }
     
      if (isSelected || isEditing) {
        const cx = node.x + w + 10 / sc;
        const cy = node.y - 4 / sc;
        const r = 8 / sc;
       
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = "#ef4444";
        ctx.fill();
       
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5 / sc;
        ctx.beginPath();
        ctx.moveTo(cx - 3/sc, cy - 3/sc);
        ctx.lineTo(cx + 3/sc, cy + 3/sc);
        ctx.moveTo(cx + 3/sc, cy - 3/sc);
        ctx.lineTo(cx - 3/sc, cy + 3/sc);
        ctx.stroke();
      }

      if (draggingTextNodeIdRef.current === node.id) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 2 / sc;
        ctx.setLineDash([4 / sc, 4 / sc]);
        ctx.strokeRect(node.x - 2/sc, node.y - 2/sc, w + 4/sc, h + 4/sc);
      }
      ctx.restore();
    });

    ctx.restore();
  }, [ppm, hoveredIdx, selectedIdx, showPpm, showMetricsVisibility, showHeatmap]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const currentState = {
      placed: JSON.parse(JSON.stringify(placedRef.current)),
      zones: JSON.parse(JSON.stringify(zonesRef.current)),
      textNodes: JSON.parse(JSON.stringify(textNodesRef.current))
    };
    setRedoStack(prev => [...prev, currentState]);
    const previousState = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    placedRef.current = previousState.placed;
    setPlaced(previousState.placed);
    zonesRef.current = previousState.zones;
    setZones(previousState.zones);
    textNodesRef.current = previousState.textNodes || [];
    setTextNodes(previousState.textNodes || []);
    setSelectedIdx(null);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;
    draw();
    apiSaveLayout({ placed: previousState.placed, zones: previousState.zones, ppm: ppmRef.current });
  }, [undoStack, draw]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const currentState = {
      placed: JSON.parse(JSON.stringify(placedRef.current)),
      zones: JSON.parse(JSON.stringify(zonesRef.current)),
      textNodes: JSON.parse(JSON.stringify(textNodesRef.current))
    };
    setUndoStack(prev => [...prev, currentState]);
    const nextState = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    placedRef.current = nextState.placed;
    setPlaced(nextState.placed);
    zonesRef.current = nextState.zones;
    setZones(nextState.zones);
    textNodesRef.current = nextState.textNodes || [];
    setTextNodes(nextState.textNodes || []);
    setSelectedIdx(null);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;
    draw();
    apiSaveLayout({ placed: nextState.placed, zones: nextState.zones, ppm: ppmRef.current });
  }, [redoStack, draw]);

  const downloadJson = useCallback(() => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
      placed: placedRef.current,
      zones: zonesRef.current,
      ppm: ppmRef.current
    }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mirador_designer_layout_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }, []);

  const handleJsonImport = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
       
        recordState();
       
        if (data.ppm) {
          setPpm(data.ppm);
          ppmRef.current = data.ppm;
        }
        if (Array.isArray(data.placed)) {
          placedRef.current = data.placed;
          setPlaced(data.placed);
        }
        if (Array.isArray(data.zones)) {
          zonesRef.current = data.zones;
          setZones(data.zones);
          apiSaveZones(data.zones);
        }
       
        draw();
       
        apiSaveLayout({
          placed: data.placed || [],
          zones: data.zones || [],
          ppm: data.ppm || ppmRef.current
        });
       
        alert("Layout imported successfully!");
      } catch (err) {
        console.error("JSON parsing error: ", err);
        alert("Failed to parse JSON file. Please ensure it is a valid layout export.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [draw, recordState]);

  // ── Datasheet Upload handler ──
  const [datasheetUploading, setDatasheetUploading] = useState(false);
  const handleDatasheetUpload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const uploadFile = async (overwriteFlag) => {
      const formData = new FormData();
      formData.append("file", file);
      if (overwriteFlag) formData.append("overwrite", "true");
      
      return await fetch(`${API}/api/designer/upload-datasheet`, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + (localStorage.getItem("miradorai_token") || "")
        },
        body: formData
      });
    };
    
    try {
      setDatasheetUploading(true);
      setSaveStatus("saving");
      let r = await uploadFile(false);
      let result = await r.json();
      if (!r.ok) throw new Error(result.detail || "Upload failed");
      
      if (result.skipped) {
        setDatasheetUploading(false);
        const confirmOverwrite = window.confirm(result.message + "\n\nDo you want to overwrite it with the new data from this datasheet?");
        if (confirmOverwrite) {
          setDatasheetUploading(true);
          setSaveStatus("saving");
          r = await uploadFile(true);
          result = await r.json();
          if (!r.ok) throw new Error(result.detail || "Overwrite failed");
        } else {
          setSaveStatus("saved");
          e.target.value = "";
          return;
        }
      }
      
      alert(result.message);
      
      // Refresh library list
      fetchCameraModels({ brand: brandFilter, type: typeFilter, search: searchQuery })
        .then(data => { setCameraDB(data.cameras); setBrands(data.brands); })
        .catch(() => { });
        
      setSaveStatus("saved");
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to process datasheet.");
      setSaveStatus("failed");
    } finally {
      setDatasheetUploading(false);
    }
    e.target.value = "";
  }, [brandFilter, typeFilter, searchQuery]);

  // ── Varifocal zoom change handler ──
  const handleVarifocalChange = useCallback((idx, focalLen) => {
    const updated = [...placedRef.current];
    const item = updated[idx];
    if (!item || !item.camera.isVarifocal) return;

    recordState();

    // Linear interpolation for HFOV based on focal length
    const fMin = item.camera.focalLength;
    const fMax = item.camera.focalLengthMax;
    const originalHfov = item.camera.originalHfov || item.camera.hfov;
    const hMin = item.camera.hfovMin || originalHfov * 0.3; // fallback

    const t = (focalLen - fMin) / (fMax - fMin);
    const interpolatedHfov = originalHfov - t * (originalHfov - hMin);

    updated[idx] = {
      ...item,
      currentFocalLength: focalLen,
      currentHfov: interpolatedHfov,
      camera: {
        ...item.camera,
        originalHfov: originalHfov, // preserve original widest HFOV
        hfov: interpolatedHfov, // dynamic override for FOV cone
      }
    };

    placedRef.current = updated;
    setPlaced(updated);
    draw();
    scheduleSave(updated, zonesRef.current, ppmRef.current);
  }, [draw, scheduleSave, recordState]);

  // ── Camera surveillance scenario & accessories configuration change handler ──
  const handleCameraConfigChange = useCallback((idx, key, value) => {
    const updated = [...placedRef.current];
    const item = updated[idx];
    if (!item) return;

    recordState();

    const newItem = {
      ...item,
      [key]: value
    };
    updated[idx] = newItem;



    placedRef.current = updated;
    setPlaced(updated);
    draw();
    scheduleSave(updated, zonesRef.current, ppmRef.current);
  }, [draw, scheduleSave, recordState]);

  // ── Layout Calibration Handlers (Synchronized with MapView) ──
  const setCalibrateMode = useCallback(() => {
    setMode("calibrate");
    modeRef.current = "calibrate";
    setCalibPanelOpen(true);
    setSelectedIdx(null);
    selectedIdxRef.current = null;
    setSelectedModel(null);
    setModesDropdownOpen(false);
    setDrawingCalibLine(null);
    drawingCalibLineRef.current = null;
    const currentSlide = slidesRef.current.find(s => s.id === activeSlideIdRef.current) || slidesRef.current[0];
    if (currentSlide?.calibration?.references?.length) {
      setCalibRefs([...currentSlide.calibration.references]);
      calibRefsRef.current = [...currentSlide.calibration.references];
      setCalibType(currentSlide.calibration.mode || "standard");
    }
    draw();
  }, [draw]);

  const handleApplyCalibration = useCallback(() => {
    const currentSlide = slidesRef.current.find(s => s.id === activeSlideIdRef.current) || slidesRef.current[0];
    const img = floorImgRef.current;
    if (!img && !currentSlide?.modelDataUrl) {
      alert("No floor plan loaded.");
      return;
    }
    if (calibRefsRef.current.length === 0) {
      alert("Please draw at least one reference line.");
      return;
    }
    try {
      const imgDims = {
        width: img ? img.width : (currentSlide?.imageWidth || 2048),
        height: img ? img.height : (currentSlide?.imageHeight || 2048)
      };
      let newCalib = null;
      if (calibTypeRef.current === "standard") {
        newCalib = buildStandardCalibration(calibRefsRef.current[0], imgDims);
      } else {
        newCalib = buildAdvancedCalibration(calibRefsRef.current, imgDims);
      }

      const updatedSlides = slidesRef.current.map(s => {
        if (s.id !== activeSlideIdRef.current) return s;
        return {
          ...s,
          calibration: newCalib,
          ppm: newCalib.ppm
        };
      });

      slidesRef.current = updatedSlides;
      setSlides(updatedSlides);
      setPpm(newCalib.ppm);
      ppmRef.current = newCalib.ppm;
      saveFloorsDB(updatedSlides, activeSlideIdRef.current);
      scheduleSave(placedRef.current, zonesRef.current, newCalib.ppm);

      setCalibPanelOpen(false);
      setMode("place");
      modeRef.current = "place";
      alert(
        newCalib.mode === "standard"
          ? `Standard calibration applied successfully.\nGlobal scale: ${newCalib.ppm.toFixed(2)} px/m.`
          : `Advanced spatial transformation applied successfully with ${newCalib.references.length} reference measurements.`
      );
      draw();
    } catch (err) {
      console.error("[DesignerView] Calibration failed:", err);
      alert("Calibration failed: " + err.message);
    }
  }, [draw, scheduleSave]);

  const handleClearCalibration = useCallback(() => {
    if (!window.confirm("Clear calibration? Scale and distance measurements will return to uncalibrated default.")) return;
    const defaultPpm = PIXELS_PER_METRE;
    const updatedSlides = slidesRef.current.map(s => {
      if (s.id !== activeSlideIdRef.current) return s;
      return {
        ...s,
        calibration: null,
        ppm: defaultPpm
      };
    });
    slidesRef.current = updatedSlides;
    setSlides(updatedSlides);
    setPpm(defaultPpm);
    ppmRef.current = defaultPpm;
    saveFloorsDB(updatedSlides, activeSlideIdRef.current);
    scheduleSave(placedRef.current, zonesRef.current, defaultPpm);
    setCalibRefs([]);
    calibRefsRef.current = [];
    setActiveCalibRefId(null);
    setCalibPanelOpen(false);
    setMode("place");
    modeRef.current = "place";
    draw();
  }, [draw, scheduleSave]);

  // ── Restore layout on mount with IndexedDB and API fallback ──────────────
  useEffect(() => {
    async function initLayout() {
      let parsedSlides = null;
      let activeId = null;

      // 1. Try loading from IndexedDB first for instant, high-capacity cache
      try {
        const cachedSlides = await loadFloorsDB("designer_" + MAP_ID);
        if (cachedSlides && Array.isArray(cachedSlides) && cachedSlides.length > 0) {
          parsedSlides = cachedSlides;
          const savedActiveId = localStorage.getItem("miradorai_designer_activeSlide_" + MAP_ID);
          if (savedActiveId && parsedSlides.find(s => s.id === savedActiveId)) {
            activeId = savedActiveId;
          } else {
            activeId = parsedSlides[0].id;
          }
        }
      } catch (err) {
        console.warn("[DesignerView] IndexedDB restore error:", err);
      }

      // 2. Fetch backend layout
      let backendData = null;
      try {
        backendData = await apiLoadLayout();
      } catch (err) {
        console.warn("[DesignerView] Backend load error:", err);
      }

      if (!parsedSlides && backendData && backendData.slides && backendData.slides.length > 0) {
        parsedSlides = backendData.slides;
        activeId = (backendData.active_slide_id && parsedSlides.find(s => s.id === backendData.active_slide_id))
          ? backendData.active_slide_id
          : parsedSlides[0].id;
      }

      if (parsedSlides && parsedSlides.length > 0) {
        setSlides(parsedSlides);
        slidesRef.current = parsedSlides;

        const effectiveActiveId = activeId || parsedSlides[0].id;
        setActiveSlideId(effectiveActiveId);
        activeSlideIdRef.current = effectiveActiveId;

        const activeSlide = parsedSlides.find(s => s.id === effectiveActiveId);
        if (activeSlide) {
          setPpm(activeSlide.ppm || PIXELS_PER_METRE);
          ppmRef.current = activeSlide.ppm || PIXELS_PER_METRE;

          placedRef.current = activeSlide.placed || [];
          setPlaced(activeSlide.placed || []);

          zonesRef.current = activeSlide.zones || [];
          setZones(activeSlide.zones || []);

          draftZonesRef.current = activeSlide.draftZones || [];
          setDraftZones(activeSlide.draftZones || []);

          textNodesRef.current = activeSlide.textNodes || [];
          setTextNodes(activeSlide.textNodes || []);

          if (activeSlide.floorPlan) {
            const img = new Image();
            img.onload = () => {
              floorImgRef.current = img;
              setHasFloor(true);
              setTimeout(fitImage, 50);
            };
            img.src = activeSlide.floorPlan;
          } else if (activeSlide.modelDataUrl) {
            floorImgRef.current = null;
            setHasFloor(true);
          } else {
            floorImgRef.current = null;
            setHasFloor(false);
          }
        }
      } else {
        const defaultSlide = {
          id: "slide_" + Date.now(),
          name: "Floor Draft 1",
          floorPlan: (backendData && backendData.floor_plan) || null,
          modelDataUrl: (backendData && backendData.model_data_url) || null,
          partsReport: null,
          placed: (backendData && backendData.placed) || [],
          zones: (backendData && backendData.zones) || [],
          draftZones: [],
          ppm: (backendData && backendData.ppm) || PIXELS_PER_METRE
        };

        setSlides([defaultSlide]);
        slidesRef.current = [defaultSlide];
        setActiveSlideId(defaultSlide.id);
        activeSlideIdRef.current = defaultSlide.id;

        if (backendData) {
          if (backendData.ppm) {
            setPpm(backendData.ppm);
            ppmRef.current = backendData.ppm;
          }
          if (backendData.placed?.length) {
            placedRef.current = backendData.placed;
            setPlaced(backendData.placed);
          }
          if (backendData.zones?.length) {
            zonesRef.current = backendData.zones;
            setZones(backendData.zones);
          }
          if (backendData.floor_plan) {
            const img = new Image();
            img.onload = () => {
              floorImgRef.current = img;
              setHasFloor(true);
              setTimeout(fitImage, 50);
            };
            img.src = backendData.floor_plan;
          }
        }
      }
    }

    initLayout();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save to IndexedDB whenever slides or activeSlideId changes ───────
  useEffect(() => {
    if (slides && slides.length > 0) {
      saveFloorsDB("designer_" + MAP_ID, slides);
      if (activeSlideId) {
        localStorage.setItem("miradorai_designer_activeSlide_" + MAP_ID, activeSlideId);
      }
    }
  }, [slides, activeSlideId]);

  // Reactive Sync: Keep active slide inside slides list in sync with current canvas editor states
  useEffect(() => {
    if (!activeSlideId) return;
    setSlides(prevSlides => {
      const idx = prevSlides.findIndex(s => s.id === activeSlideId);
      if (idx === -1) return prevSlides;
     
      const currentSlide = prevSlides[idx];
      if (
        currentSlide.ppm === ppm &&
        JSON.stringify(currentSlide.placed) === JSON.stringify(placed) &&
        JSON.stringify(currentSlide.zones) === JSON.stringify(zones) &&
        JSON.stringify(currentSlide.draftZones) === JSON.stringify(draftZones) &&
        JSON.stringify(currentSlide.textNodes) === JSON.stringify(textNodes)
      ) {
        return prevSlides;
      }
     
      const updated = [...prevSlides];
      updated[idx] = {
        ...currentSlide,
        ppm,
        placed,
        zones,
        draftZones,
        textNodes
      };
      return updated;
    });
  }, [placed, zones, draftZones, ppm, activeSlideId, textNodes]);

  // ── Camera model fetch ────────────────────────────────────────────────────
  useEffect(() => {
    fetchCameraModels({ brand: brandFilter, type: typeFilter, search: searchQuery })
      .then(data => { setCameraDB(data.cameras); setBrands(data.brands); })
      .catch(() => { });
  }, [brandFilter, typeFilter, searchQuery]);

  useEffect(() => {
    const handleClickOutside = e => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target))
        setShowExportMenu(false);
    };
    if (showExportMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showExportMenu]);

  const filteredCameras = brandFilter ? cameraDB : [];

  // ── Zoom to zone ──────────────────────────────────────────────────────────
  const zoomToZone = useCallback((zone) => {
    if (isPanLockedRef.current) return;
    const wrap = wrapRef.current; if (!wrap) return;
    const xs = zone.polygon.map(p => p.x), ys = zone.polygon.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const pw = maxX - minX, ph = maxY - minY;
    if (pw < 1 || ph < 1) return;
    const pad = 80;
    const scale = Math.min((W - pad * 2) / pw, (H - pad * 2) / ph, 8);
    scaleRef.current = scale;
    offsetRef.current = { x: W / 2 - ((minX + maxX) / 2) * scale, y: H / 2 - ((minY + maxY) / 2) * scale };
    setZoomPct(Math.round(scale * 100));
  }, []);

  // ── Zoom to a camera ─────────────────────────────────────────────────────
  const zoomToCamera = useCallback((camId) => {
    if (isPanLockedRef.current) return;
    const cam = placedRef.current.find(p => p.id === camId);
    if (!cam) return;
    const wrap = wrapRef.current; if (!wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const targetScale = Math.max(scaleRef.current, 2);
    scaleRef.current = targetScale;
   
    // Shift camera focus point UP above the bottom settings bar (~150px)
    const bottomBarHeight = 150;
    const visibleH = H - bottomBarHeight;
   
    offsetRef.current = {
      x: W / 2 - cam.x * targetScale,
      y: visibleH / 2 - cam.y * targetScale
    };
    setZoomPct(Math.round(targetScale * 100));
  }, []);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw, placed, zones, drawingPoints, activeZoneId, highlightedCamId, draftZones]);

  useEffect(() => {
    if (draftZones.length === 0) return;
    let active = true;
    const tick = () => {
      if (!active) return;
      draw();
      requestAnimationFrame(tick);
    };
    const localRaf = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(localRaf);
    };
  }, [draftZones, draw]);

  useEffect(() => {
    const obs = new ResizeObserver(draw);
    const el = canvasRef.current?.parentElement;
    if (el) obs.observe(el);
    return () => obs.disconnect();
  }, [draw]);

  const fitImage = useCallback(() => {
    const wrap = wrapRef.current; const img = floorImgRef.current;
    if (!wrap || !img) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
   
    const leftMargin = 65;
    const rightPanelWidth = inspectorExpanded ? 265 : 0;
    const visibleW = W - rightPanelWidth - leftMargin;
   
    // Account for the bottom settings bar height if a camera is selected
    const bottomBarHeight = selectedIdx !== null ? 150 : 0;
    const visibleH = H - 40 - bottomBarHeight;
   
    const s = Math.min(visibleW / img.width, visibleH / img.height) * 0.96;
    scaleRef.current = s;
    offsetRef.current = {
      x: leftMargin + (visibleW - img.width * s) / 2,
      y: (visibleH - img.height * s) / 2,
    };
    setZoomPct(Math.round(s * 100)); draw();
  }, [inspectorExpanded, selectedIdx, draw]);

  useEffect(() => {
    fitImage();
  }, [inspectorExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const renameSlide = useCallback((slideId, newName) => {
    setSlides(prev => prev.map(s => s.id === slideId ? { ...s, name: newName } : s));
  }, []);

  const switchSlide = useCallback((slideId) => {
    const targetSlide = slidesRef.current.find(s => s.id === slideId);
    if (!targetSlide) return;

    recordState();

    setActiveSlideId(slideId);

    setPpm(targetSlide.ppm || PIXELS_PER_METRE);
    ppmRef.current = targetSlide.ppm || PIXELS_PER_METRE;

    placedRef.current = targetSlide.placed || [];
    setPlaced(targetSlide.placed || []);

    zonesRef.current = targetSlide.zones || [];
    setZones(targetSlide.zones || []);

    draftZonesRef.current = targetSlide.draftZones || [];
    setDraftZones(targetSlide.draftZones || []);

    drawingPointsRef.current = [];
    setDrawingPoints([]);
    setSelectedIdx(null);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;

    if (targetSlide.floorPlan) {
      const img = new Image();
      img.onload = () => {
        floorImgRef.current = img;
        setHasFloor(true);
        setTimeout(fitImage, 50);
      };
      img.src = targetSlide.floorPlan;
    } else if (targetSlide.modelDataUrl) {
      floorImgRef.current = null;
      setHasFloor(true);
    } else {
      floorImgRef.current = null;
      setHasFloor(false);
      draw();
    }

    apiSaveFloorPlan(targetSlide.floorPlan);
    apiSaveLayout({
      placed: targetSlide.placed || [],
      zones: targetSlide.zones || [],
      ppm: targetSlide.ppm || PIXELS_PER_METRE
    });
  }, [recordState, fitImage, draw]);

  const deleteSlide = useCallback((slideId, e) => {
    if (e) e.stopPropagation();

    if (slidesRef.current.length <= 1) {
      alert("You must keep at least one floor draft.");
      return;
    }

    recordState();

    const currentSlides = slidesRef.current;
    const index = currentSlides.findIndex(s => s.id === slideId);
    const updatedSlides = currentSlides.filter(s => s.id !== slideId);
    setSlides(updatedSlides);

    if (activeSlideIdRef.current === slideId) {
      const newActiveIdx = Math.max(0, index - 1);
      const newActiveSlide = updatedSlides[newActiveIdx];
      if (newActiveSlide) {
        setActiveSlideId(newActiveSlide.id);

        setPpm(newActiveSlide.ppm || PIXELS_PER_METRE);
        ppmRef.current = newActiveSlide.ppm || PIXELS_PER_METRE;

        placedRef.current = newActiveSlide.placed || [];
        setPlaced(newActiveSlide.placed || []);

        zonesRef.current = newActiveSlide.zones || [];
        setZones(newActiveSlide.zones || []);

        draftZonesRef.current = newActiveSlide.draftZones || [];
        setDraftZones(newActiveSlide.draftZones || []);

        drawingPointsRef.current = [];
        setDrawingPoints([]);
        setSelectedIdx(null);
        setActiveZoneId(null);
        activeZoneIdRef.current = null;

        if (newActiveSlide.floorPlan) {
          const img = new Image();
          img.onload = () => {
            floorImgRef.current = img;
            setHasFloor(true);
            setTimeout(fitImage, 50);
          };
          img.src = newActiveSlide.floorPlan;
        } else if (newActiveSlide.modelDataUrl) {
          floorImgRef.current = null;
          setHasFloor(true);
        } else {
          floorImgRef.current = null;
          setHasFloor(false);
          draw();
        }

        apiSaveFloorPlan(newActiveSlide.floorPlan);
        scheduleSave(
          newActiveSlide.placed || [],
          newActiveSlide.zones || [],
          newActiveSlide.ppm || PIXELS_PER_METRE
        );
      }
    }
  }, [recordState, fitImage, draw, scheduleSave]);

  const addNewSlide = useCallback((floorPlan = null, floorPlanName = null, options = {}) => {
    const { modelDataUrl = null, autoPpm = null, imageWidth = 2048, imageHeight = 2048, partsReport = null, embeddedPlaced = [] } = options;
    recordState();

    const newSlideId = "slide_" + Date.now();
    const newSlideName = floorPlanName || `Floor Draft ${slidesRef.current.length + 1}`;
    const effectivePpm = autoPpm || PIXELS_PER_METRE;

    const newSlide = {
      id: newSlideId,
      name: newSlideName,
      floorPlan,
      modelDataUrl,
      imageWidth,
      imageHeight,
      partsReport,
      placed: embeddedPlaced,
      zones: [],
      draftZones: [],
      ppm: effectivePpm
    };

    setSlides(prev => [...prev, newSlide]);
    setActiveSlideId(newSlideId);
    activeSlideIdRef.current = newSlideId;

    setPpm(effectivePpm);
    ppmRef.current = effectivePpm;

    placedRef.current = embeddedPlaced;
    setPlaced(embeddedPlaced);
    zonesRef.current = [];
    setZones([]);
    draftZonesRef.current = [];
    setDraftZones([]);
    drawingPointsRef.current = [];
    setDrawingPoints([]);
    setSelectedIdx(null);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    if (floorPlan) {
      const img = new Image();
      img.onload = () => {
        floorImgRef.current = img;
        setHasFloor(true);
        setTimeout(fitImage, 50);
      };
      img.src = floorPlan;
    } else if (modelDataUrl) {
      floorImgRef.current = null;
      setHasFloor(true);
    } else {
      floorImgRef.current = null;
      setHasFloor(false);
      draw();
    }

    apiSaveFloorPlan(floorPlan);
    scheduleSave(embeddedPlaced, [], effectivePpm);
  }, [recordState, fitImage, draw, scheduleSave]);

  const loadOrUpdateSlide = useCallback((floorPlan = null, floorPlanName = null, options = {}) => {
    const currentActiveSlide = slidesRef.current.find(s => s.id === activeSlideIdRef.current);
    const isCurrentEmpty = currentActiveSlide && !currentActiveSlide.floorPlan && !currentActiveSlide.modelDataUrl && (!currentActiveSlide.placed || currentActiveSlide.placed.length === 0);

    if (isCurrentEmpty) {
      const { modelDataUrl = null, autoPpm = null, imageWidth = 2048, imageHeight = 2048, partsReport = null, embeddedPlaced = [] } = options;
      recordState();

      const effectivePpm = autoPpm || PIXELS_PER_METRE;
      const updatedSlide = {
        ...currentActiveSlide,
        name: floorPlanName || currentActiveSlide.name,
        floorPlan,
        modelDataUrl,
        imageWidth,
        imageHeight,
        partsReport,
        placed: embeddedPlaced,
        ppm: effectivePpm
      };

      setSlides(prev => prev.map(s => s.id === updatedSlide.id ? updatedSlide : s));
      setPpm(effectivePpm);
      ppmRef.current = effectivePpm;
      placedRef.current = embeddedPlaced;
      setPlaced(embeddedPlaced);
      zonesRef.current = [];
      setZones([]);
      draftZonesRef.current = [];
      setDraftZones([]);
      drawingPointsRef.current = [];
      setDrawingPoints([]);
      setSelectedIdx(null);
      setActiveZoneId(null);
      activeZoneIdRef.current = null;

      if (floorPlan) {
        const img = new Image();
        img.onload = () => {
          floorImgRef.current = img;
          setHasFloor(true);
          setTimeout(fitImage, 50);
        };
        img.src = floorPlan;
      } else if (modelDataUrl) {
        floorImgRef.current = null;
        setHasFloor(true);
      } else {
        floorImgRef.current = null;
        setHasFloor(false);
        draw();
      }

      apiSaveFloorPlan(floorPlan);
      scheduleSave(embeddedPlaced, [], effectivePpm);
    } else {
      addNewSlide(floorPlan, floorPlanName, options);
    }
  }, [addNewSlide, recordState, fitImage, draw, scheduleSave]);

  const applyZoom = useCallback((delta, cx, cy) => {
    const prev = scaleRef.current;
    const next = Math.min(8, Math.max(0.08, prev + delta));
    scaleRef.current = next;
    if (!isPanLockedRef.current) {
      offsetRef.current = {
        x: cx - (cx - offsetRef.current.x) * (next / prev),
        y: cy - (cy - offsetRef.current.y) * (next / prev),
      };
    }
    setZoomPct(Math.round(next * 100)); draw();
  }, [draw]);

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const h = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      applyZoom(e.deltaY < 0 ? 0.15 : -0.15, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [applyZoom]);

  function toImg(ex, ey) {
    const el = wrapRef.current; if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: (ex - r.left - offsetRef.current.x) / scaleRef.current,
      y: (ey - r.top - offsetRef.current.y) / scaleRef.current,
    };
  }

  function nearestPlaced(ix, iy) {
    const S = 1.20;
    const thr = Math.max(30 / scaleRef.current, 25 * S);
    let best = -1, bestD = thr;
    placedRef.current.forEach((p, i) => {
      const d = Math.hypot(p.x - ix, p.y - iy);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function nearRotHandle(ix, iy) {
    if (selectedIdx === null) return false;
    const p = placedRef.current[selectedIdx]; if (!p) return false;
    const { angle } = fovDrawParams(p.camera, p.direction);
    const hx = p.x + Math.cos(angle) * 26;
    const hy = p.y + Math.sin(angle) * 26;
    return Math.hypot(ix - hx, iy - hy) < 16 / scaleRef.current;
  }

  // ── Label hit-test: returns index of placed camera whose label contains (ix, iy) ──
  function nearestLabel(ix, iy) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return -1;
    ctx.font = "10.5px Inter, sans-serif";
    let best = -1;
    placedRef.current.forEach((p, i) => {
      const lbl = p.customName || p.camera.model;
      const tw = ctx.measureText(lbl).width;
      const lo = p.labelOffset || { dx: 0, dy: 0 };
      const labelCenterX = p.x + lo.dx;
      const labelTopY = p.y - 24 + lo.dy;
      const bx = labelCenterX - tw / 2 - 7;
      const labelW = tw + 14;
      const labelH = 18;
      if (ix >= bx && ix <= bx + labelW && iy >= labelTopY && iy <= labelTopY + labelH) {
        best = i;
      }
    });
    return best;
  }

  const finishZoneDrawing = useCallback((points) => {
    setPendingZonePoly(points);
    setShowZoneNameModal(true);
  }, []);

  function saveZone(name) {
    recordState();
    const points = pendingZonePoly;
    const colorIdx = zonesRef.current.length % ZONE_COLORS.length;
    const newZone = { id: "zone_" + Date.now(), name, polygon: points, color: ZONE_COLORS[colorIdx] };
    const updated = [...zonesRef.current, newZone];
    zonesRef.current = updated;
    setZones(updated);
    setActiveZoneId(newZone.id);
    activeZoneIdRef.current = newZone.id;
    drawingPointsRef.current = []; setDrawingPoints([]); setMode("place");
    setPendingZonePoly(null);
    setShowZoneNameModal(false);
    setTimeout(() => zoomToZone(newZone), 0);
    apiSaveZones(updated);
  }

  function cancelZoneDrawing() {
    drawingPointsRef.current = [];
    setDrawingPoints([]);
    setPendingZonePoly(null);
    setShowZoneNameModal(false);
    setMode("place");
  }

  // ── Context Menu triggers & Automation Placement ──────────────────────────
  const onContextMenu = useCallback(e => {
    e.preventDefault();
    const p = toImg(e.clientX, e.clientY);
    const clickedZone = zonesRef.current.find(
      z => z.polygon?.length >= 3 && pointInPolygon(p.x, p.y, z.polygon)
    );
    if (clickedZone) {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        zone: clickedZone
      });
    } else {
      setContextMenu(null);
    }
  }, []);

  const onSidebarZoneContextMenu = useCallback((e, zone) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      zone
    });
  }, []);

  const handleAutomateClick = (zone) => {
    setAutomationZone(zone);
    setShowAutomationModal(true);
    setContextMenu(null);
  };

  const getCameraForType = useCallback((type) => {
    const models = cameraDBRef.current.filter(c => c.type === type);
    if (!models.length) return null;
    return [...models].sort((a, b) => (b.megapixels || 0) - (a.megapixels || 0) || (b.rangeDay || 0) - (a.rangeDay || 0))[0];
  }, []);

  const handleAutomatePlacement = useCallback((zoneId, selectedInputs) => {
    const zone = zonesRef.current.find(z => z.id === zoneId);
    if (!zone) return;

    recordState();

    const models = selectedInputs
      .map(input => {
        if (typeof input === "string") {
          return getCameraForType(input);
        }
        return input; // Already a full camera model object
      })
      .filter(Boolean);

    if (models.length === 0) {
      alert("No camera models found in the database for the selected types.");
      return;
    }

    const poly = zone.polygon;
    const n = poly.length;
    if (n < 3) return;

    // Centroid (Center of the zone)
    let Cx = 0, Cy = 0;
    poly.forEach(p => { Cx += p.x; Cy += p.y; });
    Cx /= n;
    Cy /= n;

    const activePpm = Math.max(1, ppmRef.current || 22);

    // Calculate real-world metrics using visual tape calibration (ppm)
    let maxDistPx = 0;
    poly.forEach(vertex => {
      const d = Math.hypot(Cx - vertex.x, Cy - vertex.y);
      if (d > maxDistPx) maxDistPx = d;
    });
    const maxDistMeters = maxDistPx / activePpm;
    const areaMeters = getPolygonArea(poly, activePpm);

    const newPlaced = [];

    // 1. Fisheye / PTZ Smart Grid Distribution Check
    const fisheyeModel = models.find(m => m.type === "fisheye");
    const ptzModel = models.find(m => m.type === "ptz");
    const centerModel = fisheyeModel || ptzModel;

    const cornerModels = models.filter(m => m.type !== "fisheye" && m.type !== "ptz");
    const only360Selected = centerModel && cornerModels.length === 0;

    if (only360Selected) {
      if (centerModel.rangeDay >= maxDistMeters) {
        // If a single central Fisheye or PTZ covers the furthest corner, place just one
        newPlaced.push({
          id: `placed_${Date.now()}_center_${Math.random().toString(36).substr(2, 5)}`,
          camera: centerModel,
          x: Cx,
          y: Cy,
          direction: 0,
          recordingMode: "continuous",
          fps: 25,
          lighting: "normal",
          mounting: "default",
          includeBackbox: false,
          includePoe: false,
        });
      } else {
        // Multi-Fisheye Ceiling Grid Distribution: Place multiple 360° cameras evenly along the centerline/grid
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        poly.forEach(p => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });

        const W_px = maxX - minX;
        const H_px = maxY - minY;
        const W_m = W_px / activePpm;
        const H_m = H_px / activePpm;

        // Overlap coverage circles by 20% to guarantee full coverage
        const coverDiameter = centerModel.rangeDay * 1.6;
        const cols = Math.max(1, Math.ceil(W_m / coverDiameter));
        const rows = Math.max(1, Math.ceil(H_m / coverDiameter));

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const gridX = minX + ((c + 0.5) / cols) * W_px;
            const gridY = minY + ((r + 0.5) / rows) * H_px;

            if (pointInPolygon(gridX, gridY, poly)) {
              newPlaced.push({
                id: `placed_${Date.now()}_dist_${r}_${c}_${Math.random().toString(36).substr(2, 5)}`,
                camera: centerModel,
                x: gridX,
                y: gridY,
                direction: 0,
                recordingMode: "continuous",
                fps: 25,
                lighting: "normal",
                mounting: "default",
                includeBackbox: false,
                includePoe: false,
              });
            } else {
              // Find the closest point inside the polygon (useful for complex/L-shaped spaces)
              let bestPt = { x: Cx, y: Cy };
              let minPtDist = Infinity;
              for (let sx = minX; sx <= maxX; sx += W_px / 12) {
                for (let sy = minY; sy <= maxY; sy += H_px / 12) {
                  if (pointInPolygon(sx, sy, poly)) {
                    const d = Math.hypot(sx - gridX, sy - gridY);
                    if (d < minPtDist) {
                      minPtDist = d;
                      bestPt = { x: sx, y: sy };
                    }
                  }
                }
              }
              newPlaced.push({
                id: `placed_${Date.now()}_dist_${r}_${c}_${Math.random().toString(36).substr(2, 5)}`,
                camera: centerModel,
                x: bestPt.x,
                y: bestPt.y,
                direction: 0,
                recordingMode: "continuous",
                fps: 25,
                lighting: "normal",
                mounting: "default",
                includeBackbox: false,
                includePoe: false,
              });
            }
          }
        }
      }

      const outsideCameras = placedRef.current.filter(
        p => !pointInOrOnPolygon(p.x, p.y, zone.polygon)
      );
      const updatedPlaced = [...outsideCameras, ...newPlaced];
      placedRef.current = updatedPlaced;
      setPlaced(updatedPlaced);
      draw();
      apiSaveLayout({ placed: updatedPlaced, zones: zonesRef.current, ppm: ppmRef.current });
      return;
    }

    // 2. Smart Corner Placement for Directional Cameras (Dome/Bullet)
    const placementModels = cornerModels.length > 0 ? cornerModels : models;

     // Determine corner coverage indices based on room shape and area
     const cornersToPlace = [];
     const sampleCorner = placementModels[0];
     const rangeLimit = sampleCorner?.rangeDay || 20;

     if (n === 4 && (areaMeters < 350 || maxDistMeters * 2 < rangeLimit * 1.5)) {
       // Rectangular/square rooms: 2 diagonal corners are mathematically and practically sufficient
       cornersToPlace.push(0, 2);
     } else if (n === 3 && (areaMeters < 150 || maxDistMeters * 2 < rangeLimit * 1.5)) {
       // Triangular rooms: 2 corners are fully sufficient
       cornersToPlace.push(0, 2);
     } else {
       // Large or complex polygons: place on all corners
       for (let i = 0; i < n; i++) {
         cornersToPlace.push(i);
       }
     }

    // Check if room center is out of reach of the standard cameras (to flag central fallback)
    let centerOutOfReach = false;
    const sampleCornerModel = placementModels[0];
    const maxCoverageDistPx = (sampleCornerModel?.rangeDay || 20) * activePpm;

    poly.forEach((vertex, i) => {
      // Skip if this corner is not selected by our smart optimizer
      if (!cornersToPlace.includes(i)) return;

      const model = placementModels[i % placementModels.length];
      const distToCenterPx = Math.hypot(Cx - vertex.x, Cy - vertex.y);
      const distToCenterMeters = distToCenterPx / activePpm;

      if (distToCenterPx > maxCoverageDistPx) {
        centerOutOfReach = true;
      }

      // If a center camera was placed and covers this corner, skip placing a redundant corner camera
      if (centerModel && distToCenterMeters <= centerModel.rangeDay) {
        return;
      }

      // Check if this corner is already covered by an already placed directional corner camera
      let alreadyCovered = false;
      for (const p of newPlaced) {
        // Skip checking against the center camera since we already handled center-to-corner range above
        if (p.id.includes("_center")) continue;
        const distMeters = Math.hypot(vertex.x - p.x, vertex.y - p.y) / activePpm;
        // If a camera is already placed within 45% of this camera's range or within 8 meters, skip placing another
        if (distMeters < Math.max(8, model.rangeDay * 0.45)) {
          alreadyCovered = true;
          break;
        }
      }
      if (alreadyCovered) return;

      // Calculate perfect interior angle bisector pointing inwards
      const prev = poly[(i - 1 + n) % n];
      const next = poly[(i + 1) % n];

      // Vector 1 (from vertex to prev)
      const dx1 = prev.x - vertex.x;
      const dy1 = prev.y - vertex.y;
      const len1 = Math.hypot(dx1, dy1) || 1;
      const ux1 = dx1 / len1;
      const uy1 = dy1 / len1;

      // Vector 2 (from vertex to next)
      const dx2 = next.x - vertex.x;
      const dy2 = next.y - vertex.y;
      const len2 = Math.hypot(dx2, dy2) || 1;
      const ux2 = dx2 / len2;
      const uy2 = dy2 / len2;

      // Bisector vector (middle direction)
      let bx = ux1 + ux2;
      let by = uy1 + uy2;
      let lenB = Math.hypot(bx, by);

      // If collinear, point perpendicular to wall
      if (lenB < 0.01) {
        bx = -uy1;
        by = ux1;
        lenB = 1;
      }

      let ux = bx / lenB;
      let uy = by / lenB;

      // Ensure the bisector vector points inwards towards the centroid
      const dotVal = ux * (Cx - vertex.x) + uy * (Cy - vertex.y);
      if (dotVal < 0) {
        ux = -ux;
        uy = -uy;
      }

      const angleRad = Math.atan2(uy, ux);
      const direction = (angleRad * 180 / Math.PI + 360) % 360;

      newPlaced.push({
        id: `placed_${Date.now()}_corner_${i}_${Math.random().toString(36).substr(2, 5)}`,
        camera: model,
        x: vertex.x,
        y: vertex.y,
        direction: direction,
        recordingMode: "continuous",
        fps: 25,
        lighting: "normal",
        mounting: "default",
        includeBackbox: false,
        includePoe: false,
      });

      // 3. Smart Edge Midpoint (placed only if wall segment is longer than 75% of camera range)
      const nextVertex = poly[(i + 1) % n];
      const distPx = Math.hypot(nextVertex.x - vertex.x, nextVertex.y - vertex.y);
      if (distPx > maxCoverageDistPx * 0.75) {
        const Mx = (vertex.x + nextVertex.x) / 2;
        const My = (vertex.y + nextVertex.y) / 2;

        const dx = nextVertex.x - vertex.x;
        const dy = nextVertex.y - vertex.y;

        const nx1 = -dy;
        const ny1 = dx;
        const dot = (Cx - Mx) * nx1 + (Cy - My) * ny1;

        const nx = dot > 0 ? nx1 : -nx1;
        const ny = dot > 0 ? ny1 : -ny1;

        const angleNormal = Math.atan2(ny, nx);
        const dirNormal = (angleNormal * 180 / Math.PI + 360) % 360;

        newPlaced.push({
          id: `placed_${Date.now()}_edge_${i}_${Math.random().toString(36).substr(2, 5)}`,
          camera: placementModels[(i + 1) % placementModels.length],
          x: Mx,
          y: My,
          direction: dirNormal,
          recordingMode: "continuous",
          fps: 25,
          lighting: "normal",
          mounting: "default",
          includeBackbox: false,
          includePoe: false,
        });
      }
    });

    // Outside cameras retention check and save
    const outsideCameras = placedRef.current.filter(
      p => !pointInOrOnPolygon(p.x, p.y, zone.polygon)
    );

    const updatedPlaced = [...outsideCameras, ...newPlaced];

    placedRef.current = updatedPlaced;
    setPlaced(updatedPlaced);
    draw();
    apiSaveLayout({ placed: updatedPlaced, zones: zonesRef.current, ppm: ppmRef.current });
  }, [draw, getCameraForType]);

  // ── Mouse events ──────────────────────────────────────────────────────────
  const onMouseDown = useCallback(e => {
    if (e.button === 2) return;
    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    const p = toImg(e.clientX, e.clientY);

    // Check if clicked on a text node
    const cvs = canvasRef.current;
    if (cvs) {
      const ctx = cvs.getContext('2d');
      for (let i = textNodesRef.current.length - 1; i >= 0; i--) {
        const node = textNodesRef.current[i];
        ctx.save();
        ctx.font = `bold ${node.size}px "${node.font}", sans-serif`;
        const metrics = ctx.measureText(node.text);
        ctx.restore();
        const w = metrics.width;
        const h = node.size;

        const sc = scaleRef.current;
        const cx = node.x + w + 10 / sc;
        const cy = node.y - 4 / sc;
        const r = 10 / sc; // slight padding for click target

        const isSelectedOrEditing = selectedTextNodeRef.current === node.id || editingTextNodeRef.current === node.id;
        if (isSelectedOrEditing && Math.hypot(p.x - cx, p.y - cy) <= r) {
          // Clicked close button
          recordState();
          const updated = textNodesRef.current.filter(n => n.id !== node.id);
          textNodesRef.current = updated;
          setTextNodes(updated);
          draw();
          return;
        }

        // Text is drawn with textBaseline="top"
        if (p.x >= node.x && p.x <= node.x + w && p.y >= node.y && p.y <= node.y + h) {
          recordState();
          draggingTextNodeIdRef.current = node.id;
          draggingTextStartRef.current = { offsetX: p.x - node.x, offsetY: p.y - node.y };
          setSelectedTextNode(node.id);
          draw();
          return;
        }
      }
    }

    setSelectedTextNode(null);

    if (modeRef.current === "crop") {
      cropStartRef.current = p;
      cropEndRef.current = null;
      setHasCropSelection(false);
      return;
    }

    if (modeRef.current === "calibrate") {
      // 1. Check if clicking endpoints of existing calibration references
      for (const r of calibRefsRef.current) {
        const sDist = Math.hypot(p.x - r.start.x, p.y - r.start.y);
        if (sDist < 18 / scaleRef.current) {
          calibHandleDragRef.current = { refId: r.id, handle: "start" };
          setCalibHandleDrag({ refId: r.id, handle: "start" });
          setActiveCalibRefId(r.id);
          activeCalibRefIdRef.current = r.id;
          return;
        }
        const eDist = Math.hypot(p.x - r.end.x, p.y - r.end.y);
        if (eDist < 18 / scaleRef.current) {
          calibHandleDragRef.current = { refId: r.id, handle: "end" };
          setCalibHandleDrag({ refId: r.id, handle: "end" });
          setActiveCalibRefId(r.id);
          activeCalibRefIdRef.current = r.id;
          return;
        }
      }

      // 2. Check if clicking along the line segment to select it
      for (const r of calibRefsRef.current) {
        const x1 = r.start.x, y1 = r.start.y, x2 = r.end.x, y2 = r.end.y;
        const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
        let dist = 999;
        if (l2 === 0) {
          dist = Math.hypot(p.x - x1, p.y - y1);
        } else {
          let t = ((p.x - x1) * (x2 - x1) + (p.y - y1) * (y2 - y1)) / l2;
          t = Math.max(0, Math.min(1, t));
          dist = Math.hypot(p.x - (x1 + t * (x2 - x1)), p.y - (y1 + t * (y2 - y1)));
        }
        if (dist < 14 / scaleRef.current) {
          setActiveCalibRefId(r.id);
          activeCalibRefIdRef.current = r.id;
          setCalibPanelOpen(true);
          return;
        }
      }

      // 3. Otherwise start drawing a new reference line
      const newLine = { start: p, end: p };
      drawingCalibLineRef.current = newLine;
      setDrawingCalibLine(newLine);
      return;
    }

    if (modeRef.current === "zone") {
      const pts = drawingPointsRef.current;
      if (pts.length >= 3 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < 20 / scaleRef.current) {
        finishZoneDrawing(pts); return;
      }
      const updated = [...pts, p];
      drawingPointsRef.current = updated; setDrawingPoints(updated); draw(); return;
    }

    if ((modeRef.current === "pan" || e.button === 1 || e.button === 2) && !isPanLockedRef.current) {
      panStartRef.current = { mx: e.clientX - offsetRef.current.x, my: e.clientY - offsetRef.current.y };
      return;
    }
    if (isPanLockedRef.current) {
      panStartRef.current = null;
    }

    if (nearRotHandle(p.x, p.y)) { recordState(); rotatingIdxRef.current = selectedIdx; return; }

    // Check if clicked near a vertex of an editing zone to start dragging it
    if (editZoneIdRef.current) {
      const grabRadius = 16 / scaleRef.current;
      const zone = zonesRef.current.find(z => z.id === editZoneIdRef.current);
      if (zone && zone.polygon) {
        for (let i = 0; i < zone.polygon.length; i++) {
          const pt = zone.polygon[i];
          if (Math.hypot(p.x - pt.x, p.y - pt.y) < grabRadius) {
            recordState();
            draggingVertexRef.current = { zoneId: zone.id, index: i };
            return;
          }
        }
        
        // If not a vertex, check if clicked inside the zone to move it entirely
        if (pointInPolygon(p.x, p.y, zone.polygon)) {
          recordState();
          draggingZoneRef.current = { id: zone.id, startX: p.x, startY: p.y, initialPolygon: JSON.parse(JSON.stringify(zone.polygon)) };
          return;
        }
      }
    }

    // Check if clicked near a vertex of a draft zone to start dragging it
    if (draftZonesRef.current.length > 0) {
      const grabRadius = 12 / scaleRef.current;
      let foundZoneId = null;
      let foundVertexIdx = null;
      for (const zone of draftZonesRef.current) {
        if (!zone.polygon) continue;
        for (let i = 0; i < zone.polygon.length; i++) {
          const pt = zone.polygon[i];
          if (Math.hypot(p.x - pt.x, p.y - pt.y) < grabRadius) {
            foundZoneId = zone.id;
            foundVertexIdx = i;
            break;
          }
        }
        if (foundZoneId !== null) break;
      }
      if (foundZoneId !== null) {
        draggingDraftZoneIdRef.current = foundZoneId;
        draggingDraftVertexIdxRef.current = foundVertexIdx;
        return;
      }
    }

    // Check if clicking on a camera label → start label drag
    const labelIdx = nearestLabel(p.x, p.y);
    if (labelIdx >= 0) {
      recordState();
      draggingLabelIdxRef.current = labelIdx;
      const cam = placedRef.current[labelIdx];
      const lo = cam.labelOffset || { dx: 0, dy: 0 };
      labelDragStartRef.current = { mx: p.x, my: p.y, initialDx: lo.dx, initialDy: lo.dy };
      setSelectedIdx(labelIdx);
      return;
    }

    const idx = nearestPlaced(p.x, p.y);
    if (idx >= 0) {
      recordState();
      setSelectedIdx(idx);
      draggingIdxRef.current = idx;
      const cam = placedRef.current[idx];
      draggingCamZoneRef.current = zonesRef.current.find(
        z => z.polygon?.length >= 3 && pointInPolygon(cam.x, cam.y, z.polygon)
      ) || null;
      return;
    }
    setSelectedIdx(null);
    setActiveZoneId(null);
    activeZoneIdRef.current = null;
    setHighlightedCamId(null);

    // Check if clicked inside a draft (CV-detected) zone
    if (draftZonesRef.current.length > 0) {
      const clickedDraft = draftZonesRef.current.find(
        z => z.polygon?.length >= 3 && pointInPolygon(p.x, p.y, z.polygon)
      );
      if (clickedDraft) {
        showConfirm("Import Zone", `Import auto-detected "${clickedDraft.name}"?`, () => {
          recordState();
          const updatedDrafts = draftZonesRef.current.filter(z => z.id !== clickedDraft.id);
          setDraftZones(updatedDrafts);
          draftZonesRef.current = updatedDrafts;

          const colorIdx = zonesRef.current.length % ZONE_COLORS.length;
          const newImportedZone = {
            ...clickedDraft,
            id: "zone_" + Date.now(),
            color: ZONE_COLORS[colorIdx]
          };
          const updatedZones = [...zonesRef.current, newImportedZone];
          zonesRef.current = updatedZones;
          setZones(updatedZones);
          setActiveZoneId(newImportedZone.id);
          activeZoneIdRef.current = newImportedZone.id;
          apiSaveZones(updatedZones);
          setTimeout(() => zoomToZone(newImportedZone), 0);
          draw();
        });
        return;
      }
    }
  }, [selectedIdx, finishZoneDrawing, draw, draftZones, showConfirm, recordState]); // eslint-disable-line



  const onMouseMove = useCallback(e => {
    const p = toImg(e.clientX, e.clientY);
    setMouseMapPos(p);
    mouseMapPosRef.current = p;

    if (modeRef.current === "crop" && cropStartRef.current && mouseDownPosRef.current) {
      cropEndRef.current = p;
      draw();
      return;
    }

    if (modeRef.current === "calibrate") {
      if (calibHandleDragRef.current) {
        const { refId, handle } = calibHandleDragRef.current;
        const updated = calibRefsRef.current.map(r => {
          if (r.id !== refId) return r;
          const next = { ...r };
          if (handle === "start") next.start = p;
          else next.end = p;
          next.pixelDistance = getPixelDistance(next.start, next.end);
          return next;
        });
        calibRefsRef.current = updated;
        setCalibRefs(updated);
        return;
      }
      if (drawingCalibLineRef.current) {
        const updatedLine = { ...drawingCalibLineRef.current, end: p };
        drawingCalibLineRef.current = updatedLine;
        setDrawingCalibLine(updatedLine);
        return;
      }
      return;
    }

    if (draggingTextNodeIdRef.current !== null && draggingTextStartRef.current !== null) {
      const idx = textNodesRef.current.findIndex(n => n.id === draggingTextNodeIdRef.current);
      if (idx !== -1) {
        const updated = [...textNodesRef.current];
        updated[idx] = {
          ...updated[idx],
          x: p.x - draggingTextStartRef.current.offsetX,
          y: p.y - draggingTextStartRef.current.offsetY
        };
        textNodesRef.current = updated;
        setTextNodes(updated);
        draw();
      }
      return;
    }

    if (draggingVertexRef.current !== null) {
      const { zoneId, index } = draggingVertexRef.current;
      const updatedZones = zonesRef.current.map(zone => {
        if (zone.id === zoneId) {
          const newPolygon = [...zone.polygon];
          newPolygon[index] = { x: p.x, y: p.y };
          return { ...zone, polygon: newPolygon };
        }
        return zone;
      });
      zonesRef.current = updatedZones;
      setZones(updatedZones);
      draw();
      return;
    }

    if (draggingZoneRef.current !== null) {
      const { id, startX, startY, initialPolygon } = draggingZoneRef.current;
      const dx = p.x - startX;
      const dy = p.y - startY;
      const updatedZones = zonesRef.current.map(zone => {
        if (zone.id === id) {
          return { ...zone, polygon: initialPolygon.map(pt => ({ x: pt.x + dx, y: pt.y + dy })) };
        }
        return zone;
      });
      zonesRef.current = updatedZones;
      setZones(updatedZones);
      draw();
      return;
    }

    if (draggingDraftZoneIdRef.current !== null && draggingDraftVertexIdxRef.current !== null) {
      const zoneId = draggingDraftZoneIdRef.current;
      const vertexIdx = draggingDraftVertexIdxRef.current;
      const updatedDrafts = draftZonesRef.current.map(zone => {
        if (zone.id === zoneId) {
          const newPolygon = [...zone.polygon];
          newPolygon[vertexIdx] = { x: p.x, y: p.y };
          return { ...zone, polygon: newPolygon };
        }
        return zone;
      });
      draftZonesRef.current = updatedDrafts;
      setDraftZones(updatedDrafts);
      draw();
      return;
    }

    if (modeRef.current === "calibrate") {
      draw();
      return;
    }

    if (panStartRef.current) {
      if (isPanLockedRef.current) {
        panStartRef.current = null;
      } else {
        offsetRef.current = { x: e.clientX - panStartRef.current.mx, y: e.clientY - panStartRef.current.my };
        draw(); return;
      }
    }

    if (rotatingIdxRef.current !== null) {
      const idx = rotatingIdxRef.current;
      const cam = placedRef.current[idx]; if (!cam) return;
      const deg = (Math.atan2(p.y - cam.y, p.x - cam.x) * (180 / Math.PI) + 360) % 360;
      const updated = [...placedRef.current];
      updated[idx] = { ...updated[idx], direction: deg };
      placedRef.current = updated; setPlaced([...updated]); draw(); return;
    }

    // ── Label dragging ────────────────────────────────────────────────────────
    if (draggingLabelIdxRef.current !== null && labelDragStartRef.current) {
      const idx = draggingLabelIdxRef.current;
      const start = labelDragStartRef.current;
      const newDx = start.initialDx + (p.x - start.mx);
      const newDy = start.initialDy + (p.y - start.my);
      const updated = [...placedRef.current];
      updated[idx] = { ...updated[idx], labelOffset: { dx: newDx, dy: newDy } };
      placedRef.current = updated; setPlaced([...updated]); draw(); return;
    }

    if (draggingIdxRef.current !== null) {
      const activeZone = activeZoneIdRef.current
        ? zonesRef.current.find(z => z.id === activeZoneIdRef.current)
        : null;
      const constraintZone = activeZone || draggingCamZoneRef.current;

      if (constraintZone && constraintZone.polygon.length >= 3) {
        if (!pointInPolygon(p.x, p.y, constraintZone.polygon)) return;
      }

      const updated = [...placedRef.current];
      updated[draggingIdxRef.current] = { ...updated[draggingIdxRef.current], x: p.x, y: p.y };
      placedRef.current = updated; setPlaced([...updated]); draw(); return;
    }

    const idx = nearestPlaced(p.x, p.y);
    if (idx !== hoveredIdx) { setHoveredIdx(idx >= 0 ? idx : null); }
    draw();

    // Update cursor style
    if (modeRef.current !== "pan") {
      let cursor = "crosshair";
      // Check if hovering over a camera label
      if (nearestLabel(p.x, p.y) >= 0) {
        cursor = "grab";
      } else if (draftZonesRef.current.length > 0 || editZoneIdRef.current) {
        const grabRadius = 16 / scaleRef.current;
        let nearVertex = false;
        if (editZoneIdRef.current) {
          const zone = zonesRef.current.find(z => z.id === editZoneIdRef.current);
          if (zone && zone.polygon) {
            for (const pt of zone.polygon) {
              if (Math.hypot(p.x - pt.x, p.y - pt.y) < grabRadius) { nearVertex = true; break; }
            }
          }
        }
        if (!nearVertex && draftZonesRef.current.length > 0) {
          const draftGrabRadius = 12 / scaleRef.current;
          for (const zone of draftZonesRef.current) {
            if (!zone.polygon) continue;
            for (const pt of zone.polygon) {
              if (Math.hypot(p.x - pt.x, p.y - pt.y) < draftGrabRadius) { nearVertex = true; break; }
            }
            if (nearVertex) break;
          }
        }
        if (nearVertex) {
          cursor = "move";
        }
      }
      if (draggingLabelIdxRef.current !== null) {
        cursor = "grabbing";
      }
      if (e.target) {
        e.target.style.cursor = cursor;
      }
    }
  }, [draw, hoveredIdx]); // eslint-disable-line

  const onMouseUp = useCallback(() => {
    if (modeRef.current === "calibrate") {
      if (calibHandleDragRef.current) {
        calibHandleDragRef.current = null;
        setCalibHandleDrag(null);
        return;
      }
      if (drawingCalibLineRef.current) {
        const curLine = drawingCalibLineRef.current;
        const dPx = getPixelDistance(curLine.start, curLine.end);
        if (dPx >= 8) {
          const newRef = {
            id: "ref_" + Date.now(),
            start: curLine.start,
            end: curLine.end,
            pixelDistance: dPx,
            realDistance: 10.0,
            unit: "meters",
            realDistanceMeters: 10.0,
          };
          let updatedRefs = [];
          if (calibTypeRef.current === "standard") {
            updatedRefs = [newRef];
          } else {
            updatedRefs = [...calibRefsRef.current, newRef];
          }
          calibRefsRef.current = updatedRefs;
          setCalibRefs(updatedRefs);
          setActiveCalibRefId(newRef.id);
          activeCalibRefIdRef.current = newRef.id;
        }
        drawingCalibLineRef.current = null;
        setDrawingCalibLine(null);
        return;
      }
      return;
    }

    if (modeRef.current === "crop" && cropStartRef.current && cropEndRef.current) {
      setHasCropSelection(true);
      mouseDownPosRef.current = null;
      return;
    }

    const wasDragging = draggingIdxRef.current !== null;
    const wasRotating = rotatingIdxRef.current !== null;
    const wasDraggingLabel = draggingLabelIdxRef.current !== null;
    const wasDraggingVertex = draggingVertexRef.current !== null;
    const wasDraggingZone = draggingZoneRef.current !== null;
    draggingIdxRef.current = null;
    rotatingIdxRef.current = null;
    draggingLabelIdxRef.current = null;
    draggingVertexRef.current = null;
    draggingZoneRef.current = null;
    labelDragStartRef.current = null;
    panStartRef.current = null;
    mouseDownPosRef.current = null;
    draggingCamZoneRef.current = null;
    draggingDraftZoneIdRef.current = null;
    draggingDraftVertexIdxRef.current = null;
    draggingTextNodeIdRef.current = null;
    draggingTextStartRef.current = null;
    if (wasDragging || wasRotating || wasDraggingLabel || wasDraggingVertex || wasDraggingZone) {
      scheduleSave(placedRef.current, zonesRef.current, ppmRef.current);
    }
  }, [scheduleSave]);

  // ── Double-click on label to reset position ────────────────────────────────
  const onDoubleClick = useCallback(e => {
    const p = toImg(e.clientX, e.clientY);

    // Check if double-clicked on a text node
    const cvs = canvasRef.current;
    if (cvs) {
      const ctx = cvs.getContext('2d');
      for (let i = textNodesRef.current.length - 1; i >= 0; i--) {
        const node = textNodesRef.current[i];
        ctx.save();
        ctx.font = `bold ${node.size}px "${node.font}", sans-serif`;
        const metrics = ctx.measureText(node.text);
        ctx.restore();
        const w = metrics.width;
        const h = node.size;
        if (p.x >= node.x && p.x <= node.x + w && p.y >= node.y && p.y <= node.y + h) {
          setEditingTextNode(node.id);
          setSelectedTextNode(node.id);
          return;
        }
      }
    }

    const labelIdx = nearestLabel(p.x, p.y);
    if (labelIdx >= 0) {
      const cam = placedRef.current[labelIdx];
      if (cam.labelOffset && (cam.labelOffset.dx !== 0 || cam.labelOffset.dy !== 0)) {
        const updated = [...placedRef.current];
        updated[labelIdx] = { ...updated[labelIdx], labelOffset: { dx: 0, dy: 0 } };
        placedRef.current = updated;
        setPlaced([...updated]);
        draw();
        scheduleSave(placedRef.current, zonesRef.current, ppmRef.current);
      }
    }
  }, [draw, scheduleSave]); // eslint-disable-line

  // ── Drag-and-drop onto canvas ─────────────────────────────────────────────
  const onDrop = useCallback(e => {
    e.preventDefault();
    const cameraId = e.dataTransfer.getData("cameraId");
    const camera = cameraDBRef.current.find(c => c.id === cameraId);
    if (!camera) return;
    const p = toImg(e.clientX, e.clientY);

    if (activeZoneIdRef.current) {
      const zone = zonesRef.current.find(z => z.id === activeZoneIdRef.current);
      if (zone && zone.polygon.length >= 3 && !pointInPolygon(p.x, p.y, zone.polygon)) {
        alert(`Camera must be placed inside zone "${zone.name}"`);
        return;
      }
    }

    recordState();

    const newEntry = {
      camera,
      x: p.x,
      y: p.y,
      direction: 0,
      id: `placed_${Date.now()}`,
      recordingMode: "continuous",
      fps: 25,
      lighting: "normal",
      mounting: "default",
      includeBackbox: false,
      includePoe: false,
    };
    const updated = [...placedRef.current, newEntry];
    placedRef.current = updated;
    setPlaced(updated);
    setSelectedIdx(updated.length - 1);
    draw();
    apiSaveLayout({ placed: updated, zones: zonesRef.current, ppm: ppmRef.current });
  }, [draw]); // eslint-disable-line

  // ── Floor plan import ─────────────────────────────────────────────────────
  async function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return;
    const name = file.name.replace(/\.[^/.]+$/, "");
    const ext = file.name.toLowerCase().split(".").pop();

    // ── .gltf / .glb → load 3D model and auto-calibrate scale (PPM) ─────
    if (ext === "gltf" || ext === "glb") {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const modelDataUrl = ev.target.result;
        try {
          const { dataUrl: imageDataUrl, ppm: autoPpm, partsReport, embeddedMarkers, width, height } = await renderGltfToImage(file);
          console.log(`[DesignerView] Loaded GLB model. Auto-calibrated PPM: ${autoPpm}`);

          let restoredPlaced = [];
          if (embeddedMarkers && embeddedMarkers.length > 0) {
            restoredPlaced = embeddedMarkers.map(m => {
              const camObj = m.camera || cameraDBRef.current.find(c => c.id === m.camId) || {
                id: m.camId || `cam_${Date.now()}`,
                model: m.camName || "Camera",
                brand: m.camera?.brand || "Auto",
                type: m.camera?.type || "dome",
                hfov: m.fovAngle || 60,
                rangeDay: 30,
                megapixels: 4
              };
              return {
                id: m.id || `placed_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                camera: camObj,
                customName: m.camName || camObj.model,
                x: m.x,
                y: m.y,
                direction: m.direction || 0,
                recordingMode: "continuous",
                fps: 25,
                lighting: "normal",
                mounting: "default",
                includeBackbox: false,
                includePoe: false
              };
            });
          }

          loadOrUpdateSlide(imageDataUrl, name, {
            modelDataUrl,
            autoPpm: autoPpm || PIXELS_PER_METRE,
            imageWidth: width || 2048,
            imageHeight: height || 2048,
            partsReport,
            embeddedPlaced: restoredPlaced
          });
        } catch (err) {
          console.error("[DesignerView] GLTF/GLB load failed:", err);
          alert("Failed to load 3D model: " + (err.message || "unknown error"));
        }
      };
      reader.readAsDataURL(file);
      e.target.value = "";
      return;
    }

    // ── .html → render HTML to 2D image ───────────────────────────
    if (ext === "html" || ext === "htm") {
      try {
        const { dataUrl } = await renderHtmlToImage(file);
        loadOrUpdateSlide(dataUrl, name);
      } catch (err) {
        console.error("[DesignerView] HTML render failed:", err);
        alert("Failed to load HTML floor plan: " + (err.message || "unknown error"));
      }
      e.target.value = "";
      return;
    }

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      const fileReader = new FileReader();
      fileReader.onload = async function() {
        try {
          const typedarray = new Uint8Array(this.result);
          const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 6.0 });
         
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          canvas.height = viewport.height;
          canvas.width = viewport.width;
         
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
         
          await page.render({ canvasContext: context, viewport: viewport }).promise;
          const dataUrl = canvas.toDataURL("image/png");
          loadOrUpdateSlide(dataUrl, name);
        } catch (err) {
          console.error("Failed to parse PDF", err);
          alert("Failed to parse PDF.");
        }
      };
      fileReader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = ev => {
        loadOrUpdateSlide(ev.target.result, name);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  }

  const applyCrop = useCallback(() => {
    if (!cropStartRef.current || !cropEndRef.current || !floorImgRef.current) return;
    const cx = Math.min(cropStartRef.current.x, cropEndRef.current.x);
    const cy = Math.min(cropStartRef.current.y, cropEndRef.current.y);
    const cw = Math.abs(cropStartRef.current.x - cropEndRef.current.x);
    const ch = Math.abs(cropStartRef.current.y - cropEndRef.current.y);

    if (cw < 10 || ch < 10) return;

    recordState();

    const cCanvas = document.createElement("canvas");
    cCanvas.width = cw;
    cCanvas.height = ch;
    const cCtx = cCanvas.getContext("2d");
    cCtx.drawImage(floorImgRef.current, cx, cy, cw, ch, 0, 0, cw, ch);
    const croppedDataUrl = cCanvas.toDataURL("image/png");

    const updatedPlaced = placedRef.current.map(p => ({ ...p, x: p.x - cx, y: p.y - cy }));
    const updatedZones = zonesRef.current.map(z => ({ ...z, polygon: z.polygon.map(pt => ({ x: pt.x - cx, y: pt.y - cy })) }));

    placedRef.current = updatedPlaced;
    setPlaced(updatedPlaced);
    zonesRef.current = updatedZones;
    setZones(updatedZones);
   
    const cImg = new Image();
    cImg.onload = () => {
      floorImgRef.current = cImg;
      const activeSlideIdx = slidesRef.current.findIndex(s => s.id === activeSlideIdRef.current);
      if (activeSlideIdx >= 0 && activeSlideIdx < slidesRef.current.length) {
        const slides = [...slidesRef.current];
        slides[activeSlideIdx] = { ...slides[activeSlideIdx], floorPlan: croppedDataUrl };
        slidesRef.current = slides;
        setSlides(slides);
      }
     
      cropStartRef.current = null;
      cropEndRef.current = null;
      setHasCropSelection(false);
      setMode("place");
      draw();
     
      apiSaveFloorPlan(croppedDataUrl);
      apiSaveZones(updatedZones);
      scheduleSave(updatedPlaced, updatedZones, ppmRef.current);
    };
    cImg.src = croppedDataUrl;
  }, [draw, recordState, scheduleSave]);

  // ── FIX 2: Remove floor plan — clears image and deletes from backend ──────
  function removeFloorPlan() {
    recordState();
    floorImgRef.current = null;
    setHasFloor(false);
    draw();
    
    const activeSlideIdx = slidesRef.current.findIndex(s => s.id === activeSlideIdRef.current);
    if (activeSlideIdx >= 0) {
      const updatedSlides = [...slidesRef.current];
      updatedSlides[activeSlideIdx] = { ...updatedSlides[activeSlideIdx], floorPlan: null };
      slidesRef.current = updatedSlides;
      setSlides(updatedSlides);
      scheduleSave(placedRef.current, zonesRef.current, ppmRef.current);
    }
    apiDeleteFloorPlan();
  }

  // ── Manual Save Layout (Versioned) ──────────────────────────────────────────
  function handleManualSave() {
    const activeSlideIdx = slidesRef.current.findIndex(s => s.id === activeSlideIdRef.current);
    if (activeSlideIdx < 0) return;
    
    const currentSlide = slidesRef.current[activeSlideIdx];
    const versions = currentSlide.versions || [];
    const currentPlaced = placedRef.current || [];
    
    let hasChanges = true;
    if (versions.length > 0) {
      const lastVersionPlaced = versions[versions.length - 1].placed || [];
      if (lastVersionPlaced.length === currentPlaced.length) {
        const lastIds = lastVersionPlaced.map(c => c.id).sort().join(',');
        const currIds = currentPlaced.map(c => c.id).sort().join(',');
        if (lastIds === currIds) {
          hasChanges = false;
        }
      }
    }
    
    if (hasChanges) {
      const newVersion = {
        id: "v_" + Date.now(),
        name: `v${versions.length + 1}`,
        timestamp: Date.now(),
        placed: JSON.parse(JSON.stringify(currentPlaced))
      };
      const updatedSlide = { ...currentSlide, versions: [...versions, newVersion] };
      const updatedSlides = [...slidesRef.current];
      updatedSlides[activeSlideIdx] = updatedSlide;
      slidesRef.current = updatedSlides;
      setSlides(updatedSlides);
      
      scheduleSave(placedRef.current, zonesRef.current, ppmRef.current);
      alert(`Saved ${newVersion.name}!`);
    } else {
      alert("No camera changes detected since last save.");
    }
  }

  function restoreVersion(slideId, versionId) {
    const slide = slidesRef.current.find(s => s.id === slideId);
    if (!slide || !slide.versions) return;
    const version = slide.versions.find(v => v.id === versionId);
    if (!version) return;
    
    if (activeSlideIdRef.current !== slideId) {
      switchSlide(slideId);
    }
    
    recordState(); 
    const restoredPlaced = JSON.parse(JSON.stringify(version.placed));
    placedRef.current = restoredPlaced;
    setPlaced(restoredPlaced);
    setSelectedIdx(null);
    setHighlightedCamId(null);
    highlightedCamIdRef.current = null;
    draw();
    
    scheduleSave(restoredPlaced, zonesRef.current, ppmRef.current);
  }

  function renameVersion(slideId, versionId, newName) {
    if (!newName.trim()) return;
    const activeSlideIdx = slidesRef.current.findIndex(s => s.id === slideId);
    if (activeSlideIdx < 0) return;
    
    const updatedSlides = [...slidesRef.current];
    const slide = { ...updatedSlides[activeSlideIdx] };
    if (!slide.versions) return;
    
    const vIdx = slide.versions.findIndex(v => v.id === versionId);
    if (vIdx < 0) return;
    
    const newVersions = [...slide.versions];
    newVersions[vIdx] = { ...newVersions[vIdx], name: newName.trim() };
    slide.versions = newVersions;
    updatedSlides[activeSlideIdx] = slide;
    
    slidesRef.current = updatedSlides;
    setSlides(updatedSlides);
    scheduleSave(placedRef.current, zonesRef.current, ppmRef.current);
  }

  function deleteVersion(slideId, versionId) {
    showConfirm(
      "Delete Version",
      "Are you sure you want to delete this version? This cannot be undone.",
      () => {
        const activeSlideIdx = slidesRef.current.findIndex(s => s.id === slideId);
        if (activeSlideIdx < 0) return;
        
        const updatedSlides = [...slidesRef.current];
        const slide = { ...updatedSlides[activeSlideIdx] };
        if (!slide.versions) return;
        
        slide.versions = slide.versions.filter(v => v.id !== versionId);
        updatedSlides[activeSlideIdx] = slide;
        
        slidesRef.current = updatedSlides;
        setSlides(updatedSlides);
        scheduleSave(placedRef.current, zonesRef.current, ppmRef.current);
      }
    );
  }

  // ── Clear all cameras from the floor (keeps floor plan image) ──────────────
  function clearFloorCameras() {
    showConfirm(
      "Clear Layout",
      "This will remove all placed cameras AND shapes from the floor. The floor plan image will be kept. Do you want to proceed?",
      () => {
        recordState();
        placedRef.current = [];
        setPlaced([]);
        setSelectedIdx(null);
        setHighlightedCamId(null);
        highlightedCamIdRef.current = null;
        // Also clear all shapes and zones
        const updatedZones = [];
        zonesRef.current = updatedZones;
        setZones(updatedZones);
        setActiveZoneId(null);
        activeZoneIdRef.current = null;
        draw();
        apiSaveLayout({ placed: [], zones: [], ppm: ppmRef.current });
        apiSaveZones([]);
      }
    );
  }

  function flipSelected() {
    if (selectedIdx === null) return;
    recordState();
    const updated = placedRef.current.map((cam, i) =>
      i === selectedIdx ? { ...cam, flip: !cam.flip, direction: (cam.direction + 180) % 360 } : cam
    );
    placedRef.current = updated;
    setPlaced(updated);
    draw();
    apiSaveLayout({ placed: updated, zones: zonesRef.current, ppm: ppmRef.current });
  }

  function removeSelected() {
    if (selectedIdx === null) return;
    recordState();
    const updated = placedRef.current.filter((_, i) => i !== selectedIdx);
    placedRef.current = updated; setPlaced(updated); setSelectedIdx(null); draw();
    apiSaveLayout({ placed: updated, zones: zonesRef.current, ppm: ppmRef.current });
  }

  // ── Zone sidebar handlers ─────────────────────────────────────────────────
  function handleSelectZone(zone) {
    const newId = activeZoneId === zone.id ? null : zone.id;
    setActiveZoneId(newId);
    activeZoneIdRef.current = newId;
    setHighlightedCamId(null);
    if (newId) {
      zoomToZone(zone);
    }
    draw();
  }

  function handleDeleteZone(id) {
    recordState();
    const updated = zonesRef.current.filter(z => z.id !== id);
    zonesRef.current = updated; setZones(updated);
    if (activeZoneId === id) { setActiveZoneId(null); activeZoneIdRef.current = null; }
    draw();
    apiDeleteZone(id);
  }

  function handleRenameZone(id, newName) {
    const zone = zonesRef.current.find(z => z.id === id);
    if (!zone) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    const exists = zonesRef.current.some(z => z.id !== id && z.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      alert("A zone with this name already exists.");
      return;
    }
    recordState();
    const updated = zonesRef.current.map(z => z.id === id ? { ...z, name: trimmed } : z);
    setZones(updated);
    zonesRef.current = updated;
    apiSaveZones(updated);
    draw();
  }

  function handleHighlightCam(camId) {
    const newId = highlightedCamId === camId ? null : camId;
    setHighlightedCamId(newId);
    highlightedCamIdRef.current = newId;
    if (newId) {
      zoomToCamera(newId);
      const idx = placedRef.current.findIndex(p => p.id === newId);
      if (idx !== -1) {
        setSelectedIdx(idx);
        setSelectedModel(null);
      }
    } else {
      setSelectedIdx(null);
      setSelectedModel(null);
    }
    draw();
  }

  function handleRemoveCamFromZone(camId) {
    recordState();
    const updated = placedRef.current.filter(p => p.id !== camId);
    placedRef.current = updated; setPlaced(updated);
    if (highlightedCamId === camId) { setHighlightedCamId(null); highlightedCamIdRef.current = null; }
    if (selectedIdx !== null) setSelectedIdx(null);
    draw();
    apiSaveLayout({ placed: updated, zones: zonesRef.current, ppm: ppmRef.current });
  }

  // ── Heatmap helpers ───────────────────────────────────────────────────────
  const heatmapMarkers = placed.map(p => ({
    camId: p.id,
    x: p.x,
    y: p.y,
    fovAngle: p.camera.hfov,
    direction: p.direction,
    rangeDay: p.camera.rangeDay,
    ppm: ppm
  }));
  const heatmapCameras = placed.map(p => ({ id: p.id, status: "online" }));

function drawCameraStatsToCanvas(ctx, canvasW, canvasH, placedCameras, overrideX = null, overrideY = null, scaleMultiplier = 1, previewW = 960) {
  const typeCounts = {};
  placedCameras.forEach(p => {
    const t = p.camera.type || "dome";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  const entries = Object.keys(typeCounts).sort().map(type => ({
    label: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${typeCounts[type]}`,
  }));
  if (!entries.length) return;

  const canvasScale = canvasW / previewW;
  const zoom = scaleMultiplier * canvasScale;

  const fontSize  = 10 * zoom;
  const titleSize = 11 * zoom;
  const rowGap    = 16 * zoom;
  const padX      = 14 * zoom;
  const padY      = 10 * zoom;
  const margin    = 12 * canvasScale; // base margin regardless of scale
  const cornerR   = 8 * zoom;
  const accentW   = 4 * zoom;

  ctx.save();

  ctx.font = `bold ${titleSize}px Inter, system-ui, sans-serif`;
  const titleWidth = ctx.measureText("Camera Statistics").width;
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  const totalLabel = `Total Cameras: ${placedCameras.length}`;
  const totalWidth = ctx.measureText(totalLabel).width;
  const maxLW = Math.max(...entries.map(e => ctx.measureText(e.label).width));
  const maxTextW = Math.max(titleWidth, totalWidth, maxLW);

  const boxW = padX * 2 + maxTextW;
  const boxH = padY * 2 + (entries.length + 1.5) * rowGap;
  // Use override position if provided (from drag), else default bottom-right
  const bx = overrideX !== null ? overrideX : canvasW - boxW - margin;
  const by = overrideY !== null ? overrideY : canvasH - boxH - margin;

  ctx.shadowColor = "rgba(0,0,0,0.18)";
  ctx.shadowBlur = 12 * zoom;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3 * zoom;

  ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, cornerR);
  else ctx.rect(bx, by, boxW, boxH);
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = Math.max(1, 1 * zoom);
  ctx.stroke();

  ctx.fillStyle = "#1e3a5f";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, accentW, boxH, [cornerR, 0, 0, cornerR]);
  else ctx.rect(bx, by, accentW, boxH);
  ctx.fill();

  let currentY = by + padY + titleSize * 0.5;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  ctx.font = `bold ${titleSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "#0f172a";
  ctx.fillText("Camera Statistics", bx + padX, currentY);
  currentY += rowGap;

  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "#1d4ed8";
  ctx.fillText(totalLabel, bx + padX, currentY);
  currentY += rowGap;

  ctx.fillStyle = "#374151";
  entries.forEach(e => {
    ctx.fillText(e.label, bx + padX, currentY);
    currentY += rowGap;
  });

  ctx.restore();
}

// ── Draw DORI legend box to canvas at given pixel position ──────────────────
function drawDoriLegendToCanvas(ctx, x, y, scaleMultiplier = 1, canvasW = 1000, previewW = 960) {
  const ITEMS = [
    { color: "#a855f7", label: "Identification (250+ px/m)" },
    { color: "#ef4444", label: "Recognition (125+ px/m)" },
    { color: "#eab308", label: "Observation (62+ px/m)" },
    { color: "#3b82f6", label: "Detection (25+ px/m)" },
  ];
  
  const canvasScale = canvasW / previewW;
  const zoom = scaleMultiplier * canvasScale;

  const pad = 12 * zoom;
  const dotR = 5 * zoom;
  const rowH = 20 * zoom;
  const titleH = 22 * zoom;
  const sepH  = 10 * zoom;
  const boxW  = 220 * zoom;
  const cornerR = 8 * zoom;
  const boxH  = pad * 2 + titleH + sepH + ITEMS.length * rowH;

  ctx.save();
  // Background
  ctx.fillStyle = "rgba(13,20,32,0.92)";
  if (ctx.roundRect) ctx.roundRect(x, y, boxW, boxH, cornerR);
  else ctx.rect(x, y, boxW, boxH);
  ctx.fill();
  // Border
  ctx.strokeStyle = "rgba(168,85,247,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
  // Title
  ctx.font = "bold 11px Inter, Arial, sans-serif";
  ctx.fillStyle = "#c084fc";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("DORI ZONES (EN 62676-4)", x + pad, y + pad + titleH / 2);
  // Separator
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(x + pad, y + pad + titleH + 3, boxW - pad * 2, 1);
  // Items
  ITEMS.forEach((item, i) => {
    const iy = y + pad + titleH + sepH + i * rowH + rowH / 2;
    ctx.beginPath();
    ctx.arc(x + pad + dotR, iy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = item.color;
    ctx.shadowColor = item.color;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = "600 11px Inter, Arial, sans-serif";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(item.label, x + pad + dotR * 2 + 6, iy);
  });
  ctx.restore();
}

// ── Build export canvas (base layout, then composited overlays) ──────────────
// overlayOpts: { logo:{show,x,y}, stats:{show,x,y}, dori:{show,x,y} }
// previewW/previewH: dimensions of the preview container (for coordinate mapping)
function buildExportCanvas(exportMode = "design", company = "mirador", overlayOpts, previewSize, onReady) {
  const img = floorImgRef.current;
  if (!img) { onReady(null); return; }

  const exportScale = Math.max(1, Math.min(3, 3000 / Math.max(img.width, img.height)));

  const oc = document.createElement("canvas");
  oc.width  = Math.round(img.width  * exportScale);
  oc.height = Math.round(img.height * exportScale);
  const ctx = oc.getContext("2d");

  ctx.fillStyle = "#10151f";
  ctx.fillRect(0, 0, oc.width, oc.height);
  ctx.scale(exportScale, exportScale);
  ctx.drawImage(img, 0, 0);

  // ── Helper: map preview coords → export canvas coords ─────────────────────
  // previewSize may be null (first build = no overlays rendered yet)
  const mapCoord = (v, previewDim, canvasDim) =>
    (previewSize && previewDim && v !== null) ? (v / previewDim) * canvasDim : null;

  if (exportMode === "design") {
    zonesRef.current.forEach(zone => {
      if (zone.polygon.length < 2) return;
      ctx.save(); ctx.beginPath();
      zone.polygon.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.strokeStyle = zone.color + "ff"; ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      zone.polygon.forEach(pt => {
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = zone.color; ctx.globalAlpha = 0.7; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.stroke();
        ctx.globalAlpha = 1;
      });
      ctx.restore();
    });
      placedRef.current.forEach(p =>
      drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false, false, false, iconScaleRef.current, "beam", scaleRef.current, showMetricsVisibilityRef.current)
    );
    placedRef.current.forEach(p =>
      drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false, false, false, iconScaleRef.current, "body", scaleRef.current, showMetricsVisibilityRef.current)
    );
    // ── Camera Stats box ──
    if (overlayOpts && overlayOpts.stats?.show !== false) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sx = mapCoord(overlayOpts?.stats?.x, previewSize?.w, oc.width);
      const sy = mapCoord(overlayOpts?.stats?.y, previewSize?.h, oc.height);
      drawCameraStatsToCanvas(ctx, oc.width, oc.height, placedRef.current, sx, sy, overlayOpts?.stats?.scale, previewSize?.w);
      ctx.restore();
    }
    // No DORI legend in Designer View

  } else if (exportMode === "heatmap") {
    const hcvs = document.createElement("canvas");
    hcvs.width = oc.width; hcvs.height = oc.height;
    const hctx = hcvs.getContext("2d");
    drawHeatmapToContext(hctx, hcvs.width, hcvs.height, {
      markers: heatmapMarkers, cameras: heatmapCameras, scale: exportScale,
      offset: { x: 0, y: 0 }, activeZone: zones.find(z => z.id === activeZoneId) || null,
      allZones: zones, floorImg: img, step: Math.max(1, Math.round(2 * exportScale)), clear: true,
    });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.85; ctx.drawImage(hcvs, 0, 0); ctx.globalAlpha = 1;
    ctx.restore();
    zonesRef.current.forEach(zone => {
      if (zone.polygon.length < 2) return;
      ctx.save(); ctx.beginPath();
      zone.polygon.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.strokeStyle = zone.color; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.stroke();
      ctx.restore();
    });
    placedRef.current.forEach(p =>
      drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false, false, false, iconScaleRef.current, "beam", scaleRef.current, showMetricsVisibilityRef.current)
    );
    placedRef.current.forEach(p =>
      drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false, false, false, iconScaleRef.current, "body", scaleRef.current, showMetricsVisibilityRef.current)
    );
    // ── Camera Stats box ──
    if (overlayOpts && overlayOpts.stats?.show !== false) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sx = mapCoord(overlayOpts?.stats?.x, previewSize?.w, oc.width);
      const sy = mapCoord(overlayOpts?.stats?.y, previewSize?.h, oc.height);
      drawCameraStatsToCanvas(ctx, oc.width, oc.height, placedRef.current, sx, sy, overlayOpts?.stats?.scale, previewSize?.w);
      ctx.restore();
    }
    // No DORI legend in Heatmap View
  } else if (exportMode === "dori") {
    zonesRef.current.forEach(zone => {
      if (zone.polygon.length < 2) return;
      ctx.save(); ctx.beginPath();
      zone.polygon.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.strokeStyle = zone.color + "ff"; ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      zone.polygon.forEach(pt => {
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = zone.color; ctx.globalAlpha = 0.7; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.stroke();
        ctx.globalAlpha = 1;
      });
      ctx.restore();
    });
    placedRef.current.forEach(p =>
      drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false, true, false, iconScaleRef.current, "beam", scaleRef.current, showMetricsVisibilityRef.current)
    );
    placedRef.current.forEach(p =>
      drawPlacedCamera(ctx, p, ppm, false, false, zonesRef, activeZoneIdRef, null, false, true, false, iconScaleRef.current, "body", scaleRef.current, showMetricsVisibilityRef.current)
    );
    // ── Camera Stats box ──
    if (overlayOpts && overlayOpts.stats?.show !== false) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sx = mapCoord(overlayOpts?.stats?.x, previewSize?.w, oc.width);
      const sy = mapCoord(overlayOpts?.stats?.y, previewSize?.h, oc.height);
      drawCameraStatsToCanvas(ctx, oc.width, oc.height, placedRef.current, sx, sy, overlayOpts?.stats?.scale, previewSize?.w);
      ctx.restore();
    }
    // ── DORI legend ──
    if (overlayOpts && overlayOpts.dori?.show !== false) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dx = mapCoord(overlayOpts?.dori?.x, previewSize?.w, oc.width) ?? 18;
      const dy = mapCoord(overlayOpts?.dori?.y, previewSize?.h, oc.height) ?? (oc.height - 140);
      drawDoriLegendToCanvas(ctx, dx, dy, overlayOpts?.dori?.scale, oc.width, previewSize?.w);
      ctx.restore();
    }
  }

  // ── Watermark badge (logo) ──
  const logoSrc     = company === "sentinel" ? sentinelLogoImg : logoImg;
  const companyName = company === "sentinel"
    ? "SENTINEL TECHNOLOGIES PRIVATE LIMITED"
    : "Mirador AI Technologies";

  const drawTitleOverlay = () => {
    if (overlayOpts && overlayOpts.titleOverlay?.show !== false) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const mappedX = mapCoord(overlayOpts?.titleOverlay?.x, previewSize?.w, oc.width);
      const mappedY = mapCoord(overlayOpts?.titleOverlay?.y, previewSize?.h, oc.height);
      
      let titleText = "DESIGNER VIEW";
      if (exportMode === "heatmap") titleText = "COVERAGE HEATMAP";
      else if (exportMode === "dori") titleText = "CLARITY ZONES";

      const scaleMultiplier = overlayOpts?.titleOverlay?.scale || 1;
      const canvasScale = previewSize?.w ? (oc.width / previewSize.w) : (oc.width / 960);
      const zoom = scaleMultiplier * canvasScale;
      
      const tx = mappedX !== null ? mappedX : (12 * canvasScale);
      const ty = mappedY !== null ? mappedY : (12 * canvasScale);

      const tSize = 16 * zoom;

      ctx.font = `bold ${tSize}px Inter, Arial, sans-serif`;
      const textW = ctx.measureText(titleText).width;
      const padX = 16 * zoom;
      const padY = 12 * zoom;
      const badgeW = textW + padX * 2;
      const badgeH = tSize + padY * 2;

      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 14 * zoom;
      ctx.shadowOffsetY = 3 * zoom;

      ctx.fillStyle = "rgba(13, 17, 23, 0.9)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx, ty, badgeW, badgeH, 8 * zoom);
      else ctx.rect(tx, ty, badgeW, badgeH);
      ctx.fill();

      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = Math.max(1, 1 * zoom);
      ctx.stroke();

      ctx.fillStyle = "#e2e8f0";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(titleText, tx + padX, ty + badgeH / 2);
      ctx.restore();
    }
    onReady(oc);
  };

  // Skip logo if user removed it in preview or if previewing base image
  if (!overlayOpts || overlayOpts.logo?.show === false) {
    drawTitleOverlay();
    return;
  }

  const watermark = new Image();
  watermark.onload = () => {
    // skip logic if missing, just do existing drawing then drawTitleOverlay
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

    const refW    = oc.width;
    const scaleMultiplier = overlayOpts?.logo?.scale || 1;
    const canvasScale = previewSize?.w ? (oc.width / previewSize.w) : (oc.width / 960);
    const zoom = scaleMultiplier * canvasScale;

    const logoH   = 28 * zoom;
    const logoW   = (watermark.width / watermark.height) * logoH;
    const tSize   = 12 * zoom;

    ctx.font = `bold ${tSize}px Inter, Arial, sans-serif`;
    const textW   = ctx.measureText(companyName).width;
    const gap     = 8 * zoom;
    const padX    = 14 * zoom;
    const padY    = 8 * zoom;
    const margin  = 12 * canvasScale;
    const cornerR = 8 * zoom;

    const badgeW = padX * 2 + logoW + gap + textW;
    const badgeH = Math.max(logoH, tSize) + padY * 2;

    const mappedX = mapCoord(overlayOpts?.logo?.x, previewSize?.w, oc.width);
    const mappedY = mapCoord(overlayOpts?.logo?.y, previewSize?.h, oc.height);
    const bx = mappedX !== null ? mappedX : oc.width  - badgeW - margin;
    const by = mappedY !== null ? mappedY : margin;

    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 14 * zoom;
    ctx.shadowOffsetY = 3 * zoom;

    ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, badgeW, badgeH, cornerR);
    else ctx.rect(bx, by, badgeW, badgeH);
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = "rgba(0,0,0,0.07)";
    ctx.lineWidth = Math.max(1, 1 * zoom);
    ctx.stroke();

    const midY = by + badgeH / 2;

    ctx.drawImage(watermark, bx + padX, midY - logoH / 2, logoW, logoH);

    ctx.fillStyle = "#0f172a";
    ctx.font = `bold ${tSize}px Inter, Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(companyName, bx + padX + logoW + gap, midY);

    ctx.restore();
    drawTitleOverlay();
  };
  watermark.onerror = () => drawTitleOverlay();
  watermark.src = logoSrc;
}

  function downloadCanvasAsJpg(canvas, exportMode) {
    if (!canvas) return;
    const a = document.createElement("a");
    let fname = "designerview.jpg";
    if (exportMode === "heatmap") fname = "coverage_heatmap.jpg";
    else if (exportMode === "dori") fname = "Clarityzones.jpg";
    a.download = fname;
    a.href = canvas.toDataURL("image/jpeg", 0.95);
    a.click();
  }

  function generatePdfReport(canvas, exportMode) {
    if (!canvas) return;

    const placedList = placedRef.current;
    const zonesList = zonesRef.current;
    const typeCounts = {};
    placedList.forEach(p => {
      const t = p.camera.type || "dome";
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const totalAreaM2 = zonesList.reduce((sum, z) => sum + getPolygonArea(z.polygon, ppmRef.current), 0);
    const camsPerZone = zonesList.length > 0 ? (placedList.length / zonesList.length).toFixed(1) : "0";

    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 40;

    const buildDoc = () => {
      const imgData = canvas.toDataURL("image/jpeg", 0.85);
      const imgRatio = canvas.height / canvas.width;
      const imgW = pageW - margin * 2;
     
      const pageH = doc.internal.pageSize.getHeight();
      const maxImgH = pageH - margin * 2;
     
      let finalImgH = imgW * imgRatio;
      let finalImgW = imgW;
     
      if (finalImgH > maxImgH) {
        finalImgH = maxImgH;
        finalImgW = finalImgH / imgRatio;
      }
     
      const imgX = margin + (imgW - finalImgW) / 2;
      const imgY = margin + (maxImgH - finalImgH) / 2;

      doc.addImage(imgData, "JPEG", imgX, imgY, finalImgW, finalImgH);

      let pdfName = "designerview.pdf";
      if (exportMode === "heatmap") pdfName = "coverage_heatmap.pdf";
      else if (exportMode === "dori") pdfName = "Clarityzones.pdf";
      doc.save(pdfName);
    };

    buildDoc();
  }

  // ── Handle export: build base canvas → open preview modal ─────────────────
  function handleOpenExportPreview(mode) {
    if (!floorImgRef.current) return;
    setPendingExportMode(mode);
    setIsGeneratingExport(true);
    // Build base canvas (no overlays) for the preview image
    buildExportCanvas(mode, selectedCompany, null, null, (canvas) => {
      setIsGeneratingExport(false);
      if (!canvas) return;
      setExportPreviewCanvas(canvas);
      setExportPreviewDataUrl(canvas.toDataURL("image/jpeg", 0.85));
      setExportPreviewOpen(true);
    });
  }

  // ── Handle final download after preview ────────────────────────────────────
  function handleExportDownload(format, overlayState) {
    if (!pendingExportMode || !exportPreviewCanvas) return;
    setIsGeneratingExport(true);
    // Get preview container dimensions for coordinate mapping
    const previewEl = document.querySelector("[data-export-preview]");
    const previewSize = previewEl
      ? { w: previewEl.offsetWidth, h: previewEl.offsetHeight }
      : null;
    buildExportCanvas(pendingExportMode, selectedCompany, overlayState, previewSize, (canvas) => {
      setIsGeneratingExport(false);
      if (format === "jpg") downloadCanvasAsJpg(canvas, pendingExportMode);
      else if (format === "pdf") generatePdfReport(canvas, pendingExportMode);
      setExportPreviewOpen(false);
      setExportPreviewCanvas(null);
      setExportPreviewDataUrl(null);
      setPendingExportMode(null);
    });
  }

  // ── 3D Markers & Camera Sync for Gltf3DViewer ──
  const gltfMarkers = useMemo(() => {
    return (placed || []).map(p => ({
      id: p.id,
      camId: p.camera?.id || p.id,
      camName: p.customName || p.camera?.model || "Camera",
      x: p.x,
      y: p.y,
      direction: p.direction || 0,
      fovAngle: p.camera?.hfov || 60,
      camera: p.camera
    }));
  }, [placed]);

  const gltfCameras = useMemo(() => {
    const map = new Map();
    (cameraDB || []).forEach(c => map.set(c.id, c));
    (placed || []).forEach(p => {
      if (p.camera?.id && !map.has(p.camera.id)) {
        map.set(p.camera.id, p.camera);
      }
    });
    return Array.from(map.values());
  }, [cameraDB, placed]);

  const handleUpdate3DMarkers = useCallback((newMarkers) => {
    recordState();
    const updated = newMarkers.map(m => {
      const existing = placedRef.current.find(p => p.id === m.id);
      if (existing) {
        return {
          ...existing,
          x: m.x,
          y: m.y,
          direction: m.direction
        };
      }
      const camObj = m.camera || cameraDBRef.current.find(c => c.id === m.camId) || {
        id: m.camId,
        model: m.camName || "Camera",
        type: "dome",
        hfov: m.fovAngle || 60,
        rangeDay: 30
      };
      return {
        id: m.id || `placed_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        camera: camObj,
        x: m.x,
        y: m.y,
        direction: m.direction || 0,
        recordingMode: "continuous",
        fps: 25,
        lighting: "normal",
        mounting: "default",
        includeBackbox: false,
        includePoe: false
      };
    });
    placedRef.current = updated;
    setPlaced(updated);
    draw();
    scheduleSave(updated, zonesRef.current, ppmRef.current);
  }, [recordState, draw, scheduleSave]);

  // ── Export 3D GLB Model (with cameras and solid beams) ──
  const export3DModelGLB = useCallback(() => {
    const activeSlide = slidesRef.current.find(s => s.id === activeSlideIdRef.current);
    const slideName = activeSlide?.name || "Floor_Design";
    if (gltfViewerRef.current?.exportGLB) {
      gltfViewerRef.current.exportGLB(slideName);
    } else {
      alert("3D viewer is not initialized for GLB export.");
    }
    setFileDropdownOpen(false);
  }, []);

  // ── Export 3D Top-Down 2D Snapshot (Design / Heatmap) ──
  const export3DTopDown = useCallback((isHeatmap = false) => {
    const activeSlide = slidesRef.current.find(s => s.id === activeSlideIdRef.current);
    const slideName = activeSlide?.name || "Floor_Design";
    if (gltfViewerRef.current?.exportTopDownSnapshot) {
      gltfViewerRef.current.exportTopDownSnapshot(slideName, isHeatmap);
    } else {
      alert("3D viewer is not initialized for 2D top-down export.");
    }
    setFileDropdownOpen(false);
  }, []);

  useEffect(() => {
    const h = e => {
      // Don't intercept if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === "Escape" && modeRef.current === "zone") {
        drawingPointsRef.current = []; setDrawingPoints([]); setMode("place"); draw();
      }

      // Delete Zone / Shape via Keyboard
      if (e.key === "Delete" || e.key === "Backspace") {
        if (activeZoneIdRef.current) {
          handleDeleteZone(activeZoneIdRef.current);
        }
      }

      // Copy (Ctrl+C)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const sIdx = selectedIdxRef.current;
        if (sIdx !== null && sIdx >= 0 && sIdx < placedRef.current.length) {
          copiedCameraRef.current = JSON.parse(JSON.stringify(placedRef.current[sIdx]));
        }
      }

      // Paste (Ctrl+V)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (copiedCameraRef.current) {
          recordState();
          const p = copiedCameraRef.current;
          
          const pasteX = mouseMapPosRef.current ? mouseMapPosRef.current.x : p.x + 20;
          const pasteY = mouseMapPosRef.current ? mouseMapPosRef.current.y : p.y + 20;

          const newEntry = {
            ...p,
            id: `placed_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            x: pasteX,
            y: pasteY
          };
          
          const updated = [...placedRef.current, newEntry];
          placedRef.current = updated;
          setPlaced(updated);
          setSelectedIdx(updated.length - 1);
          draw();
          apiSaveLayout({ placed: updated, zones: zonesRef.current, ppm: ppmRef.current });
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [draw, recordState, apiSaveLayout, handleDeleteZone]);

  const selectedPlaced = selectedIdx !== null ? placed[selectedIdx] : null;
  const activeZone = zones.find(z => z.id === activeZoneId) || null;

  // ── Sidebar styles ────────────────────────────────────────────────────────
  const sidebarStyles = {
    sidebar: {
      position: "relative",
      width: sidebarExpanded ? 168 : 36,
      minWidth: sidebarExpanded ? 168 : 36,
      background: "#161c28",
      borderRight: "1.5px solid rgba(46, 61, 85, 0.5)",
      display: "flex",
      flexDirection: "column",
      transition: "width 0.2s ease, min-width 0.2s ease",
      overflow: "hidden",
      flexShrink: 0,
      zIndex: 10,
    },
    head: {
      display: "flex", alignItems: "center", gap: 6,
      padding: "10px 8px 8px",
      borderBottom: "1px solid rgba(46, 61, 85, 0.5)",
      whiteSpace: "nowrap",
    },
    list: {
      flex: 1, overflowY: "auto", overflowX: "hidden",
      padding: "6px 4px",
    },
    sectionLabel: {
      fontSize: 13, fontWeight: 700, letterSpacing: "0.1em",
      textTransform: "uppercase", color: "#5aabf0",
      padding: "6px 6px 4px",
      whiteSpace: "nowrap",
      display: sidebarExpanded ? "block" : "none",
    },
    addBtn: {
      display: "flex", alignItems: "center", gap: 6,
      width: "100%", background: "none", border: "none",
      padding: "5px 6px", cursor: "pointer",
      color: "#5aabf0", fontSize: 15, textAlign: "left",
      borderRadius: 4,
      whiteSpace: "nowrap",
    },
    divider: {
      height: "0.5px", background: "rgba(46, 61, 85, 0.5)", margin: "6px 4px",
    },
  };
  const scaleParams = (() => {
    const sc = scaleRef.current || 1;
    const currentPpm = ppm;
    const oneMeterPx = currentPpm * sc;
    const idealWidthPx = 100;
    const rawMeters = idealWidthPx / oneMeterPx;
    const roundMetersOptions = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    let selectedMeters = roundMetersOptions[0];
    let minDiff = Math.abs(rawMeters - selectedMeters);
    for (let i = 1; i < roundMetersOptions.length; i++) {
      const diff = Math.abs(rawMeters - roundMetersOptions[i]);
      if (diff < minDiff) {
        minDiff = diff;
        selectedMeters = roundMetersOptions[i];
      }
    }
    return { meters: selectedMeters, width: selectedMeters * oneMeterPx };
  })();

  return (
    <div className="page-shell dv-root">

      {/* ── Combined Header + Top bar ── */}
      <div className="dv-topbar">
        {/* Left: Page Title */}
        <div className="dv-topbar__title-section" style={{ display: "flex", alignItems: "center", paddingRight: "20px", gap: "12px" }}>
          <h1 className="page-title" style={{ fontSize: "28px", margin: 0 }}>Designer View</h1>
         
        </div>

        <div className="dv-topbar__actions" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
         
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "nowrap" }}>
           
            {/* ── File / Actions Dropdown ── */}
            <div className="dv-icon-drop-wrap" ref={fileDropRef}>
              <button
                className={`dv-icon-btn ${fileDropdownOpen ? "dv-icon-btn--active" : ""}`}
                onClick={() => {
                  setFileDropdownOpen(o => !o);
                  setModesDropdownOpen(false);
                  setLayersDropdownOpen(false);
                }}
                title="File & Actions"
              >
                {/* Folder/File icon */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span className="dv-icon-btn__label">File</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" className={`dv-icon-btn__chevron ${fileDropdownOpen ? "open" : ""}`}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {fileDropdownOpen && (
                <div className="dv-dropdown-panel dv-dropdown-panel--file" style={{ minWidth: "260px" }}>
                  <div className="dv-dropdown-panel__title">Project File Actions</div>
                 
                  {/* Import Floor Plan */}
                  <button
                    className="dv-dropdown-item-btn"
                    onClick={() => { setFileDropdownOpen(false); fileInputRef.current?.click(); }}
                  >
                    <div className="dv-dropdown-item-btn__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                      </svg>
                    </div>
                    <span>Import Floor Plan</span>
                  </button>

                  {/* Import JSON */}
                  <button
                    className="dv-dropdown-item-btn"
                    onClick={() => { setFileDropdownOpen(false); jsonFileInputRef.current?.click(); }}
                  >
                    <div className="dv-dropdown-item-btn__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M16 8l-4-4-4 4M12 4v12" />
                      </svg>
                    </div>
                    <span>Import Layout JSON</span>
                  </button>

                  {/* Upload Datasheet */}
                  <button
                    className="dv-dropdown-item-btn"
                    onClick={() => { setFileDropdownOpen(false); datasheetInputRef.current?.click(); }}
                  >
                    <div className="dv-dropdown-item-btn__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <line x1="9" y1="15" x2="15" y2="15" />
                      </svg>
                    </div>
                    <span>Upload Datasheet (PDF)</span>
                  </button>

                  {/* Download JSON */}
                  <button
                    className="dv-dropdown-item-btn"
                    onClick={() => { setFileDropdownOpen(false); downloadJson(); }}
                  >
                    <div className="dv-dropdown-item-btn__icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 16V4M8 12l4 4 4-4" />
                      </svg>
                    </div>
                    <span>Download Layout JSON</span>
                  </button>

                  <div className="dv-dropdown-panel__title" style={{ marginTop: "10px" }}>Company Branding</div>
                  <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: "8px", background: "var(--bg-elevated)", border: "1px solid var(--border-light)", borderRadius: "6px", margin: "0 8px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: "var(--text-primary)", fontSize: "13px" }}>
                      <input type="radio" name="exportCompanyDrop" checked={selectedCompany === "mirador"} onChange={(e) => { e.stopPropagation(); setSelectedCompany("mirador"); }} onClick={e => e.stopPropagation()} />
                      Mirador AI Technologies
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: "var(--text-primary)", fontSize: "13px" }}>
                      <input type="radio" name="exportCompanyDrop" checked={selectedCompany === "sentinel"} onChange={(e) => { e.stopPropagation(); setSelectedCompany("sentinel"); }} onClick={e => e.stopPropagation()} />
                      Sentinel Technologies
                    </label>
                  </div>

                  <div className="dv-dropdown-panel__title" style={{ marginTop: "10px" }}>Export Options</div>

                  {slides.find(s => s.id === activeSlideId)?.modelDataUrl ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "0 8px" }}>
                      {/* 1. Download Design (.glb) */}
                      <button
                        className="dv-dropdown-item-btn"
                        style={{ background: "rgba(29, 158, 117, 0.12)", border: "1px solid rgba(29, 158, 117, 0.3)", color: "#1D9E75", padding: "8px 10px" }}
                        onClick={export3DModelGLB}
                      >
                        <div className="dv-dropdown-item-btn__icon" style={{ color: "#1D9E75" }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                            <line x1="12" y1="22.08" x2="12" y2="12"></line>
                          </svg>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                          <span style={{ fontWeight: 700, fontSize: "12px" }}>Download Design (.glb)</span>
                          <span style={{ fontSize: "10px", opacity: 0.7 }}>With 3D cameras &amp; solid beams</span>
                        </div>
                      </button>

                      {/* 2. Download Design 2D */}
                      <button
                        className="dv-dropdown-item-btn"
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-light)", padding: "8px 10px" }}
                        onClick={() => export3DTopDown(false)}
                      >
                        <div className="dv-dropdown-item-btn__icon">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                          </svg>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                          <span style={{ fontWeight: 700, fontSize: "12px" }}>Download Design 2D</span>
                          <span style={{ fontSize: "10px", opacity: 0.7 }}>Pristine top-down 2D snapshot</span>
                        </div>
                      </button>

                      {/* 3. Download Heatmap 2D */}
                      <button
                        className="dv-dropdown-item-btn"
                        disabled={!showHeatmap}
                        title={!showHeatmap ? "Enable the Heatmap layer to download heatmap 2D" : "Download 2D top-down heatmap snapshot"}
                        style={{
                          background: showHeatmap ? "rgba(245, 158, 11, 0.12)" : "var(--bg-elevated)",
                          border: showHeatmap ? "1px solid rgba(245, 158, 11, 0.3)" : "1px solid var(--border-light)",
                          color: showHeatmap ? "#f59e0b" : "var(--text-secondary)",
                          padding: "8px 10px",
                          opacity: !showHeatmap ? 0.45 : 1,
                          cursor: !showHeatmap ? "not-allowed" : "pointer"
                        }}
                        onClick={() => { if (showHeatmap) export3DTopDown(true); }}
                      >
                        <div className="dv-dropdown-item-btn__icon" style={{ color: showHeatmap ? "#f59e0b" : "inherit" }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                          </svg>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                          <span style={{ fontWeight: 700, fontSize: "12px" }}>Download Heatmap 2D</span>
                          <span style={{ fontSize: "10px", opacity: 0.7 }}>{showHeatmap ? "Top-down coverage heatmap" : "Requires Heatmap layer active"}</span>
                        </div>
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: "8px", margin: "0 8px" }}>
                      {/* Export Designer View */}
                      <button
                        className="dv-dropdown-card"
                        disabled={placed.length === 0}
                        style={{ flex: 1, flexDirection: "column", padding: "12px 6px", alignItems: "center", justifyContent: "center", gap: "8px", opacity: placed.length === 0 ? 0.4 : 1, cursor: placed.length === 0 ? "not-allowed" : "pointer" }}
                        onClick={() => { if (placed.length > 0) { setFileDropdownOpen(false); handleOpenExportPreview("design"); } }}
                      >
                        <div className="dv-dropdown-card__icon" style={{ margin: 0 }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                          </svg>
                        </div>
                        <div className="dv-dropdown-card__body" style={{ alignItems: "center" }}>
                          <span className="dv-dropdown-card__label" style={{ textAlign: "center", fontSize: "11px", lineHeight: "1.2" }}>Designer View</span>
                        </div>
                      </button>

                      {/* Export Heatmap */}
                      <button
                        className="dv-dropdown-card"
                        disabled={placed.length === 0 || !showHeatmap}
                        title={!showHeatmap ? "Enable the Heatmap layer to download heatmap" : "Export Heatmap"}
                        style={{
                          flex: 1,
                          flexDirection: "column",
                          padding: "12px 6px",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "8px",
                          opacity: (placed.length === 0 || !showHeatmap) ? 0.4 : 1,
                          cursor: (placed.length === 0 || !showHeatmap) ? "not-allowed" : "pointer"
                        }}
                        onClick={() => { if (placed.length > 0 && showHeatmap) { setFileDropdownOpen(false); handleOpenExportPreview("heatmap"); } }}
                      >
                        <div className="dv-dropdown-card__icon dv-dropdown-card__icon--heatmap" style={{ margin: 0 }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                          </svg>
                        </div>
                        <div className="dv-dropdown-card__body" style={{ alignItems: "center" }}>
                          <span className="dv-dropdown-card__label" style={{ textAlign: "center", fontSize: "11px", lineHeight: "1.2" }}>Heatmap</span>
                        </div>
                      </button>

                      {/* Export Clarity Zones */}
                      <button
                        className="dv-dropdown-card"
                        disabled={placed.length === 0}
                        style={{ flex: 1, flexDirection: "column", padding: "12px 6px", alignItems: "center", justifyContent: "center", gap: "8px", opacity: placed.length === 0 ? 0.4 : 1, cursor: placed.length === 0 ? "not-allowed" : "pointer" }}
                        onClick={() => { if (placed.length > 0) { setFileDropdownOpen(false); handleOpenExportPreview("dori"); } }}
                      >
                        <div className="dv-dropdown-card__icon" style={{ color: "#a855f7", margin: 0 }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                            <circle cx="12" cy="12" r="10" />
                            <circle cx="12" cy="12" r="6" />
                            <circle cx="12" cy="12" r="2" />
                          </svg>
                        </div>
                        <div className="dv-dropdown-card__body" style={{ alignItems: "center" }}>
                          <span className="dv-dropdown-card__label" style={{ textAlign: "center", fontSize: "11px", lineHeight: "1.2" }}>Clarity Zones</span>
                        </div>
                      </button>
                    </div>
                  )}

                  {hasFloor && (
                    <>
                      <div className="dv-dropdown-divider" style={{ margin: "8px 0" }} />
                      {/* Delete Floor Plan */}
                      <button
                        className="dv-dropdown-item-btn dv-dropdown-item-btn--danger"
                        onClick={() => { setFileDropdownOpen(false); removeFloorPlan(); }}
                      >
                        <div className="dv-dropdown-item-btn__icon">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
                          </svg>
                        </div>
                        <span>Delete Floor Plan</span>
                      </button>
                    </>
                  )}

                </div>
              )}
            </div>
           
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.gltf,.glb,.html,.htm" style={{ display: "none" }} onChange={handleFileChange} />
            <input ref={jsonFileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleJsonImport} />
            <input ref={datasheetInputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handleDatasheetUpload} />

            {/* ── Datasheet Processing Overlay ── */}
            {datasheetUploading && (
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
                display: "flex", alignItems: "center", justifyContent: "center",
                zIndex: 99999, flexDirection: "column", gap: 16
              }}>
                <div style={{
                  width: 48, height: 48, border: "4px solid rgba(255,255,255,0.2)",
                  borderTopColor: "#3b82f6", borderRadius: "50%",
                  animation: "spin 0.8s linear infinite"
                }} />
                <div style={{ color: "#e8edf5", fontSize: 18, fontWeight: 600 }}>
                  Processing Datasheet...
                </div>
                <div style={{ color: "#94a3b8", fontSize: 14 }}>
                  Extracting camera specifications using AI
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
            {/* ── Direct Mode Buttons ── */}
            <button
              className={`dv-icon-btn ${mode === "pan" ? "dv-icon-btn--active" : ""}`}
              onClick={() => { setMode("pan"); setCalPts([]); setSelectedIdx(null); setSelectedModel(null); setModesDropdownOpen(false); draw(); }}
              title="Pan Map"
              style={{ padding: "8px" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18"/>
              </svg>
            </button>
            <button
              className={`dv-icon-btn ${mode === "place" ? "dv-icon-btn--active" : ""}`}
              onClick={() => { setMode("place"); setCalPts([]); setModesDropdownOpen(false); draw(); }}
              title="Place Camera"
              style={{ padding: "8px" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <circle cx="12" cy="12" r="3"/>
                <circle cx="12" cy="12" r="8" strokeDasharray="2 3"/>
              </svg>
            </button>

            {/* ── Open Map Button ── */}
            <button
              className={`dv-icon-btn ${showEarthMap ? "dv-icon-btn--active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setShowEarthMap(true); }}
              title="Open Google Map"
              style={{ padding: "8px" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <circle cx="12" cy="12" r="10"/>
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            </button>

            {/* ── Modes Icon Button + Dropdown ── */}
            <div className="dv-icon-drop-wrap" ref={modesDropRef}>
              <button
                className={`dv-icon-btn ${
                  (modesDropdownOpen || mode !== "place") ? "dv-icon-btn--active" : ""
                }`}
                onClick={() => {
                  setModesDropdownOpen(o => !o);
                  setLayersDropdownOpen(false);
                  setFileDropdownOpen(false);
                }}
                title="Modes"
              >
                {/* Active mode icon */}
                {mode === "place" && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <circle cx="12" cy="12" r="3"/>
                    <circle cx="12" cy="12" r="8" strokeDasharray="3 3"/>
                  </svg>
                )}
                {mode === "pan" && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18"/>
                  </svg>
                )}
                {mode === "zone" && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                  </svg>
                )}
                {mode === "calibrate" && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                    <path d="M4 19h16M4 5h16M12 5v14M8 12h8" />
                  </svg>
                )}
               
                <span className="dv-icon-btn__label">Modes</span>
                {mode !== "place" && <span className="dv-icon-btn__dot" />}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" className={`dv-icon-btn__chevron ${modesDropdownOpen ? "open" : ""}`}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {modesDropdownOpen && (
                <div className="dv-dropdown-panel" style={{ minWidth: "250px" }}>
                  <div className="dv-dropdown-panel__title">Design Modes</div>
                  <div className="dv-dropdown-cards">

                    {/* Place Camera */}
                    <button
                      className={`dv-dropdown-card ${mode === "place" ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setMode("place"); setCalPts([]); setModesDropdownOpen(false); draw(); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <circle cx="12" cy="12" r="3"/>
                          <circle cx="12" cy="12" r="8" strokeDasharray="2 3"/>
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Place Cam</span>
                        {/* <span className="dv-dropdown-card__desc">Drag/click models to layout</span> */}
                      </div>
                      {mode === "place" && <span className="dv-dropdown-card__check">✓</span>}
                    </button>

                    {/* Pan Map */}
                    <button
                      className={`dv-dropdown-card ${mode === "pan" ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setMode("pan"); setCalPts([]); setSelectedIdx(null); setSelectedModel(null); setModesDropdownOpen(false); draw(); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M12 3v18M3 12h18"/>
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Pan Map</span>
                        {/* <span className="dv-dropdown-card__desc">Drag to navigate the floor layout</span> */}
                      </div>
                      {mode === "pan" && <span className="dv-dropdown-card__check">✓</span>}
                    </button>

                    {/* Draw Zone */}
                    <button
                      className={`dv-dropdown-card ${mode === "zone" ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setMode("zone"); setCalPts([]); setSelectedIdx(null); setSelectedModel(null); drawingPointsRef.current = []; setDrawingPoints([]); setModesDropdownOpen(false); draw(); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Draw Zone</span>
                        {/* <span className="dv-dropdown-card__desc">Click points to draw area boundaries</span> */}
                      </div>
                      {mode === "zone" && <span className="dv-dropdown-card__check">✓</span>}
                    </button>

                    {/* Calibrate */}
                    <button
                      className={`dv-dropdown-card ${mode === "calibrate" ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setCalibrateMode(); setModesDropdownOpen(false); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="22" y1="12" x2="18" y2="12"/>
                          <line x1="6" y1="12" x2="2" y2="12"/>
                          <line x1="12" y1="6" x2="12" y2="2"/>
                          <line x1="12" y1="22" x2="12" y2="18"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Calibrate</span>
                        {/* <span className="dv-dropdown-card__desc">Calibrate layout scale & distortion</span> */}
                      </div>
                      {mode === "calibrate" && <span className="dv-dropdown-card__check">✓</span>}
                    </button>

                    {/* Crop Layout */}
                    <button
                      className={`dv-dropdown-card ${mode === "crop" ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setMode("crop"); setCalPts([]); setMouseMapPos(null); setSelectedIdx(null); setSelectedModel(null); setModesDropdownOpen(false); draw(); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <path d="M6.13 1L6 16a2 2 0 002 2h15" />
                          <path d="M1 6.13L16 6a2 2 0 012 2v15" />
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Crop Layout</span>
                        {/* <span className="dv-dropdown-card__desc">Draw a box to crop the floor plan</span> */}
                      </div>
                      {mode === "crop" && <span className="dv-dropdown-card__check">✓</span>}
                    </button>

                    {/* Auto-Detect Zones */}
                    <button
                      className={`dv-dropdown-card ${isDetectingZones ? "dv-dropdown-card--loading" : ""}`}
                      disabled={isDetectingZones}
                      onClick={async () => {
                        setModesDropdownOpen(false);
                        if (isDetectingZones) return;
                        setIsDetectingZones(true);
                        try {
                          const activeSlide = slides.find(s => s.id === activeSlideId);
                          const currentFloorPlan = activeSlide?.floorPlan || null;
                          const r = await fetch(`${API}/api/designer/detect-zones`, {
                            method: "POST",
                            headers: getAuthHeaders(),
                            body: JSON.stringify({
                              map_id: MAP_ID,
                              floor_id: FLOOR_ID,
                              source: "designer",
                              floor_plan: currentFloorPlan
                            })
                          });
                          if (!r.ok) {
                            const errData = await r.json();
                            alert(`CV Zone detection failed: ${errData.detail || r.statusText}`);
                            return;
                          }
                          const data = await r.json();
                          if (data.success && data.zones?.length > 0) {
                            setDraftZones(data.zones);
                            draftZonesRef.current = data.zones;
                            alert(`Detected ${data.zones.length} potential zones. Hover/click inside them on the map to import!`);
                            draw();
                          } else {
                            alert("No distinct closed zones detected on this floor plan image.");
                          }
                        } catch (e) {
                          console.error(e);
                          alert("An error occurred during CV zone detection.");
                        } finally {
                          setIsDetectingZones(false);
                        }
                      }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">
                          {isDetectingZones ? "Detecting…" : "Auto-Detect"}
                        </span>
                        {/* <span className="dv-dropdown-card__desc">AI detects boundaries from image</span> */}
                      </div>
                      {draftZones.length > 0 && !isDetectingZones && (
                        <span className="dv-dropdown-card__badge">{draftZones.length}</span>
                      )}
                      {isDetectingZones && <span className="dv-dropdown-card__spinner" />}
                    </button>

                  </div>
                </div>
              )}
            </div>

            {/* ── Layers Icon Button + Dropdown ── */}
            <div className="dv-icon-drop-wrap" ref={layersDropRef}>
              <button
                className={`dv-icon-btn ${
                  (showHeatmap || showPpm || showMetricsVisibility || layersDropdownOpen) ? "dv-icon-btn--active" : ""
                }`}
                onClick={() => {
                  setLayersDropdownOpen(o => !o);
                  setModesDropdownOpen(false);
                  setFileDropdownOpen(false);
                }}
                title="Layers"
              >
                {/* Layers stack icon */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                  <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                  <polyline points="2 17 12 22 22 17"/>
                  <polyline points="2 12 12 17 22 12"/>
                </svg>
                <span className="dv-icon-btn__label">Layers</span>
                {(showHeatmap || showPpm || showMetricsVisibility) && <span className="dv-icon-btn__dot" />}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10" className={`dv-icon-btn__chevron ${layersDropdownOpen ? "open" : ""}`}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>

              {layersDropdownOpen && (
                <div className="dv-dropdown-panel" style={{ minWidth: "240px" }}>
                  <div className="dv-dropdown-panel__title">Map Layers</div>
                  <div className="dv-dropdown-cards">

                    {/* Heatmap */}
                    <button
                      className={`dv-dropdown-card ${showHeatmap ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setShowHeatmap(h => !h); }}
                    >
                      <div className="dv-dropdown-card__icon dv-dropdown-card__icon--heatmap">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <circle cx="12" cy="12" r="3"/>
                          <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Heatmap</span>
                        {/* <span className="dv-dropdown-card__desc">Coverage blind-spot intensity overlay</span> */}
                      </div>
                      <div className={`dv-dropdown-card__toggle ${showHeatmap ? "dv-dropdown-card__toggle--on" : ""}`} />
                    </button>

                    {/* Clarity Zones (PPM) */}
                    <button
                      className={`dv-dropdown-card ${showPpm ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setShowPpm(!showPpm); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Clarity Zones</span>
                        {/* <span className="dv-dropdown-card__desc">PPM / DORI visual coverage categories</span> */}
                      </div>
                      <div className={`dv-dropdown-card__toggle ${showPpm ? "dv-dropdown-card__toggle--on" : ""}`} />
                    </button>

                    {/* Metrics Visibility */}
                    <button
                      className={`dv-dropdown-card ${showMetricsVisibility ? "dv-dropdown-card--active" : ""}`}
                      onClick={() => { setShowMetricsVisibility(!showMetricsVisibility); setTimeout(draw, 0); }}
                    >
                      <div className="dv-dropdown-card__icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
                          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                      </div>
                      <div className="dv-dropdown-card__body">
                        <span className="dv-dropdown-card__label">Metrics Visibility</span>
                      </div>
                      <div className={`dv-dropdown-card__toggle ${showMetricsVisibility ? "dv-dropdown-card__toggle--on" : ""}`} />
                    </button>

                  </div>
                </div>
              )}
            </div>

            <div className="dv-toolbar-divider" />

            {/* ── Undo / Redo ── */}
            <button className="dv-icon-btn" onClick={handleUndo} disabled={undoStack.length === 0} title="Undo last action" style={{ padding: "6px 10px" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M3 7v6h6M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
              </svg>
            </button>
            <button className="dv-icon-btn" onClick={handleRedo} disabled={redoStack.length === 0} title="Redo last action" style={{ padding: "6px 10px" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M21 7v6h-6M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7" />
              </svg>
            </button>

            {/* ── Hints ── */}
            {mode === "zone" && (
              <span className="dv-zone-hint" style={{ fontSize: "13px", color: "#F59E0B", background: "#F59E0B15", padding: "3px 10px", borderRadius: "99px", border: "0.5px solid #F59E0B55", whiteSpace: "nowrap" }}>
                {drawingPoints.length === 0
                  ? "Click map to start zone"
                  : drawingPoints.length < 3
                    ? `${drawingPoints.length} pt${drawingPoints.length > 1 ? "s" : ""}`
                    : "Click 1st point to close · Esc to cancel"}
              </span>
            )}

            {draftZones.length > 0 && (
              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <button
                  className="dv-icon-btn"
                  style={{ borderColor: "#10b981", background: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}
                  onClick={() => {
                    showConfirm("Import All Zones", `Import all ${draftZones.length} detected zones?`, () => {
                      const newImportedZones = draftZones.map((dz, idx) => {
                        const colorIdx = (zonesRef.current.length + idx) % ZONE_COLORS.length;
                        return {
                          ...dz,
                          id: "zone_" + (Date.now() + idx),
                          color: ZONE_COLORS[colorIdx]
                        };
                      });
                      const updatedZones = [...zonesRef.current, ...newImportedZones];
                      zonesRef.current = updatedZones;
                      setZones(updatedZones);
                      setDraftZones([]);
                      draftZonesRef.current = [];
                      apiSaveZones(updatedZones);
                      draw();
                      alert(`Successfully imported all ${newImportedZones.length} zones.`);
                    });
                  }}
                >
                  <span className="dv-icon-btn__label">Import All ({draftZones.length})</span>
                </button>
                <button
                  className="dv-icon-btn dv-icon-btn--danger"
                  onClick={() => {
                    setDraftZones([]);
                    draftZonesRef.current = [];
                    draw();
                  }}
                >
                  <span className="dv-icon-btn__label">Clear Drafts</span>
                </button>
              </div>
            )}

          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>

            {/* ── Scale Widget ── */}
            <div className="dv-icon-btn" style={{ cursor: "default", gap: "6px" }}>
              <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>Scale:</span>
              <input type="number" min="4" max="100" value={ppm}
                onChange={e => {
                  const newPpm = Number(e.target.value) || PIXELS_PER_METRE;
                  setPpm(newPpm);
                  ppmRef.current = newPpm;
                  scheduleSave(placedRef.current, zonesRef.current, newPpm);
                  draw();
                }}
                style={{ width: "38px", height: "22px", padding: "2px 4px", background: "var(--bg-elevated)", border: "1px solid var(--border-light)", borderRadius: "4px", color: "var(--text-primary)", fontSize: "13px", fontWeight: "700", textAlign: "center", outline: "none" }}
              />
              <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>px/m</span>
            </div>

            {/* ── Calibration Status Badge ── */}
            {hasFloor && (slides.find(s => s.id === activeSlideId)?.calibration?.enabled || slides.find(s => s.id === activeSlideId)?.modelDataUrl ? (
              <button
                className="dv-icon-btn"
                onClick={slides.find(s => s.id === activeSlideId)?.modelDataUrl ? undefined : setCalibrateMode}
                title={
                  slides.find(s => s.id === activeSlideId)?.modelDataUrl
                    ? "3D layouts are inherently autocalibrated in real-world metric scale (1 unit = 1 meter)."
                    : "Layout scale is calibrated. Click to recalibrate or adjust."
                }
                style={{
                  background: "rgba(16, 185, 129, 0.12)",
                  color: "#10b981",
                  border: "1px solid rgba(16, 185, 129, 0.35)",
                  cursor: slides.find(s => s.id === activeSlideId)?.modelDataUrl ? "default" : "pointer",
                  gap: "5px",
                  padding: "4px 8px"
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="13" height="13">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: "12px", fontWeight: "600" }}>
                  {slides.find(s => s.id === activeSlideId)?.modelDataUrl
                    ? `3D Autocalibrated (${(slides.find(s => s.id === activeSlideId)?.calibration?.ppm || slides.find(s => s.id === activeSlideId)?.ppm || 25.0).toFixed(1)} px/m)`
                    : slides.find(s => s.id === activeSlideId)?.calibration?.mode === "advanced"
                    ? "Calibrated (Advanced)"
                    : `Calibrated (${slides.find(s => s.id === activeSlideId)?.calibration?.ppm ? slides.find(s => s.id === activeSlideId).calibration.ppm.toFixed(1) : (ppm ? ppm.toFixed(1) : "22.0")} px/m)`}
                </span>
              </button>
            ) : hasFloor ? (
              <button
                className="dv-icon-btn"
                onClick={setCalibrateMode}
                title="This floor plan has no scale calibration. Click to calibrate layout scale."
                style={{
                  background: "#fef3c7",
                  color: "#92400e",
                  border: "1px solid #fcd34d",
                  cursor: "pointer",
                  gap: "4px",
                  padding: "4px 8px"
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span style={{ fontSize: "12px", fontWeight: "600" }}>⚠️ Not calibrated</span>
              </button>
            ) : null)}

            {selectedPlaced && (
              <button className="dv-icon-btn dv-icon-btn--danger" onClick={removeSelected}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
                </svg>
                <span className="dv-icon-btn__label">Remove</span>
              </button>
            )}

            <button
              className={`dv-icon-btn ${showStats ? "dv-icon-btn--active" : ""}`}
              onClick={() => setShowStats(!showStats)}
              title="View proposal summary"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M12 20V10M18 20V4M6 20v-4" />
              </svg>
              <span className="dv-icon-btn__label">Proposal</span>
            </button>

            {/* ── Toolbox Dropdown ── */}
            <div className="dv-icon-drop-wrap">
              <button
                className={`dv-icon-btn ${toolboxOpen ? "dv-icon-btn--active" : ""}`}
                onClick={() => setToolboxOpen(!toolboxOpen)}
                title="Open Toolbox"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                <span className="dv-icon-btn__label">Toolbox</span>
              </button>
             
              {toolboxOpen && (
                <div style={{
                  position: 'absolute',
                  top: "calc(100% + 4px)",
                  right: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-light)',
                  borderRadius: 8,
                  padding: '12px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                  zIndex: 50,
                  width: 200,
                  pointerEvents: 'auto'
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>Camera Icon Size</div>
                    <div style={{ display: "flex", background: "var(--bg-elevated)", borderRadius: 4, overflow: "hidden", alignItems: "center", height: 28, border: '1px solid var(--border-light)', justifyContent: "space-between" }}>
                      <button className="dv-tbtn" onClick={() => { setIconScale(s => Math.max(0.4, s - 0.2)); setTimeout(draw, 0); }} style={{ padding: "4px 8px", background: "transparent", border: "none", height: "100%" }} title="Decrease Icon Size">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                      <span style={{ fontSize: 12, color: "var(--text-primary)" }}>{Math.round(iconScale * 100)}%</span>
                      <button className="dv-tbtn" onClick={() => { setIconScale(s => Math.min(2.0, s + 0.2)); setTimeout(draw, 0); }} style={{ padding: "4px 8px", background: "transparent", border: "none", height: "100%" }} title="Increase Icon Size">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                    </div>
                  </div>

                  {/* Flip Cam */}
                  {selectedPlaced && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <button className="dv-tbtn" onClick={flipSelected} style={{ padding: "6px 8px", width: "100%", justifyContent: "center", background: "var(--bg-elevated)", border: '1px solid var(--border-light)', borderRadius: 4 }} title="Flip Camera Mount">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12" style={{ marginRight: 6 }}><path d="M21 9V3h-6M3 15v6h6M21 3l-7.5 7.5M3 21l7.5-7.5" /></svg>
                        Flip Cam
                      </button>
                    </div>
                  )}

                  <hr style={{ border: 0, borderTop: "1px solid var(--border-light)", margin: "4px 0" }} />

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>Shapes & Obstacles</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                      {["Rectangle", "Circle", "Triangle", "Hexagon", "Diamond", "Star", "Cross", "Arrow", "L-Shape", "T-Shape", "U-Shape", "Boom Barrier"].map(shape => {
                        const isBoom = shape === "Boom Barrier";
                        return (
                          <button
                            key={shape}
                            className="dv-tbtn"
                            onClick={() => addShapeToCanvas(shape)}
                            style={{
                              padding: "6px 0",
                              justifyContent: "center",
                              background: isBoom ? "#ef444422" : "var(--bg-elevated)",
                              border: isBoom ? '1px solid #ef4444' : '1px solid var(--border-light)',
                              color: isBoom ? "#ef4444" : "var(--text-secondary)",
                              borderRadius: 4
                            }}
                            title={`Add ${shape}${isBoom ? " (Blocks camera FOV)" : ""}`}
                          >
                            {SHAPE_ICONS[shape]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <hr style={{ border: 0, borderTop: "1px solid var(--border-light)", margin: "4px 0" }} />

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>Text Box Options</div>
                    
                    <div style={{ display: "flex", gap: 8 }}>
                      <input type="color" value={tbFontColor} onChange={e => {
                        const val = e.target.value;
                        setTbFontColor(val);
                        const activeId = editingTextNodeRef.current || selectedTextNodeRef.current;
                        if (activeId) {
                          recordState();
                          const updated = textNodesRef.current.map(n => n.id === activeId ? { ...n, color: val } : n);
                          textNodesRef.current = updated;
                          setTextNodes(updated);
                          draw();
                        }
                      }} style={{ width: 24, height: 24, padding: 0, border: "none", borderRadius: 4, cursor: "pointer", background: "transparent" }} title="Font Color" />
                     
                      <div style={{ display: "flex", alignItems: "center", background: "var(--bg-elevated)", border: "1px solid var(--border-light)", borderRadius: 4, padding: "0 4px" }}>
                        <input type="number" min="8" max="120" value={tbFontSize} onChange={e => {
                          const val = Number(e.target.value);
                          setTbFontSize(val);
                          const activeId = editingTextNodeRef.current || selectedTextNodeRef.current;
                          if (activeId) {
                            recordState();
                            const updated = textNodesRef.current.map(n => n.id === activeId ? { ...n, size: val } : n);
                            textNodesRef.current = updated;
                            setTextNodes(updated);
                            draw();
                          }
                        }} style={{ width: 36, background: "transparent", border: "none", color: "var(--text-primary)", fontSize: 12, outline: "none", textAlign: "center" }} title="Font Size" />
                        <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>px</span>
                      </div>
                    </div>

                    <select value={tbFontStyle} onChange={e => {
                      const val = e.target.value;
                      setTbFontStyle(val);
                      const activeId = editingTextNodeRef.current || selectedTextNodeRef.current;
                      if (activeId) {
                        recordState();
                        const updated = textNodesRef.current.map(n => n.id === activeId ? { ...n, font: val } : n);
                        textNodesRef.current = updated;
                        setTextNodes(updated);
                        draw();
                      }
                    }} style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border-light)", borderRadius: 4, padding: "4px 8px", color: "var(--text-primary)", fontSize: 12, outline: "none", cursor: "pointer" }}>
                      {["Arial", "Verdana", "Courier New", "Times New Roman", "Georgia", "Impact", "Tahoma", "Trebuchet MS", "Comic Sans MS", "Lucida Console"].map(font => (
                        <option key={font} value={font} style={{ color: "var(--text-primary)", background: "var(--bg-surface)" }}>{font}</option>
                      ))}
                    </select>

                    <button
                      className="dv-tbtn"
                      onClick={() => {
                        const canvasWidth = canvasRef.current?.width || 800;
                        const canvasHeight = canvasRef.current?.height || 600;
                        const cx = ((canvasWidth / 2) - offsetRef.current.x) / scaleRef.current;
                        const cy = ((canvasHeight / 2) - offsetRef.current.y) / scaleRef.current;
                        recordState();
                        const newNodes = [...textNodesRef.current, { id: "text_" + Date.now(), text: "Double-click to edit", x: cx, y: cy, color: tbFontColor, size: tbFontSize, font: tbFontStyle }];
                        setTextNodes(newNodes);
                        textNodesRef.current = newNodes;
                        draw();
                      }}
                      style={{ padding: "6px 8px", width: "100%", justifyContent: "center", background: "#3b82f622", border: '1px solid #3b82f6', color: "#60a5fa", borderRadius: 4, marginTop: 4 }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ marginRight: 6 }}><path d="M12 5v14M5 12h14" /></svg>
                      Add Text
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              className="dv-icon-btn"
              onClick={handleManualSave}
              title="Save layout version"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              <span className="dv-icon-btn__label">Save Layout</span>
            </button>

            <button
              className="dv-icon-btn dv-icon-btn--danger"
              onClick={clearFloorCameras}
              title="Remove all cameras from floor (keeps floor plan)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
              </svg>
              <span className="dv-icon-btn__label">Clear Layout</span>
            </button>
          </div>

        </div>
      </div>

      {/* ── Body ── */}
      <div className="dv-body">

        {/* ── Left Sidebar (Layout Slides like PowerPoint/Docs) ── */}
        <div
          className="dv-slides-sidebar"
          style={{
            width: isSidebarCollapsed ? "40px" : "220px",
            background: "var(--bg-base)",
            borderRight: "0.5px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            overflow: "hidden",
            userSelect: "none",
            transition: "width 0.3s ease"
          }}
        >
          {/* Toggle Button & Header */}
          <div
            style={{
              padding: isSidebarCollapsed ? "12px" : "12px 14px",
              borderBottom: "0.5px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: isSidebarCollapsed ? "center" : "space-between"
            }}
          >
            {!isSidebarCollapsed && (
              <span style={{
                fontSize: "11px",
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "#7a8499"
              }}>
                Floor Drafts ({slides.length})
              </span>
            )}
            
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {!isSidebarCollapsed && (
                <button
                  onClick={() => addNewSlide(null)}
                  style={{
                    background: "rgba(59, 130, 246, 0.15)",
                    border: "1px solid rgba(59, 130, 246, 0.4)",
                    borderRadius: "4px",
                    color: "#60a5fa",
                    fontSize: "10px",
                    padding: "2px 6px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "2px",
                    transition: "all 0.15s ease"
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(59, 130, 246, 0.25)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(59, 130, 246, 0.15)"; }}
                  title="Add a new blank floor layout draft"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="10" height="10">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  New
                </button>
              )}
              <button
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#60a5fa",
                  padding: "0",
                  cursor: "pointer",
                  display: "flex",
                  outline: "none"
                }}
                title={isSidebarCollapsed ? "Open Sidebar" : "Close Sidebar"}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  {isSidebarCollapsed ? (
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  ) : (
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "10px",
              display: isSidebarCollapsed ? "none" : "flex",
              flexDirection: "column",
              gap: "12px",
              scrollbarWidth: "thin",
              scrollbarColor: "#2e3d55 transparent"
            }}
          >
            {slides.map((slide, sIdx) => {
              const isActive = slide.id === activeSlideId;
              const camCount = slide.placed?.length || 0;
              const zoneCount = slide.zones?.length || 0;

              return (
                <div key={slide.id} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div
                    onClick={() => switchSlide(slide.id)}
                    style={{
                      display: "flex",
                      gap: "8px",
                      cursor: "pointer",
                      position: "relative",
                      transition: "all 0.2s ease",
                      padding: "4px",
                      borderRadius: "6px",
                      background: isActive ? "rgba(59, 130, 246, 0.05)" : "transparent"
                    }}
                  >
                  {/* Slide index number */}
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      color: isActive ? "var(--teal)" : "var(--text-muted)",
                      width: "14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    {sIdx + 1}
                  </div>

                  {/* Thumbnail Card Frame */}
                  <div
                    className={`dv-slide-card ${isActive ? "active" : ""}`}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      background: "var(--bg-elevated)",
                      border: isActive ? "1.5px solid var(--teal)" : "1px solid var(--border)",
                      borderRadius: "6px",
                      overflow: "hidden",
                      transition: "all 0.15s ease",
                      boxShadow: isActive ? "0 0 10px rgba(16, 185, 129, 0.15)" : "none"
                    }}
                    onMouseEnter={e => {
                      if (!isActive) {
                        e.currentTarget.style.borderColor = "var(--border-light)";
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        e.currentTarget.style.borderColor = "var(--border)";
                      }
                    }}
                  >
                    {/* Thumbnail Image area */}
                    <div
                      style={{
                        height: "80px",
                        background: "var(--bg-hover)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        borderBottom: "1px solid var(--border)",
                        overflow: "hidden"
                      }}
                    >
                      {slide.modelDataUrl && (
                        <div style={{
                          position: "absolute",
                          top: "4px",
                          left: "4px",
                          background: "rgba(29, 158, 117, 0.9)",
                          color: "#fff",
                          fontSize: "8.5px",
                          fontWeight: "800",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          letterSpacing: "0.5px",
                          zIndex: 2
                        }}>
                          3D
                        </div>
                      )}

                      {slide.floorPlan ? (
                        <img
                          src={slide.floorPlan}
                          alt={slide.name}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            opacity: 0.85
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "4px",
                            color: "var(--text-muted)"
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                          <span style={{ fontSize: "9px" }}>No Floor Plan</span>
                        </div>
                      )}

                      {/* Floating actions menu (e.g. Delete button on hover) */}
                      {slides.length > 1 && (
                        <button
                          onClick={(e) => deleteSlide(slide.id, e)}
                          style={{
                            position: "absolute",
                            top: "4px",
                            right: "4px",
                            background: "rgba(239, 68, 68, 0.8)",
                            border: "none",
                            borderRadius: "4px",
                            color: "#ffffff",
                            padding: "2px",
                            cursor: "pointer",
                            opacity: 0,
                            transition: "opacity 0.15s ease",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}
                          className="dv-slide-delete-btn"
                          title="Delete layout draft"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Thumbnail description info */}
                    <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: "2px" }}>
                      {editingSlideId === slide.id ? (
                        <input
                          type="text"
                          value={editingSlideName}
                          onChange={e => setEditingSlideName(e.target.value)}
                          onBlur={() => {
                            if (editingSlideName.trim()) {
                              renameSlide(slide.id, editingSlideName.trim());
                            }
                            setEditingSlideId(null);
                          }}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              if (editingSlideName.trim()) {
                                renameSlide(slide.id, editingSlideName.trim());
                              }
                              setEditingSlideId(null);
                            } else if (e.key === "Escape") {
                              setEditingSlideId(null);
                            }
                          }}
                          onClick={e => e.stopPropagation()}
                          autoFocus
                          style={{
                            background: "var(--bg-base)",
                            border: "1px solid var(--teal)",
                            borderRadius: "3px",
                            color: "var(--text-primary)",
                            fontSize: "11px",
                            padding: "1px 4px",
                            width: "100%",
                            outline: "none"
                          }}
                        />
                      ) : (
                        <div
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingSlideId(slide.id);
                            setEditingSlideName(slide.name);
                          }}
                          style={{
                            fontSize: "11px",
                            fontWeight: "600",
                            color: isActive ? "var(--teal)" : "var(--text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between"
                          }}
                          title="Double click to rename"
                        >
                          <span>{slide.name}</span>
                          <svg
                            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10"
                            style={{ opacity: 0.3, cursor: "pointer" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingSlideId(slide.id);
                              setEditingSlideName(slide.name);
                            }}
                          >
                            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        </div>
                      )}

                      {/* Counts stats line */}
                      <div style={{ fontSize: "9.5px", color: "var(--text-secondary)", marginTop: "2px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>{camCount} Cam{camCount !== 1 ? "s" : ""} • {zoneCount} Zone{zoneCount !== 1 ? "s" : ""}</span>
                        {slide.versions && slide.versions.length > 0 && (
                          <div
                            onClick={(e) => { e.stopPropagation(); setExpandedVersions(prev => ({ ...prev, [slide.id]: !prev[slide.id] })); }}
                            style={{ cursor: "pointer", padding: "2px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}
                            title={expandedVersions[slide.id] ? "Hide versions" : "Show versions"}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"
                              style={{ transition: "transform 0.2s", transform: expandedVersions[slide.id] ? "rotate(180deg)" : "rotate(0deg)" }}
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Versions Tree */}
                {slide.versions && slide.versions.length > 0 && expandedVersions[slide.id] && (
                  <div style={{ paddingLeft: "28px", display: "flex", flexDirection: "column", gap: "4px", position: "relative", paddingBottom: "4px" }}>
                      <div style={{ position: "absolute", left: "14px", top: 0, bottom: "14px", width: "1px", background: "var(--border-light)" }}></div>
                      {slide.versions.map((v, vIdx) => (
                        <div
                          key={v.id}
                          onClick={(e) => { e.stopPropagation(); restoreVersion(slide.id, v.id); }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            fontSize: "12px",
                            color: "var(--text-primary)",
                            cursor: "pointer",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            background: "var(--bg-elevated)",
                            position: "relative",
                            border: "0.5px solid var(--border-light)",
                            transition: "all 0.15s"
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.borderColor = "var(--teal)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-elevated)"; e.currentTarget.style.borderColor = "var(--border-light)"; }}
                          title={`Restore ${v.name}`}
                        >
                          <div style={{ position: "absolute", left: "-14px", top: "50%", width: "10px", height: "1px", background: "var(--border-light)" }}></div>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" style={{ flexShrink: 0, color: "var(--text-muted)" }}>
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                            <polyline points="17 21 17 13 7 13 7 21" />
                            <polyline points="7 3 7 8 15 8" />
                          </svg>

                          {editingVersionId === v.id ? (
                            <input
                              type="text"
                              value={editingVersionName}
                              onChange={e => setEditingVersionName(e.target.value)}
                              onBlur={() => {
                                renameVersion(slide.id, v.id, editingVersionName);
                                setEditingVersionId(null);
                              }}
                              onKeyDown={e => {
                                if (e.key === "Enter") {
                                  renameVersion(slide.id, v.id, editingVersionName);
                                  setEditingVersionId(null);
                                } else if (e.key === "Escape") {
                                  setEditingVersionId(null);
                                }
                              }}
                              onClick={e => e.stopPropagation()}
                              autoFocus
                              style={{
                                background: "var(--bg-input)", border: "1px solid var(--teal)", borderRadius: "3px", color: "var(--text-primary)",
                                fontSize: "12px", padding: "1px 4px", width: "100%", outline: "none"
                              }}
                            />
                          ) : (
                            <>
                              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                              <span style={{ fontSize: "10px", color: "var(--text-secondary)", flexShrink: 0 }}>
                                ({v.placed ? v.placed.length : 0})
                              </span>
                              <svg
                                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10"
                                style={{ opacity: 0.6, cursor: "pointer", flexShrink: 0, marginLeft: "4px", color: "var(--text-secondary)" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingVersionId(v.id);
                                  setEditingVersionName(v.name);
                                }}
                                title="Rename version"
                              >
                                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                              </svg>
                              <svg
                                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10"
                                style={{ opacity: 0.8, cursor: "pointer", flexShrink: 0, marginLeft: "4px", color: "#ef4444" }}
                                onMouseEnter={e => e.currentTarget.style.opacity = 1}
                                onMouseLeave={e => e.currentTarget.style.opacity = 0.8}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteVersion(slide.id, v.id);
                                }}
                                title="Delete version"
                              >
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                              <span style={{ fontSize: "9px", color: "var(--text-muted)", flexShrink: 0, marginLeft: "4px" }}>
                                {new Date(v.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              </span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Spec detail panel ── */}
        {selectedModel && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            width: 258,
            borderLeft: "0.5px solid var(--border)",
            borderRight: "0.5px solid var(--border)",
            background: "var(--bg-surface)",
            flexShrink: 0,
            position: "absolute",
            top: 0,
            bottom: 0,
            right: inspectorExpanded ? 280 : 48,
            zIndex: 109,
            boxShadow: "-8px 0 24px rgba(0,0,0,0.35)",
            transition: "right 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
          }}>
            <SpecPanel camera={selectedModel} onClose={() => setSelectedModel(null)} />
            <div className="dv-fov-overlay-panel">
              <div className="dv-fov-overlay__label">{selectedModel.model}</div>
              <FovVisualizer camera={selectedModel} />
            </div>
          </div>
        )}

        {/* ── Slide-out Tabbed Right Inspector Panel ── */}
        <div className={`dv-inspector ${inspectorExpanded ? "dv-inspector--expanded" : ""}`}>
          {!inspectorExpanded && (
            <button
              className="dv-inspector-toggle"
              onClick={() => setInspectorExpanded(true)}
              title="Expand Inspector"
            >
              ←
              <span className="dv-inspector-toggle__text">Inspector</span>
            </button>
          )}

          {inspectorExpanded && (
            <div className="dv-inspector-container">
              {/* Tab Selector */}
              <div className="dv-inspector-tabs" style={{ position: "relative", paddingRight: "36px" }}>
                <button
                  className={`dv-inspector-tab ${inspectorTab === "cameras" ? "dv-inspector-tab--active" : ""}`}
                  onClick={() => setInspectorTab("cameras")}
                >
                  Library ({filteredCameras.length})
                </button>
                <button
                  className={`dv-inspector-tab ${inspectorTab === "placed" ? "dv-inspector-tab--active" : ""}`}
                  onClick={() => setInspectorTab("placed")}
                >
                  Placed ({placed.length})
                </button>
                <button
                  className={`dv-inspector-tab ${inspectorTab === "zones" ? "dv-inspector-tab--active" : ""}`}
                  onClick={() => setInspectorTab("zones")}
                >
                  Zones ({zones.length})
                </button>
               
                {/* Close Cross Button */}
                <button
                  className="dv-inspector-close-btn"
                  onClick={() => { setInspectorExpanded(false); setSelectedModel(null); }}
                  title="Collapse Inspector"
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "rgba(255, 255, 255, 0.5)",
                    fontSize: "18px",
                    fontWeight: "750",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "4px 6px",
                    borderRadius: "4px",
                    transition: "all 0.15s ease"
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Tab Content */}
              <div className="dv-inspector-content">
                {inspectorTab === "placed" ? (
                  <div className="dv-inspector-flow">
                    <div className="dv-inspector-section-title">Placed Cameras</div>
                    <div className="dv-zone-scroller">
                      {placed.length === 0 ? (
                        <div style={{ padding: "10px 8px", fontSize: 14, color: "rgba(255, 255, 255, 0.5)", textAlign: "center" }}>
                          No cameras placed
                        </div>
                      ) : (
                        placed.map((p, idx) => {
                          const col = TYPE_COLORS[p.camera.type] || "#3b82f6";
                          const isSelected = selectedIdx === idx;
                          const isHighlit = highlightedCamId === p.id || isSelected;
                          return (
                            <div
                              key={p.id}
                              style={{
                                display: "flex", flexDirection: "column",
                                background: isSelected ? col + "22" : (isHighlit ? col + "11" : "transparent"),
                                borderLeft: isSelected || isHighlit ? `3px solid ${col}` : "3px solid transparent",
                                marginBottom: 2, padding: "8px 10px", cursor: "pointer", transition: "all 0.15s"
                              }}
                              onClick={() => {
                                setSelectedIdx(idx);
                                setSelectedModel(p.camera);
                                setIsSettingsMinimized(false);
                                handleHighlightCam(p.id);
                              }}
                            >
                               <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <CameraIcon type={p.camera.type} size={18} color={col} />
                                  <input
                                    type="text"
                                    value={p.customName !== undefined ? p.customName : p.camera.model}
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => {
                                      const updated = [...placedRef.current];
                                      updated[idx] = { ...updated[idx], customName: e.target.value };
                                      setPlaced(updated);
                                      placedRef.current = updated;
                                    }}
                                    onBlur={() => {
                                      scheduleSave(placedRef.current, zonesRef.current, ppmRef.current);
                                      draw();
                                    }}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') e.target.blur();
                                    }}
                                    style={{ flex: 1, background: "transparent", border: "none", borderBottom: "1px solid var(--border-light)", color: "var(--text-primary)", fontSize: 15, outline: "none", minWidth: 0 }}
                                  />
                                  <button onClick={(e) => { e.stopPropagation(); handleRemoveCamFromZone(p.id); }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}>✕</button>
                               </div>
                               <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4, marginLeft: 26 }}>
                                  {p.camera.brand} · {p.camera.megapixels}MP · {p.camera.type}
                                </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : inspectorTab === "cameras" ? (
                  <div className="dv-inspector-flow">
                    <div className="dv-inspector-section-title">Available Devices</div>
                   
                    {/* Brand and Type Custom Dropdowns */}
                    <div className="dv-library__filters" style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
                      <input className="dv-search" placeholder="Search models…"
                        value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ padding: "6px 8px", background: "var(--bg-surface)", border: "1px solid var(--border-light)", borderRadius: 4, color: "var(--text-primary)", fontSize: 15, outline: "none" }} />
                      <div className="dv-filter-row" style={{ display: "flex", gap: "5px" }}>
                        {/* Custom Brand Dropdown */}
                        <div className="dv-custom-select-wrap" style={{ position: "relative", flex: 1 }}>
                          <button
                            className="dv-select"
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left" }}
                            onClick={() => { setBrandMenuOpen(!brandMenuOpen); setTypeMenuOpen(false); }}
                          >
                            <span>{brandFilter || "Brand"}</span>
                            <span style={{ fontSize: "12px", opacity: 0.7 }}>▼</span>
                          </button>
                          {brandMenuOpen && (
                            <div className="dv-custom-dropdown" style={{
                              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                              background: "var(--bg-surface)", border: "1.5px solid var(--border-light)", borderRadius: "5px",
                              maxHeight: "180px", overflowY: "auto", zIndex: 100, padding: "4px",
                              boxShadow: "0 8px 24px rgba(0,0,0,0.15)"
                            }}>
                              <button
                                className="dv-custom-dropdown-item"
                                style={{
                                  width: "100%", background: "none", border: "none", color: "var(--text-secondary)",
                                  padding: "6px 8px", textAlign: "left", fontSize: "15px", cursor: "pointer",
                                  borderRadius: "4px", display: "block"
                                }}
                                onClick={() => { setBrandFilter(null); setBrandMenuOpen(false); }}
                              >
                                All Brands
                              </button>
                              {brands.map(b => (
                                <button
                                  key={b}
                                  className="dv-custom-dropdown-item"
                                  style={{
                                    width: "100%", background: b === brandFilter ? "var(--teal-subtle)" : "none",
                                    border: "none", color: b === brandFilter ? "var(--teal)" : "var(--text-secondary)",
                                    padding: "6px 8px", textAlign: "left", fontSize: "15px", cursor: "pointer",
                                    borderRadius: "4px", display: "block"
                                  }}
                                  onClick={() => { setBrandFilter(b); setBrandMenuOpen(false); }}
                                >
                                  {b}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Custom Type Dropdown */}
                        <div className="dv-custom-select-wrap" style={{ position: "relative", flex: 1 }}>
                          <button
                            className="dv-select"
                            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", textAlign: "left" }}
                            onClick={() => { setTypeMenuOpen(!typeMenuOpen); setBrandMenuOpen(false); }}
                          >
                            <span>
                              {typeFilter ? `${TYPE_ICONS[typeFilter]} ${typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1)}` : "Type"}
                            </span>
                            <span style={{ fontSize: "12px", opacity: 0.7 }}>▼</span>
                          </button>
                          {typeMenuOpen && (
                            <div className="dv-custom-dropdown" style={{
                              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                              background: "var(--bg-surface)", border: "1.5px solid var(--border-light)", borderRadius: "5px",
                              zIndex: 100, padding: "4px", boxShadow: "0 8px 24px rgba(0,0,0,0.15)"
                            }}>
                              <button
                                className="dv-custom-dropdown-item"
                                style={{
                                  width: "100%", background: "none", border: "none", color: "var(--text-secondary)",
                                  padding: "6px 8px", textAlign: "left", fontSize: "15px", cursor: "pointer",
                                  borderRadius: "4px", display: "block"
                                }}
                                onClick={() => { setTypeFilter(null); setTypeMenuOpen(false); }}
                              >
                                All Types
                              </button>
                              {["dome", "bullet", "ptz", "fisheye", "box", "thermal"].map(t => (
                                <button
                                  key={t}
                                  className="dv-custom-dropdown-item"
                                  style={{
                                    width: "100%", background: t === typeFilter ? "var(--teal-subtle)" : "none",
                                    border: "none", color: t === typeFilter ? "var(--teal)" : "var(--text-secondary)",
                                    padding: "6px 8px", textAlign: "left", fontSize: "15px", cursor: "pointer",
                                    borderRadius: "4px", display: "block"
                                  }}
                                  onClick={() => { setTypeFilter(t); setTypeMenuOpen(false); }}
                                >
                                  {TYPE_ICONS[t]} {t.charAt(0).toUpperCase() + t.slice(1)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Camera Model List */}
                    <div className="dv-model-list" style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
                      {filteredCameras.length === 0 && (
                        <div className="dv-model-empty">
                          {brandFilter ? "No cameras match your filters." : "Please select a brand to view available camera models."}
                        </div>
                      )}
                      {filteredCameras.map(cam => (
                        <ModelCard key={cam.id} camera={cam}
                          onDragStart={setDragCamera}
                          onSelect={c => setSelectedModel(prev => prev?.id === c.id ? null : c)}
                          isSelected={selectedModel?.id === cam.id}
                        />
                      ))}
                    </div>

                    {!selectedModel && (
                      <div className="dv-cam-selector__hint dv-cam-selector__hint--empty"
                        style={{ padding: "6px 10px 8px", borderTop: "1px solid #1e2d3e", marginTop: 4, fontSize: 14, color: "rgba(255, 255, 255, 0.5)", textAlign: "center" }}>
                        Drag a card onto the canvas to place · Click to preview FOV
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="dv-inspector-flow">
                    <div className="dv-inspector-section-title">Floor Zones</div>
                   
                    <div className="dv-zone-scroller">
                      {zones.length === 0 ? (
                        <div style={{ padding: "10px 8px", fontSize: 14, color: "rgba(255, 255, 255, 0.5)", textAlign: "center" }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="22" height="22" style={{ opacity: 0.25, display: "block", margin: "0 auto 6px" }}>
                            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                          </svg>
                          No zones yet
                        </div>
                      ) : (
                        zones.map(zone => (
                          <DvZoneSidebarItem
                            key={zone.id}
                            zone={zone}
                            placed={placed}
                            isActive={activeZoneId === zone.id}
                            highlightedId={highlightedCamId}
                            onSelect={handleSelectZone}
                            onDelete={handleDeleteZone}
                            onRename={handleRenameZone}
                            onHighlightCam={handleHighlightCam}
                            onRemoveCam={handleRemoveCamFromZone}
                            sidebarExpanded={true}
                            onContextMenu={(e) => onSidebarZoneContextMenu(e, zone)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Canvas ── */}
        <div className="dv-canvas-wrap" ref={wrapRef}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          style={{ position: "relative", zIndex: 1 }}
        >
          {slides.find(s => s.id === activeSlideId)?.modelDataUrl ? (
            <Gltf3DViewer
              ref={gltfViewerRef}
              modelUrl={slides.find(s => s.id === activeSlideId).modelDataUrl}
              markers={gltfMarkers}
              cameras={gltfCameras}
              showHeatmap={showHeatmap}
              iconScale={iconScale}
              showPpm={showPpm}
              showMetricsVisibility={showMetricsVisibility}
              isPanLocked={isPanLocked}
              selectedIdx={selectedIdx}
              onSelectCamera={(idx) => {
                setSelectedIdx(idx);
                if (placedRef.current && placedRef.current[idx]) {
                  setSelectedModel(placedRef.current[idx].camera);
                }
              }}
              imageSize={{
                width: slides.find(s => s.id === activeSlideId)?.imageWidth || floorImgRef.current?.width || 2048,
                height: slides.find(s => s.id === activeSlideId)?.imageHeight || floorImgRef.current?.height || 2048
              }}
              updateMarkers={handleUpdate3DMarkers}
            />
          ) : (
            <>
              {/* Calibration Overlay */}
              {(calibRefs.length > 0 || drawingCalibLine) && (
                <CalibrationOverlay
                  references={calibRefs}
                  activeRefId={activeCalibRefId}
                  drawingLine={drawingCalibLine}
                  scale={scaleRef.current || 1}
                  offset={offsetRef.current || { x: 0, y: 0 }}
                  calibType={calibType}
                  showGrid={showPreviewGrid}
                  imageDimensions={{
                    width: floorImgRef.current?.width || 2000,
                    height: floorImgRef.current?.height || 2000
                  }}
                />
              )}

              {/* Zone Edit Toolbars */}
              {zones.map(z => {
                if (z.polygon.length < 3) return null;
                let sumX = 0; let sumY = 0;
                z.polygon.forEach(pt => { sumX += pt.x; sumY += pt.y; });
                const centroidX = sumX / z.polygon.length;
                const centroidY = sumY / z.polygon.length;

                const sc = scaleRef.current || 1;
                const ox = offsetRef.current?.x || 0;
                const oy = offsetRef.current?.y || 0;
                
                // Place at the first vertex
                const firstPt = z.polygon[0];
                const screenX = firstPt.x * sc + ox - 10;
                const screenY = firstPt.y * sc + oy - 10;
                
                const isEditing = editZoneId === z.id;

                return (
                  <div key={`edit_tb_${z.id}`} style={{
                    position: "absolute", left: screenX, top: screenY,
                    transform: "translate(-100%, -100%)", display: "flex", gap: "2px",
                    background: "var(--bg-elevated)", padding: "2px 4px",
                    backdropFilter: "blur(4px)",
                    borderRadius: "3px", border: `1px solid ${z.color}`,
                    boxShadow: "var(--shadow-md)", zIndex: 90, pointerEvents: "auto",
                    alignItems: "center"
                  }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditZoneId(isEditing ? null : z.id); draw(); }}
                      style={{ background: "none", border: "none", color: isEditing ? "var(--purple)" : "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}
                      title={isEditing ? "Done Editing" : "Edit Zone"}
                    >
                      {isEditing ? (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      ) : (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                      )}
                    </button>
                    {isEditing && (
                      <>
                        <div
                          onMouseDown={(e) => {
                            e.stopPropagation(); e.preventDefault();
                            const startX = e.clientX;
                            const initialPolygon = JSON.parse(JSON.stringify(z.polygon));
                            const onMove = (moveEvent) => {
                              const dx = moveEvent.clientX - startX;
                              const scaleFactor = Math.max(0.1, 1 + dx / 100);
                              const updated = zonesRef.current.map(zone => {
                                if (zone.id === z.id) {
                                  return { ...zone, polygon: initialPolygon.map(pt => ({ x: centroidX + (pt.x - centroidX) * scaleFactor, y: centroidY + (pt.y - centroidY) * scaleFactor })) };
                                }
                                return zone;
                              });
                              zonesRef.current = updated;
                              setZones(updated);
                              draw();
                            };
                            const onUp = () => {
                              window.removeEventListener("mousemove", onMove);
                              window.removeEventListener("mouseup", onUp);
                              if (typeof scheduleSave === 'function') scheduleSave(placedRef.current, zonesRef.current, ppmRef.current);
                            };
                            window.addEventListener("mousemove", onMove);
                            window.addEventListener("mouseup", onUp);
                          }}
                          style={{ background: "none", border: "none", color: "#3b82f6", cursor: "ew-resize", display: "flex", alignItems: "center" }}
                          title="Drag to Scale"
                        >
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              <canvas ref={canvasRef} className="dv-canvas"
                style={{ cursor: mode === "pan" ? "grab" : undefined }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                onDoubleClick={onDoubleClick}
                onContextMenu={onContextMenu}
              />
            </>
          )}

          {/* Layout Calibration Control Panel */}
          {mode === "calibrate" && calibPanelOpen && (
            <CalibrationPanel
              isOpen={calibPanelOpen}
              calibType={calibType}
              onSelectCalibType={(t) => {
                setCalibType(t);
                calibTypeRef.current = t;
                if (t === "standard" && calibRefs.length > 1) {
                  setCalibRefs([calibRefs[0]]);
                  calibRefsRef.current = [calibRefs[0]];
                  setActiveCalibRefId(calibRefs[0].id);
                  activeCalibRefIdRef.current = calibRefs[0].id;
                }
              }}
              references={calibRefs}
              activeRefId={activeCalibRefId}
              isDrawingRef={Boolean(drawingCalibLine)}
              showPreviewGrid={showPreviewGrid}
              onTogglePreviewGrid={() => setShowPreviewGrid(prev => !prev)}
              onStartAddRef={() => {}}
              onUpdateRefDistance={(refId, realDist, unit) => {
                const updated = calibRefs.map(r => {
                  if (r.id !== refId) return r;
                  const meters = unit === "feet" ? realDist * 0.3048 : realDist;
                  return {
                    ...r,
                    realDistance: realDist,
                    unit,
                    realDistanceMeters: meters,
                  };
                });
                setCalibRefs(updated);
                calibRefsRef.current = updated;
              }}
              onDeleteRef={(refId) => {
                const updated = calibRefs.filter(r => r.id !== refId);
                setCalibRefs(updated);
                calibRefsRef.current = updated;
                if (activeCalibRefId === refId) {
                  setActiveCalibRefId(null);
                  activeCalibRefIdRef.current = null;
                }
              }}
              onSelectRef={(refId) => {
                setActiveCalibRefId(refId);
                activeCalibRefIdRef.current = refId;
              }}
              onApplyCalibration={handleApplyCalibration}
              onClearCalibration={handleClearCalibration}
              onClose={() => {
                setCalibPanelOpen(false);
                setMode("place");
                modeRef.current = "place";
                draw();
              }}
              imageDimensions={
                floorImgRef.current
                  ? { width: floorImgRef.current.width, height: floorImgRef.current.height }
                  : { width: 2000, height: 2000 }
              }
            />
          )}

          {/* ── Google Map Inside Canvas ── */}
          {showEarthMap && (
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, backgroundColor: "#000", overflow: "hidden", borderRadius: "8px" }}>
              <div style={{ position: "absolute", top: "16px", left: "16px", zIndex: 101, display: "flex", gap: "10px" }}>
                <button 
                  onClick={(e) => { e.stopPropagation(); setShowEarthMap(false); }}
                  style={{ background: "#1e293b", color: "#f8fafc", border: "1px solid #475569", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontWeight: "600", boxShadow: "0 4px 6px rgba(0,0,0,0.3)" }}
                >
                  ← Back to Designer
                </button>
                <a 
                  href="https://earth.google.com/web/" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  onClick={e => e.stopPropagation()}
                  style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.3)", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontWeight: "600", textDecoration: "none", boxShadow: "0 4px 6px rgba(0,0,0,0.3)", display: "flex", alignItems: "center" }}
                >
                  Open Full Google Earth ↗
                </a>
              </div>
              <iframe 
                src="https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d15000000!2d0!3d0!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e1!3m2!1sen!2sus!4v1717616110000!5m2!1sen!2sus" 
                width="100%" 
                height="100%" 
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                title="Google Map"
              />
            </div>
          )}

          {editingTextNode && (() => {
            const node = textNodes.find(n => n.id === editingTextNode);
            if (!node) return null;
            const sc = scaleRef.current;
            const ox = offsetRef.current.x;
            const oy = offsetRef.current.y;
            const top = node.y * sc + oy;
            const left = node.x * sc + ox;
            return (
              <input
                autoFocus
                type="text"
                defaultValue={node.text === "Double-click to edit" ? "" : node.text}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const val = e.target.value;
                    const originalText = node.text === "Double-click to edit" ? "" : node.text;
                    if (val !== originalText) {
                      recordState();
                    }
                    if (val.trim() === "") {
                      const updated = textNodesRef.current.filter(n => n.id !== editingTextNode);
                      textNodesRef.current = updated;
                      setTextNodes(updated);
                    } else {
                      const updated = [...textNodesRef.current];
                      const idx = updated.findIndex(n => n.id === editingTextNode);
                      if (idx >= 0) updated[idx] = { ...updated[idx], text: val };
                      textNodesRef.current = updated;
                      setTextNodes(updated);
                    }
                    setEditingTextNode(null);
                    draw();
                  } else if (e.key === 'Escape') {
                    setEditingTextNode(null);
                  }
                }}
                onBlur={(e) => {
                  const val = e.target.value;
                  const originalText = node.text === "Double-click to edit" ? "" : node.text;
                  if (val !== originalText) {
                    recordState();
                  }
                  if (val.trim() === "") {
                    const updated = textNodesRef.current.filter(n => n.id !== editingTextNode);
                    textNodesRef.current = updated;
                    setTextNodes(updated);
                  } else {
                    const updated = [...textNodesRef.current];
                    const idx = updated.findIndex(n => n.id === editingTextNode);
                    if (idx >= 0) updated[idx] = { ...updated[idx], text: val };
                    textNodesRef.current = updated;
                    setTextNodes(updated);
                  }
                  setEditingTextNode(null);
                  draw();
                }}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: top,
                  left: left,
                  background: 'transparent',
                  border: '1px dashed #3b82f6',
                  color: node.color || '#ffffff',
                  fontSize: `${node.size * sc}px`,
                  fontFamily: node.font ? `"${node.font}", sans-serif` : 'sans-serif',
                  fontWeight: 'bold',
                  outline: 'none',
                  minWidth: '150px',
                  padding: 0,
                  margin: 0,
                  zIndex: 20
                }}
                placeholder="Type text..."
              />
            );
          })()}



          <HeatmapLayer
            markers={heatmapMarkers}
            cameras={heatmapCameras}
            scaleRef={scaleRef}
            offsetRef={offsetRef}
            wrapRef={wrapRef}
            showHeatmap={showHeatmap}
            floorImgRef={floorImgRef}
            activeZone={activeZone}
            zones={zones}
            onlyLegend={Boolean(slides.find(s => s.id === activeSlideId)?.modelDataUrl)}
            onClose={() => setShowHeatmap(false)}
          />

          <DoriLegendCard
            show={showPpm}
            onClose={() => setShowPpm(false)}
            camera={(selectedIdx !== null && placed[selectedIdx]?.camera) || placed[placed.length - 1]?.camera || placed[0]?.camera}
          />

          {hasCropSelection && mode === "crop" && (
            <div style={{ position: "absolute", bottom: "30px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "10px", zIndex: 10 }}>
              <button
                className="dv-btn dv-btn--primary"
                onClick={applyCrop}
                style={{ padding: "10px 20px", fontWeight: "bold", fontSize: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}
              >
                Apply Crop
              </button>
              <button
                className="dv-btn dv-btn--secondary"
                onClick={() => { cropStartRef.current = null; cropEndRef.current = null; setHasCropSelection(false); draw(); }}
                style={{ padding: "10px 20px", fontWeight: "bold", fontSize: "16px", background: "#334155", color: "white", border: "1px solid #475569", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}
              >
                Cancel
              </button>
            </div>
          )}



          {/* Floating Pan Lock Top Banner Badge */}
          {isPanLocked && (
            <div style={{
              position: "absolute",
              top: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(239, 68, 68, 0.92)",
              color: "#ffffff",
              padding: "5px 14px",
              borderRadius: "20px",
              fontSize: "12px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "6px",
              boxShadow: "0 4px 14px rgba(239, 68, 68, 0.4)",
              zIndex: 10,
              pointerEvents: "none"
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13">
                <path d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zm-11 0V7a4 4 0 0 1 8 0v4" />
              </svg>
              Canvas Pan Locked
            </div>
          )}

          {/* Floating Zoom HUD */}
          <div className="dv-zoom-hud">
            <button
              className={`dv-zbtn ${isPanLocked ? "active" : ""}`}
              onClick={togglePanLock}
              title={isPanLocked ? "Pan Locked (Click to unlock canvas panning)" : "Lock Pan (Click to freeze canvas position)"}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "32px",
                height: "30px",
                padding: "0",
                background: isPanLocked ? "rgba(239, 68, 68, 0.28)" : "transparent",
                color: isPanLocked ? "#f87171" : "var(--text-primary)",
                border: isPanLocked ? "1px solid rgba(239, 68, 68, 0.6)" : "1px solid transparent",
                borderRadius: "6px",
                cursor: "pointer",
                boxShadow: isPanLocked ? "0 0 12px rgba(239, 68, 68, 0.45)" : "none",
                transform: isPanLocked ? "scale(1.1)" : "scale(1)",
                transition: "all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)"
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" width="20" height="20" style={{ transition: "transform 0.25s ease" }}>
                {isPanLocked ? (
                  <>
                    <rect x="5" y="11" width="14" height="10" rx="2" ry="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </>
                ) : (
                  <>
                    <rect x="5" y="11" width="14" height="10" rx="2" ry="2" />
                    <path d="M8 11V6a4 4 0 0 1 8 0" />
                  </>
                )}
              </svg>
            </button>
            <div className="dv-zoom-hud-divider" style={{ width: "1px", height: "14px", background: "var(--border-light)", margin: "0 4px" }} />
            <button className="dv-zbtn dv-zbtn--fit" onClick={fitImage}>Fit</button>
            <div className="dv-zoom-hud-divider" style={{ width: "1px", height: "14px", background: "var(--border-light)", margin: "0 4px" }} />
            <button className="dv-zbtn" onClick={() => { const el = wrapRef.current; if (el) applyZoom(-0.2, el.clientWidth / 2, el.clientHeight / 2); }} title="Zoom Out">−</button>
            <div style={{ display: "flex", alignItems: "center" }}>
              <input
                type="number"
                value={zoomPct}
                onChange={e => setZoomPct(Number(e.target.value))}
                onBlur={() => {
                  const el = wrapRef.current; if (!el) return;
                  const W = el.clientWidth, H = el.clientHeight;
                  const prev = scaleRef.current;
                  const nextScale = Math.min(8, Math.max(0.08, zoomPct / 100));
                  const cx = W / 2, cy = H / 2;
                  scaleRef.current = nextScale;
                  offsetRef.current = {
                    x: cx - (cx - offsetRef.current.x) * (nextScale / prev),
                    y: cy - (cy - offsetRef.current.y) * (nextScale / prev),
                  };
                  setZoomPct(Math.round(nextScale * 100)); draw();
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") e.target.blur();
                }}
                className="dv-zoom-input"
                style={{ width: "40px", background: "transparent", border: "none", color: "var(--text-primary)", textAlign: "right", fontSize: "13px", outline: "none", fontWeight: 700 }}
              />
              <span className="dv-zoom-label" style={{ paddingLeft: 2 }}>%</span>
            </div>
            <button className="dv-zbtn" onClick={() => { const el = wrapRef.current; if (el) applyZoom(0.2, el.clientWidth / 2, el.clientHeight / 2); }} title="Zoom In">+</button>
          </div>


          {placed.length === 0 && mode !== "zone" && (
            <div className="dv-drop-hint">
              <div className="dv-drop-hint__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 8v-2M12 18v-2M8 12H6M18 12h-2" />
                </svg>
              </div>
              <p>Drag a camera model from the library onto the floor plan</p>
              <p className="dv-drop-hint__sub">or import a floor plan first</p>
            </div>
          )}

          {mode === "zone" && drawingPoints.length === 0 && (
            <div className="dv-drop-hint">
              <div className="dv-drop-hint__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1" width="48" height="48">
                  <polygon points="3,20 12,4 21,20" />
                  <circle cx="3" cy="20" r="1.5" fill="#f59e0b" />
                  <circle cx="12" cy="4" r="1.5" fill="#f59e0b" />
                  <circle cx="21" cy="20" r="1.5" fill="#f59e0b" />
                </svg>
              </div>
              <p style={{ color: "#f59e0b" }}>Click on the canvas to place zone vertices</p>
              <p className="dv-drop-hint__sub">Click the first point again to close · Press Esc to cancel</p>
            </div>
          )}

          {selectedPlaced && (
            <div className="dv-selected-bar" style={{ pointerEvents: "auto", transition: "all 0.3s ease", ...(isSettingsMinimized ? { width: '48px', height: '48px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: '#1e293b', border: '1px solid #3b82f6', overflow: 'hidden' } : { maxWidth: showConfigDrawer ? 800 : undefined }) }}>
              {isSettingsMinimized ? (
                <button
                  onClick={() => setIsSettingsMinimized(false)}
                  style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', outline: 'none', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Open Camera Settings"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                  </svg>
                </button>
              ) : (
              <>
              {/* Column 1: Camera Basic Info */}
              <div style={{ display: "flex", flexDirection: "column", width: 250, gap: 12, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", width: "100%" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ marginTop: 2 }}>
                      <CameraIcon type={selectedPlaced.camera.type} size={24} color={TYPE_COLORS[selectedPlaced.camera.type]} />
                    </div>
                    <strong style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: "700", lineHeight: 1.3 }}>
                      {selectedPlaced.customName || selectedPlaced.camera.model} <span style={{ fontSize: 12, opacity: 0.6 }}>({selectedPlaced.camera.brand})</span>
                    </strong>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      onClick={() => setShowConfigDrawer(!showConfigDrawer)}
                      style={{
                        background: "none", border: "none", color: "var(--text-muted)",
                        cursor: "pointer", padding: "4px",
                        display: "flex", alignItems: "center", justifyContent: "center", transition: "color 0.15s ease",
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = "var(--text-primary)"}
                      onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
                      title={showConfigDrawer ? "Hide Configuration" : "Configure Camera"}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                        {showConfigDrawer ? (
                          <path d="M4 17l5-5-5-5 M20 17l-5-5 5-5" />
                        ) : (
                          <path d="M9 17l-5-5 5-5 M15 17l5-5-5-5" />
                        )}
                      </svg>
                    </button>
                    <button
                      onClick={() => setIsSettingsMinimized(true)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', outline: 'none', display: 'flex', alignItems: 'center', padding: "4px" }}
                      onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                      title="Minimize Settings"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", background: "var(--bg-elevated)", padding: 12, borderRadius: 8, border: "1px solid var(--border-light)" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>HFOV</span>
                    <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600 }}>{Math.round(selectedPlaced.camera.hfov)}°</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Range</span>
                    <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600 }}>{selectedPlaced.camera.rangeDay} m</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Direction</span>
                    <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600 }}>{Math.round(selectedPlaced.direction)}°</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase" }}>Zone</span>
                    {(() => {
                      const cz = zones.find(z => z.polygon.length >= 3 && pointInPolygon(selectedPlaced.x, selectedPlaced.y, z.polygon));
                      return cz ? (
                        <span style={{ fontSize: 13, color: cz.color, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 100 }}>{cz.name}</span>
                      ) : <span style={{ fontSize: 13, color: "var(--text-muted)" }}>None</span>;
                    })()}
                  </div>
                </div>

                {/* Varifocal zoom slider */}
                {selectedPlaced.camera.isVarifocal && (
                  <div className="dv-selected-bar__zoom" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "rgba(168, 85, 247, 0.1)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(168, 85, 247, 0.2)" }}>
                    <label style={{ fontSize: 13, color: "#c084fc", fontWeight: 700, letterSpacing: "0.03em" }}>ZOOM</label>
                    <input
                      type="range"
                      min={selectedPlaced.camera.focalLength}
                      max={selectedPlaced.camera.focalLengthMax}
                      step="0.1"
                      value={selectedPlaced.currentFocalLength || selectedPlaced.camera.focalLength}
                      onChange={e => handleVarifocalChange(selectedIdx, Number(e.target.value))}
                      style={{ flex: 1, height: 4, cursor: "pointer", accentColor: "#a855f7", margin: "0 10px" }}
                    />
                    <span style={{ fontFamily: "monospace", fontSize: 13, color: "#c084fc", fontWeight: 600 }}>
                      {(selectedPlaced.currentFocalLength || selectedPlaced.camera.focalLength).toFixed(1)} mm
                    </span>
                  </div>
                )}
              </div>

              {/* Column 2: Collapsible Scenario & Accessories Settings */}
              {showConfigDrawer && (
                <div style={{
                  display: "flex", flexDirection: "column",
                  gap: 12, borderLeft: "0.5px solid var(--border)",
                  paddingLeft: 16, width: 280,
                  animation: "dvSlideDown 0.2s ease-out forwards",
                }}>
                  {/* Column 1: Scenarios */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#3b82f6", letterSpacing: "0.05em", textTransform: "uppercase" }}>Recording Scenarios</div>
                   
                    {/* Recording Mode */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 16, color: "var(--text-muted)", fontWeight: "500" }}>Schedule:</span>
                      <select
                        value={selectedPlaced.recordingMode || "continuous"}
                        onChange={e => handleCameraConfigChange(selectedIdx, "recordingMode", e.target.value)}
                        style={{
                          background: "var(--bg-base)", border: "0.5px solid var(--border)", borderRadius: 6,
                          color: "var(--text-primary)", fontSize: 16, padding: "4px 8px", outline: "none", width: 130, height: 28, cursor: "pointer"
                        }}
                      >
                        <option value="continuous">Continuous 24/7</option>
                        <option value="motion20">Motion (20% Act)</option>
                        <option value="motion50">Motion (50% Act)</option>
                        <option value="scheduled">Scheduled (12h)</option>
                      </select>
                    </div>

                    {/* FPS */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 16, color: "var(--text-muted)", fontWeight: "500" }}>Frame Rate:</span>
                      <select
                        value={selectedPlaced.fps || 25}
                        onChange={e => handleCameraConfigChange(selectedIdx, "fps", Number(e.target.value))}
                        style={{
                          background: "var(--bg-base)", border: "0.5px solid var(--border)", borderRadius: 6,
                          color: "var(--text-primary)", fontSize: 16, padding: "4px 8px", outline: "none", width: 130, height: 28, cursor: "pointer"
                        }}
                      >
                        <option value={5}>5 FPS</option>
                        <option value={10}>10 FPS</option>
                        <option value={15}>15 FPS</option>
                        <option value={20}>20 FPS</option>
                        <option value={25}>25 FPS</option>
                        <option value={30}>30 FPS</option>
                      </select>
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ height: "0.5px", background: "var(--border)", margin: "4px 0" }} />

                  {/* Column 2: Accessories */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#a855f7", letterSpacing: "0.05em", textTransform: "uppercase" }}>Mounting & Power</div>
                   
                    {/* Mounting Arm */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: 16, color: "var(--text-muted)", fontWeight: "500" }}>Mounting:</span>
                      <select
                        value={selectedPlaced.mounting || "default"}
                        onChange={e => handleCameraConfigChange(selectedIdx, "mounting", e.target.value)}
                        style={{
                          background: "var(--bg-base)", border: "0.5px solid var(--border)", borderRadius: 6,
                          color: "var(--text-primary)", fontSize: 16, padding: "4px 8px", outline: "none", width: 130, height: 28, cursor: "pointer"
                        }}
                      >
                        <option value="default">Default Mount</option>
                        <option value="wall">Wall Arm</option>
                        <option value="ceiling">Ceiling pendant</option>
                        <option value="pole">Pole collar</option>
                        <option value="corner">Corner plate</option>
                      </select>
                    </div>

                    {/* Checkboxes */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 15, color: "var(--text-primary)" }}>
                        <input
                          type="checkbox"
                          checked={!!selectedPlaced.includeBackbox}
                          onChange={e => handleCameraConfigChange(selectedIdx, "includeBackbox", e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: "var(--purple)" }}
                        />
                        Weatherproof Backbox
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 15, color: "var(--text-primary)" }}>
                        <input
                          type="checkbox"
                          checked={!!selectedPlaced.includePoe}
                          onChange={e => handleCameraConfigChange(selectedIdx, "includePoe", e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: "#a855f7" }}
                        />
                        PoE Midspan Injector
                      </label>
                    </div>
                  </div>
                </div>
              )}
              </>
              )}
            </div>
          )}
        </div>

      </div>

      {showZoneNameModal && (
        <ZoneNameModal
          onSave={saveZone}
          onCancel={cancelZoneDrawing}
          existingNames={zones.map(z => z.name)}
        />
      )}

      {showStats && (
        <ProjectStatsPanel
          placed={placed}
          retentionDays={retentionDays}
          setRetentionDays={setRetentionDays}
          onClose={() => setShowStats(false)}
          selectedCompany={selectedCompany}
          manualCams={manualCams}
          setManualCams={setManualCams}
          newMc={newMc}
          setNewMc={setNewMc}
          addManualCam={addManualCam}
          updateManualCam={updateManualCam}
          cameraDB={cameraDB}
        />
      )}

      {contextMenu && (
        <div
          className="dv-context-menu"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 1000,
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Show Remove option for shapes and boom barriers */}
          {isShapeZone(contextMenu.zone) && (
            <button
              className="dv-ctx-item"
              style={{ color: "#f87171" }}
              onClick={() => {
                handleDeleteZone(contextMenu.zone.id);
                setContextMenu(null);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginRight: 6 }}>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4h6v2" />
              </svg>
              Remove Shape
            </button>
          )}
          {/* Show Automate Placement only for real zones (not shapes/boom barriers) */}
          {!isShapeZone(contextMenu.zone) && (
            <button className="dv-ctx-item" onClick={() => handleAutomateClick(contextMenu.zone)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ marginRight: 6 }}>
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
              Automate Placement
            </button>
          )}
        </div>
      )}

      {showAutomationModal && automationZone && (
        <AutomationModal
          zone={automationZone}
          ppm={ppm}
          cameraDB={cameraDB}
          getCameraForType={getCameraForType}
          onConfirm={(selectedModels) => {
            handleAutomatePlacement(automationZone.id, selectedModels);
            setShowAutomationModal(false);
            setAutomationZone(null);
          }}
          onCancel={() => {
            setShowAutomationModal(false);
            setAutomationZone(null);
          }}
        />
      )}


      {/* ── Text Edit Modal Removed ── */}


{exportPreviewOpen && (
        <ExportPreviewModal
          baseDataUrl={exportPreviewDataUrl}
          exportMode={pendingExportMode}
          showDori={pendingExportMode === "dori"}
          isDownloading={isGeneratingExport}
          onDownload={handleExportDownload}
          selectedCompany={selectedCompany}
          onCancel={() => {
            if (!isGeneratingExport) {
              setExportPreviewOpen(false);
              setExportPreviewCanvas(null);
              setExportPreviewDataUrl(null);
              setPendingExportMode(null);
            }
          }}
        />
      )}
      <PremiumPopup {...popupState} />
    </div>
  );
}


// ── Project Stats Panel ───────────────────────────────────────────────
// ── Project Stats Panel ───────────────────────────────────────────────
function ProjectStatsPanel({
  placed,
  retentionDays,
  setRetentionDays,
  onClose,
  selectedCompany,
  manualCams = [],
  setManualCams,
  newMc,
  setNewMc,
  addManualCam,
  updateManualCam,
  cameraDB = []
}) {
  const [codec, setCodec] = useState("h265");
  const [projectFps, setProjectFps] = useState(25);
  const [activeTab, setActiveTab] = useState("layout"); // "layout" | "simulate"

  const activePlaced = activeTab === "layout" ? placed : [];
  const activeManualCams = activeTab === "simulate" ? manualCams : [];

  const manualCamsCount = activeManualCams.reduce((sum, mc) => sum + (Number(mc.qty) || 0), 0);
  const cameraCount = activePlaced.length + manualCamsCount;

  // Use dynamic camera scenario calculations for realistic project bandwidth
  const placedBitrates = activePlaced.map(p => CctvCalc.estimateCameraBitrate(p, codec));
  const manualBitrates = activeManualCams.flatMap(mc => {
    const dbCam = cameraDB.find(c => c.brand === mc.brand && c.model === mc.model);
    if (!dbCam) return Array(Number(mc.qty) || 1).fill(4);
    const dummy = {
      camera: dbCam,
      fps: projectFps,
      recordingMode: "continuous",
      lighting: "normal"
    };
    const rate = CctvCalc.estimateCameraBitrate(dummy, codec);
    return Array(Number(mc.qty) || 1).fill(rate);
  });
  const bitrates = [...placedBitrates, ...manualBitrates];

  const totalBandwidth = bitrates.reduce((sum, b) => sum + b, 0);
  const avgBitrate = cameraCount > 0 ? totalBandwidth / cameraCount : 0;
  
  const placedFPS = activePlaced.reduce((sum, p) => sum + (p.fps || projectFps), 0);
  const manualFPS = activeManualCams.reduce((sum, mc) => sum + projectFps * (Number(mc.qty) || 1), 0);
  const totalFPS = placedFPS + manualFPS;
  const avgFPS = cameraCount > 0 ? totalFPS / cameraCount : 0;

  const totalStorageGB = cameraCount > 0
    ? (totalBandwidth * 3600 * 24 * retentionDays) / (8 * 1024)
    : 0;
  const totalStorageTB = totalStorageGB / 1024;
  const hardware = CctvCalc.getHardwareRecommendations(cameraCount);

  const typeCounts = {};
  activePlaced.forEach(p => {
    const t = p.camera.type || "dome";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });
  activeManualCams.forEach(mc => {
    const dbCam = cameraDB.find(c => c.brand === mc.brand && c.model === mc.model);
    const t = dbCam ? (dbCam.type || "dome") : "dome";
    typeCounts[t] = (typeCounts[t] || 0) + (Number(mc.qty) || 0);
  });

  const handleDownloadReport = (format = "png") => {
    const reportData = {
      cameraCount,
      avgBitrate,
      avgFPS,
      retentionDays,
      codec: codec.toUpperCase(),
      totalBandwidth,
      totalStorageGB,
      totalStorageTB,
      dailyStoragePerCamGB: avgBitrate * 3600 * 24 / (8 * 1024),
      dailyStorageTotalGB: totalBandwidth * 3600 * 24 / (8 * 1024),
      companyName: selectedCompany === "mirador" ? "Mirador AI Technologies" : "SENTINEL TECHNOLOGIES PRIVATE LIMITED",
    };

    const processDownload = () => {
      const dataUrl = drawStorageReport(reportData);
      if (format === "pdf") {
        const pdf = new jsPDF({
          orientation: "portrait",
          unit: "px",
          format: [1200, 1700]
        });
        pdf.addImage(dataUrl, "PNG", 0, 0, 1200, 1700);
        pdf.save(`Storage_Report_${codec.toUpperCase()}.pdf`);
      } else {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `Storage_Report_${codec.toUpperCase()}.png`;
        link.click();
      }
    };

    const img = new Image();
    img.onload = () => {
      reportData.logoImg = img;
      processDownload();
    };
    img.onerror = () => {
      processDownload();
    };
    img.src = selectedCompany === "mirador" ? logoImg : sentinelLogoImg;
  };

  // Helper to get base price for a placed camera
  const getCameraBaseVal = (p) => {
    return cameraPrices[p.id] !== undefined ? cameraPrices[p.id] : 0;
  };

  // Helper to get accessory price for a placed camera
  const getCameraAccVal = (p) => {
    return accessoryPrices[p.id] !== undefined ? accessoryPrices[p.id] : 0;
  };

  // Generate and download professional client-facing CSV quotation in INR
  const handleExportCSV = () => {
    const csvRows = [
      ["Item Type", "Model/Part", "Qty", "Recording Scenario", "Mounting Bracket", "Accessories Included", "Unit Price (INR)", "Accessories Price (INR)", "Total Line Cost (INR)"]
    ];
    
    // 1. Add individual camera configurations
    placed.forEach((p) => {
      const accessories = [];
      if (p.includeBackbox) accessories.push("Weatherproof Backbox");
      if (p.includePoe) accessories.push("PoE Injector");
      
      const cPrice = getCameraBaseVal(p);
      const aPrice = getCameraAccVal(p);

      csvRows.push([
        (p.camera.type || "dome").toUpperCase(),
        `${p.camera.brand} ${p.camera.model}`,
        "1",
        `Rec: ${p.recordingMode || "continuous"} · FPS: ${p.fps || 25} · Light: ${p.lighting || "normal"}`,
        p.mounting && p.mounting !== "default" ? `${p.mounting} arm` : "Standard bracket",
        accessories.join(" + ") || "None",
        `Rs. ${cPrice}`,
        `Rs. ${aPrice}`,
        `Rs. ${cPrice + aPrice}`
      ]);
    });

    // 1.5 Add manually added cameras
    manualCams.forEach((mc) => {
      const cPrice = mc.cameraPrice || 0;
      const aPrice = mc.accPrice || 0;
      csvRows.push([
        mc.type.toUpperCase(),
        `${mc.brand} ${mc.model} (Manual)`,
        String(mc.qty),
        "Manual Input",
        "—",
        mc.accessories || "None",
        `Rs. ${cPrice}`,
        `Rs. ${aPrice}`,
        `Rs. ${(cPrice + aPrice) * mc.qty}`
      ]);
    });
    
    if (cameraCount > 0) {
      // 2. Add Network Video Recorder
      csvRows.push([
        "INFRASTRUCTURE",
        hardware.nvr,
        "1",
        "Enterprise Server Config",
        "—",
        "—",
        `Rs. ${nvrPrice}`,
        "Rs. 0",
        `Rs. ${nvrPrice}`
      ]);
      
      // 3. Add PoE Switches
      csvRows.push([
        "INFRASTRUCTURE",
        "8-Port PoE Switch",
        hardware.switchesCount.toString(),
        "Gigabit Power-over-Ethernet",
        "—",
        "—",
        `Rs. ${switchUnitPrice}`,
        "Rs. 0",
        `Rs. ${switchUnitPrice * hardware.switchesCount}`
      ]);
    }
    
    // Combined calculations
    const placedBaseINR = placed.reduce((sum, p) => sum + getCameraBaseVal(p), 0);
    const placedAccINR = placed.reduce((sum, p) => sum + getCameraAccVal(p), 0);
    const manualBaseINR = manualCams.reduce((sum, mc) => sum + (mc.cameraPrice || 0) * (mc.qty || 1), 0);
    const manualAccINR = manualCams.reduce((sum, mc) => sum + (mc.accPrice || 0) * (mc.qty || 1), 0);

    const totalCamBaseINR = placedBaseINR + manualBaseINR;
    const totalCamAccINR = placedAccINR + manualAccINR;
    const totalInfraINR = cameraCount > 0 ? (nvrPrice + switchUnitPrice * hardware.switchesCount) : 0;
    const grandTotalINR = totalCamBaseINR + totalCamAccINR + totalInfraINR;
    
    csvRows.push([]);
    csvRows.push(["", "", "", "", "", "Cameras Base Subtotal", "", "", `Rs. ${totalCamBaseINR}`]);
    csvRows.push(["", "", "", "", "", "Accessories Subtotal", "", "", `Rs. ${totalCamAccINR}`]);
    csvRows.push(["", "", "", "", "", "Infrastructure Subtotal", "", "", `Rs. ${totalInfraINR}`]);
    csvRows.push(["", "", "", "", "", "GRAND SURVEILLANCE TOTAL", "", "", `Rs. ${grandTotalINR}`]);

    const csvContent = "data:text/csv;charset=utf-8,"
      + csvRows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(",")).join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Surveillance_Project_BOM_Quote_INR.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  return (
    <div className="dv-stats-overlay" onClick={onClose}>
      <div className="dv-stats-panel" style={{ width: activeTab === "bom" ? 820 : 640, maxWidth: "90vw", transition: "width 0.2s" }} onClick={e => e.stopPropagation()}>
        <div className="dv-stats-panel__header" style={{ borderBottom: "none", paddingBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="dv-stats-panel__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <path d="M12 20V10M18 20V4M6 20v-4" />
              </svg>
            </div>
            <div>
              <div className="dv-stats-panel__title">Proposal Summary</div>
              {/* <div className="dv-stats-panel__sub">Automated calculations based on layout</div> */}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
              <button className="dv-stats-panel__download" onClick={() => handleDownloadReport("png")} title="Download PNG Report">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                PNG
              </button>
              <button className="dv-stats-panel__download" onClick={() => handleDownloadReport("pdf")} title="Download PDF Report">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                PDF
              </button>
            <button className="dv-stats-panel__close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tab Buttons */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border-light)", background: "var(--bg-elevated)", padding: "0 20px" }}>
          <button
            onClick={() => setActiveTab("layout")}
            style={{
              padding: "12px 18px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "layout" ? "2px solid var(--teal)" : "2px solid transparent",
              color: activeTab === "layout" ? "var(--teal)" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: 16,
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Layout Summary
          </button>
          <button
            onClick={() => setActiveTab("simulate")}
            style={{
              padding: "12px 18px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "simulate" ? "2px solid #a855f7" : "2px solid transparent",
              color: activeTab === "simulate" ? "#a855f7" : "var(--text-secondary)",
              fontWeight: 700,
              fontSize: 16,
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            Capacity Modeler
          </button>
        </div>

        <div className="dv-stats-panel__content" style={{ maxHeight: "calc(80vh - 120px)", overflowY: "auto", padding: "16px 20px 20px" }}>
          {activeTab === "bom" ? (
            <div className="dv-bom-container" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: "#e8edf5" }}>Surveillance Proposal & Sales Quotation</span>
                <span style={{ fontSize: 15, color: "rgba(255, 255, 255, 0.5)" }}>Tax and installation calculated separately</span>
              </div>
             
              <div className="dv-bom-table-wrapper" style={{ overflowX: "auto", borderRadius: 6, border: "1px solid #1e2d3e" }}>
                <table className="dv-bom-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 15, color: "#cbd5e1" }}>
                  <thead>
                    <tr style={{ background: "#0f172a", borderBottom: "1px solid #1e2d3e", textAlign: "left" }}>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700 }}>Item Type</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700 }}>Model / Description</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700, textAlign: "center" }}>Qty</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700 }}>Accessories & Mount</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700, textAlign: "right" }}>Camera Price (₹)</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700, textAlign: "right" }}>Acc. Price (₹)</th>
                      <th style={{ padding: "10px 12px", color: "rgba(255, 255, 255, 0.5)", fontWeight: 700, textAlign: "right" }}>Total (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Group placed cameras by brand+model key
                      const groups = {};
                      placed.forEach((p) => {
                        const key = `${p.camera.brand}__${p.camera.model}__${p.camera.type}`;
                        if (!groups[key]) {
                          groups[key] = { p, qty: 0, ids: [] };
                        }
                        groups[key].qty += 1;
                        groups[key].ids.push(p.id);
                      });

                      return Object.values(groups).map(({ p, qty, ids }, idx) => {
                        // Use the first id as the key for price lookup
                        const groupKey = ids[0];
                        // Camera price: empty string means unset
                        const rawCamPrice = cameraPrices[groupKey];
                        const camPriceVal = rawCamPrice !== undefined ? rawCamPrice : "";
                        // Accessory price: empty string means unset
                        const rawAccPrice = accessoryPrices[groupKey];
                        const accPriceVal = rawAccPrice !== undefined ? rawAccPrice : "";

                        const camNum = camPriceVal !== "" ? Number(camPriceVal) : null;
                        const accNum = accPriceVal !== "" ? Number(accPriceVal) : null;
                        const lineTotal = (camNum !== null && accNum !== null)
                          ? (camNum + accNum) * qty
                          : camNum !== null ? camNum * qty : null;

                        const accessories = [];
                        if (p.mounting && p.mounting !== "default") accessories.push(`${p.mounting} arm`);
                        if (p.includeBackbox) accessories.push("backbox");
                        if (p.includePoe) accessories.push("PoE");
                        const accessoriesStr = accessories.join(", ") || "None";

                        return (
                          <tr key={groupKey} style={{ borderBottom: "1px solid var(--border)", background: idx % 2 === 0 ? "var(--bg-base)" : "var(--bg-surface)" }}>
                            <td style={{ padding: "10px 12px", textTransform: "uppercase", fontWeight: 700, fontSize: 13, color: "var(--teal)" }}>
                              {p.camera.type}
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{p.camera.brand}</div>
                              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{p.camera.model}</div>
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>{qty}</td>
                            <td style={{ padding: "10px 12px", fontSize: 13, color: "#a0aec0" }}>{accessoriesStr}</td>
                            <td style={{ padding: "10px 12px", textAlign: "right" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                                <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>₹</span>
                                <input
                                  type="number"
                                  placeholder="Set price"
                                  value={camPriceVal}
                                  onChange={(e) => {
                                    const val = e.target.value === "" ? "" : Number(e.target.value);
                                    setCameraPrices((prev) => {
                                      const next = { ...prev };
                                      ids.forEach((id) => { next[id] = val; });
                                      return next;
                                    });
                                  }}
                                  className="dv-bom-input"
                                  style={{
                                    width: "80px",
                                    background: "var(--bg-input)",
                                    border: "0.5px solid var(--border)",
                                    borderRadius: 4,
                                    color: "var(--text-primary)",
                                    padding: "2px 4px",
                                    textAlign: "right",
                                    fontSize: 14,
                                    fontFamily: "monospace",
                                    outline: "none",
                                  }}
                                />
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                                <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>₹</span>
                                <input
                                  type="number"
                                  placeholder="Set price"
                                  value={accPriceVal}
                                  onChange={(e) => {
                                    const val = e.target.value === "" ? "" : Number(e.target.value);
                                    setAccessoryPrices((prev) => {
                                      const next = { ...prev };
                                      ids.forEach((id) => { next[id] = val; });
                                      return next;
                                    });
                                  }}
                                  className="dv-bom-input"
                                  style={{
                                    width: "70px",
                                    background: "var(--bg-input)",
                                    border: "0.5px solid var(--border)",
                                    borderRadius: 4,
                                    color: "var(--text-primary)",
                                    padding: "2px 4px",
                                    textAlign: "right",
                                    fontSize: 14,
                                    fontFamily: "monospace",
                                    outline: "none",
                                  }}
                                />
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace", color: "#a855f7", fontWeight: 700 }}>
                              {lineTotal !== null ? `₹${lineTotal.toLocaleString("en-IN")}` : "—"}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                    
                    {/* Render Manually Added Cameras */}
                    {manualCams.map((mc, idx) => {
                      const lineTotal = ((mc.cameraPrice || 0) + (mc.accPrice || 0)) * (mc.qty || 1);
                      return (
                        <tr key={mc.id} style={{ borderBottom: "1px solid var(--border)", background: idx % 2 === 0 ? "var(--bg-base)" : "var(--bg-surface)" }}>
                          <td style={{ padding: "10px 12px" }}>
                            <select
                              value={mc.type}
                              onChange={(e) => updateManualCam(mc.id, "type", e.target.value)}
                              style={{ background: "var(--bg-input)", border: "0.5px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", padding: "2px 4px", fontSize: 13, cursor: "pointer", outline: "none" }}
                            >
                              <option value="dome">Dome</option>
                              <option value="bullet">Bullet</option>
                              <option value="ptz">PTZ</option>
                              <option value="fisheye">Fisheye</option>
                              <option value="box">Box</option>
                              <option value="turret">Turret</option>
                            </select>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input
                                value={mc.brand}
                                onChange={(e) => updateManualCam(mc.id, "brand", e.target.value)}
                                style={{ width: "65px", background: "var(--bg-input)", border: "0.5px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", padding: "2px 4px", fontSize: 13, outline: "none" }}
                                placeholder="Brand"
                              />
                              <input
                                value={mc.model}
                                onChange={(e) => updateManualCam(mc.id, "model", e.target.value)}
                                style={{ width: "95px", background: "var(--bg-input)", border: "0.5px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", padding: "2px 4px", fontSize: 13, outline: "none" }}
                                placeholder="Model"
                              />
                              <button
                                onClick={() => setManualCams(prev => prev.filter(c => c.id !== mc.id))}
                                style={{ background: "none", border: "none", color: "#ef4444", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", padding: "2px", fontWeight: "bold" }}
                                title="Remove Manual Camera"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center" }}>
                            <input
                              type="number"
                              min="1"
                              value={mc.qty}
                              onChange={(e) => updateManualCam(mc.id, "qty", Number(e.target.value))}
                              style={{ width: "45px", background: "#0b0f1a", border: "0.5px solid #2e3d55", borderRadius: 4, color: "#e8edf5", padding: "2px 4px", fontSize: 13, textAlign: "center", outline: "none" }}
                            />
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <input
                              value={mc.accessories}
                              onChange={(e) => updateManualCam(mc.id, "accessories", e.target.value)}
                              style={{ width: "100px", background: "var(--bg-input)", border: "0.5px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", padding: "2px 4px", fontSize: 13, outline: "none" }}
                              placeholder="e.g. Wall mount"
                            />
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
                              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>₹</span>
                              <input
                                type="number"
                                value={mc.cameraPrice}
                                onChange={(e) => updateManualCam(mc.id, "cameraPrice", Number(e.target.value))}
                                style={{ width: "65px", background: "var(--bg-input)", border: "0.5px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", padding: "2px 4px", fontSize: 13, textAlign: "right", outline: "none" }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
                              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>₹</span>
                              <input
                                type="number"
                                value={mc.accPrice}
                                onChange={(e) => updateManualCam(mc.id, "accPrice", Number(e.target.value))}
                                style={{ width: "55px", background: "var(--bg-input)", border: "0.5px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", padding: "2px 4px", fontSize: 13, textAlign: "right", outline: "none" }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace", color: "#a855f7", fontWeight: 700 }}>
                            ₹{lineTotal.toLocaleString("en-IN")}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Inline Form to Add a New Manual Camera */}
                    <tr style={{ background: "rgba(59, 130, 246, 0.05)", borderTop: "1.5px solid #1e2d3e" }}>
                      <td style={{ padding: "8px 10px" }}>
                        <select
                          value={newMc.type}
                          onChange={e => setNewMc({ ...newMc, type: e.target.value })}
                          style={{ background: "#0b0f1a", border: "0.5px solid #2e3d55", borderRadius: 4, color: "#e8edf5", padding: "4px", fontSize: 13, cursor: "pointer", outline: "none" }}
                        >
                          <option value="dome">Dome</option>
                          <option value="bullet">Bullet</option>
                          <option value="ptz">PTZ</option>
                          <option value="fisheye">Fisheye</option>
                          <option value="box">Box</option>
                          <option value="turret">Turret</option>
                        </select>
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ display: "flex", gap: 4 }}>
                          <input
                            placeholder="Brand"
                            value={newMc.brand}
                            onChange={e => setNewMc({ ...newMc, brand: e.target.value })}
                            style={{ width: "65px", background: "#0b0f1a", border: "0.5px solid #2e3d55", borderRadius: 4, color: "#e8edf5", padding: "4px", fontSize: 13, outline: "none" }}
                          />
                          <input
                            placeholder="Model"
                            value={newMc.model}
                            onChange={e => setNewMc({ ...newMc, model: e.target.value })}
                            style={{ width: "95px", background: "#0b0f1a", border: "0.5px solid #2e3d55", borderRadius: 4, color: "#e8edf5", padding: "4px", fontSize: 13, outline: "none" }}
                          />
                        </div>
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>
                        <input
                          type="number"
                          min="1"
                          value={newMc.qty}
                          onChange={e => setNewMc({ ...newMc, qty: Number(e.target.value) })}
                          style={{ width: "45px", background: "#0b0f1a", border: "0.5px solid #2e3d55", borderRadius: 4, color: "#e8edf5", padding: "4px", fontSize: 13, textAlign: "center", outline: "none" }}
                        />
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <input
                          placeholder="Accessories"
                          value={newMc.accessories}
                          onChange={e => setNewMc({ ...newMc, accessories: e.target.value })}
                          style={{ width: "100px", background: "#0b0f1a", border: "0.5px solid #2e3d55", borderRadius: 4, color: "#e8edf5", padding: "4px", fontSize: 13, outline: "none" }}
                        />
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>
                        <input
                          type="number"
                          placeholder="Cam Price"
                          value={newMc.cameraPrice}
                          onChange={e => setNewMc({ ...newMc, cameraPrice: e.target.value })}
                          style={{ width: "65px", background: "#0b0f1a", border: "0.5px solid #2e3d55", borderRadius: 4, color: "#e8edf5", padding: "4px", fontSize: 13, textAlign: "right", outline: "none" }}
                        />
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>
                        <input
                          type="number"
                          placeholder="Acc Price"
                          value={newMc.accPrice}
                          onChange={e => setNewMc({ ...newMc, accPrice: e.target.value })}
                          style={{ width: "55px", background: "#0b0f1a", border: "0.5px solid #2e3d55", borderRadius: 4, color: "#e8edf5", padding: "4px", fontSize: 13, textAlign: "right", outline: "none" }}
                        />
                      </td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>
                        <button
                          onClick={addManualCam}
                          className="dv-tbtn"
                          style={{ padding: "4px 8px", background: "#3b82f622", borderColor: "#3b82f6", color: "#60a5fa", borderRadius: 4, fontSize: 12, display: "inline-block", width: "auto" }}
                        >
                          + Add
                        </button>
                      </td>
                    </tr>
                    
                    {cameraCount > 0 && (
                      <>
                        {/* Infrastructure rows */}
                        <tr style={{ borderBottom: "1px solid #1e2d3e", background: "#090d13" }}>
                          <td style={{ padding: "10px 12px", textTransform: "uppercase", fontWeight: 700, fontSize: 14, color: "#f59e0b" }}>NVR</td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: 600, color: "#f8fafc" }}>{hardware.nvr}</div>
                            <div style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.5)", marginTop: 2 }}>Storage & Central Management Server</div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>1</td>
                          <td style={{ padding: "10px 12px", color: "#cbd5e1" }}>—</td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                              <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>₹</span>
                              <input
                                type="number"
                                placeholder="—"
                                value={nvrPrice}
                                onChange={(e) => setNvrPrice(e.target.value === "" ? "" : Number(e.target.value))}
                                className="dv-bom-input"
                                style={{
                                  width: "75px",
                                  background: "var(--bg-input)",
                                  border: "0.5px solid var(--border)",
                                  borderRadius: 4,
                                  color: "var(--text-primary)",
                                  padding: "2px 4px",
                                  textAlign: "right",
                                  fontSize: 15,
                                  fontFamily: "monospace",
                                  outline: "none",
                                }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "rgba(255, 255, 255, 0.5)" }}>—</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace", color: "#a855f7", fontWeight: 700 }}>
                            {nvrPrice !== "" ? `₹${Number(nvrPrice).toLocaleString("en-IN")}` : "—"}
                          </td>
                        </tr>
                        <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-base)" }}>
                          <td style={{ padding: "10px 12px", textTransform: "uppercase", fontWeight: 700, fontSize: 14, color: "var(--orange)" }}>SWITCH</td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>8-Port PoE Switch</div>
                            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>Power-over-Ethernet switch</div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>{hardware.switchesCount}</td>
                          <td style={{ padding: "10px 12px", color: "#cbd5e1" }}>—</td>
                          <td style={{ padding: "10px 12px", textAlign: "right" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                              <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>₹</span>
                              <input
                                type="number"
                                placeholder="—"
                                value={switchUnitPrice}
                                onChange={(e) => setSwitchUnitPrice(e.target.value === "" ? "" : Number(e.target.value))}
                                className="dv-bom-input"
                                style={{
                                  width: "75px",
                                  background: "var(--bg-input)",
                                  border: "0.5px solid var(--border)",
                                  borderRadius: 4,
                                  color: "var(--text-primary)",
                                  padding: "2px 4px",
                                  textAlign: "right",
                                  fontSize: 15,
                                  fontFamily: "monospace",
                                  outline: "none",
                                }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "rgba(255, 255, 255, 0.5)" }}>—</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace", color: "#a855f7", fontWeight: 700 }}>
                            {switchUnitPrice !== "" ? `₹${(Number(switchUnitPrice) * hardware.switchesCount).toLocaleString("en-IN")}` : "—"}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
 
              {/* Cost Summary Cards */}
              {(() => {
                // Compute totals only from filled-in prices
                const groups = {};
                placed.forEach((p) => {
                  const key = `${p.camera.brand}__${p.camera.model}__${p.camera.type}`;
                  if (!groups[key]) groups[key] = { ids: [], qty: 0 };
                  groups[key].ids.push(p.id);
                  groups[key].qty += 1;
                });
                let camTotal = 0, camHasAny = false;
                Object.values(groups).forEach(({ ids, qty }) => {
                  const gKey = ids[0];
                  const cp = cameraPrices[gKey];
                  const ap = accessoryPrices[gKey];
                  if (cp !== undefined) { camTotal += Number(cp) * qty; camHasAny = true; }
                  if (ap !== undefined) { camTotal += Number(ap) * qty; camHasAny = true; }
                });
                
                // Add manual cams totals
                manualCams.forEach(mc => {
                  camTotal += ((mc.cameraPrice || 0) + (mc.accPrice || 0)) * (mc.qty || 1);
                  camHasAny = true;
                });

                const nvrNum = nvrPrice !== "" ? Number(nvrPrice) : null;
                const swNum = switchUnitPrice !== "" ? Number(switchUnitPrice) : null;
                const infraTotal = (nvrNum !== null ? nvrNum : 0) + (swNum !== null ? swNum * hardware.switchesCount : 0);
                const infraHasAny = nvrNum !== null || swNum !== null;
                const grandTotal = (camHasAny ? camTotal : 0) + (infraHasAny ? infraTotal : 0);
                const showGrand = camHasAny || infraHasAny;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 4 }}>
                    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Camera & Mounts</span>
                      <span style={{ fontSize: 20, fontFamily: "monospace", color: "var(--text-primary)", fontWeight: 800, marginTop: 4 }}>
                        {camHasAny ? `₹${Math.round(camTotal).toLocaleString("en-IN")}` : "—"}
                      </span>
                    </div>
                    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Infrastructure (NVR & PoE)</span>
                      <span style={{ fontSize: 20, fontFamily: "monospace", color: "var(--text-primary)", fontWeight: 800, marginTop: 4 }}>
                        {infraHasAny ? `₹${Math.round(infraTotal).toLocaleString("en-IN")}` : "—"}
                      </span>
                    </div>
                    <div style={{ background: "rgba(168, 85, 247, 0.15)", border: "1px solid var(--purple)", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 13, color: "var(--purple)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Grand Surveillance Total</span>
                      <span style={{ fontSize: 22, fontFamily: "monospace", color: "var(--purple)", fontWeight: 900, marginTop: 2 }}>
                        {showGrand ? `₹${Math.round(grandTotal).toLocaleString("en-IN")}` : "—"}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <>
              <div className="dv-stats-grid">
                <div className="dv-stats-card">
                  <div className="dv-stats-card__label">Total Cameras</div>
                  <div className="dv-stats-card__val">{cameraCount}</div>
                  <div className="dv-stats-card__meta" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    Avg 
                    <select 
                      value={projectFps} 
                      onChange={(e) => setProjectFps(Number(e.target.value))}
                      style={{
                        background: "transparent", border: "none", color: "#3b82f6", 
                        cursor: "pointer", fontSize: 13, padding: 0, fontWeight: 500, outline: "none"
                      }}
                    >
                      <option value={5} style={{color: "#000"}}>5</option>
                      <option value={10} style={{color: "#000"}}>10</option>
                      <option value={15} style={{color: "#000"}}>15</option>
                      <option value={20} style={{color: "#000"}}>20</option>
                      <option value={25} style={{color: "#000"}}>25</option>
                      <option value={30} style={{color: "#000"}}>30</option>
                      <option value={60} style={{color: "#000"}}>60</option>
                    </select>
                    FPS project
                  </div>
                  <div className="dv-stats-card__list">
                    {Object.entries(typeCounts).map(([t, count]) => (
                      <div key={t} className="dv-stats-type">
                        <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                        <span>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="dv-stats-card">
                  <div className="dv-stats-card__label">Est. Bandwidth</div>
                  <div className="dv-stats-card__val">{totalBandwidth.toFixed(1)} <small>Mbps</small></div>
                  <div style={{ display: "flex", gap: 4, margin: "6px 0 4px" }}>
                    {["h265", "h264"].map(c => (
                      <button key={c} onClick={() => setCodec(c)} style={{
                        fontSize: 13, padding: "2px 7px", borderRadius: 3,
                        cursor: "pointer", border: "0.5px solid",
                        background: codec === c ? "#3b82f622" : "transparent",
                        borderColor: codec === c ? "#3b82f6" : "#2e3d55",
                        color: codec === c ? "#3b82f6" : "#4a5568",
                      }}>
                        {c.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className="dv-stats-card__meta">Avg {avgBitrate.toFixed(1)} Mbps/cam · from spec</div>
                </div>

                <div className="dv-stats-card">
                  <div className="dv-stats-card__label">Storage Required</div>
                  <div className="dv-stats-card__val">
                    {totalStorageTB > 1 ? totalStorageTB.toFixed(2) : totalStorageGB.toFixed(0)}
                    <small>{totalStorageTB > 1 ? " TB" : " GB"}</small>
                  </div>
                  <div className="dv-stats-card__meta" style={{ color: "#f59e0b", fontWeight: 700 }}>
                    Recommended: ≥ {Math.ceil(totalStorageTB * 1.2) || 1} TB
                  </div>

                  <div className="dv-stats-card__slider">
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "rgba(255, 255, 255, 0.85)", marginBottom: 4 }}>
                      <span>Retention Period</span>
                      <span style={{ color: "#3b82f6", fontWeight: 700 }}>{retentionDays} Days</span>
                    </div>
                    <input type="range" min="1" max="90" value={retentionDays}
                      onChange={e => setRetentionDays(Number(e.target.value))} />
                  </div>
                </div>
              </div>

              <div className="dv-stats-infra">
                <div className="dv-stats-infra__title">Recommended Infrastructure</div>
                <div className="dv-stats-infra__row">
                  <div className="dv-stats-infra__item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
                    </svg>
                    <span>{hardware.nvr}</span>
                  </div>
                  <div className="dv-stats-infra__item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <circle cx="6" cy="12" r="1" /><circle cx="10" cy="12" r="1" />
                      <circle cx="14" cy="12" r="1" /><circle cx="18" cy="12" r="1" />
                    </svg>
                    <span>{hardware.switches}</span>
                  </div>
                </div>
              </div>

              {activeTab === "simulate" && (
                <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Simulate Additional Cameras
                  </div>
                
                {manualCams.map(mc => (
                  <div key={mc.id} style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center", background: "var(--bg-elevated)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)" }}>
                    <div style={{ flex: 1, color: "var(--text-primary)", fontSize: 14, fontWeight: 600 }}>
                      {mc.brand} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>- {mc.model}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>Qty</span>
                      <input
                        type="number"
                        min="1"
                        value={mc.qty}
                        onChange={(e) => updateManualCam(mc.id, "qty", Number(e.target.value))}
                        style={{ width: "60px", background: "var(--bg-input)", border: "0.5px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", padding: "6px", fontSize: 13, textAlign: "center", outline: "none" }}
                      />
                    </div>
                    <button
                      onClick={() => setManualCams(prev => prev.filter(c => c.id !== mc.id))}
                      style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: "4px 8px", fontSize: 16, fontWeight: "bold" }}
                      title="Remove Camera"
                    >✕</button>
                  </div>
                ))}

                <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center", background: "rgba(59, 130, 246, 0.05)", padding: "12px", borderRadius: 6, border: "1px dashed var(--border-light)" }}>
                  <select
                    value={newMc.brand}
                    onChange={e => setNewMc({ ...newMc, brand: e.target.value, model: "" })}
                    style={{ flex: 1, background: "var(--bg-input)", border: "0.5px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", padding: "8px", fontSize: 13, outline: "none" }}
                  >
                    <option value="">Select Brand</option>
                    {[...new Set(cameraDB.map(c => c.brand))].filter(Boolean).map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  
                  <select
                    value={newMc.model}
                    onChange={e => setNewMc({ ...newMc, model: e.target.value })}
                    disabled={!newMc.brand}
                    style={{ flex: 1, background: "var(--bg-input)", border: "0.5px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", padding: "8px", fontSize: 13, outline: "none" }}
                  >
                    <option value="">Select Model</option>
                    {cameraDB.filter(c => c.brand === newMc.brand).map(c => (
                      <option key={c.id} value={c.model}>{c.model}</option>
                    ))}
                  </select>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--text-primary)" }}>Qty</span>
                    <input
                      type="number"
                      min="1"
                      value={newMc.qty}
                      onChange={e => setNewMc({ ...newMc, qty: Number(e.target.value) })}
                      style={{ width: "60px", background: "var(--bg-input)", border: "0.5px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", padding: "8px", fontSize: 13, textAlign: "center", outline: "none" }}
                    />
                  </div>
                  
                  <button
                    onClick={addManualCam}
                    disabled={!newMc.brand || !newMc.model}
                    style={{ padding: "8px 16px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: (!newMc.brand || !newMc.model) ? 0.5 : 1, transition: "opacity 0.2s" }}
                  >
                    Add Camera
                  </button>
                </div>
              </div>
              )}
            </>
          )}
        </div>
      </div>


    </div>
  );
}

// ── Zone Name Modal (copied from MapViewPage) ─────────────────────────
function ZoneNameModal({ onSave, onCancel, existingNames }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setErr("Zone name is required."); return; }
    if (!/^[a-zA-Z0-9 _-]+$/.test(trimmed)) { setErr("Zone Name can only contain alphanumeric characters, spaces, dashes, and underscores."); return; }
    if (existingNames.includes(trimmed)) { setErr("A zone with this name already exists."); return; }
    onSave(trimmed);
  }

  return (
    <div className="mv-stream-overlay" onClick={onCancel}>
      <div className="mv-zone-name-modal" onClick={e => e.stopPropagation()}>
        <div className="mv-zone-name-modal__header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
          <span>Name this Zone</span>
        </div>
        <p className="mv-zone-name-modal__sub">
          Give your drawn zone a name. Cameras placed inside it will be associated with this zone.
        </p>
        <input
          ref={inputRef}
          className={`mv-zone-name-input ${err ? "mv-zone-name-input--err" : ""}`}
          placeholder="e.g. Lobby, Warehouse A, Parking Lot…"
          value={name}
          onChange={e => { setName(e.target.value); setErr(""); }}
          onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
          maxLength={40}
        />
        {err && <p className="mv-zone-name-err">{err}</p>}
        <div className="mv-zone-name-modal__row">
          <button className="mv-modal__btn mv-modal__btn--cancel" onClick={onCancel}>Cancel</button>
          <button className="mv-modal__btn mv-modal__btn--confirm" onClick={handleSave}>Save Zone</button>
        </div>
      </div>
    </div>
  );
}