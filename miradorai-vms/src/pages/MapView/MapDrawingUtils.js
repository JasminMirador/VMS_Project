import { computeVisibilityPolygon } from "./CctvCalculators";
import { getLocalPpm } from "./LayoutCalibrationEngine";
import logoImg from "../../assets/logo.jpg";

/**
 * MapDrawingUtils.js
 * 
 * Shared drawing utilities for MapViewPage and DesignerView.
 * Ensures consistent visual style across the application.
 */

let cachedLogoImage = null;
function getCachedLogo() {
  if (!cachedLogoImage && typeof Image !== "undefined") {
    cachedLogoImage = new Image();
    cachedLogoImage.src = logoImg;
  }
  return cachedLogoImage;
}

export const TYPE_ICONS = {
  dome: "⊙",
  bullet: "▶",
  ptz: "↻",
  fisheye: "◎",
  box: "▪",
  turret: "⊕",
};

/** Categorizes a camera type based on its name string */
export function getCamTypeFromName(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("bullet") || n.includes("bllt")) return "bullet";
  if (n.includes("ptz"))    return "ptz";
  if (n.includes("fish"))   return "fisheye";
  if (n.includes("box"))    return "box";
  if (n.includes("turret")) return "turret";
  return "dome";
}

export const TYPE_COLORS = {
  dome: "#3b82f6",
  bullet: "#f59e0b",
  ptz: "#8b5cf6",
  fisheye: "#10b981",
  box: "#f97316",
  turret: "#ec4899",
};

/** Helper to calculate FOV drawing parameters */
export function getFovParams(camera, direction = 0) {
  const hfov = camera.hfov || 60;
  const halfRad = (hfov / 2) * (Math.PI / 180);
  const angle = (direction || 0) * (Math.PI / 180);
  return { angle, halfRad };
}

/** Draws a premium camera icon and its FOV on a canvas (Design View style) */
export function drawCamera(ctx, p, ppm, options = {}) {
  const { 
    isHovered = false, 
    isSelected = false, 
    showFov = true, 
    showLabel = false,
    zones = [],
    activeZoneId = null,
  } = options;

  const { x, y, direction, camera } = p;
  const col = TYPE_COLORS[camera.type] || "#3b82f6";
  const { angle, halfRad } = getFovParams(camera, direction);
  const radius = (camera.rangeDay || 30) * ppm;
  
  const camScale = 0.62;
  const shift = 14 * camScale;
  const originX = x - Math.cos(angle) * (20 * camScale);
  const originY = y - Math.sin(angle) * (20 * camScale);

  // 1. FOV Clipping (if active zone exists)
  let clipping = false;
  if (activeZoneId) {
    const zone = zones.find(z => z.id === activeZoneId);
    if (zone && zone.polygon.length >= 3) {
      ctx.save();
      ctx.beginPath();
      zone.polygon.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath(); ctx.clip(); clipping = true;
    }
  }

  // 2. FOV Cone
  if (showFov) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.arc(originX, originY, radius, angle - halfRad, angle + halfRad);
    ctx.closePath();
    ctx.fillStyle = col + (isSelected ? "66" : "44");
    ctx.fill();
    ctx.strokeStyle = col + (isSelected ? "ff" : "aa");
    ctx.lineWidth = isSelected ? 1.5 : 1; ctx.stroke();
    ctx.restore();
  }

  if (clipping) ctx.restore();

  // 3. Full Coverage Circle (Dashed)
  if (showFov) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = col + "44"; ctx.stroke();
    ctx.restore();
  }

  // 4. Premium Camera Marker Shape
  ctx.save();
  ctx.translate(x, y);

  // Selection halo
  if (isSelected || isHovered) {
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fillStyle = col + (isSelected ? "44" : "22"); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = isSelected ? 2 : 1; ctx.stroke();
  }

  // Base disc
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();

  // Direction pointer wedge
  ctx.beginPath();
  ctx.moveTo(Math.cos(angle - 0.4) * 12, Math.sin(angle - 0.4) * 12);
  ctx.lineTo(Math.cos(angle) * 19,       Math.sin(angle) * 19);
  ctx.lineTo(Math.cos(angle + 0.4) * 12, Math.sin(angle + 0.4) * 12);
  ctx.fillStyle = col; ctx.fill();

  // Camera type icon
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(TYPE_ICONS[camera.type] || "⊙", 0, 0);

  ctx.restore();

  // 5. Label
  if (showLabel && camera.model) {
    ctx.save();
    ctx.font = "11px Inter, sans-serif";
    const tw = ctx.measureText(camera.model).width;
    const bx = x - tw / 2 - 6, by = y + 16;
    ctx.fillStyle = "rgba(15,23,42,0.85)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, tw + 12, 18, 4);
    else ctx.rect(bx, by, tw + 12, 18);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(camera.model, x, by + 9);
    ctx.restore();
  }
}

