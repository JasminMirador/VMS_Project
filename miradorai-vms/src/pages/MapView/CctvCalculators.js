/**
 * CctvCalculators.js
 * Utility functions for CCTV engineering calculations based on industry standards.
 */
// ── Pricing Constants ──
export const ACCESSORY_PRICES = {
  mounting: {
    default: 0,
    wall: 59,
    ceiling: 45,
    pole: 69,
    corner: 79,
  },
  backbox: 35,
  poe: 45,
};
/**
 * Calculates camera base price based on type and Megapixel count.
 * @param {object} camera 
 * @returns {number} Estimated price in USD.
 */
export function getCameraBasePrice(camera) {
  if (!camera) return 0;
  let base = 299;
  const type = camera.type || "dome";
  
  if (type === "dome") base = 299;
  else if (type === "bullet") base = 349;
  else if (type === "fisheye") base = 499;
  else if (type === "box") base = 399;
  else if (type === "ptz") base = 899;
  else if (type === "thermal") base = 1499;
  // Add Megapixel premium ($40 per MP above 2MP)
  const mp = camera.megapixels || 2;
  if (mp > 2) {
    base += (mp - 2) * 40;
  }
  return base;
}
/**
 * Calculates selected camera mounting and accessories total price.
 * @param {object} placedCamera - Placed camera state entry.
 * @returns {number} Accessories cost in USD.
 */
export function getCameraAccessoryPrice(placedCamera) {
  if (!placedCamera) return 0;
  let total = 0;
  
  const mountType = placedCamera.mounting || "default";
  total += ACCESSORY_PRICES.mounting[mountType] || 0;
  if (placedCamera.includeBackbox) {
    total += ACCESSORY_PRICES.backbox;
  }
  if (placedCamera.includePoe) {
    total += ACCESSORY_PRICES.poe;
  }
  return total;
}
/**
 * Estimating camera typical bitrate in Mbps based on dynamic settings.
 * @param {object} p - Placed camera entry.
 * @param {string} codec - "h265" | "h264".
 * @returns {number} Estimated bitrate in Mbps.
 */
export function estimateCameraBitrate(p, codec = "h265") {
  if (!p || !p.camera) return 0;
  
  // 1. Base bitrate depending on codec
  let base = p.camera.bitrateTypical ?? 4;
  if (codec === "h264") {
    base = p.camera.bitrateH264 ?? (base * 2) ?? 8;
  }
  // 2. Adjust for FPS setting
  let fpsFactor = 1.0;
  const fps = p.fps || 25;
  if (fps === 5) fpsFactor = 0.3;
  else if (fps === 10) fpsFactor = 0.5;
  else if (fps === 15) fpsFactor = 0.7;
  else if (fps === 20) fpsFactor = 0.8;
  else if (fps === 25) fpsFactor = 0.9;
  else if (fps === 30) fpsFactor = 1.0;
  else if (fps === 60) fpsFactor = 2.0;
  else fpsFactor = fps / 30.0;
  // 3. Adjust for Recording Scenario Mode
  let modeFactor = 1.0;
  const mode = p.recordingMode || "continuous";
  if (mode === "motion20") modeFactor = 0.22; // 20% activity + baseline overhead
  else if (mode === "motion50") modeFactor = 0.52; // 50% activity + baseline overhead
  else if (mode === "scheduled") modeFactor = 0.50; // 12-hour recording daily
  // 4. Adjust for Scene Lighting Conditions
  let lightFactor = 1.0;
  const lighting = p.lighting || "normal";
  if (lighting === "lowlight") lightFactor = 1.4; // Low light noise makes H.264/H.265 files larger
  else if (lighting === "backlight") lightFactor = 1.25; // Backlight/WDR increases scene details
  return base * fpsFactor * modeFactor * lightFactor;
}
/**
 * Calculates storage requirement in GB.
 * @param {number} totalBitrateMbps 
 * @param {number} days - Retention period in days.
 * @returns {number} Storage in GB.
 */
