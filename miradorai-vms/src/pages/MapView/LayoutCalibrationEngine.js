/**
 * LayoutCalibrationEngine.js
 * 
 * High-precision mathematical and transformation engine for MapView layout calibration.
 * Supports:
 *  1. Standard uniform calibration (single known distance).
 *  2. Advanced non-uniform spatial transformation (multiple reference measurements across distorted layouts).
 *  3. Bidirectional coordinate conversion: Image Pixels (x, y) <-> Calibrated World Meters (X, Y).
 *  4. Local PPM (pixels-per-meter) field evaluation across image space.
 *  5. Geodesic / calibrated distance calculation between arbitrary layout points.
 *  6. Calibration quality & spatial distribution assessment.
 *  7. Deformable metric preview grid generator.
 */

export const UNIT_CONVERSIONS = {
  meters: 1.0,
  m: 1.0,
  feet: 0.3048,
  ft: 0.3048,
  inches: 0.0254,
  in: 0.0254,
  centimeters: 0.01,
  cm: 0.01,
  yards: 0.9144,
  yd: 0.9144,
};

/** Convert any supported unit to meters */
export function toMeters(val, unit = "meters") {
  const factor = UNIT_CONVERSIONS[unit.toLowerCase()] || 1.0;
  return Number(val) * factor;
}

/** Convert meters to target unit */
export function fromMeters(metersVal, unit = "meters") {
  const factor = UNIT_CONVERSIONS[unit.toLowerCase()] || 1.0;
  return Number(metersVal) / factor;
}

