import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { computeVisibilityPolygon, getDoriDistances } from "./CctvCalculators";
import { getLocalPpm } from "./LayoutCalibrationEngine";


/**
 * MapCanvas — professional VMS canvas renderer
 *
 * Key improvements:
 *   1. Camera icon is SMALLER  (CAM_SCALE = 0.62)
 *   2. FOV light origin = CENTRE of camera body  (m.x, m.y) — not lens tip
 *   3. FOV cone is hard-CLIPPED to the camera's zone polygon
 *      → light cannot bleed outside zone boundary
 *   4. Dark overlay punch-out also zone-clipped per camera
 *
 * New prop:
 *   zones  []  – { id, polygon:[{x,y}…], floorIndex, color }
 */
const MapCanvas = forwardRef(function MapCanvas(
  {
    cameras,
    markers,
    zones = [],
    floorImgRef,
    cadRendererRef,
    scaleRef,
    offsetRef,
    hoveredIdxRef,
    highlightedCamId,
    showHeatmap,
    alertCounts = {},
    onDraw,
    onMouseMove,
    onMouseDown,
    onMouseUp,
    onMouseLeave,
    onContextMenu,
    iconScale = 1.20,
    selectedIdx = null,
    ppm = null,
    calibration = null,
  },
  ref
) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const TYPE_COLORS = {
    dome: "#3b82f6",  // blue
    bullet: "#f59e0b",  // amber
    ptz: "#8b5cf6",  // purple
    fisheye: "#10b981",  // green
    box: "#f97316",  // orange
    turret: "#ec4899",  // pink
  };

  function getCamType(cam) {
    if (!cam) return "dome";
    const name = (cam.name || cam.model || "").toLowerCase();
    if (name.includes("bullet") || name.includes("bllt")) return "bullet";
    if (name.includes("ptz")) return "ptz";
    if (name.includes("fish")) return "fisheye";
    if (name.includes("box")) return "box";
    if (name.includes("turret")) return "turret";
    return "dome";
  }

  // ── Polyfill roundRect ────────────────────────────────────────────
  function ensureRoundRect(ctx) {
    if (!ctx.roundRect) {
      ctx.roundRect = function (x, y, w, h, r) {
        this.beginPath();
        this.moveTo(x + r, y);
        this.lineTo(x + w - r, y);
        this.quadraticCurveTo(x + w, y, x + w, y + r);
        this.lineTo(x + w, y + h - r);
        this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.lineTo(x + r, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - r);
        this.lineTo(x, y + r);
        this.quadraticCurveTo(x, y, x + r, y);
        this.closePath();
      };
    }
  }

  // ── Ray-cast point-in-polygon ─────────────────────────────────────
  function pointInPolygon(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y;
      const xj = polygon[j].x, yj = polygon[j].y;
      if ((yi > py) !== (yj > py) &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ── Shoelace formula for polygon area ─────────────────────────────
  function getPolygonArea(polygon) {
    if (!polygon || polygon.length < 3) return 0;
    let area = 0;
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % n];
      area += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(area / 2);
  }

  // ── Find the zone a marker sits inside ───────────────────────────
  function getMarkerZone(marker) {
    const containedZones = zones.filter(
      z => z.polygon?.length >= 3 && pointInPolygon(marker.x, marker.y, z.polygon)
    );
    if (containedZones.length === 0) return null;
    containedZones.sort((a, b) => getPolygonArea(a.polygon) - getPolygonArea(b.polygon));
    return containedZones[0];
  }

  // ── Build zone clip path (does NOT call ctx.save/restore) ────────
  function buildZoneClip(ctx, zone) {
    if (!zone || zone.polygon.length < 3) return false;
    ctx.beginPath();
    ctx.moveTo(zone.polygon[0].x, zone.polygon[0].y);
    for (let i = 1; i < zone.polygon.length; i++) {
      ctx.lineTo(zone.polygon[i].x, zone.polygon[i].y);
    }
    ctx.closePath();
    ctx.clip();
    return true;
  }

  // ── Trace a FOV cone path ─────────────────────────────────────────
  function traceCone(ctx, ox, oy, len, angle, halfRad) {
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.arc(ox, oy, len, angle - halfRad, angle + halfRad);
    ctx.closePath();
  }

  // ── Main draw ─────────────────────────────────────────────────────
  const drawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;

    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    ensureRoundRect(ctx);
    ctx.clearRect(0, 0, W, H);

    const img = floorImgRef.current;
    const cadRenderer = cadRendererRef?.current;
    if (!img && !cadRenderer) return;

    const { x: ox, y: oy } = offsetRef.current;
    const scale = scaleRef.current;

    if (cadRenderer && typeof cadRenderer.render === "function") {
      cadRenderer.render(ctx, { x: ox, y: oy, scale }, W, H);
    } else if (img) {
      // ── 1. Draw Floor Plan Image in transformed coordinate space ──
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      ctx.restore();

      // ── 2. FOV Beams and Heatmap Coverage Layer (Inside transformed space) ──
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      if (markers.length > 0) {
        // If showHeatmap is active on 2D layout, draw deep blueprint blindspot coverage over the floor plan
        if (showHeatmap) {
          ctx.save();
          ctx.fillStyle = "rgba(15, 23, 42, 0.65)"; // Deep blueprint blindspot tint
          ctx.fillRect(0, 0, img.width, img.height);
          ctx.restore();
        }

        markers.forEach(m => {
          const cam = cameras.find(c => c.id === m.camId);
          const online = cam?.status === "online";
          const isHighlit = m.camId === highlightedCamId;

          const fovAngle = m.fovAngle || 60;
          const direction = m.direction || 0;
          const localPpm = calibration?.enabled ? getLocalPpm(calibration, m.x, m.y) : (ppm || null);
          const defaultLen = Math.min(img.width * 0.35, Math.max(60, (img.width / 40) * (cam?.specs?.rangeDay || 20)));
          const fovLen = localPpm && cam?.specs?.rangeDay ? cam.specs.rangeDay * localPpm : defaultLen;
          const halfRad = (fovAngle / 2) * (Math.PI / 180);
          const angle = direction * (Math.PI / 180);
          const S = 0.62;

          const originX = m.x + Math.cos(angle) * (1.5 * S);
          const originY = m.y + Math.sin(angle) * (1.5 * S);

          const zone = getMarkerZone(m);

          ctx.save();
          const boomBarriers = (zones || []).filter(z => z.isBoomBarrier);
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

          const camType = getCamType(cam);
          const typeCol = TYPE_COLORS[camType] || "#3b82f6";

          function hexToRgb(hex) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `${r},${g},${b}`;
          }
          const rgb = hexToRgb(isHighlit ? "#5aabf0" : typeCol);

          // Strong, vibrant radial gradient for rich seamless beam presence
          const grad = ctx.createRadialGradient(originX, originY, 0, originX, originY, fovLen);

          if (showHeatmap) {
            if (!online) {
              grad.addColorStop(0, "rgba(100, 116, 139, 0.55)");
              grad.addColorStop(0.65, "rgba(100, 116, 139, 0.32)");
              grad.addColorStop(1, "rgba(100, 116, 139, 0.08)");
            } else {
              // Vivid emerald green coverage highlight on heatmap
              grad.addColorStop(0, "rgba(16, 185, 129, 0.90)");
              grad.addColorStop(0.35, "rgba(16, 185, 129, 0.75)");
              grad.addColorStop(0.75, "rgba(16, 185, 129, 0.52)");
              grad.addColorStop(1, "rgba(16, 185, 129, 0.20)");
            }
          } else {
            if (!online) {
              grad.addColorStop(0, "rgba(110, 110, 110, 0.55)");
              grad.addColorStop(0.7, "rgba(110, 110, 110, 0.32)");
              grad.addColorStop(1, "rgba(110, 110, 110, 0.08)");
            } else {
              grad.addColorStop(0, `rgba(${rgb}, 0.76)`);
              grad.addColorStop(0.45, `rgba(${rgb}, 0.54)`);
              grad.addColorStop(0.82, `rgba(${rgb}, 0.32)`);
              grad.addColorStop(1, `rgba(${rgb}, 0.10)`);
            }
          }

          if (showPpm) {
            const camObj = cameras.find(c => c.id === m.camId) || m.camera;
            const dori = getDoriDistances(camObj || { hfov: m.fovAngle || 60, rangeDay: m.rangeDay || 25 });
            const doriBands = [
              { distM: dori.detection, color: "#3b82f6" },
              { distM: dori.observation, color: "#eab308" },
              { distM: dori.recognition, color: "#ef4444" },
              { distM: dori.identification, color: "#a855f7" }
            ];
            const maxM = dori.maxDist || 25;
            doriBands.forEach(({ distM, color }) => {
              const rDist = Math.max(5, fovLen * Math.min(1.0, distM / maxM));
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(originX, originY);
              ctx.arc(originX, originY, rDist, angle - halfRad, angle + halfRad);
              ctx.closePath();
              ctx.fillStyle = color + "55";
              ctx.fill();
              ctx.strokeStyle = color + "aa";
              ctx.lineWidth = 1.2;
              ctx.stroke();

              // Render DORI meter label badge along beam centerline
              if (rDist > 15) {
                const labelX = originX + Math.cos(angle) * (rDist * 0.88);
                const labelY = originY + Math.sin(angle) * (rDist * 0.88);
                ctx.font = "bold 10px Inter, Arial, sans-serif";
                const txt = `${distM.toFixed(1)} m`;
                const tw = ctx.measureText(txt).width + 8;
                const th = 14;

                ctx.fillStyle = color;
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
              }
              ctx.restore();
            });
          } else {
            ctx.fillStyle = grad;
            traceCone(ctx, originX, originY, fovLen, angle, halfRad);
            ctx.fill();
          }

          ctx.restore();
        });
      }

    // ── 3. Camera bodies + number labels + direction handles ───────
    // Dynamic icon scaling based on layout physical dimensions
    const layoutBaseDim = Math.max(img.width, img.height);
    const layoutScaleFactor = Math.max(0.65, Math.min(2.5, layoutBaseDim / 1800));
    const S = iconScale * layoutScaleFactor; // ★ Dynamic layout-adaptive camera scale

    markers.forEach((m, i) => {
      const cam = cameras.find(c => c.id === m.camId) || {
        name: m.camName || m.camId, ip: m.camIp || "", status: "offline",
      };
      const online = cam.status === "online";
      const hasAlert = localStorage.getItem("miradorai_show_event_ind") !== "false" && alertCounts && alertCounts[cam.ip] > 0;
      const isHighlit = m.camId === highlightedCamId || i === selectedIdx;
      const col = hasAlert ? "#E24B4A" : (online ? (isHighlit ? "#5aabf0" : "#1D9E75") : "#555");
      const R = 8;   // glow / hit radius
      const hov = i === hoveredIdxRef.current;

      // ── Glow ring ──
      ctx.beginPath();
      let ringRadius = hov ? R + 4 : R + 1.5;
      if (hasAlert) {
        const pulse = Math.sin(Date.now() / 150) * 2.5 + 2.5;
        ringRadius += pulse;
      }
      ctx.arc(m.x, m.y, ringRadius, 0, Math.PI * 2);
      ctx.fillStyle = col + (hasAlert ? "60" : (isHighlit ? "40" : "20"));
      ctx.fill();

      // ── Rotated camera body (type-specific shapes relative to m.x, m.y) ──
      const angle = (m.direction || 0) * (Math.PI / 180);
      const type = getCamType(cam);
      ctx.save();
      ctx.translate(m.x, m.y);

      if (hov || isHighlit) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
      }

      if (type === "bullet") {
        const bS = S * 0.9;
        
        // --- FIXED MOUNT & ARM ---
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
        
        // --- FIXED MOUNT & ARM ---
        ctx.save();
        if (m.flip) ctx.scale(-1, 1);
        
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
        ctx.roundRect(8*pS, -3*pS, 4*pS, 6*pS, 1);
        ctx.fillStyle = "#262626"; ctx.fill();
        
        // Lens
        ctx.beginPath();
        ctx.arc(10*pS, 0, 1.8*pS, 0, Math.PI*2);
        ctx.fillStyle = "#000000"; ctx.fill();

      } else {
        // For all other types, we rotate first
        ctx.rotate(angle);

        if (type === "dome" || type === "turret") {
          // Top white cover (hemisphere)
          ctx.beginPath();
          ctx.arc(0, 0, 11 * S, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff"; ctx.fill();
          ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
          
          // Cutout for the black dome
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
          // BOX / THERMAL / OTHER
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

      ctx.shadowBlur = 0;
      ctx.restore();

      // ── Number label ──
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.fillStyle = online ? "#000000" : "#666666"; // Contrasting color since body is white
      ctx.font = `bold ${hov ? 9 : 8}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((i + 1).toString(), -2 * S, 0);
      ctx.restore();

      // ── Draggable Camera Name Label Badge with optional dotted leader line ──
      const displayLabel = m.camName || cam.name || cam.model || `Camera ${i + 1}`;
      ctx.font = "10.5px Inter, sans-serif";
      const tw = ctx.measureText(displayLabel).width;

      // Apply label offset if present
      const lo = m.labelOffset || { dx: 0, dy: 0 };
      const labelCenterX = m.x + lo.dx;
      const labelTopY = m.y - 24 + lo.dy;
      const bx = labelCenterX - tw / 2 - 7;
      const by = labelTopY;
      const labelW = tw + 14;
      const labelH = 18;

      // Draw dotted leader line if label has been moved
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

      ctx.save();
      const isLight = document.documentElement.getAttribute("data-theme") === "light";
      ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "#0d1117ee";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, labelW, labelH, 4);
      else ctx.rect(bx, by, labelW, labelH);
      ctx.fill();

      // Border styling
      if (isHighlit || i === selectedIdx) {
        ctx.strokeStyle = isLight ? "#2563eb" : "#5aabf0";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (lo.dx !== 0 || lo.dy !== 0) {
        ctx.strokeStyle = isLight ? "#7c3aed" : "#a855f7";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.strokeStyle = isLight ? "#cbd5e1" : "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.fillStyle = isLight ? "#1e293b" : "#e8edf5";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(displayLabel, labelCenterX, by + 9);
      ctx.restore();

      // ── Hover tooltip (shows extra details if hovering directly over camera icon) ──
      if (hov && (lo.dx === 0 && lo.dy === 0)) {
        // Only show if label is in default position and user hovers over the camera body
      }

      // ── Direction Minimalist Accent Grip Dot Rotation Handle ──
      const ang2 = (m.direction || 0) * (Math.PI / 180);
      const eyeR = R + 18;
      const hx = m.x + Math.cos(ang2) * eyeR;
      const hy = m.y + Math.sin(ang2) * eyeR;

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
      ctx.strokeStyle = (online ? col : "#666") + "66";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Primary accent ring
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.strokeStyle = online ? col : "#666";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Inner solid grip core dot
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = online ? col : "#666";
      ctx.fill();

      ctx.restore();
    });

      ctx.restore();
    }
    onDraw?.();
  }, [cameras, markers, zones, floorImgRef, scaleRef, offsetRef, hoveredIdxRef, highlightedCamId, onDraw, ppm, calibration]);

  useImperativeHandle(ref, () => ({ drawAll }), [drawAll]);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawAll);
  }, [drawAll]);

  useEffect(() => {
    const obs = new ResizeObserver(drawAll);
    const el = canvasRef.current?.parentElement;
    if (el) obs.observe(el);
    return () => obs.disconnect();
  }, [drawAll]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height: "100%" }}
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
    />
  );
});

export default MapCanvas;