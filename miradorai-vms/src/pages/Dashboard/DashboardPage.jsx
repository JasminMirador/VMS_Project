import React, { useState, useEffect, useRef } from "react";
import DatePicker from "../../components/shared/DatePicker";
import TimePicker from "../../components/shared/TimePicker";
import DateTimePicker from "../../components/shared/DateTimePicker";
import SpecularButton from "../../components/shared/SpecularButton";
import AnimatedDownloadButton from "../../components/shared/AnimatedDownloadButton";
import { useNavigate } from "react-router-dom";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useTheme } from "../../context/ThemeContext";
import useActivityLogger from "../../hooks/useActivityLogger";
import "./DashboardPage.css";
import {
  Camera,
  Activity,
  Bell,
  HardDrive,
  AlertTriangle,
  Server,
  Cpu,
  MemoryStick,
  Calendar,
  Download,
  Printer,
  Mail,
  ChevronDown,
  Trash2
} from "lucide-react";
import jsPDF from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  ReferenceLine,
  Treemap,
  LineChart,
  Line
} from "recharts";
const API_BASE = import.meta.env.VITE_API_URL || "";

const getAuthHeaders = () => {
  const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
  return token ? { "Authorization": "Bearer " + token } : {};
};


const formatLocalDatetime = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const getInitialFromDate = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return formatLocalDatetime(d);
};

const getInitialToDate = () => {
  const d = new Date();
  return formatLocalDatetime(d);
};

// ── CPU: Smooth area chart showing trend over time ──
const CpuAreaChart = ({ data, value }) => {
  const height = 64;
  const width = 220;
  if (!data || data.length < 2) return <div style={{ height }} />;

  // Scale 0-100 to chart height with some padding
  const padTop = 4;
  const padBot = 4;
  const chartH = height - padTop - padBot;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padTop + chartH - (val / 100) * chartH;
    return { x, y };
  });

  // Smooth curve using cubic bezier
  let pathD = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
    const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
    pathD += ` C ${cpx1},${prev.y} ${cpx2},${curr.y} ${curr.x},${curr.y}`;
  }

  const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;
  const lineColor = value > 85 ? '#ef4444' : value > 60 ? '#f59e0b' : '#10b981';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="cpu-area-chart" preserveAspectRatio="none">
      <defs>
        <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Threshold line at 85% */}
      <line x1="0" y1={padTop + chartH - (85 / 100) * chartH} x2={width} y2={padTop + chartH - (85 / 100) * chartH}
        stroke="#ef4444" strokeWidth="0.5" strokeDasharray="4 3" opacity="0.4" />
      {/* Threshold line at 60% */}
      <line x1="0" y1={padTop + chartH - (60 / 100) * chartH} x2={width} y2={padTop + chartH - (60 / 100) * chartH}
        stroke="#f59e0b" strokeWidth="0.5" strokeDasharray="4 3" opacity="0.3" />
      <path d={areaD} fill="url(#cpuGrad)" />
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Current value dot */}
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={lineColor} />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="5" fill={lineColor} opacity="0.3" />
    </svg>
  );
};

// ── RAM: Horizontal usage gauge ──
const RamUsageGauge = ({ value }) => {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981';
  const free = Math.round(100 - pct);

  return (
    <div className="ram-usage-gauge">
      <div className="ram-gauge-bar">
        <div
          className="ram-gauge-fill"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}88, ${color})` }}
        >
          {pct > 15 && <span className="ram-fill-label">{Math.round(pct)}%</span>}
        </div>
        {free > 10 && (
          <div className="ram-gauge-free">
            <span className="ram-free-label">{free}% free</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Disk: Horizontal segmented usage bar ──
const DiskUsageBar = ({ value, used, total }) => {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#10b981';

  return (
    <div className="disk-bar-wrapper">
      <div className="disk-bar-track">
        <div
          className="disk-bar-fill"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}cc, ${color})`,
            transition: 'width 0.6s ease'
          }}
        />
        {/* Segment markers at 25%, 50%, 75% */}
        <div className="disk-bar-marker" style={{ left: '25%' }} />
        <div className="disk-bar-marker" style={{ left: '50%' }} />
        <div className="disk-bar-marker" style={{ left: '75%' }} />
      </div>
      <div className="disk-bar-labels">
        <span className="disk-bar-used" style={{ color }}>{used || `${pct}%`}</span>
        <span className="disk-bar-total">{total ? `/ ${total}` : '/ 100%'}</span>
      </div>
    </div>
  );
};

// ── Disk: Donut gauge ──
const DiskDonut = ({ value, used, total }) => {
  const size = 80;
  const strokeW = 7;
  const radius = (size - strokeW) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(100, Math.max(0, value));
  const dashOffset = circumference - (pct / 100) * circumference;
  const color = pct > 90 ? '#ef4444' : pct > 75 ? '#f59e0b' : '#10b981';

  return (
    <div className="disk-donut-container">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="disk-donut-svg">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="var(--border-light)" strokeWidth={strokeW}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s ease' }}
        />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize="14" fontWeight="700" fontFamily="var(--font-ui)">
          {Math.round(pct)}%
        </text>
      </svg>
      <span className="disk-donut-sub">{used} / {total} GB</span>
    </div>
  );
};

// ── Mini Arc Gauge for stat cards ──
const MiniArcGauge = ({ value, label, thresholds = [60, 85], invert = false }) => {
  const size = 64;
  const strokeW = 5;
  const radius = (size - strokeW) / 2;
  // Semi-circle (180 degrees)
  const halfCirc = Math.PI * radius;
  const pct = Math.min(100, Math.max(0, value));
  const offset = halfCirc - (pct / 100) * halfCirc;

  let color;
  if (invert) {
    // For recording cameras: high % = good (green), low % = bad (red)
    color = pct >= thresholds[1] ? '#10b981' : pct >= thresholds[0] ? '#f59e0b' : '#ef4444';
  } else {
    // For disk: high % = bad (red)
    color = pct > thresholds[1] ? '#ef4444' : pct > thresholds[0] ? '#f59e0b' : '#10b981';
  }

  return (
    <div className="mini-arc-container">
      <svg width={size} height={size / 2 + 6} viewBox={`0 0 ${size} ${size / 2 + 6}`}>
        {/* Background track */}
        <path
          d={`M ${strokeW / 2},${size / 2} A ${radius},${radius} 0 0,1 ${size - strokeW / 2},${size / 2}`}
          fill="none" stroke="var(--border-light)" strokeWidth={strokeW} strokeLinecap="round"
        />
        {/* Progress arc */}
        <path
          d={`M ${strokeW / 2},${size / 2} A ${radius},${radius} 0 0,1 ${size - strokeW / 2},${size / 2}`}
          fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round"
          strokeDasharray={halfCirc}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s ease' }}
        />
      </svg>
      <span className="mini-arc-label" style={{ color }}>{label}</span>
    </div>
  );
};

const timeAgo = (date) => {
  if (!date) return 'Never';
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const InteractiveLineChart = ({ data, xKey, yKey, height = 180 }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);

  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "14px" }}>
        No bitrate data available
      </div>
    );
  }

  const values = data.map(d => d[yKey] || 0);
  const maxVal = Math.max(...values, 1.0);
  const minVal = Math.min(...values, 0.0);
  const valRange = maxVal - minVal;

  const width = 500;
  const padding = { top: 15, right: 15, bottom: 25, left: 60 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((d, idx) => {
    const x = padding.left + (idx / (data.length - 1 || 1)) * chartWidth;
    const y = padding.top + chartHeight - (((d[yKey] || 0) - minVal) / valRange) * chartHeight;
    return { x, y, item: d };
  });

  let pathD = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    pathD += ` L ${points[i].x},${points[i].y}`;
  }

  return (
    <div className="custom-chart-wrapper" style={{ position: "relative", width: "100%" }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="custom-chart-svg" style={{ width: "100%", height, display: "block" }}>
        {/* Horizontal Grid Lines */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, idx) => {
          const y = padding.top + chartHeight * ratio;
          const val = maxVal - ratio * valRange;
          return (
            <g key={idx}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="var(--border-light)" strokeWidth="0.8" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="var(--text-primary)" fontSize="13" fontWeight="700">
                {val.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Path line */}
        <path d={pathD} fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover points */}
        {points.map((pt, idx) => (
          <g key={idx}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r={hoveredPoint?.idx === idx ? "5" : "0"}
              fill="#00D2FF"
              stroke="var(--bg-surface)"
              strokeWidth="1.5"
              style={{ transition: "r 0.1s ease" }}
            />
            <rect
              x={pt.x - 12}
              y={padding.top}
              width="24"
              height={chartHeight}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredPoint({ ...pt, idx })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          </g>
        ))}
      </svg>
      {hoveredPoint && (
        <div className="custom-chart-tooltip" style={{
          position: "absolute",
          top: Math.max(0, hoveredPoint.y - 45),
          left: Math.max(10, Math.min(hoveredPoint.x - 45, width - 100)),
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "4px 8px",
          fontSize: "11px",
          color: "var(--text-primary)",
          pointerEvents: "none",
          zIndex: 10,
          boxShadow: "0 4px 10px rgba(0, 0, 0, 0.4)",
          whiteSpace: "nowrap"
        }}>
          <div><strong>{hoveredPoint.item[xKey]}</strong></div>
          <div>{hoveredPoint.item[yKey].toFixed(2)} Mbps</div>
        </div>
      )}
    </div>
  );
};

const StorageTrendChart = ({ data, xKey, yKey, height = 180 }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);

  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "14px" }}>
        No storage historical data available
      </div>
    );
  }

  const values = data.map(d => d[yKey] || 0);
  const maxVal = Math.max(...values, 1.0);
  const minVal = Math.min(...values, 0.0);
  const valRange = maxVal - minVal;

  const width = 500;
  const padding = { top: 15, right: 15, bottom: 25, left: 60 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((d, idx) => {
    const x = padding.left + (idx / (data.length - 1 || 1)) * chartWidth;
    const y = padding.top + chartHeight - (((d[yKey] || 0) - minVal) / valRange) * chartHeight;
    return { x, y, item: d };
  });

  let pathD = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    pathD += ` L ${points[i].x},${points[i].y}`;
  }

  const areaD = `${pathD} L ${points[points.length - 1].x},${padding.top + chartHeight} L ${points[0].x},${padding.top + chartHeight} Z`;

  return (
    <div className="custom-chart-wrapper" style={{ position: "relative", width: "100%" }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="custom-chart-svg" style={{ width: "100%", height, display: "block" }}>
        <defs>
          <linearGradient id="storageAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Horizontal Grid Lines */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, idx) => {
          const y = padding.top + chartHeight * ratio;
          const val = maxVal - ratio * valRange;
          return (
            <g key={idx}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="var(--border-light)" strokeWidth="0.8" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill="var(--text-primary)" fontSize="13" fontWeight="700">
                {val.toFixed(0)} GB
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaD} fill="url(#storageAreaGrad)" />

        {/* Path line */}
        <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover points */}
        {points.map((pt, idx) => (
          <g key={idx}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r={hoveredPoint?.idx === idx ? "5" : "0"}
              fill="#8b5cf6"
              stroke="var(--bg-surface)"
              strokeWidth="1.5"
              style={{ transition: "r 0.1s ease" }}
            />
            <rect
              x={pt.x - 12}
              y={padding.top}
              width="24"
              height={chartHeight}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredPoint({ ...pt, idx })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          </g>
        ))}
      </svg>
      {hoveredPoint && (
        <div className="custom-chart-tooltip" style={{
          position: "absolute",
          top: Math.max(0, hoveredPoint.y - 45),
          left: Math.max(10, Math.min(hoveredPoint.x - 45, width - 100)),
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "4px 8px",
          fontSize: "11px",
          color: "var(--text-primary)",
          pointerEvents: "none",
          zIndex: 10,
          boxShadow: "0 4px 10px rgba(0, 0, 0, 0.4)",
          whiteSpace: "nowrap"
        }}>
          <div><strong>{hoveredPoint.item[xKey]}</strong></div>
          <div>{hoveredPoint.item[yKey].toFixed(1)} GB</div>
        </div>
      )}
    </div>
  );
};

// ─// ── Shared Color Palette for Alert Types ──
const ALERT_COLORS = {
  "motion": "#22c55e",
  "linecrossing": "#3b82f6",
  "leavingfield": "#f59e0b",
  "idleobject": "#a855f7",
  "object detection": "#ec4899",
  "intrusion": "#ef4444",
  "loitering": "#14b8a6",
  "tns1:recordingconfig": "#64748b",
  "unknown": "#6b7280"
};

const getAlertColor = (type) => {
  const normalized = String(type || "").toLowerCase().trim();
  if (normalized.includes("motion")) return "#22c55e";
  if (normalized.includes("line") || normalized.includes("crossing")) return "#3b82f6";
  if (normalized.includes("leaving")) return "#f59e0b";
  if (normalized.includes("idle") || normalized.includes("loiter")) return "#a855f7";
  if (normalized.includes("object")) return "#ec4899";
  if (normalized.includes("intrusion")) return "#ef4444";
  if (normalized.includes("face") || normalized.includes("auth")) return "#0ea5e9";
  if (normalized.includes("fire") || normalized.includes("smoke")) return "#f97316";
  if (normalized.includes("record")) return "#64748b";
  return ALERT_COLORS[normalized] || ALERT_COLORS["unknown"];
};