/** Calculate pixel distance between two 2D points */
export function getPixelDistance(p1, p2) {
  if (!p1 || !p2) return 0;
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Standard Calibration:
 * Given a single reference line (p1, p2) and known real-world distance in meters,
 * compute the uniform scale (PPM).
 */
export function buildStandardCalibration(reference, imageDimensions = { width: 1000, height: 1000 }) {
  if (!reference || !reference.start || !reference.end) {
    throw new Error("Invalid reference endpoints.");
  }
  const pixelDist = getPixelDistance(reference.start, reference.end);
  if (pixelDist < 2) {
    throw new Error("Reference measurement line is too short.");
  }
  const realMeters = toMeters(reference.realDistance, reference.unit || "meters");
  if (!realMeters || realMeters <= 0 || isNaN(realMeters)) {
    throw new Error("Reference distance must be greater than zero.");
  }

  const ppm = pixelDist / realMeters;
  const metersPerPixel = realMeters / pixelDist;

  return {
    enabled: true,
    mode: "standard",
    ppm,
    metersPerPixel,
    unit: reference.unit || "meters",
    references: [
      {
        id: reference.id || "ref_1",
        start: { x: reference.start.x, y: reference.start.y },
        end: { x: reference.end.x, y: reference.end.y },
        pixelDistance: pixelDist,
        realDistance: Number(reference.realDistance),
        unit: reference.unit || "meters",
        realDistanceMeters: realMeters,
      }
    ],
    imageDimensions,
    timestamp: Date.now(),
  };
}

/**
 * Advanced Calibration:
 * Given multiple reference measurements located at different areas of a distorted/non-uniform layout,
 * establish a continuous 2D spatial metric transformation field.
 * 
 * Does NOT average scales. Instead, models local metric variations using Radial Basis Functions (RBF)
 * and Inverse Distance Weighting with smooth spatial regularization.
 */
export function buildAdvancedCalibration(references, imageDimensions = { width: 1000, height: 1000 }) {
  if (!Array.isArray(references) || references.length === 0) {
    throw new Error("At least one valid reference measurement is required.");
  }

  const validRefs = references.filter(r => {
    if (!r.start || !r.end) return false;
    const dPx = getPixelDistance(r.start, r.end);
    const dM = toMeters(r.realDistance, r.unit || "meters");
    return dPx >= 2 && dM > 0 && !isNaN(dM);
  }).map((r, i) => {
    const dPx = getPixelDistance(r.start, r.end);
    const dM = toMeters(r.realDistance, r.unit || "meters");
    const midX = (r.start.x + r.end.x) / 2;
    const midY = (r.start.y + r.end.y) / 2;
    const localPpm = dPx / dM;
    const localMpp = dM / dPx; // meters per pixel
    return {
      id: r.id || `ref_${i + 1}`,
      start: { x: r.start.x, y: r.start.y },
      end: { x: r.end.x, y: r.end.y },
      mid: { x: midX, y: midY },
      pixelDistance: dPx,
      realDistance: Number(r.realDistance),
      unit: r.unit || "meters",
      realDistanceMeters: dM,
      ppm: localPpm,
      mpp: localMpp,
    };
  });

  if (validRefs.length === 0) {
    throw new Error("No valid reference lines with positive distance provided.");
  }

  // If only 1 reference provided in advanced mode, fallback to uniform standard scale
  if (validRefs.length === 1) {
    return buildStandardCalibration(validRefs[0], imageDimensions);
  }

  // Calculate global baseline scale (as smoothing prior)
  const totalPixels = validRefs.reduce((s, r) => s + r.pixelDistance, 0);
  const totalMeters = validRefs.reduce((s, r) => s + r.realDistanceMeters, 0);
  const globalPpm = totalPixels / totalMeters;
  const globalMpp = totalMeters / totalPixels;

  // Precompute high-resolution spatial deformation grid (e.g. 24x24 cells) for O(1) lightning-fast lookups
  const gridCols = 24;
  const gridRows = 24;
  const W = Math.max(100, imageDimensions.width || 1000);
  const H = Math.max(100, imageDimensions.height || 1000);
  const cellW = W / (gridCols - 1);
  const cellH = H / (gridRows - 1);

  // Characteristic smoothing radius based on layout dimensions
  const R = Math.max(80, Math.hypot(W, H) / (Math.sqrt(validRefs.length) * 1.5));

  // Compute local Meters-Per-Pixel (MPP) at each grid vertex
  const gridMpp = [];
  for (let r = 0; r < gridRows; r++) {
    const row = [];
    const gy = r * cellH;
    for (let c = 0; c < gridCols; c++) {
      const gx = c * cellW;
      
      // Inverse Distance Weighting with Gaussian falloff & global prior
      let weightSum = 0;
      let valSum = 0;
      
      for (const ref of validRefs) {
        const dist = Math.hypot(gx - ref.mid.x, gy - ref.mid.y);
        // Gaussian weight + smooth power
        const w = 1 / (Math.pow(dist / R, 2) + 0.05);
        weightSum += w;
        valSum += w * ref.mpp;
      }
      
      // Weak global prior for areas far away from any references
      const minRefDist = Math.min(...validRefs.map(ref => Math.hypot(gx - ref.mid.x, gy - ref.mid.y)));
      const priorWeight = Math.max(0, (minRefDist - R) / R) * 0.25;
      const finalMpp = (valSum + priorWeight * globalMpp) / (weightSum + priorWeight);

      row.push(finalMpp);
    }
    gridMpp.push(row);
  }

  // Precompute Cumulative World Coordinates on the grid (origin = top-left (0,0))
  const gridWorldX = [];
  const gridWorldY = [];

  for (let r = 0; r < gridRows; r++) {
    const rowX = [0];
    for (let c = 1; c < gridCols; c++) {
      const avgMpp = (gridMpp[r][c - 1] + gridMpp[r][c]) / 2;
      rowX.push(rowX[c - 1] + cellW * avgMpp);
    }
    gridWorldX.push(rowX);
  }

  for (let r = 0; r < gridRows; r++) {
    const rowY = [];
    for (let c = 0; c < gridCols; c++) {
      if (r === 0) {
        rowY.push(0);
      } else {
        const avgMpp = (gridMpp[r - 1][c] + gridMpp[r][c]) / 2;
        rowY.push(gridWorldY[r - 1][c] + cellH * avgMpp);
      }
    }
    gridWorldY.push(rowY);
  }

  const transformation = {
    type: "spatial_metric_field_rbf",
    gridCols,
    gridRows,
    cellW,
    cellH,
    W,
    H,
    gridMpp,
    gridWorldX,
    gridWorldY,
    globalPpm,
    globalMpp,
  };

  return {
    enabled: true,
    mode: "advanced",
    ppm: globalPpm, // Global reference fallback
    metersPerPixel: globalMpp,
    unit: validRefs[0].unit || "meters",
    references: validRefs,
    transformation,
    imageDimensions,
    timestamp: Date.now(),
  };
}

/**
 * Query the local PPM (Pixels Per Meter) at a specific coordinate (x, y).
 */
export function getLocalPpm(calibration, x, y) {
  if (!calibration || !calibration.enabled) return null;
  if (calibration.mode === "standard" || !calibration.transformation) {
    return calibration.ppm || 25.0;
  }

  const { transformation } = calibration;
  const { gridCols, gridRows, cellW, cellH, gridMpp, globalPpm } = transformation;

  if (!gridMpp || !cellW || !cellH) return calibration.ppm || globalPpm || 25.0;

  const colF = Math.max(0, Math.min(gridCols - 1.001, x / cellW));
  const rowF = Math.max(0, Math.min(gridRows - 1.001, y / cellH));

  const c0 = Math.floor(colF);
  const c1 = Math.min(gridCols - 1, c0 + 1);
  const r0 = Math.floor(rowF);
  const r1 = Math.min(gridRows - 1, r0 + 1);

  const tx = colF - c0;
  const ty = rowF - r0;

  // Bilinear interpolation of local Meters Per Pixel
  const mppTop = (1 - tx) * gridMpp[r0][c0] + tx * gridMpp[r0][c1];
  const mppBottom = (1 - tx) * gridMpp[r1][c0] + tx * gridMpp[r1][c1];
  const localMpp = (1 - ty) * mppTop + ty * mppBottom;

  if (localMpp <= 0.00001) return globalPpm || 25.0;
  return 1 / localMpp;
}

/**
 * Forward Transformation: Layout Image Coordinates (x, y) -> World Metric Coordinates (X_meters, Y_meters).
 */
export function layoutToWorld(calibration, x, y) {
  if (!calibration || !calibration.enabled) {
    // If not calibrated, return pixel coordinates as fallback
    return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), isCalibrated: false };
  }

  if (calibration.mode === "standard" || !calibration.transformation) {
    const ppm = calibration.ppm || 25.0;
    return {
      x: Number((x / ppm).toFixed(2)),
      y: Number((y / ppm).toFixed(2)),
      isCalibrated: true,
    };
  }

  const { transformation } = calibration;
  const { gridCols, gridRows, cellW, cellH, gridWorldX, gridWorldY, globalPpm } = transformation;

  if (!gridWorldX || !gridWorldY || !cellW || !cellH) {
    const ppm = calibration.ppm || globalPpm || 25.0;
    return {
      x: Number((x / ppm).toFixed(2)),
      y: Number((y / ppm).toFixed(2)),
      isCalibrated: true,
    };
  }

  const colF = Math.max(0, Math.min(gridCols - 1.001, x / cellW));
  const rowF = Math.max(0, Math.min(gridRows - 1.001, y / cellH));

  const c0 = Math.floor(colF);
  const c1 = Math.min(gridCols - 1, c0 + 1);
  const r0 = Math.floor(rowF);
  const r1 = Math.min(gridRows - 1, r0 + 1);

  const tx = colF - c0;
  const ty = rowF - r0;

  // Bilinear interpolation for World X
  const wxTop = (1 - tx) * gridWorldX[r0][c0] + tx * gridWorldX[r0][c1];
  const wxBottom = (1 - tx) * gridWorldX[r1][c0] + tx * gridWorldX[r1][c1];
  const worldX = (1 - ty) * wxTop + ty * wxBottom;

  // Bilinear interpolation for World Y
  const wyTop = (1 - tx) * gridWorldY[r0][c0] + tx * gridWorldY[r0][c1];
  const wyBottom = (1 - tx) * gridWorldY[r1][c0] + tx * gridWorldY[r1][c1];
  const worldY = (1 - ty) * wyTop + ty * wyBottom;

  return {
    x: Number(worldX.toFixed(2)),
    y: Number(worldY.toFixed(2)),
    isCalibrated: true,
  };
}

