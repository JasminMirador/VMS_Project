/**
 * HeatmapLogic.js
 *
 * ONE origin formula works for both MapView and DesignerView after the
 * drawPlacedCamera fix (see DesignerView.jsx).
 *
 * ── ORIGIN FORMULA (both views) ──────────────────────────────────────
 *   ox = marker.x + cos(angle) * (1.5 * 0.62)   →  +0.93 FORWARD
 *   oy = marker.y + sin(angle) * (1.5 * 0.62)
 *
 * This matches MapCanvas.js Step B/C exactly.
 * drawPlacedCamera in DesignerView is now updated to use the same formula.
 */

import { computeVisibilityPolygon } from "./CctvCalculators";


const S              = 0.62;
const ORIGIN_OFFSET  = 1.5 * S;   // 0.93 — matches MapCanvas and fixed drawPlacedCamera

/** Returns true if (px, py) is inside a camera's FOV cone */
export function insideCone(px, py, marker) {
  const fovAngle  = marker.fovAngle  || 60;
  const direction = marker.direction || 0;
  const isNadirMount = marker.mounting === "ceiling";
  
  // Use real physical range in meters scaled by map PPM if available, else fallback to standard formula
  const fovLen = (marker.rangeDay && marker.ppm)
    ? (marker.rangeDay * marker.ppm)
    : (fovAngle * 2.2 + 40);

  const angle     = direction * (Math.PI / 180);

  // ★ Same origin as MapCanvas AND fixed drawPlacedCamera
  const ox = isNadirMount ? marker.x : marker.x + Math.cos(angle) * ORIGIN_OFFSET;
  const oy = isNadirMount ? marker.y : marker.y + Math.sin(angle) * ORIGIN_OFFSET;

  const dx   = px - ox;
  const dy   = py - oy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > fovLen) return false;

  if (isNadirMount) return true;

  let diff = Math.atan2(dy, dx) - angle;
  while (diff >  Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  return Math.abs(diff) <= (fovAngle / 2) * (Math.PI / 180);
}

/** Point-in-polygon (ray-casting) */
export function pointInPolygon(px, py, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py) &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/**
 * Renders the density heatmap onto a canvas context.
 */
