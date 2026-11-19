/**
 * PptFloorRenderer.js
 * ─────────────────────────────────────────────────────────────────
 * Loads Microsoft PowerPoint (.ppt / .pptx) presentations, parses
 * each slide's vector layout, architectural shapes, text annotations,
 * placed camera icons, tables, and embedded floor plan graphics,
 * and renders them to high-resolution 2D PNG data URLs.
 *
 * Supports:
 * - .pptx: OpenXML presentation format with full namespace-agnostic DOM traversal,
 *   shapes (rect, roundRect, ellipse, custom), pictures, tables, groups, and text.
 * - .ppt: Legacy binary PowerPoint files with intelligent floor plan detection
 *   (filters out icon sprites so icons are never treated as separate floors).
 * - Multi-slide decks: each actual presentation slide becomes a distinct floor.
 *
 * Usage:
 *   import { renderPptToImage, renderPptToImages } from "./PptFloorRenderer";
 *   const { dataUrl, width, height, slides } = await renderPptToImage(file);
 */

import { unzipSync, strFromU8 } from "fflate";
import { apiUrl } from "../../config/appConfig";

// ── Color and scheme mappings for OpenXML shapes ─────────────────────────────
const DEFAULT_SCHEME_COLORS = {
  accent1: "#3b82f6",
  accent2: "#10b981",
  accent3: "#f59e0b",
  accent4: "#ef4444",
  accent5: "#8b5cf6",
  accent6: "#06b6d4",
  tx1: "#1e293b",
  tx2: "#475569",
  bg1: "#ffffff",
  bg2: "#f8fafc",
  dk1: "#0f172a",
  lt1: "#ffffff",
};

// ── Namespace-agnostic XML DOM Helpers ───────────────────────────────────────
function getLocalName(node) {
  if (!node) return "";
  return node.localName || (node.nodeName ? node.nodeName.split(":").pop() : "");
}

function findChild(parent, name) {
  if (!parent || !parent.childNodes) return null;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (child.nodeType === 1 && getLocalName(child) === name) return child;
  }
  return null;
}

function findChildren(parent, name) {
  const result = [];
  if (!parent || !parent.childNodes) return result;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (child.nodeType === 1 && getLocalName(child) === name) result.push(child);
  }
  return result;
}

function findDescendant(parent, name) {
  if (!parent || !parent.childNodes) return null;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (child.nodeType === 1) {
      if (getLocalName(child) === name) return child;
      const found = findDescendant(child, name);
      if (found) return found;
    }
  }
  return null;
}

function findAllDescendants(parent, name) {
  const result = [];
  function recurse(n) {
    if (!n || !n.childNodes) return;
    for (let i = 0; i < n.childNodes.length; i++) {
      const child = n.childNodes[i];
      if (child.nodeType === 1) {
        if (getLocalName(child) === name) result.push(child);
        recurse(child);
      }
    }
  }
  recurse(parent);
  return result;
}

/**
 * Loads an image from a URL/DataURL and returns an HTMLImageElement
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load slide image asset"));
    img.src = src;
  });
}

/**
 * Parses XML string using browser's DOMParser
 */
function parseXml(xmlStr) {
  const parser = new DOMParser();
  return parser.parseFromString(xmlStr, "application/xml");
}

/**
 * Resolves color from OpenXML color node
 */
function extractColor(node, schemeColors = DEFAULT_SCHEME_COLORS, fallback = "#000000") {
  if (!node) return fallback;
  const srgb = findDescendant(node, "srgbClr");
  if (srgb) {
    const val = srgb.getAttribute("val");
    if (val) return "#" + val.toLowerCase();
  }
  const scheme = findDescendant(node, "schemeClr");
  if (scheme) {
    const val = scheme.getAttribute("val");
    if (val && schemeColors[val]) return schemeColors[val];
  }
  const prst = findDescendant(node, "prstClr");
  if (prst) {
    const val = prst.getAttribute("val");
    if (val) return val.toLowerCase();
  }
  return fallback;
}

