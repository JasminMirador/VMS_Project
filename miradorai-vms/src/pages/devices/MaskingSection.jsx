/**
 * MaskingSection.jsx
 *
 * Drop-in masking panel for CameraFeaturesPage.jsx
 *
 * HOW TO INTEGRATE:
 * 1. Copy the CSS block into the CSS const in CameraFeaturesPage.jsx
 * 2. Import / paste MaskingSection component
 * 3. Add nav item to NAV_SECTIONS (see comment below)
 * 4. Add case "masking": return <MaskingSection {...props} />; in renderContent()
 *
 * NAV item to add inside the "Intelligence" section items array:
 *   { id: "masking", label: "Privacy Masks", icon: "▣", capKey: null },
 *
 * Backend: use masks_router.py (provided separately)
 */

// ── MASKING CSS — append to your existing CSS const ───────────────
export const MASKING_CSS = `
/* ── Masking container ── */
.cfp-mask-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-top: 16px;
  box-shadow: var(--shadow-sm);
}

/* ── Masking canvas ── */
.cfp-mask-wrap {
  position: relative;
  background: #000;
  overflow: hidden;
  user-select: none;
  touch-action: none;
  aspect-ratio: 16 / 9;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cfp-mask-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}
.cfp-mask-canvas.dragging { cursor: grabbing; }
.cfp-mask-canvas.move-mode { cursor: grab; }

/* ── Toolbar ── */
.cfp-mask-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.cfp-mask-tool-group {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-surface);
  padding: 4px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}

.cfp-mask-tool-btn {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  transition: var(--transition);
  display: flex;
  align-items: center;
  gap: 6px;
}

.cfp-mask-tool-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.cfp-mask-tool-btn.active {
  background: var(--bg-active);
  color: var(--teal);
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.cfp-mask-tool-btn.danger { color: var(--red); }
.cfp-mask-tool-btn.danger:hover { background: rgba(255,77,106,0.1); }

.cfp-mask-tool-btn.success {
  background: var(--teal);
  color: white;
}
.cfp-mask-tool-btn.success:hover { background: var(--teal-dim); }
.cfp-mask-tool-btn.success:disabled { opacity: 0.5; cursor: not-allowed; }

.cfp-mask-sep { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }

.cfp-mask-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
  font-style: italic;
}

/* ── List ── */
.cfp-mask-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 24px 0 12px;
  padding: 0 4px;
}

.cfp-mask-list-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.cfp-mask-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.cfp-mask-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: var(--transition);
  cursor: pointer;
  position: relative;
}

.cfp-mask-item:hover {
  border-color: var(--border-light);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.cfp-mask-item.selected {
  border-color: var(--teal);
  background: var(--bg-elevated);
}

.cfp-mask-item-color {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 2px solid rgba(255,255,255,0.1);
}

.cfp-mask-item-info {
  flex: 1;
  min-width: 0;
}

.cfp-mask-item-name-input {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  width: 100%;
  padding: 2px 0;
  outline: none;
}

.cfp-mask-item-name-input:focus {
  color: var(--teal);
}

.cfp-mask-item-meta {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}

.cfp-mask-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cfp-mask-item-del {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: var(--transition);
}

.cfp-mask-item-del:hover {
  background: rgba(255,77,106,0.1);
  color: var(--red);
  border-color: rgba(255,77,106,0.2);
}

/* ── Instructions ── */
.cfp-mask-info-card {
  background: var(--teal-subtle);
  border: 1px solid var(--teal-dim);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  margin-top: 24px;
}

.cfp-mask-info-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--teal);
  margin-bottom: 8px;
}

.cfp-mask-info-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cfp-mask-info-item {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: flex;
  gap: 8px;
}

.cfp-mask-info-num {
  font-weight: 700;
  color: var(--teal);
  opacity: 0.6;
}

.cfp-mask-saving {
  position: absolute;
  top: 16px;
  right: 16px;
  background: var(--bg-surface);
  border: 1px solid var(--teal);
  color: var(--teal);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  animation: slideInRight 0.3s ease;
}

@keyframes slideInRight {
  from { transform: translateX(20px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
.cfp-mask-wrap video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ── Premium Modal Popup ── */
.mp-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: mpFadeIn 0.2s ease;
}

.mp-modal {
  background: #0f141c;
  border: 1px solid rgba(20, 184, 166, 0.2);
  box-shadow: 0 20px 40px rgba(0,0,0,0.5), 0 0 30px rgba(20, 184, 166, 0.1);
  border-radius: 16px;
  width: 420px;
  max-width: 90vw;
  overflow: hidden;
  animation: mpScaleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes mpFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes mpScaleIn {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.mp-modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mp-modal-title {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  margin: 0;
  letter-spacing: -0.2px;
}

.mp-modal-close {
  background: transparent;
  border: none;
  color: rgba(255,255,255,0.4);
  font-size: 14px;
  cursor: pointer;
  padding: 4px;
  transition: color 0.15s;
}

.mp-modal-close:hover {
  color: var(--teal);
}

.mp-modal-body {
  padding: 20px;
}

.mp-form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mp-form-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.mp-form-input {
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  color: #fff;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  width: 100%;
  box-sizing: border-box;
}

.mp-form-input:focus {
  border-color: var(--teal);
  box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.15);
}

.mp-modal-footer {
  padding: 14px 20px;
  background: rgba(255,255,255,0.01);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.mp-btn-cancel {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.mp-btn-cancel:hover {
  background: rgba(255,255,255,0.1);
  color: #fff;
}

.mp-btn-save {
  background: var(--teal);
  border: none;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 8px 18px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(20, 184, 166, 0.25);
}

.mp-btn-save:hover {
  background: var(--teal-dim);
  box-shadow: 0 6px 16px rgba(20, 184, 166, 0.4);
}
`;
import { useState, useEffect, useRef, useCallback } from "react";
import WebRTCPlayer from "../../components/shared/WebRTCPlayer_MediaMTX";