export function calculateStorage(totalBitrateMbps, days) {
  if (!totalBitrateMbps || !days) return 0;
  return (totalBitrateMbps * 3600 * 24 * days) / (8 * 1024);
}
/**
 * Calculates total bandwidth in Mbps.
 * @param {Array} placedCameras 
 * @param {string} codec 
 * @returns {number} Total bandwidth in Mbps.
 */
export function calculateBandwidth(placedCameras, codec = "h265") {
  if (!placedCameras?.length) return 0;
  return placedCameras.reduce((sum, p) => sum + estimateCameraBitrate(p, codec), 0);
}
/**
 * Calculates PPM (Pixels Per Meter) at a given scene width.
 * @param {number} horizontalPixels - Horizontal resolution of the camera.
 * @param {number} sceneWidthMeters - Width of the scene in meters at a specific distance.
 * @returns {number} PPM value.
 */
export function calculatePPM(horizontalPixels, sceneWidthMeters) {
  if (!horizontalPixels || !sceneWidthMeters) return 0;
  return horizontalPixels / sceneWidthMeters;
}
/**
 * Returns the clarity level name and color based on PPM value.
 * @param {number} ppm 
 * @returns {object} { label: string, color: string }
 */
export function getClarityFromPPM(ppm) {
  if (ppm >= 250) return { label: "Identification (I)", color: "#ef4444" }; // Red (250+ px/m)
  if (ppm >= 125) return { label: "Recognition (R)", color: "#f59e0b" };    // Yellow/Amber (125+ px/m)
  if (ppm >= 62)  return { label: "Observation (O)", color: "#10b981" };     // Green (62+ px/m)
  if (ppm >= 25)  return { label: "Detection (D)", color: "#3b82f6" };       // Blue (25+ px/m)
  return { label: "Uncovered", color: "#64748b" };                           // Grey
}

/**
 * Calculates accurate DORI zone distances in meters based on EN 62676-4 standard.
 * @param {object} camera 
 * @returns {object} { identification, recognition, observation, detection, maxDist }
 */
export function getDoriDistances(camera) {
  const cam = camera || {};
  const specs = cam.specs || cam;
  const mp = specs.megapixels || cam.megapixels || 2;
  const resX = specs.resolutionX || cam.resolutionX || (
    mp === 12 ? 4000 :
    mp === 8 ? 3840 :
    mp === 5 ? 2592 :
    mp === 4 ? 2688 :
    mp === 2 ? 1920 :
    Math.round(Math.sqrt((16 / 9) * mp) * 1000) || 1920
  );
  const hfov = specs.hfov || cam.hfov || cam.fov || cam.fovAngle || 90;
  const hfovRad = (hfov * Math.PI) / 180;
  const tanHalf = Math.max(0.01, Math.tan(hfovRad / 2));
  const maxDist = specs.rangeDay || cam.rangeDay || specs.range || cam.range || 30;

  const calcDist = (tPpm) => {
    let d;
    if (specs.type === "fisheye" || cam.type === "fisheye" || hfov >= 180) {
      d = (resX / (Math.PI * tPpm)) * 0.35;
    } else {
      d = resX / (2 * tPpm * tanHalf);
    }
    return Math.min(maxDist, Math.max(0.2, d));
  };

  return {
    identification: calcDist(250),
    recognition: calcDist(125),
    observation: calcDist(62),
    detection: calcDist(25),
    maxDist
  };
}
/**
 * Recommends hardware based on camera count.
 */
export function getHardwareRecommendations(cameraCount) {
  let nvr = "4-Channel NVR";
  let nvrPrice = 299;
  if (cameraCount > 32) {
    nvr = "64-Channel NVR";
    nvrPrice = 999;
  } else if (cameraCount > 16) {
    nvr = "32-Channel NVR";
    nvrPrice = 699;
  } else if (cameraCount > 8) {
    nvr = "16-Channel NVR";
    nvrPrice = 499;
  } else if (cameraCount > 4) {
    nvr = "8-Channel NVR";
    nvrPrice = 399;
  }
  const switches = Math.ceil(cameraCount / 8); // 8-port switches
  const switchPrice = 199; // $199 per 8-port PoE switch
  
  return {
    nvr,
    nvrPrice,
    switchesCount: switches,
    switchesPrice: switches * switchPrice,
    switches: `${switches} x 8-Port PoE Switch${switches > 1 ? "es" : ""}`
  };
}