/**
 * Converts OpenXML EMUs (English Metric Units) to Canvas pixels
 * 914,400 EMUs = 1 inch = 96 px -> 1 EMU = 96 / 914400 px
 */
function emuToCanvas(emu, scale) {
  const num = parseFloat(emu);
  if (isNaN(num)) return 0;
  return num * scale;
}

/**
 * Helper to draw rounded rectangle on canvas context
 */
function drawRoundedRect(ctx, x, y, width, height, radius = 8) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Extracts embedded images from raw binary buffer (.ppt legacy format)
 * Returns only valid raster image assets
 */
function extractImagesFromLegacyPpt(buffer) {
  const images = [];
  const u8 = new Uint8Array(buffer);
  let i = 0;

  while (i < u8.length - 8) {
    // 1. PNG Header: 89 50 4E 47 0D 0A 1A 0A
    if (
      u8[i] === 0x89 && u8[i + 1] === 0x50 && u8[i + 2] === 0x4E && u8[i + 3] === 0x47 &&
      u8[i + 4] === 0x0D && u8[i + 5] === 0x0A && u8[i + 6] === 0x1A && u8[i + 7] === 0x0A
    ) {
      let end = i + 8;
      while (end < u8.length - 8) {
        if (u8[end] === 0x49 && u8[end + 1] === 0x45 && u8[end + 2] === 0x4E && u8[end + 3] === 0x44) {
          end += 8; // IEND chunk + CRC
          break;
        }
        end++;
      }
      if (end <= u8.length) {
        images.push({ type: "image/png", data: u8.subarray(i, end) });
        i = end;
        continue;
      }
    }

    // 2. JPEG Header: FF D8 FF
    if (u8[i] === 0xFF && u8[i + 1] === 0xD8 && u8[i + 2] === 0xFF) {
      let end = i + 3;
      while (end < u8.length - 1) {
        if (u8[end] === 0xFF && u8[end + 1] === 0xD9) {
          end += 2;
          break;
        }
        end++;
      }
      if (end <= u8.length) {
        images.push({ type: "image/jpeg", data: u8.subarray(i, end) });
        i = end;
        continue;
      }
    }

    i++;
  }
  return images;
}

/**
 * Extracts relationship mappings from a .rels XML document
 */
