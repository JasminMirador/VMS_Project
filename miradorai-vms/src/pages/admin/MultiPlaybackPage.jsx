import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useCameras } from "../../context/CamerasContext";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../config/appConfig";
import "./MultiPlaybackPage.css";

function getToken() {
  return (
    localStorage.getItem("miradorai_token") ||
    sessionStorage.getItem("miradorai_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    ""
  );
}

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Convert "HH:MM" or "HH:MM:SS" to seconds of day
function timeStrToSeconds(str) {
  if (!str) return 0;
  const parts = str.split(/[-:]/).map((n) => parseInt(n, 10));
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  const s = parts[2] || 0;
  return h * 3600 + m * 60 + s;
}

// Format seconds into "HH:MM:SS"
function secondsToTimeStr(totalSec) {
  const h = Math.floor(totalSec / 3600) % 24;
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Format date to "Oct 28, 2026"
function formatDateBadge(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// Format time string to 12h "10:00 PM"
function format12h(timeStr) {
  if (!timeStr) return "";
  const parts = timeStr.split(/[-:]/).map(Number);
  let h = parts[0] || 0;
  const m = parts[1] || 0;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  h = h ? h : 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
}

const GRID_LAYOUTS = [
  { id: "2x2", label: "2×2", rows: 2, cols: 2, capacity: 4 },
  { id: "3x3", label: "3×3", rows: 3, cols: 3, capacity: 9 },
  { id: "4x4", label: "4×4", rows: 4, cols: 4, capacity: 16 },
  { id: "5x5", label: "5×5", rows: 5, cols: 5, capacity: 25 },
  { id: "6x6", label: "6×6", rows: 6, cols: 6, capacity: 36 },
  { id: "7x7", label: "7×7", rows: 7, cols: 7, capacity: 49 },
];

const TIME_PRESETS = [
  { label: "Full Day", start: "00:00", end: "23:59" },
  { label: "Morning", start: "06:00", end: "11:59" },
  { label: "Afternoon", start: "12:00", end: "16:59" },
  { label: "Evening", start: "17:00", end: "20:59" },
  { label: "Night", start: "21:00", end: "23:59" },
];

export default function MultiPlaybackPage() {
  const navigate = useNavigate();
  const { cameras: allCameras = [] } = useCameras();
  const { user } = useAuth();

  // ── Layout State ──
  const [layout, setLayout] = useState("2x2");
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const layoutDropdownRef = useRef(null);

  // ── Filter State ──
  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedCameras, setSelectedCameras] = useState(["ALL"]); // ["ALL"] or array of stream_keys
  const [selectedPreset, setSelectedPreset] = useState("Night");
  const [startTime, setStartTime] = useState("22:00");
  const [endTime, setEndTime] = useState("22:59");
  const [seekSeconds, setSeekSeconds] = useState(22 * 3600); // 22:00:00 default

  // Drawer modal state
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [draftCameras, setDraftCameras] = useState(["ALL"]);
  const [draftDate, setDraftDate] = useState(todayStr);
  const [draftPreset, setDraftPreset] = useState("Night");
  const [draftStart, setDraftStart] = useState("22:00");
  const [draftEnd, setDraftEnd] = useState("22:59");
  const [camSelectDropdownOpen, setCamSelectDropdownOpen] = useState(false);

  // Recordings data map: camera_id -> array of file objects
  const [cameraFiles, setCameraFiles] = useState({});
  const [loadingRecordings, setLoadingRecordings] = useState(false);

  // Unified Playback Controls
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const videoRefs = useRef({});

  // Close layout menu on outside click
  useEffect(() => {
    const handleOutside = (e) => {
      if (layoutDropdownRef.current && !layoutDropdownRef.current.contains(e.target)) {
        setShowLayoutMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // Filter available cameras that match selectedCameras
  const activeCameras = useMemo(() => {
    if (selectedCameras.includes("ALL")) {
      return allCameras;
    }
    return allCameras.filter((cam) => {
      const key = cam.stream_key || String(cam.id);
      return selectedCameras.includes(key);
    });
  }, [allCameras, selectedCameras]);

  // Determine grid capacity & visible cameras
  const activeLayoutConfig = useMemo(
    () => GRID_LAYOUTS.find((l) => l.id === layout) || GRID_LAYOUTS[0],
    [layout]
  );

  const visibleCameras = useMemo(() => {
    return activeCameras.slice(0, activeLayoutConfig.capacity);
  }, [activeCameras, activeLayoutConfig]);

  // ── Fetch recordings for active cameras whenever selectedDate or activeCameras change ──
  useEffect(() => {
    if (visibleCameras.length === 0) return;
    let cancelled = false;

    const fetchAllRecordings = async () => {
      setLoadingRecordings(true);
      const newFilesMap = {};

      await Promise.all(
        visibleCameras.map(async (cam) => {
          const streamKey = cam.stream_key || String(cam.id);
          try {
            const res = await fetch(
              apiUrl(`/recordings/${streamKey}?date=${selectedDate}`),
              { headers: authHeaders() }
            );
            if (res.ok) {
              const data = await res.json();
              const raw = Array.isArray(data) ? data : data.files || [];
              newFilesMap[streamKey] = raw.map((rec) => ({
                camera_id: rec.camera_id || streamKey,
                date: rec.date || selectedDate,
                start_time: rec.start_time,
                start_secs: timeStrToSeconds(rec.start_time),
                duration: rec.duration_seconds || 300,
                file_path: rec.file_path,
              }));
            } else {
              newFilesMap[streamKey] = [];
            }
          } catch {
            newFilesMap[streamKey] = [];
          }
        })
      );

      if (!cancelled) {
        setCameraFiles(newFilesMap);
        setLoadingRecordings(false);
      }
    };

    fetchAllRecordings();
    return () => {
      cancelled = true;
    };
  }, [visibleCameras, selectedDate]);

  // Synchronize unified play/pause
  const togglePlayAll = () => {
    const nextPlay = !isPlaying;
    setIsPlaying(nextPlay);
    Object.values(videoRefs.current).forEach((v) => {
      if (v) {
        if (nextPlay) v.play().catch(() => {});
        else v.pause();
      }
    });
  };

  // Change playback speed
  const handleSpeedChange = (speed) => {
    setPlaybackSpeed(speed);
    Object.values(videoRefs.current).forEach((v) => {
      if (v) v.playbackRate = speed;
    });
  };

  // Seek all to a given time in seconds
  const handleSeek = (newSeconds) => {
    setSeekSeconds(newSeconds);
    // Find the offset inside current 5-min segment
    Object.values(videoRefs.current).forEach((v) => {
      if (v) {
        const offset = newSeconds % 300;
        if (v.duration && offset <= v.duration) {
          v.currentTime = offset;
        }
      }
    });
  };

  // ── Filter Drawer Handlers ──
  const openFilter = () => {
    setDraftCameras(selectedCameras);
    setDraftDate(selectedDate);
    setDraftPreset(selectedPreset);
    setDraftStart(startTime);
    setDraftEnd(endTime);
    setIsFilterOpen(true);
  };

  const closeFilter = () => {
    setIsFilterOpen(false);
    setCamSelectDropdownOpen(false);
  };

  const handleApplyFilter = () => {
    setSelectedCameras(draftCameras);
    setSelectedDate(draftDate);
    setSelectedPreset(draftPreset);
    setStartTime(draftStart);
    setEndTime(draftEnd);

    // Update seek time to start of selected range
    const startSec = timeStrToSeconds(draftStart);
    setSeekSeconds(startSec);

    setIsFilterOpen(false);
    setCamSelectDropdownOpen(false);
  };

  const handleClearFilter = () => {
    setDraftCameras(["ALL"]);
    setDraftDate(todayStr);
    setDraftPreset("Full Day");
    setDraftStart("00:00");
    setDraftEnd("23:59");
  };

  const handleToggleDraftCam = (camKey) => {
    if (camKey === "ALL") {
      setDraftCameras(["ALL"]);
      return;
    }
    let updated = draftCameras.filter((k) => k !== "ALL");
    if (updated.includes(camKey)) {
      updated = updated.filter((k) => k !== camKey);
      if (updated.length === 0) updated = ["ALL"];
    } else {
      updated.push(camKey);
    }
    setDraftCameras(updated);
  };

  // ── Render 24-Hour Timeline Hours ──
  const hoursList = useMemo(() => {
    const list = [];
    for (let h = 0; h <= 23; h++) {
      list.push(h);
    }
    return list;
  }, []);

  // Check if an hour row has recordings across any visible camera
  const hasRecordingsInHour = (hour) => {
    const startH = hour * 3600;
    const endH = (hour + 1) * 3600;
    return Object.values(cameraFiles).some((files) =>
      files.some((f) => f.start_secs >= startH && f.start_secs < endH)
    );
  };

  // Find matching recording segment for a camera at seekSeconds
  const getCameraPlaybackSource = (streamKey) => {
    const files = cameraFiles[streamKey] || [];
    // A 5-min segment covers [start_secs, start_secs + 300]
    const matched = files.find(
      (f) => seekSeconds >= f.start_secs && seekSeconds < f.start_secs + (f.duration || 300)
    );

    if (!matched) return null;

    const tk = getToken();
    const url =
      apiUrl("/recordings/play") +
      `?camera_id=${encodeURIComponent(matched.camera_id)}` +
      `&date=${encodeURIComponent(matched.date)}` +
      `&start_time=${encodeURIComponent(matched.start_time)}` +
      `&_cb=${Date.now()}` +
      (tk ? `&token=${encodeURIComponent(tk)}` : "");

    return { file: matched, url };
  };

  return (
    <div className="multi-pb-shell">
      {/* ── Top Header Toolbar ────────────────────────────────────────────── */}
      <div className="multi-pb-toolbar">
        <div className="multi-pb-toolbar__left">
          <h1 className="multi-pb-title">Recordings</h1>

          {/* Active Filter Badges */}
          <div className="multi-pb-badges">
            <span className="multi-pb-badge multi-pb-badge-cameras">
              Cameras:{" "}
              {selectedCameras.includes("ALL")
                ? "All"
                : `${selectedCameras.length} Selected`}
            </span>
            <span className="multi-pb-badge multi-pb-badge-date">
              Date: {formatDateBadge(selectedDate)}
            </span>
            <span className="multi-pb-badge multi-pb-badge-time">
              Time: {format12h(startTime)} - {format12h(endTime)}
            </span>
          </div>
        </div>

        <div className="multi-pb-toolbar__right" ref={layoutDropdownRef}>
          {/* Switch to Single Camera Playback */}
          <button
            className="multi-pb-mode-btn"
            title="Switch to Single Camera Playback"
            onClick={() => navigate("/media-player")}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="2" y="3" width="20" height="18" rx="3" />
              <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
            </svg>
            <span>Single View</span>
          </button>

          {/* Grid Layout Selector Button */}
          <button
            className="multi-pb-icon-btn"
            title="Change Grid Layout"
            onClick={() => setShowLayoutMenu((prev) => !prev)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
              <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
              <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
              <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
            </svg>
          </button>

          {/* Grid Layout Dropdown */}
          {showLayoutMenu && (
            <div className="multi-pb-layout-dropdown">
              {GRID_LAYOUTS.map((opt) => (
                <button
                  key={opt.id}
                  className={`multi-pb-layout-opt ${layout === opt.id ? "active" : ""}`}
                  onClick={() => {
                    setLayout(opt.id);
                    setShowLayoutMenu(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Filter Drawer Toggle Button */}
          <button
            className="multi-pb-icon-btn outlined"
            title="Open Filter Drawer"
            onClick={openFilter}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Main Container: Grid Area + 24H Timeline ──────────────────────── */}
      <div className="multi-pb-main">
        {/* Left: Camera Grid Area + Bottom Controls */}
        <div className="multi-pb-grid-area">
          <div
            className="multi-pb-grid"
            style={{
              gridTemplateColumns: `repeat(${activeLayoutConfig.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${activeLayoutConfig.rows}, minmax(0, 1fr))`,
            }}
          >
            {visibleCameras.map((cam, idx) => {
              const streamKey = cam.stream_key || String(cam.id);
              const camName = cam.name || `Camera ${idx + 1}`;
              const playback = getCameraPlaybackSource(streamKey);

              return (
                <div key={streamKey} className="multi-pb-tile">
                  {/* Top Left Camera Name */}
                  <div className="multi-pb-tile-header">
                    <span className="multi-pb-tile-cam-name">{camName} ·</span>
                    <span
                      className={`multi-pb-tile-dot ${playback ? "" : "offline"}`}
                    />
                  </div>

                  {/* Video Tile or "NO RECORDING AT THIS TIME" Placeholder */}
                  {playback ? (
                    <video
                      ref={(el) => (videoRefs.current[streamKey] = el)}
                      src={playback.url}
                      className="multi-pb-video"
                      playsInline
                      crossOrigin="anonymous"
                      autoPlay={isPlaying}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => {}}
                    />
                  ) : (
                    <div className="multi-pb-no-recording">
                      <div className="multi-pb-play-circle">
                        <svg
                          viewBox="0 0 24 24"
                          width="24"
                          height="24"
                          fill="currentColor"
                        >
                          <polygon points="9 7 17 12 9 17 9 7" />
                        </svg>
                      </div>
                      <span className="multi-pb-no-recording-text">
                        NO RECORDING AT THIS TIME
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Unified Controls Bar at Bottom */}
          <div className="multi-pb-controls-bar">
            <div className="multi-pb-controls-left">
              <button
                className="multi-pb-play-btn"
                onClick={togglePlayAll}
                title={isPlaying ? "Pause All" : "Play All"}
              >
                {isPlaying ? (
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="currentColor"
                  >
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="currentColor"
                  >
                    <polygon points="6 4 20 12 6 20 6 4" />
                  </svg>
                )}
              </button>

              <span className="multi-pb-time-text">
                {secondsToTimeStr(seekSeconds)}
              </span>
            </div>

            {/* Time Scrubber (00:00 to 23:59:59) */}
            <div className="multi-pb-scrubber">
              <input
                type="range"
                className="multi-pb-slider"
                min={0}
                max={86399}
                value={seekSeconds}
                onChange={(e) => handleSeek(Number(e.target.value))}
              />
            </div>

            <div className="multi-pb-controls-right">
              {/* Playback Speed */}
              <select
                className="multi-pb-speed-select"
                value={playbackSpeed}
                onChange={(e) => handleSpeedChange(Number(e.target.value))}
              >
                <option value={0.5}>0.5x</option>
                <option value={1}>1.0x</option>
                <option value={2}>2.0x</option>
                <option value={4}>4.0x</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right: Vertical 24-Hour Timeline Bar */}
        <div className="multi-pb-timeline-panel">
          <div className="multi-pb-timeline-header">
            Filter: {selectedCameras.includes("ALL") ? "All" : "Selected"}
          </div>

          <div className="multi-pb-timeline-hours">
            {hoursList.map((hour) => {
              const hourSec = hour * 3600;
              const isCurrentHour =
                seekSeconds >= hourSec && seekSeconds < (hour + 1) * 3600;
              const hasRec = hasRecordingsInHour(hour);

              return (
                <div
                  key={hour}
                  className={`multi-pb-hour-row ${
                    isCurrentHour ? "active" : ""
                  } ${hasRec ? "has-recordings" : ""}`}
                  onClick={() => handleSeek(hourSec)}
                >
                  <span>{String(hour).padStart(2, "0")}:00</span>

                  {isCurrentHour && (
                    <span className="multi-pb-seekline-pill">
                      {secondsToTimeStr(seekSeconds)}
                    </span>
                  )}

                  <span className="multi-pb-hour-dot" />
                </div>
              );
            })}
          </div>

          <div className="multi-pb-timeline-footer">CLICK TO SEEK</div>
        </div>
      </div>

      {/* ── Filter Slide-Over Drawer Modal ────────────────────────────────── */}
      {isFilterOpen && (
        <div className="multi-pb-drawer-backdrop" onClick={closeFilter}>
          <div className="multi-pb-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="multi-pb-drawer-header">
              <span className="multi-pb-drawer-title">Filter</span>
              <button className="multi-pb-drawer-close" onClick={closeFilter}>
                ✕
              </button>
            </div>

            <div className="multi-pb-drawer-body">
              {/* 1. Cameras Multi-Select */}
              <div className="multi-pb-form-group">
                <label className="multi-pb-form-label">Cameras</label>
                <div
                  className="multi-pb-cam-select-box"
                  onClick={() => setCamSelectDropdownOpen((prev) => !prev)}
                >
                  <div className="multi-pb-cam-tags">
                    {draftCameras.includes("ALL") ? (
                      <span className="multi-pb-cam-tag">
                        All
                        <span
                          className="multi-pb-cam-tag-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (allCameras.length > 0) {
                              const firstKey =
                                allCameras[0].stream_key || String(allCameras[0].id);
                              setDraftCameras([firstKey]);
                            }
                          }}
                        >
                          ✕
                        </span>
                      </span>
                    ) : (
                      draftCameras.map((key) => {
                        const cam = allCameras.find(
                          (c) => (c.stream_key || String(c.id)) === key
                        );
                        return (
                          <span key={key} className="multi-pb-cam-tag">
                            {cam?.name || key}
                            <span
                              className="multi-pb-cam-tag-remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleDraftCam(key);
                              }}
                            >
                              ✕
                            </span>
                          </span>
                        );
                      })
                    )}
                  </div>

                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>

                {/* Dropdown Checklist */}
                {camSelectDropdownOpen && (
                  <div className="multi-pb-cam-dropdown-list">
                    <div
                      className={`multi-pb-cam-item ${
                        draftCameras.includes("ALL") ? "selected" : ""
                      }`}
                      onClick={() => handleToggleDraftCam("ALL")}
                    >
                      <input
                        type="checkbox"
                        checked={draftCameras.includes("ALL")}
                        readOnly
                      />
                      <span>All Cameras</span>
                    </div>

                    {allCameras.map((cam) => {
                      const key = cam.stream_key || String(cam.id);
                      const isChecked =
                        draftCameras.includes("ALL") || draftCameras.includes(key);
                      return (
                        <div
                          key={key}
                          className={`multi-pb-cam-item ${
                            isChecked ? "selected" : ""
                          }`}
                          onClick={() => handleToggleDraftCam(key)}
                        >
                          <input type="checkbox" checked={isChecked} readOnly />
                          <span>{cam.name || key}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 2. Date Picker */}
              <div className="multi-pb-form-group">
                <label className="multi-pb-form-label">Date</label>
                <input
                  type="date"
                  className="multi-pb-date-input"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                />
              </div>

              {/* 3. Time Range */}
              <div className="multi-pb-form-group">
                <label className="multi-pb-form-label">
                  <svg
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Time Range
                </label>

                {/* Quick Presets */}
                <div className="multi-pb-time-presets">
                  {TIME_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      className={`multi-pb-preset-btn ${
                        draftPreset === preset.label ? "active" : ""
                      }`}
                      onClick={() => {
                        setDraftPreset(preset.label);
                        setDraftStart(preset.start);
                        setDraftEnd(preset.end);
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Time Range Display & Edit */}
                <div className="multi-pb-time-display-box">
                  <div className="multi-pb-custom-time-inputs">
                    <input
                      type="time"
                      className="multi-pb-time-input"
                      value={draftStart}
                      onChange={(e) => {
                        setDraftStart(e.target.value);
                        setDraftPreset("Custom");
                      }}
                    />
                    <span>~</span>
                    <input
                      type="time"
                      className="multi-pb-time-input"
                      value={draftEnd}
                      onChange={(e) => {
                        setDraftEnd(e.target.value);
                        setDraftPreset("Custom");
                      }}
                    />
                  </div>

                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    color="#64748b"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>

                <span className="multi-pb-helper-text">
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Click to select custom time range or use quick presets above
                </span>
              </div>
            </div>

            {/* Drawer Footer Actions */}
            <div className="multi-pb-drawer-footer">
              <button
                className="multi-pb-clear-btn"
                onClick={handleClearFilter}
              >
                Clear Filter
              </button>

              <div className="multi-pb-footer-actions">
                <button className="multi-pb-cancel-btn" onClick={closeFilter}>
                  Cancel
                </button>
                <button
                  className="multi-pb-apply-btn"
                  onClick={handleApplyFilter}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