export function drawHeatmapToContext(
  ctx, W, H,
  {
    markers    = [],
    cameras    = [],
    scale      = 1,
    offset     = { x: 0, y: 0 },
    activeZone = null,
    allZones   = [],
    floorImg   = null,
    step       = 3,
    clear      = true,
  }
) {
  if (clear) ctx.clearRect(0, 0, W, H);
  if (markers.length === 0 && !activeZone && allZones.length === 0) return new Set();

  const imgW = floorImg ? floorImg.width  * scale : 2000 * scale;
  const imgH = floorImg ? floorImg.height * scale : 2000 * scale;

  let sampleMinX = offset.x,        sampleMinY = offset.y;
  let sampleMaxX = offset.x + imgW, sampleMaxY = offset.y + imgH;

  const targetZones      = activeZone ? [activeZone] : [];
  const isClippedToZones = Boolean(activeZone && activeZone.polygon?.length >= 3);

  if (activeZone) {
    const sxs = activeZone.polygon.map(p => offset.x + p.x * scale);
    const sys  = activeZone.polygon.map(p => offset.y + p.y * scale);
    sampleMinX = Math.max(sampleMinX, Math.min(...sxs) - 2);
    sampleMinY = Math.max(sampleMinY, Math.min(...sys) - 2);
    sampleMaxX = Math.min(sampleMaxX, Math.max(...sxs) + 2);
    sampleMaxY = Math.min(sampleMaxY, Math.max(...sys) + 2);
  }

  const sw = Math.ceil(sampleMaxX - sampleMinX);
  const sh = Math.ceil(sampleMaxY - sampleMinY);
  if (sw <= 0 || sh <= 0) return new Set();

  const imageData   = ctx.createImageData(sw, sh);
  const data        = imageData.data;
  const foundLevels = new Set();

  // Helper for polygon area (Shoelace formula)
  function getPolygonArea(polygon) {
    if (!polygon || polygon.length < 3) return 0;
    let area = 0;
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += polygon[i].x * polygon[j].y;
      area -= polygon[j].x * polygon[i].y;
    }
    return Math.abs(area) / 2;
  }

  // Pre-cache the containing zone for each marker to maximize performance
  const markerZones = new Map();
  const markerVisPolys = new Map();
  if (allZones.length > 0) {
    for (const marker of markers) {
      const containedZones = allZones.filter(z => z.polygon?.length >= 3 && pointInPolygon(marker.x, marker.y, z.polygon));
      if (containedZones.length > 0) {
        containedZones.sort((a, b) => getPolygonArea(a.polygon) - getPolygonArea(b.polygon));
        const mZone = containedZones[0];
        markerZones.set(marker, mZone);

        const isNadirMount = marker.mounting === "ceiling";
        const angle = (marker.direction || 0) * (Math.PI / 180);
        const ox = isNadirMount ? marker.x : marker.x + Math.cos(angle) * ORIGIN_OFFSET;
        const oy = isNadirMount ? marker.y : marker.y + Math.sin(angle) * ORIGIN_OFFSET;
        try {
          const obstaclesPolys = allZones.filter(z => z.isBoomBarrier).map(z => z.polygon);
          const visPoly = computeVisibilityPolygon({ x: ox, y: oy }, mZone.polygon, obstaclesPolys);
          if (visPoly && visPoly.length >= 3) {
            markerVisPolys.set(marker, visPoly);
          }
        } catch (e) {
          console.error("Heatmap vis poly error", e);
        }
      }
    }
  }

  for (let sy = 0; sy < sh; sy += step) {
    for (let sx = 0; sx < sw; sx += step) {

      const imgX = (sampleMinX + sx - offset.x) / scale;
      const imgY = (sampleMinY + sy - offset.y) / scale;

      if (isClippedToZones) {
        let inAny = false;
        for (const z of targetZones) {
          if (pointInPolygon(imgX, imgY, z.polygon)) { inAny = true; break; }
        }
        if (!inAny) continue;
      }

      let onlineCoverage = 0;
      let insideOfflineCam = false;
      for (const marker of markers) {
        if (!insideCone(imgX, imgY, marker)) continue;

        // Only count coverage if the pixel is in the same zone where the camera is placed
        const mZone = markerZones.get(marker);
        if (mZone) {
          const visPoly = markerVisPolys.get(marker);
          const polyToCheck = visPoly || mZone.polygon;
          if (!pointInPolygon(imgX, imgY, polyToCheck)) continue;
        }

        const cam = cameras.find(c => c.id === marker.camId || c.ip === marker.camIp || c.name === marker.camName);
        const isOnline = cam ? cam.status === "online" : true;
        if (isOnline) {
          onlineCoverage++;
        } else {
          insideOfflineCam = true;
        }
      }

      if (insideOfflineCam && onlineCoverage === 0) continue;

      const level = onlineCoverage > 0 ? 1 : 0;
      foundLevels.add(level);

      let r, g, b, a;
      if (onlineCoverage === 0) {
        r=15;  g=23;  b=42;  a=120; // Blind spot / Blueprint dark
      } else {
        r=16;  g=185; b=129; a=145; // Clean emerald green coverage
      }
      /* Commented out yellow and red colors as requested:
      else if (onlineCoverage === 1) { r=34;  g=197; b=94;  a=150; }
      else if (onlineCoverage === 2) { r=234; g=179; b=8;   a=170; }
      else                           { r=220; g=38;  b=38;  a=190; }
      */

      for (let dy = 0; dy < step && sy + dy < sh; dy++) {
        for (let dx = 0; dx < step && sx + dx < sw; dx++) {
          const idx = ((sy + dy) * sw + (sx + dx)) * 4;
          data[idx]=r; data[idx+1]=g; data[idx+2]=b; data[idx+3]=a;
        }
      }
    }
  }

  ctx.putImageData(imageData, Math.round(sampleMinX), Math.round(sampleMinY));

  if (isClippedToZones) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    targetZones.forEach(z => {
      z.polygon.forEach((pt, i) => {
        const sx = offset.x + pt.x * scale;
        const sy = offset.y + pt.y * scale;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
    });
    ctx.fill();
    ctx.restore();
  }

  return foundLevels;
}