/**
 * Inverse Transformation: World Metric Coordinates (X_meters, Y_meters) -> Layout Image Coordinates (x, y).
 */
export function worldToLayout(calibration, worldX, worldY) {
  if (!calibration || !calibration.enabled) {
    return { x: worldX, y: worldY };
  }

  if (calibration.mode === "standard" || !calibration.transformation) {
    const ppm = calibration.ppm || 25.0;
    return {
      x: worldX * ppm,
      y: worldY * ppm,
    };
  }

  const { transformation } = calibration;
  const { gridCols, gridRows, cellW, cellH, gridWorldX, gridWorldY, globalPpm } = transformation;

  if (!gridWorldX || !gridWorldY) {
    const ppm = calibration.ppm || globalPpm || 25.0;
    return { x: worldX * ppm, y: worldY * ppm };
  }

  // Find column bracket using monotonic search on first row
  let c = 0;
  while (c < gridCols - 1 && gridWorldX[0][c + 1] < worldX) {
    c++;
  }
  const wx0 = gridWorldX[0][c];
  const wx1 = gridWorldX[0][Math.min(gridCols - 1, c + 1)];
  const tx = wx1 > wx0 ? Math.max(0, Math.min(1, (worldX - wx0) / (wx1 - wx0))) : 0;
  const posX = (c + tx) * cellW;

  // Find row bracket using monotonic search on first column
  let r = 0;
  while (r < gridRows - 1 && gridWorldY[r + 1][0] < worldY) {
    r++;
  }
  const wy0 = gridWorldY[r][0];
  const wy1 = gridWorldY[Math.min(gridRows - 1, r + 1)][0];
  const ty = wy1 > wy0 ? Math.max(0, Math.min(1, (worldY - wy0) / (wy1 - wy0))) : 0;
  const posY = (r + ty) * cellH;

  return { x: posX, y: posY };
}