/**
 * Computes the visibility polygon from an origin, limited by a base polygon and obstructed by obstacles.
 * @param {object} origin - { x, y } camera location
 * @param {Array} basePoly - Array of { x, y } representing the base FOV/DORI area
 * @param {Array} obstaclePolygons - Array of polygons (each an array of { x, y }) representing obstacles
 * @param {Array} extraSegments - Array of line segments [ [p1x, p1y], [p2x, p2y] ] or [ {x, y}, {x, y} ]
 * @returns {Array} Array of { x, y } vertices representing the visibility polygon
 */
export function computeVisibilityPolygon(origin, basePoly, obstaclePolygons = [], extraSegments = []) {
  if (!basePoly || basePoly.length < 3) return basePoly || [];

  function toPoint(p) {
    if (!p) return null;
    if (Array.isArray(p)) return { x: Number(p[0]), y: Number(p[1]) };
    return { x: Number(p.x), y: Number(p.y) };
  }

  function getIntersection(p1, p2, p3, p4) {
    const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (Math.abs(denom) < 1e-9) return null;
    const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
    const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
    if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
      return { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y), t: ua };
    }
    return null;
  }

  const baseSegments = [];
  for (let i = 0; i < basePoly.length; i++) {
    const p1 = toPoint(basePoly[i]);
    const p2 = toPoint(basePoly[(i + 1) % basePoly.length]);
    if (p1 && p2 && !(p1.x === p2.x && p1.y === p2.y)) {
      baseSegments.push([p1, p2]);
    }
  }

  const obstacleSegments = [];
  if (obstaclePolygons) {
    for (const poly of obstaclePolygons) {
      if (!poly || poly.length < 2) continue;
      for (let i = 0; i < poly.length; i++) {
        const p1 = toPoint(poly[i]);
        const p2 = toPoint(poly[(i + 1) % poly.length]);
        if (p1 && p2 && !(p1.x === p2.x && p1.y === p2.y)) {
          obstacleSegments.push([p1, p2]);
        }
      }
    }
  }

  if (extraSegments && extraSegments.length > 0) {
    for (const seg of extraSegments) {
      if (!seg || seg.length < 2) continue;
      const p1 = toPoint(seg[0]);
      const p2 = toPoint(seg[1]);
      if (p1 && p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        // Ignore micro-segments (< 4px) to prevent ray-casting noise
        if (dx * dx + dy * dy >= 16) {
          obstacleSegments.push([p1, p2]);
        }
      }
    }
  }

  const angles = new Set();
  const targets = [];
  
  for (const pt of basePoly) {
    const p = toPoint(pt);
    if (p && !(p.x === origin.x && p.y === origin.y)) {
      targets.push(p);
    }
  }
  for (const seg of obstacleSegments) {
    targets.push(seg[0]);
    targets.push(seg[1]);
  }

  for (const pt of targets) {
    const angle = Math.atan2(pt.y - origin.y, pt.x - origin.x);
    angles.add(angle);
    angles.add(angle - 0.0002);
    angles.add(angle + 0.0002);
  }

  if (angles.size === 0) {
    for (let i = 0; i < 16; i++) {
      angles.add((i * Math.PI) / 8);
    }
  }

  const sortedAngles = Array.from(angles).sort((a, b) => a - b);
  const visPoints = [];

  for (const angle of sortedAngles) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const rayEnd = { x: origin.x + dx * 100000, y: origin.y + dy * 100000 };

    let baseInt = null;
    let minBaseT = Infinity;
    for (const seg of baseSegments) {
      const intersect = getIntersection(origin, rayEnd, seg[0], seg[1]);
      if (intersect && intersect.t > 1e-4 && intersect.t < minBaseT) {
        minBaseT = intersect.t;
        baseInt = intersect;
      }
    }

    if (!baseInt) continue;

    let limitT = minBaseT;
    let finalPt = baseInt;

    for (const seg of obstacleSegments) {
      const intersect = getIntersection(origin, rayEnd, seg[0], seg[1]);
      if (intersect && intersect.t > 1e-4 && intersect.t < limitT) {
        limitT = intersect.t;
        finalPt = intersect;
      }
    }

    visPoints.push({ x: finalPt.x, y: finalPt.y });
  }

  const cleanPoints = [];
  for (let i = 0; i < visPoints.length; i++) {
    const p = visPoints[i];
    const prev = cleanPoints[cleanPoints.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 0.05 && Math.abs(prev.y - p.y) < 0.05) {
      continue;
    }
    cleanPoints.push(p);
  }

  // If basePoly included origin as a vertex (standard FOV cone sector), append origin to close the wedge
  const baseHasOrigin = basePoly.some(p => {
    const pt = toPoint(p);
    return pt && Math.hypot(pt.x - origin.x, pt.y - origin.y) < 1.0;
  });
  if (baseHasOrigin && cleanPoints.length > 0) {
    cleanPoints.push({ x: origin.x, y: origin.y });
  }

  return cleanPoints;
}

