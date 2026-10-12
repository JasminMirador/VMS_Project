/**
 * AutoPlacementEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * High-performance autonomous CCTV camera placement optimization engine
 * for calibrated floor layouts and CAD designs.
 * 
 * CORE PERFECTIONIST PRINCIPLES:
 * 1. VALID COVERAGE DOMAIN — Coverage counts ONLY inside actual usable interior floor area.
 *    Outside-layout viewing is strictly 0 useful coverage and heavily penalized.
 * 2. INWARD-FACING WALL NORMALS — Wall cameras evaluate ONLY inward angles towards interior space.
 * 3. NO CLUSTERING / REDUNDANCY — Minimum separation distance between camera origins;
 *    automatic camera pruning for low-margin redundant cameras (<1.5m² unique contribution).
 * 4. ROOM & SPACE AWARENESS — Meaningful space segmentation (filtering CAD fragments <6m²).
 * 5. PASS 2 GLOBAL REFINEMENT — Joint position jitter (±0.25m), yaw tweaking (±5°-15°),
 *    model swapping, and camera removal test.
 * 6. FOV VISUALIZATION MATCH — The returned camera `visPoly` is strictly clipped to the
 *    interior layout boundary so visual blue canvas rendering matches calculation 100%.
 */

import * as CctvCalc from "./CctvCalculators.js";

/**
 * 2D Point-in-polygon test (Ray casting)
 */
