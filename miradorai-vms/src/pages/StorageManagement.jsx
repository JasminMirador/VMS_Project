import { useState, useEffect, useCallback } from "react";
import "./RaidManagement.css";

const BACKEND = import.meta.env.VITE_API_URL || "";

const TABS = ["Overview", "Volumes", "Health", "Performance", "Logs", "Replication"];

export default function StorageManagement() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState([]);
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [replication, setReplication] = useState(null);
  const [logs, setLogs] = useState("");
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [folderName, setFolderName] = useState("Recordings");
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionMsg, setProvisionMsg] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, configRes, devicesRes, perfRes, logsRes, replRes] = await Promise.all([
        fetch(`${BACKEND}/api/storage/status`).then(r => r.json()),
        fetch(`${BACKEND}/api/storage/config`).then(r => r.json()),
        fetch(`${BACKEND}/api/storage/devices`).then(r => r.json()),
        fetch(`${BACKEND}/api/storage/performance`).then(r => r.json()),
        fetch(`${BACKEND}/api/storage/logs`).then(r => r.json()),
        fetch(`${BACKEND}/api/storage/replication`).then(r => r.json()),
      ]);
      setStatus(statusRes);
      setConfig(configRes);
      setDevices(Array.isArray(devicesRes) ? devicesRes : []);
      setPerformance(perfRes);
      setLogs(logsRes.logs || "No active system logs found.");
      setReplication(replRes);
    } catch (e) {
      console.error("Failed to load RAID data", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleProvision = async () => { if (!selectedDevice) return; if (folderName && !/^[a-zA-Z0-9 _.\-]+$/.test(folderName.trim())) { setProvisionMsg("Folder name contains invalid characters."); return; }

    setIsProvisioning(true);
    setProvisionMsg("Provisioning storage array. This may take a few minutes...");
    try {
      const res = await fetch(`${BACKEND}/api/storage/provision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDriveLetter: "E", recordingsFolder: folderName }),
      });
      if (res.ok) {
        setProvisionMsg("✅ Provisioning complete. Reloading...");
        setTimeout(() => { setProvisionMsg(""); fetchAll(); }, 2000);
      } else {
        setProvisionMsg("❌ Provisioning failed. Check backend logs.");
      }
    } catch {
      setProvisionMsg("❌ Could not reach backend. Is the API running?");
    }
    setIsProvisioning(false);
  };

  const handleRunTest = async () => {
    setIsRunningTest(true);
    setPerformance(p => ({ ...p, status: "Testing..." }));
    try {
      const res = await fetch(`${BACKEND}/api/storage/performance`, { method: "POST" });
      const data = await res.json();
      setPerformance(data);
    } catch {
      setPerformance(p => ({ ...p, status: "Error" }));
    }
    setIsRunningTest(false);
  };

  const isConfigured = status && (status.capacity_tb > 0 || status.free_tb > 0 || status.used_tb > 0);
  const usedPct = status ? Math.min(Math.round((status.used_tb / status.capacity_tb) * 100), 100) : 0;
  const usedColor = usedPct >= 90 ? "var(--red)" : usedPct >= 70 ? "var(--yellow)" : "var(--teal)";

  // ── Wizard (no storage configured) ────────────────────────────────────────
  const renderWizard = () => (
    <div className="rm-wizard">
      <div className="card rm-wizard-card">
        <div className="sm-panel-title">Storage Provisioning Wizard</div>
        <p className="rm-wizard-desc">
          No RAID volume is configured. Select a physical device below to provision it as your VMS recording array.
        </p>

        {devices.length === 0 ? (
          <div className="rm-empty">No poolable disks detected on this system.</div>
        ) : (
          <div className="rm-device-list">
            {devices.map((dev, i) => (
              <button
                key={i}
                className={`rm-device-item ${selectedDevice === dev ? "rm-device-item--selected" : ""}`}
                onClick={() => setSelectedDevice(dev)}
              >
                <div className="rm-device-left">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="22" height="22">
                    <ellipse cx="12" cy="5" rx="9" ry="3"/>
                    <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
                    <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/>
                  </svg>
                  <div>
                    <div className="rm-device-name">{dev.name}</div>
                    <div className="rm-device-meta">{dev.type} · {dev.capacity_tb} TB</div>
                  </div>
                </div>
                <span className={`sm-status ${dev.health === "Healthy" ? "sm-status--ok" : "sm-status--warn"}`}>
                  {dev.health}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="rm-field-row" style={{ marginTop: 8 }}>
          <label className="rm-label">Recordings Folder</label>
          <input
            className="sm-input"
            value={folderName}
            onChange={e => setFolderName(e.target.value)}
            placeholder="e.g., Recordings"
          />
        </div>

        {provisionMsg && <div className="sm-apply-msg">{provisionMsg}</div>}

        <div className="rm-actions">
          <button
            className="sm-btn sm-btn--primary"
            disabled={!selectedDevice || isProvisioning}
            onClick={handleProvision}
          >
            {isProvisioning ? "Provisioning…" : "Provision Storage Array"}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Overview Tab ──────────────────────────────────────────────────────────
  const renderOverview = () => (
    <div className="sm-bottom">
      <div className="sm-card card">
        <div className="sm-panel-title">Recording Storage</div>
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Recording Path</span>
          <strong style={{ marginLeft: "auto", color: "var(--teal)", fontSize: 15, fontFamily: "var(--font-mono)" }}>
            {config?.recording_path || "Not Configured"}
          </strong>
        </div>
        <div className="sm-divider" />
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>System Status</span>
          <span className={`sm-status ${status?.health === "Healthy" ? "sm-status--ok" : "sm-status--warn"}`} style={{ marginLeft: "auto" }}>
            {status?.health || "Unknown"}
          </span>
        </div>
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Retention</span>
          <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
            {config?.retention_days ?? 30} days
          </span>
        </div>
      </div>

      <div className="sm-card card">
        <div className="sm-panel-title">Capacity</div>
        <div className="sm-legend">
          <span className="sm-legend-dot sm-legend-dot--used" />
          <span>Used: <strong>{status?.used_tb} TB</strong></span>
        </div>
        <div className="sm-legend">
          <span className="sm-legend-dot sm-legend-dot--free" />
          <span>Free: <strong>{status?.free_tb} TB</strong></span>
        </div>
        <div className="sm-usage-track" style={{ marginTop: 8 }}>
          <div className="sm-usage-bar" style={{ width: `${usedPct}%`, background: usedColor }} />
        </div>
        <div className="sm-usage-text">{status?.used_tb} TB used of {status?.capacity_tb} TB ({usedPct}%)</div>
        <div className="sm-divider" />
        <div className="sm-field-row" style={{ marginTop: "auto" }}>
          <span style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: 17 }}>Total Capacity:</span>
          <strong style={{ marginLeft: "auto", fontSize: 20, color: "var(--teal)" }}>{status?.capacity_tb} TB</strong>
        </div>
      </div>

      <div className="sm-card card">
        <div className="sm-panel-title">RAID Info</div>
        {/* Dynamically find the drive hosting the recording path (e.g., D: drive) */}
        {(() => {
          const recDriveLetter = (config?.recording_path || "D").substring(0, 1).toUpperCase();
          const activeDev = devices.find(d => d.type?.includes(`(${recDriveLetter})`)) || devices[0];
          return (
            <>
              <div className="sm-field-row">
                <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Disk / Controller</span>
                <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
                  {activeDev?.name || "Standard Storage Controller"}
                </span>
              </div>
              <div className="sm-field-row">
                <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Storage Architecture</span>
                <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
                  {activeDev?.type || "Single Volume (No RAID)"}
                </span>
              </div>
            </>
          );
        })()}
        <div className="sm-divider" />
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Filesystem</span>
          <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>NTFS</span>
        </div>
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Allocation Unit</span>
          <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>64 KB</span>
        </div>
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Mount Status</span>
          <span className="sm-status sm-status--ok" style={{ marginLeft: "auto" }}>Mounted</span>
        </div>
      </div>
    </div>
  );

  // ── Health Tab ────────────────────────────────────────────────────────────
  const renderHealth = () => (
    <div className="sm-bottom">
      {devices.length === 0 ? (
        <div className="sm-card card"><div className="rm-empty">No physical drives detected.</div></div>
      ) : (
        devices.map((dev, i) => (
          <div key={i} className="sm-card card">
            <div className="sm-panel-title">Drive {i + 1}</div>
            <div className="sm-field-row">
              <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Model</span>
              <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>{dev.name}</span>
            </div>
            <div className="sm-field-row">
              <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Capacity</span>
              <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>{dev.capacity_tb} TB</span>
            </div>
            <div className="sm-divider" />
            <div className="sm-field-row">
              <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Health</span>
              <span className={`sm-status ${dev.health === "Healthy" ? "sm-status--ok" : "sm-status--warn"}`} style={{ marginLeft: "auto" }}>
                {dev.health}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );

  // ── Performance Tab ───────────────────────────────────────────────────────
  const renderPerformance = () => (
    <div className="sm-bottom">
      <div className="sm-card card">
        <div className="sm-panel-title">I/O Performance</div>
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Status</span>
          <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
            {performance?.status || "Not Tested"}
          </span>
        </div>
        <div className="sm-divider" />
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Sequential Write</span>
          <strong style={{ marginLeft: "auto", color: "var(--teal)", fontFamily: "var(--font-mono)", fontSize: 18 }}>
            {performance?.write_speed || "N/A"}
          </strong>
        </div>
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Sequential Read</span>
          <strong style={{ marginLeft: "auto", color: "var(--teal)", fontFamily: "var(--font-mono)", fontSize: 18 }}>
            {performance?.read_speed || "N/A"}
          </strong>
        </div>
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Last Test</span>
          <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
            {performance?.last_test || "Never"}
          </span>
        </div>
        <div className="rm-actions" style={{ marginTop: "auto" }}>
          <button
            className="sm-btn sm-btn--primary"
            onClick={handleRunTest}
            disabled={isRunningTest}
          >
            {isRunningTest ? "Running Test…" : "Run Performance Test"}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Logs Tab ──────────────────────────────────────────────────────────────
  const renderLogs = () => (
    <div className="rm-logs-wrap">
      <div className="rm-logs-viewer">{logs}</div>
    </div>
  );

  // ── Replication Tab ───────────────────────────────────────────────────────
  const renderReplication = () => (
    <div className="sm-bottom">
      <div className="sm-card card">
        <div className="sm-panel-title">MinIO Service Status</div>
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Health</span>
          <span className={`sm-status ${replication?.minio_status === 'Healthy' ? 'sm-status--ok' : 'sm-status--warn'}`} style={{ marginLeft: "auto" }}>
            {replication?.minio_status || 'Unknown'}
          </span>
        </div>
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>NSSM Service</span>
          <span className={`sm-status ${replication?.minio_service === 'Running' ? 'sm-status--ok' : 'sm-status--warn'}`} style={{ marginLeft: "auto" }}>
            {replication?.minio_service || 'Stopped'}
          </span>
        </div>
      </div>
      <div className="sm-card card">
        <div className="sm-panel-title">Syncthing Replication</div>
        <div className="sm-field-row">
          <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Status</span>
          <span style={{ color: "var(--text-muted)", marginLeft: "auto", fontSize: 15 }}>
            {replication?.syncthing_status || 'Not Configured'}
          </span>
        </div>
      </div>
    </div>
  );

  const renderTab = () => {
    if (!isConfigured) return renderWizard();
    switch (activeTab) {
      case "Overview":    return renderOverview();
      case "Volumes":     return renderOverview(); // reuse overview for volumes
      case "Health":      return renderHealth();
      case "Performance": return renderPerformance();
      case "Logs":        return renderLogs();
      case "Replication": return renderReplication();
      default:            return null;
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">RAID <span>Management</span></h1>
        </div>
      </div>

      {loading ? (
        <div className="rm-loading">Loading RAID data…</div>
      ) : !isConfigured ? (
        renderWizard()
      ) : (
        <>
          {/* Tab bar matching the screenshot style */}
          <div className="rm-tabs">
            {TABS.map(tab => (
              <button
                key={tab}
                className={`rm-tab ${activeTab === tab ? "rm-tab--active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {renderTab()}
        </>
      )}
    </div>
  );
}