/**
 * Computes the visibility polygon for a camera FOV cone/wedge, occluded by obstacles.
 * Uses relative-angle radial sweep to eliminate branch-cut discontinuities around Math.PI/-Math.PI.
 * @param {object} origin - { x, y } camera origin
 * @param {number} centerAngle - Direction of camera in radians
 * @param {number} halfRad - Half FOV angle in radians
 * @param {number} fovLen - Beam radius in pixels
 * @param {Array} obstaclePolygons - Array of obstacle polygons
 * @param {Array} extraSegments - Array of wall line segments [[x1, y1], [x2, y2]]
 * @param {Array} basePoly - Optional room zone polygon to constrain beam within
 * @returns {Array} Array of { x, y } vertices representing the visibility polygon
 */
export function computeFovVisibility(origin, centerAngle, halfRad, fovLen, obstaclePolygons = [], extraSegments = [], basePoly = null) {
  function toPoint(p) {
    if (!p) return null;
    if (Array.isArray(p)) return { x: Number(p[0]), y: Number(p[1]) };
    return { x: Number(p.x), y: Number(p.y) };
  }

  function getIntersection(p1, p2, p3, p4) {
    const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (Math.abs(denom) < 1e-9) return null;
    const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
    const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
    if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
      return { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y), t: ua };
    }
    return null;
  }

  const startAngle = centerAngle - halfRad;
  const span = 2 * halfRad;

  // Base bounding segments (e.g. from an enclosing room zone)
  const baseSegments = [];
  if (basePoly && basePoly.length >= 3) {
    for (let i = 0; i < basePoly.length; i++) {
      const p1 = toPoint(basePoly[i]);
      const p2 = toPoint(basePoly[(i + 1) % basePoly.length]);
      if (p1 && p2 && !(p1.x === p2.x && p1.y === p2.y)) {
        baseSegments.push([p1, p2]);
      }
    }
  }

  // All obstacle segments (barrier zones + CAD wall lines)
  const allObstacles = [];
  if (obstaclePolygons) {
    for (const poly of obstaclePolygons) {
      if (!poly || poly.length < 2) continue;
      for (let i = 0; i < poly.length; i++) {
        const p1 = toPoint(poly[i]);
        const p2 = toPoint(poly[(i + 1) % poly.length]);
        if (p1 && p2 && !(p1.x === p2.x && p1.y === p2.y)) {
          allObstacles.push([p1, p2]);
        }
      }
    }
  }
  if (extraSegments) {
    for (const seg of extraSegments) {
      if (!seg || seg.length < 2) continue;
      const p1 = toPoint(seg[0]);
      const p2 = toPoint(seg[1]);
      if (p1 && p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        // Ignore micro-segments (< 4px) to prevent ray-casting noise and fragmented beams
        if (dx * dx + dy * dy >= 16) {
          allObstacles.push([p1, p2]);
        }
      }
    }
  }

  // Helper to convert absolute point to relative angle in [0, 2*PI) from startAngle
  function toRelAngle(x, y) {
    const absAng = Math.atan2(y - origin.y, x - origin.x);
    return ((absAng - startAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  }

  const relAngles = new Set();
  const STEPS = 24;
  for (let i = 0; i <= STEPS; i++) {
    relAngles.add((i / STEPS) * span);
  }

  const allTargets = [];
  if (basePoly) {
    for (const pt of basePoly) {
      const p = toPoint(pt);
      if (p && !(p.x === origin.x && p.y === origin.y)) allTargets.push(p);
    }
  }
  for (const seg of allObstacles) {
    allTargets.push(seg[0]);
    allTargets.push(seg[1]);
  }

  for (const pt of allTargets) {
    const rel = toRelAngle(pt.x, pt.y);
    if (rel >= -0.01 && rel <= span + 0.01) {
      const clamped = Math.max(0, Math.min(span, rel));
      relAngles.add(clamped);
      if (clamped - 0.0003 >= 0) relAngles.add(clamped - 0.0003);
      if (clamped + 0.0003 <= span) relAngles.add(clamped + 0.0003);
    }
  }

  const sortedRel = Array.from(relAngles).sort((a, b) => a - b);
  const visPoints = [];
  const maxRayLen = Math.max(100, fovLen * 3);

  for (const rel of sortedRel) {
    const curAngle = startAngle + rel;
    const dx = Math.cos(curAngle);
    const dy = Math.sin(curAngle);

    let maxDist = fovLen;
    const rayEnd = { x: origin.x + dx * maxRayLen, y: origin.y + dy * maxRayLen };

    if (baseSegments.length > 0) {
      let minBaseT = Infinity;
      for (const seg of baseSegments) {
        const intersect = getIntersection(origin, rayEnd, seg[0], seg[1]);
        if (intersect && intersect.t > 1e-4 && intersect.t < minBaseT) {
          minBaseT = intersect.t;
        }
      }
      if (minBaseT < Infinity) {
        maxDist = Math.min(maxDist, minBaseT * maxRayLen);
      }
    }

    let limitDist = maxDist;
    let finalPt = { x: origin.x + dx * maxDist, y: origin.y + dy * maxDist };

    for (const seg of allObstacles) {
      const intersect = getIntersection(origin, rayEnd, seg[0], seg[1]);
      if (intersect && intersect.t > 1e-4) {
        const dist = intersect.t * maxRayLen;
        // Ignore self-intersection with the immediate mounting wall surface (< 8px / < 0.35m)
        if (dist >= 8.0 && dist < limitDist) {
          limitDist = dist;
          finalPt = { x: intersect.x, y: intersect.y };
        }
      }
    }

    visPoints.push(finalPt);
  }

  const clean = [];
  for (let i = 0; i < visPoints.length; i++) {
    const p = visPoints[i];
    const prev = clean[clean.length - 1];
    if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 0.25) continue;
    clean.push(p);
  }

  clean.push({ x: origin.x, y: origin.y });
  return clean;
}

