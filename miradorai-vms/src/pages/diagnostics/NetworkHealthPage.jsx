import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, Camera, Check, CheckCircle2, ChevronDown, Clock, Cpu,
  Database, Gauge, HardDrive, Layers, Network, Radio, RefreshCw, Server, ShieldCheck, Terminal, TrendingUp, X, Zap
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis
} from "recharts";
import "./NetworkHealthPage.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

// Vibrant palette for cameras when All Cameras is selected
const DEFAULT_CAMERA_COLORS = [
  "#10d6a0", // Emerald Mint
  "#48a5ff", // Electric Blue
  "#a78bfa", // Neon Purple
  "#f6b94b", // Amber Gold
  "#fb7185", // Rose Coral
  "#34d399", // Mint Green
  "#38bdf8", // Sky Blue
  "#e879f9", // Fuchsia
  "#f43f5e", // Crimson
  "#2dd4bf", // Teal
];

const getStoredToken = () => {
  return (
    localStorage.getItem("miradorai_token") ||
    sessionStorage.getItem("miradorai_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    ""
  );
};

const authHeaders = () => {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const asArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  for (const key of ["cameras", "items", "data", "nodes", "history", "records"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const fmt = (value, digits = 2) =>
  numberOrNull(value) === null ? "Unavailable" : Number(value).toFixed(digits);

const timestampLabel = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

function normalizeCamera(camera, index) {
  const ip = camera.ip || camera.ip_address || camera.host || "";
  const id = String(camera.id ?? camera._id ?? camera.camera_id ?? ip ?? `camera-${index}`);
  const name = camera.name || camera.device_name || camera.camera_name || camera.label || camera.model || (ip ? `Camera ${ip}` : `Camera ${index + 1}`);
  const color = camera.color || DEFAULT_CAMERA_COLORS[index % DEFAULT_CAMERA_COLORS.length];
  return {
    id,
    name,
    ip,
    status: camera.status || camera.registration_status || "registered",
    stream_health: camera.stream_health || "unknown",
    latest_bitrate_mbps: numberOrNull(camera.latest_bitrate_mbps),
    latest_measurement_timestamp: camera.latest_measurement_timestamp || null,
    measurement_availability: camera.measurement_availability || "unknown",
    latency_ms: numberOrNull(camera.latency_ms),
    packet_loss: numberOrNull(camera.packet_loss),
    color,
    dataKey: camera.dataKey || `cam_${id}`,
    raw: camera,
  };
}

function normalizeHistoryPoint(point) {
  const timestamp = point.timestamp ?? point.time ?? point.created_at ?? point.recorded_at ?? point.ts;
  const timeMs = timestamp ? new Date(timestamp).getTime() : NaN;
  const totalBandwidth = numberOrNull(point.incoming_mbps ?? point.bandwidth_mbps ?? point.bitrate_mbps);

  return {
    ...point,
    timestamp,
    time: timestampLabel(timestamp),
    timeMs: Number.isFinite(timeMs) ? timeMs : null,
    incoming_mbps: totalBandwidth,
    bandwidth_mbps: totalBandwidth,
    source: point.source || null,
  };
}

/**
 * Custom Accessible Camera Dropdown UI
 * Highlights All Cameras and individual registered cameras with live bitrate pills and keyboard navigation.
 */
function CameraDropdown({ cameras, selectedCamera, onSelect, compact = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef(null);

  const options = useMemo(() => [
    { id: "all", name: "All Cameras", ip: "", isAll: true, count: cameras.length },
    ...cameras,
  ], [cameras]);

  const filteredOptions = useMemo(() => {
    if (!searchFilter.trim()) return options;
    const q = searchFilter.toLowerCase();
    return options.filter((opt) =>
      opt.isAll ||
      opt.name?.toLowerCase().includes(q) ||
      opt.ip?.toLowerCase().includes(q)
    );
  }, [options, searchFilter]);

  const selectedOption = useMemo(() => {
    return options.find((c) => String(c.id) === String(selectedCamera)) || options[0];
  }, [options, selectedCamera]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearchFilter("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      setSearchFilter("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % filteredOptions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const chosen = filteredOptions[highlightedIndex];
      if (chosen) {
        onSelect(chosen.id);
        setIsOpen(false);
        setSearchFilter("");
      }
    }
  };

  return (
    <div
      className={`nh-custom-dropdown ${compact ? "compact" : ""} ${isOpen ? "open" : ""}`}
      ref={dropdownRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="combobox"
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      aria-label="Filter network performance by camera"
    >
      <button
        type="button"
        className={`nh-dropdown-trigger ${compact ? "compact" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`Select camera, currently: ${selectedOption.name}`}
      >
        <span className="nh-trigger-content">
          <Camera
            size={compact ? 13 : 15}
            className="nh-trigger-camera-icon"
            style={{ color: selectedOption.color || "var(--nh-green)" }}
          />
          <span className="nh-trigger-title">{selectedOption.name}</span>
          {!compact && selectedOption.ip && <span className="nh-trigger-ip">({selectedOption.ip})</span>}
          {selectedOption.isAll && cameras.length > 0 && (
            <span className="nh-all-cams-count">{cameras.length} cameras</span>
          )}
        </span>
        <ChevronDown size={14} className={`nh-dropdown-arrow ${isOpen ? "rotate" : ""}`} />
      </button>

      {isOpen && (
        <ul className={`nh-dropdown-menu ${compact ? "compact" : ""}`} role="listbox">
          {options.length > 5 && (
            <li className="nh-dropdown-search-wrap" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                className="nh-dropdown-search-input"
                placeholder="Search camera or IP..."
                value={searchFilter}
                onChange={(e) => {
                  setSearchFilter(e.target.value);
                  setHighlightedIndex(0);
                }}
                autoFocus
              />
            </li>
          )}
          {filteredOptions.map((opt, idx) => {
            const isSelected = String(opt.id) === String(selectedCamera);
            const isHighlighted = idx === highlightedIndex;
            return (
              <li
                key={opt.id}
                role="option"
                aria-selected={isSelected}
                className={`nh-dropdown-item ${isSelected ? "selected" : ""} ${isHighlighted ? "highlighted" : ""}`}
                onClick={() => {
                  onSelect(opt.id);
                  setIsOpen(false);
                  setSearchFilter("");
                }}
                onMouseEnter={() => setHighlightedIndex(idx)}
              >
                <div className="nh-item-text">
                  <div className="nh-item-name-row">
                    {!opt.isAll && (
                      <span
                        className="nh-camera-color-dot"
                        style={{ background: opt.color || "var(--nh-green)" }}
                      />
                    )}
                    <span className="nh-item-name">{opt.name}</span>
                  </div>
                  {opt.ip && <span className="nh-item-ip">{opt.ip}</span>}
                  {opt.isAll && (
                    <span className="nh-item-ip">Total overall network performance</span>
                  )}
                </div>
                <div className="nh-item-badge-wrap">
                  {opt.latency_ms != null ? (
                    <span className="nh-bitrate-badge live">{opt.latency_ms.toFixed(1)} ms</span>
                  ) : opt.latest_bitrate_mbps != null ? (
                    <span className="nh-bitrate-badge live">{opt.latest_bitrate_mbps.toFixed(2)} Mbps</span>
                  ) : opt.isAll ? (
                    <span className="nh-all-pill">{opt.count} cameras</span>
                  ) : (
                    <span className="nh-bitrate-badge unmeasured">
                      {opt.status || "Registered"}
                    </span>
                  )}
                  {isSelected && <Check size={14} className="nh-item-check" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const SearchableCameraDropdown = CameraDropdown;

const NetworkHealthPage = () => {
  const [metrics, setMetrics] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyCameras, setHistoryCameras] = useState([]);
  const [historyScope, setHistoryScope] = useState("all");
  const [historyAvailable, setHistoryAvailable] = useState(false);
  const [range, setRange] = useState("1h");
  const [trendRange, setTrendRange] = useState("1h");
  const [trendHistory, setTrendHistory] = useState([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [isSystemRefreshing, setIsSystemRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState("all");
  const [perfCamera, setPerfCamera] = useState("all");
  const [hoveredCameraId, setHoveredCameraId] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyWindow, setHistoryWindow] = useState({ start: null, end: null });
  const [deviceStats, setDeviceStats] = useState([]);
  const [diagnosingIp, setDiagnosingIp] = useState("");
  const [diagResult, setDiagResult] = useState(null);
  const [isPinging, setIsPinging] = useState(false);
  const [activeSection, setActiveSection] = useState("monitoring");
  const [hoveredTrendPoint, setHoveredTrendPoint] = useState(null);

  // Fetch live infrastructure metrics
  const fetchLiveMetrics = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/network-health/overview`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Authentication required. Please sign in.");
        }
        throw new Error(`Overview request failed (${response.status})`);
      }
      const data = await response.json();
      setMetrics(data);
      setPageError("");
    } catch (error) {
      console.error("Network Health metrics fetch failed:", error);
      setPageError(error.message || "Could not load live metrics from backend.");
    } finally {
      setLoading(false);
    }
  }, []);

  const camerasRef = useRef(cameras);
  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  // Fetch registered cameras
  const fetchCameras = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/network-health/cameras`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Camera list request failed (${response.status})`);
      }
      const payload = await response.json();
      const list = asArray(payload).map(normalizeCamera);
      setCameras(list);

      if (selectedCamera !== "all" && !list.some((cam) => String(cam.id) === String(selectedCamera))) {
        setSelectedCamera("all");
      }
    } catch (error) {
      console.error("Registered camera fetch failed:", error);
    }
  }, [selectedCamera]);

  const hasInitialHistoryRef = useRef(false);

  // Fetch telemetry history for System Telemetry Trends (bottom chart)
  const fetchHistory = useCallback(async (force = false) => {
    if (!hasInitialHistoryRef.current || force) {
      setHistoryLoading(true);
    }
    try {
      const query = new URLSearchParams({ range, _t: String(Date.now()) });
      const currentCameras = camerasRef.current;
      if (selectedCamera !== "all") {
        const cam = currentCameras.find((item) => String(item.id) === String(selectedCamera));
        if (cam?.id) query.set("camera_id", cam.id);
        if (cam?.ip) query.set("camera_ip", cam.ip);
      }
      const response = await fetch(`${API_BASE}/api/network-health/history?${query.toString()}`, {
        headers: authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Telemetry history request failed (${response.status})`);
      }
      const payload = await response.json();
      setHistoryScope(payload.scope || (selectedCamera === "all" ? "all" : "camera"));
      setHistoryAvailable(Boolean(payload.data_available));
      setHistoryWindow({
        start: payload.start_time || null,
        end: payload.end_time || null,
      });
      const points = asArray(payload.data).map(normalizeHistoryPoint);
      setHistory(points);
      hasInitialHistoryRef.current = true;

      // Extract camera series information for multi-color area rendering
      if (payload.scope === "all" && Array.isArray(payload.cameras) && payload.cameras.length > 0) {
        setHistoryCameras(payload.cameras.map((c, i) => ({
          ...c,
          color: c.color || DEFAULT_CAMERA_COLORS[i % DEFAULT_CAMERA_COLORS.length],
          dataKey: c.dataKey || `cam_${c.id}`,
        })));
      } else if (selectedCamera !== "all") {
        const cam = currentCameras.find((c) => String(c.id) === String(selectedCamera));
        if (cam) {
          setHistoryCameras([cam]);
        }
      } else {
        setHistoryCameras(currentCameras);
      }
    } catch (error) {
      console.error("Telemetry history fetch failed:", error);
      if (!hasInitialHistoryRef.current) {
        setHistory([]);
        setHistoryAvailable(false);
        setHistoryWindow({ start: null, end: null });
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [range, selectedCamera]);

  // Fetch telemetry history specifically for Card 1 (Bandwidth Trends)
  const fetchTrendHistory = useCallback(async (selectedTrendRange) => {
    const r = selectedTrendRange || trendRange;
    setTrendLoading(true);
    try {
      const query = new URLSearchParams({
        range: r,
        _t: String(Date.now()),
      });
      const response = await fetch(`${API_BASE}/api/network-health/history?${query.toString()}`, {
        headers: authHeaders(),
      });
      if (response.ok) {
        const payload = await response.json();
        const points = asArray(payload.data).map(normalizeHistoryPoint);
        setTrendHistory(points);
      }
    } catch (err) {
      console.error("Trend history fetch failed:", err);
    } finally {
      setTrendLoading(false);
    }
  }, [trendRange]);

  // Fetch diagnostic matrix nodes
  const fetchDiagnostics = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/network-health/diagnostics`, {
        headers: authHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        setDeviceStats(asArray(data.nodes || data));
      }
    } catch (error) {
      console.error("Diagnostics fetch failed:", error);
    }
  }, []);

  useEffect(() => {
    fetchLiveMetrics();
    fetchCameras();
    fetchDiagnostics();
    const timer = setInterval(() => {
      fetchLiveMetrics();
      fetchCameras();
    }, 10000);
    return () => clearInterval(timer);
  }, [fetchLiveMetrics, fetchCameras, fetchDiagnostics]);

  useEffect(() => {
    fetchHistory();
    const historyTimer = setInterval(() => fetchHistory(false), 10000);
    return () => clearInterval(historyTimer);
  }, [fetchHistory]);

  useEffect(() => {
    fetchTrendHistory(trendRange);
    const trendTimer = setInterval(() => fetchTrendHistory(trendRange), 10000);
    return () => clearInterval(trendTimer);
  }, [fetchTrendHistory, trendRange]);

  const net = metrics?.network || {};
  const storage = metrics?.storage || {};
  const replication = metrics?.replication || {};
  const mongo = metrics?.mongo || {};
  const cpu = metrics?.cpu || metrics?.processors || {};
  const ram = metrics?.ram || metrics?.processors || {};

  const selectedCameraInfo = useMemo(() => {
    if (selectedCamera === "all") return null;
    return cameras.find((c) => String(c.id) === String(selectedCamera)) || null;
  }, [cameras, selectedCamera]);

  // ─── Real Network Metrics Derived from MongoDB Telemetry ────────────────
  const totalIngestMbps = useMemo(() => {
    const sumCams = cameras.reduce((acc, c) => acc + (c.latest_bitrate_mbps || 0), 0);
    if (sumCams > 0) return Number(sumCams.toFixed(2));
    if (net.camera_ingest_mbps != null && net.camera_ingest_mbps > 0) return net.camera_ingest_mbps;
    if (net.incoming_mbps != null && net.incoming_mbps > 0) return net.incoming_mbps;
    if (metrics?.nic_throughput?.rx_mbps != null && metrics.nic_throughput.rx_mbps > 0) {
      return metrics.nic_throughput.rx_mbps;
    }
    return null;
  }, [cameras, net, metrics]);

  const activeStreamCount = useMemo(() => {
    if (net.active_stream_count != null && net.active_stream_count > 0) return net.active_stream_count;
    const activeCams = cameras.filter((c) => c.latest_bitrate_mbps != null && c.latest_bitrate_mbps > 0);
    return activeCams.length > 0 ? activeCams.length : (cameras.length || 0);
  }, [net, cameras]);

  const latencyStats = useMemo(() => {
    if (metrics?.camera_latency?.avg_latency_ms != null) {
      return metrics.camera_latency;
    }
    const latList = [];
    const lossList = [];
    let maxLat = -1;
    let slowest = null;

    deviceStats.forEach((d) => {
      const lat = numberOrNull(d.latency);
      const loss = numberOrNull(d.packet_loss);
      if (lat != null) {
        latList.push(lat);
        if (lat > maxLat) {
          maxLat = lat;
          slowest = d.ip || d.name || "Camera";
        }
      }
      if (loss != null) lossList.push(loss);
    });

    const avgLat = latList.length > 0 ? latList.reduce((a, b) => a + b, 0) / latList.length : null;
    const avgLoss = lossList.length > 0 ? lossList.reduce((a, b) => a + b, 0) / lossList.length : 0.0;

    return {
      status: avgLat != null ? (avgLat < 100 ? "Healthy" : "Degraded") : "Checking",
      avg_latency_ms: avgLat,
      min_latency_ms: latList.length > 0 ? Math.min(...latList) : null,
      max_latency_ms: latList.length > 0 ? Math.max(...latList) : null,
      packet_loss_pct: avgLoss,
      slowest_node: slowest,
      cameras_measured: latList.length,
    };
  }, [metrics, deviceStats]);

  const nicRxMbps = numberOrNull(metrics?.nic_throughput?.rx_mbps ?? net.rx_mbps ?? net.recv_mbps);
  const nicTxMbps = numberOrNull(metrics?.nic_throughput?.tx_mbps ?? net.tx_mbps ?? net.sent_mbps);
  const nicLinkSpeed = numberOrNull(metrics?.nic_throughput?.nic_speed_mbps || net.nic_speed || net.nic_speed_mbps);
  const nicStatus = metrics?.nic_throughput?.status || (nicRxMbps != null ? "Connected" : "Unavailable");

  const lanUtilization = useMemo(() => {
    if (metrics?.nic_throughput?.utilization_pct != null) return metrics.nic_throughput.utilization_pct;
    if (net.lan_utilization_pct != null) return net.lan_utilization_pct;
    if (nicLinkSpeed && nicLinkSpeed > 0 && nicRxMbps != null) {
      const rx = nicRxMbps;
      const tx = nicTxMbps || 0;
      return Number((((rx + tx) / nicLinkSpeed) * 100).toFixed(2));
    }
    return null;
  }, [metrics, net, nicRxMbps, nicTxMbps, nicLinkSpeed]);

  const headroomMbps = useMemo(() => {
    if (nicLinkSpeed == null) return null;
    const totalTraffic = (nicRxMbps || (totalIngestMbps ?? 0)) + (nicTxMbps || 0);
    return Math.max(0, Number((nicLinkSpeed - totalTraffic).toFixed(2)));
  }, [nicRxMbps, nicTxMbps, totalIngestMbps, nicLinkSpeed]);

  const channelBitrates = useMemo(() => {
    let peak = null;
    let min = null;
    let highestCamIdentifier = null;
    let lowestCamIdentifier = null;
    let healthyCount = 0;
    let unhealthyCount = 0;

    cameras.forEach((c) => {
      const r = numberOrNull(c.latest_bitrate_mbps);
      const label = c.name || c.ip || "Camera";
      if (r != null && r > 0) {
        healthyCount++;
        if (peak == null || r > peak) {
          peak = r;
          highestCamIdentifier = label;
        }
        if (min == null || r < min) {
          min = r;
          lowestCamIdentifier = label;
        }
      } else {
        unhealthyCount++;
      }
    });

    return {
      peak,
      min,
      highestCamIdentifier,
      lowestCamIdentifier,
      count: cameras.length,
      healthyCount,
      unhealthyCount,
    };
  }, [cameras]);

  // Derived graph telemetry metrics directly relatable to the timeline trends graph
  const graphStats = useMemo(() => {
    if (!history || history.length === 0) {
      return {
        peakMbps: totalIngestMbps,
        avgMbps: totalIngestMbps,
        minMbps: totalIngestMbps,
        sampleCount: 0,
        dataCoverageText: `${range.toUpperCase()} window`,
        lastSampleLabel: "Awaiting telemetry",
        timelineWindow: range.toUpperCase(),
      };
    }

    const rates = history
      .map((p) => numberOrNull(p.bandwidth_mbps ?? p.incoming_mbps))
      .filter((v) => v != null && v > 0);

    const peak = rates.length > 0 ? Math.max(...rates) : totalIngestMbps;
    const min = rates.length > 0 ? Math.min(...rates) : totalIngestMbps;
    const avg = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : totalIngestMbps;

    let coverageText = `${range.toUpperCase()} window`;
    if (range === "7d") {
      const uniqueDays = new Set();
      history.forEach((pt) => {
        if (pt.timestamp) {
          const d = new Date(pt.timestamp);
          if (!Number.isNaN(d.getTime())) {
            uniqueDays.add(d.toISOString().slice(0, 10));
          }
        }
      });
      const daysCount = Math.max(1, uniqueDays.size);
      coverageText = `${daysCount} of 7 days covered`;
    } else {
      coverageText = `${range.toUpperCase()} telemetry continuous`;
    }

    let lastLabel = "Live ingestion";
    const lastPoint = history[history.length - 1];
    if (lastPoint?.timestamp) {
      const dt = new Date(lastPoint.timestamp);
      if (!Number.isNaN(dt.getTime())) {
        lastLabel = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }
    }

    return {
      peakMbps: Number(peak.toFixed(2)),
      avgMbps: Number(avg.toFixed(2)),
      minMbps: Number(min.toFixed(2)),
      sampleCount: rates.length || history.length,
      dataCoverageText: coverageText,
      lastSampleLabel: lastLabel,
      timelineWindow: range.toUpperCase(),
    };
  }, [history, totalIngestMbps, range]);

  // ─── Time Domain & Dynamic Ticks Calculation ──────────────────────────
  const { startMs, endMs, ticks, daySlots } = useMemo(() => {
    const serverEnd = historyWindow.end ? new Date(historyWindow.end).getTime() : Date.now();
    const end = Number.isFinite(serverEnd) ? serverEnd : Date.now();

    if (range === "7d") {
      // 7 calendar days leading up to today
      const today = new Date(end);
      today.setHours(23, 59, 59, 999);
      const endDayMs = today.getTime();

      // 6 days ago at 00:00:00.000
      const startDay = new Date(today);
      startDay.setDate(startDay.getDate() - 6);
      startDay.setHours(0, 0, 0, 0);
      const startDayMs = startDay.getTime();

      const dayDurationMs = 24 * 60 * 60 * 1000;
      const calculatedTicks = [];
      const slots = [];

      for (let i = 0; i < 7; i++) {
        const slotStart = startDayMs + i * dayDurationMs;
        const slotEnd = slotStart + dayDurationMs;
        const slotDate = new Date(slotStart);
        const dateKey = `${slotDate.getFullYear()}-${String(slotDate.getMonth() + 1).padStart(2, "0")}-${String(slotDate.getDate()).padStart(2, "0")}`;

        calculatedTicks.push(slotStart);
        slots.push({
          dateKey,
          startMs: slotStart,
          endMs: slotEnd,
          dateObj: slotDate,
        });
      }

      return {
        startMs: startDayMs,
        endMs: endDayMs,
        ticks: calculatedTicks,
        daySlots: slots,
      };
    }

    let durationMs = 60 * 60 * 1000; // default 1h
    let tickCount = 7;
    if (range === "6h") {
      durationMs = 6 * 60 * 60 * 1000;
      tickCount = 7; // hourly ticks
    } else if (range === "9h") {
      durationMs = 9 * 60 * 60 * 1000;
      tickCount = 7; // 1.5h ticks
    } else if (range === "24h") {
      durationMs = 24 * 60 * 60 * 1000;
      tickCount = 7; // every 4 hours
    }

    const start = end - durationMs;
    const step = durationMs / (tickCount - 1);
    const calculatedTicks = [];
    for (let i = 0; i < tickCount; i++) {
      calculatedTicks.push(Math.round(start + i * step));
    }

    return {
      startMs: start,
      endMs: end,
      ticks: calculatedTicks,
      daySlots: [],
    };
  }, [range, historyWindow.end]);

  // Readable, non-overlapping label formatter for X-Axis
  const formatXAxisTick = useCallback((tickMs) => {
    if (!tickMs || !Number.isFinite(tickMs)) return "";
    const d = new Date(tickMs);
    if (Number.isNaN(d.getTime())) return "";

    if (range === "1h") {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
    }
    if (range === "6h" || range === "9h") {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
    }
    if (range === "24h") {
      const month = d.toLocaleDateString([], { month: "short" });
      const day = d.getDate();
      const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
      return `${month} ${day}, ${timeStr}`;
    }
    // 7d
    const month = d.toLocaleDateString([], { month: "short" });
    const day = d.getDate();
    return `${month} ${day}`;
  }, [range]);

  // Expand real recorded points across each day's region, maintaining continuity unless no recordings exist
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return [];

    if (range === "7d" && daySlots.length > 0) {
      // Group genuine MongoDB telemetry records by calendar date
      const pointsByDay = new Map();
      history.forEach((pt) => {
        if (!pt.timestamp) return;
        const d = new Date(pt.timestamp);
        if (Number.isNaN(d.getTime())) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (!pointsByDay.has(key)) {
          pointsByDay.set(key, []);
        }
        pointsByDay.get(key).push(pt);
      });

      const expandedChartPoints = [];

      daySlots.forEach((slot, slotIdx) => {
        const dayPoints = pointsByDay.get(slot.dateKey) || [];

        // Sort real points chronologically for this day
        dayPoints.sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));

        if (dayPoints.length === 0) {
          // NO recordings for this day -> do not show graph for this day
          return;
        }

        // Days recordings are present: expand within that day's region with real MongoDB data
        const edgePadding = 20 * 60 * 1000; // 20 min margin inside the day slot
        const usableStart = slot.startMs + edgePadding;
        const usableEnd = slot.endMs - edgePadding;
        const usableSpan = Math.max(1, usableEnd - usableStart);

        // Terminate any previous line segment so days without recordings stay blank
        if (expandedChartPoints.length > 0) {
          const lastPt = expandedChartPoints[expandedChartPoints.length - 1];
          if (usableStart - lastPt.timeMs > 30 * 60 * 1000) {
            const gapPtBefore = {
              timeMs: usableStart - 60000,
              timestamp: new Date(usableStart - 60000).toISOString(),
              incoming_mbps: null,
              bandwidth_mbps: null,
              isGap: true,
            };
            historyCameras.forEach((cam) => {
              gapPtBefore[cam.dataKey] = null;
              gapPtBefore[`cam_${cam.id}`] = null;
            });
            expandedChartPoints.push(gapPtBefore);
          }
        }

        if (dayPoints.length === 1) {
          const single = dayPoints[0];
          expandedChartPoints.push({
            ...single,
            timeMs: usableStart,
          });
          expandedChartPoints.push({
            ...single,
            timeMs: usableEnd,
          });
        } else {
          dayPoints.forEach((pt, idx) => {
            const fraction = idx / (dayPoints.length - 1);
            const mappedTimeMs = Math.round(usableStart + fraction * usableSpan);
            expandedChartPoints.push({
              ...pt,
              timeMs: mappedTimeMs,
            });
          });
        }

        // Clean termination at the end of this day
        const nextSlot = daySlots[slotIdx + 1];
        const nextHasData = nextSlot && (pointsByDay.get(nextSlot.dateKey)?.length ?? 0) > 0;
        if (!nextHasData) {
          const gapPtAfter = {
            timeMs: usableEnd + 60000,
            timestamp: new Date(usableEnd + 60000).toISOString(),
            incoming_mbps: null,
            bandwidth_mbps: null,
            isGap: true,
          };
          historyCameras.forEach((cam) => {
            gapPtAfter[cam.dataKey] = null;
            gapPtAfter[`cam_${cam.id}`] = null;
          });
          expandedChartPoints.push(gapPtAfter);
        }
      });

      return expandedChartPoints;
    }

    // Default 1h and 24h continuous representation
    const validPoints = history
      .filter((p) => p.timeMs !== null && p.timeMs >= startMs - 60000 && p.timeMs <= endMs + 60000)
      .sort((a, b) => a.timeMs - b.timeMs);

    if (validPoints.length === 0) return [];

    let gapThreshold = 10 * 60 * 1000; // 10 min for 1h (aligned with telemetry trends cadence)
    if (range === "6h") {
      gapThreshold = 15 * 60 * 1000; // 15 min for 6h
    } else if (range === "9h") {
      gapThreshold = 20 * 60 * 1000; // 20 min for 9h
    } else if (range === "24h") {
      gapThreshold = 30 * 60 * 1000; // 30 min for 24h
    }

    const pointsWithGaps = [];
    for (let i = 0; i < validPoints.length; i++) {
      const pt = validPoints[i];
      if (i > 0) {
        const prevPt = validPoints[i - 1];
        const diff = pt.timeMs - prevPt.timeMs;
        if (diff > gapThreshold) {
          const gapPt1 = {
            timeMs: prevPt.timeMs + 1000,
            timestamp: new Date(prevPt.timeMs + 1000).toISOString(),
            incoming_mbps: null,
            bandwidth_mbps: null,
            isGap: true,
          };
          const gapPt2 = {
            timeMs: pt.timeMs - 1000,
            timestamp: new Date(pt.timeMs - 1000).toISOString(),
            incoming_mbps: null,
            bandwidth_mbps: null,
            isGap: true,
          };
          historyCameras.forEach((cam) => {
            if (cam.dataKey) {
              gapPt1[cam.dataKey] = null;
              gapPt2[cam.dataKey] = null;
            }
            gapPt1[`cam_${cam.id}`] = null;
            gapPt2[`cam_${cam.id}`] = null;
          });
          pointsWithGaps.push(gapPt1, gapPt2);
        }
      }
      pointsWithGaps.push(pt);
    }
    return pointsWithGaps;
  }, [history, startMs, endMs, range, historyCameras, daySlots]);

  // Dynamic Y-Axis scale calculated from actual bandwidth measurements in view
  const yDomain = useMemo(() => {
    let maxVal = 0;
    for (const pt of chartData) {
      if (pt.isGap) continue;
      if (selectedCamera === "all") {
        if (pt.incoming_mbps != null && pt.incoming_mbps > maxVal) {
          maxVal = pt.incoming_mbps;
        }
        for (const cam of historyCameras) {
          const v = pt[cam.dataKey] ?? pt[`cam_${cam.id}`];
          if (v != null && v > maxVal) maxVal = v;
        }
      } else {
        const v = pt.bandwidth_mbps ?? pt.incoming_mbps;
        if (v != null && v > maxVal) maxVal = v;
      }
    }

    if (maxVal <= 0) return [0, 1.0];

    const ceiling = maxVal * 1.15;
    let rounded;
    if (ceiling <= 0.5) {
      rounded = 0.5;
    } else if (ceiling <= 2.0) {
      rounded = Math.ceil(ceiling * 10) / 10;
    } else if (ceiling <= 5.0) {
      rounded = Math.ceil(ceiling * 2) / 2;
    } else {
      rounded = Math.ceil(ceiling);
    }
    return [0, rounded];
  }, [chartData, historyCameras, selectedCamera]);

  const runInstantCheck = async (event) => {
    event?.preventDefault();
    const target = diagnosingIp.trim();
    if (!target) return;
    setIsPinging(true);
    setDiagResult(null);
    try {
      const response = await fetch(`${API_BASE}/api/network-health/diagnostics?ip=${encodeURIComponent(target)}`, {
        headers: authHeaders(),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.detail || `Diagnostic check failed (${response.status}).`);
      }
      setDiagResult({
        ip: result.ip || target,
        status: result.status || "Unknown",
        latency: result.latency ?? null,
        ports: result.ports || {},
        error: result.error || null,
      });
    } catch (error) {
      setDiagResult({ ip: target, status: "Unavailable", error: error.message || "Diagnostic request failed." });
    } finally {
      setIsPinging(false);
    }
  };

  const refreshAll = () => {
    fetchLiveMetrics();
    fetchCameras();
    fetchTrendHistory(trendRange);
    fetchHistory(true);
    fetchDiagnostics();
  };


  // Derived independent telemetry stats for Bandwidth Trends card (isolated from System Telemetry Trends)
  const trendStats = useMemo(() => {
    if (!trendHistory || trendHistory.length === 0) {
      return {
        peakMbps: totalIngestMbps,
        avgMbps: totalIngestMbps,
        minMbps: totalIngestMbps,
        sampleCount: 0,
        dataCoverageText: `${trendRange.toUpperCase()} window`,
        lastSampleLabel: "Awaiting telemetry",
        timelineWindow: trendRange.toUpperCase(),
      };
    }

    const rates = trendHistory
      .map((p) => numberOrNull(p.bandwidth_mbps ?? p.incoming_mbps))
      .filter((v) => v != null && v > 0);

    const peak = rates.length > 0 ? Math.max(...rates) : (totalIngestMbps || 0);
    const min = rates.length > 0 ? Math.min(...rates) : (totalIngestMbps || 0);
    const avg = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : (totalIngestMbps || 0);

    let lastLabel = "Live ingestion";
    const lastPoint = trendHistory[trendHistory.length - 1];
    if (lastPoint?.timestamp) {
      const dt = new Date(lastPoint.timestamp);
      if (!Number.isNaN(dt.getTime())) {
        lastLabel = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }
    }

    return {
      peakMbps: Number(peak.toFixed(2)),
      avgMbps: Number(avg.toFixed(2)),
      minMbps: Number(min.toFixed(2)),
      sampleCount: rates.length || trendHistory.length,
      lastSampleLabel: lastLabel,
      timelineWindow: trendRange.toUpperCase(),
    };
  }, [trendHistory, totalIngestMbps, trendRange]);

  // Card 1 Visual A: Live Area Waveform for 1H, 6H, 9H
  const card1WaveData = useMemo(() => {
    if (trendRange === "24h" || trendRange === "7d") return null;
    const width = 340;
    const height = 120;
    const padding = { top: 16, bottom: 20, left: 10, right: 10 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const validPoints = (trendHistory || []).filter((p) => !p.isGap && (p.incoming_mbps != null || p.bandwidth_mbps != null));
    if (validPoints.length === 0) {
      return { hasData: false };
    }

    const rates = validPoints.map((p) => p.bandwidth_mbps ?? p.incoming_mbps ?? 0);
    const maxVal = Math.max(...rates, trendStats.peakMbps || 1.0, 0.2);
    const avgVal = trendStats.avgMbps || (rates.reduce((a, b) => a + b, 0) / rates.length);

    const coords = validPoints.map((pt, idx) => {
      const val = pt.bandwidth_mbps ?? pt.incoming_mbps ?? 0;
      const x = padding.left + (validPoints.length === 1 ? chartW / 2 : (idx / (validPoints.length - 1)) * chartW);
      const y = padding.top + chartH - (val / maxVal) * chartH;
      return { x, y, val, time: pt.time };
    });

    const pathD = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
    const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padding.bottom} L ${coords[0].x.toFixed(1)} ${height - padding.bottom} Z`;

    const highest = coords.reduce((max, c) => (c.val > max.val ? c : max), coords[0]);
    const lastCoord = coords[coords.length - 1];
    const avgY = padding.top + chartH - (avgVal / maxVal) * chartH;

    const startLabel = validPoints[0]?.time || "Start";
    const endLabel = validPoints[validPoints.length - 1]?.time || "Now";

    return {
      hasData: true,
      pathD,
      areaD,
      peakX: highest.x,
      peakY: highest.y,
      peakVal: highest.val,
      latestX: lastCoord?.x ?? highest.x,
      latestY: lastCoord?.y ?? highest.y,
      latestVal: lastCoord?.val ?? highest.val,
      avgY,
      startLabel,
      endLabel,
      coords,
    };
  }, [trendHistory, trendStats, trendRange]);

  const handleTrendMouseMove = useCallback((e) => {
    if (!card1WaveData?.coords || card1WaveData.coords.length === 0) return;
    const svgRect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - svgRect.left;
    const svgWidth = svgRect.width || 340;
    const scaleX = 340 / svgWidth;
    const viewX = mouseX * scaleX;

    let closest = card1WaveData.coords[0];
    let minDist = Math.abs(closest.x - viewX);
    for (let i = 1; i < card1WaveData.coords.length; i++) {
      const pt = card1WaveData.coords[i];
      const dist = Math.abs(pt.x - viewX);
      if (dist < minDist) {
        minDist = dist;
        closest = pt;
      }
    }
    setHoveredTrendPoint(closest);
  }, [card1WaveData]);

  const handleTrendMouseLeave = useCallback(() => {
    setHoveredTrendPoint(null);
  }, []);

  // Card 1 Visual B: Clean 24-Hour Hourly Histogram (12 Two-Hour Intervals, No Squishing!)
  const card1HourlyData = useMemo(() => {
    if (trendRange !== "24h") return null;
    const now = Date.now();
    const duration24h = 24 * 60 * 60 * 1000;
    const start24h = now - duration24h;
    const slotDuration = 2 * 60 * 60 * 1000; // 12 intervals of 2 hours

    const slots = [];
    for (let i = 0; i < 12; i++) {
      const slotStart = start24h + i * slotDuration;
      const slotEnd = slotStart + slotDuration;
      const d = new Date(slotStart);
      const label = d.toLocaleTimeString([], { hour: "numeric", hour12: true });
      slots.push({
        slotStart,
        slotEnd,
        label,
        rates: [],
      });
    }

    (trendHistory || []).forEach((pt) => {
      const ts = pt.timeMs || (pt.timestamp ? new Date(pt.timestamp).getTime() : null);
      const rate = numberOrNull(pt.bandwidth_mbps ?? pt.incoming_mbps);
      if (ts != null && rate != null && rate > 0) {
        const slot = slots.find((s) => ts >= s.slotStart && ts < s.slotEnd);
        if (slot) slot.rates.push(rate);
      }
    });

    let overallMax = 0.5;
    slots.forEach((s) => {
      if (s.rates.length > 0) {
        s.peak = Math.max(...s.rates);
        s.avg = s.rates.reduce((a, b) => a + b, 0) / s.rates.length;
        if (s.peak > overallMax) overallMax = s.peak;
      } else {
        s.peak = 0;
        s.avg = 0;
      }
    });

    const highestSlot = slots.reduce((max, s) => (s.peak > max.peak ? s : max), slots[0]);

    return {
      slots: slots.map((s) => ({
        ...s,
        isPeak: s.peak > 0 && s.peak === highestSlot.peak,
        heightPct: s.peak > 0 ? Math.max(10, Math.min(100, Math.round((s.peak / overallMax) * 100))) : 0,
        hasData: s.rates.length > 0,
      })),
      overallMax,
    };
  }, [trendHistory, trendRange]);

  // Card 1 Visual C: 7-Day Clean Daily Columns (Mon - Sun / Today)
  const card1DailyData = useMemo(() => {
    if (trendRange !== "7d") return null;
    const now = new Date();

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const dateNum = String(d.getDate()).padStart(2, "0");
      const dateKey = `${year}-${month}-${dateNum}`;
      const dayName = d.toLocaleDateString([], { weekday: "short" });
      const dateLabel = d.toLocaleDateString([], { month: "short", day: "numeric" });
      const isToday = i === 0;

      days.push({
        dateKey,
        dayName,
        dateLabel,
        isToday,
        rates: [],
      });
    }

    (trendHistory || []).forEach((pt) => {
      if (!pt.timestamp) return;
      const d = new Date(pt.timestamp);
      if (Number.isNaN(d.getTime())) return;
      const localKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const utcKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      const rate = numberOrNull(pt.bandwidth_mbps ?? pt.incoming_mbps);
      const day = days.find((item) => item.dateKey === localKey || item.dateKey === utcKey);
      if (day && rate != null && rate > 0) {
        day.rates.push(rate);
      }
    });

    let overallMax = 0.5;
    days.forEach((d) => {
      if (d.rates.length > 0) {
        d.peak = Math.max(...d.rates);
        d.avg = d.rates.reduce((a, b) => a + b, 0) / d.rates.length;
        if (d.peak > overallMax) overallMax = d.peak;
      } else {
        d.peak = 0;
        d.avg = 0;
      }
    });

    const highestDay = days.reduce((max, d) => (d.peak > max.peak ? d : max), days[0]);

    return {
      days: days.map((d) => ({
        ...d,
        isPeak: d.peak > 0 && d.peak === highestDay.peak,
        heightPct: d.peak > 0 ? Math.max(12, Math.min(100, Math.round((d.peak / overallMax) * 100))) : 0,
        hasData: d.rates.length > 0,
      })),
      overallMax,
    };
  }, [trendHistory, trendRange]);

  // Card 3: LAN Gauge Calculation
  const card3Gauge = useMemo(() => {
    const radius = 54;
    const center = { x: 85, y: 75 };
    // 240 degree open arc from 150 deg to 390 deg
    const arcAngle = 240;
    const arcCircumference = (arcAngle / 360) * 2 * Math.PI * radius; // ~226.19
    const util = Math.min(100, Math.max(0, lanUtilization || 0));
    const strokeDashoffset = arcCircumference - (arcCircumference * util) / 100;
    const gaugeColor = util > 90 ? "#fb7185" : util > 70 ? "#f6b94b" : "#00d9ff";

    return {
      radius,
      center,
      arcCircumference,
      strokeDashoffset,
      gaugeColor,
      util,
    };
  }, [lanUtilization]);

  // Card: Network Performance (Latency & Packet Loss Visualization)
  const card5Perf = useMemo(() => {
    if (perfCamera !== "all") {
      const single = cameras.find((c) => String(c.id) === String(perfCamera));
      const camDiag = deviceStats.find((d) =>
        (single?.ip && d.ip === single.ip) ||
        (single?.id && d.id === single.id) ||
        (d.ip && d.ip === single?.ip_address)
      );

      const latVal = single?.latency_ms != null ? single.latency_ms : numberOrNull(camDiag?.latency);
      const lossVal = single?.packet_loss != null ? single.packet_loss : numberOrNull(camDiag?.packet_loss);

      let statusText = "Unavailable";
      if (latVal != null) {
        statusText = latVal < 100 ? "Optimal" : latVal < 200 ? "Moderate" : "High Latency";
      }

      return {
        isSingle: true,
        latVal,
        loss: lossVal,
        statusText,
        camera: single,
      };
    }

    // All Cameras Fleet View
    const latVal = latencyStats.avg_latency_ms != null ? latencyStats.avg_latency_ms : null;
    const lossVal = latencyStats.packet_loss_pct != null ? latencyStats.packet_loss_pct : null;

    let statusText = "Unavailable";
    if (latVal != null) {
      statusText = latVal < 100 ? "Optimal" : latVal < 200 ? "Moderate" : "High Latency";
    }

    return {
      isSingle: false,
      latVal,
      loss: lossVal,
      statusText,
      totalCams: cameras.length,
      camerasMeasured: latencyStats.cameras_measured || cameras.filter((c) => c.latency_ms != null).length,
    };
  }, [cameras, perfCamera, latencyStats, deviceStats]);

  // Card 6: Telemetry Health Timeline
  const card6Timeline = useMemo(() => {
    const valid = (history || []).filter((p) => !p.isGap && (p.bandwidth_mbps != null || p.incoming_mbps != null || p.timestamp));
    const recent = valid.slice(-7);

    let isFresh = false;
    let latestTimeStr = "—";
    const lastPoint = valid[valid.length - 1];

    if (lastPoint?.timestamp) {
      const ts = new Date(lastPoint.timestamp).getTime();
      if (!Number.isNaN(ts)) {
        isFresh = (Date.now() - ts) < 45000;
        latestTimeStr = new Date(lastPoint.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }
    } else if (selectedCamera !== "all" && selectedCameraInfo?.latest_measurement_timestamp) {
      const ts = new Date(selectedCameraInfo.latest_measurement_timestamp).getTime();
      if (!Number.isNaN(ts)) {
        isFresh = (Date.now() - ts) < 45000;
        latestTimeStr = new Date(selectedCameraInfo.latest_measurement_timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }
    }

    // Check for genuine gaps > 10 mins between consecutive points (aligned with System Telemetry Trends timing)
    const pointsWithGaps = recent.map((pt, i) => {
      let isGapBefore = false;
      if (i > 0 && recent[i - 1].timestamp && pt.timestamp) {
        const prevTs = new Date(recent[i - 1].timestamp).getTime();
        const currTs = new Date(pt.timestamp).getTime();
        if (currTs - prevTs > 10 * 60 * 1000) {
          isGapBefore = true;
        }
      }
      const val = pt.bandwidth_mbps ?? pt.incoming_mbps;
      return {
        ...pt,
        isGapBefore,
        label: pt.time || timestampLabel(pt.timestamp),
        bw: val != null ? fmt(val, 2) : "0.00",
      };
    });

    return {
      points: pointsWithGaps,
      isFresh,
      latestTimeStr,
      count: valid.length,
      isSingle: selectedCamera !== "all",
      cameraName: selectedCameraInfo?.name || null,
    };
  }, [history, selectedCamera, selectedCameraInfo]);

  const handleRefreshSystemTrends = async () => {
    setIsSystemRefreshing(true);
    try {
      // 1. Fetch live overview to poll and persist latest camera telemetry into MongoDB
      const p1 = fetchLiveMetrics();
      // 2. Fetch cameras directly from MongoDB
      const p2 = fetchCameras();
      // 3. Refresh Bandwidth Trends box from MongoDB
      const p3 = fetchTrendHistory(trendRange);
      // 4. Refresh System Telemetry Trends for the selected hour from MongoDB
      const p4 = fetchHistory(true);
      // 5. Refresh diagnostic matrix
      const p5 = fetchDiagnostics();
      await Promise.allSettled([p1, p2, p3, p4, p5]);
    } catch (err) {
      console.error("Refresh telemetry failed:", err);
    } finally {
      setIsSystemRefreshing(false);
    }
  };

  return (
    <main className="network-health">
      <header className="nh-page-header">
        <div>
          <div className="nh-eyebrow">
            <span className="nh-eyebrow-dot" /> INFRASTRUCTURE / NETWORK HEALTH
          </div>
          <h1>Network Health</h1>
          <p>Live camera traffic, network services, and verified infrastructure telemetry.</p>
        </div>
        <div className="nh-header-actions">
          <span className="nh-live-pill">
            <span className="nh-pulse-dot" /> REAL MONGODB TELEMETRY
          </span>
          <button
            className="nh-icon-button"
            onClick={refreshAll}
            title="Refresh live metrics"
            aria-label="Refresh live metrics"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </header>

      {pageError && (
        <div className="nh-alert">
          <AlertCircle size={16} />
          {pageError}
        </div>
      )}

      {/* Action Header Row: Navigation Tabs on Left, Common Camera Scope Dropdown on Right */}
      <div className="nh-action-header-row">
        <nav className="nh-section-tabs" aria-label="Network health sections">
          <button
            className={activeSection === "monitoring" ? "active" : ""}
            onClick={() => setActiveSection("monitoring")}
          >
            <Activity size={15} /> Monitoring Dashboard
          </button>
          <button
            className={activeSection === "diagnostics" ? "active" : ""}
            onClick={() => setActiveSection("diagnostics")}
          >
            <Terminal size={15} /> Diagnostic Terminal
          </button>
        </nav>

      </div>

      {activeSection === "monitoring" && (
        <>
          {/* ================================================================ */}
          {/* 4 BALANCED, DIAGRAM-FIRST MONITORING CARDS (2 COLS x 2 ROWS)     */}
          {/* ================================================================ */}
          <section className="nh-cards-grid">
            {/* ── CARD 1: BANDWIDTH TRENDS ───────────────────────────────── */}
            <article className="nh-monitoring-card">
              <div className="nh-card-top-bar">
                <div className="nh-card-title-wrap">
                  <span className="nh-card-icon green"><TrendingUp size={15} /></span>
                  <h3 className="nh-card-title">Bandwidth Trends</h3>
                </div>
                {/* Independent Quick Time-Range Controls for Card 1 */}
                <div className="nh-card-range-pills" aria-label="Select bandwidth range">
                  {["1h", "6h", "9h", "24h", "7d"].map((val) => (
                    <button
                      key={val}
                      type="button"
                      className={`nh-card-range-pill ${trendRange === val ? "active" : ""}`}
                      onClick={() => {
                        setTrendRange(val);
                        fetchTrendHistory(val);
                      }}
                    >
                      {val.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="nh-card-metric-hero nh-trend-hero-grid">
                <div className="nh-trend-hero-stat peak">
                  <span className="nh-stat-label">PEAK</span>
                  <div className="nh-stat-val-wrap">
                    <span className="nh-metric-number">{trendStats.peakMbps != null ? fmt(trendStats.peakMbps, 2) : "0.00"}</span>
                    <span className="nh-metric-unit">Mbps</span>
                  </div>
                </div>
                <div className="nh-trend-hero-stat avg">
                  <span className="nh-stat-label">AVERAGE</span>
                  <div className="nh-stat-val-wrap">
                    <span className="nh-metric-number">{trendStats.avgMbps != null ? fmt(trendStats.avgMbps, 2) : "0.00"}</span>
                    <span className="nh-metric-unit">Mbps</span>
                  </div>
                </div>
                <div className="nh-trend-hero-stat low">
                  <span className="nh-stat-label">LOW (MIN)</span>
                  <div className="nh-stat-val-wrap">
                    <span className="nh-metric-number">{trendStats.minMbps != null ? fmt(trendStats.minMbps, 2) : "0.00"}</span>
                    <span className="nh-metric-unit">Mbps</span>
                  </div>
                </div>
              </div>

              {/* Show which camera gets highest bandwidth and its current measurement */}
              <div className="nh-highest-cam-tag" title="Camera consuming highest live bandwidth currently">
                <Camera size={14} className="cyan-text" />
                <span className="nh-highest-cam-label">Highest Bandwidth Camera:</span>
                <span className="nh-highest-cam-name">{channelBitrates.highestCamIdentifier || "None active"}</span>
                <span className="nh-highest-cam-val">({channelBitrates.peak != null ? `${fmt(channelBitrates.peak, 2)} Mbps` : "—"})</span>
              </div>

              {/* TIMING-SPECIFIC DIAGRAM: Dynamically adapted per timeframe */}
              <div className="nh-diagram-container nh-trends-diagram">
                {trendLoading && (
                  <div className="nh-diagram-loading-overlay">
                    <RefreshCw size={18} className="nh-spinning cyan-text" />
                  </div>
                )}

                {/* MODE A: 1H / 6H / 9H — Smooth Dynamic Continuous Area Waveform */}
                {(trendRange === "1h" || trendRange === "6h" || trendRange === "9h") && (
                  card1WaveData?.hasData ? (
                    <div className="nh-waveform-wrapper" onMouseLeave={handleTrendMouseLeave}>
                      {hoveredTrendPoint && (
                        <div
                          className="nh-trend-hover-tooltip"
                          style={{
                            left: `${Math.min(80, Math.max(16, (hoveredTrendPoint.x / 340) * 100))}%`,
                          }}
                        >
                          <div className="nh-hover-rate">{fmt(hoveredTrendPoint.val, 2)} <span className="nh-hover-unit">Mbps</span></div>
                          <div className="nh-hover-time">{hoveredTrendPoint.time}</div>
                        </div>
                      )}
                      <svg
                        className="nh-chart-svg"
                        viewBox="0 0 340 120"
                        preserveAspectRatio="none"
                        onMouseMove={handleTrendMouseMove}
                      >
                        <defs>
                          <linearGradient id="trendsAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10d6a0" stopOpacity="0.4" />
                            <stop offset="100%" stopColor="#10d6a0" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* Average reference line */}
                        <line
                          x1="10"
                          y1={card1WaveData.avgY}
                          x2="330"
                          y2={card1WaveData.avgY}
                          stroke="#48a5ff"
                          strokeWidth="1"
                          strokeDasharray="3 4"
                          opacity="0.6"
                        />

                        {/* Historical telemetry area & stroke */}
                        <path d={card1WaveData.areaD} fill="url(#trendsAreaGrad)" />
                        <path d={card1WaveData.pathD} fill="none" stroke="#10d6a0" strokeWidth="2.4" strokeLinecap="round" />

                        {/* Interactive hover crosshair and beacon */}
                        {hoveredTrendPoint && (
                          <g className="nh-trend-hover-group">
                            <line
                              x1={hoveredTrendPoint.x}
                              y1={12}
                              x2={hoveredTrendPoint.x}
                              y2={100}
                              stroke="#00d9ff"
                              strokeWidth="1.5"
                              strokeDasharray="2 3"
                            />
                            <circle
                              cx={hoveredTrendPoint.x}
                              cy={hoveredTrendPoint.y}
                              r="7"
                              fill="#00d9ff"
                              opacity="0.35"
                            />
                            <circle
                              cx={hoveredTrendPoint.x}
                              cy={hoveredTrendPoint.y}
                              r="4.5"
                              fill="#00d9ff"
                              stroke="#ffffff"
                              strokeWidth="1.5"
                            />
                          </g>
                        )}

                        {/* Peak measurement beacon */}
                        <circle cx={card1WaveData.peakX} cy={card1WaveData.peakY} r="4.5" fill="#00d9ff" stroke="#ffffff" strokeWidth="1.5" />

                        {/* Latest measurement anchored beacon */}
                        <circle cx={card1WaveData.latestX} cy={card1WaveData.latestY} r="6" fill="#10d6a0" opacity="0.35">
                          <animate attributeName="r" values="4;7;4" dur="2s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.5;0.15;0.5" dur="2s" repeatCount="indefinite" />
                        </circle>
                        <circle cx={card1WaveData.latestX} cy={card1WaveData.latestY} r="4" fill="#10d6a0" stroke="#ffffff" strokeWidth="1.5" />
                      </svg>
                      <div className="nh-chart-axis-labels">
                        <span>{card1WaveData.startLabel}</span>
                        <span className="nh-axis-peak-tag">Peak: {fmt(trendStats.peakMbps, 2)}M</span>
                        <span>{card1WaveData.endLabel}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="nh-diagram-empty">
                      <span>Awaiting measurements for {trendRange.toUpperCase()} window</span>
                    </div>
                  )
                )}

                {/* MODE B: 24H — Clean Hourly Distribution Profile (No Cramped Spikes!) */}
                {trendRange === "24h" && (
                  <div className="nh-hourly-container">
                    <div className="nh-hourly-bars-row">
                      {card1HourlyData?.slots.map((slot, sIdx) => (
                        <div
                          key={sIdx}
                          className={`nh-hourly-bar-col ${slot.isPeak ? "peak" : ""} ${!slot.hasData ? "no-data" : ""}`}
                          title={`${slot.label} — ${slot.hasData ? `Peak: ${fmt(slot.peak, 2)} Mbps | Avg: ${fmt(slot.avg, 2)} Mbps` : "No recordings"}`}
                        >
                          <div className="nh-hourly-bar-track">
                            {slot.hasData ? (
                              <div
                                className={`nh-hourly-bar-fill ${slot.isPeak ? "peak" : ""}`}
                                style={{ height: `${slot.heightPct}%` }}
                              >
                                {slot.isPeak && <span className="nh-bar-peak-dot" />}
                              </div>
                            ) : (
                              <div className="nh-hourly-empty-indicator" />
                            )}
                          </div>
                          <span className="nh-hourly-label">{slot.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="nh-chart-axis-labels">
                      <span>24 Hours Ago</span>
                      <span className="nh-axis-peak-tag">24H Peak: {fmt(trendStats.peakMbps, 2)}M</span>
                      <span>Now</span>
                    </div>
                  </div>
                )}

                {/* MODE C: 7D — 7 Clean Daily Metric Cards / Columns (Mon - Sun / Today) */}
                {trendRange === "7d" && (
                  <div className="nh-daily-container">
                    <div className="nh-daily-cols-row">
                      {card1DailyData?.days.map((day, dIdx) => (
                        <div
                          key={dIdx}
                          className={`nh-daily-col ${day.isToday ? "today" : ""} ${day.isPeak ? "peak" : ""} ${!day.hasData ? "no-data" : ""}`}
                          title={`${day.dayName} (${day.dateLabel}): ${day.hasData ? `Peak: ${fmt(day.peak, 2)} Mbps | Avg: ${fmt(day.avg, 2)} Mbps` : "No recordings in MongoDB"}`}
                        >
                          <span className="nh-daily-val-tag">
                            {day.hasData ? `${fmt(day.peak, 1)}M` : "—"}
                          </span>
                          <div className="nh-daily-bar-track">
                            {day.hasData ? (
                              <div
                                className={`nh-daily-bar-fill ${day.isPeak ? "peak" : ""}`}
                                style={{ height: `${day.heightPct}%` }}
                              />
                            ) : (
                              <div className="nh-daily-empty-indicator" />
                            )}
                          </div>
                          <div className="nh-daily-meta">
                            <span className="nh-daily-name">{day.dayName}</span>
                            <span className="nh-daily-date">{day.dateLabel}</span>
                            {day.isToday && <span className="nh-today-badge">TODAY</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="nh-card-labels-foot nh-foot-three-col">
                <span className="nh-foot-item" title="The selected history period window">
                  <Clock size={12} className="cyan-text" /> {trendStats.timelineWindow} Window
                </span>
                <span className="nh-foot-item" title="The number of historical measurements counted">
                  <Layers size={12} className="green-text" /> {trendStats.sampleCount} samples
                </span>
                <span className="nh-foot-item" title="The time of the latest recorded measurement">
                  <span className="nh-pulse-dot" /> Last: {trendStats.lastSampleLabel || "—"}
                </span>
              </div>
            </article>

            {/* ── CARD 2: LAN INTERFACE LOAD (STRICTLY SERVER-WIDE) ──────── */}
            <article className="nh-monitoring-card">
              <div className="nh-card-top-bar">
                <div className="nh-card-title-wrap">
                  <span className="nh-card-icon amber"><Zap size={15} /></span>
                  <h3 className="nh-card-title">LAN Interface Load</h3>
                </div>
                <span className={`nh-badge ${nicStatus === "Connected" ? "nh-badge-green" : "nh-badge-gray"}`}>
                  {nicStatus}
                </span>
              </div>

              <div className="nh-card-metric-hero">
                <span className="nh-metric-number">{lanUtilization != null ? fmt(lanUtilization, 2) : "—"}</span>
                <span className="nh-metric-unit">%</span>
                <span className="nh-metric-sub">NIC Interface Utilization</span>
              </div>

              {/* ONE MAIN DIAGRAM: Clean Circular Radial Gauge */}
              <div className="nh-diagram-container nh-gauge-diagram">
                <svg className="nh-gauge-svg" viewBox="0 0 170 100">
                  <defs>
                    <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#00d9ff" />
                      <stop offset="60%" stopColor="#10d6a0" />
                      <stop offset="100%" stopColor="#f6b94b" />
                    </linearGradient>
                  </defs>
                  {/* Gauge background track */}
                  <path
                    d="M 27 82 A 54 54 0 1 1 143 82"
                    fill="none"
                    stroke="#141d2a"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  {/* Gauge active utilization arc */}
                  <path
                    d="M 27 82 A 54 54 0 1 1 143 82"
                    fill="none"
                    stroke={card3Gauge.gaugeColor}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={card3Gauge.arcCircumference}
                    strokeDashoffset={card3Gauge.strokeDashoffset}
                    className="nh-gauge-arc"
                  />
                  <text x="85" y="60" textAnchor="middle" fill="#ffffff" fontSize="20" fontWeight="750" fontFamily="inherit">
                    {lanUtilization != null ? `${fmt(lanUtilization, 2)}%` : "—"}
                  </text>
                  <text x="85" y="75" textAnchor="middle" fill="#cbd5e1" fontSize="8.5" fontWeight="700" letterSpacing="0.08em" fontFamily="inherit">
                    NIC LOAD
                  </text>
                </svg>

                {/* Pictorial Distribution Graph for Incoming, Outgoing, Total Speed, Free Bandwidth */}
                <div className="nh-lan-pictorial-graph">
                  <div className="nh-lan-bar-track" title={`Incoming: ${fmt(nicRxMbps, 2)} Mbps | Outgoing: ${fmt(nicTxMbps, 2)} Mbps | Free Bandwidth: ${fmt(headroomMbps, 2)} Mbps`}>
                    <div
                      className="nh-lan-bar-fill rx"
                      style={{ width: `${Math.min(100, Math.max(1, ((nicRxMbps || 0) / (nicLinkSpeed || 1000)) * 100))}%` }}
                    />
                    <div
                      className="nh-lan-bar-fill tx"
                      style={{ width: `${Math.min(100, Math.max(0.5, ((nicTxMbps || 0) / (nicLinkSpeed || 1000)) * 100))}%` }}
                    />
                  </div>
                  <div className="nh-lan-boxes-grid">
                    <div className="nh-lan-box rx">
                      <div className="nh-lan-box-header">
                        <ArrowDownRight size={15} className="cyan-text" />
                        <span className="nh-lan-box-label">Incoming Traffic</span>
                      </div>
                      <div className="nh-lan-box-val">
                        {nicRxMbps != null ? `${fmt(nicRxMbps, 2)}` : "—"} <span className="nh-lan-box-unit">Mbps</span>
                      </div>
                    </div>

                    <div className="nh-lan-box tx">
                      <div className="nh-lan-box-header">
                        <ArrowUpRight size={15} className="amber-text" />
                        <span className="nh-lan-box-label">Outgoing Traffic</span>
                      </div>
                      <div className="nh-lan-box-val">
                        {nicTxMbps != null ? `${fmt(nicTxMbps, 2)}` : "—"} <span className="nh-lan-box-unit">Mbps</span>
                      </div>
                    </div>

                    <div className="nh-lan-box link">
                      <div className="nh-lan-box-header">
                        <Zap size={15} className="blue-text" />
                        <span className="nh-lan-box-label">Total Link Speed</span>
                      </div>
                      <div className="nh-lan-box-val">
                        {nicLinkSpeed != null ? `${Number(nicLinkSpeed).toLocaleString()}` : "1,000"} <span className="nh-lan-box-unit">Mbps</span>
                      </div>
                    </div>

                    <div className="nh-lan-box headroom">
                      <div className="nh-lan-box-header">
                        <ShieldCheck size={15} className="green-text" />
                        <span className="nh-lan-box-label">Free Bandwidth</span>
                      </div>
                      <div className="nh-lan-box-val">
                        {headroomMbps != null ? `${Number(headroomMbps).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : "—"} <span className="nh-lan-box-unit">Mbps</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="nh-card-labels-foot nh-foot-four-col">
                <span className="nh-foot-item" title="Incoming Network Traffic">
                  <ArrowDownRight size={11} className="cyan-text" /> Incoming: {nicRxMbps != null ? `${fmt(nicRxMbps, 2)}M` : "—"}
                </span>
                <span className="nh-foot-item" title="Outgoing Network Traffic">
                  <ArrowUpRight size={11} className="amber-text" /> Outgoing: {nicTxMbps != null ? `${fmt(nicTxMbps, 2)}M` : "—"}
                </span>
                <span className="nh-foot-item" title="Total Interface Capacity">
                  Total Speed: {nicLinkSpeed != null ? `${Number(nicLinkSpeed).toLocaleString()}M` : "1Gbps"}
                </span>
                <span className="nh-foot-item" title="Free Bandwidth Available">
                  Free Bandwidth: {headroomMbps != null ? `${Number(headroomMbps).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}M` : "—"}
                </span>
              </div>
            </article>

            {/* ── CARD 3: NETWORK PERFORMANCE (LATENCY VISUALIZATION) ─────── */}
            <article className="nh-monitoring-card">
              <div className="nh-card-top-bar">
                <div className="nh-card-title-wrap">
                  <span className="nh-card-icon purple"><Activity size={15} /></span>
                  <h3 className="nh-card-title">Network Performance</h3>
                </div>
                <SearchableCameraDropdown
                  cameras={cameras}
                  selectedCamera={perfCamera}
                  onSelect={(camId) => {
                    setPerfCamera(camId);
                  }}
                  compact={true}
                />
              </div>

              <div className="nh-card-metric-hero">
                <span className="nh-metric-number">
                  {card5Perf.latVal != null ? fmt(card5Perf.latVal, 1) : "—"}
                </span>
                <span className="nh-metric-unit">{card5Perf.latVal != null ? "ms" : ""}</span>
                <span className="nh-metric-sub">
                  {card5Perf.isSingle ? "Round-Trip Latency" : "Average Fleet Latency"}
                </span>
              </div>

              {/* ONE MAIN DIAGRAM: Dedicated Latency Arc Gauge & Response-Time Scale */}
              <div className="nh-diagram-container nh-perf-diagram">
                <svg className="nh-latency-wave-svg" viewBox="0 0 360 148" preserveAspectRatio="xMidYMid meet">
                  <defs>
                    <linearGradient id="latencyScaleGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#10d6a0" />
                      <stop offset="35%" stopColor="#00d9ff" />
                      <stop offset="70%" stopColor="#f6b94b" />
                      <stop offset="100%" stopColor="#fb7185" />
                    </linearGradient>
                  </defs>

                  {/* Left: Semi-circular 180° Response-Time Arc Gauge */}
                  <g transform="translate(75, 84)">
                    {/* Gauge background track (180 deg top half) */}
                    <path
                      d="M -54 0 A 54 54 0 0 1 54 0"
                      fill="none"
                      stroke="#141f30"
                      strokeWidth="11"
                      strokeLinecap="round"
                    />
                    {/* Gauge active arc */}
                    <path
                      d="M -54 0 A 54 54 0 0 1 54 0"
                      fill="none"
                      stroke={card5Perf.latVal != null ? (card5Perf.latVal < 100 ? "#10d6a0" : card5Perf.latVal < 200 ? "#00d9ff" : card5Perf.latVal < 300 ? "#f6b94b" : "#fb7185") : "#334155"}
                      strokeWidth="11"
                      strokeLinecap="round"
                      strokeDasharray="169.65"
                      strokeDashoffset={card5Perf.latVal != null ? 169.65 * (1 - Math.min(1, Math.max(0.04, card5Perf.latVal / 300))) : 169.65}
                    />
                    <text x="0" y="-12" textAnchor="middle" fill="#ffffff" fontSize="23" fontWeight="800" fontFamily="inherit">
                      {card5Perf.latVal != null ? fmt(card5Perf.latVal, 1) : "—"}
                    </text>
                    <text x="0" y="6" textAnchor="middle" fill={card5Perf.latVal != null ? "#38bdf8" : "#cbd5e1"} fontSize="9" fontWeight="700" letterSpacing="0.08em" fontFamily="inherit">
                      {card5Perf.latVal != null ? "MS LATENCY" : "UNAVAILABLE"}
                    </text>
                  </g>

                  {/* Right: Response-Time Spectrum Scale & Measured Packet Loss Card */}
                  <g transform="translate(144, 14)">
                    <rect
                      width="204"
                      height="112"
                      rx="10"
                      fill="#0b1322"
                      stroke="rgba(168, 85, 247, 0.3)"
                      strokeWidth="1.4"
                    />
                    <text x="14" y="22" fill="#cbd5e1" fontSize="9.5" fontWeight="750" letterSpacing="0.06em" fontFamily="inherit">
                      RESPONSE-TIME SCALE
                    </text>
                    <text x="190" y="22" textAnchor="end" fill={card5Perf.latVal != null ? (card5Perf.latVal < 100 ? "#10d6a0" : "#38bdf8") : "#cbd5e1"} fontSize="10" fontWeight="700" fontFamily="inherit">
                      {card5Perf.statusText}
                    </text>

                    {/* Proportional Spectrum Bar (0 to 300ms) */}
                    <rect x="14" y="36" width="176" height="8" rx="4" fill="url(#latencyScaleGrad)" opacity="0.8" />
                    {card5Perf.latVal != null && (
                      <circle
                        cx={14 + Math.min(172, Math.max(4, (card5Perf.latVal / 300) * 176))}
                        cy="40"
                        r="6"
                        fill="#00d9ff"
                        stroke="#ffffff"
                        strokeWidth="1.8"
                      />
                    )}
                    {/* Scale axis labels */}
                    <text x="14" y="58" fill="#cbd5e1" fontSize="8.5" fontWeight="600" fontFamily="inherit">0ms</text>
                    <text x="73" y="58" textAnchor="middle" fill="#cbd5e1" fontSize="8.5" fontWeight="600" fontFamily="inherit">100ms</text>
                    <text x="131" y="58" textAnchor="middle" fill="#cbd5e1" fontSize="8.5" fontWeight="600" fontFamily="inherit">200ms</text>
                    <text x="190" y="58" textAnchor="end" fill="#cbd5e1" fontSize="8.5" fontWeight="600" fontFamily="inherit">300ms+</text>

                    {/* Packet Loss Readout Chip */}
                    <g transform="translate(14, 70)">
                      <rect width="176" height="26" rx="5" fill="rgba(16, 214, 160, 0.12)" stroke="rgba(16, 214, 160, 0.3)" strokeWidth="1" />
                      <text x="10" y="17" fill="#10d6a0" fontSize="9.5" fontWeight="750" fontFamily="inherit">
                        ● Packet Loss: {card5Perf.loss != null ? `${Number(card5Perf.loss).toFixed(1)}%` : "Unmeasured"}
                      </text>
                      <text x="166" y="17" textAnchor="end" fill="#38bdf8" fontSize="9" fontWeight="600" fontFamily="inherit">
                        {card5Perf.latVal != null ? "Active Ping" : "Standby"}
                      </text>
                    </g>
                  </g>
                </svg>
              </div>

              <div className="nh-card-labels-foot">
                <span className="nh-foot-item green-text">
                  ● Packet Loss: {card5Perf.loss != null ? `${Number(card5Perf.loss).toFixed(1)}%` : "0.0%"}
                </span>
                <span className="nh-foot-item" style={{ color: "#cbd5e1" }}>
                  <Camera size={12} className="cyan-text" /> Active Cameras: <strong style={{ color: "#10d6a0", marginLeft: 4 }}>{activeStreamCount}</strong>
                </span>
              </div>
            </article>

            {/* ── CARD 4: TELEMETRY HEALTH ───────────────────────────────── */}
            <article className="nh-monitoring-card">
              <div className="nh-card-top-bar">
                <div className="nh-card-title-wrap">
                  <span className="nh-card-icon cyan"><Clock size={15} /></span>
                  <h3 className="nh-card-title">Telemetry Health</h3>
                </div>
                <span className={`nh-badge ${card6Timeline.isFresh ? "nh-badge-green" : "nh-badge-amber"}`}>
                  <span className={`nh-badge-dot ${card6Timeline.isFresh ? "green" : "amber"}`} />
                  {card6Timeline.isFresh ? "Active Cadence" : "Stale Telemetry"}
                </span>
              </div>

              <div className="nh-card-metric-hero">
                <span className="nh-metric-number nh-metric-time">{card6Timeline.latestTimeStr}</span>
                <span className="nh-metric-sub">
                  Latest Recorded Measurement
                </span>
              </div>

              {/* ONE MAIN DIAGRAM: Real Measurement Timeline */}
              <div className="nh-diagram-container nh-timeline-diagram">
                <div className="nh-timeline-track-wrap">
                  <div className="nh-timeline-line" />
                  <div className="nh-timeline-checkpoints">
                    {card6Timeline.points.length > 0 ? (
                      card6Timeline.points.map((pt, i) => {
                        const isLatest = i === card6Timeline.points.length - 1;
                        return (
                          <div key={pt.timestamp || i} className={`nh-timeline-node ${isLatest ? "latest" : ""}`}>
                            {pt.isGapBefore && <span className="nh-gap-indicator" title="Telemetry Gap > 30s">GAP</span>}
                            <div className="nh-timeline-dot-wrap">
                              <span className={`nh-timeline-dot ${isLatest ? "active" : ""}`} />
                              {isLatest && <span className="nh-pulse-wave" />}
                            </div>
                            <span className="nh-timeline-time">{pt.label}</span>
                            <span className="nh-timeline-bw">{pt.bw}M</span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="nh-timeline-empty">Awaiting telemetry timeline records</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="nh-card-labels-foot">
                <span className="nh-foot-item"><RefreshCw size={12} className="cyan-text" /> Cadence: 10s intervals</span>
              </div>
            </article>
          </section>

          {/* Primary Telemetry Graph with Multi-Color Camera Tracks */}
          <section className="nh-card nh-history-card">
            <div className="nh-chart-header">
              <div className="nh-chart-title">
                <span className="nh-icon-box cyan"><Activity size={17} /></span>
                <div>
                  <h2>
                    {selectedCamera !== "all"
                      ? "Selected Camera Telemetry Trends"
                      : "System Telemetry Trends — Fleet Overview"}
                  </h2>
                  <p>
                    {selectedCamera !== "all"
                      ? "Incoming bandwidth in Mbps verified from MongoDB for the selected camera stream."
                      : "Multi-camera telemetry in Mbps verified from MongoDB. Hover over any point to inspect bitrates."}
                  </p>
                </div>
              </div>

              {/* Controls: [ Camera Dropdown ] [ 1H ] [ 6H ] [ 9H ] [ 24H ] [ 7D ] [ Refresh ] */}
              <div className="nh-chart-controls">
                <SearchableCameraDropdown
                  cameras={cameras}
                  selectedCamera={selectedCamera}
                  onSelect={(camId) => setSelectedCamera(camId)}
                  loading={loading}
                  compact={true}
                />
                <div className="nh-range-selector" aria-label="History time range">
                  {[
                    ["1h", "1H"],
                    ["6h", "6H"],
                    ["9h", "9H"],
                    ["24h", "24H"],
                    ["7d", "7D"],
                  ].map(([val, label]) => (
                    <button
                      key={val}
                      className={range === val ? "active" : ""}
                      onClick={() => setRange(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {historyLoading && !hasInitialHistoryRef.current ? (
              <div className="nh-empty-state">
                <RefreshCw size={20} className="nh-spin cyan-text" />
                <span>Fetching verified camera measurements from MongoDB…</span>
              </div>
            ) : chartData.length > 0 && historyAvailable ? (
              <div className="nh-history-chart nh-history-chart-large" style={{ position: "relative" }}>
                {isSystemRefreshing && (
                  <div className="nh-diagram-loading-overlay" style={{ top: 12, right: 20 }}>
                    <RefreshCw size={18} className="nh-spinning cyan-text" />
                  </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 12, right: 20, left: 0, bottom: 4 }}>
                    <defs>
                      {/* Linear gradients for each camera */}
                      {historyCameras.map((cam) => (
                        <linearGradient key={cam.id} id={`fill_${cam.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={cam.color} stopOpacity={0.28} />
                          <stop offset="95%" stopColor={cam.color} stopOpacity={0.01} />
                        </linearGradient>
                      ))}
                      {/* Gradient for aggregate total */}
                      <linearGradient id="fill_total" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#48a5ff" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#48a5ff" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--nh-border)" strokeDasharray="3 5" vertical />
                    <XAxis
                      dataKey="timeMs"
                      type="number"
                      domain={[startMs, endMs]}
                      ticks={ticks}
                      tickFormatter={formatXAxisTick}
                      stroke="var(--nh-muted)"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      yAxisId="bandwidth"
                      domain={yDomain}
                      stroke="var(--nh-muted)"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={64}
                      tickFormatter={(val) => {
                        if (val === 0) return "0 Mbps";
                        if (val < 1) return `${val.toFixed(2)} Mbps`;
                        if (val < 10) return `${val.toFixed(1)} Mbps`;
                        return `${Math.round(val)} Mbps`;
                      }}
                    />
                    <ChartTooltip
                      wrapperStyle={{ outline: "none" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0]?.payload || {};
                        if (point.isGap) return null;
                        const exactTime = point.timestamp ? new Date(point.timestamp).toLocaleString() : timestampLabel(label);
                        const totalVal = point.incoming_mbps ?? point.bandwidth_mbps ?? 0;
                        return (
                          <div className="nh-chart-tooltip nh-rich-tooltip">
                            <div className="nh-tooltip-title">{exactTime}</div>
                            {selectedCamera === "all" ? (
                              (() => {
                                // Show only active cameras that have a valid bandwidth measurement at this time
                                const activeAtPoint = historyCameras.filter((cam) => {
                                  const camVal = point[cam.dataKey] ?? point[`cam_${cam.id}`];
                                  return camVal != null && !isNaN(camVal) && Number(camVal) > 0;
                                });

                                if (activeAtPoint.length === 0) {
                                  return (
                                    <div className="nh-tooltip-row" style={{ color: "var(--nh-text-muted)" }}>
                                      <span>No active streams at this time</span>
                                    </div>
                                  );
                                }

                                return activeAtPoint.map((cam) => {
                                  const camVal = point[cam.dataKey] ?? point[`cam_${cam.id}`];
                                  const matchedCam = cameras.find((c) => String(c.id) === String(cam.id) || c.ip === cam.ip);
                                  const cameraName = matchedCam?.name || cam.name || cam.device_name || cam.ip || "Camera";
                                  return (
                                    <div key={cam.id} className="nh-tooltip-row">
                                      <span className="nh-tooltip-cam-label">
                                        <i style={{ background: cam.color || "#10d6a0" }} />
                                        <b>{cameraName}</b>
                                      </span>
                                      <b>{`${Number(camVal).toFixed(2)} Mbps`}</b>
                                    </div>
                                  );
                                });
                              })()
                            ) : (
                              <div className="nh-tooltip-row">
                                <span className="nh-tooltip-cam-label">
                                  <i style={{ background: selectedCameraInfo?.color || "var(--nh-green)" }} />
                                  <b>{selectedCameraInfo?.name || selectedCameraInfo?.device_name || selectedCameraInfo?.ip || "Incoming Stream"}</b>
                                </span>
                                <b>{Number(point[selectedCameraInfo?.dataKey] ?? totalVal).toFixed(2)} Mbps</b>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />

                    {/* Bandwidth Stream Areas: Display only active camera series with actual camera names */}
                    {selectedCamera === "all" ? (
                      <>
                        {historyCameras
                          .filter((cam) => {
                            // Only display graph lines for cameras that have recorded data in this history
                            return history.some((p) => {
                              const val = p[cam.dataKey] ?? p[`cam_${cam.id}`];
                              return !p.isGap && val != null && !isNaN(val) && Number(val) > 0;
                            });
                          })
                          .map((cam) => {
                            const matchedCam = cameras.find((c) => String(c.id) === String(cam.id) || c.ip === cam.ip);
                            const cameraName = matchedCam?.name || cam.name || cam.device_name || cam.ip || "Camera";
                            return (
                              <Area
                                key={cam.id}
                                yAxisId="bandwidth"
                                type="monotone"
                                dataKey={cam.dataKey}
                                name={cameraName}
                                stroke={cam.color}
                                strokeWidth={2.4}
                                fill={`url(#fill_${cam.id})`}
                                connectNulls={false}
                                isAnimationActive={false}
                                activeDot={{ r: 4.5, strokeWidth: 1.5, stroke: "var(--nh-card)" }}
                              />
                            );
                          })}
                      </>
                    ) : (
                      <Area
                        yAxisId="bandwidth"
                        type="monotone"
                        dataKey={selectedCameraInfo ? selectedCameraInfo.dataKey : "bandwidth_mbps"}
                        name="Incoming Stream"
                        stroke={selectedCameraInfo?.color || "var(--nh-green)"}
                        strokeWidth={2.5}
                        fill={`url(#fill_${selectedCameraInfo?.id || "total"})`}
                        connectNulls={false}
                        isAnimationActive={false}
                        activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--nh-card)" }}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="nh-empty-state">
                <Activity size={24} className="nh-empty-icon" />
                <strong>
                  {selectedCamera !== "all"
                    ? "No bandwidth measurements recorded for selected camera"
                    : "No telemetry history available"}
                </strong>
                <span>
                  {selectedCamera !== "all"
                    ? "Awaiting verified measurements from the monitoring worker for this camera stream."
                    : "No genuine aggregate telemetry records exist for this time period in MongoDB. No demo values are shown."}
                </span>
              </div>
            )}

            {/* Fleet Telemetry Summary Bar */}
            <div className="nh-legend nh-fleet-summary-bar">
              {selectedCamera === "all" ? (
                <>
                  <span className="nh-legend-cam">
                    <i style={{ background: "#10d6a0" }} />
                    <span>Peak Recorded:</span>
                    <strong>{graphStats.peakMbps} Mbps</strong>
                  </span>
                  <span className="nh-legend-cam">
                    <i style={{ background: "#a78bfa" }} />
                    <span>Average Ingest:</span>
                    <strong>{graphStats.avgMbps} Mbps</strong>
                  </span>
                  <span className="nh-legend-cam">
                    <i style={{ background: "#38bdf8" }} />
                    <span>Active Streams:</span>
                    <strong>{activeStreamCount} of {cameras.length} Active</strong>
                  </span>
                </>
              ) : (
                <span className="nh-legend-cam">
                  <i style={{ background: selectedCameraInfo?.color || "var(--nh-green)" }} />
                  <strong>Selected Stream Telemetry</strong>
                  <span>· {selectedCameraInfo?.latest_bitrate_mbps != null ? fmt(selectedCameraInfo.latest_bitrate_mbps, 2) + " Mbps" : "Streaming"}</span>
                </span>
              )}
              <span className="nh-legend-note">
                {range === "1h" ? "Last 1 hour" : range === "6h" ? "Last 6 hours" : range === "9h" ? "Last 9 hours" : range === "24h" ? "Last 24 hours" : "Last 7 days"}
              </span>
            </div>
          </section>
        </>
      )}

      {activeSection === "diagnostics" && (
        <section className="nh-diagnostics-grid">
          {/* Connectivity Matrix */}
          <article className="nh-card nh-connectivity-card">
            <div className="nh-card-heading">
              <span className="nh-icon-box cyan"><Activity size={17} /></span>
              <span>Connectivity Matrix</span>
              <span className="nh-status neutral">{deviceStats.length} nodes</span>
            </div>
            <p className="nh-card-description">
              Live status and ping latency reported by infrastructure health checks.
            </p>
            <div className="nh-table-wrap">
              <table className="nh-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>IP address</th>
                    <th>Latency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceStats.length ? (
                    deviceStats.map((device, index) => {
                      const online = ["online", "healthy", "active"].includes(
                        String(device.status).toLowerCase()
                      );
                      return (
                        <tr key={device.id || device.ip || index}>
                          <td>{device.name || device.label || device.id || "Camera"}</td>
                          <td className="nh-mono">{device.ip || device.ip_address || "—"}</td>
                          <td>{device.latency == null ? "—" : `${device.latency} ms`}</td>
                          <td>
                            <span className={`nh-status ${online ? "healthy" : "neutral"}`}>
                              {device.status || "Unknown"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="4" className="nh-table-empty">
                        No device status records returned.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          {/* Diagnostic Terminal */}
          <article className="nh-card nh-terminal-card">
            <div className="nh-card-heading">
              <span className="nh-icon-box green"><Terminal size={17} /></span>
              <span>Diagnostic Terminal</span>
            </div>
            <p className="nh-card-description">
              Verify live socket reachability and ping roundtrip latency for an IP address or node ID.
            </p>
            <form className="nh-diagnostic-form" onSubmit={runInstantCheck}>
              <label htmlFor="nh-target">Target IP address or node ID</label>
              <div className="nh-input-row">
                <input
                  id="nh-target"
                  value={diagnosingIp}
                  onChange={(event) => setDiagnosingIp(event.target.value)}
                  placeholder="e.g. 192.168.126.238"
                />
                <button type="submit" disabled={isPinging || !diagnosingIp.trim()}>
                  <Zap size={15} />
                  {isPinging ? "Checking…" : "Check Node"}
                </button>
              </div>
            </form>
            {diagResult && (
              <div className="nh-diagnostic-result">
                <div className="nh-result-heading">
                  <span>Diagnostic Result</span>
                  <Clock size={14} />
                </div>
                <div className="nh-card-foot">
                  <span>Target</span>
                  <strong className="nh-mono">{diagResult.ip}</strong>
                </div>
                <div className="nh-card-foot">
                  <span>Connection</span>
                  <strong
                    className={
                      ["online", "healthy"].includes(String(diagResult.status).toLowerCase())
                        ? "green-text"
                        : "amber-text"
                    }
                  >
                    {diagResult.status}
                  </strong>
                </div>
                {diagResult.latency != null && (
                  <div className="nh-card-foot">
                    <span>Roundtrip latency</span>
                    <strong>{diagResult.latency} ms</strong>
                  </div>
                )}
                {diagResult.ports && Object.keys(diagResult.ports).length > 0 && (
                  <div className="nh-card-foot">
                    <span>Port reachability</span>
                    <strong>
                      {Object.entries(diagResult.ports)
                        .map(([p, open]) => `${p}: ${open ? "OPEN" : "CLOSED"}`)
                        .join(" | ")}
                    </strong>
                  </div>
                )}
                {diagResult.error && <p className="nh-result-error">{diagResult.error}</p>}
              </div>
            )}
            <div className="nh-terminal-note">
              <CheckCircle2 size={15} /> Performs real ICMP ping & TCP port handshake; never fabricates a successful connection.
            </div>


          </article>
        </section>
      )}

      {loading && (
        <div className="nh-loading-indicator">
          <span className="nh-pulse-dot" /> Connecting to backend telemetry services…
        </div>
      )}
    </main>
  );
};

export default NetworkHealthPage;