/**
 * Compute the calibrated physical distance in meters between two layout coordinates p1 (x1, y1) and p2 (x2, y2).
 * Integrates across the spatial transformation field if in advanced mode.
 */
export function calculatePhysicalDistance(calibration, p1, p2) {
  if (!p1 || !p2) return 0;
  const dPx = getPixelDistance(p1, p2);
  if (dPx === 0) return 0;

  if (!calibration || !calibration.enabled) {
    // Uncalibrated default fallback (e.g. 25 px = 1m)
    return dPx / 25.0;
  }

  if (calibration.mode === "standard" || !calibration.transformation) {
    const ppm = calibration.ppm || 25.0;
    return dPx / ppm;
  }

  // In advanced mode, integrate local metric along line segments
  const steps = Math.max(4, Math.min(32, Math.round(dPx / 20)));
  let totalDistMeters = 0;
  for (let i = 0; i < steps; i++) {
    const t1 = i / steps;
    const t2 = (i + 1) / steps;
    const midT = (t1 + t2) / 2;
    const mx = p1.x + (p2.x - p1.x) * midT;
    const my = p1.y + (p2.y - p1.y) * midT;
    const segLenPx = dPx / steps;
    const localPpm = getLocalPpm(calibration, mx, my);
    totalDistMeters += segLenPx / (localPpm || calibration.ppm || 25.0);
  }

  return totalDistMeters;
}

/**
 * Assess calibration quality & spatial distribution of references across the floor plan.
 * Returns quality level ('excellent', 'good', 'fair', 'insufficient') and actionable feedback messages.
 */