function parseRelationships(relsXmlStr) {
  const relMap = {};
  if (!relsXmlStr) return relMap;
  try {
    const doc = parseXml(relsXmlStr);
    const rels = findAllDescendants(doc, "Relationship");
    rels.forEach((rel) => {
      const id = rel.getAttribute("Id");
      let target = rel.getAttribute("Target") || "";
      // Normalize target path
      if (target.startsWith("../")) {
        target = "ppt/" + target.replace(/^\.\.\//, "");
      } else if (!target.startsWith("ppt/")) {
        target = "ppt/slides/" + target;
      }
      target = target.replace(/\\/g, "/");
      relMap[id] = target;
    });
  } catch (err) {
    console.warn("[PptFloorRenderer] Failed to parse relationships:", err);
  }
  return relMap;
}

/**
 * Renders a single shape (<p:sp>) onto the canvas
 */
function renderShape(ctx, sp, scaleX, scaleY, parentOffsetX = 0, parentOffsetY = 0) {
  try {
    const spPr = findChild(sp, "spPr");
    if (!spPr) return;

    const xfrm = findChild(spPr, "xfrm");
    if (!xfrm) return;

    const off = findChild(xfrm, "off");
    const ext = findChild(xfrm, "ext");
    if (!off || !ext) return;

    const x = emuToCanvas(off.getAttribute("x"), scaleX) + parentOffsetX;
    const y = emuToCanvas(off.getAttribute("y"), scaleY) + parentOffsetY;
    const w = emuToCanvas(ext.getAttribute("cx"), scaleX);
    const h = emuToCanvas(ext.getAttribute("cy"), scaleY);

    if (w <= 0 || h <= 0) return;

    const rotAttr = xfrm.getAttribute("rot");
    const hasRot = rotAttr ? parseFloat(rotAttr) !== 0 : false;
    if (hasRot) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((parseFloat(rotAttr) / 60000) * (Math.PI / 180));
      ctx.translate(-(x + w / 2), -(y + h / 2));
    }

    // Geometry type
    const prstGeom = findChild(spPr, "prstGeom");
    const geomName = prstGeom ? prstGeom.getAttribute("prst") : "rect";

    // Fill
    const solidFill = findChild(spPr, "solidFill");
    const hasFill = Boolean(solidFill);
    const fillColor = hasFill ? extractColor(solidFill, DEFAULT_SCHEME_COLORS, "#e2e8f0") : null;

    // Line / Border
    const ln = findChild(spPr, "ln");
    const hasLine = Boolean(ln);
    const strokeColor = hasLine ? extractColor(ln, DEFAULT_SCHEME_COLORS, "#334155") : null;
    const rawW = ln ? ln.getAttribute("w") : null;
    const strokeW = rawW ? Math.max(1, emuToCanvas(rawW, scaleX)) : 1.5;

    if (hasFill || hasLine) {
      if (geomName === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
        if (hasFill) {
          ctx.fillStyle = fillColor;
          ctx.fill();
        }
        if (hasLine) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeW;
          ctx.stroke();
        }
      } else if (geomName === "roundRect") {
        drawRoundedRect(ctx, x, y, w, h, 10);
        if (hasFill) {
          ctx.fillStyle = fillColor;
          ctx.fill();
        }
        if (hasLine) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeW;
          ctx.stroke();
        }
      } else {
        if (hasFill) {
          ctx.fillStyle = fillColor;
          ctx.fillRect(x, y, w, h);
        }
        if (hasLine) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = strokeW;
          ctx.strokeRect(x, y, w, h);
        }
      }
    }

    // Text Content & Annotations (<p:txBody>)
    const txBody = findChild(sp, "txBody");
    if (txBody) {
      const paragraphs = findChildren(txBody, "p");
      const lines = [];
      paragraphs.forEach((p) => {
        const runs = findChildren(p, "r");
        let lineText = "";
        let fontSize = 16;
        let fontBold = false;
        let fontColor = "#0f172a";
        let align = "l";

        const pPr = findChild(p, "pPr");
        if (pPr && pPr.getAttribute("algn")) {
          align = pPr.getAttribute("algn");
        }

        runs.forEach((r) => {
          const t = findChild(r, "t");
          if (t && t.textContent) lineText += t.textContent;
          const rPr = findChild(r, "rPr");
          if (rPr) {
            if (rPr.getAttribute("sz")) {
              fontSize = Math.max(10, Math.round((parseInt(rPr.getAttribute("sz"), 10) / 100) * 1.8));
            }
            if (rPr.getAttribute("b") === "1" || rPr.getAttribute("b") === "true") fontBold = true;
            fontColor = extractColor(rPr, DEFAULT_SCHEME_COLORS, fontColor);
          }
        });

        // Also check direct text nodes inside paragraph
        if (!lineText) {
          const directT = findAllDescendants(p, "t");
          lineText = directT.map((dt) => dt.textContent || "").join(" ").trim();
        }

        if (lineText.trim()) {
          lines.push({ text: lineText.trim(), fontSize, fontBold, fontColor, align });
        }
      });

      if (lines.length > 0) {
        const totalHeight = lines.reduce((acc, l) => acc + l.fontSize * 1.3, 0);
        let startY = y + (h - totalHeight) / 2 + lines[0].fontSize * 0.7;

        lines.forEach((l) => {
          ctx.font = `${l.fontBold ? "bold " : ""}${l.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
          ctx.fillStyle = l.fontColor;
          ctx.textBaseline = "middle";

          if (l.align === "ctr") {
            ctx.textAlign = "center";
            ctx.fillText(l.text, x + w / 2, startY);
          } else if (l.align === "r") {
            ctx.textAlign = "right";
            ctx.fillText(l.text, x + w - 10, startY);
          } else {
            ctx.textAlign = "left";
            ctx.fillText(l.text, x + 10, startY);
          }
          startY += l.fontSize * 1.3;
        });
      }
    }

    if (hasRot) ctx.restore();
  } catch (err) {
    console.warn("[PptFloorRenderer] Shape render skipped:", err);
  }
}

/**
 * Renders a picture element (<p:pic>) onto the canvas
 */
async function renderPicture(ctx, pic, zipFiles, fileKeys, relMap, scaleX, scaleY, parentOffsetX = 0, parentOffsetY = 0) {
  try {
    const blipFill = findChild(pic, "blipFill");
    if (!blipFill) return;
    const blip = findChild(blipFill, "blip");
    if (!blip) return;

    let rEmbed = blip.getAttribute("r:embed") || blip.getAttribute("embed");
    if (!rEmbed) {
      for (let a = 0; a < blip.attributes.length; a++) {
        if (blip.attributes[a].name.endsWith("embed")) {
          rEmbed = blip.attributes[a].value;
          break;
        }
      }
    }
    if (!rEmbed || !relMap[rEmbed]) return;

    const mediaRelPath = relMap[rEmbed];
    const matchedZipKey = fileKeys.find((k) => k.toLowerCase() === mediaRelPath.toLowerCase());
    if (!matchedZipKey || !zipFiles[matchedZipKey]) return;

    const spPr = findChild(pic, "spPr");
    const xfrm = spPr ? findChild(spPr, "xfrm") : null;
    if (!xfrm) return;

    const off = findChild(xfrm, "off");
    const ext = findChild(xfrm, "ext");
    if (!off || !ext) return;

    const px = emuToCanvas(off.getAttribute("x"), scaleX) + parentOffsetX;
    const py = emuToCanvas(off.getAttribute("y"), scaleY) + parentOffsetY;
    const pw = emuToCanvas(ext.getAttribute("cx"), scaleX);
    const ph = emuToCanvas(ext.getAttribute("cy"), scaleY);

    if (pw <= 0 || ph <= 0) return;

    const imgExt = matchedZipKey.toLowerCase().split(".").pop();
    const mime =
      imgExt === "jpg" || imgExt === "jpeg"
        ? "image/jpeg"
        : imgExt === "svg"
        ? "image/svg+xml"
        : imgExt === "gif"
        ? "image/gif"
        : imgExt === "webp"
        ? "image/webp"
        : "image/png";

    const blob = new Blob([zipFiles[matchedZipKey]], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const img = await loadImage(blobUrl);

      const rotAttr = xfrm.getAttribute("rot");
      const hasRot = rotAttr ? parseFloat(rotAttr) !== 0 : false;
      if (hasRot) {
        ctx.save();
        ctx.translate(px + pw / 2, py + ph / 2);
        ctx.rotate((parseFloat(rotAttr) / 60000) * (Math.PI / 180));
        ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
        ctx.restore();
      } else {
        ctx.drawImage(img, px, py, pw, ph);
      }
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch (err) {
    console.warn("[PptFloorRenderer] Picture render skipped:", err);
  }
}

/**
 * Renders PowerPoint table elements (<p:graphicFrame> with <a:tbl>)
 */
function renderTable(ctx, frame, scaleX, scaleY, parentOffsetX = 0, parentOffsetY = 0) {
  try {
    const xfrm = findChild(frame, "xfrm");
    if (!xfrm) return;
    const off = findChild(xfrm, "off");
    const ext = findChild(xfrm, "ext");
    if (!off || !ext) return;

    const x = emuToCanvas(off.getAttribute("x"), scaleX) + parentOffsetX;
    const y = emuToCanvas(off.getAttribute("y"), scaleY) + parentOffsetY;
    const totalW = emuToCanvas(ext.getAttribute("cx"), scaleX);
    const totalH = emuToCanvas(ext.getAttribute("cy"), scaleY);

    const tbl = findDescendant(frame, "tbl");
    if (!tbl) return;

    const tblGrid = findChild(tbl, "tblGrid");
    const gridCols = tblGrid ? findChildren(tblGrid, "gridCol") : [];
    const colWidths = gridCols.map((gc) => emuToCanvas(gc.getAttribute("w"), scaleX));

    // Fallback column widths if not defined
    const colCount = Math.max(1, colWidths.length);
    const avgColW = totalW / colCount;

    const rows = findChildren(tbl, "tr");
    if (!rows.length) return;

    let curY = y;
    rows.forEach((row, rowIdx) => {
      const rowH = emuToCanvas(row.getAttribute("h"), scaleY) || totalH / rows.length;
      const cells = findChildren(row, "tc");
      let curX = x;

      cells.forEach((cell, colIdx) => {
        const cellW = colWidths[colIdx] || avgColW;

        // Cell background fill
        const tcPr = findChild(cell, "tcPr");
        let cellFill = rowIdx === 0 ? "#475569" : rowIdx === rows.length - 1 ? "#eab308" : "#f1f5f9";
        if (tcPr) {
          const solidFill = findChild(tcPr, "solidFill");
          if (solidFill) cellFill = extractColor(solidFill, DEFAULT_SCHEME_COLORS, cellFill);
        }

        ctx.fillStyle = cellFill;
        ctx.fillRect(curX, curY, cellW, rowH);
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 1;
        ctx.strokeRect(curX, curY, cellW, rowH);

        // Cell text
        const txBody = findChild(cell, "txBody");
        if (txBody) {
          const paragraphs = findChildren(txBody, "p");
          let cellText = "";
          paragraphs.forEach((p) => {
            const directT = findAllDescendants(p, "t");
            const tStr = directT.map((dt) => dt.textContent || "").join(" ").trim();
            if (tStr) cellText += (cellText ? "\n" : "") + tStr;
          });

          if (cellText) {
            const isHeader = rowIdx === 0;
            const isFooter = rowIdx === rows.length - 1;
            ctx.font = `${isHeader || isFooter ? "bold " : ""}14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
            ctx.fillStyle = isHeader ? "#ffffff" : isFooter ? "#713f12" : "#0f172a";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(cellText, curX + cellW / 2, curY + rowH / 2);
          }
        }

        curX += cellW;
      });
      curY += rowH;
    });
  } catch (err) {
    console.warn("[PptFloorRenderer] Table render skipped:", err);
  }
}