/** Polyfill roundRect if missing */
export function ensureRoundRect(ctx) {
  if (!ctx.roundRect) {
    ctx.roundRect = function(x, y, w, h, radii) {
      let r = radii;
      if (typeof r === "number") r = { tl: r, tr: r, br: r, bl: r };
      else if (Array.isArray(r)) r = { tl: r[0]||0, tr: r[1]||0, br: r[2]||0, bl: r[3]||0 };
      else r = { tl: 0, tr: 0, br: 0, bl: 0 };
      
      this.beginPath();
      this.moveTo(x + r.tl, y);
      this.lineTo(x + w - r.tr, y);
      this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
      this.lineTo(x + w, y + h - r.br);
      this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
      this.lineTo(x + r.bl, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
      this.lineTo(x, y + r.tl);
      this.quadraticCurveTo(x, y, x + r.tl, y);
      this.closePath();
      return this;
    };
  }
}

/** 
 * Renders a full high-fidelity snapshot of the Map View exactly as it appears in the UI.
 * Uses dedicated outer margins for company branding and legends so the floor layout is 100% unobstructed.
 */
export function renderMapViewSnapshot(ctx, options = {}) {
  const { 
    img, 
    markers = [], 
    cameras = [], 
    zones = [], 
    activeFloor = 0,
    highlightedCamId = null,
    showHeatmap = false,
    exportMode = "design",
    ppm = null,
    calibration = null,
    iconScale = 1.20,
    logoImage = null,
    padTop = 16,
    padLeft = 16,
    padRight = 16,
    padBottom = 46,
  } = options;

  if (!img) return;

  const W = img.width;
  const H = img.height;
  const totalW = W + padLeft + padRight;
  const totalH = H + padTop + padBottom;

  ensureRoundRect(ctx);

  // ── 0. Canvas Background ────────────────────────────────────────────
  ctx.fillStyle = "#090d16";
  ctx.fillRect(0, 0, totalW, totalH);

  // ── 1. Enter Floor Plan Coordinates (Translated by padLeft, padTop) ─
  ctx.save();
  ctx.translate(padLeft, padTop);

  // Floor Plan Image
  ctx.drawImage(img, 0, 0, W, H);

  const floorZones = (zones || []).filter(z => z.floorIndex === activeFloor);

  // Helpers for containment and FOV tracing
  function pointInPolygon(px, py, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function getPolygonArea(polygon) {
    if (!polygon || polygon.length < 3) return 0;
    let area = 0;
    for (let i = 0, n = polygon.length; i < n; i++) {
      const j = (i + 1) % n;
      area += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
    }
    return Math.abs(area) / 2;
  }

  function getMarkerZone(m) {
    const contained = floorZones.filter(z => z.polygon?.length >= 3 && pointInPolygon(m.x, m.y, z.polygon));
    if (!contained.length) return null;
    contained.sort((a, b) => getPolygonArea(a.polygon) - getPolygonArea(b.polygon));
    return contained[0];
  }

  function traceCone(ctx, ox, oy, len, angle, halfRad) {
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.arc(ox, oy, len, angle - halfRad, angle + halfRad);
    ctx.closePath();
  }

  // ── 2. FOV Beams and Heatmap Coverage Layer ─────────────────────────
  if (markers.length > 0) {
    if (showHeatmap) {
      ctx.save();
      ctx.fillStyle = "rgba(15, 23, 42, 0.65)"; // Deep blueprint blindspot tint
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    markers.forEach(m => {
      const cam = cameras.find(c => c.id === m.camId) || {};
      const online = cam?.status !== "offline";
      const isHighlit = m.camId === highlightedCamId;

      const fovAngle = m.fovAngle || 60;
      const direction = m.direction || 0;
      const localPpm = calibration?.enabled ? getLocalPpm(calibration, m.x, m.y) : (ppm || null);
      const defaultLen = Math.min(W * 0.35, Math.max(60, (W / 40) * (cam?.specs?.rangeDay || 20)));
      const fovLen = localPpm && cam?.specs?.rangeDay ? cam.specs.rangeDay * localPpm : defaultLen;
      const halfRad = (fovAngle / 2) * (Math.PI / 180);
      const angle = direction * (Math.PI / 180);
      const S = 0.62;

      const originX = m.x + Math.cos(angle) * (1.5 * S);
      const originY = m.y + Math.sin(angle) * (1.5 * S);

      const zone = getMarkerZone(m);

      ctx.save();
      const boomBarriers = floorZones.filter(z => z.isBoomBarrier);
      if ((zone && zone.polygon?.length >= 3) || boomBarriers.length > 0) {
        ctx.beginPath();
        let basePoly = zone?.polygon;
        if (!basePoly) {
          basePoly = [];
          const R = fovLen + 10;
          for (let i = 0; i <= 16; i++) {
            const a = angle - halfRad + (2 * halfRad * (i / 16));
            basePoly.push({ x: originX + Math.cos(a) * R, y: originY + Math.sin(a) * R });
          }
          basePoly.push({ x: originX, y: originY });
        }
        let polyToClip = basePoly;
        try {
          const obstaclesPolys = boomBarriers.map(z => z.polygon);
          const visPoly = computeVisibilityPolygon({ x: originX, y: originY }, basePoly, obstaclesPolys);
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
      }

      const camType = getCamTypeFromName(cam?.name || cam?.model);
      const typeCol = TYPE_COLORS[camType] || "#3b82f6";

      function hexToRgb(hex) {
        const r = parseInt((hex || "#3b82f6").slice(1, 3), 16) || 59;
        const g = parseInt((hex || "#3b82f6").slice(3, 5), 16) || 130;
        const b = parseInt((hex || "#3b82f6").slice(5, 7), 16) || 246;
        return `${r},${g},${b}`;
      }
      const rgb = hexToRgb(isHighlit ? "#5aabf0" : typeCol);

      const grad = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);
      let rayStrokeColor = "";

      if (showHeatmap) {
        if (!online) {
          grad.addColorStop(0, "rgba(100, 116, 139, 0.45)");
          grad.addColorStop(0.65, "rgba(100, 116, 139, 0.25)");
          grad.addColorStop(1, "rgba(100, 116, 139, 0.05)");
          rayStrokeColor = "rgba(100, 116, 139, 0.45)";
        } else {
          grad.addColorStop(0, "rgba(16, 185, 129, 0.88)");
          grad.addColorStop(0.35, "rgba(16, 185, 129, 0.72)");
          grad.addColorStop(0.75, "rgba(16, 185, 129, 0.50)");
          grad.addColorStop(1, "rgba(16, 185, 129, 0.18)");
          rayStrokeColor = "rgba(16, 185, 129, 0.75)";
        }
      } else {
        if (!online) {
          grad.addColorStop(0, "rgba(110, 110, 110, 0.45)");
          grad.addColorStop(0.7, "rgba(110, 110, 110, 0.25)");
          grad.addColorStop(1, "rgba(110, 110, 110, 0.04)");
          rayStrokeColor = "rgba(110, 110, 110, 0.45)";
        } else {
          grad.addColorStop(0, `rgba(${rgb}, 0.68)`);
          grad.addColorStop(0.45, `rgba(${rgb}, 0.48)`);
          grad.addColorStop(0.82, `rgba(${rgb}, 0.28)`);
          grad.addColorStop(1, `rgba(${rgb}, 0.06)`);
          rayStrokeColor = `rgba(${rgb}, 0.65)`;
        }
      }

      ctx.fillStyle = grad;
      traceCone(ctx, originX, originY, fovLen, angle, halfRad);
      ctx.fill();

      // Crisp straight side rays (leaving the ending arc open and seamless)
      if (rayStrokeColor) {
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.lineTo(originX + Math.cos(angle - halfRad) * fovLen, originY + Math.sin(angle - halfRad) * fovLen);
        ctx.moveTo(originX, originY);
        ctx.lineTo(originX + Math.cos(angle + halfRad) * fovLen, originY + Math.sin(angle + halfRad) * fovLen);
        ctx.strokeStyle = rayStrokeColor;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      ctx.restore();
    });
  }

  // ── 3. Camera Bodies & Numbers ──────────────────────────────────────
  const layoutBaseDim = Math.max(W, H);
  const layoutScaleFactor = Math.max(0.65, Math.min(2.5, layoutBaseDim / 1800));
  const S = (iconScale || 1.20) * layoutScaleFactor;

  markers.forEach((m, i) => {
    const cam = cameras.find(c => c.id === m.camId) || { status: "offline" };
    const online = cam.status === "online";
    const isHighlit = m.camId === highlightedCamId;
    const col = online ? (isHighlit ? "#5aabf0" : "#1D9E75") : "#555";
    const R = 8;
    const angle = (m.direction || 0) * (Math.PI / 180);
    const type = getCamTypeFromName(cam?.name || cam?.model);

    // Glow
    ctx.beginPath(); ctx.arc(m.x, m.y, R + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = col + (isHighlit ? "40" : "20"); ctx.fill();

    ctx.save();
    ctx.translate(m.x, m.y);

    if (type === "bullet") {
      const bS = S * 0.9;
      
      // Fixed Mount & Arm
      ctx.save();
      if (m.flip) ctx.scale(-1, 1);
      
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

      // Rotating Camera Body
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
      ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

      // Front Face
      ctx.beginPath();
      ctx.ellipse(8*bS, 0, 2.5*bS, 6.5*bS, 0, 0, Math.PI*2);
      ctx.fillStyle = "#1b3039"; ctx.fill();
      ctx.strokeStyle = "#000000"; ctx.stroke();

      // Lens Outer Ring
      ctx.beginPath();
      ctx.ellipse(8*bS, 0, 1.2*bS, 3.5*bS, 0, 0, Math.PI*2);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.stroke();
      
      // Lens Center
      ctx.beginPath();
      ctx.ellipse(8*bS, 0, 0.5*bS, 1.5*bS, 0, 0, Math.PI*2);
      ctx.fillStyle = "#000000"; ctx.fill();

    } else if (type === "ptz") {
      const pS = S * 0.9;
      
      // Fixed Mount & Arm
      ctx.save();
      if (m.flip) ctx.scale(-1, 1);
      
      // Wall Plate
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

      // Rotating Camera Body
      ctx.rotate(angle);
      
      // Top cap
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

      // Lower Dome
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
      ctx.roundRect(8*pS, -3*pS, 4*pS, 6*pS, 1);
      ctx.fillStyle = "#262626"; ctx.fill();
      
      // Lens
      ctx.beginPath();
      ctx.arc(10*pS, 0, 1.8*pS, 0, Math.PI*2);
      ctx.fillStyle = "#000000"; ctx.fill();

    } else {
      ctx.rotate(angle);

      if (type === "dome" || type === "turret") {
        // Top white cover
        ctx.beginPath();
        ctx.arc(0, 0, 11 * S, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
        
        // Cutout for black dome
        ctx.beginPath();
        ctx.arc(3 * S, 0, 8.5 * S, 0, Math.PI * 2);
        ctx.fillStyle = "#222222"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
        
        // White rim
        ctx.beginPath();
        ctx.arc(3 * S, 0, 8.5 * S, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
        
        // Inner lens housing
        ctx.beginPath();
        ctx.arc(4 * S, 0, 5 * S, 0, Math.PI * 2);
        ctx.fillStyle = "#111111"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

        // IR LED ring
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
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
        ctx.beginPath(); ctx.arc(0, 0, 12 * S, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
    
        ctx.beginPath(); ctx.arc(0, 0, 8 * S, 0, Math.PI * 2);
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
    
        ctx.beginPath(); ctx.arc(0, 0, 3.5 * S, 0, Math.PI * 2);
        ctx.fillStyle = "#0e0e0e"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.stroke();
    
        ctx.beginPath(); ctx.arc(0, 0, 1.5 * S, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.stroke();
      }
      else {
        // Box / Other
        const shift = 14 * S;
        ctx.translate(-shift, 0);
    
        // Mount
        ctx.beginPath(); ctx.arc(-14 * S, 0, 5 * S, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
    
        // Neck
        ctx.beginPath();
        ctx.roundRect(-14 * S, -2.5 * S, 7 * S, 5 * S, 1.5);
        ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
    
        // Main barrel body
        ctx.beginPath();
        ctx.roundRect(-7 * S, -5.5 * S, 17 * S, 11 * S, 5 * S);
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

    // Recording LED dot
    const showRec = localStorage.getItem("miradorai_show_rec_ind") !== "false";
    if (online && showRec) {
      ctx.beginPath();
      if (type === "bullet" || type === "ptz" || type === "box" || type === "thermal") {
        ctx.arc(-14 * S, -6 * S, 2 * S, 0, Math.PI * 2);
      } else {
        ctx.arc(-8 * S, -8 * S, 2 * S, 0, Math.PI * 2);
      }
      ctx.fillStyle = "#ff4d4f";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    ctx.restore();

    // Number label
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.fillStyle = online ? "#000000" : "#666666";
    ctx.font = `bold 8px monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((i + 1).toString(), -2 * S, 0);
    ctx.restore();

    // Direction handle
    const ang2 = (m.direction || 0) * (Math.PI / 180);
    const hx = m.x + Math.cos(ang2) * (R + 9);
    const hy = m.y + Math.sin(ang2) * (R + 9);
    ctx.beginPath();
    ctx.arc(hx, hy, 3, 0, Math.PI * 2);
    ctx.fillStyle = online ? col : "#555";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // ── 4. Camera Name Badges (Pill style matching UI) ───────────────────
  markers.forEach((m, i) => {
    const cam = cameras.find(c => c.id === m.camId) || {};
    const online = cam.status === "online";
    const isHighlit = m.camId === highlightedCamId;
    const displayLabel = m.camName || cam.name || cam.model || `Camera ${i + 1}`;
    
    ctx.save();
    ctx.font = "10.5px Inter, sans-serif";
    const tw = ctx.measureText(displayLabel).width;

    const lo = m.labelOffset || { dx: 0, dy: 0 };
    const labelCenterX = m.x + lo.dx;
    const labelTopY = m.y - 24 + lo.dy;
    const bx = labelCenterX - tw / 2 - 7;
    const by = labelTopY;
    const labelW = tw + 14;
    const labelH = 18;

    // Leader line if offset
    if (lo.dx !== 0 || lo.dy !== 0) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = (online ? (isHighlit ? "#5aabf0" : "#a855f7") : "#888888") + "bb";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(labelCenterX, by + labelH / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Badge background
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, labelW, labelH, 4);
    else ctx.rect(bx, by, labelW, labelH);
    ctx.fill();

    // Border
    ctx.strokeStyle = isHighlit ? "#2563eb" : (lo.dx !== 0 || lo.dy !== 0 ? "#7c3aed" : "#cbd5e1");
    ctx.lineWidth = isHighlit ? 1.5 : 1;
    ctx.stroke();

    // Text
    ctx.fillStyle = "#1e293b";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(displayLabel, labelCenterX, by + 9);
    ctx.restore();
  });

  // Exit floor plan translated space
  ctx.restore();

  // ── 5. Dedicated Sleek Bottom Footer Bar (Outside the Floor Area) ───
  const footY = padTop + H + 8;
  const footH = 32;

  ctx.save();
  // Thin clean divider line
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop + H + 3);
  ctx.lineTo(padLeft + W, padTop + H + 3);
  ctx.stroke();

  // Draw Mirador Logo Icon from Asset
  const logo = logoImage || getCachedLogo();
  let textStartX = padLeft + 6;

  if (logo && logo.complete && logo.naturalWidth > 0) {
    const logoSize = 22;
    const logoY = footY + (footH - logoSize) / 2;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(padLeft, logoY, logoSize, logoSize, 4);
    else ctx.rect(padLeft, logoY, logoSize, logoSize);
    ctx.clip();
    ctx.drawImage(logo, padLeft, logoY, logoSize, logoSize);
    ctx.restore();
    textStartX = padLeft + logoSize + 8;
  } else {
    // Fallback indicator dot if image still loading
    ctx.beginPath();
    ctx.arc(padLeft + 8, footY + footH / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#0284c7";
    ctx.fill();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    textStartX = padLeft + 20;
  }

  // Company Name
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12.5px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("MIRADOR VMS", textStartX, footY + footH / 2);

  // Mode Badge (No floor name/number)
  const modeText = showHeatmap ? "COVERAGE HEATMAP" : "2D DESIGN LAYOUT";
  const badgeColor = showHeatmap ? "#10b981" : "#38bdf8";
  const titleW = ctx.measureText("MIRADOR VMS").width;

  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "500 11px Inter, sans-serif";
  ctx.fillText("•", textStartX + titleW + 8, footY + footH / 2);

  ctx.fillStyle = badgeColor;
  ctx.font = "bold 11px Inter, sans-serif";
  ctx.fillText(modeText, textStartX + titleW + 18, footY + footH / 2);

  // Right side: Inline Legend or Summary Stats
  if (showHeatmap) {
    let rightX = padLeft + W;
    
    // Online camera count
    const activeCount = markers.filter(m => {
      const c = cameras.find(cam => cam.id === m.camId);
      return c?.status !== "offline";
    }).length;
    ctx.fillStyle = "#38bdf8";
    ctx.font = "600 11px Inter, sans-serif";
    ctx.textAlign = "right";
    const onlineText = `•  ${activeCount}/${markers.length} Online`;
    ctx.fillText(onlineText, rightX, footY + footH / 2);
    rightX -= (ctx.measureText(onlineText).width + 20);

    // Blindspots
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 11px Inter, sans-serif";
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
    // Design Mode stats on right (no meter measurements)
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`•  ${markers.length} Cameras Placed`, padLeft + W, footY + footH / 2);
  }

  ctx.restore();
}