export function validateCalibrationReferences(references, imageDimensions = { width: 1000, height: 1000 }) {
  if (!references || references.length === 0) {
    return {
      status: "empty",
      quality: "none",
      isValid: false,
      message: "Draw a line over a known distance to calibrate.",
    };
  }

  const valid = references.filter(r => {
    const dPx = getPixelDistance(r.start, r.end);
    const dM = toMeters(r.realDistance, r.unit || "meters");
    return dPx >= 2 && dM > 0 && !isNaN(dM);
  });

  if (valid.length === 0) {
    return {
      status: "invalid",
      quality: "none",
      isValid: false,
      message: "Please enter valid reference distance measurements.",
    };
  }

  if (valid.length === 1) {
    return {
      status: "standard",
      quality: "good",
      isValid: true,
      count: 1,
      distribution: "single",
      message: "Uniform scale ready to apply.",
      helper: "Add additional references in different areas if your layout has scale distortion.",
    };
  }

  // Multi-reference spatial distribution analysis
  const W = imageDimensions.width || 1000;
  const H = imageDimensions.height || 1000;

  // Check quadrant coverage (Top-Left, Top-Right, Bottom-Left, Bottom-Right)
  const quadrants = new Set();
  const midpoints = [];

  valid.forEach(r => {
    const mx = (r.start.x + r.end.x) / 2;
    const my = (r.start.y + r.end.y) / 2;
    midpoints.push({ x: mx, y: my });
    const qX = mx < W / 2 ? "L" : "R";
    const qY = my < H / 2 ? "T" : "B";
    quadrants.add(`${qY}${qX}`);
  });

  // Calculate bounding box span of references
  const minX = Math.min(...midpoints.map(p => p.x));
  const maxX = Math.max(...midpoints.map(p => p.x));
  const minY = Math.min(...midpoints.map(p => p.y));
  const maxY = Math.max(...midpoints.map(p => p.y));

  const spanX = (maxX - minX) / W;
  const spanY = (maxY - minY) / H;
  const coverageArea = spanX * spanY;

  let quality = "good";
  let distribution = "good";
  let helper = "References provide good spatial distribution.";

  if (valid.length >= 3 && quadrants.size >= 3 && coverageArea > 0.15) {
    quality = "excellent";
    distribution = "excellent";
    helper = "Excellent reference distribution across the floor plan.";
  } else if (valid.length >= 2 && (quadrants.size >= 2 || coverageArea > 0.10)) {
    quality = "good";
    distribution = "good";
    helper = "Good spatial distribution.";
  } else {
    quality = "fair";
    distribution = "clustered";
    helper = "For better accuracy, place reference measurements in different areas of the layout.";
  }

  return {
    status: "advanced",
    quality,
    distribution,
    isValid: true,
    count: valid.length,
    coveredQuadrants: quadrants.size,
    message: `${valid.length} references ready for spatial transformation.`,
    helper,
  };
}

/**
 * Generate a metric preview grid (e.g., 5m or 10m grid lines) across the layout.
 * Grid lines deform according to the calibrated spatial transformation.
 */
export function generatePreviewGrid(calibration, imageDimensions = { width: 1000, height: 1000 }, intervalMeters = 5) {
  if (!calibration || !calibration.enabled) return null;

  const W = imageDimensions.width || 1000;
  const H = imageDimensions.height || 1000;

  // Determine metric bounds
  const topLeftWorld = layoutToWorld(calibration, 0, 0);
  const bottomRightWorld = layoutToWorld(calibration, W, H);

  const maxWorldX = Math.max(bottomRightWorld.x, 10);
  const maxWorldY = Math.max(bottomRightWorld.y, 10);

  const gridLines = [];
  const labels = [];

  // Vertical grid lines (constant X in meters)
  for (let wx = intervalMeters; wx < maxWorldX; wx += intervalMeters) {
    const points = [];
    const steps = 16;
    for (let s = 0; s <= steps; s++) {
      const wy = (s / steps) * maxWorldY;
      const layoutPt = worldToLayout(calibration, wx, wy);
      points.push(layoutPt);
    }
    gridLines.push({ type: "v", worldValue: wx, points });
    if (points.length > 0) {
      labels.push({ x: points[0].x, y: Math.max(16, points[0].y + 14), text: `${wx} m` });
    }
  }

  // Horizontal grid lines (constant Y in meters)
  for (let wy = intervalMeters; wy < maxWorldY; wy += intervalMeters) {
    const points = [];
    const steps = 16;
    for (let s = 0; s <= steps; s++) {
      const wx = (s / steps) * maxWorldX;
      const layoutPt = worldToLayout(calibration, wx, wy);
      points.push(layoutPt);
    }
    gridLines.push({ type: "h", worldValue: wy, points });
    if (points.length > 0) {
      labels.push({ x: Math.max(20, points[0].x + 20), y: points[0].y, text: `${wy} m` });
    }
  }

  return { gridLines, labels, intervalMeters };
}
