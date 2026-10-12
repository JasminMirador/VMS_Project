/**
 * LayoutBoundaryUtils.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified 2D Boundary Polygon Extraction, Gap Bridging, Collinear Edge Merging,
 * and Inward/Outward Normal Calculator for Floor Plans and CAD Layouts.
 * 
 * Shared between AutoPlacementEngine and Wall Dimensions layer rendering.
 */

// Global cache for layout boundaries keyed by geometry signature
const layoutBoundaryCache = new Map();

function computeLayoutSignature(walls, zones, ppm) {
  const wLen = Array.isArray(walls) ? walls.length : 0;
  const zLen = Array.isArray(zones) ? zones.length : 0;
  let p1x = 0, p1y = 0, p2x = 0, p2y = 0;
  if (wLen > 0) {
    const first = walls[0];
    const last = walls[wLen - 1];
    p1x = first[0]?.x ?? first[0]?.[0] ?? 0;
    p1y = first[0]?.y ?? first[0]?.[1] ?? 0;
    p2x = last[1]?.x ?? last[1]?.[0] ?? 0;
    p2y = last[1]?.y ?? last[1]?.[1] ?? 0;
  }
  return `${wLen}_${zLen}_${ppm}_${p1x.toFixed(1)}_${p1y.toFixed(1)}_${p2x.toFixed(1)}_${p2y.toFixed(1)}`;
}

/**
 * 2D Monotone chain convex hull algorithm
 */
export function computeConvexHull(points) {
  if (!points || points.length < 3) return points ? points.slice() : [];
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * Compute signed area of 2D polygon (positive = CW in canvas coords where Y is down)
 */
export function signedPolygonArea(poly) {
  if (!poly || poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const xi = poly[i].x ?? poly[i][0];
    const yi = poly[i].y ?? poly[i][1];
    const xj = poly[j].x ?? poly[j][0];
    const yj = poly[j].y ?? poly[j][1];
    area += xi * yj - xj * yi;
  }
  return area / 2;
}

/**
 * Ensure polygon vertices are ordered Counter-Clockwise (CCW)
 */
export function ensurePolygonCCW(poly) {
  if (!poly || poly.length < 3) return poly ? poly.slice() : [];
  if (signedPolygonArea(poly) > 0) {
    return poly.slice().reverse();
  }
  return poly.slice();
}

/**
 * Ensure polygon vertices are ordered Clockwise (CW)
 */
export function ensurePolygonCW(poly) {
  if (!poly || poly.length < 3) return poly ? poly.slice() : [];
  if (signedPolygonArea(poly) < 0) {
    return poly.slice().reverse();
  }
  return poly.slice();
}

/**
 * Create an inset version of polygon offset inward by marginPx
 */
export function insetPolygon(polygon, marginPx = 7.5) {
  if (!polygon || polygon.length < 3) return polygon ? polygon.slice() : [];
  const poly = ensurePolygonCW(polygon);
  const n = poly.length;
  const lines = [];

  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const p1x = p1.x ?? p1[0];
    const p1y = p1.y ?? p1[1];
    const p2x = p2.x ?? p2[0];
    const p2y = p2.y ?? p2[1];
    const dx = p2x - p1x;
    const dy = p2y - p1y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // Inward normal for CW polygon in canvas coordinates (Y down)
    const nx = -dy / len;
    const ny = dx / len;
    lines.push({
      p: { x: p1x + nx * marginPx, y: p1y + ny * marginPx },
      d: { x: dx / len, y: dy / len }
    });
  }

  if (lines.length < 3) return poly.slice();

  const result = [];
  const m = lines.length;
  for (let i = 0; i < m; i++) {
    const l1 = lines[i];
    const l2 = lines[(i + 1) % m];
    const cross = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    if (Math.abs(cross) < 1e-4) {
      result.push({ x: l1.p.x, y: l1.p.y });
    } else {
      const dx = l2.p.x - l1.p.x;
      const dy = l2.p.y - l1.p.y;
      const t = (dx * l2.d.y - dy * l2.d.x) / cross;
      result.push({ x: l1.p.x + t * l1.d.x, y: l1.p.y + t * l1.d.y });
    }
  }
  return result;
}

/**
 * 2D Ray-casting Point-in-polygon test
 */