/** Draws a heatmap legend */
export function drawHeatmapLegendToCanvas(
  ctx, canvasW, canvasH,
  { foundLevels, compact = false, scaleFactor = 1 } = {}
) {
  const entries = [];
  if (!foundLevels || foundLevels.has(0)) entries.push({ color: "rgba(30,41,59,0.88)",  label: "Blind Spot (No Coverage)" });
  if (!foundLevels || foundLevels.has(1)) entries.push({ color: "rgba(34,197,94,0.88)", label: "Camera Coverage" });
  /* Commented out yellow and red legends as requested:
  if (!foundLevels || foundLevels.has(2)) entries.push({ color: "rgba(234,179,8,0.90)", label: "2-Camera Overlap" });
  if (!foundLevels || foundLevels.has(3)) entries.push({ color: "rgba(220,38,38,0.92)", label: "High Density (3+ Overlap)" });
  */
  if (!entries.length) return;

  const fontSize = (compact ? 9 : 13) * scaleFactor,  swatchW = (compact ? 16 : 30) * scaleFactor, swatchH = (compact ? 8 : 14) * scaleFactor;
  const rowGap   = (compact ? 14 : 26) * scaleFactor, padX = (compact ? 10 : 16) * scaleFactor,    padY = (compact ? 8 : 14) * scaleFactor;
  const radius   = (compact ? 5 : 10) * scaleFactor,  margin = (compact ? 10 : 22) * scaleFactor;

  ctx.save();
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  const maxLW = Math.max(...entries.map(e => ctx.measureText(e.label).width));
  const boxW  = padX * 2 + swatchW + 12 + maxLW;
  const boxH  = padY * 2 + entries.length * rowGap - (rowGap - swatchH);
  const bx    = canvasW - boxW - margin;
  const by    = canvasH - boxH - margin;

  ctx.fillStyle = compact ? "rgba(10,10,20,0.78)" : "rgba(255,255,255,0.94)";
  if (!compact) { ctx.shadowColor = "rgba(0,0,0,0.18)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3; }
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, radius); else ctx.rect(bx, by, boxW, boxH);
  ctx.fill();
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.strokeStyle = compact ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.08)";
  ctx.lineWidth = 1; ctx.stroke();

  entries.forEach((e, i) => {
    const ey = by + padY + i * rowGap;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx + padX, ey, swatchW, swatchH, compact ? 2 : 4);
    else ctx.rect(bx + padX, ey, swatchW, swatchH);
    ctx.fill();
    ctx.fillStyle    = compact ? "rgba(255,255,255,0.92)" : "#0f172a";
    ctx.font         = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(e.label, bx + padX + swatchW + 10, ey + swatchH / 2);
  });
  ctx.restore();
}