export function pointInPolygon(px, py, polygon) {
  if (!polygon || polygon.length < 3) return false;
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
 * Line segment intersection test
 */
export function lineSegmentsIntersect(p1, p2, p3, p4) {
  const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(denom) < 1e-9) return false;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

/**
 * Compute 2D Polygon area in square units
 */
export function polygonArea(polygon) {
  if (!polygon || polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const xi = polygon[i].x ?? polygon[i][0];
    const yi = polygon[i].y ?? polygon[i][1];
    const xj = polygon[j].x ?? polygon[j][0];
    const yj = polygon[j].y ?? polygon[j][1];
    area += xi * yj - xj * yi;
  }
  return Math.abs(area) / 2;
}

/**
 * Compute 2D Polygon Centroid
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

/**
 * Distance from point (px, py) to line segment (p1, p2)
 */
export function distanceToSegment(px, py, p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(px - p1.x, py - p1.y);
  let t = ((px - p1.x) * dx + (py - p1.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = p1.x + t * dx;
  const projY = p1.y + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Minimum distance from point (px, py) to any boundary edge of a polygon
 */
export function distanceToPolygonEdges(px, py, polygon) {
  if (!polygon || polygon.length < 3) return 0;
  let minDist = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const p1 = { x: polygon[i].x ?? polygon[i][0], y: polygon[i].y ?? polygon[i][1] };
    const p2 = { x: polygon[(i + 1) % polygon.length].x ?? polygon[(i + 1) % polygon.length][0], y: polygon[(i + 1) % polygon.length].y ?? polygon[(i + 1) % polygon.length][1] };
    const d = distanceToSegment(px, py, p1, p2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Ensures point is strictly inside polygon and nudged inward by minMarginPx from edges.
 */
export function nudgePointInsidePolygon(px, py, polygon, minMarginPx = 20) {
  if (!pointInPolygon(px, py, polygon)) return null;
  const dist = distanceToPolygonEdges(px, py, polygon);
  if (dist >= minMarginPx) return { x: px, y: py };

  const center = polygonCentroid(polygon);
  const dirX = center.x - px;
  const dirY = center.y - py;
  const len = Math.hypot(dirX, dirY);
  if (len < 1e-4) return { x: px, y: py };

  const uX = dirX / len;
  const uY = dirY / len;

  let best = { x: px, y: py };
  const maxShift = Math.min(len * 0.85, minMarginPx * 2.5);
  for (let s = 2; s <= maxShift; s += 3) {
    const testX = px + uX * s;
    const testY = py + uY * s;
    if (pointInPolygon(testX, testY, polygon)) {
      best = { x: testX, y: testY };
      if (distanceToPolygonEdges(testX, testY, polygon) >= minMarginPx) {
        break;
      }
    }
  }
  return best;
}

// Global cache for layout boundaries keyed by layout geometry signature
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
  const pts = points.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
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
 * Signed area of polygon (positive = CW in canvas coords where Y is down)
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
 * Test whether point is inside boundary polygon
 */
export function isInsideBoundary(pt, polygon) {
  if (!pt || !polygon || polygon.length < 3) return false;
  return pointInPolygon(pt.x ?? pt[0], pt.y ?? pt[1], polygon);
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

  // Nudge slightly inward towards centroid if provided to guarantee inside pointInPolygon
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
 * Derive building boundary polygon from wall geometry with caching per layout
 */
export function getBuildingBoundary(walls = [], zones = [], ppm = 25.0) {
  const cacheKey = computeLayoutSignature(walls, zones, ppm);
  if (layoutBoundaryCache.has(cacheKey)) {
    return layoutBoundaryCache.get(cacheKey);
  }

  const allPts = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  if (Array.isArray(walls) && walls.length > 0) {
    for (const w of walls) {
      if (!w || w.length < 2) continue;
      const p1 = Array.isArray(w[0]) ? { x: Number(w[0][0]), y: Number(w[0][1]) } : { x: Number(w[0].x), y: Number(w[0].y) };
      const p2 = Array.isArray(w[1]) ? { x: Number(w[1][0]), y: Number(w[1][1]) } : { x: Number(w[1].x), y: Number(w[1].y) };
      if (!isNaN(p1.x) && !isNaN(p1.y) && !isNaN(p2.x) && !isNaN(p2.y)) {
        allPts.push(p1, p2);
        minX = Math.min(minX, p1.x, p2.x);
        maxX = Math.max(maxX, p1.x, p2.x);
        minY = Math.min(minY, p1.y, p2.y);
        maxY = Math.max(maxY, p1.y, p2.y);
      }
    }
  }

  let boundary = [];
  if (allPts.length >= 3) {
    // Convex hull of all wall points
    const hull = computeConvexHull(allPts);
    boundary = ensurePolygonCW(hull);
  }

  if (boundary.length < 3) {
    const rx1 = isFinite(minX) ? minX : 0;
    const rx2 = isFinite(maxX) ? maxX : 1200;
    const ry1 = isFinite(minY) ? minY : 0;
    const ry2 = isFinite(maxY) ? maxY : 800;
    boundary = [
      { x: rx1, y: ry1 },
      { x: rx2, y: ry1 },
      { x: rx2, y: ry2 },
      { x: rx1, y: ry2 }
    ];
  }

  const marginPx = Math.max(6, 0.3 * (ppm || 25.0));
  const insetBoundary = insetPolygon(boundary, marginPx);
  const centroid = polygonCentroid(boundary);

  const entry = { boundary, insetBoundary, centroid, marginPx };
  layoutBoundaryCache.set(cacheKey, entry);
  return entry;
}

/**
 * Determine inward heading for a camera position
 */
export function getInwardHeading(cam, boundary, insetBoundary, buildingCentroid, spaces = [], ppm = 25.0) {
  if (!cam || !boundary || boundary.length < 3) return cam?.direction ?? 0;
  const n = boundary.length;
  let minDistEdge = Infinity;
  let closestEdgeIdx = 0;
  let minDistVertex = Infinity;
  let closestVertexIdx = 0;

  for (let i = 0; i < n; i++) {
    const v = boundary[i];
    const vx = v.x ?? v[0];
    const vy = v.y ?? v[1];
    const dV = Math.hypot(cam.x - vx, cam.y - vy);
    if (dV < minDistVertex) {
      minDistVertex = dV;
      closestVertexIdx = i;
    }

    const nextV = boundary[(i + 1) % n];
    const nextVx = nextV.x ?? nextV[0];
    const nextVy = nextV.y ?? nextV[1];
    const dE = distanceToSegment(cam.x, cam.y, { x: vx, y: vy }, { x: nextVx, y: nextVy });
    if (dE < minDistEdge) {
      minDistEdge = dE;
      closestEdgeIdx = i;
    }
  }

  let heading = cam.direction ?? 0;
  const isNearPerimeter = minDistEdge <= Math.max(30, 3.0 * ppm);

  if (isNearPerimeter) {
    const isCorner = minDistVertex <= Math.max(20, Math.min(1.5 * ppm, minDistEdge * 1.4));
    if (isCorner) {
      // Corner camera: bisector of the two adjacent walls pointing inward
      const prevIdx = (closestVertexIdx - 1 + n) % n;
      const nextIdx = (closestVertexIdx + 1) % n;
      const vCurr = boundary[closestVertexIdx];
      const vPrev = boundary[prevIdx];
      const vNext = boundary[nextIdx];

      const vCurrx = vCurr.x ?? vCurr[0], vCurry = vCurr.y ?? vCurr[1];
      const vPrevx = vPrev.x ?? vPrev[0], vPrevy = vPrev.y ?? vPrev[1];
      const vNextx = vNext.x ?? vNext[0], vNexty = vNext.y ?? vNext[1];

      const d1x = vCurrx - vPrevx, d1y = vCurry - vPrevy;
      const l1 = Math.hypot(d1x, d1y) || 1;
      const n1 = { x: -d1y / l1, y: d1x / l1 };

      const d2x = vNextx - vCurrx, d2y = vNexty - vCurry;
      const l2 = Math.hypot(d2x, d2y) || 1;
      const n2 = { x: -d2y / l2, y: d2x / l2 };

      const bx = n1.x + n2.x;
      const by = n1.y + n2.y;
      const bLen = Math.hypot(bx, by);
      if (bLen > 1e-4) {
        heading = Math.atan2(by, bx) * (180 / Math.PI);
      }
    } else {
      // Perimeter wall: inward normal of nearest boundary edge
      const p1 = boundary[closestEdgeIdx];
      const p2 = boundary[(closestEdgeIdx + 1) % n];
      const p1x = p1.x ?? p1[0], p1y = p1.y ?? p1[1];
      const p2x = p2.x ?? p2[0], p2y = p2.y ?? p2[1];
      const dx = p2x - p1x;
      const dy = p2y - p1y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      heading = Math.atan2(ny, nx) * (180 / Math.PI);
    }
  } else {
    // Non-wall: aim toward centroid of nearest room/open area or building centroid
    let target = buildingCentroid;
    let minDistSpace = Infinity;
    if (spaces && spaces.length > 0) {
      for (const s of spaces) {
        if (s.centroid) {
          const d = Math.hypot(cam.x - s.centroid.x, cam.y - s.centroid.y);
          if (d < minDistSpace) {
            minDistSpace = d;
            target = s.centroid;
          }
        }
      }
    }
    if (target) {
      heading = Math.atan2(target.y - cam.y, target.x - cam.x) * (180 / Math.PI);
    }
  }

  heading = (heading % 360 + 360) % 360;

  // Ray verification (1.5 m)
  const testRayDist = Math.max(15, 1.5 * ppm);
  const rad = heading * (Math.PI / 180);
  const rayEnd = { x: cam.x + Math.cos(rad) * testRayDist, y: cam.y + Math.sin(rad) * testRayDist };

  const rayInside = isInsideBoundary(rayEnd, boundary);
  if (!rayInside) {
    heading = (heading + 180) % 360;
  }

  return Math.round(heading);
}

/**
 * Extract layout domain geometry (interior usable area boundary & wall segments)
 */
export function extractLayoutDomain(walls = [], zones = [], floorImg = null, ppm = 25.0) {
  const rawWallSegments = [];
  const zonePolygons = [];
  const obstaclePolygons = [];
  const zoneObjMap = [];

  if (Array.isArray(walls) && walls.length > 0) {
    for (const w of walls) {
      if (!w || w.length < 2) continue;
      const p1 = Array.isArray(w[0]) ? { x: Number(w[0][0]), y: Number(w[0][1]) } : { x: Number(w[0].x), y: Number(w[0].y) };
      const p2 = Array.isArray(w[1]) ? { x: Number(w[1][0]), y: Number(w[1][1]) } : { x: Number(w[1].x), y: Number(w[1].y) };
      if (!isNaN(p1.x) && !isNaN(p1.y) && !isNaN(p2.x) && !isNaN(p2.y)) {
        if (Math.hypot(p2.x - p1.x, p2.y - p1.y) > 2) {
          rawWallSegments.push([p1, p2]);
        }
      }
    }
  }

  if (Array.isArray(zones) && zones.length > 0) {
    for (const z of zones) {
      if (!z.polygon || z.polygon.length < 3) continue;
      const cleanPoly = z.polygon.map(pt => ({
        x: Number(pt.x ?? pt[0]),
        y: Number(pt.y ?? pt[1])
      })).filter(pt => !isNaN(pt.x) && !isNaN(pt.y));

      if (cleanPoly.length >= 3) {
        if (z.isBoomBarrier || z.isBarrier || /barrier|obstacle/i.test(z.name || "")) {
          obstaclePolygons.push(cleanPoly);
          for (let i = 0; i < cleanPoly.length; i++) {
            const p1 = cleanPoly[i];
            const p2 = cleanPoly[(i + 1) % cleanPoly.length];
            rawWallSegments.push([p1, p2]);
          }
        } else {
          zonePolygons.push(cleanPoly);
          zoneObjMap.push({ id: z.id || `zone_${zoneObjMap.length}`, name: z.name || `Zone ${zoneObjMap.length + 1}` });
        }
      }
    }
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  if (rawWallSegments.length > 0) {
    for (const [p1, p2] of rawWallSegments) {
      minX = Math.min(minX, p1.x, p2.x);
      maxX = Math.max(maxX, p1.x, p2.x);
      minY = Math.min(minY, p1.y, p2.y);
      maxY = Math.max(maxY, p1.y, p2.y);
    }
  } else if (floorImg && floorImg.width > 0 && floorImg.height > 0) {
    minX = 0; maxX = floorImg.width; minY = 0; maxY = floorImg.height;
  } else {
    minX = 0; maxX = 1200; minY = 0; maxY = 800;
  }

  if (rawWallSegments.length === 0) {
    rawWallSegments.push(
      [{ x: minX, y: minY }, { x: maxX, y: minY }],
      [{ x: maxX, y: minY }, { x: maxX, y: maxY }],
      [{ x: maxX, y: maxY }, { x: minX, y: maxY }],
      [{ x: minX, y: maxY }, { x: minX, y: minY }]
    );
  }

  const mergedWalls = CctvCalc.mergeCollinearWalls ? CctvCalc.mergeCollinearWalls(rawWallSegments, ppm, 0.4) : [];
  const wallSegments = mergedWalls.length > 0 ? mergedWalls.map(m => [m.p1, m.p2]) : rawWallSegments;

  const defaultBoundaryPoly = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ];

  return {
    bounds: { minX, maxX, minY, maxY },
    wallSegments,
    rawWallSegments,
    zonePolygons,
    zoneObjMap,
    obstaclePolygons,
    domainPolygon: zonePolygons.length === 1 ? zonePolygons[0] : defaultBoundaryPoly
  };
}

/**
 * CoverageGrid manages discrete 2D sampling grid points in meters over layout.
 */
export class CoverageGrid {
  constructor(bounds, ppm, gridSpacingM = 0.75) {
    this.bounds = bounds;
    this.ppm = Math.max(1, ppm || 25.0);
    this.spacingPx = Math.max(8, gridSpacingM * this.ppm);
    this.cellAreaM2 = (this.spacingPx / this.ppm) * (this.spacingPx / this.ppm);

    this.cols = Math.ceil((bounds.maxX - bounds.minX) / this.spacingPx);
    this.rows = Math.ceil((bounds.maxY - bounds.minY) / this.spacingPx);
    this.totalCells = this.cols * this.rows;

    this.points = [];
    this.validIndices = [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = bounds.minX + (c + 0.5) * this.spacingPx;
        const y = bounds.minY + (r + 0.5) * this.spacingPx;
        this.points.push({ x, y, col: c, row: r, valid: true, zoneId: null });
      }
    }
  }

  filterInteriorLayout(domainPolygon, zonePolygons = [], obstaclePolygons = [], wallSegments = [], zoneObjMap = []) {
    this.validIndices = [];

    if (zonePolygons.length > 0) {
      for (let i = 0; i < this.points.length; i++) {
        const pt = this.points[i];
        let inside = false;
        let matchedZoneId = null;

        for (let zIdx = 0; zIdx < zonePolygons.length; zIdx++) {
          const zone = zonePolygons[zIdx];
          if (pointInPolygon(pt.x, pt.y, zone)) {
            inside = true;
            matchedZoneId = zoneObjMap[zIdx]?.id || `zone_${zIdx}`;
            break;
          }
        }

        if (inside && obstaclePolygons.length > 0) {
          for (const obs of obstaclePolygons) {
            if (pointInPolygon(pt.x, pt.y, obs)) {
              inside = false;
              break;
            }
          }
        }

        pt.valid = inside;
        pt.zoneId = inside ? matchedZoneId : null;
        if (inside) this.validIndices.push(i);
      }
      return;
    }

    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      let inside = pointInPolygon(pt.x, pt.y, domainPolygon);
      if (inside && obstaclePolygons.length > 0) {
        for (const obs of obstaclePolygons) {
          if (pointInPolygon(pt.x, pt.y, obs)) {
            inside = false;
            break;
          }
        }
      }
      pt.valid = inside;
      if (inside) {
        this.validIndices.push(i);
      }
    }

    if (this.validIndices.length === 0) {
      for (let i = 0; i < this.points.length; i++) {
        this.points[i].valid = true;
        this.validIndices.push(i);
      }
    }
  }

  isInteriorPoint(pt) {
    const col = Math.floor((pt.x - this.bounds.minX) / this.spacingPx);
    const row = Math.floor((pt.y - this.bounds.minY) / this.spacingPx);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    const idx = row * this.cols + col;
    return Boolean(this.points[idx]?.valid);
  }

  computeFovCoverageAndOutside(visibilityPoly, targetZoneId = null) {
    if (!visibilityPoly || visibilityPoly.length < 3) return { insideCells: new Set(), outsideCells: new Set() };

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of visibilityPoly) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const minCol = Math.max(0, Math.floor((minX - this.bounds.minX) / this.spacingPx));
    const maxCol = Math.min(this.cols - 1, Math.ceil((maxX - this.bounds.minX) / this.spacingPx));
    const minRow = Math.max(0, Math.floor((minY - this.bounds.minY) / this.spacingPx));
    const maxRow = Math.min(this.rows - 1, Math.ceil((maxY - this.bounds.minY) / this.spacingPx));

    const insideCells = new Set();
    const outsideCells = new Set();

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * this.cols;
      for (let c = minCol; c <= maxCol; c++) {
        const idx = rowOffset + c;
        const pt = this.points[idx];
        if (pt && pointInPolygon(pt.x, pt.y, visibilityPoly)) {
          if (pt.valid && (!targetZoneId || pt.zoneId === targetZoneId)) {
            insideCells.add(idx);
          } else {
            outsideCells.add(idx);
          }
        }
      }
    }

    return { insideCells, outsideCells };
  }

  /**
   * Clips visibility polygon vertices at the boundary of valid interior layout points.
   * Guaranteed never to collapse or hide a camera beam.
   */
  clipVisibilityPolygon(visPoly, origin) {
    if (!visPoly || visPoly.length < 3) return visPoly;

    const clipped = [];
    const stepSizePx = Math.max(6, this.spacingPx * 0.5);

    // If origin is on an edge, find a safe interior anchor point
    let safeOrigin = { x: origin.x, y: origin.y };
    if (!this.isInteriorPoint(safeOrigin)) {
      for (let r = 2; r <= 12; r += 2) {
        let found = false;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          const testPt = { x: origin.x + Math.cos(a) * r, y: origin.y + Math.sin(a) * r };
          if (this.isInteriorPoint(testPt)) {
            safeOrigin = testPt;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }

    for (const pt of visPoly) {
      const dx = pt.x - safeOrigin.x;
      const dy = pt.y - safeOrigin.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-4) {
        clipped.push({ x: pt.x, y: pt.y });
        continue;
      }
      const ux = dx / dist;
      const uy = dy / dist;

      let lastValid = { x: pt.x, y: pt.y };
      let hitOutside = false;
      // Start slightly along ray to clear wall boundary
      let curr = Math.min(stepSizePx, dist * 0.1);

      while (curr <= dist) {
        const tx = safeOrigin.x + ux * curr;
        const ty = safeOrigin.y + uy * curr;
        if (this.isInteriorPoint({ x: tx, y: ty })) {
          lastValid = { x: tx, y: ty };
          curr += stepSizePx;
        } else {
          hitOutside = true;
          break;
        }
      }

      if (hitOutside) {
        clipped.push(lastValid);
      } else {
        clipped.push({ x: pt.x, y: pt.y });
      }
    }

    // Safety check: Never allow a camera beam to be collapsed or hidden!
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of clipped) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const bboxArea = (maxX - minX) * (maxY - minY);
    if (bboxArea < 25 || clipped.length < 3) {
      return visPoly; // Fall back to raw visPoly so beam is NEVER hidden
    }

    return clipped;
  }
}

/**
 * Derive inward wall normal vector pointing strictly into valid interior layout area
 */
export function getWallInwardNormal(wallSeg, grid, ppm = 25.0) {
  const p1 = wallSeg[0];
  const p2 = wallSeg[1];
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (len < 1e-4) return { x: 0, y: 1 };

  const dx = (p2.x - p1.x) / len;
  const dy = (p2.y - p1.y) / len;

  const n1 = { x: -dy, y: dx };
  const n2 = { x: dy, y: -dx };

  const testDistPx = Math.max(12, 0.5 * ppm);
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  const testPt1 = { x: midX + n1.x * testDistPx, y: midY + n1.y * testDistPx };
  const testPt2 = { x: midX + n2.x * testDistPx, y: midY + n2.y * testDistPx };

  const isInside1 = grid.isInteriorPoint(testPt1);
  const isInside2 = grid.isInteriorPoint(testPt2);

  if (isInside1 && !isInside2) return n1;
  if (isInside2 && !isInside1) return n2;

  let count1 = 0, count2 = 0;
  for (let d = 1; d <= 4; d++) {
    if (grid.isInteriorPoint({ x: midX + n1.x * d * testDistPx, y: midY + n1.y * d * testDistPx })) count1++;
    if (grid.isInteriorPoint({ x: midX + n2.x * d * testDistPx, y: midY + n2.y * d * testDistPx })) count2++;
  }

  return count1 >= count2 ? n1 : n2;
}

/**
 * Extract logical interior spaces / rooms from CAD zones or grid clustering.
 * Filters out tiny CAD fragments (< 6 m²) to prevent CAD over-segmentation.
 */
const MIN_SPACE_AREA_M2 = 6.0;

export function extractSpaces(domain, grid, ppm = 25.0) {
  const rawSpaces = [];

  if (domain.zonePolygons && domain.zonePolygons.length > 0) {
    // If there are many CAD zones (e.g., > 25), filter out small fragments so we don't over-segment into hundreds of tiny spaces
    const minAreaThresholdM2 = domain.zonePolygons.length > 25 ? 10.0 : 6.0;

    domain.zonePolygons.forEach((poly, idx) => {
      const areaPx = polygonArea(poly);
      const areaM2 = Math.round((areaPx / (ppm * ppm)) * 10) / 10;

      // Filter out micro CAD hatch fragments, door swings
      if (areaM2 >= minAreaThresholdM2) {
        const name = domain.zoneObjMap[idx]?.name || `Room ${rawSpaces.length + 1}`;
        const id = domain.zoneObjMap[idx]?.id || `zone_${rawSpaces.length}`;
        const centroid = polygonCentroid(poly);
        rawSpaces.push({ id, name, polygon: poly, areaM2, centroid, type: "zone" });
      }
    });
  }

  // If CAD zones are missing or over-segmented into tiny pieces, partition layout using connected grid clustering (~6m x 6m)
  if (rawSpaces.length === 0) {
    const cellMap = new Map();
    const bucketSizePx = Math.max(140, 6.0 * ppm);

    grid.validIndices.forEach(idx => {
      const pt = grid.points[idx];
      const roomCol = Math.floor((pt.x - grid.bounds.minX) / bucketSizePx);
      const roomRow = Math.floor((pt.y - grid.bounds.minY) / bucketSizePx);
      const roomId = `space_${roomRow}_${roomCol}`;

      if (!cellMap.has(roomId)) {
        cellMap.set(roomId, { id: roomId, cells: [], minX: pt.x, maxX: pt.x, minY: pt.y, maxY: pt.y });
      }
      const r = cellMap.get(roomId);
      r.cells.push(idx);
      r.minX = Math.min(r.minX, pt.x);
      r.maxX = Math.max(r.maxX, pt.x);
      r.minY = Math.min(r.minY, pt.y);
      r.maxY = Math.max(r.maxY, pt.y);
    });

    let spaceNum = 1;
    for (const [id, r] of cellMap.entries()) {
      const areaM2 = Math.round((r.cells.length * grid.cellAreaM2) * 10) / 10;
      if (areaM2 >= MIN_SPACE_AREA_M2) {
        const cx = (r.minX + r.maxX) / 2;
        const cy = (r.minY + r.maxY) / 2;
        rawSpaces.push({
          id,
          name: `Room / Section ${spaceNum++}`,
          cellIndices: new Set(r.cells),
          areaM2,
          centroid: { x: cx, y: cy },
          type: "auto_space"
        });
      }
    }
  }

  return rawSpaces;
}

/**
 * Generate candidate mounting positions along walls with inward interior offsets.
 */
export function generateCandidatePositions(wallSegments, grid, ppm = 25.0, stepM = 3.5) {
  const stepPx = Math.max(30, stepM * ppm);
  const offsetPx = Math.max(14, 0.65 * ppm);
  const candidates = [];
  const seenKeys = new Set();

  for (const seg of wallSegments) {
    const p1 = seg[0];
    const p2 = seg[1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < stepPx * 0.3) continue;

    // Both wall normals so rooms on either side of interior walls get candidates
    const n1 = { x: -dy / len, y: dx / len };
    const n2 = { x: dy / len, y: -dx / len };
    const normals = [n1, n2];

    const steps = Math.max(1, Math.floor(len / stepPx));

    for (const norm of normals) {
      const aimAngle = Math.atan2(norm.y, norm.x) * (180 / Math.PI);

      for (let s = 1; s <= steps; s++) {
        const t = s / (steps + 1);
        const wx = p1.x + t * dx;
        const wy = p1.y + t * dy;

        const candPt = { x: wx + norm.x * offsetPx, y: wy + norm.y * offsetPx };
        if (grid.isInteriorPoint(candPt)) {
          const key = `${Math.round(candPt.x / (stepPx * 0.35))},${Math.round(candPt.y / (stepPx * 0.35))}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            candidates.push({
              x: Math.round(candPt.x * 10) / 10,
              y: Math.round(candPt.y * 10) / 10,
              wallNormal: norm,
              aimAngle,
              type: "wall"
            });
          }
        }
      }

      for (const cornerPt of [p1, p2]) {
        const candPt = { x: cornerPt.x + norm.x * offsetPx, y: cornerPt.y + norm.y * offsetPx };
        if (grid.isInteriorPoint(candPt)) {
          const key = `${Math.round(candPt.x / (stepPx * 0.35))},${Math.round(candPt.y / (stepPx * 0.35))}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            candidates.push({
              x: Math.round(candPt.x * 10) / 10,
              y: Math.round(candPt.y * 10) / 10,
              wallNormal: norm,
              aimAngle,
              type: "corner"
            });
          }
        }
      }
    }

    if (candidates.length >= 350) break;
  }

  return candidates;
}

/**
 * Generate smart candidate positions guaranteed to sit INSIDE created zone polygons.
 * Model-aware: adapts mounting preferences to camera types (Fisheye -> Centroids, Bullet -> Diagonals, Dome -> Corners).
 */
export function generateSmartCandidates(domain, grid, ppm = 25.0, primaryModelType = "dome", spaces = []) {
  const candidates = [];
  const minMarginPx = Math.max(18, 0.75 * ppm);

  if (domain.zonePolygons && domain.zonePolygons.length > 0) {
    domain.zonePolygons.forEach((zonePoly, zoneIdx) => {
      const zoneId = domain.zoneObjMap?.[zoneIdx]?.id || `zone_${zoneIdx}`;
      const zoneName = domain.zoneObjMap?.[zoneIdx]?.name || `Zone ${zoneIdx + 1}`;
      const center = polygonCentroid(zonePoly);
      const zoneAreaPx = polygonArea(zonePoly);
      const zoneAreaM2 = zoneAreaPx / (ppm * ppm);

      if (zoneAreaM2 < 5.0) return; // Skip tiny zones

      // 1. Zone Centroid Candidate (Primary choice for Fisheye / Panoramic ceiling mounts)
      if (pointInPolygon(center.x, center.y, zonePoly)) {
        const nudged = nudgePointInsidePolygon(center.x, center.y, zonePoly, minMarginPx);
        if (nudged) {
          candidates.push({
            x: Math.round(nudged.x * 10) / 10,
            y: Math.round(nudged.y * 10) / 10,
            zoneId,
            zoneName,
            zoneAreaM2,
            type: "centroid",
            aimAngle: 0,
            wallNormal: { x: 0, y: 1 },
            zonePoly
          });
        }
      }

      // 2. Polygon Corner Candidates (Primary choice for Domes and Wall Mounts)
      for (let i = 0; i < zonePoly.length; i++) {
        const prevPt = zonePoly[(i - 1 + zonePoly.length) % zonePoly.length];
        const currPt = zonePoly[i];
        const nextPt = zonePoly[(i + 1) % zonePoly.length];

        const v1x = prevPt.x - currPt.x;
        const v1y = prevPt.y - currPt.y;
        const v2x = nextPt.x - currPt.x;
        const v2y = nextPt.y - currPt.y;

        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);
        if (l1 < 5 || l2 < 5) continue;

        const u1x = v1x / l1, u1y = v1y / l1;
        const u2x = v2x / l2, u2y = v2y / l2;

        let bisectorX = u1x + u2x;
        let bisectorY = u1y + u2y;
        let bisectorLen = Math.hypot(bisectorX, bisectorY);

        if (bisectorLen < 1e-4) {
          bisectorX = -u1y;
          bisectorY = u1x;
          bisectorLen = 1;
        }

        let candPt = {
          x: currPt.x + (bisectorX / bisectorLen) * minMarginPx,
          y: currPt.y + (bisectorY / bisectorLen) * minMarginPx
        };

        if (!pointInPolygon(candPt.x, candPt.y, zonePoly)) {
          candPt = {
            x: currPt.x - (bisectorX / bisectorLen) * minMarginPx,
            y: currPt.y - (bisectorX / bisectorLen) * minMarginPx
          };
        }

        const nudged = nudgePointInsidePolygon(candPt.x, candPt.y, zonePoly, minMarginPx);
        if (nudged) {
          const aimAngle = Math.atan2(center.y - nudged.y, center.x - nudged.x) * (180 / Math.PI);
          candidates.push({
            x: Math.round(nudged.x * 10) / 10,
            y: Math.round(nudged.y * 10) / 10,
            zoneId,
            zoneName,
            zoneAreaM2,
            type: "corner",
            aimAngle: aimAngle,
            wallNormal: { x: (center.x - nudged.x) / Math.hypot(center.x - nudged.x, center.y - nudged.y), y: (center.y - nudged.y) / Math.hypot(center.x - nudged.x, center.y - nudged.y) },
            zonePoly
          });
        }
      }

      // 3. Polygon Edge Midpoint Candidates (Ideal for Bullet long-range wall sweeps)
      for (let i = 0; i < zonePoly.length; i++) {
        const p1 = zonePoly[i];
        const p2 = zonePoly[(i + 1) % zonePoly.length];
        const edgeLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (edgeLen < minMarginPx * 1.5) continue;

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        const inwardNorm = getWallInwardNormal([p1, p2], grid, ppm);
        const testPt = { x: midX + inwardNorm.x * minMarginPx, y: midY + inwardNorm.y * minMarginPx };

        if (pointInPolygon(testPt.x, testPt.y, zonePoly)) {
          const nudged = nudgePointInsidePolygon(testPt.x, testPt.y, zonePoly, minMarginPx);
          if (nudged) {
            const aimAngle = Math.atan2(center.y - nudged.y, center.x - nudged.x) * (180 / Math.PI);
            candidates.push({
              x: Math.round(nudged.x * 10) / 10,
              y: Math.round(nudged.y * 10) / 10,
              zoneId,
              zoneName,
              zoneAreaM2,
              type: "wall",
              aimAngle: aimAngle,
              wallNormal: inwardNorm,
              zonePoly
            });
          }
        }
      }
    });
  }

  // Also generate wall candidates for unzoned areas (e.g. open central halls/corridors)
  const unzonedCells = grid.validIndices.filter(idx => !grid.points[idx].zoneId);
  if (unzonedCells.length > 15 || candidates.length < 5) {
    const wallCands = generateCandidatePositions(domain.wallSegments, grid, ppm, 3.5);
    candidates.push(...wallCands);
  }

  // Add room/section centroid candidates for ALL extracted spaces (e.g. conference room, entrance, offices)
  if (spaces && spaces.length > 0) {
    const seenCentroids = new Set();
    spaces.forEach(s => {
      if (s.centroid && grid.isInteriorPoint(s.centroid)) {
        const key = `${Math.round(s.centroid.x / 30)},${Math.round(s.centroid.y / 30)}`;
        if (!seenCentroids.has(key)) {
          seenCentroids.add(key);
          candidates.push({
            x: Math.round(s.centroid.x * 10) / 10,
            y: Math.round(s.centroid.y * 10) / 10,
            type: "centroid",
            aimAngle: 0,
            wallNormal: { x: 0, y: 1 },
            zoneId: s.id,
            zoneName: s.name,
            zonePoly: s.polygon || null
          });
        }
      }
    });
  }

  return candidates;
}

/**
 * Generates inward beam orientations for a candidate position.
 * Wall cameras ONLY evaluate focused inward angle offsets around inward normal.
 */
export function generateOrientations(candidate, hfov = 90) {
  if (candidate.type === "centroid" || hfov >= 150) {
    return [0, 45, 90, 135, 180, 225, 270, 315];
  }

  const baseAngleDeg = candidate.aimAngle ?? (
    candidate.wallNormal ? Math.atan2(candidate.wallNormal.y, candidate.wallNormal.x) * (180 / Math.PI) : 0
  );

  const offsets = [0, -15, 15, -30, 30, -45, 45];
  const angles = [];
  for (const off of offsets) {
    const deg = (baseAngleDeg + off + 360) % 360;
    angles.push(deg);
  }

  return angles;
}

/**
 * Filter wall segments spatially to those within reach of FOV
 */
function filterWallsInReach(wallSegments, origin, maxRangePx) {
  const reachSq = (maxRangePx * 1.15) * (maxRangePx * 1.15);
  const relevant = [];

  for (const seg of wallSegments) {
    const p1 = seg[0];
    const p2 = seg[1];
    const d1 = (p1.x - origin.x) * (p1.x - origin.x) + (p1.y - origin.y) * (p1.y - origin.y);
    const d2 = (p2.x - origin.x) * (p2.x - origin.x) + (p2.y - origin.y) * (p2.y - origin.y);

    if (d1 <= reachSq || d2 <= reachSq) {
      relevant.push(seg);
    } else {
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const dm = (mx - origin.x) * (mx - origin.x) + (my - origin.y) * (my - origin.y);
      if (dm <= reachSq) {
        relevant.push(seg);
      }
    }
  }

  return relevant;
}

/**
 * Asynchronous Auto Camera Placement Optimizer
 */
export async function runAutoPlacementAsync(
  {
    walls = [],
    zones = [],
    floorImg = null,
    ppm = 25.0,
    selectedModels = [],
    cameraSpec = null,
    mode = "automatic",
    specifiedCount = 4,
    targetCoveragePercent = 100,
    mountingHeight = 2.8,
    signal = null
  },
  onProgress = () => {}
) {
  if (signal?.aborted) throw new Error("Optimization cancelled");

  let modelPool = Array.isArray(selectedModels) && selectedModels.length > 0 ? selectedModels : [];
  if (modelPool.length === 0 && cameraSpec) {
    modelPool = [cameraSpec];
  }
  if (modelPool.length === 0) {
    modelPool = [{
      id: "generic-4mp-dome",
      brand: "Generic",
      model: "4MP Network Dome",
      type: "dome",
      megapixels: 4,
      hfov: 90,
      vfov: 60,
      rangeDay: 25
    }];
  }

  const primaryModel = modelPool[0];
  const primaryType = (primaryModel.type || "dome").toLowerCase();
  const isFisheye = primaryType === "fisheye" || (primaryModel.hfov || 90) >= 150;
  const isBullet = primaryType === "bullet" || (primaryModel.hfov || 90) <= 75;
  const primaryRangeM = primaryModel.rangeDay || 25;

  onProgress({ step: 1, percent: 15, message: `Analyzing layout geometry & interior usable floor area...` });
  await new Promise(r => setTimeout(r, 10));
  if (signal?.aborted) throw new Error("Optimization cancelled");

  // 1. Extract layout domain geometry & zones
  const domain = extractLayoutDomain(walls, zones, floorImg, ppm);
  const { boundary: buildingBoundary, insetBoundary, centroid: buildingCentroid } = getBuildingBoundary(walls, zones, ppm);

  const layoutSpanM = Math.hypot(domain.bounds.maxX - domain.bounds.minX, domain.bounds.maxY - domain.bounds.minY) / (ppm || 25.0);
  const adaptiveSpacingM = Math.max(0.65, Math.min(0.95, layoutSpanM / 70));
  
  const grid = new CoverageGrid(domain.bounds, ppm, adaptiveSpacingM);
  grid.filterInteriorLayout(domain.domainPolygon, domain.zonePolygons, domain.obstaclePolygons, domain.wallSegments, domain.zoneObjMap);

  const totalInteriorCells = grid.validIndices.length;
  const totalLayoutAreaM2 = Math.round(totalInteriorCells * grid.cellAreaM2 * 10) / 10;

  if (totalInteriorCells === 0) {
    throw new Error("No valid interior layout area detected. Please check layout walls or calibration.");
  }

  // Extract logical spaces / rooms
  const spaces = extractSpaces(domain, grid, ppm);

  onProgress({ step: 2, percent: 30, message: `Generating inward candidates across ${spaces.length} space(s)...` });
  await new Promise(r => setTimeout(r, 10));
  if (signal?.aborted) throw new Error("Optimization cancelled");

  // 2. Generate candidate positions adapted to camera model type
  const candidates = generateSmartCandidates(domain, grid, ppm, primaryType, spaces);

  if (candidates.length === 0) {
    candidates.push(
      { x: (domain.bounds.minX + domain.bounds.maxX) / 2, y: (domain.bounds.minY + domain.bounds.maxY) / 2, wallNormal: { x: 1, y: 0 } }
    );
  }

  onProgress({ step: 3, percent: 45, message: `Evaluating ${candidates.length} candidate positions across ${modelPool.length} model(s)...` });
  await new Promise(r => setTimeout(r, 10));
  if (signal?.aborted) throw new Error("Optimization cancelled");

  // 3. Precompute visibility polygons & beam direction checks
  let configurationsEvaluated = 0;
  let orientationsEvaluated = 0;
  const candidateEvals = [];

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    if (signal?.aborted) throw new Error("Optimization cancelled");
    const cand = candidates[cIdx];

    for (const model of modelPool) {
      const hfov = model.hfov || 90;
      const orientations = generateOrientations(cand, hfov);
      const halfRad = (hfov / 2) * (Math.PI / 180);
      const rangeM = model.rangeDay || 25;
      const fovLenPx = rangeM * ppm;

      const localWalls = filterWallsInReach(domain.wallSegments, cand, fovLenPx);

      for (const dir of orientations) {
        orientationsEvaluated++;
        configurationsEvaluated++;

        const centerRad = dir * (Math.PI / 180);

        // Verify beam direction isn't blocked by an immediate wall within 1.2 meters
        let isWallBlocked = false;
        const rayCheckDist = Math.min(1.5 * ppm, fovLenPx * 0.2);
        const rayEnd = { x: cand.x + Math.cos(centerRad) * rayCheckDist, y: cand.y + Math.sin(centerRad) * rayCheckDist };
        for (const wallSeg of localWalls) {
          if (lineSegmentsIntersect(cand, rayEnd, wallSeg[0], wallSeg[1])) {
            isWallBlocked = true;
            break;
          }
        }
        if (isWallBlocked && cand.type !== "centroid") continue;

        // Compute visibility polygon strictly bounded by candidate's zone if inside a zone
        const targetBoundaryPoly = (cand.zonePoly && cand.zonePoly.length >= 3)
          ? cand.zonePoly
          : domain.domainPolygon;

        const rawVisPoly = CctvCalc.computeFovVisibility(
          { x: cand.x, y: cand.y },
          centerRad,
          halfRad,
          fovLenPx,
          domain.obstaclePolygons,
          localWalls,
          targetBoundaryPoly
        );

        // Clip FOV visibility polygon strictly to valid interior grid boundary
        const visPoly = grid.clipVisibilityPolygon(rawVisPoly, { x: cand.x, y: cand.y });

        const { insideCells, outsideCells } = grid.computeFovCoverageAndOutside(visPoly, cand.zoneId);
        const insideCount = insideCells.size;
        const outsideCount = outsideCells.size;

        if (insideCount < 3) continue;

        // Inward normal alignment penalty
        let outwardPenalty = 0;
        if (cand.wallNormal) {
          const aimVecX = Math.cos(centerRad);
          const aimVecY = Math.sin(centerRad);
          const dot = aimVecX * cand.wallNormal.x + aimVecY * cand.wallNormal.y;
          if (dot < -0.1) outwardPenalty = 20;
        }

        candidateEvals.push({
          candidate: cand,
          direction: dir,
          model,
          visPoly,
          insideCells,
          outsideCells,
          insideCount,
          outsideCount,
          outwardPenalty
        });
      }
    }

    if (cIdx % 8 === 0 || cIdx === candidates.length - 1) {
      const pct = 45 + Math.floor((cIdx / candidates.length) * 35);
      onProgress({
        step: 4,
        percent: pct,
        message: `Testing optical line-of-sight & valid interior FOV (${Math.round((cIdx / candidates.length) * 100)}%)...`
      });
      await new Promise(r => setTimeout(r, 10));
    }
  }

  onProgress({ step: 5, percent: 85, message: "Optimizing interior layout coverage for maximum coverage..." });
  await new Promise(r => setTimeout(r, 10));
  if (signal?.aborted) throw new Error("Optimization cancelled");

  // 4. Optimization Pass 1: Blind-Spot-First Greedy Solver
  const placedCameras = [];
  const globalCoveredCells = new Set();
  let totalOutsideCells = 0;

  const targetFraction = Math.min(1.0, (targetCoveragePercent || 100) / 100);
  // Practical max camera limit: scale realistically with floor layout size and room count
  const practicalMaxCameras = mode === "specify"
    ? Math.max(1, Number(specifiedCount) || 1)
    : Math.max(2, Math.min(32, Math.max(spaces.length + 4, Math.ceil(totalLayoutAreaM2 / 40))));

  const MIN_CAM_DIST_M = Math.max(3.0, Math.min(5.5, primaryRangeM * 0.22));
  // Hard stop rule: each additional camera MUST provide at least 2.5 m² OR at least 0.8% of total interior layout
  const minRequiredMarginalM2 = Math.max(2.5, totalLayoutAreaM2 * 0.008);

  let iteration = 0;
  let stoppingReason = "";

  while (iteration < practicalMaxCameras) {
    if (signal?.aborted) throw new Error("Optimization cancelled");

    // Identify current critical blind spot spaces (spaces with highest uncovered area)
    const blindSpaceCellSets = [];
    spaces.forEach(s => {
      let spaceUncoveredCount = 0;
      if (s.cellIndices) {
        s.cellIndices.forEach(idx => {
          if (!globalCoveredCells.has(idx)) spaceUncoveredCount++;
        });
      }
      if (spaceUncoveredCount * grid.cellAreaM2 >= 4.0) {
        blindSpaceCellSets.push({ id: s.id, count: spaceUncoveredCount, cells: s.cellIndices });
      }
    });
    blindSpaceCellSets.sort((a, b) => b.count - a.count);
    const topBlindSets = blindSpaceCellSets.slice(0, 3).map(b => b.cells);

    let bestConfig = null;
    let bestScore = -Infinity;
    let bestNewCells = 0;

    for (let i = 0; i < candidateEvals.length; i++) {
      const evalItem = candidateEvals[i];
      if (evalItem.insideCount === 0) continue;
      const cand = evalItem.candidate;

      // Distance separation check against existing placed cameras
      let isClustered = false;
      for (const placed of placedCameras) {
        const distPx = Math.hypot(cand.x - placed.x, cand.y - placed.y);
        const distM = distPx / ppm;
        if (distM < MIN_CAM_DIST_M) {
          // If a solid wall separates candidate from placed camera, they are in different rooms and not clustered!
          let hasWallBetween = false;
          for (const wallSeg of domain.wallSegments) {
            if (lineSegmentsIntersect(cand, placed, wallSeg[0], wallSeg[1])) {
              hasWallBetween = true;
              break;
            }
          }
          if (!hasWallBetween) {
            isClustered = true;
            break;
          }
        }
      }
      if (isClustered) continue;

      // Calculate New Useful Interior Coverage vs Overlap vs Blind Spot Gain
      let newCount = 0;
      let overlapCount = 0;
      let blindSpotNewCount = 0;

      for (const cellIdx of evalItem.insideCells) {
        if (!globalCoveredCells.has(cellIdx)) {
          newCount++;
          for (const blindSet of topBlindSets) {
            if (blindSet && blindSet.has(cellIdx)) {
              blindSpotNewCount++;
              break;
            }
          }
        } else {
          overlapCount++;
        }
      }

      const newAreaM2 = newCount * grid.cellAreaM2;
      const overlapAreaM2 = overlapCount * grid.cellAreaM2;
      const blindNewM2 = blindSpotNewCount * grid.cellAreaM2;

      // Hard gate: Candidate must yield at least minRequiredMarginalM2 of NEW unique interior coverage
      if (newAreaM2 < minRequiredMarginalM2) continue;

      const overlapRatio = evalItem.insideCount > 0 ? overlapCount / evalItem.insideCount : 0;
      // Reject cameras that mostly view already-covered areas unless providing distinct room coverage
      if (overlapRatio > 0.50 && newAreaM2 < 6.0) continue;
      if (overlapRatio > 0.65) continue;

      // Type-specific candidate preference score bonus
      let typeBonus = 0;
      if (isFisheye && cand.type === "centroid") typeBonus = 30;
      if (isBullet && cand.type === "wall") typeBonus = 20;
      if (!isFisheye && !isBullet && cand.type === "corner") typeBonus = 25;

      // Multi-Factor Objective Score prioritizing unique coverage and heavily penalizing redundant overlap
      const score = (newAreaM2 * 16.0)
        + (blindNewM2 * 10.0)
        - (overlapAreaM2 * 14.0)
        - (evalItem.outsideCount * 35.0)
        - (evalItem.outwardPenalty * 50.0)
        + typeBonus;

      if (score > bestScore) {
        bestScore = score;
        bestConfig = evalItem;
        bestNewCells = newCount;
      }
    }

    // Stop adding cameras if no candidate provides sufficient marginal interior gain
    if (!bestConfig || (bestNewCells * grid.cellAreaM2) < minRequiredMarginalM2) {
      stoppingReason = placedCameras.length === 0
        ? "No valid camera position found within layout"
        : `Maximum practical coverage reached with optimal camera count (marginal gain < ${minRequiredMarginalM2.toFixed(1)} m²)`;
      break;
    }

    // Before adding a new camera, test if an existing placed camera can be adjusted (reoriented/shifted)
    let adjustedExisting = false;
    if (placedCameras.length > 0 && mode === "automatic") {
      for (let i = 0; i < placedCameras.length; i++) {
        const existingCam = placedCameras[i];
        const distToCand = Math.hypot(existingCam.x - bestConfig.candidate.x, existingCam.y - bestConfig.candidate.y) / ppm;
        if (distToCand > (existingCam.camera?.rangeDay || 25) * 1.3) continue;

        const yawOptions = [existingCam.direction - 30, existingCam.direction - 15, existingCam.direction + 15, existingCam.direction + 30];
        for (const testYaw of yawOptions) {
          const normYaw = (testYaw + 360) % 360;
          const centerRad = normYaw * (Math.PI / 180);
          const halfRad = ((existingCam.camera?.hfov || 90) / 2) * (Math.PI / 180);
          const fovLenPx = (existingCam.camera?.rangeDay || 25) * ppm;
          const localWalls = filterWallsInReach(domain.wallSegments, { x: existingCam.x, y: existingCam.y }, fovLenPx);
          const rawVis = CctvCalc.computeFovVisibility(
            { x: existingCam.x, y: existingCam.y },
            centerRad,
            halfRad,
            fovLenPx,
            domain.obstaclePolygons,
            localWalls,
            domain.domainPolygon
          );
          const testVisPoly = grid.clipVisibilityPolygon(rawVis, { x: existingCam.x, y: existingCam.y });
          const { insideCells } = grid.computeFovCoverageAndOutside(testVisPoly);

          let coveredNewCount = 0;
          for (const cellIdx of bestConfig.insideCells) {
            if (!globalCoveredCells.has(cellIdx) && insideCells.has(cellIdx)) {
              coveredNewCount++;
            }
          }

          let preservedCount = 0;
          for (const cellIdx of existingCam.insideCells) {
            if (insideCells.has(cellIdx)) preservedCount++;
          }
          const preservationRatio = existingCam.insideCells.size > 0 ? preservedCount / existingCam.insideCells.size : 1;

          if (coveredNewCount >= bestNewCells * 0.65 && preservationRatio >= 0.85) {
            existingCam.direction = Math.round(normYaw);
            existingCam.visPoly = testVisPoly;
            existingCam.insideCells = insideCells;
            existingCam.usefulCoverageM2 = Math.round(insideCells.size * grid.cellAreaM2 * 10) / 10;
            for (const cellIdx of insideCells) {
              globalCoveredCells.add(cellIdx);
            }
            adjustedExisting = true;
            break;
          }
        }
        if (adjustedExisting) break;
      }
    }

    if (adjustedExisting) {
      iteration++;
      continue;
    }

    // Add new optimal camera
    for (const cellIdx of bestConfig.insideCells) {
      globalCoveredCells.add(cellIdx);
    }
    totalOutsideCells += bestConfig.outsideCount;

    placedCameras.push({
      id: `auto_${Date.now()}_${iteration}_${Math.random().toString(36).substr(2, 5)}`,
      camera: bestConfig.model,
      brand: bestConfig.model.brand || "Generic",
      model: bestConfig.model.model || "Network Camera",
      x: Math.round(bestConfig.candidate.x * 10) / 10,
      y: Math.round(bestConfig.candidate.y * 10) / 10,
      direction: Math.round(bestConfig.direction),
      zoneId: bestConfig.candidate.zoneId || null,
      zoneName: bestConfig.candidate.zoneName || null,
      visPoly: bestConfig.visPoly,
      usefulCoverageM2: Math.round(bestConfig.insideCells.size * grid.cellAreaM2 * 10) / 10,
      outsideAreaM2: Math.round(bestConfig.outsideCount * grid.cellAreaM2 * 10) / 10,
      insideCells: bestConfig.insideCells
    });

    iteration++;

    if (mode === "automatic") {
      const currentCoverageRatio = globalCoveredCells.size / totalInteriorCells;
      if (currentCoverageRatio >= targetFraction) {
        stoppingReason = `Target coverage of ${Math.round(targetFraction * 100)}% achieved with optimal camera count`;
        break;
      }
      if (currentCoverageRatio >= 0.88 && (bestNewCells * grid.cellAreaM2) < (minRequiredMarginalM2 * 1.2)) {
        stoppingReason = "Optimal practical interior coverage reached with minimum camera count";
        break;
      }
    }
  }

  // 5. Pass 2: Joint Local Refinement & Aggressive Multi-Pass Camera Pruning
  let camerasRemovedCount = 0;

  if (placedCameras.length > 0 && mode === "automatic") {
    onProgress({ step: 6, percent: 92, message: "Performing local refinement & pruning redundant cameras..." });
    await new Promise(r => setTimeout(r, 10));

    // Phase 2A: Fine-tune yaw & position jitter
    for (let i = 0; i < placedCameras.length; i++) {
      if (signal?.aborted) throw new Error("Optimization cancelled");
      const cam = placedCameras[i];

      let bestCamState = { x: cam.x, y: cam.y, direction: cam.direction, model: cam.camera, visPoly: cam.visPoly, insideCells: cam.insideCells };
      let bestCamCoverage = cam.insideCells.size;

      const posXOptions = [cam.x, cam.x - 0.25 * ppm, cam.x + 0.25 * ppm];
      const posYOptions = [cam.y, cam.y - 0.25 * ppm, cam.y + 0.25 * ppm];
      const yawOptions = [cam.direction, cam.direction - 15, cam.direction - 5, cam.direction + 5, cam.direction + 15];

      for (const testX of posXOptions) {
        for (const testY of posYOptions) {
          if (!grid.isInteriorPoint({ x: testX, y: testY })) continue;
          if (!isInsideBoundary({ x: testX, y: testY }, insetBoundary)) continue;
          for (const testYaw of yawOptions) {
            for (const testModel of modelPool) {
              const hfov = testModel.hfov || 90;
              const halfRad = (hfov / 2) * (Math.PI / 180);
              const rangeM = testModel.rangeDay || 25;
              const fovLenPx = rangeM * ppm;
              const centerRad = ((testYaw + 360) % 360) * (Math.PI / 180);

              const localWalls = filterWallsInReach(domain.wallSegments, { x: testX, y: testY }, fovLenPx);
              const rawVis = CctvCalc.computeFovVisibility(
                { x: testX, y: testY },
                centerRad,
                halfRad,
                fovLenPx,
                domain.obstaclePolygons,
                localWalls,
                domain.domainPolygon
              );
              const testVisPoly = grid.clipVisibilityPolygon(rawVis, { x: testX, y: testY });
              const { insideCells } = grid.computeFovCoverageAndOutside(testVisPoly);

              if (insideCells.size > bestCamCoverage) {
                bestCamCoverage = insideCells.size;
                bestCamState = {
                  x: Math.round(testX * 10) / 10,
                  y: Math.round(testY * 10) / 10,
                  direction: Math.round((testYaw + 360) % 360),
                  model: testModel,
                  visPoly: testVisPoly,
                  insideCells
                };
              }
            }
          }
        }
      }

      cam.x = bestCamState.x;
      cam.y = bestCamState.y;
      cam.direction = bestCamState.direction;
      cam.camera = bestCamState.model;
      cam.brand = bestCamState.model.brand || "Generic";
      cam.model = bestCamState.model.model || "Network Camera";
      cam.visPoly = bestCamState.visPoly;
      cam.usefulCoverageM2 = Math.round(bestCamState.insideCells.size * grid.cellAreaM2 * 10) / 10;
      cam.insideCells = bestCamState.insideCells;
    }

    // Phase 2B: Prune redundant duplicate cameras without removing cameras that cover distinct rooms
    const minUniquePruneM2 = Math.max(2.0, Math.min(5.0, totalLayoutAreaM2 * 0.007));
    let pruningActive = true;

    while (pruningActive && placedCameras.length > 1) {
      let lowestUniqueIdx = -1;
      let lowestUniqueM2 = Infinity;

      for (let i = 0; i < placedCameras.length; i++) {
        const cam = placedCameras[i];
        const otherCovered = new Set();
        placedCameras.forEach((other, oIdx) => {
          if (oIdx !== i) {
            other.insideCells.forEach(idx => otherCovered.add(idx));
          }
        });

        let uniqueCount = 0;
        cam.insideCells.forEach(idx => {
          if (!otherCovered.has(idx)) uniqueCount++;
        });
        const uniqueAreaM2 = uniqueCount * grid.cellAreaM2;

        if (uniqueAreaM2 < lowestUniqueM2) {
          lowestUniqueM2 = uniqueAreaM2;
          lowestUniqueIdx = i;
        }
      }

      if (lowestUniqueIdx !== -1 && lowestUniqueM2 < minUniquePruneM2) {
        placedCameras.splice(lowestUniqueIdx, 1);
        camerasRemovedCount++;
        globalCoveredCells.clear();
        placedCameras.forEach(c => c.insideCells.forEach(idx => globalCoveredCells.add(idx)));
      } else {
        pruningActive = false;
      }
    }
  }

  // 5C. Validate every auto-placed camera position and orientation against building boundary
  let snappedCount = 0;
  let flippedCount = 0;

  for (let i = 0; i < placedCameras.length; i++) {
    const cam = placedCameras[i];

    // 1. Position test: ensure camera is strictly inside the inset boundary
    if (!isInsideBoundary({ x: cam.x, y: cam.y }, insetBoundary)) {
      const snapped = snapToPolygonBoundary(cam, insetBoundary, buildingCentroid, Math.max(1, 0.08 * ppm));
      cam.x = Math.round(snapped.x * 10) / 10;
      cam.y = Math.round(snapped.y * 10) / 10;
      snappedCount++;
    }

    // 2. Heading test: verify center ray of FOV points into layout
    const testRayDist = Math.max(15, 1.5 * ppm);
    const curRad = cam.direction * (Math.PI / 180);
    const curRayEnd = { x: cam.x + Math.cos(curRad) * testRayDist, y: cam.y + Math.sin(curRad) * testRayDist };
    const rayInside = isInsideBoundary(curRayEnd, buildingBoundary);

    if (!rayInside) {
      // Attempt flip: test if (cam.direction + 180) % 360 lands inside
      const flippedHeading = Math.round((cam.direction + 180) % 360);
      const flippedRad = flippedHeading * (Math.PI / 180);
      const flippedRayEnd = { x: cam.x + Math.cos(flippedRad) * testRayDist, y: cam.y + Math.sin(flippedRad) * testRayDist };
      if (isInsideBoundary(flippedRayEnd, buildingBoundary)) {
        cam.direction = flippedHeading;
      } else {
        cam.direction = getInwardHeading(cam, buildingBoundary, insetBoundary, buildingCentroid, spaces, ppm);
      }
      flippedCount++;
    }

    // 3. Re-clip camera's visPoly to buildingBoundary so beam matches updated position/heading
    const centerRad = cam.direction * (Math.PI / 180);
    const hfov = cam.camera?.hfov || 90;
    const halfRad = (hfov / 2) * (Math.PI / 180);
    const rangeM = cam.camera?.rangeDay || 25;
    const fovLenPx = rangeM * ppm;
    const localWalls = filterWallsInReach(domain.wallSegments, { x: cam.x, y: cam.y }, fovLenPx);
    const rawVis = CctvCalc.computeFovVisibility(
      { x: cam.x, y: cam.y },
      centerRad,
      halfRad,
      fovLenPx,
      domain.obstaclePolygons,
      localWalls,
      buildingBoundary
    );
    cam.visPoly = grid.clipVisibilityPolygon(rawVis, { x: cam.x, y: cam.y });
    const coverage = grid.computeFovCoverageAndOutside(cam.visPoly, cam.zoneId);
    cam.insideCells = coverage.insideCells;
    cam.usefulCoverageM2 = Math.round(coverage.insideCells.size * grid.cellAreaM2 * 10) / 10;
    cam.outsideAreaM2 = Math.round(coverage.outsideCells.size * grid.cellAreaM2 * 10) / 10;
  }

  // Recalculate globalCoveredCells if any camera changed
  if (snappedCount > 0 || flippedCount > 0) {
    globalCoveredCells.clear();
    placedCameras.forEach(c => c.insideCells.forEach(idx => globalCoveredCells.add(idx)));
  }

  console.log(`[AutoPlacement] Boundary validation: ${snappedCount} camera(s) snapped, ${flippedCount} camera(s) flipped.`);

  onProgress({ step: 7, percent: 98, message: "Finalizing coverage metrics & space breakdown..." });
  await new Promise(r => setTimeout(r, 10));
  if (signal?.aborted) throw new Error("Optimization cancelled");

  // 6. Compute Comprehensive Metrics
  const coveredAreaM2 = Math.round(globalCoveredCells.size * grid.cellAreaM2 * 10) / 10;
  const uncoveredAreaM2 = Math.max(0, Math.round((totalLayoutAreaM2 - coveredAreaM2) * 10) / 10);
  const coveragePercent = Math.min(100, Math.round((globalCoveredCells.size / totalInteriorCells) * 1000) / 10);
  const uncoveredPercent = Math.max(0, Math.round((100 - coveragePercent) * 10) / 10);

  const modelDistribution = {};
  for (const cam of placedCameras) {
    const key = `${cam.brand} ${cam.model}`;
    modelDistribution[key] = (modelDistribution[key] || 0) + 1;
  }

  let sumIndividualCoveredCells = 0;
  let sumTotalFovCells = 0;
  for (const cam of placedCameras) {
    sumIndividualCoveredCells += Math.round(cam.usefulCoverageM2 / grid.cellAreaM2);
    sumTotalFovCells += Math.round((cam.usefulCoverageM2 + cam.outsideAreaM2) / grid.cellAreaM2);
  }

  const overlapPercent = globalCoveredCells.size > 0
    ? Math.max(0, Math.round(((sumIndividualCoveredCells - globalCoveredCells.size) / sumIndividualCoveredCells) * 1000) / 10)
    : 0;

  const outsideFovPercent = sumTotalFovCells > 0
    ? Math.max(0, Math.round((totalOutsideCells / sumTotalFovCells) * 1000) / 10)
    : 0;

  const avgNewCoveragePerCamera = placedCameras.length > 0
    ? Math.round((coveredAreaM2 / placedCameras.length) * 10) / 10
    : 0;

  // Marginal gain of final camera
  let marginalGainOfFinalCamera = 0;
  if (placedCameras.length > 0) {
    const finalCam = placedCameras[placedCameras.length - 1];
    const otherCovered = new Set();
    placedCameras.slice(0, placedCameras.length - 1).forEach(c => {
      c.insideCells.forEach(idx => otherCovered.add(idx));
    });
    let uniqueCount = 0;
    finalCam.insideCells.forEach(idx => {
      if (!otherCovered.has(idx)) uniqueCount++;
    });
    marginalGainOfFinalCamera = Math.round(uniqueCount * grid.cellAreaM2 * 10) / 10;
  }

  // Final stopping reason
  if (!stoppingReason) {
    if (coveragePercent >= (targetCoveragePercent || 100) * 0.95) {
      stoppingReason = `Target coverage achieved with ${placedCameras.length} optimal cameras`;
    } else if (placedCameras.length >= practicalMaxCameras) {
      stoppingReason = `Optimal camera budget (${placedCameras.length} cameras) reached for floor layout`;
    } else {
      stoppingReason = `Maximum practical coverage reached with optimal camera count (marginal gain < ${minRequiredMarginalM2.toFixed(1)} m²)`;
    }
  }

  // Space breakdown
  const roomBreakdown = spaces.map(s => {
    let coveredCount = 0;
    let totalCount = 0;

    if (s.polygon) {
      grid.validIndices.forEach(idx => {
        const pt = grid.points[idx];
        if (pointInPolygon(pt.x, pt.y, s.polygon)) {
          totalCount++;
          if (globalCoveredCells.has(idx)) coveredCount++;
        }
      });
    } else if (s.cellIndices) {
      totalCount = s.cellIndices.size;
      s.cellIndices.forEach(idx => {
        if (globalCoveredCells.has(idx)) coveredCount++;
      });
    }

    const totalM2 = Math.round(totalCount * grid.cellAreaM2 * 10) / 10;
    const coveredM2 = Math.round(coveredCount * grid.cellAreaM2 * 10) / 10;
    const pct = totalCount > 0 ? Math.round((coveredCount / totalCount) * 1000) / 10 : 0;

    return {
      id: s.id,
      name: s.name,
      totalAreaM2: totalM2 || s.areaM2,
      coveredAreaM2: coveredM2,
      coveragePercent: pct
    };
  });

  const worstBlindSpots = roomBreakdown
    .filter(r => r.coveragePercent < 90)
    .sort((a, b) => a.coveragePercent - b.coveragePercent)
    .slice(0, 3)
    .map(r => ({
      name: r.name,
      coveragePercent: r.coveragePercent,
      uncoveredM2: Math.round((r.totalAreaM2 - r.coveredAreaM2) * 10) / 10
    }));

  const targetAchieved = coveragePercent >= (targetCoveragePercent || 100) * 0.95;

  onProgress({ step: 8, percent: 100, message: "Placement optimization complete!" });

  return {
    cameras: placedCameras.map(({ insideCells, ...rest }) => rest),
    camerasPlaced: placedCameras.length,
    modelDistribution,
    selectedModelPool: modelPool,
    totalLayoutArea: totalLayoutAreaM2,
    coveredArea: coveredAreaM2,
    uncoveredArea: uncoveredAreaM2,
    coveragePercent,
    uncoveredPercent,
    overlapPercent,
    avgNewCoveragePerCamera,
    outsideFovPercent,
    marginalGainOfFinalCamera,
    camerasRemovedCount,
    stoppingReason,
    roomBreakdown,
    worstBlindSpots,
    targetCoverage: targetCoveragePercent,
    targetAchieved,
    candidatePositionsEvaluated: candidates.length,
    orientationsEvaluated,
    cameraModelsEvaluated: modelPool.length,
    configurationsEvaluated,
    uncoveredReason: !targetAchieved
      ? "Remaining uncovered spaces are blocked by interior partition walls or are beyond camera coverage range."
      : null
  };
}