/**
 * Merges adjacent collinear wall segments and calculates wall metrics in meters.
 * @param {Array} walls - Array of [[x1, y1], [x2, y2]]
 * @param {number} ppm - Pixels per meter
 * @param {number} minLengthM - Minimum wall length to include (default 0.8m)
 * @returns {Array} Array of { p1, p2, lengthPx, lengthM, midX, midY, angle }
 */
export function mergeCollinearWalls(walls, ppm, minLengthM = 0.8) {
  if (!walls || walls.length === 0 || !ppm) return [];

  const raw = [];
  for (const seg of walls) {
    if (!seg || seg.length < 2) continue;
    const p1 = Array.isArray(seg[0]) ? { x: Number(seg[0][0]), y: Number(seg[0][1]) } : { x: Number(seg[0].x), y: Number(seg[0].y) };
    const p2 = Array.isArray(seg[1]) ? { x: Number(seg[1][0]), y: Number(seg[1][1]) } : { x: Number(seg[1].x), y: Number(seg[1].y) };
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenPx = Math.hypot(dx, dy);
    if (lenPx < 2) continue;
    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += Math.PI;
    if (angle >= Math.PI) angle -= Math.PI;
    raw.push({ p1, p2, lenPx, angle });
  }

  const merged = [];
  const used = new Set();

  for (let i = 0; i < raw.length; i++) {
    if (used.has(i)) continue;
    let seg = { ...raw[i] };
    used.add(i);

    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < raw.length; j++) {
        if (used.has(j)) continue;
        const other = raw[j];
        const angleDiff = Math.abs(seg.angle - other.angle);
        if (angleDiff < 0.05 || Math.abs(angleDiff - Math.PI) < 0.05) {
          const d_p2_p1 = Math.hypot(seg.p2.x - other.p1.x, seg.p2.y - other.p1.y);
          const d_p2_p2 = Math.hypot(seg.p2.x - other.p2.x, seg.p2.y - other.p2.y);
          const d_p1_p1 = Math.hypot(seg.p1.x - other.p1.x, seg.p1.y - other.p1.y);
          const d_p1_p2 = Math.hypot(seg.p1.x - other.p2.x, seg.p1.y - other.p2.y);

          if (d_p2_p1 < 3) {
            seg.p2 = other.p2;
            used.add(j);
            extended = true;
            break;
          } else if (d_p2_p2 < 3) {
            seg.p2 = other.p1;
            used.add(j);
            extended = true;
            break;
          } else if (d_p1_p1 < 3) {
            seg.p1 = other.p2;
            used.add(j);
            extended = true;
            break;
          } else if (d_p1_p2 < 3) {
            seg.p1 = other.p1;
            used.add(j);
            extended = true;
            break;
          }
        }
      }
    }

    const totalLenPx = Math.hypot(seg.p2.x - seg.p1.x, seg.p2.y - seg.p1.y);
    const totalLenM = totalLenPx / ppm;
    if (totalLenM >= minLengthM) {
      merged.push({
        p1: seg.p1,
        p2: seg.p2,
        lengthPx: totalLenPx,
        lengthM: totalLenM,
        midX: (seg.p1.x + seg.p2.x) / 2,
        midY: (seg.p1.y + seg.p2.y) / 2,
        angle: Math.atan2(seg.p2.y - seg.p1.y, seg.p2.x - seg.p1.x)
      });
    }
  }

  return merged;
}

