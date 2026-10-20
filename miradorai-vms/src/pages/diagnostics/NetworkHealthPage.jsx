import React, { useState, useEffect } from "react";
import { 
  Zap, 
  Activity, 
  Database, 
  HardDrive, 
  Cpu, 
  Layers, 
  Terminal, 
  ArrowDown, 
  ArrowUp, 
  CheckCircle2, 
  Clock, 
  Network,
  RefreshCw,
  Server,
  AlertCircle
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as ChartTooltip, 
  ResponsiveContainer
} from "recharts";
import "./NetworkHealthPage.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

const NetworkHealthPage = () => {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [range, setRange] = useState("1h");
  const [metrics, setMetrics] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Old terminal states
  const [diagnosingIp, setDiagnosingIp] = useState("");
  const [diagResult, setDiagResult] = useState(null);
  const [isPinging, setIsPinging] = useState(false);
  const [deviceStats, setDeviceStats] = useState([]);

  const fetchLiveMetrics = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/system/status`, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("token") || ""}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }

      const diagRes = await fetch(`${API_BASE}/api/infrastructure/health`, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("token") || ""}`
        }
      });
      if (diagRes.ok) {
        const diagData = await diagRes.json();
        setDeviceStats(diagData);
      }
      setError(null);
    } catch (err) {
      console.error("Fetch metrics error:", err);
      setError("Failed to fetch live monitoring data. Reconnecting...");
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/system/history?range=${range}`, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("token") || ""}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error("Fetch history error:", err);
    }
  };

  useEffect(() => {
    fetchLiveMetrics();
    const interval = setInterval(fetchLiveMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [range]);

  const runInstantCheck = async () => {
    if (!diagnosingIp) return;
    setIsPinging(true);
    setDiagResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/infrastructure/nodes/${diagnosingIp}`, {
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("token") || ""}`
        }
      });
      if (res.ok) {
        const json = await res.json();
        setDiagResult({
          ip: json.ip || diagnosingIp,
          status: json.status || "Unknown",
          latency: json.latency
        });
      } else {
        setDiagResult({ ip: diagnosingIp, status: "Offline", error: "Host unreachable" });
      }
    } catch (err) {
      setDiagResult({ error: "Check failed" });
    } finally {
      setIsPinging(false);
    }
  };

  // Fallback defaults
  const net = metrics?.network || { camera_ingest_mbps: 0.0, replication_mbps: 0.0, client_mbps: 0.0, total_nic_usage: 0.0, nic_speed: 1000, utilization: 0.0 };
  const storage = metrics?.storage || { disk_read: 0.0, disk_write: 0.0, iops: 0, queue_depth: 0 };
  const repl = metrics?.replication || { status: "Offline", queue: 0, failed_objects: 0, last_sync: "N/A", speed: "0 Mbps", object_count: 0, bucket_usage_gb: 0.0 };
  const mongo = metrics?.mongo || { status: "Offline", lag: 0.0, primary: "Unknown", secondary: "Unknown", sync_time: "N/A", database_size_mb: 0.0, collections: 0, ops_per_sec: 0 };
  const cpu = metrics?.cpu || { percent: 0.0, aes_load: 0.0 };
  const ram = metrics?.ram || { percent: 0.0, used_gb: 0.0, total_gb: 0.0 };

  return (
    <div className="network-health">
      {/* Dynamic Sub-header Info */}
      <div className="diagnostics-sub-header">
        <div className="tabs-navigation">
          <button className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
            <Activity size={14} /> Monitoring Dashboard
          </button>
          <button className={`tab-btn ${activeTab === "topology" ? "active" : ""}`} onClick={() => setActiveTab("topology")}>
            <Network size={14} /> Enterprise Topology Map
          </button>
          <button className={`tab-btn ${activeTab === "terminal" ? "active" : ""}`} onClick={() => setActiveTab("terminal")}>
            <Terminal size={14} /> Diagnostic Terminal
          </button>
        </div>

        <div className="header-indicators">
          {error && (
            <div className="live-indicator error-state">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}
          <div className="live-indicator">
            <div className="pulse-dot"></div>
            <span>LIVE TELEMETRY</span>
          </div>
        </div>
      </div>

      {/* TAB 1: Monitoring Dashboard */}
      {activeTab === "dashboard" && (
        <div className="dashboard-grid">
          
          {/* 1. Network Ingest Card */}
          <div className="metric-card span-4">
            <div className="card-header-styled">
              <h3><Network size={16} className="header-icon" /> Network Ingest</h3>
              <span className="status-badge healthy">Active</span>
            </div>
            <div className="compact-val-row">
              <div className="live-value-large">
                {net.camera_ingest_mbps.toFixed(1)} <span>Mbps</span>
              </div>
              <div className="sub-detail-grid">
                <div>NIC Speed: <strong>{net.nic_speed} Mbps</strong></div>
                <div>LAN Load: <strong>{net.utilization.toFixed(1)}%</strong></div>
              </div>
            </div>
            <div className="progress-bar-container">
              <div className="progress-bar-fill fill-network" style={{ width: `${net.utilization}%` }}></div>
            </div>
            <div className="stats-info-list compact">
              <div className="info-row">
                <span className="info-label">Camera Inflow Rate</span>
                <span className="info-val">{net.camera_ingest_mbps.toFixed(1)} Mbps</span>
              </div>
              <div className="info-row">
                <span className="info-label">Active Client Output</span>
                <span className="info-val">{net.client_mbps.toFixed(1)} Mbps</span>
              </div>
            </div>
          </div>

          {/* 2. MinIO Replication Card */}
          <div className="metric-card span-4">
            <div className="card-header-styled">
              <h3><Layers size={16} className="header-icon" style={{ color: "var(--purple)" }} /> MinIO Replication</h3>
              <span className={`status-badge ${repl.status === "Healthy" ? "healthy" : "warning"}`}>{repl.status}</span>
            </div>
            <div className="compact-val-row">
              <div className="live-value-large">
                {repl.speed}
              </div>
              <div className="sub-detail-grid">
                <div>Queue: <strong>{repl.queue}</strong></div>
                <div>Failed: <strong>{repl.failed_objects}</strong></div>
              </div>
            </div>
            <div className="progress-bar-container">
              <div className="progress-bar-fill fill-repl" style={{ width: repl.queue > 0 ? "75%" : "0%" }}></div>
            </div>
            <div className="stats-info-list compact">
              <div className="info-row">
                <span className="info-label">Total Backup Count</span>
                <span className="info-val">{repl.object_count.toLocaleString()} objects</span>
              </div>
              <div className="info-row">
                <span className="info-label">Bucket Storage Size</span>
                <span className="info-val">{repl.bucket_usage_gb.toFixed(2)} GB</span>
              </div>
            </div>
          </div>

          {/* 3. Mongo Database Sync Card */}
          <div className="metric-card span-4">
            <div className="card-header-styled">
              <h3><Database size={16} className="header-icon" style={{ color: "var(--brand)" }} /> Mongo Replica Set</h3>
              <span className="status-badge healthy">Syncing</span>
            </div>
            <div className="compact-val-row">
              <div className="live-value-large">
                {mongo.lag.toFixed(2)} <span>sec lag</span>
              </div>
              <div className="sub-detail-grid">
                <div>Sync Time: <strong>{mongo.sync_time}</strong></div>
                <div>Ops Rate: <strong>{mongo.ops_per_sec}/s</strong></div>
              </div>
            </div>
            <div className="progress-bar-container">
              <div className="progress-bar-fill fill-lan" style={{ width: "100%" }}></div>
            </div>
            <div className="stats-info-list compact">
              <div className="info-row">
                <span className="info-label">Database Size</span>
                <span className="info-val">{mongo.database_size_mb.toFixed(1)} MB</span>
              </div>
              <div className="info-row">
                <span className="info-label">Collections Count</span>
                <span className="info-val">{mongo.collections} tables</span>
              </div>
            </div>
          </div>

          {/* 4. Disk Performance Card */}
          <div className="metric-card span-6">
            <div className="card-header-styled">
              <h3><HardDrive size={16} className="header-icon" style={{ color: "var(--yellow)" }} /> Disk Performance</h3>
              <span className="status-badge healthy">Active</span>
            </div>
            <div className="double-value-row">
              <div className="val-block">
                <div className="val-label">Read Speed</div>
                <div className="val-data blue">{storage.disk_read.toFixed(2)} <span>MB/s</span></div>
              </div>
              <div className="val-block">
                <div className="val-label">Write Speed</div>
                <div className="val-data green">{storage.disk_write.toFixed(2)} <span>MB/s</span></div>
              </div>
            </div>
            <div className="stats-info-list compact border-top">
              <div className="info-row">
                <span className="info-label">Live IOPS Rate</span>
                <span className="info-val">{storage.iops} io/s</span>
              </div>
              <div className="info-row">
                <span className="info-label">Disk IO Queue Depth</span>
                <span className="info-val">{storage.queue_depth} requests</span>
              </div>
            </div>
          </div>

          {/* 5. CPU & RAM Processor Card */}
          <div className="metric-card span-6">
            <div className="card-header-styled">
              <h3><Cpu size={16} className="header-icon" style={{ color: "var(--red)" }} /> Node Processors</h3>
              <span className="status-badge healthy">Nominal</span>
            </div>
            <div className="double-value-row">
              <div className="val-block">
                <div className="val-label">CPU Load</div>
                <div className="val-data red">{cpu.percent.toFixed(1)}%</div>
              </div>
              <div className="val-block">
                <div className="val-label">RAM Usage</div>
                <div className="val-data yellow">{ram.percent.toFixed(1)}%</div>
              </div>
            </div>
            <div className="stats-info-list compact border-top">
              <div className="info-row">
                <span className="info-label">Memory Footprint</span>
                <span className="info-val">{ram.used_gb.toFixed(2)} / {ram.total_gb.toFixed(1)} GB</span>
              </div>
              <div className="info-row">
                <span className="info-label">AES Cryptographic Load</span>
                <span className="info-val">{cpu.aes_load.toFixed(1)}%</span>
              </div>
            </div>
          </div>

          {/* 6. Trend Graphs */}
          <div className="metric-card span-12">
            <div className="chart-controls">
              <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <Clock size={16} style={{ color: "var(--brand)" }} /> Telemetry Trends
              </h3>
              <div className="time-range-selectors">
                <button className={`range-btn ${range === "1h" ? "active" : ""}`} onClick={() => setRange("1h")}>1H</button>
                <button className={`range-btn ${range === "24h" ? "active" : ""}`} onClick={() => setRange("24h")}>24H</button>
                <button className={`range-btn ${range === "7d" ? "active" : ""}`} onClick={() => setRange("7d")}>7D</button>
              </div>
            </div>

            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorIncoming" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--blue)" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="var(--blue)" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorReplication" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--purple)" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="var(--purple)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} />
                  <ChartTooltip content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="custom-tooltip">
                          <p className="tooltip-time">{data.time}</p>
                          <div className="tooltip-row">
                            <span className="tooltip-label">Ingest Speed:</span>
                            <span className="tooltip-value" style={{ color: "var(--blue)" }}>{data.incoming_mbps.toFixed(1)} Mbps</span>
                          </div>
                          <div className="tooltip-row">
                            <span className="tooltip-label">Replication:</span>
                            <span className="tooltip-value" style={{ color: "var(--purple)" }}>{data.outgoing_mbps.toFixed(1)} Mbps</span>
                          </div>
                          <div className="tooltip-row">
                            <span className="tooltip-label">CPU:</span>
                            <span className="tooltip-value">{data.cpu.toFixed(1)}%</span>
                          </div>
                          <div className="tooltip-row">
                            <span className="tooltip-label">RAM:</span>
                            <span className="tooltip-value">{data.ram.toFixed(1)}%</span>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }} />
                  <Area type="monotone" dataKey="incoming_mbps" name="Ingest Mbps" stroke="var(--blue)" strokeWidth={2} fillOpacity={1} fill="url(#colorIncoming)" />
                  <Area type="monotone" dataKey="outgoing_mbps" name="Replication Mbps" stroke="var(--purple)" strokeWidth={2} fillOpacity={1} fill="url(#colorReplication)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Topology Map */}
      {activeTab === "topology" && (
        <div className="topology-diagram-container">
          <div style={{ marginBottom: "20px", width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Active Network Distribution Topology</h3>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Real-time SVG particle stream mapping active.
            </div>
          </div>

          <svg className="topology-svg" viewBox="0 0 800 400">
            <path d="M 150,200 L 400,200" className="topo-link topo-link-active" />
            <path d="M 400,200 L 650,200" className="topo-link topo-link-replicate" />
            <path d="M 400,200 L 400,320" className="topo-link topo-link-active" />

            <circle r="5" className="traffic-particle">
              <animateMotion dur="4s" repeatCount="indefinite" path="M 150,200 L 400,200" />
            </circle>
            <circle r="5" className="traffic-particle-repl">
              <animateMotion dur="5s" repeatCount="indefinite" path="M 400,200 L 650,200" />
            </circle>
            <circle r="5" className="traffic-particle">
              <animateMotion dur="6s" repeatCount="indefinite" path="M 400,200 L 400,320" />
            </circle>

            <text x="230" y="180" fill="var(--blue)" fontSize="12" fontWeight="700" textAnchor="middle">
              {net.camera_ingest_mbps.toFixed(1)} Mbps Ingest
            </text>
            <text x="525" y="180" fill="var(--purple)" fontSize="12" fontWeight="700" textAnchor="middle">
              {repl.speed} Replication
            </text>
            <text x="415" y="270" fill="var(--blue)" fontSize="12" fontWeight="700" textAnchor="start">
              {net.client_mbps.toFixed(1)} Mbps Outflow
            </text>

            <g className="topo-node" transform="translate(100, 200)">
              <circle r="36" fill="var(--bg-elevated)" stroke="var(--border)" strokeWidth="2" />
              <Network size={24} x="-12" y="-12" style={{ color: "var(--blue)" }} />
              <text y="50" textAnchor="middle" className="node-text-title">Cameras LAN</text>
              <text y="66" textAnchor="middle" className="node-text-sub">100 Cameras Active</text>
            </g>

            <g className="topo-node" transform="translate(400, 200)">
              <rect x="-60" y="-40" width="120" height="80" className="node-box primary" />
              <Server size={24} x="-12" y="-24" style={{ color: "var(--brand)" }} />
              <text y="15" textAnchor="middle" className="node-text-title">Primary VMS</text>
              <text y="30" textAnchor="middle" className="node-text-sub">Mongo Primary</text>
              <circle cx="50" cy="-30" r="6" className="node-badge" />
            </g>

            <g className="topo-node" transform="translate(650, 200)">
              <rect x="-60" y="-40" width="120" height="80" className="node-box secondary" />
              <Server size={24} x="-12" y="-24" style={{ color: "var(--purple)" }} />
              <text y="15" textAnchor="middle" className="node-text-title">Secondary VMS</text>
              <text y="30" textAnchor="middle" className="node-text-sub">Mongo Secondary</text>
              <circle cx="50" cy="-30" r="6" className="node-badge" />
            </g>

            <g className="topo-node" transform="translate(400, 320)">
              <circle r="30" fill="var(--bg-elevated)" stroke="var(--border)" strokeWidth="2" />
              <Zap size={20} x="-10" y="-10" style={{ color: "var(--yellow)" }} />
              <text y="44" textAnchor="middle" className="node-text-title">User Clients</text>
            </g>
          </svg>
        </div>
      )}

      {/* TAB 3: Diagnostic Terminal */}
      {activeTab === "terminal" && (
        <div className="diagnostics-grid">
          <div className="diag-card connectivity-list" style={{ gridColumn: "span 8" }}>
            <div className="card-header">
              <Activity size={18} />
              <h3>Connectivity Matrix</h3>
            </div>
            <div className="connectivity-table-container">
              <table className="connectivity-styled-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>IP Address</th>
                    <th>Latency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceStats.length > 0 ? (
                    deviceStats.map((dev, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: "700" }}>{dev.name || dev.id || 'Camera'}</td>
                        <td style={{ fontFamily: "monospace" }}>{dev.ip}</td>
                        <td>
                          {dev.latency ? (
                            <span className={`latency-indicator ${dev.latency > 100 ? 'high' : dev.latency > 50 ? 'mid' : 'low'}`}>
                              {dev.latency} ms
                            </span>
                          ) : '--'}
                        </td>
                        <td>
                          <span className={`status-badge ${dev.status === "Online" || dev.status === "online" ? "healthy" : "warning"}`}>
                            {dev.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4" style={{ textAlign: "center", color: "var(--text-muted)", padding: "20px" }}>
                        No camera devices queried in matrix.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="diag-card instant-tool" style={{ gridColumn: "span 4" }}>
            <div className="card-header">
              <Terminal size={18} />
              <h3>Diagnostic Terminal</h3>
            </div>
            <div className="tool-body">
              <p className="tool-hint">Enter target device ID or IP Address to trigger a direct connection status poll.</p>
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Target IP or Node ID"
                  value={diagnosingIp}
                  onChange={(e) => setDiagnosingIp(e.target.value)}
                />
                <button onClick={runInstantCheck} disabled={isPinging}>
                  {isPinging ? 'Poll...' : <Zap size={16} />}
                </button>
              </div>

              {diagResult && (
                <div className="result-area">
                  <div className="result-header">
                    <span>Direct Query Result</span>
                    <Clock size={12} />
                  </div>
                  <div className="result-box">
                    <p>IP Address: <strong>{diagResult.ip}</strong></p>
                    <p>Connection: <strong style={{ color: diagResult.status === "Online" ? "var(--brand)" : "var(--red)" }}>{diagResult.status}</strong></p>
                    {diagResult.latency && <p>Roundtrip: <strong>{diagResult.latency}ms</strong></p>}
                    {diagResult.error && <p style={{ color: "var(--red)" }}>{diagResult.error}</p>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkHealthPage;