// ── Reusable Chart Card Wrapper with Search & Leaderboard ──
const ReportChartCard = ({
  title,
  subtitle,
  searchValue,
  onSearch,
  searchPlaceholder = "Find device...",
  showLeaderboardToggle = true,
  isLeaderboard,
  onToggleLeaderboard,
  leaderboardData = [], // [{ label, valueStr, barPct, barColor, isHatched }]
  children
}) => {
  return (
    <div className="report-chart-card">
      <div className="chart-card-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h4 className="chart-card-title">{title}</h4>
            <p className="chart-card-subtitle">{subtitle}</p>
          </div>
          {showLeaderboardToggle && (
            <button
              type="button"
              onClick={onToggleLeaderboard}
              className="chart-header-action-btn"
            >
              {isLeaderboard ? "Show Chart" : "View Leaderboard"}
            </button>
          )}
        </div>
        {onSearch && (
          <div className="chart-card-search-container" style={{ marginTop: "10px" }}>
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e) => onSearch(e.target.value)}
              className="chart-card-search-input"
            />
          </div>
        )}
      </div>
      <div className="chart-card-body">
        {isLeaderboard ? (
          <div className="chart-card-leaderboard-wrapper">
            {leaderboardData.length > 0 ? (
              <div className="chart-card-leaderboard-list">
                {leaderboardData.map((item, idx) => (
                  <div key={idx} className="chart-leaderboard-row">
                    <div className="chart-leaderboard-row-info">
                      <span className="chart-leaderboard-label" title={item.label}>{item.label}</span>
                      <span className="chart-leaderboard-value">{item.valueStr}</span>
                    </div>
                    <div className="chart-leaderboard-bar-track">
                      <div
                        className="chart-leaderboard-bar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(0, item.barPct))}%`,
                          background: item.isHatched ? "repeating-linear-gradient(45deg, #475569, #475569 5px, #64748b 5px, #64748b 10px)" : item.barColor || "var(--teal)"
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-chart-state">No matching devices.</div>
            )}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
};

const CameraEventsCharts = ({ reportData, reportFromDate, reportToDate }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isLeaderboard, setIsLeaderboard] = useState(false);

  const offlineEvents = reportData.filter(d => d.event === "device_offline");
  const uniqueIps = Array.from(new Set(reportData.map(d => d.ip).filter(ip => ip && ip !== "—")));
  const ipToIndex = {};
  uniqueIps.forEach((ip, idx) => {
    ipToIndex[ip] = idx;
  });

  const scatterData = offlineEvents.map(e => ({
    timestampVal: new Date(e.timestamp).getTime(),
    ipIndex: ipToIndex[e.ip],
    ip: e.ip,
    model: e.model,
    message: e.message,
    timeStr: new Date(e.timestamp).toLocaleString()
  }));

  const ipCounts = {};
  reportData.forEach(d => {
    if (d.event === "device_offline") {
      ipCounts[d.ip] = (ipCounts[d.ip] || 0) + 1;
    }
  });

  const offenders = Object.entries(ipCounts)
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count);

  const filteredOffenders = offenders.filter(o =>
    o.ip.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const topOffenders = filteredOffenders.slice(0, 10);
  const maxCount = offenders[0]?.count || 1;

  const ackCount = reportData.filter(d => d.acknowledged === "Yes").length;
  const unackCount = reportData.filter(d => d.acknowledged === "No").length;
  const pieData = [
    { name: "Acknowledged", value: ackCount, color: "#10b981" },
    { name: "Unacknowledged", value: unackCount, color: "#ef4444" }
  ].filter(d => d.value > 0);

  const leaderboardData = filteredOffenders.map(d => ({
    label: d.ip,
    valueStr: `${d.count} outages`,
    barPct: (d.count / maxCount) * 100,
    barColor: d.count > 5 ? "#ef4444" : d.count > 2 ? "#f59e0b" : "#faad14"
  }));

  return (
    <div className="report-charts-grid">
      {/* Chart 1: Outage Timeline */}
      <ReportChartCard
        title="Outage Timeline"
        subtitle="Distribution of device offline events over time"
        showLeaderboardToggle={false}
      >
        {scatterData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 60 }}>
              <XAxis 
                type="number" 
                dataKey="timestampVal" 
                name="Time" 
                domain={['dataMin - 60000', 'dataMax + 60000']} 
                tickFormatter={(tick) => new Date(tick).toLocaleDateString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}
                stroke="#ffffff" tick={{ fill: '#ffffff' }}
                fontSize={11}
              />
              <YAxis 
                type="number" 
                dataKey="ipIndex" 
                name="Camera IP" 
                ticks={uniqueIps.map((_, i) => i)}
                tickFormatter={(tick) => uniqueIps[tick] || ""}
                stroke="#ffffff" tick={{ fill: '#ffffff' }}
                fontSize={11}
                domain={[0, Math.max(uniqueIps.length - 1, 1)]}
              />
              <RechartsTooltip 
                cursor={{ strokeDasharray: '3 3' }} 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="custom-chart-tooltip">
                        <p style={{ margin: "0 0 4px 0", fontWeight: "bold", color: "#ef4444" }}>Offline Event</p>
                        <p style={{ margin: "0 0 2px 0" }}><strong>IP:</strong> {data.ip}</p>
                        <p style={{ margin: "0 0 2px 0" }}><strong>Model:</strong> {data.model}</p>
                        <p style={{ margin: "0 0 2px 0" }}><strong>Time:</strong> {data.timeStr}</p>
                        <p style={{ margin: "0", color: "var(--text-muted)" }}>{data.message}</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Scatter name="Outages" data={scatterData} fill="#ef4444" shape="circle" />
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-chart-state">No outages recorded — fleet stable.</div>
        )}
      </ReportChartCard>

      {/* Chart 2: Top Offline Offenders */}
      <ReportChartCard
        title="Top Offline Offenders"
        subtitle="Devices sorted by offline event frequency"
        searchValue={searchQuery}
        onSearch={setSearchQuery}
        searchPlaceholder="Find camera..."
        showLeaderboardToggle={true}
        isLeaderboard={isLeaderboard}
        onToggleLeaderboard={() => setIsLeaderboard(!isLeaderboard)}
        leaderboardData={leaderboardData}
      >
        {topOffenders.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={topOffenders} layout="vertical" margin={{ top: 10, right: 20, left: 30, bottom: 5 }}>
              <XAxis type="number" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} allowDecimals={false} />
              <YAxis type="category" dataKey="ip" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} width={110} interval={0} />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="custom-chart-tooltip">
                        <p style={{ margin: "0", fontWeight: "bold" }}>{payload[0].payload.ip}</p>
                        <p style={{ margin: "4px 0 0 0", color: "#ef4444" }}><strong>Outages:</strong> {payload[0].value}</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {topOffenders.map((entry, index) => {
                  const maxCount = topOffenders[0].count;
                  const ratio = entry.count / maxCount;
                  const color = ratio > 0.7 ? "#ef4444" : ratio > 0.4 ? "#f59e0b" : "#faad14";
                  return <Cell key={`cell-${index}`} fill={color} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-chart-state">No offline events in this range.</div>
        )}
      </ReportChartCard>

      {/* Chart 3: Acknowledgement Status */}
      <ReportChartCard
        title="Acknowledgement Status"
        subtitle="Ratio of acknowledged vs un-actioned alerts"
        showLeaderboardToggle={false}
      >
        {pieData.length > 0 ? (
          <div style={{ position: "relative", width: "100%", height: "260px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="48%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="#0f1115"
                  strokeWidth={2}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const total = ackCount + unackCount;
                      const pct = ((payload[0].value / total) * 100).toFixed(1);
                      return (
                        <div className="custom-chart-tooltip">
                          <p style={{ margin: "0", fontWeight: "bold", color: payload[0].payload.color }}>{payload[0].name}</p>
                          <p style={{ margin: "4px 0 0 0" }}><strong>Count:</strong> {payload[0].value} ({pct}%)</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend verticalAlign="bottom" height={36} formatter={(value) => <span style={{ color: "var(--text-primary)", fontSize: "11px" }}>{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{
              position: "absolute",
              top: "40%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              pointerEvents: "none"
            }}>
              <span style={{ fontSize: "22px", fontWeight: "700", display: "block", color: unackCount > 0 ? "#ef4444" : "var(--text-primary)" }}>
                {unackCount}
              </span>
              <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", display: "block", marginTop: "-2px" }}>
                Unacknowledged
              </span>
            </div>
          </div>
        ) : (
          <div className="empty-chart-state">No alerts in this range.</div>
        )}
      </ReportChartCard>
    </div>
  );
};

const AnalyticsAlertsCharts = ({ reportData, reportFromDate, reportToDate }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isLeaderboard, setIsLeaderboard] = useState(false);
  const [forceTreemap, setForceTreemap] = useState(null);

  const counts = {};
  reportData.forEach(d => {
    const cls = d.event && d.event !== "—" ? d.event : d.classification || "UNKNOWN";
    counts[cls] = (counts[cls] || 0) + 1;
  });

  const pieData = Object.entries(counts).map(([type, count]) => ({
    name: type,
    value: count,
    color: getAlertColor(type)
  })).sort((a, b) => b.value - a.value);

  const fromTime = new Date(reportFromDate).getTime();
  const toTime = new Date(reportToDate).getTime();
  const diffHrs = (toTime - fromTime) / (1000 * 60 * 60);

  let timeFormat = "hourly";
  if (diffHrs > 24 * 14) {
    timeFormat = "weekly";
  } else if (diffHrs > 24) {
    timeFormat = "daily";
  }

  const formatBucketKey = (date) => {
    const d = new Date(date);
    if (isNaN(d.getTime())) return "Invalid Date";
    const pad = (num) => String(num).padStart(2, "0");
    
    if (timeFormat === "hourly") {
      return `${pad(d.getHours())}:00`;
    } else if (timeFormat === "daily") {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    } else {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(d.setDate(diff));
      return `${startOfWeek.getMonth() + 1}/${startOfWeek.getDate()}`;
    }
  };

  const buckets = {};
  reportData.forEach(d => {
    const tsStr = d.time || d.timestamp || d.time_only;
    if (!tsStr) return;
    
    let finalDate = tsStr;
    if (!tsStr.includes("-") && !tsStr.includes("T")) {
      const today = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      finalDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}T${tsStr}`;
    }
    
    const bucketKey = formatBucketKey(finalDate);
    if (bucketKey === "Invalid Date") return;
    
    if (!buckets[bucketKey]) {
      buckets[bucketKey] = { label: bucketKey };
    }
    
    const cls = d.event && d.event !== "—" ? d.event : d.classification || "UNKNOWN";
    buckets[bucketKey][cls] = (buckets[bucketKey][cls] || 0) + 1;
  });

  const timeSeriesData = Object.values(buckets);
  if (timeFormat === "daily") {
    timeSeriesData.sort((a, b) => new Date(a.label) - new Date(b.label));
  } else if (timeFormat === "hourly") {
    timeSeriesData.sort((a, b) => a.label.localeCompare(b.label));
  }

  const alertTypes = Array.from(new Set(reportData.map(d => d.event && d.event !== "—" ? d.event : d.classification || "UNKNOWN")));

  const camCounts = {};
  reportData.forEach(d => {
    const ip = d.ip_address || "—";
    if (ip !== "—") {
      camCounts[ip] = (camCounts[ip] || 0) + 1;
    }
  });

  const allHotspots = Object.entries(camCounts)
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count);

  const filteredHotspots = allHotspots.filter(h =>
    h.ip.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const maxCount = allHotspots[0]?.count || 1;
  const uniqueCamerasCount = allHotspots.length;

  const showTreemap = forceTreemap !== null ? forceTreemap : uniqueCamerasCount > 15;

  const treemapData = filteredHotspots.map(h => ({
    name: h.ip,
    size: h.count
  }));

  const top10Hotspots = filteredHotspots.slice(0, 10);

  const leaderboardData = filteredHotspots.map(h => ({
    label: h.ip,
    valueStr: `${h.count} alerts`,
    barPct: (h.count / maxCount) * 100,
    barColor: "var(--teal)"
  }));

  const renderCustomTreemapContent = (props) => {
    const { x, y, width, height, name, size } = props;
    if (width < 35 || height < 20) return null;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          style={{
            fill: "rgba(20, 184, 166, 0.15)",
            stroke: "var(--border)",
            strokeWidth: 1.5,
          }}
        />
        <text
          x={x + width / 2}
          y={y + height / 2 - 4}
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize={11}
          fontWeight="600"
        >
          {name}
        </text>
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle"
          fill="var(--teal)"
          fontSize={10}
          fontWeight="bold"
        >
          {size} alerts
        </text>
      </g>
    );
  };

  return (
    <div className="report-charts-grid">
      {/* Chart 1: Alert Type Breakdown */}
      <ReportChartCard
        title="Alert Type Breakdown"
        subtitle="Distribution of triggered analytics trigger types"
        showLeaderboardToggle={false}
      >
        {pieData.length > 0 ? (
          <div style={{ position: "relative", width: "100%", height: "260px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="#0f1115"
                  strokeWidth={2}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const total = reportData.length;
                      const pct = ((payload[0].value / total) * 100).toFixed(1);
                      return (
                        <div className="custom-chart-tooltip">
                          <p style={{ margin: "0", fontWeight: "bold", color: payload[0].payload.color }}>{payload[0].name}</p>
                          <p style={{ margin: "4px 0 0 0" }}><strong>Count:</strong> {payload[0].value} ({pct}%)</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend verticalAlign="bottom" height={36} formatter={(value) => <span style={{ color: "var(--text-primary)", fontSize: "11px" }}>{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{
              position: "absolute",
              top: "37%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              pointerEvents: "none"
            }}>
              <span style={{ fontSize: "22px", fontWeight: "700", display: "block", color: "var(--text-primary)" }}>
                {reportData.length}
              </span>
              <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", display: "block", marginTop: "-2px" }}>
                Total Alerts
              </span>
            </div>
          </div>
        ) : (
          <div className="empty-chart-state">No alerts in this range.</div>
        )}
      </ReportChartCard>

      {/* Chart 2: Alert Volume Over Time */}
      <ReportChartCard
        title="Alert Volume Over Time"
        subtitle="Activity spikes per alert classification"
        showLeaderboardToggle={false}
      >
        {timeSeriesData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={timeSeriesData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <XAxis dataKey="label" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} />
              <YAxis stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} />
              <RechartsTooltip
                position={{ y: 0 }}
                wrapperStyle={{ pointerEvents: 'none', zIndex: 100 }}
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const activeItems = payload.filter((p) => Number(p.value) > 0);
                    const displayItems = activeItems.length > 0 ? activeItems : payload;
                    const total = payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
                    return (
                      <div className="custom-chart-tooltip" style={{ pointerEvents: "none", opacity: 0.95, padding: "6px 10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", borderBottom: "1px dashed rgba(255,255,255,0.15)", paddingBottom: "3px", marginBottom: "4px" }}>
                          <span style={{ fontWeight: "bold", fontSize: "11px", color: "var(--text-primary)" }}>{label}</span>
                          <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--teal)" }}>Total: {total}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: displayItems.length > 3 ? "repeat(2, minmax(0, 1fr))" : "1fr", gap: "2px 10px", fontSize: "11px" }}>
                          {displayItems.map((p, idx) => (
                            <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                              <span style={{ color: p.stroke, fontWeight: 600 }}>{p.name}:</span>
                              <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{p.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {alertTypes.map((type) => (
                <Line
                  key={type}
                  type="monotone"
                  dataKey={type}
                  stroke={getAlertColor(type)}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 6 }}
                  name={type}
                />
              ))}
              <Legend verticalAlign="bottom" height={36} formatter={(value) => <span style={{ color: "var(--text-primary)", fontSize: "11px" }}>{value}</span>} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-chart-state">No temporal trend data available.</div>
        )}
      </ReportChartCard>

      {/* Chart 3: Camera Hotspots */}
      <ReportChartCard
        title={showTreemap ? "Camera Hotspots (Treemap)" : "Camera Hotspots (Bars)"}
        subtitle={showTreemap ? "Size represents alert counts" : "Top 10 cameras triggering alerts"}
        searchValue={searchQuery}
        onSearch={setSearchQuery}
        searchPlaceholder="Find camera..."
        showLeaderboardToggle={true}
        isLeaderboard={isLeaderboard}
        onToggleLeaderboard={() => setIsLeaderboard(!isLeaderboard)}
        leaderboardData={leaderboardData}
      >
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
            <button
              type="button"
              onClick={() => setForceTreemap(showTreemap ? false : true)}
              style={{
                fontSize: "10px",
                color: "var(--text-secondary)",
                background: "transparent",
                border: "1px dashed var(--border)",
                padding: "1px 6px",
                borderRadius: "3px",
                cursor: "pointer"
              }}
            >
              Switch to {showTreemap ? "Bar View" : "Treemap View"}
            </button>
          </div>

          {filteredHotspots.length > 0 ? (
            showTreemap ? (
              <ResponsiveContainer width="100%" height={230}>
                <Treemap
                  data={treemapData}
                  dataKey="size"
                  ratio={4/3}
                  stroke="#0f1115"
                  content={renderCustomTreemapContent}
                >
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="custom-chart-tooltip">
                            <p style={{ margin: "0", fontWeight: "bold" }}>{data.name}</p>
                            <p style={{ margin: "4px 0 0 0", color: "var(--teal)" }}><strong>Alerts:</strong> {data.size}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </Treemap>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={top10Hotspots} layout="vertical" margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                  <XAxis type="number" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="ip" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} width={110} interval={0} />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="custom-chart-tooltip">
                            <p style={{ margin: "0", fontWeight: "bold" }}>{payload[0].payload.ip}</p>
                            <p style={{ margin: "4px 0 0 0", color: "var(--teal)" }}><strong>Alerts:</strong> {payload[0].value}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {top10Hotspots.map((entry, index) => {
                      const maxHCount = top10Hotspots[0].count;
                      const ratio = entry.count / maxHCount;
                      const color = ratio > 0.7 ? "#059669" : ratio > 0.4 ? "#10b981" : "#34d399";
                      return <Cell key={`cell-${index}`} fill={color} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
          ) : (
            <div className="empty-chart-state">No hot cameras recorded.</div>
          )}
        </div>
      </ReportChartCard>
    </div>
  );
};

const DeviceHealthCharts = ({ reportData }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isLeaderboard, setIsLeaderboard] = useState(false);
  const [viewModeOverride, setViewModeOverride] = useState(null);

  const onlineCount = reportData.filter(d => d.current_status === "online").length;
  const offlineCount = reportData.filter(d => d.current_status === "offline" || d.current_status?.toLowerCase().includes("offline")).length;
  
  const pieData = [
    { name: "Online", value: onlineCount, color: "#10b981" },
    { name: "Offline", value: offlineCount, color: "#ef4444" }
  ].filter(d => d.value > 0);

  const totalDevices = onlineCount + offlineCount;
  const healthPct = totalDevices > 0 ? Math.round((onlineCount / totalDevices) * 100) : 0;

  const parseLatency = (latencyStr) => {
    if (!latencyStr || latencyStr === "—") return -1;
    const match = latencyStr.match(/^(\d+(\.\d+)?)\s*ms/);
    if (match) return parseFloat(match[1]);
    const num = parseFloat(latencyStr);
    return isNaN(num) ? -1 : num;
  };

  const rawLatencyData = reportData.map(d => {
    const val = parseLatency(d.latency_ms);
    const isOffline = d.current_status === "offline" || val === -1;
    return {
      name: d.device_id || d.ip_address || "—",
      latency: isOffline ? 1 : val,
      rawLatency: d.latency_ms,
      isOffline: isOffline
    };
  });

  const sortedLatencyData = [...rawLatencyData].sort((a, b) => {
    if (a.isOffline && !b.isOffline) return 1;
    if (!a.isOffline && b.isOffline) return -1;
    return b.latency - a.latency;
  });

  const filteredLatencyData = sortedLatencyData.filter(d =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getLatencyColor = (latency, isOffline) => {
    if (isOffline) return "#64748b";
    if (latency > 50) return "#ef4444";
    if (latency >= 40) return "#f59e0b";
    return "#22c55e";
  };

  const histCounts = { offline: 0, excellent: 0, good: 0, fair: 0, high: 0 };
  rawLatencyData.forEach(d => {
    if (d.isOffline) histCounts.offline++;
    else if (d.latency < 15) histCounts.excellent++;
    else if (d.latency < 30) histCounts.good++;
    else if (d.latency <= 50) histCounts.fair++;
    else histCounts.high++;
  });

  const latencyHistogramData = [
    { name: "Offline", count: histCounts.offline, color: "#64748b" },
    { name: "<15ms (Exc)", count: histCounts.excellent, color: "#22c55e" },
    { name: "15-30ms (Good)", count: histCounts.good, color: "#14b8a6" },
    { name: "30-50ms (Fair)", count: histCounts.fair, color: "#f59e0b" },
    { name: ">50ms (High)", count: histCounts.high, color: "#ef4444" }
  ];

  const defaultToHistogram = totalDevices > 40;
  const currentViewMode = viewModeOverride !== null ? viewModeOverride : (defaultToHistogram ? "histogram" : "devices");

  const top15Latency = filteredLatencyData.slice(0, 15);
  const maxLatency = Math.max(...rawLatencyData.map(d => d.latency), 50);

  const leaderboardData = filteredLatencyData.map(d => ({
    label: d.name,
    valueStr: d.isOffline ? "Offline" : `${d.rawLatency}`,
    barPct: d.isOffline ? 100 : (d.latency / maxLatency) * 100,
    barColor: getLatencyColor(d.latency, d.isOffline),
    isHatched: d.isOffline
  }));

  const rebootData = reportData.map(d => ({
    name: d.device_id || d.ip_address || "—",
    reboots: parseInt(d.reboot_count) || 0
  }))
  .filter(d => d.reboots > 0)
  .sort((a, b) => b.reboots - a.reboots);

  const filteredReboots = rebootData.filter(d =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const maxReboots = rebootData[0]?.reboots || 1;
  const rebootLeaderboard = filteredReboots.map(d => ({
    label: d.name,
    valueStr: `${d.reboots} reboots`,
    barPct: (d.reboots / maxReboots) * 100,
    barColor: "#f59e0b"
  }));

  return (
    <div className="report-charts-grid">
      {/* Chart 1: Fleet Health Overview */}
      <ReportChartCard
        title="Fleet Health Overview"
        subtitle="Active vs offline devices in infrastructure"
        showLeaderboardToggle={false}
      >
        {pieData.length > 0 ? (
          <div style={{ position: "relative", width: "100%", height: "260px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="48%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="#0f1115"
                  strokeWidth={2}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="custom-chart-tooltip">
                          <p style={{ margin: "0", fontWeight: "bold", color: payload[0].payload.color }}>{payload[0].name}</p>
                          <p style={{ margin: "4px 0 0 0" }}><strong>Count:</strong> {payload[0].value}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend verticalAlign="bottom" height={36} formatter={(value) => <span style={{ color: "var(--text-primary)", fontSize: "11px" }}>{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{
              position: "absolute",
              top: "40%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              pointerEvents: "none"
            }}>
              <span style={{ fontSize: "22px", fontWeight: "700", display: "block", color: healthPct >= 90 ? "#10b981" : healthPct >= 75 ? "#f59e0b" : "#ef4444" }}>
                {healthPct}%
              </span>
              <span style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", display: "block", marginTop: "-2px" }}>
                {onlineCount}/{totalDevices} Online
              </span>
            </div>
          </div>
        ) : (
          <div className="empty-chart-state">No device data available.</div>
        )}
      </ReportChartCard>

      {/* Chart 2: Latency by Device */}
      <ReportChartCard
        title={currentViewMode === "histogram" ? "Latency Distribution (Hist)" : "Latency by Device"}
        subtitle={currentViewMode === "histogram" ? "Device counts segmented by latency range" : "Ping latencies with 50ms threshold"}
        searchValue={currentViewMode === "devices" ? searchQuery : ""}
        onSearch={setSearchQuery}
        searchPlaceholder="Find device..."
        showLeaderboardToggle={currentViewMode === "devices"}
        isLeaderboard={isLeaderboard}
        onToggleLeaderboard={() => setIsLeaderboard(!isLeaderboard)}
        leaderboardData={leaderboardData}
      >
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
            <button
              type="button"
              onClick={() => setViewModeOverride(currentViewMode === "histogram" ? "devices" : "histogram")}
              style={{
                fontSize: "10px",
                color: "var(--text-secondary)",
                background: "transparent",
                border: "1px dashed var(--border)",
                padding: "1px 6px",
                borderRadius: "3px",
                cursor: "pointer"
              }}
            >
              Switch to {currentViewMode === "histogram" ? "Per-Device View" : "Histogram View"}
            </button>
          </div>

          {filteredLatencyData.length > 0 ? (
            currentViewMode === "histogram" ? (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={latencyHistogramData} margin={{ top: 15, right: 20, left: 10, bottom: 5 }}>
                  <XAxis dataKey="name" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={9} />
                  <YAxis stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} allowDecimals={false} />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="custom-chart-tooltip">
                            <p style={{ margin: "0", fontWeight: "bold", color: payload[0].payload.color }}>{payload[0].name}</p>
                            <p style={{ margin: "4px 0 0 0" }}><strong>Devices count:</strong> {payload[0].value}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {latencyHistogramData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={top15Latency} margin={{ top: 15, right: 20, left: 10, bottom: 5 }}>
                  <defs>
                    <pattern id="latencyHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <line x1="0" y1="0" x2="0" y2="6" stroke="#475569" strokeWidth="2.5" />
                    </pattern>
                  </defs>
                  <XAxis dataKey="name" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={9} />
                  <YAxis stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} label={{ value: 'Latency (ms)', angle: -90, position: 'insideLeft', fill: '#ffffff', fontSize: 11 }} />
                  <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="3 3" />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="custom-chart-tooltip">
                            <p style={{ margin: "0", fontWeight: "bold" }}>{data.name}</p>
                            <p style={{ margin: "4px 0 0 0" }}>
                              <strong>Latency:</strong> {data.isOffline ? <span style={{ color: "#ef4444" }}>Unreachable (Offline)</span> : `${data.rawLatency}`}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="latency" radius={[4, 4, 0, 0]}>
                    {top15Latency.map((entry, index) => {
                      if (entry.isOffline) {
                        return <Cell key={`cell-${index}`} fill="url(#latencyHatch)" stroke="#64748b" strokeWidth={1} />;
                      }
                      const color = getLatencyColor(entry.latency, entry.isOffline);
                      return <Cell key={`cell-${index}`} fill={color} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )
          ) : (
            <div className="empty-chart-state">No latency statistics available.</div>
          )}
        </div>
      </ReportChartCard>

      {/* Chart 3: Reboot Instability Ranking */}
      <ReportChartCard
        title="Reboot Instability Ranking"
        subtitle="Devices flagged for instability due to reboot triggers"
        searchValue={searchQuery}
        onSearch={setSearchQuery}
        searchPlaceholder="Find camera..."
        showLeaderboardToggle={rebootData.length > 0}
        isLeaderboard={isLeaderboard}
        onToggleLeaderboard={() => setIsLeaderboard(!isLeaderboard)}
        leaderboardData={rebootLeaderboard}
      >
        {filteredReboots.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={filteredReboots.slice(0, 10)} layout="vertical" margin={{ top: 10, right: 20, left: 30, bottom: 5 }}>
              <XAxis type="number" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} allowDecimals={false} />
              <YAxis type="category" dataKey="name" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} width={110} interval={0} />
              <RechartsTooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="custom-chart-tooltip">
                        <p style={{ margin: "0", fontWeight: "bold" }}>{payload[0].payload.name}</p>
                        <p style={{ margin: "4px 0 0 0", color: "#f59e0b" }}><strong>Reboots:</strong> {payload[0].value}</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="reboots" fill="#f59e0b" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-chart-state" style={{ color: "#10b981", border: "1px dashed rgba(34, 197, 94, 0.2)" }}>
            No reboots recorded — fleet stable.
          </div>
        )}
      </ReportChartCard>
    </div>
  );
};

const CameraHistoryCharts = ({ reportData }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isLeaderboard, setIsLeaderboard] = useState(false);
  const [viewModeOverride, setViewModeOverride] = useState(null);

  const parseTimeToHours = (timeStr) => {
    if (!timeStr || timeStr === "—") return 0;
    const parts = timeStr.split(":");
    if (parts.length === 2) {
      const h = parseInt(parts[0]) || 0;
      const m = parseInt(parts[1]) || 0;
      return h + m / 60;
    }
    const num = parseFloat(timeStr);
    return isNaN(num) ? 0 : num;
  };

  const parsedData = reportData.map(d => {
    const camUp = parseTimeToHours(d.cam_up_hrs);
    const camDown = parseTimeToHours(d.cam_down_hrs);
    const camTotal = camUp + camDown;
    const camPct = camTotal > 0 ? (camUp / camTotal) * 100 : 0;

    const recUp = parseTimeToHours(d.rec_up_hrs);
    const recDown = parseTimeToHours(d.rec_down_hrs);
    const recTotal = recUp + recDown;
    const recPct = recTotal > 0 ? (recUp / recTotal) * 100 : 0;

    return {
      name: d.camera_name || d.ip_address || "—",
      camUp: parseFloat(camUp.toFixed(2)),
      camDown: parseFloat(camDown.toFixed(2)),
      camPct: parseFloat(camPct.toFixed(1)),
      recUp: parseFloat(recUp.toFixed(2)),
      recDown: parseFloat(recDown.toFixed(2)),
      recPct: parseFloat(recPct.toFixed(1))
    };
  });

  const sortedCamData = [...parsedData].sort((a, b) => a.camPct - b.camPct);
  const sortedRecData = [...parsedData].sort((a, b) => a.recPct - b.recPct);

  const filteredCamData = sortedCamData.filter(d =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const filteredRecData = sortedRecData.filter(d =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalDevices = parsedData.length;
  const defaultToHistogram = totalDevices > 40;
  const currentViewMode = viewModeOverride !== null ? viewModeOverride : (defaultToHistogram ? "histogram" : "devices");

  const camHist = { critical: 0, poor: 0, fair: 0, excellent: 0 };
  const recHist = { critical: 0, poor: 0, fair: 0, excellent: 0 };

  parsedData.forEach(d => {
    if (d.camPct < 50) camHist.critical++;
    else if (d.camPct < 70) camHist.poor++;
    else if (d.camPct < 90) camHist.fair++;
    else camHist.excellent++;

    if (d.recPct < 50) recHist.critical++;
    else if (d.recPct < 70) recHist.poor++;
    else if (d.recPct < 90) recHist.fair++;
    else recHist.excellent++;
  });

  const camHistogramData = [
    { name: "<50% (Crit)", count: camHist.critical, color: "#ef4444" },
    { name: "50-70% (Poor)", count: camHist.poor, color: "#f59e0b" },
    { name: "70-90% (Fair)", count: camHist.fair, color: "#faad14" },
    { name: "90-100% (Exc)", count: camHist.excellent, color: "#22c55e" }
  ];

  const recHistogramData = [
    { name: "<50% (Crit)", count: recHist.critical, color: "#ef4444" },
    { name: "50-70% (Poor)", count: recHist.poor, color: "#f59e0b" },
    { name: "70-90% (Fair)", count: recHist.fair, color: "#faad14" },
    { name: "90-100% (Exc)", count: recHist.excellent, color: "#22c55e" }
  ];

  const leaderboardCamData = filteredCamData.map(d => ({
    label: d.name,
    valueStr: `${d.camPct}% uptime`,
    barPct: d.camPct,
    barColor: d.camPct >= 95 ? "#22c55e" : d.camPct >= 80 ? "#f59e0b" : "#ef4444"
  }));

  const leaderboardRecData = filteredRecData.map(d => ({
    label: d.name,
    valueStr: `${d.recPct}% active`,
    barPct: d.recPct,
    barColor: d.recPct >= 95 ? "#22c55e" : d.recPct >= 80 ? "#f59e0b" : "#ef4444"
  }));

  let totalCamUp = 0;
  let totalCamDown = 0;
  let totalRecUp = 0;
  let totalRecDown = 0;

  parsedData.forEach(d => {
    totalCamUp += d.camUp;
    totalCamDown += d.camDown;
    totalRecUp += d.recUp;
    totalRecDown += d.recDown;
  });

  const fleetCamTotal = totalCamUp + totalCamDown;
  const fleetCamPct = fleetCamTotal > 0 ? (totalCamUp / fleetCamTotal) * 100 : 0;
  
  const fleetRecTotal = totalRecUp + totalRecDown;
  const fleetRecPct = fleetRecTotal > 0 ? (totalRecUp / fleetRecTotal) * 100 : 0;

  const renderHalfGauge = (pct, title) => {
    const gaugeData = [
      { value: pct },
      { value: Math.max(0, 100 - pct) }
    ];
    const color = pct >= 95 ? "#10b981" : pct >= 80 ? "#f59e0b" : "#ef4444";
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "48%", position: "relative" }}>
        <div style={{ position: "relative", width: "100%", height: "130px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={gaugeData}
                dataKey="value"
                startAngle={180}
                endAngle={0}
                cx="50%"
                cy="100%"
                innerRadius={55}
                outerRadius={75}
                stroke="none"
              >
                <Cell fill={color} />
                <Cell fill="var(--border-light)" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{
            position: "absolute",
            bottom: "0",
            left: "50%",
            transform: "translateX(-50%)",
            textAlign: "center"
          }}>
            <span style={{ fontSize: "20px", fontWeight: "700", color }}>
              {pct.toFixed(1)}%
            </span>
          </div>
        </div>
        <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--text-secondary)", marginTop: "12px", textAlign: "center", textTransform: "uppercase" }}>
          {title}
        </span>
      </div>
    );
  };

  return (
    <div className="report-charts-grid">
      {/* Chart 1: Camera Availability */}
      <ReportChartCard
        title={currentViewMode === "histogram" ? "Camera Availability Shape (Hist)" : "Camera Availability"}
        subtitle={currentViewMode === "histogram" ? "Device counts by availability percentage" : "Worst 15 cameras connection hours"}
        searchValue={currentViewMode === "devices" ? searchQuery : ""}
        onSearch={setSearchQuery}
        searchPlaceholder="Find camera..."
        showLeaderboardToggle={currentViewMode === "devices"}
        isLeaderboard={isLeaderboard}
        onToggleLeaderboard={() => setIsLeaderboard(!isLeaderboard)}
        leaderboardData={leaderboardCamData}
      >
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
            <button
              type="button"
              onClick={() => setViewModeOverride(currentViewMode === "histogram" ? "devices" : "histogram")}
              style={{
                fontSize: "10px",
                color: "var(--text-secondary)",
                background: "transparent",
                border: "1px dashed var(--border)",
                padding: "1px 6px",
                borderRadius: "3px",
                cursor: "pointer"
              }}
            >
              Switch to {currentViewMode === "histogram" ? "Per-Device View" : "Histogram View"}
            </button>
          </div>

          {filteredCamData.length > 0 ? (
            currentViewMode === "histogram" ? (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={camHistogramData} margin={{ top: 15, right: 20, left: 10, bottom: 5 }}>
                  <XAxis dataKey="name" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={9} />
                  <YAxis stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} allowDecimals={false} />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="custom-chart-tooltip">
                            <p style={{ margin: "0", fontWeight: "bold", color: payload[0].payload.color }}>{payload[0].name}</p>
                            <p style={{ margin: "4px 0 0 0" }}><strong>Cameras:</strong> {payload[0].value}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {camHistogramData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={filteredCamData.slice(0, 15)} layout="vertical" margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                  <XAxis type="number" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} label={{ value: 'Hours', position: 'insideBottom', offset: -5, fill: '#ffffff' }} />
                  <YAxis type="category" dataKey="name" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={10} width={110} interval={0} />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="custom-chart-tooltip">
                            <p style={{ margin: "0", fontWeight: "bold" }}>{data.name}</p>
                            <p style={{ margin: "4px 0 2px 0", color: "#10b981" }}><strong>Up Hours:</strong> {data.camUp} hrs</p>
                            <p style={{ margin: "0 0 2px 0", color: "#ef4444" }}><strong>Down Hours:</strong> {data.camDown} hrs</p>
                            <p style={{ margin: "4px 0 0 0", borderTop: "1px dashed rgba(255,255,255,0.1)", paddingTop: "4px" }}>
                              <strong>Availability:</strong> {data.camPct}%
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="camUp" stackId="availability" fill="#10b981" />
                  <Bar dataKey="camDown" stackId="availability" fill="#ef4444" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )
          ) : (
            <div className="empty-chart-state">No availability history.</div>
          )}
        </div>
      </ReportChartCard>

      {/* Chart 2: Recording Reliability */}
      <ReportChartCard
        title={currentViewMode === "histogram" ? "Recording Reliability Shape (Hist)" : "Recording Reliability"}
        subtitle={currentViewMode === "histogram" ? "Device counts by recording reliability percentage" : "Worst 15 cameras recording hours"}
        searchValue={currentViewMode === "devices" ? searchQuery : ""}
        onSearch={setSearchQuery}
        searchPlaceholder="Find camera..."
        showLeaderboardToggle={currentViewMode === "devices"}
        isLeaderboard={isLeaderboard}
        onToggleLeaderboard={() => setIsLeaderboard(!isLeaderboard)}
        leaderboardData={leaderboardRecData}
      >
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
            <button
              type="button"
              onClick={() => setViewModeOverride(currentViewMode === "histogram" ? "devices" : "histogram")}
              style={{
                fontSize: "10px",
                color: "var(--text-secondary)",
                background: "transparent",
                border: "1px dashed var(--border)",
                padding: "1px 6px",
                borderRadius: "3px",
                cursor: "pointer"
              }}
            >
              Switch to {currentViewMode === "histogram" ? "Per-Device View" : "Histogram View"}
            </button>
          </div>

          {filteredRecData.length > 0 ? (
            currentViewMode === "histogram" ? (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={recHistogramData} margin={{ top: 15, right: 20, left: 10, bottom: 5 }}>
                  <XAxis dataKey="name" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={9} />
                  <YAxis stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} allowDecimals={false} />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="custom-chart-tooltip">
                            <p style={{ margin: "0", fontWeight: "bold", color: payload[0].payload.color }}>{payload[0].name}</p>
                            <p style={{ margin: "4px 0 0 0" }}><strong>Cameras:</strong> {payload[0].value}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {recHistogramData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={filteredRecData.slice(0, 15)} layout="vertical" margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
                  <XAxis type="number" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={11} label={{ value: 'Hours', position: 'insideBottom', offset: -5, fill: '#ffffff' }} />
                  <YAxis type="category" dataKey="name" stroke="#ffffff" tick={{ fill: '#ffffff' }} fontSize={10} width={110} interval={0} />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="custom-chart-tooltip">
                            <p style={{ margin: "0", fontWeight: "bold" }}>{data.name}</p>
                            <p style={{ margin: "4px 0 2px 0", color: "#10b981" }}><strong>Rec Up Hours:</strong> {data.recUp} hrs</p>
                            <p style={{ margin: "0 0 2px 0", color: "#ef4444" }}><strong>Rec Down Hours:</strong> {data.recDown} hrs</p>
                            <p style={{ margin: "4px 0 0 0", borderTop: "1px dashed rgba(255,255,255,0.1)", paddingTop: "4px" }}>
                              <strong>Reliability:</strong> {data.recPct}%
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="recUp" stackId="reliability" fill="#10b981" />
                  <Bar dataKey="recDown" stackId="reliability" fill="#ef4444" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )
          ) : (
            <div className="empty-chart-state">No recording history.</div>
          )}
        </div>
      </ReportChartCard>

      {/* Chart 3: Fleet Availability Score */}
      <ReportChartCard
        title="Fleet Availability Score"
        subtitle="Aggregate metrics score for cameras vs recording"
        showLeaderboardToggle={false}
      >
        <div className="chart-card-body" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", width: "100%" }}>
          {renderHalfGauge(fleetCamPct, "Camera Fleet")}
          {renderHalfGauge(fleetRecPct, "Recording Fleet")}
        </div>
      </ReportChartCard>
    </div>
  );
};

const parseEvents = (uiLogsList, infraAlertsList) => {
  const merged = [];

  if (Array.isArray(uiLogsList)) {
    uiLogsList.forEach(log => {
      const act = log.action || "";
      const ts = log.timestamp;
      let eventType = null;
      let message = act;

      if (act.toLowerCase().includes("logged in")) {
        eventType = "User Login";
      } else if (act.toLowerCase().includes("recording") && act.toLowerCase().includes("start")) {
        eventType = "Recording Started";
      } else if (act.toLowerCase().includes("stopped recorder") || act.toLowerCase().includes("stopped: ")) {
        eventType = "Recording Stopped";
      } else if (log.category === "storage" || act.toLowerCase().includes("storage") || act.toLowerCase().includes("disk")) {
        eventType = "Storage Events";
      }

      if (eventType) {
        merged.push({
          id: `ui-${log.timestamp}-${message}`,
          type: eventType,
          message,
          timestamp: ts,
          rawTime: ts
        });
      }
    });
  }

  if (Array.isArray(infraAlertsList)) {
    infraAlertsList.forEach(alert => {
      const ev = alert.event || "";
      const msg = alert.message || "";
      const ts = alert.timestamp;
      let eventType = null;

      if (ev === "device_offline") {
        eventType = "Camera Offline";
      } else if (ev === "device_online") {
        eventType = "Camera Online";
      }

      if (eventType) {
        merged.push({
          id: `infra-${alert.timestamp}-${msg}`,
          type: eventType,
          message: msg,
          timestamp: ts,
          rawTime: ts
        });
      }
    });
  }

  merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const seen = new Set();
  const unique = [];
  for (const item of merged) {
    const key = `${item.type}-${item.message}-${item.rawTime}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique.slice(0, 10);
};

const DashboardPage = () => {
  const navigate = useNavigate();
  const { logAction } = useActivityLogger();
  const { theme } = useTheme();
  const [isAiActive, setIsAiActive] = useState(false);

  useEffect(() => {
    const fetchIntegrations = async () => {
      try {
        const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token")) || localStorage.getItem('token');
        const API_BASE = import.meta.env.VITE_API_URL || "";
        const res = await fetch(API_BASE + "/api/integrations", {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        if (res.ok) {
          const data = await res.json();
          const aiInt = data.find(i => i.isActive && i.isConnected && i.type.toLowerCase().includes('ai'));
          setIsAiActive(!!aiInt);
        }
      } catch (err) {}
    };
    fetchIntegrations();
  }, []);
  const { isConnected: isWsConnected, systemMetrics, eventsByTopic } = useWebSocket(['alerts', 'camera_status', 'system_metrics', 'dashboard_overview']);


  const [summary, setSummary] = useState({
    total_cameras: 0,
    active_streams: 0,
    alarms_today: 0,
    cpu: 0,
    ram: 0,
    disk: 0,
    alerts: [],
    status: "Healthy",
    history: { cpu: [], ram: [], disk: [] }
  });

  // Sync real-time WebSocket telemetry metrics
  useEffect(() => {
    if (systemMetrics) {
      setSummary(prev => ({
        ...prev,
        cpu: systemMetrics.cpu ?? prev.cpu,
        ram: systemMetrics.ram ?? prev.ram,
        disk: systemMetrics.disk ?? prev.disk,
        history: {
          cpu: [...(prev.history?.cpu || []).slice(-19), systemMetrics.cpu],
          ram: [...(prev.history?.ram || []).slice(-19), systemMetrics.ram],
          disk: [...(prev.history?.disk || []).slice(-19), systemMetrics.disk]
        }
      }));
    }
  }, [systemMetrics]);

  // Sync real-time AI & Analytics alerts over WebSocket
  useEffect(() => {
    const alertEnvelope = eventsByTopic.alerts;
    if (alertEnvelope && alertEnvelope.data) {
      setEvents(prev => [alertEnvelope.data, ...prev.filter(e => (e.event_id || e._id) !== (alertEnvelope.data.event_id || alertEnvelope.data._id))]);
      setSummary(prev => ({ ...prev, alarms_today: prev.alarms_today + 1 }));
    }
  }, [eventsByTopic.alerts]);

  // Sync camera online/offline status changes over WebSocket
  useEffect(() => {
    const statusEnvelope = eventsByTopic.camera_status;
    if (statusEnvelope && statusEnvelope.data) {
      const { ip, status } = statusEnvelope.data;
      setCameras(prev => prev.map(c => (c.ip === ip || c.ip_address === ip) ? { ...c, enabled: status === 'online' } : c));
    }
  }, [eventsByTopic.camera_status]);

  // Sync full dashboard overview data pushed from backend every 10s (replaces HTTP polling)
  useEffect(() => {
    const overviewEvents = eventsByTopic['dashboard_overview'];
    if (!overviewEvents || overviewEvents.length === 0) return;
    const latest = overviewEvents[overviewEvents.length - 1];
    if (!latest || !latest.payload) return;
    const data = latest.payload;

    if (data.summary) {
      setSummary(prev => {
        const cpu = data.summary.cpu ?? prev.cpu;
        const ram = data.summary.ram ?? prev.ram;
        const disk = data.summary.disk ?? prev.disk;
        const cpuHist = [...(prev.history?.cpu || []), cpu].slice(-20);
        const ramHist = [...(prev.history?.ram || []), ram].slice(-20);
        const diskHist = [...(prev.history?.disk || []), disk].slice(-20);
        return {
          ...prev,
          ...data.summary,
          history: { cpu: cpuHist, ram: ramHist, disk: diskHist },
        };
      });
    }
    if (data.events) setEvents(data.events);
    if (data.cameras) setCameras(data.cameras);
    if (data.active_recorders) setActiveRecorders(data.active_recorders);
    if (data.camera_health) setCameraHealth(Array.isArray(data.camera_health) ? data.camera_health : []);
    setLoading(false);
  }, [eventsByTopic['dashboard_overview']]);


  const [storage, setStorage] = useState({ total: 0, used: 0, free: 0, location: "—" });
  const [events, setEvents] = useState([]);

  const [cameras, setCameras] = useState([]);
  const [activeRecorders, setActiveRecorders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFailedCamerasPopup, setShowFailedCamerasPopup] = useState(false);
  const [recordingSchedules, setRecordingSchedules] = useState([]);

  // Enhanced Widget States
  const [serverMetrics, setServerMetrics] = useState({ uptime: "—", last_reboot: "—" });
  const [healthInfo, setHealthInfo] = useState({ status: "ok", version: "1.0.0", watchdog: "Active" });
  const [recentSystemEvents, setRecentSystemEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [serverTime, setServerTime] = useState(new Date().toLocaleTimeString());

  const recordingCount = cameras.filter((cam) => {
    if (cam.enabled === false) return false;
    const streamKey = cam.stream_key || cam.stream_key;
    return activeRecorders.includes(streamKey);
  }).length;

  const enabledCount = cameras.filter((cam) => cam.enabled !== false).length;
  const [cameraHealth, setCameraHealth] = useState([]);

  // Phase 2 Widget States
  const [storageDiagnostics, setStorageDiagnostics] = useState({
    total_gb: 0,
    used_gb: 0,
    free_gb: 0,
    usage_pct: 0,
    avg_daily_consumption: null,
    retention_days: null,
    predicted_exhaustion_date: null,
    warning_status: false,
    trend_history: []
  });
  const [bitrateDiagnostics, setBitrateDiagnostics] = useState({
    current_bitrate: 0,
    avg_bitrate: 0,
    peak_bitrate: 0,
    trend_data: []
  });
  const [camerasBandwidth, setCamerasBandwidth] = useState({
    total_bandwidth: 0,
    top_cameras: []
  });
  const [bitrateFilter, setBitrateFilter] = useState("1h");
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true);

  // ─── NEW: Report Generation States ─────────────────────────────────────────
  const [reportFromDate, setReportFromDate] = useState(getInitialFromDate());
  const [reportToDate, setReportToDate] = useState(getInitialToDate());
  const [reportType, setReportType] = useState("alerts");
  const [reportData, setReportData] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportCurrentPage, setReportCurrentPage] = useState(1);
  const [reportDropdownOpen, setReportDropdownOpen] = useState(false);
  const [actionsDropdownOpen, setActionsDropdownOpen] = useState(false);
  const actionsDropdownRef = useRef(null);
  const widgetsScrollRef = useRef(null);

  const [reportSuccessMsg, setReportSuccessMsg] = useState("");
  const [reportErrorMsg, setReportErrorMsg] = useState("");
  const [reportLiveOnly, setReportLiveOnly] = useState(false);
  const [reportAnalyticsStatus, setReportAnalyticsStatus] = useState("all");
  const [reportAnalyticsSource, setReportAnalyticsSource] = useState("all");
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [reportViewModes, setReportViewModes] = useState({
    alerts: "tabular",
    live_alerts: "tabular",
    health: "tabular",
    history: "tabular"
  });
  const [lastViewModeTransition, setLastViewModeTransition] = useState(null);

  const handleSetViewMode = (type, mode) => {
    setLastViewModeTransition({ from: reportViewModes[type], to: mode });
    setReportViewModes(prev => ({
      ...prev,
      [type]: mode
    }));
  };

  const renderGraphicalReport = () => {
    if (!reportData || reportData.length === 0) return null;

    switch (reportType) {
      case "alerts":
        return <CameraEventsCharts reportData={reportData} reportFromDate={reportFromDate} reportToDate={reportToDate} />;
      case "live_alerts":
        return <AnalyticsAlertsCharts reportData={reportData} reportFromDate={reportFromDate} reportToDate={reportToDate} />;
      case "health":
        return <DeviceHealthCharts reportData={reportData} />;
      case "history":
        return <CameraHistoryCharts reportData={reportData} />;
      default:
        return null;
    }
  };

  const reportPerPage = 10;

  const reportRef = useRef(null);

  const reportTypeMap = {
    alerts: "Camera Up/Down Events",
    live_alerts: "Analytics Alerts",
    health: "Device Health & Uptime Status",
    history: "Camera & Recording History (Hours)"
  };

  const handleGenerateReport = async () => {
    setReportLoading(true);
    setReportSuccessMsg("");
    setReportErrorMsg("");
    try {
      const fromTime = new Date(reportFromDate).getTime();
      const toTime = new Date(reportToDate).getTime();

      const fromIso = new Date(fromTime).toISOString();
      const toIso = new Date(toTime).toISOString();

      if (reportType === "alerts") {
        // Query recent alerts and filter by date range
        const res = await fetch(`${API_BASE}/api/infrastructure/alerts?limit=5000&from_date=${fromIso}&to_date=${toIso}`, {
          headers: getAuthHeaders()
        });
        const alertsData = await res.json();
        
        if (Array.isArray(alertsData)) {
          const filtered = alertsData.filter(a => {
            const ts = new Date(a.timestamp).getTime();
            return ts >= fromTime && ts <= toTime && a.type && a.type.toLowerCase() === "camera";
          });
          
          const formatted = filtered.map(a => ({
            timestamp: a.timestamp,
            ip: a.ip || "—",
            model: a.model || "—",
            type: a.type || "—",
            event: a.event || "—",
            message: a.message || "—",
            acknowledged: a.acknowledged ? "Yes" : "No"
          }));
          
          setReportData(formatted);
          setReportCurrentPage(1);
          if (formatted.length > 0) {
            setReportSuccessMsg(`Successfully generated report with ${formatted.length} camera up/down history records.`);
          } else {
            setReportSuccessMsg("No camera up/down history records found for the selected time range.");
          }
        } else {
          setReportErrorMsg("Failed to fetch alerts from server.");
        }
      } else if (reportType === "live_alerts") {
        const queryParams = new URLSearchParams({
          limit: 5000,
          from_date: fromIso,
          to_date: toIso,
          source: reportAnalyticsSource,
          status: reportAnalyticsStatus
        });
        const res = await fetch(`${API_BASE}/api/alerts?${queryParams.toString()}`, {
          headers: getAuthHeaders()
        });
        const alertsRes = await res.json();
        const alertsList = Array.isArray(alertsRes) ? alertsRes : (alertsRes.alerts || []);
        
        if (Array.isArray(alertsList)) {
          const filtered = alertsList.filter(a => {
            const timeVal = a.received_at || a.time;
            if (!timeVal) return false;
            
            // Normalize time-only strings or standard timestamps to local datetime strings
            let finalDateStr = timeVal;
            if (!timeVal.includes("-") && !timeVal.includes("T")) {
              const d = new Date();
              const pad = (n) => String(n).padStart(2, "0");
              const todayLocalStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
              finalDateStr = `${todayLocalStr}T${timeVal}`;
            }
            
            // Normalize space to T for parsing compatibility
            finalDateStr = finalDateStr.replace(" ", "T");
            
            const ts = new Date(finalDateStr).getTime();
            return !isNaN(ts) && ts >= fromTime && ts <= toTime;
          });
          
          const formatted = filtered.map(a => ({
            timestamp: a.received_at || "—",
            ip_address: a.ip ? a.ip.replace(/_/g, ".") : "—",
            classification: a.type || "—",
            event: a.scenario || a.feature || a.subType || "—",
            details: a.employeeName || a.label || a.vehicleType || a.message || "—",
            status: (a.acknowledged_at && (a.resolved_at || a.status === "Resolved")) ? "Resolved" : (a.status === "Resolved" || a.resolved_at) ? "Resolved" : (a.status === "Acknowledged" || a.acknowledged_at) ? "Acknowledged" : "Active"
          }));
          
          setReportData(formatted);
          setReportCurrentPage(1);
          if (formatted.length > 0) {
            setReportSuccessMsg(`Successfully generated report with ${formatted.length} Analytics Alerts.`);
          } else {
            setReportSuccessMsg("No Analytics Alerts found for the selected time range.");
          }
        } else {
          setReportErrorMsg("Failed to fetch Analytics Alerts from server.");
        }
      } else if (reportType === "health") {
        // Query topology nodes for health status
        const res = await fetch(`${API_BASE}/api/infrastructure/topology`, {
          headers: getAuthHeaders()
        });
        const topoData = await res.json();
        
        if (topoData && Array.isArray(topoData.nodes)) {
          const formatted = topoData.nodes.map(n => ({
            device_id: n.id || "—",
            ip_address: n.ip || "—",
            manufacturer: n.manufacturer || "—",
            model: n.model || "—",
            device_type: n.type || "—",
            current_status: n.status || "offline",
            latency_ms: n.latency !== undefined && n.latency !== null ? `${n.latency} ms` : "—",
            uptime_duration: n.uptime || "—",
            online_since: n.last_seen || "—",
            reboot_count: n.reboot_count !== undefined ? String(n.reboot_count) : "0",
            last_reboot: n.last_reboot || "—"
          }));
          
          setReportData(formatted);
          setReportCurrentPage(1);
          if (formatted.length > 0) {
            setReportSuccessMsg(`Successfully generated health report with ${formatted.length} devices.`);
          } else {
            setReportSuccessMsg("No active devices found in infrastructure topology.");
          }
        } else {
          setReportErrorMsg("Failed to fetch topology from server.");
        }
      } else if (reportType === "history") {
        // Query the new reports_router history endpoint
        const fromIso = new Date(fromTime).toISOString();
        const toIso = new Date(toTime).toISOString();
        const res = await fetch(`${API_BASE}/api/reports/history?from_date=${fromIso}&to_date=${toIso}&live_only=${reportLiveOnly}`, {
          headers: getAuthHeaders()
        });
        const historyData = await res.json();

        if (historyData.status === "success" && Array.isArray(historyData.data)) {
          const uniqueCams = {};
          historyData.data.forEach(cam => {
            const key = cam.ip || cam.name || "unknown";
            if (!uniqueCams[key]) {
              uniqueCams[key] = {
                name: cam.name || "—",
                ip: cam.ip || "—",
                camera_hours_up: cam.camera_hours_up || 0,
                camera_hours_down: cam.camera_hours_down || 0,
                recording_hours_up: cam.recording_hours_up || 0,
                recording_hours_down: cam.recording_hours_down || 0,
                storage_consumed_bytes: cam.storage_consumed_bytes || 0
              };
            }
            // If duplicate IP exists, use the values (don't sum — they represent the same camera)
          });

          const formatHours = (decHours) => {
            if (decHours == null) return "00:00";
            const totalMins = Math.round(Number(decHours) * 60);
            const h = Math.floor(totalMins / 60);
            const m = totalMins % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          };

          const formatted = Object.values(uniqueCams).map(cam => ({
            camera_name: cam.name,
            ip_address: cam.ip,
            cam_up_hrs: formatHours(cam.camera_hours_up),
            cam_down_hrs: formatHours(cam.camera_hours_down),
            rec_up_hrs: formatHours(cam.recording_hours_up),
            rec_down_hrs: formatHours(cam.recording_hours_down),
            storage_consumed: (cam.storage_consumed_bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB"
          }));
          
          setReportData(formatted);
          setReportCurrentPage(1);
          if (formatted.length > 0) {
            setReportSuccessMsg(`Successfully generated History report for ${formatted.length} cameras.`);
          } else {
            setReportSuccessMsg("No cameras found for History report.");
          }
        } else {
          setReportErrorMsg("Failed to fetch camera history from server.");
        }
      }
      
    } catch (err) {
      console.error(err);
      setReportErrorMsg("An error occurred while generating the report.");
    } finally {
      setReportLoading(false);
      setTimeout(() => {
        reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  };

  const handleDownloadCSV = () => {
    if (!reportData || reportData.length === 0) return;

    // If currently in Graphical View, include aggregated chart metrics summary in CSV export
    const currentViewMode = reportViewModes[reportType] || "tabular";
    const csvRows = [];

    if (currentViewMode === "graphical") {
      csvRows.push(`"Report Type: ${reportTypeMap[reportType]} (Graphical View Summary)"`);
      csvRows.push(`"Period: ${reportFromDate.replace('T', ' ')} to ${reportToDate.replace('T', ' ')}"`);
      csvRows.push("");

      if (reportType === "alerts") {
        const offlineCount = reportData.filter(d => d.event === "device_offline").length;
        const ackCount = reportData.filter(d => d.acknowledged === "Yes").length;
        const unackCount = reportData.filter(d => d.acknowledged === "No").length;
        csvRows.push(`"Summary Metric","Value"`);
        csvRows.push(`"Total Camera Events","${reportData.length}"`);
        csvRows.push(`"Device Offline Outages","${offlineCount}"`);
        csvRows.push(`"Acknowledged Outages","${ackCount}"`);
        csvRows.push(`"Unacknowledged Outages","${unackCount}"`);
        csvRows.push("");
      } else if (reportType === "live_alerts") {
        const counts = {};
        reportData.forEach(d => {
          const cls = d.event && d.event !== "—" ? d.event : d.classification || "UNKNOWN";
          counts[cls] = (counts[cls] || 0) + 1;
        });
        csvRows.push(`"Alert Classification","Count"`);
        Object.entries(counts).forEach(([cls, cnt]) => {
          csvRows.push(`"${cls}","${cnt}"`);
        });
        csvRows.push(`"Total Analytics Alerts","${reportData.length}"`);
        csvRows.push("");
      } else if (reportType === "health") {
        const onlineCount = reportData.filter(d => d.current_status === "online").length;
        const offlineCount = reportData.filter(d => d.current_status === "offline" || d.current_status?.toLowerCase().includes("offline")).length;
        csvRows.push(`"Fleet Health Status","Device Count"`);
        csvRows.push(`"Online Devices","${onlineCount}"`);
        csvRows.push(`"Offline Devices","${offlineCount}"`);
        csvRows.push(`"Total Devices","${reportData.length}"`);
        csvRows.push("");
      } else if (reportType === "history") {
        csvRows.push(`"Camera Name","IP Address","Cam Up (hrs)","Cam Down (hrs)","Rec Up (hrs)","Rec Down (hrs)","Storage"`);
        reportData.forEach(row => {
          csvRows.push(`"${row.camera_name}","${row.ip_address}","${row.cam_up_hrs}","${row.cam_down_hrs}","${row.rec_up_hrs}","${row.rec_down_hrs}","${row.storage_consumed}"`);
        });
        csvRows.push("");
      }
    }

    const headers = Object.keys(reportData[0]);
    csvRows.push(headers.map(h => `"${h.replace(/_/g, " ").toUpperCase()}"`).join(","));

    for (const row of reportData) {
      const values = headers.map(header => {
        const val = row[header];
        const escaped = ("" + (val === null || val === undefined ? "" : val)).replace(/"/g, '""');
        return `"${escaped}"`;
      });
      csvRows.push(values.join(","));
    }

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${reportType}_report_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    logAction(`Exported ${reportTypeMap[reportType]} Report (CSV)`, "export", { records: reportData.length });
  };

  const handleDownloadPDF = async () => {
    if (!reportData || reportData.length === 0) return;
    const doc = new jsPDF();

    // Title
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.text(`${reportTypeMap[reportType]} Report`, 14, 15);

    // Download Date/Time in top right
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    const now = new Date();
    const downloadTime = `Downloaded: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
    const textWidth = doc.getTextWidth(downloadTime);
    const pageWidth = doc.internal.pageSize.width;
    doc.text(downloadTime, pageWidth - textWidth - 14, 15);

    // Selected Date Range
    const fromToText = `Selected Period: ${reportFromDate.replace('T', ' ')} to ${reportToDate.replace('T', ' ')}`;
    doc.text(fromToText, 14, 22);
    
    let currentY = 28;

    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.text("Tabular Data Records", 14, currentY);
    doc.setFont("helvetica", "normal");
    currentY += 4;

    const keys = Object.keys(reportData[0]).filter(k => !(reportType === "live_alerts" && reportAnalyticsSource === "built_in" && k.toLowerCase() === "details"));
    const headers = keys.map(k => k.replace(/_/g, " ").toUpperCase());
    const rows = reportData.map(row => keys.map(k => {
      const val = row[k];
      return val === null || val === undefined ? "—" : String(val);
    }));

    doc.autoTable({
      head: [headers],
      body: rows,
      startY: currentY,
      theme: "grid",
      styles: { 
        fontSize: 8, 
        textColor: [0, 0, 0],
        lineColor: [200, 200, 200],
        lineWidth: 0.1
      },
      headStyles: { 
        fillColor: [220, 230, 241],
        textColor: [0, 0, 0], 
        fontStyle: 'bold' 
      },
      didParseCell: function(data) {
        if (data.section === 'body') {
           const colHeader = headers[data.column.index].toLowerCase();
           if (colHeader.includes('camera') || colHeader === 'ip' || colHeader === 'device') {
              data.cell.styles.fontStyle = 'bold';
           }
        }
      }
    });

    currentY = doc.lastAutoTable.finalY + 10;

    // Capture all charts together in one grid container image so they stay on one single page
    const chartsGridEl = document.querySelector(".report-charts-grid");
    if (chartsGridEl) {
      try {
        const html2canvas = (await import("html2canvas")).default;
        
        if (currentY + 20 > 280) {
          doc.addPage();
          currentY = 15;
        }

        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "bold");
        doc.text("Graphical Performance Analytics", 14, currentY);
        doc.setFont("helvetica", "normal");
        currentY += 6;

        const canvas = await html2canvas(chartsGridEl, {
          scale: 2,
          backgroundColor: "#171a21",
          logging: false,
          useCORS: true
        });
        const imgData = canvas.toDataURL("image/png");
        const imgWidth = 182; // page width (210) minus margins (14*2)
        const imgHeight = Math.min((canvas.height * imgWidth) / canvas.width, 190); // cap max height so it fits on page 1

        if (currentY + imgHeight > 280) {
          doc.addPage();
          currentY = 15;
        }

        doc.addImage(imgData, "PNG", 14, currentY, imgWidth, imgHeight);
        currentY += imgHeight + 8;
      } catch (err) {
        console.warn("Could not capture charts grid for PDF export:", err);
      }
    }

    doc.save(`${reportType}_report_${new Date().toISOString().slice(0,10)}.pdf`);
    logAction(`Exported ${reportTypeMap[reportType]} Report (PDF)`, "export", { records: reportData.length });
  };

  const handleDownloadExcel = () => {
    if (!reportData || reportData.length === 0) return;
    const wb = XLSX.utils.book_new();
    const currentViewMode = reportViewModes[reportType] || "tabular";

    // Primary sheet: Tabular Records
    const keys = Object.keys(reportData[0]).filter(k => !(reportType === "live_alerts" && reportAnalyticsSource === "built_in" && k.toLowerCase() === "details"));
    const mappedData = reportData.map(row => {
      const obj = {};
      keys.forEach(k => {
        const headerName = k.replace(/_/g, " ").toUpperCase();
        obj[headerName] = row[k] === null || row[k] === undefined ? "—" : row[k];
      });
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(mappedData);
    XLSX.utils.book_append_sheet(wb, ws, "Tabular Data");

    // Optional secondary sheet: Graphical Summary Metrics
    if (currentViewMode === "graphical" || true) {
      const summaryRows = [];
      summaryRows.push({ Metric: "Report Title", Details: reportTypeMap[reportType] });
      summaryRows.push({ Metric: "From Date", Details: reportFromDate.replace('T', ' ') });
      summaryRows.push({ Metric: "To Date", Details: reportToDate.replace('T', ' ') });
      summaryRows.push({ Metric: "Total Records Generated", Details: reportData.length });

      if (reportType === "alerts") {
        summaryRows.push({ Metric: "Device Offline Events", Details: reportData.filter(d => d.event === "device_offline").length });
        summaryRows.push({ Metric: "Acknowledged Alerts", Details: reportData.filter(d => d.acknowledged === "Yes").length });
      } else if (reportType === "live_alerts") {
        const counts = {};
        reportData.forEach(d => {
          const cls = d.event && d.event !== "—" ? d.event : d.classification || "UNKNOWN";
          counts[cls] = (counts[cls] || 0) + 1;
        });
        Object.entries(counts).forEach(([cls, count]) => {
          summaryRows.push({ Metric: `Alert Type: ${cls}`, Details: count });
        });
      } else if (reportType === "health") {
        summaryRows.push({ Metric: "Online Devices", Details: reportData.filter(d => d.current_status === "online").length });
        summaryRows.push({ Metric: "Offline Devices", Details: reportData.filter(d => d.current_status === "offline").length });
      }

      const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(wb, summaryWs, "Graphical Summary");
    }

    XLSX.writeFile(wb, `${reportType}_report_${new Date().toISOString().slice(0,10)}.xlsx`);
    logAction(`Exported ${reportTypeMap[reportType]} Report (Excel)`, "export", { records: reportData.length });
  };

  // Pagination for report
  const indexOfLastReport = reportCurrentPage * reportPerPage;
  const indexOfFirstReport = indexOfLastReport - reportPerPage;
  const currentReportRows = reportData.slice(indexOfFirstReport, indexOfLastReport);
  const totalReportPages = Math.ceil(reportData.length / reportPerPage);

  useEffect(() => {
    const timer = setInterval(() => {
      setServerTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchRecentEvents = async () => {
    try {
      const [logsRes, alertsRes] = await Promise.all([
        fetch(`${API_BASE}/api/logs/ui?limit=50`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/api/infrastructure/alerts?limit=50`, { headers: getAuthHeaders() })
      ]);
      const logsJson = await logsRes.json();
      const alertsJson = await alertsRes.json();
      const parsed = parseEvents(logsJson.logs || [], alertsJson || []);
      setRecentSystemEvents(parsed);
    } catch (err) {
      console.error("Failed to fetch recent events:", err);
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch only; subsequent updates come via WebSocket dashboard_overview topic
    fetchRecentEvents();
  }, []);


  const handleCameraStatusClick = () => {
    const reportSection = document.querySelector('.report-generation');
    if (reportSection) {
      reportSection.scrollIntoView({ behavior: 'smooth' });
    }
    setReportType('health');
    setTimeout(() => {
      handleGenerateReport();
    }, 500);
  };

  const fetchDiagnostics = async () => {
    try {
      const [storageRes, bitrateRes, bandwidthRes] = await Promise.all([
        fetch(`${API_BASE}/api/storage/diagnostics`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/api/bitrate/diagnostics?filter_type=${bitrateFilter}`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/api/cameras/bandwidth`, { headers: getAuthHeaders() })
      ]);

      if (storageRes.ok) {
        const storageData = await storageRes.json();
        setStorageDiagnostics(storageData);
      }
      if (bitrateRes.ok) {
        const bitrateData = await bitrateRes.json();
        setBitrateDiagnostics(bitrateData);
      }
      if (bandwidthRes.ok) {
        const bandwidthData = await bandwidthRes.json();
        setCamerasBandwidth(bandwidthData);
      }
    } catch (err) {
      console.error("Diagnostics fetch error:", err);
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch only; storage/bitrate diagnostics are lower-frequency and not yet WS-pushed
    fetchDiagnostics();
  }, [bitrateFilter]);



  useEffect(() => {
    // One-time initial load; subsequent updates are pushed via WebSocket dashboard_overview topic.
    const fetchInitialData = async () => {
      try {
        const [sumRes, storRes, eventRes, camRes, statusRes, healthRes, metricsRes, camHealthRes] = await Promise.all([
          fetch(`${API_BASE}/api/dashboard/summary`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/storage/management`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/dashboard/events`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/cameras`, { headers: getAuthHeaders() }),
          fetch(`${API_BASE}/api/recordings/status`, { headers: getAuthHeaders() }).catch(() => null),
          fetch(`${API_BASE}/api/health`, { headers: getAuthHeaders() }).catch(() => null),
          fetch(`${API_BASE}/api/infrastructure/metrics`, { headers: getAuthHeaders() }).catch(() => null),
          fetch(`${API_BASE}/api/camera-health`, { headers: getAuthHeaders() }).catch(() => null),
          fetch(`${API_BASE}/api/storage/schedules`, { headers: getAuthHeaders() }).catch(() => null)
        ]);

        const sumData = sumRes.ok ? await sumRes.json() : {};
        const storData = storRes.ok ? await storRes.json() : [];
        const eventData = eventRes.ok ? await eventRes.json() : [];
        const camData = camRes.ok ? await camRes.json() : [];

        if (statusRes && statusRes.ok) {
          const statusData = await statusRes.json();
          setActiveRecorders(statusData.active_recorders || []);
        }
        if (healthRes && healthRes.ok) {
          const healthData = await healthRes.json();
          setHealthInfo(healthData);
        }
        if (metricsRes && metricsRes.ok) {
          const metricsData = await metricsRes.json();
          setServerMetrics(metricsData);
        }
        if (camHealthRes && camHealthRes.ok) {
          const camHealthData = await camHealthRes.json();
          setCameraHealth(Array.isArray(camHealthData) ? camHealthData : []);
        }

        setSummary(prev => {
          const cpu = sumData.cpu || 0;
          const ram = sumData.ram || 0;
          const disk = sumData.disk || 0;
          const cpuHist = Array.from({ length: 15 }, () => Math.max(5, Math.min(95, cpu + Math.floor((Math.random() - 0.5) * 10))));
          const ramHist = Array.from({ length: 15 }, () => Math.max(5, Math.min(95, ram + Math.floor((Math.random() - 0.5) * 10))));
          const diskHist = Array.from({ length: 15 }, () => Math.max(1, Math.min(99, disk + Math.floor((Math.random() - 0.5) * 2))));
          return { ...sumData, history: { cpu: cpuHist, ram: ramHist, disk: diskHist } };
        });
        if (storData && Array.isArray(storData) && storData.length > 0) setStorage(storData[0]);
        setEvents(Array.isArray(eventData) ? eventData : []);
        setCameras(Array.isArray(camData) ? camData : []);

        try {
          const schedRes = await fetch(`${API_BASE}/api/storage/schedules`, { headers: getAuthHeaders() });
          if (schedRes.ok) {
            const schedData = await schedRes.json();
            setRecordingSchedules(Array.isArray(schedData) ? schedData : []);
          }
        } catch (_) {}
      } catch (err) {
        console.error("Dashboard initial fetch error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, []);



  // 🎨 Color logic for health bars
  const getColor = (value) => {
    if (value > 85) return "#ff4d4f";
    if (value > 60) return "#faad14";
    return "#52c41a";
  };

  // ✅ FIX 3 — getCameraHealth moved ABOVE usage
  // ✅ FIX FINAL — Added fps === 0 check
  const getCameraHealth = (cam) => {
    if (cam.status === "error") return "error";
    if (cam.fps === 0) return "error";
    if (!cam.fps) return "connecting";
    if (cam.fps < 10) return "warning";
    return "online";
  };

  // 🚨 Critical events filter (from events feed)
  const criticalEvents = events.filter(
    (e) =>
      e.event_type?.toLowerCase().includes("intrusion") ||
      e.event_type?.toLowerCase().includes("offline") ||
      e.event_type?.toLowerCase().includes("error")
  );

  // 🔥 Dynamic Alerts
  const dynamicAlerts = [];

  cameraHealth.forEach((cam) => {
    if (cam.status === "error") {
      dynamicAlerts.push(`${cam.stream} offline`);
    }
    if (cam.fps && cam.fps < 10) {
      dynamicAlerts.push(`${cam.stream} low FPS`);
    }
  });

  const storagePercent = storageDiagnostics.usage_pct || (storage.total > 0 ? (storage.used / storage.total) * 100 : 0);

  if (summary.cpu > 85) dynamicAlerts.push("High CPU usage");
  if (summary.ram > 85) dynamicAlerts.push("High RAM usage");
  if (storagePercent > 90) dynamicAlerts.push("Storage almost full");

  const stats = [
    {
      title: "Total Cameras",
      value: summary.total_cameras,
      icon: <Camera size={18} />,
      color: "#3b82f6"
    },
    {
      title: "Active Streams",
      value: summary.active_streams,
      icon: <Activity size={18} />,
      color: "#22c55e"
    },
    {
      title: "Alarms Today",
      value: summary.alarms_today,
      icon: <Bell size={18} />,
      color: "#ef4444"
    },
    {
      title: "Disk Capacity",
      value: `${storage.used} / ${storage.total} GB`,
      icon: <HardDrive size={18} />,
      color: "#f59e0b"
    },
    {
      title: "Recording Cameras",
      value: `${recordingCount} / ${enabledCount}`,
      icon: <Server size={18} />,
      color: "#8b5cf6"
    }
  ];

  let storageStatus = "normal";
  if (storagePercent > 90) storageStatus = "critical";
  else if (storagePercent > 80) storageStatus = "warning";

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1 className="dashboard-page-title">Overview</h1>
        <div className="dashboard-update-badge">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      {/* 🔹 Stats Cards */}
      <div className="cards">
        {/* Simple stat cards */}
        {[
          { title: "Total Cameras", value: summary.total_cameras, icon: <Camera size={18} /> },
          { title: "Active Streams", value: summary.active_streams, icon: <Activity size={18} /> },
          { title: "Alarms Today", value: summary.alarms_today, icon: <Bell size={18} /> }
        ].map((item, index) => (
          <div className="card" key={index}>
            <div className="icon">{item.icon}</div>
            <div className="card-content">
              <p className="title">{item.title}</p>
              <h3>{item.value}</h3>
            </div>
          </div>
        ))}


        {/* Recording Cameras */}
        <div className="card" key="rec">
          <div className="icon"><Server size={18} /></div>
          <div className="card-content">
            <p className="title">Recording Cameras</p>
            <h3>{recordingCount} / {enabledCount}</h3>
          </div>
        </div>
      </div>

      <div className="health-section">
        <h3>System Health</h3>

        <div className="health-grid">

          {/* CPU — Area trend chart */}
          <div className="health-box">
            <div className="health-box-header">
              <div className="health-box-label"><Cpu size={14} /> <p>CPU</p></div>
              <h2>{summary.cpu}%</h2>
            </div>
            <CpuAreaChart data={summary.history.cpu} value={summary.cpu} />
            <span className={summary.cpu > 85 ? "bad" : summary.cpu > 60 ? "warn" : "good"}>
              {summary.cpu > 85 ? "Critical" : summary.cpu > 60 ? "High" : "Normal"}
            </span>
          </div>

          {/* RAM — Bar chart */}
          <div className="health-box">
            <div className="health-box-header">
              <div className="health-box-label"><MemoryStick size={14} /> <p>RAM</p></div>
              <h2>{summary.ram}%</h2>
            </div>
            <RamUsageGauge value={summary.ram} />
            <span className={summary.ram > 85 ? "bad" : summary.ram > 60 ? "warn" : "good"}>
              {summary.ram > 85 ? "Critical" : summary.ram > 60 ? "High" : "Normal"}
            </span>
          </div>

          {/* Disk — Sleek Progress Gauge */}
          <div className="health-box">
            <div className="health-box-header">
              <div className="health-box-label"><HardDrive size={14} /><p>Disk</p></div>
              <h2>{Math.round(storagePercent)}%</h2>
            </div>
            
            {/* Sleek Segmented Disk Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: '4px 0' }}>
              <div style={{
                height: '16px',
                width: '100%',
                background: 'var(--bg-elevated)',
                borderRadius: '6px',
                border: '1px solid var(--border-light)',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  height: '100%',
                  width: `${storagePercent}%`,
                  background: `linear-gradient(90deg, ${storagePercent > 90 ? '#ef4444' : storagePercent > 75 ? '#faad14' : '#52c41a'}cc, ${storagePercent > 90 ? '#ef4444' : storagePercent > 75 ? '#faad14' : '#52c41a'})`,
                  borderRadius: '5px 0 0 5px',
                  transition: 'width 0.6s ease'
                }} />
                {/* Horizontal segments to make it look premium */}
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 15px, var(--border-dim, rgba(125, 125, 125, 0.2)) 15px, var(--border-dim, rgba(125, 125, 125, 0.2)) 17px)',
                  pointerEvents: 'none'
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: 'var(--text-primary)', fontWeight: '600' }}>
                <span>Used: {storageDiagnostics.used_gb || storage.used} GB</span>
                <span>Free: {storageDiagnostics.free_gb || (storage.total - storage.used).toFixed(1)} GB</span>
              </div>
            </div>

            <span className={storagePercent > 90 ? "bad" : storagePercent > 75 ? "warn" : "good"}>
              {storagePercent > 90 ? "Full" : storagePercent > 75 ? "Filling" : "Healthy"}
            </span>
          </div>

        </div>
      </div>

      {/* ── Enhanced Diagnostics & Service Status Section ── */}
      <div className="enhanced-widgets-section">
        <div className="widgets-carousel-wrapper">
          {/* Left Arrow */}
          <button
            className="carousel-arrow carousel-arrow-left"
            onClick={() => widgetsScrollRef.current?.scrollBy({ left: -340, behavior: "smooth" })}
            aria-label="Scroll left"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          {/* Scrollable track */}
          <div className="widgets-scroll-track" ref={widgetsScrollRef}>

            {/* Widget 1: Server Health */}
            <div className="enhanced-card">
              <div className="enhanced-card-header">
                <span className="header-icon"><Server size={18} /></span>
                <h4>Server Health</h4>
                <span className={`badge ${healthInfo.status === "ok" ? "healthy" : "unhealthy"}`} style={{ marginLeft: "auto", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px", background: healthInfo.status === "ok" ? "rgba(34, 197, 94, 0.12)" : "rgba(239, 68, 68, 0.12)", color: healthInfo.status === "ok" ? "#22c55e" : "#ef4444", padding: "3px 9px", borderRadius: "12px", fontWeight: "600" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: healthInfo.status === "ok" ? "#22c55e" : "#ef4444", display: "inline-block" }} />
                  {healthInfo.status === "ok" ? "Online" : "Offline"}
                </span>
              </div>
              <div className="widget-content-list">
                <div className="widget-item-row">
                  <span className="widget-item-label">Server Uptime</span>
                  <span className="widget-item-value">{serverMetrics.uptime || "—"}</span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">Backend Status</span>
                  <span className={`widget-item-value ${healthInfo.status === "ok" ? "healthy" : "unhealthy"}`}>
                    {healthInfo.status === "ok" ? "Healthy" : "Unhealthy"}
                  </span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">Server Time</span>
                  <span className="widget-item-value">{serverTime}</span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">App Version</span>
                  <span className="widget-item-value">v{healthInfo.version || "1.0.0"}</span>
                </div>

                {/* Micro Service Status Chips */}
                <div style={{ marginTop: "auto", paddingTop: "10px", borderTop: "1px dashed var(--border-light)", display: "flex", justifyContent: "space-between", gap: "4px" }}>
                  <div style={{ background: "var(--bg-elevated)", padding: "4px 7px", borderRadius: "6px", fontSize: "11px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "5px" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e" }} /> API
                  </div>
                  <div style={{ background: "var(--bg-elevated)", padding: "4px 7px", borderRadius: "6px", fontSize: "11px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "5px" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e" }} /> Database
                  </div>
                  <div style={{ background: "var(--bg-elevated)", padding: "4px 7px", borderRadius: "6px", fontSize: "11px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "5px" }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e" }} /> Streamer
                  </div>
                </div>
              </div>
            </div>

            {/* Widget 2: Device Health */}
            <div className="enhanced-card">
              <div className="enhanced-card-header">
                <span className="header-icon"><Camera size={18} /></span>
                <h4>Device Health</h4>
                <span className="badge healthy" style={{ marginLeft: "auto", fontSize: "11px", background: "rgba(34, 197, 94, 0.12)", color: "#22c55e", padding: "3px 9px", borderRadius: "12px", fontWeight: "600" }}>
                  {summary.total_cameras} Devices
                </span>
              </div>
              <div className="widget-content-list">
                <div className="widget-item-row">
                  <span className="widget-item-label">Total Cameras</span>
                  <span className="widget-item-value">{summary.total_cameras}</span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">Online Cameras</span>
                  <span className="widget-item-value healthy">{summary.active_streams}</span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">Offline Cameras</span>
                  <span className="widget-item-value unhealthy">{summary.total_cameras - summary.active_streams}</span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">Recording Cameras</span>
                  <span className="widget-item-value">{recordingCount}</span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">Signal Loss Cameras</span>
                  <span className="widget-item-value unhealthy">{summary.total_cameras - summary.active_streams}</span>
                </div>

                {/* Availability Progress Bar */}
                <div style={{ marginTop: "auto", paddingTop: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", marginBottom: "4px" }}>
                    <span className="widget-item-label" style={{ fontSize: "11.5px" }}>Availability Rate</span>
                    <strong style={{ color: "#22c55e" }}>
                      {summary.total_cameras > 0 ? Math.round((summary.active_streams / summary.total_cameras) * 100) : 0}%
                    </strong>
                  </div>
                  <div className="card-inline-bar" style={{ marginTop: 0 }}>
                    <div
                      className="card-inline-bar-fill"
                      style={{
                        width: `${summary.total_cameras > 0 ? (summary.active_streams / summary.total_cameras) * 100 : 0}%`,
                        background: "linear-gradient(90deg, #22c55e, #00d2ff)"
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Widget 3: Recording Health */}
            <div className="enhanced-card">
              <div className="enhanced-card-header">
                <span className="header-icon"><Server size={18} /></span>
                <h4>Recording Health</h4>
                <span className={`badge ${activeRecorders.length > 0 ? "healthy" : "unhealthy"}`} style={{ marginLeft: "auto", fontSize: "11px", background: activeRecorders.length > 0 ? "rgba(34, 197, 94, 0.12)" : "rgba(239, 68, 68, 0.12)", color: activeRecorders.length > 0 ? "#22c55e" : "#ef4444", padding: "3px 9px", borderRadius: "12px", fontWeight: "600" }}>
                  {activeRecorders.length > 0 ? "Active" : "Stopped"}
                </span>
              </div>
              <div className="widget-content-list">
                <div className="widget-item-row">
                  <span className="widget-item-label">Recording Cameras</span>
                  <span className="widget-item-value">{recordingCount} / {enabledCount}</span>
                </div>
                <div
                  className="widget-item-row"
                  onClick={() => setShowFailedCamerasPopup(true)}
                  style={{ cursor: "pointer" }}
                  title="Click to view failed recordings"
                >
                  <span className="widget-item-label" style={{ textDecoration: "underline" }}>Failed Recordings</span>
                  <span className={`widget-item-value ${cameras.filter(cam => cam.enabled !== false && !activeRecorders.includes(cam.stream_key || cam.stream_key)).length > 0 ? "unhealthy" : "healthy"}`}>
                    {cameras.filter(cam => cam.enabled !== false && !activeRecorders.includes(cam.stream_key || cam.stream_key)).length}
                  </span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">Service Status</span>
                  <span className={`widget-item-value ${activeRecorders.length > 0 ? "healthy" : "unhealthy"}`}>
                    {activeRecorders.length > 0 ? "Running" : "Stopped"}
                  </span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">Storage Mode</span>
                  <span className="widget-item-value" style={{ color: "#38bdf8" }}>Continuous & Motion</span>
                </div>

                {/* Recording Utilization Bar */}
                <div style={{ marginTop: "auto", paddingTop: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", marginBottom: "4px" }}>
                    <span className="widget-item-label" style={{ fontSize: "11.5px" }}>Recording Active</span>
                    <strong style={{ color: enabledCount > 0 && recordingCount / enabledCount >= 0.8 ? "#22c55e" : "#f59e0b" }}>
                      {enabledCount > 0 ? Math.round((recordingCount / enabledCount) * 100) : 0}%
                    </strong>
                  </div>
                  <div className="card-inline-bar" style={{ marginTop: 0 }}>
                    <div
                      className="card-inline-bar-fill"
                      style={{
                        width: `${enabledCount > 0 ? (recordingCount / enabledCount) * 100 : 0}%`,
                        background: "linear-gradient(90deg, #8b5cf6, #3b82f6)"
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Widget 4: Storage Details */}
            <div className="enhanced-card">
              <div className="enhanced-card-header">
                <span className="header-icon"><HardDrive size={18} /></span>
                <h4>Storage Details</h4>
                {storageDiagnostics.warning_status && (
                  <span className="badge warning" style={{ marginLeft: "auto", fontSize: "11px" }}>Low Storage Warning</span>
                )}
              </div>
              <div className="widget-content-list">
                <div className="widget-item-row">
                  <span className="widget-item-label">Total Capacity</span>
                  <span className="widget-item-value">{(storageDiagnostics.total_gb / 1024).toFixed(2)} TB ({storageDiagnostics.total_gb} GB)</span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">Used Space</span>
                  <span className="widget-item-value">{(storageDiagnostics.used_gb / 1024).toFixed(2)} TB ({storageDiagnostics.used_gb} GB)</span>
                </div>
                <div className="widget-item-row">
                  <span className="widget-item-label">Free Space</span>
                  <span className="widget-item-value">{(storageDiagnostics.free_gb / 1024).toFixed(2)} TB ({storageDiagnostics.free_gb} GB)</span>
                </div>
                <div className="widget-item-row" style={{ marginTop: "10px" }}>
                  <span className="widget-item-label">Estimated Retention</span>
                  <span className={`widget-item-value ${storageDiagnostics.retention_days === null ? "warning" : "healthy"}`}>
                    {storageDiagnostics.retention_days !== null ? `${storageDiagnostics.retention_days} Days` : "Calculating..."}
                  </span>
                </div>
                <div style={{ marginTop: "auto", paddingTop: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", marginBottom: "4px" }}>
                    <span className="widget-item-label" style={{ fontSize: "11.5px" }}>Usage Utilization</span>
                    <strong>{storageDiagnostics.usage_pct}%</strong>
                  </div>
                  <div className="card-inline-bar" style={{ marginTop: 0 }}>
                    <div
                      className="card-inline-bar-fill"
                      style={{
                        width: `${storageDiagnostics.usage_pct}%`,
                        background: storageDiagnostics.warning_status ? "linear-gradient(90deg, #f59e0b, #ef4444)" : "linear-gradient(90deg, var(--teal), #00d2ff)"
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Bitrate Trend & Storage Growth Trend cards (temporarily commented out)
            // Widget 5: Bitrate Trend
            <div className="enhanced-card enhanced-card--wide">
              <div className="enhanced-card-header">
                <span className="header-icon"><Activity size={18} /></span>
                <h4>Bitrate Trend</h4>
                <div className="chart-filters" style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
                  {["1h", "24h", "7d"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setBitrateFilter(f)}
                      className={`chart-filter-btn ${bitrateFilter === f ? "active" : ""}`}
                      style={{
                        padding: "2px 8px",
                        fontSize: "10px",
                        fontWeight: "700",
                        borderRadius: "4px",
                        border: "1px solid var(--border)",
                        background: bitrateFilter === f ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.02)",
                        color: bitrateFilter === f ? "var(--teal)" : "var(--text-secondary)",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="widget-content-list" style={{ minHeight: "220px" }}>
                <div style={{ display: "flex", justifyContent: "space-around", marginBottom: "10px", fontSize: "12px" }}>
                  <div>Current: <strong>{bitrateDiagnostics.current_bitrate} Mbps</strong></div>
                  <div>Avg: <strong>{bitrateDiagnostics.avg_bitrate} Mbps</strong></div>
                  <div>Peak: <strong>{bitrateDiagnostics.peak_bitrate} Mbps</strong></div>
                </div>
                <InteractiveLineChart data={bitrateDiagnostics.trend_data} xKey="timestamp" yKey="bitrate_mbps" height={180} />
              </div>
            </div>

            // Widget 6: Storage Growth Trend
            <div className="enhanced-card enhanced-card--wide">
              <div className="enhanced-card-header">
                <span className="header-icon"><HardDrive size={18} /></span>
                <h4>Storage Growth Trend</h4>
              </div>
              <div className="widget-content-list" style={{ minHeight: "220px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "12px", alignItems: "center" }}>
                  <div>Avg Daily: <strong>{storageDiagnostics.avg_daily_consumption !== null ? `${storageDiagnostics.avg_daily_consumption} GB/day` : "Calculating..."}</strong></div>
                  {storageDiagnostics.predicted_exhaustion_date && (
                    <div style={{ color: "#ef4444", fontWeight: "700", whiteSpace: "nowrap", fontSize: "11.5px" }}>Exhaustion: {storageDiagnostics.predicted_exhaustion_date}</div>
                  )}
                </div>
                {storageDiagnostics.warning_status && storageDiagnostics.predicted_exhaustion_date && (
                  <div className="warning-banner" style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "6px", padding: "6px 10px", fontSize: "11.5px", color: "#f87171", marginBottom: "8px" }}>
                    ⚠️ Warning: Exhaustion predicted on {storageDiagnostics.predicted_exhaustion_date}.
                  </div>
                )}
                <StorageTrendChart data={storageDiagnostics.trend_history} xKey="timestamp" yKey="used_gb" height={180} />
              </div>
            </div>
            */}

            {/* Widget 7: Top Bandwidth Consumers */}
            <div className="enhanced-card bandwidth-card">
              <div className="enhanced-card-header">
                <span className="header-icon"><Camera size={18} /></span>
                <h4>Bandwidth Consumers</h4>
              </div>
              <div className="widget-content-list">
                {camerasBandwidth.top_cameras && camerasBandwidth.top_cameras.length > 0 ? (
                  <div className="bandwidth-list-container">
                    {camerasBandwidth.top_cameras.map((cam, idx) => (
                      <div
                        key={cam.id ? `${cam.id}-${idx}` : idx}
                        onClick={() => navigate("/cameras")}
                        className="bandwidth-item-row"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 12px",
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--border-light)",
                          borderRadius: "6px",
                          cursor: "pointer",
                          transition: "border-color 0.2s ease"
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--teal)"}
                        onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border-light)"}
                      >
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: "13.5px", fontWeight: "600", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {(() => {
                              const match = cameras?.find(c => 
                                c.ip === cam.ip || 
                                c.ip_address === cam.ip || 
                                (cam.id && (c.id === cam.id || c._id === cam.id))
                              );
                              return match?.name || match?.device_name || match?.camera_name || cam.name;
                            })()}
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{cam.ip}</span>
                        </div>
                        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <div style={{ fontSize: "13.5px", fontWeight: "700", color: "var(--text-primary)" }}>{cam.bitrate} Mbps</div>
                          <div style={{ fontSize: "11px", color: "var(--teal)", fontWeight: "600" }}>{cam.percentage}% of total</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "13.5px", minHeight: "120px" }}>
                    No active camera bandwidth metrics
                  </div>
                )}
              </div>
            </div>

          </div>{/* end widgets-scroll-track */}

          {/* Right Arrow */}
          <button
            className="carousel-arrow carousel-arrow-right"
            onClick={() => widgetsScrollRef.current?.scrollBy({ left: 340, behavior: "smooth" })}
            aria-label="Scroll right"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* 
      <div className="dashboard-grid">
        <div className="widget critical-alerts">
          <h3 style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <AlertTriangle size={16} color="#ef4444" />
            Critical Alerts
          </h3>

          {dynamicAlerts.length === 0 ? (
            <p className="empty-msg">All systems normal ✅</p>
          ) : (
            dynamicAlerts.map((a, i) => (
              <div key={i} className="alert-item">⚠ {a}</div>
            ))
          )}
        </div>

        <div className="widget camera-health-center">
          <div className="widget-header">
            <h3>Camera Health Monitoring</h3>
            <div className="health-summary">
              <span className="count-pill online">{cameraHealth.filter(c => getCameraHealth(c) === 'online').length} Online</span>
              <span className="count-pill warning">{cameraHealth.filter(c => getCameraHealth(c) === 'warning').length} Issues</span>
              <span className="count-pill bad">{cameraHealth.filter(c => getCameraHealth(c) === 'error').length} Offline</span>
            </div>
          </div>

          <div className="camera-health-list">
            {cameraHealth.length > 0 ? (
              cameraHealth.map((cam, i) => {
                const health = getCameraHealth(cam);
                const isBitrateDrop = cam.bitrate > 0 && cam.bitrate < 400; // Threshold for drop detection

                return (
                  <div key={i} className={`health-item ${health} ${isBitrateDrop ? 'bitrate-warning' : ''}`}>
                    <div className="health-item-main">
                      <div className="cam-info">
                        <div className="cam-status-box">
                          <span className={`status-dot ${health} ${health === 'online' ? 'pulse' : ''}`} />
                          <span className="cam-name-text">
                            {cam.name}
                          </span>
                        </div>
                        <span className="cam-model-sub">{cam.model || 'ONVIF Camera'}</span>
                      </div>

                      <div className="cam-metrics-live">
                        <div className="metric-box">
                          <label>Bitrate</label>
                          <span className={isBitrateDrop ? 'value warning' : 'value'}>
                            {typeof cam.bitrate === 'number' && cam.bitrate > 0
                              ? `${(cam.bitrate / 1024).toFixed(1)} Mbps`
                              : '0.0 Mbps'}
                          </span>
                        </div>
                        <div className="metric-box">
                          <label>Last Seen</label>
                          <span className="value">
                            {cam.timestamp ? timeAgo(cam.timestamp) : 'Just now'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {isBitrateDrop && (
                      <div className="health-alert-bar">
                        <AlertTriangle size={12} />
                        <span>Bitrate Drop Detected</span>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="empty-msg">No cameras registered for monitoring</div>
            )}
          </div>
        </div>
      </div>
      */}



      {/* 📊 NEW: Report Generation Section */}
      <div className="report-generation">
        <div className="report-section-header">
          <div className="report-title-area">
            <h3 className="report-title-main">Reports</h3>
          </div>
        </div>

        <div className="report-filters">
          <div className="report-filter-group">
            <label>From Date & Time</label>
            <div className="report-input-wrapper">
              <DateTimePicker
                value={reportFromDate}
                onChange={(val) => setReportFromDate(val)}
              />
            </div>
          </div>

          <div className="report-filter-group">
            <label>To Date & Time</label>
            <div className="report-input-wrapper">
              <DateTimePicker
                value={reportToDate}
                onChange={(val) => setReportToDate(val)}
              />
            </div>
          </div>

          <div className="report-filter-group relative">
            <label>Report Type</label>
            <div className="report-custom-select">
              <button
                type="button"
                className="report-select-btn"
                onClick={() => { setReportDropdownOpen(!reportDropdownOpen); setStatusDropdownOpen(false); setSourceDropdownOpen(false); }}              >
                <span>{reportTypeMap[reportType]}</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transform: reportDropdownOpen ? "rotate(180deg)" : "rotate(0)",
                    transition: "transform .2s",
                    color: "var(--text-secondary)"
                  }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {reportDropdownOpen && (
                <ul className="report-dropdown-menu">
                  {Object.entries(reportTypeMap).map(([val, label]) => (
                    <li
                      key={val}
                      className={`report-dropdown-item ${reportType === val ? "active" : ""}`}
                      onClick={() => {
                        setReportType(val);
                        setReportDropdownOpen(false);
                      }}
                    >
                      {label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          
          {reportType === "history" && (
            <div className="report-filter-group" style={{ display: 'flex', alignItems: 'center', marginTop: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '8px' }}>
                <input 
                  type="checkbox" 
                  checked={reportLiveOnly} 
                  onChange={(e) => setReportLiveOnly(e.target.checked)} 
                  style={{ width: '16px', height: '16px' }}
                />
                <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Live Cameras Only</span>
              </label>
            </div>
          )}
          
          {reportType === "live_alerts" && (
            <>
              <div className="report-filter-group relative" style={{ minWidth: '170px' }}>
                <label>Status</label>
                <div className="report-custom-select">
                  <button type="button" className="report-select-btn" onClick={() => { setStatusDropdownOpen(!statusDropdownOpen); setSourceDropdownOpen(false); setReportDropdownOpen(false); }}>
                    <span>{reportAnalyticsStatus === "all" ? "All" : reportAnalyticsStatus}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: statusDropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", color: "var(--text-secondary)" }}><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {statusDropdownOpen && (
                    <ul className="report-dropdown-menu">
                      {[{v: "all", l: "All"}, {v: "Active", l: "Active"}, {v: "Acknowledged", l: "Acknowledged"}, {v: "Resolved", l: "Resolved"}].map(opt => (
                        <li key={opt.v} className={`report-dropdown-item ${reportAnalyticsStatus === opt.v ? "active" : ""}`} onClick={() => { setReportAnalyticsStatus(opt.v); setStatusDropdownOpen(false); }}>
                          {opt.l}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="report-filter-group relative" style={{ minWidth: '200px' }}>
                <label>Analytics Received From</label>
                <div className="report-custom-select">
                  <button type="button" className="report-select-btn" onClick={() => { setSourceDropdownOpen(!sourceDropdownOpen); setStatusDropdownOpen(false); setReportDropdownOpen(false); }}>
                    <span>{reportAnalyticsSource === "all" ? "All" : reportAnalyticsSource === "external_ai" ? "Mirador AI" : "Built-in"}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: sourceDropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", color: "var(--text-secondary)" }}><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  {sourceDropdownOpen && (
                    <ul className="report-dropdown-menu">
                      {[{v: "all", l: "All"}, {v: "external_ai", l: "Mirador AI"}, {v: "built_in", l: "Built-in"}].filter(opt => isAiActive || opt.v !== "external_ai").map(opt => (
                        <li key={opt.v} className={`report-dropdown-item ${reportAnalyticsSource === opt.v ? "active" : ""}`} onClick={() => { setReportAnalyticsSource(opt.v); setSourceDropdownOpen(false); }}>
                          {opt.l}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}

          {reportData.length > 0 && (
            <div className="report-filter-group" style={{ minWidth: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label>View Mode</label>
              <div className="report-view-toggle">
                <button
                  type="button"
                  className={`report-toggle-pill ${reportViewModes[reportType] === "tabular" ? "active" : "inactive"}`}
                  onClick={() => handleSetViewMode(reportType, "tabular")}
                >
                  Tabular View
                </button>
                <button
                  type="button"
                  className={`report-toggle-pill ${reportViewModes[reportType] === "graphical" ? "active" : "inactive"}`}
                  onClick={() => handleSetViewMode(reportType, "graphical")}
                >
                  Graphical View
                </button>
              </div>
            </div>
          )}

          <div className="report-btn-group" ref={actionsDropdownRef} style={{ position: "relative" }}>
            <SpecularButton
              size="md"
              radius={8}
              tint={theme === 'light' ? "#059669" : "#10b981"}
              tintOpacity={0.10}
              blur={4}
              textColor={theme === 'light' ? "#065f46" : "#f0fff8"}
              lineColor={theme === 'light' ? "#059669" : "#10b981"}
              baseColor={theme === 'light' ? "#d1fae5" : "#0d3326"}
              intensity={1.2}
              shineSize={12}
              shineFade={38}
              thickness={1}
              speed={0.35}
              followMouse
              proximity={220}
              autoAnimate={false}
              disabled={reportLoading}
              onClick={handleGenerateReport}
              type="button"
            >
              {reportLoading ? "Generating..." : "Generate Report"}
            </SpecularButton>
            
            {reportData.length > 0 && (
              <div className="report-actions-dropdown">
                <AnimatedDownloadButton
                  type="button"
                  onClick={() => setActionsDropdownOpen(!actionsDropdownOpen)}
                  tooltip="Export / Print"
                  text="Export / Print"
                  style={{ '--width': '150px', '--height': '44px', borderRadius: '8px', fontSize: '1rem' }}
                  textColor={theme === 'light' ? "#065f46" : "#f0fff8"}
                  baseColor={theme === 'light' ? "#d1fae5" : "#0d3326"}
                />
                {actionsDropdownOpen && (
                  <ul className="report-actions-menu" style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    boxShadow: "0 8px 16px rgba(0,0,0,0.5)",
                    zIndex: 100,
                    listStyle: "none",
                    padding: "6px 0",
                    margin: "4px 0 0 0",
                    minWidth: "160px"
                  }}>
                    <li className="report-actions-item" onClick={() => { handleDownloadCSV(); setActionsDropdownOpen(false); }} style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      transition: "background 0.2s"
                    }}>
                      <Download size={13} />
                      Export CSV
                    </li>
                    <li className="report-actions-item" onClick={() => { handleDownloadExcel(); setActionsDropdownOpen(false); }} style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      transition: "background 0.2s"
                    }}>
                      <Download size={13} />
                      Export Excel (.xlsx)
                    </li>
                    <li className="report-actions-item" onClick={() => { handleDownloadPDF(); setActionsDropdownOpen(false); }} style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      transition: "background 0.2s"
                    }}>
                      <Download size={13} />
                      Export PDF
                    </li>
                    <li className="report-actions-item" onClick={() => { window.print(); setActionsDropdownOpen(false); }} style={{
                      padding: "8px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      color: "var(--text-primary)",
                      fontSize: "13px",
                      transition: "background 0.2s"
                    }}>
                      <Printer size={13} />
                      Print Report
                    </li>
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <div ref={reportRef} style={{ scrollMarginTop: "20px" }}>
          {reportSuccessMsg && <div className="report-alert success">{reportSuccessMsg}</div>}
          {reportErrorMsg && <div className="report-alert error">{reportErrorMsg}</div>}

          {/* Report Results View */}
          {reportData.length > 0 && (
            <div className="reports-views-container">
              {/* Tabular View Panel */}
              <div className={`reports-view-panel ${
                reportViewModes[reportType] === "tabular" ? "active" : "inactive-slide-out"
              } ${
                lastViewModeTransition?.to === "tabular" ? "instant" : ""
              }`}>
                <div className="report-table-container">
                  <div className="report-table-wrapper">
                    <table className="report-table">
                      <thead>
                        <tr>
                          {reportType === "alerts" && (
                            <>
                              <th>Timestamp</th>
                              <th>Device IP</th>
                              <th>Model</th>
                              <th>Type</th>
                              <th>Event</th>
                              <th>Message</th>
                              <th>Ack</th>
                            </>
                          )}
                          {reportType === "live_alerts" && (
                            <>
                              <th>Camera IP</th>
                              <th>Type</th>
                              <th>Event</th>
                              {reportAnalyticsSource !== "built_in" && <th>Details</th>}
                              <th>Status</th>
                              <th>Time</th>
                            </>
                          )}
                          {reportType === "health" && (
                            <>
                              <th>Device ID</th>
                              <th>IP Address</th>
                              <th>Manufacturer</th>
                              <th>Model</th>
                              <th>Type</th>
                              <th>Status</th>
                              <th>Latency</th>
                              <th>Uptime</th>
                              <th>Online Since</th>
                              <th>Reboot Count</th>
                              <th>Last Reboot</th>
                            </>
                          )}
                          {reportType === "history" && (
                            <>
                              <th>Camera Name</th>
                              <th>IP Address</th>
                              <th>Cam Up (hrs)</th>
                              <th>Cam Down (hrs)</th>
                              <th>Rec Up (hrs)</th>
                              <th>Rec Down (hrs)</th>
                              <th>Storage</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {currentReportRows.map((row, i) => (
                          <tr key={i}>
                            {reportType === "alerts" && (
                              <>
                                <td>{new Date(row.timestamp).toLocaleString()}</td>
                                <td>{row.ip}</td>
                                <td>{row.model}</td>
                                <td>
                                  <span className={`report-tag-type ${row.type}`}>
                                    {row.type?.toUpperCase()}
                                  </span>
                                </td>
                                <td>
                                  <span className={`report-event-tag ${row.event === "device_offline" ? "offline" : "online"}`}>
                                    {row.event?.replace("_", " ").toUpperCase()}
                                  </span>
                                </td>
                                <td>{row.message}</td>
                                <td>{row.acknowledged}</td>
                              </>
                            )}
                            {reportType === "live_alerts" && (
                              <>
                                <td>{row.ip_address}</td>
                                <td>
                                  <span className={`report-tag-type ${row.classification?.toLowerCase()}`}>
                                    {row.classification?.toUpperCase()}
                                  </span>
                                </td>
                                <td>{row.event}</td>
                                {reportAnalyticsSource !== "built_in" && <td>{row.details}</td>}
                                <td>{row.status}</td>
                                <td>{row.timestamp ? new Date(row.timestamp).toLocaleString() : "—"}</td>
                              </>
                            )}
                            {reportType === "health" && (
                              <>
                                <td>{row.device_id}</td>
                                <td>{row.ip_address}</td>
                                <td>{row.manufacturer}</td>
                                <td>{row.model}</td>
                                <td>
                                  <span className={`report-tag-type ${row.device_type}`}>
                                    {row.device_type?.toUpperCase()}
                                  </span>
                                </td>
                                <td>
                                  <span className={`status-dot ${row.current_status === "online" ? "online" : "error"}`} style={{ display: "inline-block", marginRight: "6px" }} />
                                  <span className={`report-event-tag ${row.current_status === "online" ? "online" : "offline"}`}>
                                    {row.current_status?.toUpperCase()}
                                  </span>
                                </td>
                                <td>{row.latency_ms}</td>
                                <td>{row.uptime_duration}</td>
                                <td>{row.online_since !== "—" ? new Date(row.online_since).toLocaleString() : "—"}</td>
                                <td>
                                  <span className="report-exit-code error">{row.reboot_count}</span>
                                </td>
                                <td>{row.last_reboot !== "—" ? new Date(row.last_reboot).toLocaleString() : "—"}</td>
                              </>
                            )}
                            {reportType === "history" && (
                              <>
                                <td>{row.camera_name}</td>
                                <td>{row.ip_address}</td>
                                <td style={{ color: "#22c55e", fontWeight: "600" }}>{row.cam_up_hrs}</td>
                                <td style={{ color: "#ef4444", fontWeight: "600" }}>{row.cam_down_hrs}</td>
                                <td style={{ color: "#22c55e", fontWeight: "600" }}>{row.rec_up_hrs}</td>
                                <td style={{ color: "#ef4444", fontWeight: "600" }}>{row.rec_down_hrs}</td>
                                <td style={{ color: "var(--teal)", fontWeight: "600" }}>{row.storage_consumed}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {reportData.length > reportPerPage && (
                    <div className="report-pagination">
                      <button
                        className="report-pag-btn"
                        disabled={reportCurrentPage === 1}
                        onClick={() => setReportCurrentPage(reportCurrentPage - 1)}
                      >
                        Prev
                      </button>
                      <span className="report-pag-info">
                        Page {reportCurrentPage} of {totalReportPages} ({reportData.length} records)
                      </span>
                      <button
                        className="report-pag-btn"
                        disabled={reportCurrentPage === totalReportPages}
                        onClick={() => setReportCurrentPage(reportCurrentPage + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Graphical View Panel */}
              <div className={`reports-view-panel ${
                reportViewModes[reportType] === "graphical" ? "active" : "inactive-slide-out"
              } ${
                lastViewModeTransition?.to === "tabular" ? "instant" : ""
              }`}>
                {renderGraphicalReport()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Failed Cameras Popup */}
      {showFailedCamerasPopup && (
        <div className="modal-overlay" onClick={() => setShowFailedCamerasPopup(false)} style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
        }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ 
            maxWidth: '750px', width: '100%', 
            backgroundColor: theme === 'light' ? '#ffffff' : 'var(--bg-card, #1e293b)', 
            padding: '24px', borderRadius: '12px', border: `1px solid ${theme === 'light' ? '#e2e8f0' : 'var(--border-color, #334155)'}`,
            boxShadow: theme === 'light' ? '0 10px 25px -5px rgba(0,0,0,0.1)' : '0 10px 25px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '18px' }}>Failed Recording Cameras</h3>
              <button 
                onClick={() => setShowFailedCamerasPopup(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '24px', lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {(() => {
                const failedCamerasList = cameras.filter(cam => cam.enabled !== false && !activeRecorders.includes(cam.stream_key || cam.stream_key));
                
                const handleRestartCamera = async (cam) => {
                  if (!cam.ip && !cam.ip_address) return;
                  const ip = encodeURIComponent(cam.ip || cam.ip_address);
                  const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
                  
                  try {
                    // Reset schedule to "Always" if it was intentionally set to "Never", 
                    // otherwise the backend will just remain idle after restart
                    if (cam.assigned_schedule_id && String(cam.assigned_schedule_id).toLowerCase() === "never") {
                      try {
                        await fetch(`${API_BASE}/api/recordings/assign-schedule`, {
                          method: "POST",
                          headers,
                          body: JSON.stringify({
                            camera_id: cam.id || cam.stream_key || cam.ip || cam.ip_address,
                            schedule_id: "Always",
                            motion_only: !!cam.motion_only
                          })
                        });
                      } catch (e) {
                        console.error("Failed to reset schedule to Always:", e);
                      }
                    }

                    // Disable then Enable to simulate a full restart
                    await fetch(`${API_BASE}/api/cameras/by-ip/${ip}/disable`, { method: "POST", headers });
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    await fetch(`${API_BASE}/api/cameras/by-ip/${ip}/enable`, { method: "POST", headers });
                    alert(`Restart sequence sent for ${cam.name || cam.ip}`);
                    
                    // Immediately fetch updated statuses
                    fetchRecentEvents();
                  } catch (err) {
                    console.error("Failed to restart camera:", err);
                    alert("Failed to restart camera. Check console for details.");
                  }
                };

                if (failedCamerasList.length === 0) {
                  return <div style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>No failed recordings.</div>;
                }
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '10px 8px', fontWeight: 600 }}>Camera Name</th>
                        <th style={{ padding: '10px 8px', fontWeight: 600 }}>IP Address</th>
                        <th style={{ padding: '10px 8px', fontWeight: 600 }}>Status</th>
                        <th style={{ padding: '10px 8px', fontWeight: 600 }}>Reason</th>
                        <th style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failedCamerasList.map((cam, idx) => {
                        // --- Accurate reason logic ---
                        const getRecordingFailureReason = (camera) => {
                          // 1. Camera hardware offline?
                          if (camera.status === "error" || camera.status === "offline") {
                            return "Camera Offline";
                          }
                          // 2. Check if a recording schedule is assigned and currently inactive
                          const schedId = camera.assigned_schedule_id;
                          if (schedId && String(schedId).toLowerCase() === "never") {
                            return "Recording mode set to Never";
                          }
                          if (schedId && String(schedId).toLowerCase() !== "always") {
                            const sch = recordingSchedules.find(s => String(s.id) === String(schedId));
                            if (sch) {
                              const now = new Date();
                              const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                              const dayName = dayNames[now.getDay()];
                              // Check exceptions (off-days)
                              const exceptions = sch.exceptions || [];
                              const dateIso = now.toISOString().slice(0, 10);
                              if (exceptions.some(e => String(e).startsWith(dateIso))) {
                                return "Recording Schedule Inactive (Exception Day)";
                              }
                              // Check exact time ranges if present
                              const ranges = (sch.ranges || {})[dayName];
                              if (ranges && ranges !== "Always Off") {
                                const currentTime = now.toTimeString().slice(0, 5);
                                const inRange = ranges.split(", ").some(r => {
                                  const parts = r.split(" - ");
                                  return parts.length === 2 && parts[0] <= currentTime && currentTime < parts[1];
                                });
                                if (!inRange) return "Recording Schedule Inactive";
                              } else {
                                // Use 5-min bitmask
                                const weekData = sch.week || {};
                                const dayMask = weekData[dayName];
                                if (Array.isArray(dayMask)) {
                                  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
                                  const slotIndex = Math.floor(minuteOfDay / 5);
                                  if (slotIndex >= 0 && slotIndex < dayMask.length && !dayMask[slotIndex]) {
                                    return "Recording Schedule Inactive";
                                  }
                                }
                              }
                            } else {
                              // Schedule assigned but not found — could be deleted
                              return "Recording Schedule Not Found";
                            }
                          }
                          // 3. Stream FPS checks
                          if (camera.fps === 0 || !camera.fps) {
                            return "Stream Disconnected (0 FPS)";
                          }
                          if (camera.fps < 10) {
                            return "Unstable Stream (Low FPS)";
                          }
                          return "Recording Service Down";
                        };
                        let reason = getRecordingFailureReason(cam);

                        const isScheduleReason = reason.includes("Schedule") || reason.includes("Never");
                        const reasonColor = isScheduleReason ? '#f59e0b' : reason === 'Camera Offline' ? '#ef4444' : 'var(--text-muted)';
                        const statusLabel = isScheduleReason ? 'Paused' : 'Failed';
                        const statusColor = isScheduleReason ? '#f59e0b' : '#ef4444';

                        return (
                          <tr key={cam.id ? `${cam.id}-${idx}` : idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '10px 8px', color: 'var(--text-primary)' }}>{cam.name || cam.stream || 'Unknown'}</td>
                            <td style={{ padding: '10px 8px', color: 'var(--text-primary)' }}>{cam.ip || cam.ip_address || 'Unknown'}</td>
                            <td style={{ padding: '10px 8px', color: statusColor, fontWeight: 600 }}>{statusLabel}</td>
                            <td style={{ padding: '10px 8px', color: reasonColor, fontWeight: isScheduleReason ? 500 : 400 }}>{reason}</td>
                            <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                              <button 
                                onClick={() => handleRestartCamera(cam)}
                                style={{
                                  background: 'var(--teal)', color: '#fff', border: 'none',
                                  padding: '6px 12px', borderRadius: '4px', cursor: 'pointer',
                                  fontSize: '12px', fontWeight: 'bold'
                                }}
                              >
                                Restart
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default DashboardPage;