/**
 * Recursively renders a shape tree (<p:spTree> or <p:grpSp>)
 */
async function renderShapeTree(ctx, container, zipFiles, fileKeys, relMap, scaleX, scaleY, offsetX = 0, offsetY = 0) {
  if (!container || !container.childNodes) return;

  for (let i = 0; i < container.childNodes.length; i++) {
    const node = container.childNodes[i];
    if (node.nodeType !== 1) continue;
    const tag = getLocalName(node);

    if (tag === "sp") {
      renderShape(ctx, node, scaleX, scaleY, offsetX, offsetY);
    } else if (tag === "pic") {
      await renderPicture(ctx, node, zipFiles, fileKeys, relMap, scaleX, scaleY, offsetX, offsetY);
    } else if (tag === "graphicFrame") {
      renderTable(ctx, node, scaleX, scaleY, offsetX, offsetY);
    } else if (tag === "cxnSp") {
      // Connectors / Lines
      try {
        const spPr = findChild(node, "spPr");
        const xfrm = spPr ? findChild(spPr, "xfrm") : null;
        if (xfrm) {
          const off = findChild(xfrm, "off");
          const ext = findChild(xfrm, "ext");
          if (off && ext) {
            const x1 = emuToCanvas(off.getAttribute("x"), scaleX) + offsetX;
            const y1 = emuToCanvas(off.getAttribute("y"), scaleY) + offsetY;
            const x2 = x1 + emuToCanvas(ext.getAttribute("cx"), scaleX);
            const y2 = y1 + emuToCanvas(ext.getAttribute("cy"), scaleY);

            const ln = findChild(spPr, "ln");
            const strokeColor = ln ? extractColor(ln, DEFAULT_SCHEME_COLORS, "#2563eb") : "#2563eb";
            const rawW = ln ? ln.getAttribute("w") : null;
            const strokeW = rawW ? Math.max(1.5, emuToCanvas(rawW, scaleX)) : 2;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeW;
            ctx.lineCap = "round";
            ctx.stroke();
          }
        }
      } catch (_) {}
    } else if (tag === "grpSp") {
      // Nested group
      let grpOffsetX = offsetX;
      let grpOffsetY = offsetY;
      const grpSpPr = findChild(node, "grpSpPr");
      if (grpSpPr) {
        const xfrm = findChild(grpSpPr, "xfrm");
        if (xfrm) {
          const off = findChild(xfrm, "off");
          if (off) {
            grpOffsetX += emuToCanvas(off.getAttribute("x"), scaleX);
            grpOffsetY += emuToCanvas(off.getAttribute("y"), scaleY);
          }
        }
      }
      await renderShapeTree(ctx, node, zipFiles, fileKeys, relMap, scaleX, scaleY, grpOffsetX, grpOffsetY);
    }
  }
}