export function isInsideBoundary(pt, polygon) {
  if (!pt || !polygon || polygon.length < 3) return false;
  const px = pt.x ?? pt[0];
  const py = pt.y ?? pt[1];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x ?? polygon[i][0];
    const yi = polygon[i].y ?? polygon[i][1];
    const xj = polygon[j].x ?? polygon[j][0];
    const yj = polygon[j].y ?? polygon[j][1];
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Snap a point to the nearest point on polygon boundary
 */
export function snapToPolygonBoundary(pt, polygon, centroid = null, nudgeDist = 2) {
  if (!pt) return { x: 0, y: 0 };
  if (!polygon || polygon.length < 3) return { x: pt.x, y: pt.y };
  let minSqDist = Infinity;
  let bestX = pt.x;
  let bestY = pt.y;

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    const p1x = p1.x ?? p1[0];
    const p1y = p1.y ?? p1[1];
    const p2x = p2.x ?? p2[0];
    const p2y = p2.y ?? p2[1];
    const dx = p2x - p1x;
    const dy = p2y - p1y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) continue;

    let t = ((pt.x - p1x) * dx + (pt.y - p1y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = p1x + t * dx;
    const projY = p1y + t * dy;
    const sqDist = (pt.x - projX) ** 2 + (pt.y - projY) ** 2;

    if (sqDist < minSqDist) {
      minSqDist = sqDist;
      bestX = projX;
      bestY = projY;
    }
  }

  if (centroid && nudgeDist > 0) {
    const toCx = centroid.x - bestX;
    const toCy = centroid.y - bestY;
    const distToC = Math.hypot(toCx, toCy);
    if (distToC > 1e-3) {
      const shift = Math.min(nudgeDist, distToC * 0.1);
      bestX += (toCx / distToC) * shift;
      bestY += (toCy / distToC) * shift;
    }
  }

  return { x: bestX, y: bestY };
}

/**
 * Simplify consecutive collinear vertices of a polygon loop
 */
export function simplifyCollinearPolygon(poly, minLengthPx = 4.0) {
  if (!poly || poly.length < 3) return poly ? poly.slice() : [];
  
  // 1. Remove duplicate adjacent vertices
  const clean = [];
  for (let i = 0; i < poly.length; i++) {
    const pt = { x: poly[i].x ?? poly[i][0], y: poly[i].y ?? poly[i][1] };
    if (clean.length === 0) {
      clean.push(pt);
    } else {
      const last = clean[clean.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) >= 0.5) {
        clean.push(pt);
      }
    }
  }
  if (clean.length > 2 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) < 0.5) {
    clean.pop();
  }
  if (clean.length < 3) return clean;

  // 2. Filter out collinear midpoint vertices
  const result = [];
  const n = clean.length;
  for (let i = 0; i < n; i++) {
    const pPrev = clean[(i - 1 + n) % n];
    const pCurr = clean[i];
    const pNext = clean[(i + 1) % n];

    const dx1 = pCurr.x - pPrev.x;
    const dy1 = pCurr.y - pPrev.y;
    const dx2 = pNext.x - pCurr.x;
    const dy2 = pNext.y - pCurr.y;

    const cross = dx1 * dy2 - dy1 * dx2;
    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);

    // If cross product is close to zero, the three points are collinear
    const isCollinear = len1 > 0 && len2 > 0 && (Math.abs(cross) / (len1 * len2)) < 0.04;
    if (!isCollinear) {
      result.push(pCurr);
    }
  }

  // 3. Drop zero-length / tiny jog edges
  const finalPoly = [];
  const m = result.length;
  for (let i = 0; i < m; i++) {
    const pCurr = result[i];
    const pNext = result[(i + 1) % m];
    if (Math.hypot(pNext.x - pCurr.x, pNext.y - pCurr.y) >= minLengthPx) {
      finalPoly.push(pCurr);
    }
  }

  return finalPoly.length >= 3 ? finalPoly : result;
}

/**
 * Primary utility: Detect outer building boundary as an ordered closed CCW polygon
 * Shared between AutoPlacementEngine and Wall Dimensions rendering layer.
 */