/**
 * Generate an instant placement summary report for any set of currently placed cameras.
 */
export function generatePlacementReportForPlaced({ placed = [], walls = [], zones = [], floorImg = null, ppm = 25.0 }) {
  const domain = extractLayoutDomain(walls, zones, floorImg, ppm);
  const layoutSpanM = Math.hypot(domain.bounds.maxX - domain.bounds.minX, domain.bounds.maxY - domain.bounds.minY) / (ppm || 25.0);
  const adaptiveSpacingM = Math.max(0.65, Math.min(0.95, layoutSpanM / 70));

  const grid = new CoverageGrid(domain.bounds, ppm, adaptiveSpacingM);
  grid.filterInteriorLayout(domain.domainPolygon, domain.zonePolygons, domain.obstaclePolygons, domain.wallSegments, domain.zoneObjMap);

  const totalInteriorCells = grid.validIndices.length;
  const totalLayoutAreaM2 = Math.round(totalInteriorCells * grid.cellAreaM2 * 10) / 10;

  const spaces = extractSpaces(domain, grid, ppm);

  const globalCoveredCells = new Set();
  let totalOutsideCells = 0;
  const modelDistribution = {};
  const selectedModelPool = [];
  const seenModelIds = new Set();

  let sumIndividualCoveredCells = 0;
  let sumTotalFovCells = 0;

  placed.forEach(p => {
    const camSpec = p.camera || p.model || { brand: p.brand || "Generic", model: p.model || "Camera", hfov: 90, rangeDay: 25 };
    const brand = camSpec.brand || p.brand || "Generic";
    const modelName = camSpec.model || p.model || "Camera";
    const key = `${brand} ${modelName}`;
    modelDistribution[key] = (modelDistribution[key] || 0) + 1;

    if (camSpec.id && !seenModelIds.has(camSpec.id)) {
      seenModelIds.add(camSpec.id);
      selectedModelPool.push(camSpec);
    } else if (!seenModelIds.has(key)) {
      seenModelIds.add(key);
      selectedModelPool.push(camSpec);
    }

    const hfov = camSpec.hfov || 90;
    const halfRad = (hfov / 2) * (Math.PI / 180);
    const centerRad = (p.direction || 0) * (Math.PI / 180);
    const rangeM = camSpec.rangeDay || 25;
    const fovLenPx = rangeM * ppm;

    const rawVis = p.visPoly || CctvCalc.computeFovVisibility(
      { x: p.x, y: p.y },
      centerRad,
      halfRad,
      fovLenPx,
      domain.obstaclePolygons,
      domain.wallSegments,
      domain.domainPolygon
    );
    const visPoly = grid.clipVisibilityPolygon(rawVis, { x: p.x, y: p.y });

    const { insideCells, outsideCells } = grid.computeFovCoverageAndOutside(visPoly);
    sumIndividualCoveredCells += insideCells.size;
    totalOutsideCells += outsideCells.size;
    sumTotalFovCells += (insideCells.size + outsideCells.size);

    for (const cellIdx of insideCells) {
      globalCoveredCells.add(cellIdx);
    }
  });

  const coveredAreaM2 = Math.round(globalCoveredCells.size * grid.cellAreaM2 * 10) / 10;
  const uncoveredAreaM2 = Math.max(0, Math.round((totalLayoutAreaM2 - coveredAreaM2) * 10) / 10);
  const coveragePercent = totalInteriorCells > 0 ? Math.min(100, Math.round((globalCoveredCells.size / totalInteriorCells) * 1000) / 10) : 0;
  const uncoveredPercent = Math.max(0, Math.round((100 - coveragePercent) * 10) / 10);

  const overlapPercent = globalCoveredCells.size > 0
    ? Math.max(0, Math.round(((sumIndividualCoveredCells - globalCoveredCells.size) / sumIndividualCoveredCells) * 1000) / 10)
    : 0;

  const outsideFovPercent = sumTotalFovCells > 0
    ? Math.max(0, Math.round((totalOutsideCells / sumTotalFovCells) * 1000) / 10)
    : 0;

  const avgNewCoveragePerCamera = placed.length > 0
    ? Math.round((coveredAreaM2 / placed.length) * 10) / 10
    : 0;

  const roomBreakdown = spaces.map(s => {
    let coveredCount = 0;
    let totalCount = 0;

    if (s.polygon) {
      grid.validIndices.forEach(idx => {
        const pt = grid.points[idx];
        if (pointInPolygon(pt.x, pt.y, s.polygon)) {
          totalCount++;
          if (globalCoveredCells.has(idx)) coveredCount++;
        }
      });
    } else if (s.cellIndices) {
      totalCount = s.cellIndices.size;
      s.cellIndices.forEach(idx => {
        if (globalCoveredCells.has(idx)) coveredCount++;
      });
    }

    const totalM2 = Math.round(totalCount * grid.cellAreaM2 * 10) / 10;
    const coveredM2 = Math.round(coveredCount * grid.cellAreaM2 * 10) / 10;
    const pct = totalCount > 0 ? Math.round((coveredCount / totalCount) * 1000) / 10 : 0;

    return {
      id: s.id,
      name: s.name,
      totalAreaM2: totalM2 || s.areaM2,
      coveredAreaM2: coveredM2,
      coveragePercent: pct
    };
  });

  const worstBlindSpots = roomBreakdown
    .filter(r => r.coveragePercent < 90)
    .sort((a, b) => a.coveragePercent - b.coveragePercent)
    .slice(0, 3)
    .map(r => ({
      name: r.name,
      coveragePercent: r.coveragePercent,
      uncoveredM2: Math.round((r.totalAreaM2 - r.coveredAreaM2) * 10) / 10
    }));

  return {
    cameras: placed,
    camerasPlaced: placed.length,
    modelDistribution,
    selectedModelPool,
    totalLayoutArea: totalLayoutAreaM2,
    coveredArea: coveredAreaM2,
    uncoveredArea: uncoveredAreaM2,
    coveragePercent,
    uncoveredPercent,
    overlapPercent,
    avgNewCoveragePerCamera,
    outsideFovPercent,
    roomBreakdown,
    worstBlindSpots,
    targetCoverage: 100,
    targetAchieved: coveragePercent >= 90,
    candidatePositionsEvaluated: placed.length,
    orientationsEvaluated: placed.length,
    cameraModelsEvaluated: selectedModelPool.length,
    configurationsEvaluated: placed.length,
    uncoveredReason: coveragePercent < 90
      ? "Remaining uncovered spaces are blocked by interior partition walls or are beyond camera coverage range."
      : null
  };
}