/**
 * Main function: Renders all slides from a PowerPoint presentation (.pptx or .ppt)
 * @param {File|ArrayBuffer} file - The presentation file
 * @param {Object} options - Configuration options (e.g. targetWidth)
 * @returns {Promise<Array<{ slideIndex: number, name: string, dataUrl: string, width: number, height: number, isLegacyPpt?: boolean }>>}
 */
async function renderPptLocal(file, options = {}) {
  const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const u8 = new Uint8Array(arrayBuffer);
  const targetWidth = options.targetWidth || 2400;

  // ── Format detection ────────────────────────────────────────────────────────
  const isZip = u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04;

  if (isZip) {
    // ── OpenXML Presentation (.pptx) ──────────────────────────────────────────
    if (options.onProgress) {
      options.onProgress(15, "Unzipping PowerPoint archive...");
    }
    const zipFiles = unzipSync(u8);
    const fileKeys = Object.keys(zipFiles).map((k) => k.replace(/\\/g, "/"));

    // 1. Parse presentation slide size from ppt/presentation.xml
    let slideCx = 12192000; // 16:9 standard EMU width
    let slideCy = 6858000; // 16:9 standard EMU height

    const presXmlKey = fileKeys.find((k) => k.toLowerCase().endsWith("ppt/presentation.xml") || k.toLowerCase() === "ppt/presentation.xml");
    if (presXmlKey) {
      try {
        const presXml = strFromU8(zipFiles[presXmlKey]);
        const presDoc = parseXml(presXml);
        const sldSz = findDescendant(presDoc, "sldSz");
        if (sldSz) {
          const cx = parseInt(sldSz.getAttribute("cx"), 10);
          const cy = parseInt(sldSz.getAttribute("cy"), 10);
          if (cx > 0 && cy > 0) {
            slideCx = cx;
            slideCy = cy;
          }
        }
      } catch (e) {
        console.warn("[PptFloorRenderer] Could not parse presentation size, using default 16:9", e);
      }
    }

    const targetHeight = Math.max(800, Math.round((targetWidth * slideCy) / slideCx));
    const scaleX = targetWidth / slideCx;
    const scaleY = targetHeight / slideCy;

    // 2. Discover slides (ppt/slides/slide1.xml, etc.)
    const slideEntries = [];
    fileKeys.forEach((k) => {
      const match = k.match(/(?:^|\/)ppt\/slides\/slide(\d+)\.xml$/i);
      if (match) {
        slideEntries.push({
          index: parseInt(match[1], 10),
          key: k,
        });
      }
    });

    slideEntries.sort((a, b) => a.index - b.index);

    if (slideEntries.length === 0) {
      // Fallback: If no slide XML found, find the SINGLE LARGEST floor plan image in media
      const mediaKeys = fileKeys.filter((k) => k.toLowerCase().includes("ppt/media/"));
      if (mediaKeys.length > 0) {
        let bestKey = mediaKeys[0];
        let maxBytes = 0;
        mediaKeys.forEach((mk) => {
          const bLen = zipFiles[mk]?.length || 0;
          if (bLen > maxBytes) {
            maxBytes = bLen;
            bestKey = mk;
          }
        });

        const mBytes = zipFiles[bestKey];
        const ext = bestKey.toLowerCase().split(".").pop();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : "image/png";
        const blob = new Blob([mBytes], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        try {
          const img = await loadImage(blobUrl);
          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = Math.round((targetWidth * img.height) / img.width);
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          return [
            {
              slideIndex: 1,
              name: "Slide 1",
              dataUrl: canvas.toDataURL("image/png"),
              width: canvas.width,
              height: canvas.height,
            },
          ];
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      }
      throw new Error("No slide contents or floor plan graphics could be found in this PowerPoint presentation.");
    }

    const renderedSlides = [];

    // 3. Render each actual slide
    for (let s = 0; s < slideEntries.length; s++) {
      const entry = slideEntries[s];
      if (options.onProgress) {
        options.onProgress(
          Math.round(20 + (70 * s) / slideEntries.length),
          `Rendering page ${s + 1} of ${slideEntries.length}…`
        );
      }
      // Yield to event loop so loader and UI render smoothly
      await new Promise(r => setTimeout(r, 0));

      const slideXmlStr = strFromU8(zipFiles[entry.key]);
      const slideDoc = parseXml(slideXmlStr);

      // Look for relationship file ppt/slides/_rels/slideX.xml.rels
      const relsKeyPattern = `ppt/slides/_rels/slide${entry.index}.xml.rels`;
      const relsFileKey = fileKeys.find((k) => k.toLowerCase().endsWith(relsKeyPattern.toLowerCase()));
      const relMap = relsFileKey ? parseRelationships(strFromU8(zipFiles[relsFileKey])) : {};

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");

      // Default architectural canvas background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      // Check slide background color
      const bgPr = findDescendant(slideDoc, "bgPr") || findDescendant(slideDoc, "bg");
      if (bgPr) {
        const bgColor = extractColor(bgPr, DEFAULT_SCHEME_COLORS, null);
        if (bgColor) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, targetWidth, targetHeight);
        }
      }

      // Find shape tree (<p:spTree>)
      const spTree = findDescendant(slideDoc, "spTree");
      if (spTree) {
        await renderShapeTree(ctx, spTree, zipFiles, fileKeys, relMap, scaleX, scaleY);
      }

      if (options.onProgress) {
        options.onProgress(
          Math.round(20 + (70 * (s + 1)) / slideEntries.length),
          `Rendered page ${s + 1} of ${slideEntries.length}…`
        );
      }
      const dataUrl = canvas.toDataURL("image/png");
      renderedSlides.push({
        slideIndex: entry.index,
        name: `Slide ${entry.index}`,
        dataUrl,
        width: targetWidth,
        height: targetHeight,
      });
    }

    return renderedSlides;
  } else {
    // ── Legacy PowerPoint Binary Format (.ppt) ────────────────────────────────
    console.log("[PptFloorRenderer] Processing legacy .ppt binary file...");
    if (options.onProgress) {
      options.onProgress(20, "Extracting layouts from binary presentation...");
    }
    const extractedImages = extractImagesFromLegacyPpt(arrayBuffer);

    if (extractedImages.length > 0) {
      if (options.onProgress) {
        options.onProgress(50, "Analyzing vector graphics & dimensions...");
      }
      // Load all candidate images to inspect their true pixel dimensions
      const loadedCandidates = [];
      for (const item of extractedImages) {
        const blob = new Blob([item.data], { type: item.type });
        const blobUrl = URL.createObjectURL(blob);
        try {
          const img = await loadImage(blobUrl);
          // Filter out tiny icons/sprites (e.g. camera icons, logos, stamps < 300x200 or < 80,000 px)
          const pixelArea = img.width * img.height;
          loadedCandidates.push({
            img,
            blobUrl,
            width: img.width,
            height: img.height,
            pixelArea,
            isIcon: img.width < 320 || img.height < 220 || pixelArea < 90000,
          });
        } catch (_) {
          URL.revokeObjectURL(blobUrl);
        }
      }

      // Filter to large layout drawings only (NOT camera icon sprites)
      let floorCandidates = loadedCandidates.filter((c) => !c.isIcon);
      if (floorCandidates.length === 0) {
        // Fallback: pick the single largest image
        floorCandidates = [...loadedCandidates].sort((a, b) => b.pixelArea - a.pixelArea).slice(0, 1);
      }

      // Sort by area descending — the largest image is the primary floor plan
      floorCandidates.sort((a, b) => b.pixelArea - a.pixelArea);

      // ALWAYS return only the main floor plan (1 slide) to avoid generating multiple floors for icons!
      const mainFloor = floorCandidates[0];
      const canvas = document.createElement("canvas");
      const aspect = mainFloor.height / mainFloor.width;
      canvas.width = targetWidth;
      canvas.height = Math.round(targetWidth * aspect);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(mainFloor.img, 0, 0, canvas.width, canvas.height);

      // Clean up blob URLs
      loadedCandidates.forEach((c) => URL.revokeObjectURL(c.blobUrl));

      return [
        {
          slideIndex: 1,
          name: "Slide 1",
          dataUrl: canvas.toDataURL("image/png"),
          width: canvas.width,
          height: canvas.height,
          isLegacyPpt: true,
          embeddedIconCount: loadedCandidates.filter((c) => c.isIcon).length,
        },
      ];
    }

    // Informative fallback canvas if no raster images could be carved
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = Math.round(targetWidth * 0.5625);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 44px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PowerPoint Presentation Imported", canvas.width / 2, canvas.height / 2 - 30);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "24px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText("For complete vector banners, camera markers, and table legends,", canvas.width / 2, canvas.height / 2 + 25);
    ctx.fillText("please save the file as modern .pptx or export as PDF from WPS / PowerPoint.", canvas.width / 2, canvas.height / 2 + 65);

    return [
      {
        slideIndex: 1,
        name: "Slide 1",
        dataUrl: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
        isLegacyPpt: true,
      },
    ];
  }
}

