import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useCameras } from "../../context/CamerasContext";
import { useAuth } from "../../context/AuthContext";
import useGroups from "../../hooks/useGroups";
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
  { id: "1x1", label: "1×1", rows: 1, cols: 1 },
  { id: "2x2", label: "2×2", rows: 2, cols: 2 },
  { id: "2x3", label: "2×3", rows: 2, cols: 3 },
  { id: "3x3", label: "3×3", rows: 3, cols: 3 },
  { id: "3x4", label: "3×4", rows: 3, cols: 4 },
  { id: "4x4", label: "4×4", rows: 4, cols: 4 },
  { id: "5x5", label: "5×5", rows: 5, cols: 5 },
  { id: "6x6", label: "6×6", rows: 6, cols: 6 },
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
  const [groups = []] = useGroups();

  // ── Group Selection State (like LiveViewPage) ──
  const [selectedGroupId, setSelectedGroupId] = useState("all");
  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false);
  const groupDropdownRef = useRef(null);

  // ── Layout State ──
  const [layout, setLayout] = useState("2x2");
  const [currentPage, setCurrentPage] = useState(1);
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
  const [draftGroupId, setDraftGroupId] = useState("all");
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
  const isScrubbingRef = useRef(false);

  // Close menus on outside click
  useEffect(() => {
    const handleOutside = (e) => {
      if (layoutDropdownRef.current && !layoutDropdownRef.current.contains(e.target)) {
        setShowLayoutMenu(false);
      }
      if (groupDropdownRef.current && !groupDropdownRef.current.contains(e.target)) {
        setGroupDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // Compute selected group label
  const selectedGroupLabel = useMemo(() => {
    if (!selectedGroupId || selectedGroupId === "all") return "ALL";
    if (selectedGroupId === "default") return "Default";
    const found = groups.find((g) => (g.id || g._id) === selectedGroupId);
    return found ? found.name : "ALL";
  }, [selectedGroupId, groups]);

  // Count cameras per group
  const groupCamsCounts = useMemo(() => {
    const counts = { all: allCameras.length, default: 0 };
    allCameras.forEach((c) => {
      const gid = c.group_id || "default";
      counts[gid] = (counts[gid] || 0) + 1;
    });
    return counts;
  }, [allCameras]);

  // Filter available cameras by selectedGroupId and selectedCameras
  const activeCameras = useMemo(() => {
    let list = allCameras;
    if (selectedGroupId === "default") {
      list = list.filter((c) => !c.group_id || c.group_id === "default");
    } else if (selectedGroupId && selectedGroupId !== "all") {
      list = list.filter(
        (c) => c.group_id === selectedGroupId || String(c.group_id) === String(selectedGroupId)
      );
    }

    if (selectedCameras.includes("ALL")) {
      return list;
    }
    return list.filter((cam) => {
      const key = cam.stream_key || String(cam.id);
      return selectedCameras.includes(key);
    });
  }, [allCameras, selectedGroupId, selectedCameras]);

  // Determine grid capacity & visible cameras (matching LiveViewPage rectangular grid)
  const activeLayoutConfig = useMemo(
    () => GRID_LAYOUTS.find((l) => l.id === layout) || GRID_LAYOUTS[1],
    [layout]
  );
  const cols = activeLayoutConfig.cols;
  const rows = activeLayoutConfig.rows;
  const gridSize = cols * rows;

  const totalPages = Math.max(1, Math.ceil(activeCameras.length / gridSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const pageCams = useMemo(() => {
    return activeCameras.slice((currentPage - 1) * gridSize, currentPage * gridSize);
  }, [activeCameras, currentPage, gridSize]);

  const dynamicGap =
    cols >= 6 ? "4px" : cols >= 5 ? "6px" : cols >= 4 ? "8px" : "10px";

  // ── Fetch recordings for page cameras whenever selectedDate or pageCams change ──
  useEffect(() => {
    if (pageCams.length === 0) return;
    let cancelled = false;

    const fetchAllRecordings = async () => {
      setLoadingRecordings(true);
      const newFilesMap = {};

      await Promise.all(
        pageCams.map(async (cam) => {
          if (!cam) return;
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
        setCameraFiles((prev) => ({ ...prev, ...newFilesMap }));
        setLoadingRecordings(false);
      }
    };

    fetchAllRecordings();
    return () => {
      cancelled = true;
    };
  }, [pageCams, selectedDate]);

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
    // Find the offset inside current segment for each video
    Object.entries(videoRefs.current).forEach(([streamKey, v]) => {
      if (v) {
        const files = cameraFiles[streamKey] || [];
        const matched = files.find(
          (f) => newSeconds >= f.start_secs && newSeconds < f.start_secs + (f.duration || 300)
        );
        if (matched) {
          const offset = Math.max(0, newSeconds - matched.start_secs);
          if (v.duration && offset <= v.duration) {
            v.currentTime = offset;
          }
        }
      }
    });
  };

  // ── Unified Playback Ticker: advances time and slider while playing ───────
  useEffect(() => {
    if (!isPlaying) return;

    const intervalMs = Math.max(100, Math.round(1000 / playbackSpeed));
    const timer = setInterval(() => {
      if (isScrubbingRef.current) return;

      setSeekSeconds((prevSec) => {
        // Inspect active playing videos to accurately track playback progression
        const activeEntries = Object.entries(videoRefs.current).filter(
          ([_, v]) => v && !v.paused && !v.ended && v.readyState >= 2
        );

        if (activeEntries.length > 0) {
          const [activeKey, activeVid] = activeEntries[0];
          const files = cameraFiles[activeKey] || [];
          const currentFile = files.find(
            (f) => prevSec >= f.start_secs && prevSec < f.start_secs + (f.duration || 300)
          );

          if (currentFile && typeof activeVid.currentTime === "number") {
            const calculatedSec = Math.floor(currentFile.start_secs + activeVid.currentTime);
            // If nearing file duration, jump to next segment
            if (activeVid.currentTime >= (activeVid.duration || 300) - 0.5) {
              return currentFile.start_secs + (currentFile.duration || 300);
            }
            if (
              calculatedSec >= currentFile.start_secs &&
              calculatedSec <= currentFile.start_secs + (currentFile.duration || 300)
            ) {
              return calculatedSec;
            }
          }
        }

        // Fallback: advance 1 second if no video actively playing (buffering or gap)
        const nextSec = prevSec + 1;
        if (nextSec > 86399) {
          setIsPlaying(false);
          return 86399;
        }
        return nextSec;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed, cameraFiles]);

  // ── Filter Drawer Handlers ──
  const openFilter = () => {
    setDraftGroupId(selectedGroupId);
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
    setSelectedGroupId(draftGroupId);
    setSelectedCameras(draftCameras);
    setSelectedDate(draftDate);
    setSelectedPreset(draftPreset);
    setStartTime(draftStart);
    setEndTime(draftEnd);
    setCurrentPage(1);

    // Update seek time to start of selected range
    const startSec = timeStrToSeconds(draftStart);
    setSeekSeconds(startSec);

    setIsFilterOpen(false);
    setCamSelectDropdownOpen(false);
  };

  const handleClearFilter = () => {
    setDraftGroupId("all");
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

  // Stable playback sources map per page camera
  const playbackSources = useMemo(() => {
    const map = {};
    const tk = getToken();
    pageCams.forEach((cam) => {
      if (!cam) return;
      const streamKey = cam.stream_key || String(cam.id);
      const files = cameraFiles[streamKey] || [];
      const matched = files.find(
        (f) => seekSeconds >= f.start_secs && seekSeconds < f.start_secs + (f.duration || 300)
      );

      if (matched) {
        map[streamKey] = {
          file: matched,
          url:
            apiUrl("/recordings/play") +
            `?camera_id=${encodeURIComponent(matched.camera_id)}` +
            `&date=${encodeURIComponent(matched.date)}` +
            `&start_time=${encodeURIComponent(matched.start_time)}` +
            (tk ? `&token=${encodeURIComponent(tk)}` : ""),
        };
      } else {
        map[streamKey] = null;
      }
    });
    return map;
  }, [pageCams, cameraFiles, seekSeconds]);

  return (
    <div className="multi-pb-shell">
      {/* ── Top Header Toolbar ────────────────────────────────────────────── */}
      <div className="multi-pb-toolbar">
        <div className="multi-pb-toolbar__left">
          <h1 className="multi-pb-title">Recordings</h1>

          {/* Active Filter Badges */}
          <div className="multi-pb-badges">
            <span className="multi-pb-badge multi-pb-badge-group">
              Group: {selectedGroupLabel}
            </span>
            <span className="multi-pb-badge multi-pb-badge-cameras">
              Cameras:{" "}
              {selectedCameras.includes("ALL")
                ? `${activeCameras.length} in Group`
                : `${activeCameras.length} Selected`}
            </span>
            <span className="multi-pb-badge multi-pb-badge-date">
              Date: {formatDateBadge(selectedDate)}
            </span>
            <span className="multi-pb-badge multi-pb-badge-time">
              Time: {format12h(startTime)} - {format12h(endTime)}
            </span>
          </div>
        </div>

        <div className="multi-pb-toolbar__right">
          {/* Group Selector Dropdown (like LiveViewPage) */}
          <div className="multi-pb-group-container" ref={groupDropdownRef}>
            <button
              type="button"
              className={`multi-pb-group-btn ${groupDropdownOpen ? "active" : ""}`}
              onClick={() => setGroupDropdownOpen((prev) => !prev)}
              title="Filter cameras by group"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                width="14"
                height="14"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="multi-pb-group-label-prefix">Group:</span>
              <span className="multi-pb-group-name">{selectedGroupLabel}</span>
              <svg
                className={`multi-pb-chevron ${groupDropdownOpen ? "open" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                width="11"
                height="11"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {groupDropdownOpen && (
              <div className="multi-pb-dropdown-menu">
                <button
                  type="button"
                  className={`multi-pb-dropdown-item ${selectedGroupId === "all" ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedGroupId("all");
                    setCurrentPage(1);
                    setGroupDropdownOpen(false);
                  }}
                >
                  <span className="multi-pb-item-label">ALL</span>
                  <span className="multi-pb-item-count">({groupCamsCounts.all || 0})</span>
                </button>

                {groupCamsCounts.default > 0 && (
                  <button
                    type="button"
                    className={`multi-pb-dropdown-item ${selectedGroupId === "default" ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedGroupId("default");
                      setCurrentPage(1);
                      setGroupDropdownOpen(false);
                    }}
                  >
                    <span className="multi-pb-item-label">Default</span>
                    <span className="multi-pb-item-count">({groupCamsCounts.default})</span>
                  </button>
                )}

                {groups
                  .filter((g) => g.id !== "default" && g.name?.toLowerCase() !== "default")
                  .map((g) => {
                    const gid = g.id || g._id;
                    const count = groupCamsCounts[gid] || 0;
                    return (
                      <button
                        key={gid}
                        type="button"
                        className={`multi-pb-dropdown-item ${selectedGroupId === gid ? "selected" : ""}`}
                        onClick={() => {
                          setSelectedGroupId(gid);
                          setCurrentPage(1);
                          setGroupDropdownOpen(false);
                        }}
                      >
                        <span className="multi-pb-item-label">{g.name}</span>
                        <span className="multi-pb-item-count">({count})</span>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>

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
          <div style={{ position: "relative" }} ref={layoutDropdownRef}>
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
                    setCurrentPage(1);
                    setShowLayoutMenu(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          </div>

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
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
              gap: dynamicGap,
            }}
          >
            {activeCameras.length === 0 ? (
              <div className="multi-pb-empty-state">
                <p>No cameras match the selected filter.</p>
              </div>
            ) : (
              Array.from({ length: gridSize }).map((_, i) => {
                const cam = pageCams[i];

                if (!cam) {
                  return (
                    <div key={`empty-${i}`} className="multi-pb-tile multi-pb-tile--empty">
                      <div className="multi-pb-empty-cell">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1"
                          width={cols >= 5 ? 20 : 28}
                          height={cols >= 5 ? 20 : 28}
                        >
                          <path d="M23 7l-7 5 7 5V7z" />
                          <rect x="1" y="5" width="15" height="14" rx="2" />
                        </svg>
                        {cols <= 4 && <span>No Camera</span>}
                      </div>
                    </div>
                  );
                }

                const streamKey = cam.stream_key || String(cam.id);
                const camName = cam.name || `Camera ${i + 1}`;
                const playback = playbackSources[streamKey];

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
                        ref={(el) => {
                          if (el) {
                            videoRefs.current[streamKey] = el;
                          } else {
                            delete videoRefs.current[streamKey];
                          }
                        }}
                        src={playback.url}
                        className="multi-pb-video"
                        playsInline
                        crossOrigin="anonymous"
                        autoPlay={isPlaying}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => {}}
                        onLoadedMetadata={(e) => {
                          const offset = seekSeconds - playback.file.start_secs;
                          if (offset > 0 && offset < e.target.duration) {
                            e.target.currentTime = offset;
                          }
                          e.target.playbackRate = playbackSpeed;
                          if (isPlaying) {
                            e.target.play().catch(() => {});
                          }
                        }}
                        onEnded={() => {
                          setSeekSeconds((prev) => Math.min(86399, prev + 1));
                        }}
                      />
                    ) : (
                      <div className="multi-pb-no-recording">
                        <div className="multi-pb-play-circle">
                          <svg
                            viewBox="0 0 24 24"
                            width={cols >= 5 ? 20 : 24}
                            height={cols >= 5 ? 20 : 24}
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
              })
            )}
          </div>

          {/* Pagination bar when cameras exceed current grid capacity */}
          {totalPages > 1 && (
            <div className="multi-pb-pagination">
              <button
                className="multi-pb-page-btn"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                type="button"
              >
                &lt; Prev
              </button>
              <span className="multi-pb-page-info">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="multi-pb-page-btn"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                type="button"
              >
                Next &gt;
              </button>
            </div>
          )}

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
                onMouseDown={() => {
                  isScrubbingRef.current = true;
                }}
                onTouchStart={() => {
                  isScrubbingRef.current = true;
                }}
                onMouseUp={() => {
                  isScrubbingRef.current = false;
                }}
                onTouchEnd={() => {
                  isScrubbingRef.current = false;
                }}
                onChange={(e) => handleSeek(Number(e.target.value))}
                style={{
                  background: `linear-gradient(to right, #0e7490 ${(seekSeconds / 86399) * 100}%, #cbd5e1 ${(seekSeconds / 86399) * 100}%)`,
                }}
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
              {/* 0. Camera Group Selection */}
              <div className="multi-pb-form-group">
                <label className="multi-pb-form-label">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    width="14"
                    height="14"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  Camera Group
                </label>
                <select
                  className="multi-pb-group-select"
                  value={draftGroupId}
                  onChange={(e) => {
                    setDraftGroupId(e.target.value);
                    setDraftCameras(["ALL"]);
                  }}
                >
                  <option value="all">ALL ({groupCamsCounts.all || 0})</option>
                  {groupCamsCounts.default > 0 && (
                    <option value="default">Default ({groupCamsCounts.default})</option>
                  )}
                  {groups
                    .filter((g) => g.id !== "default" && g.name?.toLowerCase() !== "default")
                    .map((g) => {
                      const gid = g.id || g._id;
                      return (
                        <option key={gid} value={gid}>
                          {g.name} ({groupCamsCounts[gid] || 0})
                        </option>
                      );
                    })}
                </select>
              </div>

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

                    {allCameras
                      .filter((c) => {
                        if (draftGroupId === "default") return !c.group_id || c.group_id === "default";
                        if (draftGroupId && draftGroupId !== "all") {
                          return c.group_id === draftGroupId || String(c.group_id) === String(draftGroupId);
                        }
                        return true;
                      })
                      .map((cam) => {
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
