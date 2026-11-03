import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useWebSocket } from "../../hooks/useWebSocket";
import { AreaChart, Area, LineChart, Line, BarChart, Bar, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import html2canvas from 'html2canvas';
import useActivityLogger from "../../hooks/useActivityLogger";
import "./LogsPage.css";
import { apiUrl } from "../../config/appConfig";

function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token") || localStorage.getItem("token") || localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
const formatLocalDatetime = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatIST = (timestamp) => {
  if (!timestamp) return "-";
  let ts = timestamp;
  // Ensure the timestamp is parsed as UTC if it's missing timezone info
  if (!ts.endsWith('Z') && !ts.match(/[+-]\d{2}:\d{2}$/)) {
    ts += 'Z';
  }
  try {
    return new Date(ts).toLocaleString('en-GB', { 
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).toUpperCase();
  } catch (e) {
    return new Date(ts).toLocaleString();
  }
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

export default function LogsPage() {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const initialUserEmail = queryParams.get("user_email") || "";
  const initialTab = queryParams.get("tab") || "ui";

  const [activeTab, setActiveTab] = useState(initialTab);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(getInitialFromDate());
  const [toDate, setToDate] = useState(getInitialToDate());
  const [category, setCategory] = useState("");
  const [userEmail, setUserEmail] = useState(initialUserEmail);
  const [hasCustomToDate, setHasCustomToDate] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedDetails, setExpandedDetails] = useState({});
  const [cameras, setCameras] = useState([]);
  const [viewMode, setViewMode] = useState("tabular");
  const { logAction } = useActivityLogger();
  const logsPerPage = 15;

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      logs.map(log => ({
        Timestamp: formatIST(log.timestamp),
        User: log.user_email || log.email || "Unknown",
        Role: log.user_role?.toUpperCase() || "-",
        Category: log.category?.toUpperCase() || "-",
        Action: formatActionText(log.action),
        Details: JSON.stringify(log.details || {})
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Logs");
    XLSX.writeFile(wb, "VMS_Logs.xlsx");
    logAction("Exported UI Logs Excel", "export", { records: logs.length, file: "VMS_Logs.xlsx" });
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.text("System Logs Report", 14, 15);
    
    const tableColumn = ["Timestamp", "User", "Role", "Category", "Action"];
    const tableRows = [];

    logs.forEach(log => {
      const logData = [
        formatIST(log.timestamp),
        log.user_email || log.email || "Unknown",
        log.user_role?.toUpperCase() || "-",
        log.category?.toUpperCase() || "-",
        formatActionText(log.action)
      ];
      tableRows.push(logData);
    });

    doc.autoTable({
      head: [tableColumn],
      body: tableRows,
      startY: 20,
    });
    doc.save("VMS_Logs.pdf");
    logAction("Exported UI Logs PDF", "export", { records: logs.length, file: "VMS_Logs.pdf" });
  };

  const getLogsByCategory = () => {
    const counts = {};
    logs.forEach(log => {
      const cat = log.category || "unknown";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.keys(counts).map(key => ({ name: key, value: counts[key] }));
  };

  const getLogsByDate = () => {
    const counts = {};
    logs.forEach(log => {
      const date = new Date(log.timestamp).toLocaleDateString();
      counts[date] = (counts[date] || 0) + 1;
    });
    return Object.keys(counts).map(key => ({ date: key, count: counts[key] }));
  };

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

  useEffect(() => {
    try {
      const saved = localStorage.getItem("miradorai_devices");
      if (saved) setCameras(JSON.parse(saved));
    } catch (e) {}
  }, []);

  const getCameraName = (camId) => {
    if (!camId) return "-";
    const normalized = camId.replace(/_/g, ".");
    const found = cameras.find(
      (c) =>
        (c.ip && c.ip.replace(/_/g, ".") === normalized) ||
        String(c.id) === String(camId) ||
        c.name === camId
    );
    return found ? found.name : normalized;
  };

  const formatActionText = (action) => {
    if (!action) return "-";
    let clean = action;
    
    // Strip [RECORDER] prefix and timestamp
    clean = clean.replace(/^\[RECORDER\]\s*\[[^\]]+\]\s*/i, "");
    
    // Simplify common recording logs
    if (clean.includes("Motion trigger received") || clean.includes("Motion is detected")) {
      return "Motion Trigger Detected";
    }
    if (clean.includes("Starting") && clean.includes("recording")) {
      const match = clean.match(/Starting\s+(\d+-minute)\s+recording/i);
      if (match) {
        return `Started ${match[1]} Recording`;
      }
      return "Started Recording";
    }
    
    // Fallback cleanup
    clean = clean.replace(/💥|🏃|🎬/g, "");
    clean = clean.replace(/for\s+\d{1,3}[_.]\d{1,3}[_.]\d{1,3}[_.]\d{1,3}[!\s]*/ig, "");
    clean = clean.replace(/\s+/g, " ").trim();
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  };

  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef(null);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target)) {
        setCategoryDropdownOpen(false);
      }
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target)) {
        setExportDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const categoryMap = {
    "": "All Categories",
    "auth": "Auth",
    "camera": "Cameras",
    "click": "Clicks",
    "export": "Export",
    "download": "Download",
    "recording": "Recording",
    "settings": "Settings"
  };

  const fetchLogs = async (isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
      setLogs([]);
    }
    try {
      const queryParams = new URLSearchParams();
      if (fromDate) {
        const localDate = new Date(fromDate);
        queryParams.append("from_date", localDate.toISOString());
      }
      if (toDate && hasCustomToDate) {
        const localDate = new Date(toDate);
        queryParams.append("to_date", localDate.toISOString());
      }
      if (userEmail) {
        queryParams.append("user_email", userEmail);
      }

      // For the recordings tab, force category=recording on ui endpoint
      if (activeTab === "recordings") {
        queryParams.append("category", "recording");
      } else if (activeTab === "ui" && category) {
        queryParams.append("category", category);
      }
      // recordings tab uses /api/logs/ui with category=recording
      const endpoint = activeTab === "recordings" ? "ui" : activeTab;
      const response = await fetch(apiUrl(`/logs/${endpoint}?${queryParams.toString()}`), {
        headers: getAuthHeaders()
      });
      const data = await response.json();
      if (data.success) {
        const filteredLogs = data.logs.filter(log => log.category !== "navigation");
        setLogs(filteredLogs);
        if (!isBackground) {
          setCurrentPage(1);
          setExpandedDetails({});
        }
      }
    } catch (err) {
      console.error("Failed to fetch logs", err);
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [activeTab, category]);

  const { isConnected: isWsConnected, eventsByTopic } = useWebSocket(["alerts", "system_metrics", "system_logs"]);

  useEffect(() => {
    const wsEvent = eventsByTopic.system_logs;
    if (wsEvent && wsEvent.data) {
      const newLog = wsEvent.data;
      
      // Basic filtering to ensure it matches current tab/category
      const isTerminal = wsEvent.event === "new_terminal_log";
      if (activeTab === "terminal" && !isTerminal) return;
      if (activeTab === "ui" && isTerminal) return;
      if (activeTab === "recordings" && newLog.category !== "recording") return;
      if (activeTab === "ui" && category && category !== "" && newLog.category !== category) return;
      if (newLog.category === "navigation") return;

      setLogs((prev) => [newLog, ...prev]);
    }
  }, [eventsByTopic.system_logs, activeTab, category]);

  useEffect(() => {
    fetchLogs();
    if (isWsConnected) return; // Zero polling when connected
    const interval = setInterval(() => fetchLogs(true), 5000);
    return () => clearInterval(interval);
  }, [activeTab, fromDate, toDate, category, isWsConnected]);

  // Pagination calculations
  const indexOfLastLog = currentPage * logsPerPage;
  const indexOfFirstLog = indexOfLastLog - logsPerPage;
  const currentLogs = logs.slice(indexOfFirstLog, indexOfLastLog);
  const totalPages = Math.ceil(logs.length / logsPerPage);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  return (
    <div className="logs-page page-shell slide-in">
      <div className="logs-header">
        <div className="logs-title-area">
          <h1 className="logs-title">System <span>Logs</span></h1>
        </div>
        
        <div className="logs-tabs">
          <button 
            className={`logs-tab ${activeTab === "ui" ? "active" : ""}`}
            onClick={() => setActiveTab("ui")}
          >
            UI Logs
          </button>
          <button 
            className={`logs-tab ${activeTab === "terminal" ? "active" : ""}`}
            onClick={() => setActiveTab("terminal")}
          >
            Terminal Logs
          </button>
        </div>
      </div>

      <div className="logs-view-toggles" style={{ display: 'flex', gap: '10px', marginTop: '-10px', marginBottom: '10px' }}>
        <button 
          className={`logs-view-btn ${viewMode === "tabular" ? "active" : ""}`}
          onClick={() => setViewMode("tabular")}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" style={{ verticalAlign: 'middle', marginRight: '6px' }}>
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="9" y1="21" x2="9" y2="9"></line>
          </svg>
          Tabular View
        </button>
        <button 
          className={`logs-view-btn ${viewMode === "graphical" ? "active" : ""}`}
          onClick={() => setViewMode("graphical")}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" style={{ verticalAlign: 'middle', marginRight: '6px' }}>
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          Graphical View
        </button>
      </div>

      <div className="logs-filters card">
        <div className="log-filter-group">
          <label>From Date & Time</label>
          <input 
            type="datetime-local" 
            className="log-input" 
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="log-filter-group">
          <label>To Date & Time</label>
          <input 
            type="datetime-local" 
            className="log-input" 
            value={toDate}
            onChange={(e) => {
              const val = e.target.value;
              setToDate(val);
              setHasCustomToDate(!!val);
            }}
          />
        </div>
        <div className="log-filter-group">
          <label>User Email</label>
          <input
            type="text"
            className="log-input"
            placeholder="Filter by user email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
          />
        </div>
        {activeTab === "ui" && (
          <div className="log-filter-group" ref={categoryDropdownRef}>
            <label>Category</label>
            <div className="logs-custom-select">
              <button
                type="button"
                className="logs-select-btn"
                onClick={() => setCategoryDropdownOpen(!categoryDropdownOpen)}
              >
                <span>{categoryMap[category]}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: categoryDropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", color: "var(--text-secondary)" }}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>
              {categoryDropdownOpen && (
                <ul className="logs-dropdown-menu">
                  {Object.entries(categoryMap).map(([val, label]) => (
                    <li
                      key={val}
                      className={`logs-dropdown-item ${category === val ? "active" : ""}`}
                      onClick={() => {
                        setCategory(val);
                        setCategoryDropdownOpen(false);
                      }}
                    >
                      {label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {activeTab === "recordings" && (
          <div className="log-filter-group">
            <label>Filter</label>
            <div style={{ color: "#fff", fontSize: "12px", padding: "8px 12px", background: "rgba(99, 102, 241, 0.1)", border: "1px solid rgba(99, 102, 241, 0.3)", borderRadius: "8px" }}>
              🎬 Showing recordings only for motion-enabled cameras
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '12px', marginLeft: 'auto', alignSelf: 'flex-end' }}>
          <div className="logs-custom-select" ref={exportDropdownRef}>
            <button 
              className="log-btn-secondary" 
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
            >
              Export
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: exportDropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }}>
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>
            {exportDropdownOpen && (
              <ul className="logs-dropdown-menu" style={{ right: 0, left: 'auto', minWidth: '120px' }}>
                <li
                  className="logs-dropdown-item"
                  onClick={() => {
                    exportToExcel();
                    setExportDropdownOpen(false);
                  }}
                >
                  Excel
                </li>
                <li
                  className="logs-dropdown-item"
                  onClick={() => {
                    exportToPDF();
                    setExportDropdownOpen(false);
                  }}
                >
                  PDF
                </li>
              </ul>
            )}
          </div>
          <button 
            className="log-btn-primary" 
            onClick={() => {
              setHasCustomToDate(true);
              fetchLogs();
            }}
          >
            Apply Filters
          </button>
        </div>
      </div>

      <div className="logs-table-container" id="logs-export-container">
        {loading ? (
          <div className="logs-loading-text">Loading....</div>
        ) : logs.length === 0 ? (
          <div className="empty-logs">No logs found for the selected criteria.</div>
        ) : viewMode === "graphical" ? (
          <div className="logs-graphical-wrapper" style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', padding: '24px', background: 'var(--bg-surface)' }}>
            <div className="chart-card" style={{ flex: '1 1 500px', padding: '20px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', minWidth: '0' }}>
              <h3 style={{ marginTop: 0, color: 'var(--text-primary)', fontSize: '16px', marginBottom: '20px' }}>Logs Over Time</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={getLogsByDate()}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="date" stroke="#fff" fontSize={11} tickMargin={10} axisLine={false} tickLine={false} />
                  <YAxis stroke="#fff" fontSize={11} axisLine={false} tickLine={false} />
                  <RechartsTooltip contentStyle={{ backgroundColor: '#1e1e2d', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px', fontSize: '13px' }} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }} />
                  <Area type="monotone" dataKey="count" stroke="#2dd4bf" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" activeDot={{ r: 6, fill: '#2dd4bf', stroke: '#13161e', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-card" style={{ flex: '1 1 300px', padding: '20px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', minWidth: '0' }}>
              <h3 style={{ marginTop: 0, color: 'var(--text-primary)', fontSize: '16px', marginBottom: '20px' }}>Logs by Category</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={getLogsByCategory()}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {getLogsByCategory().map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{ backgroundColor: '#1e1e2d', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px', fontSize: '13px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px', color: '#fff', paddingTop: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="logs-table-wrapper">
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  {(activeTab === "ui" || activeTab === "recordings") ? (
                    <>
                      <th>Role</th>
                      {(activeTab === "ui" && category === "") && <th>Category</th>}
                      {(activeTab === "recordings" || category === "" || category === "camera" || category === "recording") && <th>Camera</th>}
                      <th>Action</th>
                      <th>{(activeTab === "recordings" || category === "recording") ? "Face / Details" : "Details"}</th>
                    </>
                  ) : (
                    <>
                      <th>Project Folder</th>
                      <th>Exit Code</th>
                      <th>Command & Output</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {currentLogs.map((log, i) => (
                  <tr key={i}>
                    <td>{formatIST(log.timestamp)}</td>
                    <td>{log.user_email || log.email || "Unknown"}</td>
                    {(activeTab === "ui" || activeTab === "recordings") ? (
                      <>
                        <td>
                          <span className={`log-tag ${log.user_role}`}>
                            {log.user_role?.toUpperCase() || "ADMIN"}
                          </span>
                        </td>
                        {(activeTab === "ui" && category === "") && <td>{log.category?.toUpperCase()}</td>}
                        {(activeTab === "recordings" || category === "" || category === "camera" || category === "recording") && (
                          <td>
                            {(log.details?.camera_id || log.details?.ip) ? (
                              <div className="log-camera-cell">
                                <span className="log-camera-name">{getCameraName(log.details?.camera_id || log.details?.ip)}</span>
                                <span className="log-camera-ip">{(log.details?.camera_id || log.details?.ip).replace(/_/g, ".")}</span>
                              </div>
                            ) : (
                              "-"
                            )}
                          </td>
                        )}
                        <td>
                          <span style={{ fontWeight: 500 }}>{formatActionText(log.action)}</span>
                        </td>
                        <td className="log-details-cell">
                          {(activeTab === "recordings" || log.category === "recording") ? (
                            // Recording logs: show face image prominently + event badge
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                              {log.details?.face_url && (
                                <img
                                  src={log.details.face_url.startsWith('http') ? log.details.face_url : apiUrl(log.details.face_url.replace(/^\/api/, ''))}
                                  alt="Detected Face"
                                  style={{
                                    width: "56px",
                                    height: "56px",
                                    borderRadius: "6px",
                                    objectFit: "cover",
                                    border: "2px solid rgba(99, 102, 241, 0.6)",
                                    flexShrink: 0,
                                    boxShadow: "0 0 8px rgba(99,102,241,0.4)"
                                  }}
                                  onError={(e) => { e.target.style.display = 'none'; }}
                                />
                              )}
                              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                {log.details?.event && (
                                  <div className={`log-event-badge ${log.details.event}`}>
                                    <span className="log-event-dot" />
                                    {log.details.event === "recording_started" ? "Recording Started" : "Motion Detected"}
                                  </div>
                                )}
                                {log.details?.file_name && (
                                  <span className="log-file-name">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                                    </svg>
                                    {log.details.file_name}
                                  </span>
                                )}
                                {log.details?.duration && (
                                  <span className="log-duration">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                                      <circle cx="12" cy="12" r="10" />
                                      <polyline points="12 6 12 12 16 14" />
                                    </svg>
                                    {log.details.duration}s
                                  </span>
                                )}
                                {!log.details?.face_url && log.details?.event === "motion_trigger" && (
                                  <span className="log-no-face">No face detected</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            // UI Logs tab (other categories): face image or nothing important
                            log.details && Object.keys(log.details).length > 0 ? (
                              log.details.face_url ? (
                                <img 
                                  src={log.details.face_url.startsWith('http') ? log.details.face_url : apiUrl(log.details.face_url.replace(/^\/api/, ''))}
                                  alt="Face Crop"
                                  style={{ 
                                    width: "60px", 
                                    height: "60px", 
                                    borderRadius: "4px", 
                                    objectFit: "cover",
                                    border: "1px solid rgba(255, 255, 255, 0.2)",
                                    display: "block"
                                  }}
                                  onError={(e) => { e.target.style.display = 'none'; }}
                                />
                              ) : (
                                <button
                                  className="log-details-toggle"
                                  onClick={() => setExpandedDetails(prev => ({ ...prev, [i]: !prev[i] }))}
                                >
                                  {expandedDetails[i] ? "Hide" : "Show Details"}
                                </button>
                              )
                            ) : (
                              "-"
                            )
                          )}
                          {expandedDetails[i] && !log.details?.face_url && activeTab === "ui" && (
                            <pre className="log-details-pre">{JSON.stringify(log.details, null, 2)}</pre>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{log.project_folder}</td>
                        <td>{log.exit_code}</td>
                        <td className="log-output">
                          <strong>{log.command}</strong>
                          {log.output_snippet && (
                            <pre>{log.output_snippet}</pre>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {logs.length > logsPerPage && (
        <div className="pagination-container">
          <button 
            className="pagination-btn" 
            disabled={currentPage === 1}
            onClick={() => handlePageChange(currentPage - 1)}
          >
            Prev
          </button>
          <span className="pagination-info">
            Page {currentPage} of {totalPages} ({logs.length} total logs)
          </span>
          <button 
            className="pagination-btn" 
            disabled={currentPage === totalPages}
            onClick={() => handlePageChange(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}