/**
 * Convenience single-slide loader for floor plan import pipeline
 * @param {File|ArrayBuffer} file
 * @param {Object} options
 * @returns {Promise<{ dataUrl: string, width: number, height: number, slides: Array }>}
 */

async function loadDims(dataUrl) {
  const img = await loadImage(dataUrl);
  return { width: img.width, height: img.height };
}

export async function renderPptToImages(file, options = {}) {
  try {
    const fd = new FormData();
    fd.append("file", file);
    const token =
      localStorage.getItem("miradorai_token") ||
      sessionStorage.getItem("miradorai_token") || "";
    const r = await fetch(apiUrl("/designer/convert-ppt"), {
      method: "POST",
      headers: token ? { Authorization: "Bearer " + token } : {},
      body: fd,
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json()).detail || ""; } catch (_) {}
      throw new Error(`server convert failed ${r.status} ${detail}`);
    }
    const { slides } = await r.json();
    if (!slides || !slides.length) throw new Error("no slides returned");
    return await Promise.all(
      slides.map(async (s) => ({ ...s, ...(await loadDims(s.dataUrl)) }))
    );
  } catch (err) {
    console.warn("[PptFloorRenderer] Server conversion failed, using local renderer:", err.message);
    // Fallback: render in the browser (works for .pptx fully, .ppt best-effort)
    const localSlides = await renderPptLocal(file, options);
    if (!localSlides || localSlides.length === 0) {
      throw new Error("PowerPoint import failed: " + err.message);
    }
    return localSlides;
  }
}

export async function renderPptToImage(file, options = {}) {
  const slides = await renderPptToImages(file, options);
  if (!slides || slides.length === 0) {
    throw new Error("Unable to extract slides from PowerPoint presentation.");
  }
  return {
    dataUrl: slides[0].dataUrl,
    width: slides[0].width,
    height: slides[0].height,
    slides,
  };
}