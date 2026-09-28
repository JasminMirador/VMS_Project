/**
 * HtmlFloorRenderer.js
 * ─────────────────────────────────────────────────────────────────
 * Loads an .html file into a hidden iframe and captures it as a
 * 2D PNG data URL using html2canvas.
 *
 * The resulting image can be used directly as a floor plan image
 * in the existing MapView 2D canvas pipeline.
 *
 * Usage:
 *   import { renderHtmlToImage } from "./HtmlFloorRenderer";
 *   const { dataUrl, width, height } = await renderHtmlToImage(file);
 */

import html2canvas from "html2canvas";

/**
 * Render an .html file to a 2D floor plan image.
 *
 * @param {File} file  – the .html File object from an <input>
 * @param {number} size – desired width/height of the output (default 2048)
 * @returns {Promise<{ dataUrl: string, width: number, height: number }>}
 */
export async function renderHtmlToImage(file, size = 2048) {
  const htmlText = await file.text();

  return new Promise((resolve, reject) => {
    // ── 1. Create a hidden iframe ─────────────────────────────────
    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;width:" +
      size + "px;height:" + size +
      "px;border:none;visibility:hidden;pointer-events:none;";
    document.body.appendChild(iframe);

    const cleanup = () => {
      try { document.body.removeChild(iframe); } catch (_) { /* already removed */ }
    };

    // Safety timeout — don't hang forever
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("HTML render timed out after 15 seconds"));
    }, 15000);

    // ── 2. Write HTML content into the iframe ─────────────────────
    iframe.onload = async () => {
      try {
        // Give embedded scripts/styles, network models, and WebGL a long time to settle
        await new Promise((r) => setTimeout(r, 3000));

        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const body = iframeDoc.body;

        if (!body || !body.children.length) {
          clearTimeout(timeout);
          cleanup();
          reject(new Error("HTML file produced an empty document"));
          return;
        }

        // ── 3. Capture with html2canvas ───────────────────────────
        const canvas = await html2canvas(body, {
          width: size,
          height: size,
          scale: 1,
          useCORS: true,
          allowTaint: true,
          backgroundColor: "#ffffff",
          logging: false,
          windowWidth: size,
          windowHeight: size,
        });

        const dataUrl = canvas.toDataURL("image/png");

        clearTimeout(timeout);
        cleanup();
        resolve({ dataUrl, width: size, height: size });
      } catch (err) {
        clearTimeout(timeout);
        cleanup();
        reject(err);
      }
    };

    iframe.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error("Failed to load HTML content into iframe"));
    };

    // Inject a monkey-patch to force WebGL canvases to keep their buffers
    // so html2canvas can actually capture them instead of a blank square.
    const patchScript = `
      <script>
        const originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, attributes) {
          if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
            attributes = attributes || {};
            attributes.preserveDrawingBuffer = true;
          }
          return originalGetContext.call(this, type, attributes);
        };
      </script>
    `;

    // Insert the patch right after the opening <head> tag, or at the start if no <head>
    let patchedHtml = htmlText;
    const headMatch = patchedHtml.match(/<head[^>]*>/i);
    if (headMatch) {
      patchedHtml = patchedHtml.replace(headMatch[0], headMatch[0] + patchScript);
    } else {
      patchedHtml = patchScript + patchedHtml;
    }

    // Write HTML content using srcdoc for same-origin access
    iframe.srcdoc = patchedHtml;
  });
}