/** Draws a design legend (camera types and counts) */
export function drawDesignLegendToCanvas(
  ctx, canvasW, canvasH,
  { placedCameras = [], compact = false, scaleFactor = 1 } = {}
) {
  const typeCounts = {};
  placedCameras.forEach(p => {
    const t = p.camera.type || "dome";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  const TYPE_COLORS = {
    dome: "#3b82f6", bullet: "#f59e0b", ptz: "#8b5cf6",
    fisheye: "#10b981", box: "#f97316", turret: "#ec4899",
  };

  const entries = Object.keys(typeCounts).sort().map(type => ({
    type,
    color: TYPE_COLORS[type] || "#3b82f6",
    label: `${type.charAt(0).toUpperCase() + type.slice(1)}: ${typeCounts[type]}`,
  }));

  if (!entries.length) return;

  const fontSize = (compact ? 9 : 11) * scaleFactor, iconSize = (compact ? 14 : 18) * scaleFactor;
  const rowGap = (compact ? 18 : 24) * scaleFactor, padX = (compact ? 8 : 12) * scaleFactor, padY = (compact ? 6 : 10) * scaleFactor;
  const radius = (compact ? 4 : 6) * scaleFactor, margin = (compact ? 8 : 16) * scaleFactor;

  ctx.save();
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  const maxLW = Math.max(...entries.map(e => ctx.measureText(e.label).width));
  const boxW = padX * 2 + iconSize + 12 + maxLW;
  const boxH = padY * 2 + entries.length * rowGap - (rowGap - iconSize);
  const bx = canvasW - boxW - margin;
  const by = canvasH - boxH - margin;

  // Background box
  ctx.fillStyle = "rgba(13, 17, 23, 0.9)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, radius); else ctx.rect(bx, by, boxW, boxH);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();

  entries.forEach((e, i) => {
    const ey = by + padY + i * rowGap;
    const ix = bx + padX;
    const iy = ey;
    
    // Draw Camera Icon
    drawCameraIcon(ctx, ix, iy, iconSize, e.type, e.color);

    // Draw Label
    ctx.fillStyle = "#e8edf5";
    ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(e.label, ix + iconSize + 10, iy + iconSize / 2);
  });
  ctx.restore();
}

function drawCameraIcon(ctx, x, y, size, type, color) {
  ctx.save();
  ctx.translate(x, y);
  const s = size / 24;
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (type === "ptz") {
    ctx.beginPath(); ctx.arc(12, 12, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12, 2); ctx.lineTo(12, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12, 18); ctx.lineTo(12, 22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, 12); ctx.lineTo(6, 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(18, 12); ctx.lineTo(22, 12); ctx.stroke();
    const d = 4.93, d2 = 2.83;
    ctx.beginPath(); ctx.moveTo(d, d); ctx.lineTo(d + d2, d + d2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(24 - d, 24 - d); ctx.lineTo(24 - d - d2, 24 - d - d2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(24 - d, d); ctx.lineTo(24 - d - d2, d + d2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d, 24 - d); ctx.lineTo(d + d2, 24 - d - d2); ctx.stroke();
  } else if (type === "fisheye") {
    ctx.beginPath(); ctx.arc(12, 12, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(12, 12, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(12, 12, 1, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  } else if (type === "bullet") {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(3, 9, 14, 6, 2); else ctx.rect(3, 9, 14, 6);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(17, 12); ctx.lineTo(21, 12); ctx.stroke();
    ctx.beginPath(); ctx.arc(8, 12, 1.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  } else {
    // Dome/Default
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(2, 7, 15, 10, 2); else ctx.rect(2, 7, 15, 10);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(17, 9); ctx.lineTo(22, 7); ctx.lineTo(22, 17); ctx.lineTo(17, 15); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(9, 12, 2, 0, Math.PI * 2); ctx.fillStyle = color + "44"; ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** Draws the DORI Clarity Zones legend onto an export canvas.
 *  Colors and labels match the live UI legend and canvas beam colors exactly.
 */
export function drawDoriLegendToCanvas(ctx, canvasW, canvasH) {
  const entries = [
    { color: "#a855f7", label: "Identification (250+ px/m)" },
    { color: "#ef4444", label: "Recognition (125+ px/m)" },
    { color: "#eab308", label: "Observation (62+ px/m)" },
    { color: "#3b82f6", label: "Detection (25+ px/m)" },
  ];

  const fontSize = 9, dotSize = 7, rowGap = 17, padX = 10, padY = 10;
  const boxRadius = 6, margin = 12;

  ctx.save();
  ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  const maxLW = Math.max(...entries.map(e => ctx.measureText(e.label).width));
  const titleH = 14;
  const boxW = padX * 2 + dotSize + 10 + maxLW;
  const boxH = padY * 2 + titleH + 4 + entries.length * rowGap;
  const bx = margin;
  const by = margin;

  // Background box
  ctx.fillStyle = "rgba(13, 20, 32, 0.92)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, boxRadius); else ctx.rect(bx, by, boxW, boxH);
  ctx.fill();
  ctx.strokeStyle = "rgba(168, 85, 247, 0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Title
  ctx.fillStyle = "#c084fc";
  ctx.font = `800 ${fontSize - 1}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText("DORI ZONES (EN 62676-4)", bx + padX, by + padY);

  // Divider line
  const divY = by + padY + titleH + 2;
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(bx + padX, divY); ctx.lineTo(bx + boxW - padX, divY); ctx.stroke();

  entries.forEach((e, i) => {
    const ey = divY + 4 + i * rowGap;
    // Colored dot
    ctx.beginPath();
    ctx.arc(bx + padX + dotSize / 2, ey + dotSize / 2, dotSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Label
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(e.label, bx + padX + dotSize + 8, ey + dotSize / 2);
  });

  ctx.restore();
}