/**
 * Extracts continuous exterior/perimeter boundary sides by clustering collinear segments,
 * bridging door/column/window gaps, and identifying exterior-facing building boundary runs.
 */
export function extractExteriorBoundaryRuns(walls, ppm) {
  if (!walls || walls.length === 0 || !ppm) return [];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const rawSegs = [];

  for (const s of walls) {
    if (!s || s.length < 2) continue;
    const p1 = Array.isArray(s[0]) ? { x: Number(s[0][0]), y: Number(s[0][1]) } : { x: Number(s[0].x), y: Number(s[0].y) };
    const p2 = Array.isArray(seg_p2(s)) ? { x: Number(s[1][0]), y: Number(s[1][1]) } : { x: Number(s[1].x), y: Number(s[1].y) };
    if (isNaN(p1.x) || isNaN(p1.y) || isNaN(p2.x) || isNaN(p2.y)) continue;

    minX = Math.min(minX, p1.x, p2.x);
    maxX = Math.max(maxX, p1.x, p2.x);
    minY = Math.min(minY, p1.y, p2.y);
    maxY = Math.max(maxY, p1.y, p2.y);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 5) continue;

    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += Math.PI;
    if (angle >= Math.PI) angle -= Math.PI;

    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const d = nx * p1.x + ny * p1.y;

    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const t1 = ux * p1.x + uy * p1.y;
    const t2 = ux * p2.x + uy * p2.y;

    rawSegs.push({
      p1, p2, len, angle, nx, ny, d, ux, uy,
      tmin: Math.min(t1, t2),
      tmax: Math.max(t1, t2)
    });
  }

  function seg_p2(s) {
    return s[1];
  }

  if (rawSegs.length === 0) return [];

  // Cluster collinear segments
  const clusters = [];
  const used = new Set();

  for (let i = 0; i < rawSegs.length; i++) {
    if (used.has(i)) continue;
    const cl = [rawSegs[i]];
    used.add(i);

    for (let j = i + 1; j < rawSegs.length; j++) {
      if (used.has(j)) continue;
      const s1 = rawSegs[i];
      const s2 = rawSegs[j];

      let angleDiff = Math.abs(s1.angle - s2.angle);
      if (angleDiff > Math.PI / 2) angleDiff = Math.abs(angleDiff - Math.PI);

      if (angleDiff < 0.06) {
        const d1 = Math.abs(s1.nx * s2.p1.x + s1.ny * s2.p1.y - s1.d);
        const d2 = Math.abs(s1.nx * s2.p2.x + s1.ny * s2.p2.y - s1.d);
        if (d1 < 16 && d2 < 16) {
          cl.push(s2);
          used.add(j);
        }
      }
    }
    clusters.push(cl);
  }

  // Merge continuous intervals across column/window/door gaps
  const candidateRuns = [];
  const maxGap = 180.0;

  for (const cl of clusters) {
    const ref = cl[0];
    const avgD = cl.reduce((sum, s) => sum + s.d, 0) / cl.length;
    const intervals = cl.map(s => ({ tmin: s.tmin, tmax: s.tmax, len: s.len }))
                        .sort((a, b) => a.tmin - b.tmin);

    let curMin = intervals[0].tmin;
    let curMax = intervals[0].tmax;
    let curDrawn = 0;
    const merged = [];

    for (const iv of intervals) {
      if (iv.tmin <= curMax + maxGap) {
        curMax = Math.max(curMax, iv.tmax);
        curDrawn += iv.len;
      } else {
        merged.push({ min: curMin, max: curMax, drawn: curDrawn });
        curMin = iv.tmin;
        curMax = iv.tmax;
        curDrawn = iv.len;
      }
    }
    merged.push({ min: curMin, max: curMax, drawn: curDrawn });

    for (const m of merged) {
      const spanPx = m.max - m.min;
      const spanM = spanPx / ppm;
      if (spanM < 2.2) continue; // Major continuous exterior runs (>= 2.2m)

      const p1x = m.min * ref.ux + avgD * ref.nx;
      const p1y = m.min * ref.uy + avgD * ref.ny;
      const p2x = m.max * ref.ux + avgD * ref.nx;
      const p2y = m.max * ref.uy + avgD * ref.ny;

      const midX = (p1x + p2x) / 2;
      const midY = (p1y + p2y) / 2;

      // Determine outward normal
      const testDist = 45;
      const pt1X = midX + ref.nx * testDist;
      const pt1Y = midY + ref.ny * testDist;
      const pt2X = midX - ref.nx * testDist;
      const pt2Y = midY - ref.ny * testDist;

      let cnt1 = 0, cnt2 = 0;
      for (const seg of rawSegs) {
        const dot1 = (seg.p1.x - midX) * ref.nx + (seg.p1.y - midY) * ref.ny;
        if (dot1 > 15) cnt1++;
        const dot2 = (seg.p1.x - midX) * (-ref.nx) + (seg.p1.y - midY) * (-ref.ny);
        if (dot2 > 15) cnt2++;
      }

      const isExt1 = pt1X <= minX + 15 || pt1X >= maxX - 15 || pt1Y <= minY + 15 || pt1Y >= maxY - 15;
      const isExt2 = pt2X <= minX + 15 || pt2X >= maxX - 15 || pt2Y <= minY + 15 || pt2Y >= maxY - 15;

      const isExterior = cnt1 <= 3 || cnt2 <= 3 || isExt1 || isExt2;
      if (isExterior) {
        const outNx = (cnt1 <= cnt2) ? ref.nx : -ref.nx;
        const outNy = (cnt1 <= cnt2) ? ref.ny : -ref.ny;

        candidateRuns.push({
          p1: { x: p1x, y: p1y },
          p2: { x: p2x, y: p2y },
          mid: { x: midX, y: midY },
          normal: { x: outNx, y: outNy },
          angle: ref.angle,
          spanM,
          spanPx
        });
      }
    }
  }

  // Deduplicate parallel double walls (keep the longest / outermost)
  candidateRuns.sort((a, b) => b.spanM - a.spanM);
  const filtered = [];

  for (const r of candidateRuns) {
    let dup = false;
    for (const f of filtered) {
      let ad = Math.abs(r.angle - f.angle);
      if (ad > Math.PI / 2) ad = Math.abs(ad - Math.PI);
      if (ad < 0.08) {
        const dist = Math.hypot(r.mid.x - f.mid.x, r.mid.y - f.mid.y);
        if (dist < 32) {
          dup = true;
          break;
        }
      }
    }
    if (!dup) {
      filtered.push(r);
    }
  }

  return filtered;
}

