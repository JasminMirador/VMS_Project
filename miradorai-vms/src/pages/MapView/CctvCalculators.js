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
  if (ppm >= 250) return { label: "Identification (I)", color: "#a855f7" }; // Purple
  if (ppm >= 125) return { label: "Recognition (R)", color: "#ef4444" };    // Red
  if (ppm >= 62)  return { label: "Observation (O)", color: "#eab308" };     // Yellow
  if (ppm >= 25)  return { label: "Detection (D)", color: "#3b82f6" };       // Blue
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
 * @returns {Array} Array of { x, y } vertices representing the visibility polygon
 */
export function computeVisibilityPolygon(origin, basePoly, obstaclePolygons) {
  if (!basePoly || basePoly.length < 3) return basePoly || [];

  function getIntersection(p1, p2, p3, p4) {
    const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (denom === 0) return null;
    const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
    const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
    if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
      return { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y), t: ua };
    }
    return null;
  }

  const baseSegments = [];
  for (let i = 0; i < basePoly.length; i++) {
    baseSegments.push([basePoly[i], basePoly[(i + 1) % basePoly.length]]);
  }

  const obstacleSegments = [];
  if (obstaclePolygons) {
    for (const poly of obstaclePolygons) {
      if (!poly || poly.length < 2) continue;
      for (let i = 0; i < poly.length; i++) {
        obstacleSegments.push([poly[i], poly[(i + 1) % poly.length]]);
      }
    }
  }

  const angles = new Set();
  const targets = [];
  
  for (const pt of basePoly) {
    targets.push(pt);
  }
  if (obstaclePolygons) {
    for (const poly of obstaclePolygons) {
      if (!poly) continue;
      for (const pt of poly) {
        targets.push(pt);
      }
    }
  }

  for (const pt of targets) {
    const angle = Math.atan2(pt.y - origin.y, pt.x - origin.x);
    angles.add(angle);
    angles.add(angle - 0.0001);
    angles.add(angle + 0.0001);
  }

  if (angles.size === 0) {
    for (let i = 0; i < 8; i++) {
      angles.add((i * Math.PI) / 4);
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
      if (intersect && intersect.t < minBaseT) {
        minBaseT = intersect.t;
        baseInt = intersect;
      }
    }

    if (!baseInt) continue;

    let limitT = minBaseT;
    let finalPt = baseInt;

    for (const seg of obstacleSegments) {
      const intersect = getIntersection(origin, rayEnd, seg[0], seg[1]);
      if (intersect && intersect.t < limitT) {
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
    if (prev && Math.abs(prev.x - p.x) < 0.01 && Math.abs(prev.y - p.y) < 0.01) {
      continue;
    }
    cleanPoints.push(p);
  }

  return cleanPoints;
}