export function getLayoutBoundary(walls = [], zones = [], floorDraft = null, ppm = 25.0, opts = {}) {
  const cacheKey = computeLayoutSignature(walls, zones, ppm);
  if (layoutBoundaryCache.has(cacheKey) && !opts.bypassCache) {
    return layoutBoundaryCache.get(cacheKey);
  }

  const allPts = [];
  const wallSegs = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  const rawWalls = Array.isArray(walls) && walls.length > 0
    ? walls
    : (floorDraft?.walls || []);

  if (Array.isArray(rawWalls) && rawWalls.length > 0) {
    for (const w of rawWalls) {
      if (!w || w.length < 2) continue;
      const p1 = Array.isArray(w[0]) ? { x: Number(w[0][0]), y: Number(w[0][1]) } : { x: Number(w[0].x), y: Number(w[0].y) };
      const p2 = Array.isArray(w[1]) ? { x: Number(w[1][0]), y: Number(w[1][1]) } : { x: Number(w[1].x), y: Number(w[1].y) };
      if (!isNaN(p1.x) && !isNaN(p1.y) && !isNaN(p2.x) && !isNaN(p2.y)) {
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (len >= 1.5) {
          allPts.push(p1, p2);
          wallSegs.push([p1, p2]);
          minX = Math.min(minX, p1.x, p2.x);
          maxX = Math.max(maxX, p1.x, p2.x);
          minY = Math.min(minY, p1.y, p2.y);
          maxY = Math.max(maxY, p1.y, p2.y);
        }
      }
    }
  }

  let rawPolygon = [];
  let isValid = true;
  let isFallback = false;

  if (allPts.length >= 3) {
    // Grid Flood-Fill Shrink-Wrap for concave / notched / cross shapes
    const padding = Math.max(30, 1.2 * ppm);
    const rx1 = minX - padding;
    const rx2 = maxX + padding;
    const ry1 = minY - padding;
    const ry2 = maxY + padding;

    // Cell resolution: ~0.45 meters (11 px)
    const cellSize = Math.max(8, 0.45 * (ppm || 25.0));
    const cols = Math.ceil((rx2 - rx1) / cellSize);
    const rows = Math.ceil((ry2 - ry1) / cellSize);

    if (cols > 5 && rows > 5 && cols < 350 && rows < 350) {
      const grid = new Uint8Array(cols * rows); // 0 = empty, 1 = wall, 2 = exterior

      // Rasterize wall segments into grid
      for (const [p1, p2] of wallSegs) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(len / (cellSize * 0.4)));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const gx = Math.floor((p1.x + t * dx - rx1) / cellSize);
          const gy = Math.floor((p1.y + t * dy - ry1) / cellSize);
          if (gx >= 0 && gx < cols && gy >= 0 && gy < rows) {
            grid[gy * cols + gx] = 1;
          }
        }
      }

      // Exterior flood fill from corner (0, 0)
      const queue = [0];
      grid[0] = 2;
      let head = 0;

      while (head < queue.length) {
        const idx = queue[head++];
        const r = Math.floor(idx / cols);
        const c = idx % cols;

        const neighbors = [
          r > 0 ? (r - 1) * cols + c : -1,
          r < rows - 1 ? (r + 1) * cols + c : -1,
          c > 0 ? r * cols + (c - 1) : -1,
          c < cols - 1 ? r * cols + (c + 1) : -1
        ];

        for (const nIdx of neighbors) {
          if (nIdx >= 0 && grid[nIdx] === 0) {
            grid[nIdx] = 2;
            queue.push(nIdx);
          }
        }
      }

      // Extract directed boundary grid edges separating exterior (2) from interior (1/0)
      const edgeMap = new Map(); // key "x,y" -> target "x,y"
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid[r * cols + c] === 2) {
            // Check adjacent non-exterior cells
            if (r + 1 < rows && grid[(r + 1) * cols + c] !== 2) {
              const x1 = rx1 + c * cellSize, x2 = rx1 + (c + 1) * cellSize, y = ry1 + (r + 1) * cellSize;
              edgeMap.set(`${x2.toFixed(1)},${y.toFixed(1)}`, { x: x1, y: y });
            }
            if (r - 1 >= 0 && grid[(r - 1) * cols + c] !== 2) {
              const x1 = rx1 + c * cellSize, x2 = rx1 + (c + 1) * cellSize, y = ry1 + r * cellSize;
              edgeMap.set(`${x1.toFixed(1)},${y.toFixed(1)}`, { x: x2, y: y });
            }
            if (c + 1 < cols && grid[r * cols + (c + 1)] !== 2) {
              const y1 = ry1 + r * cellSize, y2 = ry1 + (r + 1) * cellSize, x = rx1 + (c + 1) * cellSize;
              edgeMap.set(`${x.toFixed(1)},${y1.toFixed(1)}`, { x: x, y: y2 });
            }
            if (c - 1 >= 0 && grid[r * cols + (c - 1)] !== 2) {
              const y1 = ry1 + r * cellSize, y2 = ry1 + (r + 1) * cellSize, x = rx1 + c * cellSize;
              edgeMap.set(`${x.toFixed(1)},${y2.toFixed(1)}`, { x: x, y: y1 });
            }
          }
        }
      }

      if (edgeMap.size > 0) {
        const startKey = edgeMap.keys().next().value;
        const [sx, sy] = startKey.split(",").map(Number);
        const startPt = { x: sx, y: sy };
        let curr = startPt;
        const tracePoly = [curr];
        const visited = new Set();

        for (let step = 0; step < 1000; step++) {
          const key = `${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
          visited.add(key);
          const nextPt = edgeMap.get(key);
          if (!nextPt) break;
          const nextKey = `${nextPt.x.toFixed(1)},${nextPt.y.toFixed(1)}`;
          if (nextKey === startKey || visited.has(nextKey)) {
            break;
          }
          tracePoly.push(nextPt);
          curr = nextPt;
        }

        if (tracePoly.length >= 4) {
          rawPolygon = tracePoly;
        }
      }
    }

    // Fallback to convex hull if grid contour failed
    if (rawPolygon.length < 3) {
      rawPolygon = computeConvexHull(allPts);
      isFallback = true;
    }
  }

  // Fallback rectangular bounds if no walls/points
  if (rawPolygon.length < 3) {
    const rx1 = isFinite(minX) ? minX : 0;
    const rx2 = isFinite(maxX) ? maxX : 1200;
    const ry1 = isFinite(minY) ? minY : 0;
    const ry2 = isFinite(maxY) ? maxY : 800;
    rawPolygon = [
      { x: rx1, y: ry1 },
      { x: rx2, y: ry1 },
      { x: rx2, y: ry2 },
      { x: rx1, y: ry2 }
    ];
    isValid = false;
    isFallback = true;
  }

  // Simplify collinear edges and drop tiny jogs
  const minEdgePx = Math.max(4, 0.15 * (ppm || 25.0));
  const simplifiedPolygon = simplifyCollinearPolygon(rawPolygon, minEdgePx);

  // Ensure polygon is oriented Counter-Clockwise (CCW)
  const ccwPolygon = ensurePolygonCCW(simplifiedPolygon);
  const centroid = polygonCentroid(ccwPolygon);

  // Build edge structure for EVERY side of the outermost boundary polygon
  const edges = [];
  let totalPerimeterPx = 0;
  const n = ccwPolygon.length;

  for (let i = 0; i < n; i++) {
    const p1 = ccwPolygon[i];
    const p2 = ccwPolygon[(i + 1) % n];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthPx = Math.hypot(dx, dy);
    if (lengthPx < 1e-4) continue;

    totalPerimeterPx += lengthPx;
    const lengthM = lengthPx / (ppm || 25.0);

    // Outward unit normal for CCW polygon in canvas coords (Y down)
    // CCW polygon in Y-down coords has signedArea < 0
    // Vector (dx, dy) has left perpendicular (dy/len, -dx/len) pointing outward
    const outNx = dy / lengthPx;
    const outNy = -dx / lengthPx;

    let angle = Math.atan2(dy, dx);
    let textAngle = angle;
    if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
      textAngle += Math.PI;
    }

    edges.push({
      index: i + 1,
      p1,
      p2,
      mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      lengthPx,
      lengthM,
      normal: { x: outNx, y: outNy },
      angle,
      textAngle
    });
  }

  const totalPerimeterM = totalPerimeterPx / (ppm || 25.0);
  const overallWidthM = (maxX - minX) / (ppm || 25.0);
  const overallHeightM = (maxY - minY) / (ppm || 25.0);

  const entry = {
    polygon: ccwPolygon,
    edges,
    totalPerimeterM: Math.round(totalPerimeterM * 100) / 100,
    overallWidthM: isFinite(overallWidthM) ? Math.round(overallWidthM * 100) / 100 : 0,
    overallHeightM: isFinite(overallHeightM) ? Math.round(overallHeightM * 100) / 100 : 0,
    centroid,
    isValid,
    isFallback,
    bounds: { minX, maxX, minY, maxY }
  };

  layoutBoundaryCache.set(cacheKey, entry);
  return entry;
}

/**
 * Helper to calculate polygon centroid
 */
export function polygonCentroid(polygon) {
  if (!polygon || polygon.length < 3) return { x: 0, y: 0 };
  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const xi = polygon[i].x ?? polygon[i][0];
    const yi = polygon[i].y ?? polygon[i][1];
    const xj = polygon[j].x ?? polygon[j][0];
    const yj = polygon[j].y ?? polygon[j][1];
    const cross = xi * yj - xj * yi;
    area += cross;
    cx += (xi + xj) * cross;
    cy += (yi + yj) * cross;
  }
  area = area / 2;
  if (Math.abs(area) < 1e-5) {
    let sx = 0, sy = 0;
    for (const p of polygon) {
      sx += (p.x ?? p[0]);
      sy += (p.y ?? p[1]);
    }
    return { x: sx / polygon.length, y: sy / polygon.length };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}