const API = import.meta.env.VITE_API_URL;
const CANVAS_W = 640;
const CANVAS_H = 360;

// ── MASK COLORS ───────────────────────────────────────────────────
const MASK_COLORS = [
  { fill: "rgba(59,130,246,0.3)",  stroke: "#60a5fa", label: "Deep Sea" },
];

export default function MaskingSection({ device, showToast, onMasksChange }) {
  const canvasRef = useRef(null);
  const dragRef = useRef({ active: false, maskId: null, ptIdx: null });
  const wsUrl = device?.ws_url || null;

  const [masks, setMasks] = useState([]);
  const [savedMasks, setSavedMasks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState("draw"); // "draw" | "select"
  const [draftPts, setDraftPts] = useState([]);
  const [colorIdx, setColorIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [applyToRecordings, setApplyToRecordings] = useState(true);

  // Popup Modal States
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingPts, setPendingPts] = useState(null);
  const [newMaskName, setNewMaskName] = useState("");

  // Propagate masks count to parent
  useEffect(() => {
    if (onMasksChange) {
      onMasksChange(device.ip, masks.length);
    }
  }, [masks.length, device.ip, onMasksChange]);

  // Load masks
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}`);
        const data = await res.json();
        const loadedMasks = data.masks || [];
        setMasks(loadedMasks);
        setSavedMasks(loadedMasks);
        if (data.apply_to_recordings !== undefined) {
          setApplyToRecordings(data.apply_to_recordings);
        }
      } catch (e) {
        console.error("[MASKS] Load failed:", e);
      }
      setLoading(false);
    })();
  }, [device.ip]);

  // Redraw
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // No background here — WebRTCPlayer is underneath
    // But we still draw diagnostic overlays if needed
    
    // Technical Corner Brackets (Subtle)
    const B = 18, T = 1.5, C = "rgba(255,255,255,0.2)";
    ctx.strokeStyle = C; ctx.lineWidth = T;
    // TL
    ctx.beginPath(); ctx.moveTo(10, 10+B); ctx.lineTo(10, 10); ctx.lineTo(10+B, 10); ctx.stroke();
    // TR
    ctx.beginPath(); ctx.moveTo(CANVAS_W-10-B, 10); ctx.lineTo(CANVAS_W-10, 10); ctx.lineTo(CANVAS_W-10, 10+B); ctx.stroke();
    // BL
    ctx.beginPath(); ctx.moveTo(10, CANVAS_H-10-B); ctx.lineTo(10, CANVAS_H-10); ctx.lineTo(10+B, CANVAS_H-10); ctx.stroke();
    // BR
    ctx.beginPath(); ctx.moveTo(CANVAS_W-10-B, CANVAS_H-10); ctx.lineTo(CANVAS_W-10, CANVAS_H-10); ctx.lineTo(CANVAS_W-10, CANVAS_H-10-B); ctx.stroke();

    // Center Crosshair (Very subtle)
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(CANVAS_W/2 - 10, CANVAS_H/2); ctx.lineTo(CANVAS_W/2 + 10, CANVAS_H/2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CANVAS_W/2, CANVAS_H/2 - 10); ctx.lineTo(CANVAS_W/2, CANVAS_H/2 + 10); ctx.stroke();

    // Draw saved masks
    masks.forEach(mask => {
      if (!mask.points?.length) return;
      const col = MASK_COLORS[mask.color_idx ?? 0];
      const isSel = mask.id === selectedId;

      ctx.beginPath();
      mask.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.closePath();

      if (!mask.enabled) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fill();
        // Hatching
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 1;
        for (let i = -CANVAS_H; i < CANVAS_W + CANVAS_H; i += 15) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + CANVAS_H, CANVAS_H); ctx.stroke();
        }
        ctx.restore();
        ctx.beginPath();
        mask.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.closePath();
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = col.fill;
        ctx.fill();
        ctx.strokeStyle = isSel ? "#fff" : col.stroke;
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.stroke();
      }

      // Mask label
      const cx = mask.points.reduce((s, [x]) => s + x, 0) / mask.points.length;
      const cy = mask.points.reduce((s, [, y]) => s + y, 0) / mask.points.length;
      ctx.fillStyle = isSel ? "#fff" : "rgba(255,255,255,0.8)";
      ctx.font = `${isSel ? "600" : "500"} 10px 'DM Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(mask.name.toUpperCase(), cx, cy);

      // Vertex dots
      if (isSel && mode === "select") {
        mask.points.forEach(([x, y]) => {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fillStyle = col.stroke;
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }
    });

    // Draw draft polygon
    if (draftPts.length > 0) {
      const col = MASK_COLORS[colorIdx];
      ctx.beginPath();
      draftPts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.strokeStyle = col.stroke;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      draftPts.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, i === 0 ? 7 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? col.stroke : col.fill;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }
  }, [masks, selectedId, draftPts, colorIdx, mode]);

  useEffect(() => { redraw(); }, [redraw]);

  const getXY = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const sx = CANVAS_W / r.width, sy = CANVAS_H / r.height;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return [Math.round((cx - r.left) * sx), Math.round((cy - r.top) * sy)];
  };

  const promptCreateMask = (points) => {
    setPendingPts(points);
    setNewMaskName(`Region ${masks.length + 1}`);
    setShowCreateModal(true);
  };

  const handleSaveModal = async () => {
    if (!pendingPts) return;
    const finalName = newMaskName.trim() || `Region ${masks.length + 1}`;
    if (!/^[a-zA-Z0-9 _.\-]+$/.test(finalName)) {
      showToast("Invalid characters in region name.", "error");
      return;
    }
    const m = {
      id: `mask_${Date.now()}`,
      name: newMaskName.trim() || `Region ${masks.length + 1}`,
      points: pendingPts,
      color_idx: colorIdx,
      enabled: true
    };
    const updatedMasks = [...masks, m];
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}/all`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masks: updatedMasks, apply_to_recordings: applyToRecordings }),
      });
      if (res.ok) {
        setMasks(updatedMasks);
        setSavedMasks(updatedMasks);
        setSelectedId(m.id);
        showToast(`"${m.name}" saved successfully`, "success");
      } else {
        throw new Error("Save failed");
      }
    } catch {
      showToast("Save failed", "error");
    } finally {
      setSaving(false);
      setShowCreateModal(false);
      setPendingPts(null);
    }
  };

  const handlePointerDown = (e) => {
    const [x, y] = getXY(e);
    if (mode === "select") {
      const mask = masks.find(m => m.id === selectedId);
      if (mask) {
        const pi = mask.points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 10);
        if (pi !== -1) { dragRef.current = { active: true, maskId: selectedId, ptIdx: pi }; return; }
      }
      const hit = [...masks].reverse().find(m => pip([x, y], m.points));
      setSelectedId(hit?.id || null);
      return;
    }
    if (mode === "draw") {
      if (draftPts.length >= 3) {
        const [fx, fy] = draftPts[0];
        if (Math.hypot(fx - x, fy - y) < 14) { finalizeMask(); return; }
      }
      
      const newPts = [...draftPts, [x, y]];
      if (newPts.length === 4) {
        setDraftPts([]);
        promptCreateMask(newPts);
      } else {
        setDraftPts(newPts);
      }
    }
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.active) return;
    const [x, y] = getXY(e);
    const { maskId, ptIdx } = dragRef.current;
    setMasks(prev => prev.map(m =>
      m.id === maskId ? { ...m, points: m.points.map((p, i) => i === ptIdx ? [x, y] : p) } : m
    ));
  };

  const handlePointerUp = () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
  };

  const finalizeMask = () => {
    if (draftPts.length < 3) { showToast("Need at least 3 points", "error"); setDraftPts([]); return; }
    const pts = draftPts;
    setDraftPts([]);
    promptCreateMask(pts);
  };

  const deleteMask = async (id) => {
    const updatedMasks = masks.filter(m => m.id !== id);
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}/all`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masks: updatedMasks, apply_to_recordings: applyToRecordings }),
      });
      if (res.ok) {
        setMasks(updatedMasks);
        setSavedMasks(updatedMasks);
        showToast("Region deleted successfully", "success");
      } else {
        throw new Error("Delete failed");
      }
    } catch {
      showToast("Delete failed", "error");
    } finally {
      setSaving(false);
      if (selectedId === id) setSelectedId(null);
    }
  };

  const toggleMask = async (id) => {
    const updatedMasks = masks.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m);
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}/all`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masks: updatedMasks, apply_to_recordings: applyToRecordings }),
      });
      if (res.ok) {
        setMasks(updatedMasks);
        setSavedMasks(updatedMasks);
        showToast("Region status updated", "success");
      } else {
        throw new Error("Update failed");
      }
    } catch {
      showToast("Update failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleApplyToRecordings = async () => {
    const newVal = !applyToRecordings;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}/all`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masks: masks, apply_to_recordings: newVal }),
      });
      if (res.ok) {
        setApplyToRecordings(newVal);
        showToast(newVal ? "Masks will be applied to recordings" : "Masks hidden in recordings", "success");
      } else {
        throw new Error("Update failed");
      }
    } catch {
      showToast("Update failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const renameMask = (id, name) => setMasks(p => p.map(m => m.id === id ? { ...m, name } : m));
  
  const commitRename = async (id) => {
    const mask = masks.find(m => m.id === id);
    if (mask && !/^[a-zA-Z0-9 _.\-]+$/.test(mask.name.trim())) {
      showToast("Invalid characters in region name.", "error");
      setMasks(savedMasks); // revert
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/masks/${encodeURIComponent(device.ip)}/all`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ masks }),
      });
      if (res.ok) {
        setSavedMasks(masks);
        showToast("Region renamed successfully", "success");
      } else {
        throw new Error("Rename failed");
      }
    } catch {
      showToast("Rename failed", "error");
    } finally {
      setSaving(false);
    }
  };

  function pip([px, py], pts = []) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const enabledCount = masks.filter(m => m.enabled).length;
  const totalVertices = masks.reduce((s, m) => s + (m.points?.length || 0), 0);
  const hasChanges = JSON.stringify(masks) !== JSON.stringify(savedMasks);

  return (
    <>
      <div className="mp-mask-card">
        {/* Toolbar */}
        <div className="mp-toolbar">
          <div className="mp-tool-group">
            <button
              className={`mp-tool-btn ${mode === "draw" ? "active" : ""}`}
              onClick={() => { setMode("draw"); setSelectedId(null); }}
            >
              Draw
            </button>
            <button
              className={`mp-tool-btn ${mode === "select" ? "active" : ""}`}
              onClick={() => { setMode("select"); setDraftPts([]); }}
            >
              Select
            </button>
          </div>


          {/* Draft Actions */}
          {draftPts.length > 0 && (
            <div className="mp-tool-group">
              <button
                className="mp-tool-btn success"
                onClick={finalizeMask}
                disabled={draftPts.length < 3}
              >
                Close Polygon ({draftPts.length})
              </button>
              <button className="mp-tool-btn" onClick={() => setDraftPts(p => p.slice(0, -1))}>
                Undo
              </button>
              <button className="mp-tool-btn danger" onClick={() => setDraftPts([])}>
                Cancel
              </button>
            </div>
          )}



          <div className="mp-toolbar-hint">
            {mode === "draw"
              ? draftPts.length === 0
                ? "Click canvas to start drawing"
                : `${draftPts.length} points · Click 1st point to close`
              : "Drag vertices to reshape masks"}
          </div>
        </div>

        {/* Viewport (Video + Canvas) */}
        <div className="mp-viewport">
          {/* LIVE STREAM */}
          <div className="mp-video-layer">
            {device?.stream_key || wsUrl ? (
              <WebRTCPlayer streamKey={device.stream_key} cameraId={device.id} />
            ) : (
              <div className="mp-video-placeholder">
                <div className="mp-placeholder-icon"></div>
                <div>Live stream unavailable</div>
                <div className="mp-placeholder-sub">Snapshot fallback disabled</div>
              </div>
            )}
          </div>

          {/* MASK CANVAS */}
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="mp-canvas"
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
          />

          {/* Corner Labels */}
          <div className="mp-corner-label tl">A1</div>
          <div className="mp-corner-label tr">{CANVAS_W}×{CANVAS_H}</div>
          <div className="mp-corner-label bl">MASK EDITOR</div>
          <div className="mp-corner-label br">{device.ip}</div>

          {saving && <div className="mp-syncing">Synchronizing…</div>}
        </div>

        {/* Stats Strip */}
        <div className="mp-stats">
          <div className="mp-stat">
            <span className="mp-stat-label">Total Regions</span>
            <span className="mp-stat-val teal">{masks.length}</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-label">Active</span>
            <span className="mp-stat-val">{enabledCount}</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-label">Inactive</span>
            <span className="mp-stat-val">{masks.length - enabledCount}</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-label">Total Vertices</span>
            <span className="mp-stat-val">{totalVertices}</span>
          </div>
          <div className="mp-stat">
            <span className="mp-stat-label">Mode</span>
            <span className="mp-stat-val" style={{ textTransform: "uppercase", fontSize: 11 }}>{mode}</span>
          </div>
        </div>
      </div>

      {/* Regions List */}
      <div className="mp-list-head">
        <h3 className="mp-list-title">Defined Regions ({masks.length})</h3>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <label className="mp-toggle" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Apply to Recordings</span>
            <input 
              type="checkbox" 
              checked={applyToRecordings} 
              onChange={toggleApplyToRecordings}
            />
            <span className="mp-toggle-track">
              <span className="mp-toggle-thumb" />
            </span>
          </label>

          {selectedId && (
            <button className="mp-tool-btn danger" style={{ height: 26, fontSize: 11 }} onClick={() => deleteMask(selectedId)}>
              Delete Selected
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="mp-list-loading">Fetching registry data…</div>
      ) : masks.length === 0 ? (
        <div className="mp-list-empty">
          No regions defined yet.
          <span>Switch to Draw mode to begin.</span>
        </div>
      ) : (
        <div className="mp-list-grid">
          {masks.map(mask => {
            const col = MASK_COLORS[mask.color_idx ?? 0];
            return (
              <div
                key={mask.id}
                className={`mp-region-card ${selectedId === mask.id ? "selected" : ""}`}
                onClick={() => setSelectedId(mask.id)}
              >
                <div className="mp-card-top">
                  <input
                    className="mp-card-input"
                    value={mask.name}
                    onChange={e => renameMask(mask.id, e.target.value)}
                    onBlur={() => commitRename(mask.id)}
                    onClick={e => e.stopPropagation()}
                  />
                  <label className="mp-toggle" onClick={e => e.stopPropagation()}>
                    <input 
                      type="checkbox" 
                      checked={!!mask.enabled} 
                      onChange={() => toggleMask(mask.id)}
                    />
                    <span className="mp-toggle-track">
                      <span className="mp-toggle-thumb" />
                    </span>
                  </label>
                </div>
                <div className="mp-card-meta">
                  <span>{mask.points?.length} vertices · {mask.enabled ? "Active" : "Disabled"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreateModal && (
        <div className="mp-modal-overlay">
          <div className="mp-modal">
            <div className="mp-modal-header">
              <h3 className="mp-modal-title">Create Privacy Mask</h3>
              <button className="mp-modal-close" onClick={() => { setShowCreateModal(false); setPendingPts(null); }}>✕</button>
            </div>
            <div className="mp-modal-body">
              <div className="mp-form-group">
                <label className="mp-form-label">Region Name</label>
                <input
                  type="text"
                  className="mp-form-input"
                  placeholder="e.g., Cash Counter, Entry Door"
                  value={newMaskName}
                  onChange={e => setNewMaskName(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="mp-modal-footer">
              <button className="mp-btn-cancel" onClick={() => { setShowCreateModal(false); setPendingPts(null); }}>
                Cancel
              </button>
              <button className="mp-btn-save" onClick={handleSaveModal}>
                Save Region
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