/**
 * Draws architectural metric dimension badges:
 * 1. Luminous blue/cyan badges along individual interior/exterior wall segments.
 * 2. Full added-up EXTERIOR BOUNDARY MEASUREMENTS in bold RED along each actual drawn boundary side.
 */
export function drawWallDimensions(ctx, walls, ppm) {
  if (!walls || walls.length === 0 || !ppm) return;

  const merged = mergeCollinearWalls(walls, ppm, 0.8);

  ctx.save();

  // ── 1. Individual wall segments in luminous cyan/blue ──
  for (const w of merged) {
    const { lengthM, midX, midY, angle } = w;

    let nx = -Math.sin(angle);
    let ny = Math.cos(angle);
    const offsetDist = 7;
    const lx = midX + nx * offsetDist;
    const ly = midY + ny * offsetDist;

    let textAngle = angle;
    if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
      textAngle += Math.PI;
    }

    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(textAngle);

    const txt = `${lengthM.toFixed(1)}m`;
    ctx.font = "bold 9px 'Inter', Arial, sans-serif";
    const tw = ctx.measureText(txt).width + 6;
    const th = 13;

    // Dark high-contrast pill badge
    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-tw / 2, -th / 2, tw, th, 3);
    else ctx.rect(-tw / 2, -th / 2, tw, th);
    ctx.fill();

    // Subtle cyan outline
    ctx.strokeStyle = "rgba(56, 189, 248, 0.7)";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Text in luminous cyan
    ctx.fillStyle = "#38bdf8";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, 0, 0.5);

    ctx.restore();
  }

  // ── 2. Full Continuous Exterior Boundary Measurements in RED along drawn sides ──
  const extRuns = extractExteriorBoundaryRuns(walls, ppm);

  const drawRedSideBadge = (run) => {
    const { p1, p2, normal, spanM, angle } = run;
    const offsetDist = 18; // offset outside the wall
    const tickLen = 6;

    const x1 = p1.x + normal.x * offsetDist;
    const y1 = p1.y + normal.y * offsetDist;
    const x2 = p2.x + normal.x * offsetDist;
    const y2 = p2.y + normal.y * offsetDist;

    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;

    // Dimension line in bold red
    ctx.save();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.3;
    ctx.setLineDash([5, 3]);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Tick marks at endpoints
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1 - normal.x * tickLen, y1 - normal.y * tickLen);
    ctx.lineTo(x1 + normal.x * tickLen, y1 + normal.y * tickLen);
    ctx.moveTo(x2 - normal.x * tickLen, y2 - normal.y * tickLen);
    ctx.lineTo(x2 + normal.x * tickLen, y2 + normal.y * tickLen);
    ctx.stroke();
    ctx.restore();

    // RED Pill Badge
    let textAngle = angle;
    if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
      textAngle += Math.PI;
    }

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(textAngle);

    const txt = `${spanM.toFixed(1)}m`;
    ctx.font = "bold 10.5px 'Inter', Arial, sans-serif";
    const tw = ctx.measureText(txt).width + 10;
    const th = 16;

    // Glowing dark pill background
    ctx.shadowColor = "rgba(239, 68, 68, 0.45)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-tw / 2, -th / 2, tw, th, 4);
    else ctx.rect(-tw / 2, -th / 2, tw, th);
    ctx.fill();

    // Sharp RED border
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Vibrant bright RED text
    ctx.fillStyle = "#ff4d4f";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, 0, 0.5);

    ctx.restore();
  };

  if (extRuns && extRuns.length > 0) {
    for (const run of extRuns) {
      drawRedSideBadge(run);
    }
  }

  ctx.restore();
}