import React, { useState, useEffect, useMemo, useRef } from "react";
import "./AutoPlacementModal.css";
import { runAutoPlacementAsync } from "./AutoPlacementEngine";
import { fetchCameraModels, CAMERA_DB, BRANDS } from "./CameraModelDB";

export default function AutoPlacementModal({
  isOpen,
  onClose,
  walls = [],
  zones = [],
  floorImg = null,
  ppm = 25.0,
  availableBrands = [],
  availableCameraDB = [],
  onPreviewPlacement,
  onApplyPlacement,
  onCancelPreview,
  onClearCameras,
  initialResult = null
}) {
  // Master camera database
  const masterCameraDB = useMemo(() => {
    const list = [...CAMERA_DB];
    const existingKeys = new Set(list.map(c => (c.id || `${c.brand}_${c.model}`).toLowerCase()));
    if (Array.isArray(availableCameraDB) && availableCameraDB.length > 0) {
      for (const cam of availableCameraDB) {
        if (!cam) continue;
        const key = (cam.id || `${cam.brand}_${cam.model}`).toLowerCase();
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          list.push(cam);
        }
      }
    }
    return list;
  }, [availableCameraDB]);

  // All brands available derived immediately from master database
  const allBrands = useMemo(() => {
    if (Array.isArray(availableBrands) && availableBrands.length > 0) {
      return availableBrands;
    }
    const bSet = new Set(masterCameraDB.map(c => c.brand).filter(Boolean));
    return Array.from(bSet).sort();
  }, [availableBrands, masterCameraDB]);

  // Selected brands
  const [selectedBrands, setSelectedBrands] = useState([]);
  const [brandSearch, setBrandSearch] = useState("");

  // All camera models loaded for currently selected brands
  const [loadedCameras, setLoadedCameras] = useState([]);
  // Selected model IDs
  const [selectedModelIds, setSelectedModelIds] = useState([]);
  const [modelSearch, setModelSearch] = useState("");

  // Replace existing cameras toggle
  const [replaceExisting, setReplaceExisting] = useState(true);

  // Placement Mode & Coverage Target
  const [mode, setMode] = useState("automatic"); // "automatic" | "specify"
  const [specifiedCount, setSpecifiedCount] = useState(4);
  const [targetCoverage, setTargetCoverage] = useState(100); // 90 | 95 | 100

  // Calculation & Progress State
  const [isCalculating, setIsCalculating] = useState(false);
  const [progress, setProgress] = useState({ step: 0, percent: 0, message: "" });
  const [placementResult, setPlacementResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Room breakdown expansion toggle for large space counts
  const [showAllRooms, setShowAllRooms] = useState(false);

  // AbortController ref for instant cancellation
  const abortControllerRef = useRef(null);

  // Reset or load initial report whenever opened
  useEffect(() => {
    if (isOpen) {
      setIsCalculating(false);
      setProgress({ step: 0, percent: 0, message: "" });
      setErrorMsg("");
      setBrandSearch("");
      setModelSearch("");
      setShowAllRooms(false);

      if (initialResult) {
        setPlacementResult(initialResult);
        if (initialResult.selectedModelPool && initialResult.selectedModelPool.length > 0) {
          const brands = [...new Set(initialResult.selectedModelPool.map(m => m.brand).filter(Boolean))];
          const modelIds = initialResult.selectedModelPool.map(m => m.id).filter(Boolean);
          if (brands.length > 0) setSelectedBrands(brands);
          if (modelIds.length > 0) setSelectedModelIds(modelIds);
        }
      } else {
        setSelectedBrands([]);
        setSelectedModelIds([]);
        setLoadedCameras([]);
        setPlacementResult(null);
      }
    }
  }, [isOpen, initialResult]);

  // Instant zero-latency camera model population whenever selected brands change
  useEffect(() => {
    if (selectedBrands.length === 0) {
      setLoadedCameras([]);
      setSelectedModelIds([]);
      return;
    }

    const brandSet = new Set(selectedBrands.map(b => b.trim().toLowerCase()));
    const matching = masterCameraDB.filter(c => c.brand && brandSet.has(c.brand.trim().toLowerCase()));

    // Deduplicate
    const unique = [];
    const seen = new Set();
    for (const c of matching) {
      const key = c.id || `${c.brand}_${c.model}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(c);
      }
    }

    setLoadedCameras(unique);

    // Automatically select all models for the selected brands so user can calculate right away
    setSelectedModelIds(unique.map(c => c.id));
  }, [selectedBrands, masterCameraDB]);

  // Cleanup & abort on unmount or close
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Filtered Brands List by search
  const filteredBrandList = useMemo(() => {
    if (!brandSearch.trim()) return allBrands;
    return allBrands.filter(b => b.toLowerCase().includes(brandSearch.toLowerCase()));
  }, [allBrands, brandSearch]);

  // Filtered Models List by search
  const filteredModelList = useMemo(() => {
    if (!modelSearch.trim()) return loadedCameras;
    const q = modelSearch.toLowerCase();
    return loadedCameras.filter(m =>
      (m.model || "").toLowerCase().includes(q) ||
      (m.brand || "").toLowerCase().includes(q) ||
      (m.type || "").toLowerCase().includes(q) ||
      (m.series || "").toLowerCase().includes(q)
    );
  }, [loadedCameras, modelSearch]);

  // Toggle single brand
  const handleToggleBrand = (brand) => {
    setSelectedBrands(prev =>
      prev.includes(brand) ? prev.filter(b => b !== brand) : [...prev, brand]
    );
  };

  // Select all brands
  const handleSelectAllBrands = () => {
    setSelectedBrands([...allBrands]);
  };

  // Clear all brands
  const handleClearAllBrands = () => {
    setSelectedBrands([]);
    setSelectedModelIds([]);
    setLoadedCameras([]);
  };

  // Toggle single model
  const handleToggleModel = (modelId) => {
    setSelectedModelIds(prev =>
      prev.includes(modelId) ? prev.filter(id => id !== modelId) : [...prev, modelId]
    );
  };

  // Select all models
  const handleSelectAllModels = () => {
    setSelectedModelIds(loadedCameras.map(c => c.id));
  };

  // Clear all models
  const handleClearAllModels = () => {
    setSelectedModelIds([]);
  };

  // Selected camera models objects
  const selectedModelObjects = useMemo(() => {
    return loadedCameras.filter(c => selectedModelIds.includes(c.id));
  }, [loadedCameras, selectedModelIds]);

  // Handle Calculate Auto Placement
  const handleCalculate = async () => {
    if (selectedModelObjects.length === 0) {
      setErrorMsg("Please select at least one camera model from the list.");
      return;
    }
    setErrorMsg("");
    setIsCalculating(true);
    setProgress({ step: 1, percent: 5, message: "Analyzing layout geometry and interior rooms..." });

    // Create a new AbortController
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await runAutoPlacementAsync(
        {
          walls,
          zones,
          floorImg,
          ppm,
          selectedModels: selectedModelObjects,
          mode,
          specifiedCount: Number(specifiedCount) || 4,
          targetCoveragePercent: Number(targetCoverage) || 100,
          mountingHeight: 2.8,
          signal: controller.signal
        },
        prog => {
          if (!controller.signal.aborted) {
            setProgress(prog);
          }
        }
      );

      if (!controller.signal.aborted) {
        setPlacementResult(result);
        if (onPreviewPlacement) {
          onPreviewPlacement(result);
        }
      }
    } catch (err) {
      if (err.message !== "Optimization cancelled") {
        console.error("[AutoPlacement] Calculation error:", err);
        setErrorMsg(err.message || "Failed to calculate camera placement.");
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsCalculating(false);
      }
    }
  };

  const handleApply = () => {
    if (placementResult && onApplyPlacement) {
      onApplyPlacement(placementResult, replaceExisting);
    }
    onClose();
  };

  // Cancel immediately on 'X' or Cancel button
  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsCalculating(false);
    setProgress({ step: 0, percent: 0, message: "" });
    setPlacementResult(null);
    if (onCancelPreview) {
      onCancelPreview();
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="mv-auto-placement-overlay">
      <div className="mv-auto-placement-modal mv-auto-placement-modal--wide">
        {/* Header */}
        <div className="mv-ap-header">
          <div className="mv-ap-title-wrap">
            <div className="mv-ap-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <div>
              <h3 className="mv-ap-title">Auto Camera Placement & Optimization</h3>
              <p className="mv-ap-subtitle">
                Interior layout coverage optimizer with multi-brand & multi-model evaluation
              </p>
            </div>
          </div>
          <button type="button" className="mv-ap-close-btn" onClick={handleCancel} title="Close">
            ✕
          </button>
        </div>

        {/* 3-Column Body Layout */}
        <div className="mv-ap-body mv-ap-body--multi">
          {/* Column 1: Multi-Brand & Multi-Model Selection */}
          <div className="mv-ap-selection-col">
            {/* Section A: Multi-Brand Selection */}
            <div className="mv-ap-sec-head">
              <span className="mv-ap-sec-title">
                1. Select Brands ({selectedBrands.length}/{allBrands.length})
              </span>
              <div className="mv-ap-sec-actions">
                <button type="button" className="mv-ap-link-btn" onClick={handleSelectAllBrands}>All</button>
                <span className="mv-ap-sep">|</span>
                <button type="button" className="mv-ap-link-btn" onClick={handleClearAllBrands}>Clear</button>
              </div>
            </div>

            <div className="mv-ap-search-wrap">
              <input
                type="text"
                className="mv-ap-search-input"
                placeholder="Search brands..."
                value={brandSearch}
                onChange={e => setBrandSearch(e.target.value)}
              />
            </div>

            <div className="mv-ap-checklist mv-ap-checklist--brands">
              {filteredBrandList.map(brand => {
                const isChecked = selectedBrands.includes(brand);
                return (
                  <label key={brand} className={`mv-ap-check-item ${isChecked ? "mv-ap-check-item--active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleBrand(brand)}
                    />
                    <span className="mv-ap-check-label">{brand}</span>
                  </label>
                );
              })}
            </div>

            {/* Section B: Multi-Model Selection */}
            <div className="mv-ap-sec-head" style={{ marginTop: "14px" }}>
              <span className="mv-ap-sec-title">
                2. Select Models ({selectedModelIds.length}/{loadedCameras.length})
              </span>
              <div className="mv-ap-sec-actions">
                <button type="button" className="mv-ap-link-btn" onClick={handleSelectAllModels}>All</button>
                <span className="mv-ap-sep">|</span>
                <button type="button" className="mv-ap-link-btn" onClick={handleClearAllModels}>Clear</button>
              </div>
            </div>

            <div className="mv-ap-search-wrap">
              <input
                type="text"
                className="mv-ap-search-input"
                placeholder="Search model number or specs..."
                value={modelSearch}
                onChange={e => setModelSearch(e.target.value)}
              />
            </div>

            <div className="mv-ap-checklist mv-ap-checklist--models">
              {filteredModelList.length === 0 ? (
                <div className="mv-ap-no-items">
                  {selectedBrands.length === 0 ? "Select at least one brand above" : "No models found matching search"}
                </div>
              ) : (
                filteredModelList.map(cam => {
                  const isChecked = selectedModelIds.includes(cam.id);
                  return (
                    <label key={cam.id} className={`mv-ap-model-item ${isChecked ? "mv-ap-model-item--active" : ""}`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleModel(cam.id)}
                      />
                      <div className="mv-ap-model-meta">
                        <div className="mv-ap-model-line">
                          <strong className="mv-ap-model-name">{cam.model}</strong>
                          <span className="mv-ap-model-brand-tag">{cam.brand}</span>
                        </div>
                        <div className="mv-ap-model-sub">
                          {cam.megapixels}MP · {cam.type?.toUpperCase()} · HFOV {cam.hfov}° · Range {cam.rangeDay || 25}m
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Column 2: Placement Parameters & Actions */}
          <div className="mv-ap-config-col">
            <div className="mv-ap-sec-head">
              <span className="mv-ap-sec-title">3. Placement Rules</span>
            </div>

            {/* Quantity Mode */}
            <div className="mv-ap-field">
              <label className="mv-ap-label">Camera Quantity Mode</label>
              <div className="mv-ap-pill-group">
                <button
                  type="button"
                  className={`mv-ap-pill ${mode === "automatic" ? "mv-ap-pill--active" : ""}`}
                  onClick={() => setMode("automatic")}
                >
                  Automatic (Optimized)
                </button>
                <button
                  type="button"
                  className={`mv-ap-pill ${mode === "specify" ? "mv-ap-pill--active" : ""}`}
                  onClick={() => setMode("specify")}
                >
                  Specify Number
                </button>
              </div>
            </div>

            {/* Specific Camera Count */}
            {mode === "specify" && (
              <div className="mv-ap-field">
                <label className="mv-ap-label">Number of Cameras</label>
                <div className="mv-ap-num-stepper">
                  <button
                    type="button"
                    className="mv-ap-step-btn"
                    onClick={() => setSpecifiedCount(c => Math.max(1, c - 1))}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    className="mv-ap-num-input"
                    value={specifiedCount}
                    onChange={e => setSpecifiedCount(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                  <button
                    type="button"
                    className="mv-ap-step-btn"
                    onClick={() => setSpecifiedCount(c => Math.min(50, c + 1))}
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* Target Coverage */}
            <div className="mv-ap-field">
              <label className="mv-ap-label">Target Interior Coverage</label>
              <div className="mv-ap-target-pills">
                {[100, 95, 90].map(tgt => (
                  <button
                    key={tgt}
                    type="button"
                    className={`mv-ap-target-btn ${targetCoverage === tgt ? "mv-ap-target-btn--active" : ""}`}
                    onClick={() => setTargetCoverage(tgt)}
                  >
                    {tgt}% {tgt === 100 ? "(Full)" : ""}
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Pool Overview */}
            <div className="mv-ap-specs-card">
              <div className="mv-ap-spec-row">
                <span className="mv-ap-spec-k">Candidate Models:</span>
                <span className="mv-ap-spec-v">{selectedModelIds.length} Models Selected</span>
              </div>
              <div className="mv-ap-spec-row">
                <span className="mv-ap-spec-k">Selected Brands:</span>
                <span className="mv-ap-spec-v">{selectedBrands.length} Brands</span>
              </div>
              <div className="mv-ap-spec-row">
                <span className="mv-ap-spec-k">Coverage Domain:</span>
                <span className="mv-ap-spec-v" style={{ color: "#10b981" }}>Interior Layout Only</span>
              </div>
            </div>

            {/* Calculate Button */}
            <button
              type="button"
              className="mv-ap-calc-btn"
              disabled={isCalculating || selectedModelIds.length === 0}
              onClick={handleCalculate}
            >
              {isCalculating ? (
                <>
                  <span className="mv-ap-spinner" />
                  Optimizing Layout Placement...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Calculate Auto Placement
                </>
              )}
            </button>

            {errorMsg && <div className="mv-ap-error-box">⚠️ {errorMsg}</div>}
          </div>

          {/* Column 3: Results & Multi-Model Breakdown */}
          <div className="mv-ap-summary-col">
            {isCalculating ? (
              <div className="mv-ap-loading-state">
                <div className="mv-ap-progress-bar-wrap">
                  <div className="mv-ap-progress-fill" style={{ width: `${progress.percent}%` }} />
                </div>
                <div className="mv-ap-progress-pct">{progress.percent}%</div>
                <div className="mv-ap-progress-msg">{progress.message}</div>
              </div>
            ) : placementResult ? (
              <div className="mv-ap-summary-content">
                <div className="mv-ap-summary-header">
                  <div className="mv-ap-summary-title">Auto Placement Summary</div>
                  <div className={`mv-ap-status-badge ${placementResult.targetAchieved ? "mv-ap-status-badge--success" : "mv-ap-status-badge--warning"}`}>
                    {placementResult.targetAchieved ? "✓ Target Achieved" : "⚠ Target Partially Achieved"}
                  </div>
                </div>

                {/* Primary Key Metrics Grid */}
                <div className="mv-ap-stats-grid">
                  <div className="mv-ap-stat-card">
                    <span className="mv-ap-stat-label">Cameras Placed</span>
                    <span className="mv-ap-stat-val mv-ap-stat-val--accent">{placementResult.camerasPlaced}</span>
                    <span className="mv-ap-stat-sub">{mode === "automatic" ? "Optimal Count" : "Specified"}</span>
                  </div>

                  <div className="mv-ap-stat-card">
                    <span className="mv-ap-stat-label">Achieved Coverage</span>
                    <span className="mv-ap-stat-val mv-ap-stat-val--emerald">{placementResult.coveragePercent}%</span>
                    <span className="mv-ap-stat-sub">Target: {placementResult.targetCoverage}%</span>
                  </div>

                  <div className="mv-ap-stat-card">
                    <span className="mv-ap-stat-label">Covered Area</span>
                    <span className="mv-ap-stat-val">{placementResult.coveredArea} m²</span>
                    <span className="mv-ap-stat-sub">Total Layout: {placementResult.totalLayoutArea} m²</span>
                  </div>

                  <div className="mv-ap-stat-card">
                    <span className="mv-ap-stat-label">Overlap Redundancy</span>
                    <span className="mv-ap-stat-val">{placementResult.overlapPercent}%</span>
                    <span className="mv-ap-stat-sub">Multi-Camera Overlap</span>
                  </div>
                </div>

                {/* Optimization Strategy Banner */}
                {placementResult.stoppingReason && (
                  <div className="mv-ap-strategy-banner">
                    🎯 <strong>Strategy:</strong> {placementResult.stoppingReason}
                  </div>
                )}

                {/* Multi-Model Distribution Breakdown */}
                <div className="mv-ap-sec-title mv-ap-sec-title--sub">
                  Selected Model Distribution
                </div>
                <div className="mv-ap-model-dist-list">
                  {Object.entries(placementResult.modelDistribution || {}).map(([modelName, count]) => (
                    <div key={modelName} className="mv-ap-dist-item">
                      <span className="mv-ap-dist-name">{modelName}</span>
                      <strong className="mv-ap-dist-count">× {count}</strong>
                    </div>
                  ))}
                </div>

                {/* Space / Room Coverage Breakdown (Handles 199+ spaces cleanly!) */}
                {Array.isArray(placementResult.roomBreakdown) && placementResult.roomBreakdown.length > 0 && (
                  <div className="mv-ap-room-section">
                    <div className="mv-ap-room-header">
                      <span className="mv-ap-sec-title mv-ap-sec-title--sub" style={{ margin: 0 }}>
                        Space & Room Breakdown ({placementResult.roomBreakdown.length} Spaces)
                      </span>
                      {placementResult.roomBreakdown.length > 6 && (
                        <button
                          type="button"
                          className="mv-ap-link-btn"
                          onClick={() => setShowAllRooms(prev => !prev)}
                        >
                          {showAllRooms ? "Collapse" : `Show All (${placementResult.roomBreakdown.length})`}
                        </button>
                      )}
                    </div>

                    <div className={`mv-ap-model-dist-list mv-ap-room-breakdown ${showAllRooms ? "mv-ap-room-breakdown--expanded" : ""}`}>
                      {(showAllRooms
                        ? placementResult.roomBreakdown
                        : placementResult.roomBreakdown.slice(0, 8)
                      ).map(space => (
                        <div key={space.id} className="mv-ap-dist-item mv-ap-room-item">
                          <span className="mv-ap-dist-name" style={{ flex: 1 }}>{space.name}</span>
                          <span style={{ color: space.coveragePercent >= 90 ? "#10b981" : space.coveragePercent >= 70 ? "#f59e0b" : "#f87171", fontWeight: 600 }}>
                            {space.coveragePercent}%
                          </span>
                          <span style={{ fontSize: "11px", opacity: 0.7, marginLeft: "6px" }}>
                            ({space.coveredAreaM2}/{space.totalAreaM2} m²)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Additional Technical Details */}
                <div className="mv-ap-details-list">
                  <div className="mv-ap-detail-item">
                    <span>Uncovered Interior Space:</span>
                    <strong>{placementResult.uncoveredArea} m² ({placementResult.uncoveredPercent}%)</strong>
                  </div>
                  {placementResult.avgNewCoveragePerCamera != null && (
                    <div className="mv-ap-detail-item">
                      <span>Avg Coverage / Camera:</span>
                      <strong>{placementResult.avgNewCoveragePerCamera} m²</strong>
                    </div>
                  )}
                  {placementResult.marginalGainOfFinalCamera != null && (
                    <div className="mv-ap-detail-item">
                      <span>Final Camera Marginal Gain:</span>
                      <strong style={{ color: "#38bdf8" }}>{placementResult.marginalGainOfFinalCamera} m²</strong>
                    </div>
                  )}
                  {placementResult.camerasRemovedCount != null && (
                    <div className="mv-ap-detail-item">
                      <span>Redundant Cameras Pruned:</span>
                      <strong style={{ color: "#a78bfa" }}>{placementResult.camerasRemovedCount}</strong>
                    </div>
                  )}
                  <div className="mv-ap-detail-item">
                    <span>Candidate Positions Evaluated:</span>
                    <strong>{placementResult.candidatePositionsEvaluated} positions ({placementResult.orientationsEvaluated} angles)</strong>
                  </div>
                  <div className="mv-ap-detail-item">
                    <span>Total Configurations Evaluated:</span>
                    <strong>{placementResult.configurationsEvaluated}</strong>
                  </div>

                  {Array.isArray(placementResult.worstBlindSpots) && placementResult.worstBlindSpots.length > 0 && (
                    <div className="mv-ap-uncovered-note mv-ap-uncovered-note--warning">
                      ⚠️ <strong>Worst Blind Spots:</strong> {placementResult.worstBlindSpots.map(b => `${b.name} (${b.coveragePercent}% covered)`).join(", ")}
                    </div>
                  )}
                  {placementResult.uncoveredReason && (
                    <div className="mv-ap-uncovered-note">
                      ℹ️ {placementResult.uncoveredReason}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mv-ap-empty-state">
                <div className="mv-ap-empty-icon">📐</div>
                <div className="mv-ap-empty-title">Ready for Interior Placement</div>
                <p className="mv-ap-empty-desc">
                  Select your desired camera brands and models on the left, then click <strong>Calculate Auto Placement</strong>.
                  The optimizer will evaluate the best camera models and orientations to maximize interior layout coverage.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Dedicated Fixed Footer - ALWAYS 100% visible, never cut off! */}
        <div className="mv-ap-footer">
          <label className="mv-ap-replace-option">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={e => setReplaceExisting(e.target.checked)}
            />
            <span>Replace existing placed cameras on layout (Recommended)</span>
          </label>

          <div className="mv-ap-actions">
            <button type="button" className="mv-ap-btn mv-ap-btn--cancel" onClick={handleCancel}>
              Cancel
            </button>
            {onClearCameras && (
              <button type="button" className="mv-ap-btn mv-ap-btn--clear" onClick={() => { onClearCameras(); onClose(); }}>
                Clear Cameras
              </button>
            )}
            <button
              type="button"
              className="mv-ap-btn mv-ap-btn--recalc"
              disabled={isCalculating || selectedModelIds.length === 0}
              onClick={handleCalculate}
            >
              Recalculate
            </button>
            <button
              type="button"
              className="mv-ap-btn mv-ap-btn--apply"
              disabled={!placementResult || isCalculating}
              onClick={handleApply}
            >
              ✓ Apply Placement {placementResult ? `(${placementResult.camerasPlaced} Cameras)` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}