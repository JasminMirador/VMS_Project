import React, { useState, useEffect } from "react";
import { getPixelDistance, toMeters, validateCalibrationReferences } from "./LayoutCalibrationEngine";

const REF_COLORS = [
  "#f59e0b", // Amber
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#a855f7", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#84cc16", // Lime
];

/**
 * CalibrationPanel
 * 
 * Floating glassmorphic calibration control panel for MapView.
 * Provides intuitive, non-technical workflows for both Standard and Advanced layout calibrations.
 */
export default function CalibrationPanel({
  isOpen,
  calibType = "standard",
  onSelectCalibType,
  references = [],
  activeRefId = null,
  isDrawingRef = false,
  showPreviewGrid = false,
  onTogglePreviewGrid,
  onStartAddRef,
  onUpdateRefDistance,
  onDeleteRef,
  onSelectRef,
  onApplyCalibration,
  onClearCalibration,
  onClose,
  imageDimensions = { width: 1000, height: 1000 },
}) {
  const [editingRefId, setEditingRefId] = useState(null);
  const [editDistanceVal, setEditDistanceVal] = useState("");
  const [editUnit, setEditUnit] = useState("meters");
  const [standardDistance, setStandardDistance] = useState("10.00");
  const [standardUnit, setStandardUnit] = useState("meters");

  // Validate references
  const validation = validateCalibrationReferences(references, imageDimensions);

  // Sync standard input with first reference if present
  useEffect(() => {
    if (calibType === "standard" && references.length > 0) {
      const r = references[0];
      if (r.realDistance) setStandardDistance(String(r.realDistance));
      if (r.unit) setStandardUnit(r.unit);
    }
  }, [calibType, references]);

  if (!isOpen) return null;

  return (
    <div className="mv-calib-panel" onClick={(e) => e.stopPropagation()}>
      {/* ── Panel Header ── */}
      <div className="mv-calib-panel__header">
        <div className="mv-calib-panel__title-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" className="mv-calib-panel__icon">
            <path d="M2 12h20M2 12l5-5M2 12l5 5M22 12l-5-5M22 12l5 5M12 2v20M12 2l-5 5M12 2l5 5M12 22l-5-5M12 22l5 5" />
          </svg>
          <span className="mv-calib-panel__title">Calibrate Layout</span>
        </div>
        <button className="mv-calib-panel__close" onClick={onClose} title="Close Calibration Panel">
          ✕
        </button>
      </div>

      {/* ── Calibration Type Radio Cards ── */}
      <div className="mv-calib-types">
        {/* Standard Calibration */}
        <div
          className={`mv-calib-type-card ${calibType === "standard" ? "mv-calib-type-card--active" : ""}`}
          onClick={() => onSelectCalibType("standard")}
        >
          <div className="mv-calib-type-card__radio">
            <span className={`mv-radio-dot ${calibType === "standard" ? "active" : ""}`} />
          </div>
          <div className="mv-calib-type-card__info">
            <div className="mv-calib-type-card__label">Standard Calibration</div>
            <div className="mv-calib-type-card__desc">Use one known distance for a uniform floor plan.</div>
          </div>
        </div>

        {/* Advanced Calibration */}
        <div
          className={`mv-calib-type-card ${calibType === "advanced" ? "mv-calib-type-card--active" : ""}`}
          onClick={() => onSelectCalibType("advanced")}
        >
          <div className="mv-calib-type-card__radio">
            <span className={`mv-radio-dot ${calibType === "advanced" ? "active" : ""}`} />
          </div>
          <div className="mv-calib-type-card__info">
            <div className="mv-calib-type-card__label">Advanced Calibration</div>
            <div className="mv-calib-type-card__desc">Use multiple known references for a distorted layout.</div>
          </div>
        </div>
      </div>

      {/* ── Content: Standard Calibration Workflow ── */}
      {calibType === "standard" && (
        <div className="mv-calib-content">
          <div className="mv-calib-guide">
            {references.length === 0 ? (
              <div className="mv-calib-guide__step">
                <span className="mv-calib-step-num">1</span>
                <span>Click and drag over a distance you know on the floor plan.</span>
              </div>
            ) : (
              <div className="mv-calib-guide__step">
                <span className="mv-calib-step-num">✓</span>
                <span>Measurement line drawn ({Math.round(getPixelDistance(references[0].start, references[0].end))} px). Enter real-world distance below:</span>
              </div>
            )}
          </div>

          {references.length > 0 && (
            <div className="mv-calib-form-row">
              <label className="mv-calib-label">Known Distance:</label>
              <div className="mv-calib-input-group">
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="mv-calib-input"
                  value={standardDistance}
                  onChange={(e) => {
                    setStandardDistance(e.target.value);
                    if (references[0]) {
                      onUpdateRefDistance(references[0].id, e.target.value, standardUnit);
                    }
                  }}
                  placeholder="e.g. 12.00"
                />
                <select
                  className="mv-calib-select"
                  value={standardUnit}
                  onChange={(e) => {
                    setStandardUnit(e.target.value);
                    if (references[0]) {
                      onUpdateRefDistance(references[0].id, standardDistance, e.target.value);
                    }
                  }}
                >
                  <option value="meters">meters</option>
                  <option value="feet">feet</option>
                </select>
              </div>
            </div>
          )}

          {references.length > 0 && Number(standardDistance) > 0 && (
            <div className="mv-calib-ppm-badge">
              <span>Scale:</span>
              <strong>
                {(getPixelDistance(references[0].start, references[0].end) / toMeters(standardDistance, standardUnit)).toFixed(2)} px = 1.0 m
              </strong>
            </div>
          )}
        </div>
      )}

      {/* ── Content: Advanced Calibration Workflow ── */}
      {calibType === "advanced" && (
        <div className="mv-calib-content">
          <div className="mv-calib-helper-banner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>{validation.helper}</span>
          </div>

          {/* Reference List */}
          <div className="mv-calib-ref-list">
            <div className="mv-calib-ref-list__header">
              <span>Reference Measurements ({references.length})</span>
              <button
                className="mv-calib-btn-sm"
                onClick={onStartAddRef}
                title="Draw another reference line on the floor plan"
              >
                + Add Reference
              </button>
            </div>

            {references.length === 0 ? (
              <div className="mv-calib-empty-hint">
                <span>Click and drag on the layout to draw Reference 1.</span>
              </div>
            ) : (
              references.map((ref, idx) => {
                const isEditing = editingRefId === ref.id;
                const isActive = activeRefId === ref.id;
                const dPx = Math.round(getPixelDistance(ref.start, ref.end));
                const col = REF_COLORS[idx % REF_COLORS.length];

                return (
                  <div
                    key={ref.id || idx}
                    className={`mv-calib-ref-item ${isActive ? "mv-calib-ref-item--active" : ""}`}
                    onClick={() => onSelectRef(ref.id)}
                  >
                    <div className="mv-calib-ref-item__left">
                      <span className="mv-calib-ref-item__dot" style={{ background: col }} />
                      <div className="mv-calib-ref-item__meta">
                        <span className="mv-calib-ref-item__name">Reference {idx + 1}</span>
                        <span className="mv-calib-ref-item__pixels">{dPx} px</span>
                      </div>
                    </div>

                    <div className="mv-calib-ref-item__right">
                      {isEditing ? (
                        <div className="mv-calib-inline-edit" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            className="mv-calib-input-xs"
                            value={editDistanceVal}
                            onChange={(e) => setEditDistanceVal(e.target.value)}
                            autoFocus
                          />
                          <select
                            className="mv-calib-select-xs"
                            value={editUnit}
                            onChange={(e) => setEditUnit(e.target.value)}
                          >
                            <option value="meters">m</option>
                            <option value="feet">ft</option>
                          </select>
                          <button
                            className="mv-calib-btn-xs success"
                            onClick={() => {
                              if (Number(editDistanceVal) > 0) {
                                onUpdateRefDistance(ref.id, editDistanceVal, editUnit);
                              }
                              setEditingRefId(null);
                            }}
                          >
                            ✓
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="mv-calib-ref-item__dist">
                            {Number(ref.realDistance || 0).toFixed(2)} {ref.unit === "feet" ? "ft" : "m"}
                          </span>
                          <button
                            className="mv-calib-action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingRefId(ref.id);
                              setEditDistanceVal(String(ref.realDistance || "10.00"));
                              setEditUnit(ref.unit || "meters");
                            }}
                            title="Edit known distance"
                          >
                            Edit
                          </button>
                          <button
                            className="mv-calib-action-btn danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteRef(ref.id);
                            }}
                            title="Delete reference"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Validation & Quality Readout */}
          {references.length > 0 && (
            <div className="mv-calib-status-card">
              <div className="mv-calib-status-row">
                <span className="mv-calib-status-label">Calibration Quality:</span>
                <span className={`mv-calib-quality-tag ${validation.quality}`}>
                  {validation.quality === "excellent" ? "● Excellent" : validation.quality === "good" ? "● Good" : "▲ Needs More Data"}
                </span>
              </div>
              <div className="mv-calib-status-row">
                <span className="mv-calib-status-label">Reference Distribution:</span>
                <span className="mv-calib-distrib-tag">
                  {validation.distribution === "excellent" ? "Uniform (4 Quadrants)" : validation.distribution === "good" ? "Distributed" : "Single Area"}
                </span>
              </div>
            </div>
          )}

          {/* Preview Grid Toggle */}
          <div className="mv-calib-preview-toggle">
            <label className="mv-calib-checkbox-label">
              <input
                type="checkbox"
                checked={showPreviewGrid}
                onChange={(e) => onTogglePreviewGrid(e.target.checked)}
              />
              <span>Show Deformed Preview Metric Grid</span>
            </label>
          </div>
        </div>
      )}

      {/* ── Action Buttons Footer ── */}
      <div className="mv-calib-panel__footer">
        <div className="mv-calib-footer-left">
          <button
            className="mv-calib-btn mv-calib-btn--danger-link"
            onClick={onClearCalibration}
            title="Reset calibration to uncalibrated default"
          >
            Clear Calibration
          </button>
        </div>

        <div className="mv-calib-footer-right">
          <button className="mv-calib-btn mv-calib-btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="mv-calib-btn mv-calib-btn--primary"
            onClick={onApplyCalibration}
            disabled={references.length === 0}
          >
            Apply Calibration
          </button>
        </div>
      </div>
    </div>
  );
}
