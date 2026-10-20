import React, { useState, useEffect } from 'react';
import DatePicker from "../../components/shared/DatePicker";
import {
  FaServer, FaShieldAlt, FaHistory, FaCheckCircle,
  FaExclamationTriangle, FaPlayCircle, FaDownload,
  FaDatabase, FaBolt, FaBrain, FaFolder, FaHdd, FaUsb,
  FaArrowRight
} from 'react-icons/fa';
import SpecularButton from "../../components/shared/SpecularButton";
import { useTheme } from "../../context/ThemeContext";
import './BackupPage.css';

const API = (import.meta.env.VITE_API_URL || "") + "/api/backup";
const CAM_API = (import.meta.env.VITE_API_URL || "") + "/api/cameras";

// ── Destination options ───────────────────────────────────────────────────────
const DEST_TYPES = [
  { key: 'network', label: 'Network Backup', sub: 'MinIO to remote network share (configured under Network Storage)', icon: <FaServer /> },
  { key: 'external', label: 'External Drive', sub: 'MinIO to connected USB / External drive (provide drive path)', icon: <FaUsb /> },
  { key: 'local', label: 'Local Disk / Same Device', sub: 'MinIO to local drive (multiple disks on this machine)', icon: <FaHdd /> },
];

// ── Toggle switch ─────────────────────────────────────────────────────────────
const Toggle = ({ checked, onChange }) => (
  <label className="mp-switch" onClick={e => e.stopPropagation()}>
    <input 
      type="checkbox" 
      checked={checked} 
      onChange={e => onChange(e.target.checked)} 
    />
    <span className="mp-switch-slider" />
  </label>
);

// ── Section card wrapper ──────────────────────────────────────────────────────
const SectionCard = ({ icon, title, enabled, onToggle, badge, children }) => (
  <div className="backup-section-card">
    <div className="card-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
        <span style={{ color: 'var(--brand)', fontSize: 22 }}>{icon}</span>
        <h2>{title}</h2>
        {badge && <span className="card-badge">{badge}</span>}
      </div>
      {onToggle !== undefined && <Toggle checked={!!enabled} onChange={onToggle} />}
    </div>
    <div className="card-body">{children}</div>
  </div>
);

// ── Destination picker modal ──────────────────────────────────────────────────
const DestinationModal = ({ onConfirm, onCancel }) => {
  const [exportType, setExportType] = useState('network'); // 'network', 'external', 'local'
  const [drivePath, setDrivePath] = useState('');
  const [localDrive, setLocalDrive] = useState('D'); // D: drive, C: drive, custom
  const [customPath, setCustomPath] = useState('');

  const confirm = () => {
    let path = '';
    if (exportType === 'network') {
      path = ''; // Empty string triggers NETWORK_BASE_DIR on backend
    } else if (exportType === 'external') {
      path = drivePath.trim();
      if (!path) return;
    } else if (exportType === 'local') {
      if (localDrive === 'custom') {
        path = customPath.trim();
        if (!path) return;
      } else {
        path = `${localDrive}:\\Backup`;
      }
    }
    onConfirm(path);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '580px' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <FaDownload style={{ color: 'var(--brand)' }} /> Select Export Destination
        </h2>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
          Choose where to export your recordings from MinIO.
        </p>

        <div className="dest-options" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
          {DEST_TYPES.map(opt => (
            <div 
              key={opt.key} 
              className={`dest-card ${exportType === opt.key ? 'active' : ''}`}
              onClick={() => setExportType(opt.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '14px 18px',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                backgroundColor: exportType === opt.key ? 'rgba(20, 184, 166, 0.05)' : 'transparent',
                borderColor: exportType === opt.key ? 'var(--button-bg)' : 'var(--border-color)'
              }}
            >
              <span style={{ fontSize: 24, color: exportType === opt.key ? 'var(--brand)' : 'var(--text-muted)' }}>{opt.icon}</span>
              <div style={{ textAlign: 'left' }}>
                <div className="dest-label" style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-primary)' }}>{opt.label}</div>
                <div className="dest-sub" style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{opt.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {exportType === 'network' && (
          <div className="help-box info" style={{ marginBottom: 20, padding: '12px 16px', background: 'rgba(20, 184, 166, 0.06)', borderLeft: '4px solid var(--button-bg)', borderRadius: 4, fontSize: 14, color: 'var(--text-primary)' }}>
            Files will be transferred from MinIO to the configured network storage path.
          </div>
        )}

        {exportType === 'external' && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 15, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
              External Drive Path (e.g. E:\Backup or F:\)
            </label>
            <input
              type="text"
              className="backup-input"
              style={{ width: '100%' }}
              placeholder="E:\Backup"
              value={drivePath}
              onChange={e => setDrivePath(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {exportType === 'local' && (
          <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 15, color: 'var(--text-secondary)', display: 'block' }}>
              Select Local Drive/Disk Path
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              {['C', 'D', 'custom'].map(drive => (
                <button
                  key={drive}
                  type="button"
                  className={`btn-secondary ${localDrive === drive ? 'active' : ''}`}
                  style={{
                    flex: 1,
                    background: localDrive === drive ? 'var(--button-bg)' : 'transparent',
                    color: localDrive === drive ? '#fff' : 'var(--text-primary)',
                    borderColor: localDrive === drive ? 'var(--button-bg)' : 'var(--border-color)',
                  }}
                  onClick={() => setLocalDrive(drive)}
                >
                  {drive === 'custom' ? 'Custom Path' : `${drive}: drive`}
                </button>
              ))}
            </div>

            {localDrive === 'custom' && (
              <div style={{ marginTop: 8 }}>
                <input
                  type="text"
                  className="backup-input"
                  style={{ width: '100%' }}
                  placeholder="Enter path (e.g. C:\MyRecordings)"
                  value={customPath}
                  onChange={e => setCustomPath(e.target.value)}
                  autoFocus
                />
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: 2 }} onClick={confirm}>
            <FaPlayCircle /> Export Records
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BackupPage() {
  const { theme } = useTheme();
  const [cameras, setCameras]           = useState([]);
  const [logs, setLogs]                 = useState([]);
  const [status, setStatus]             = useState({
    status: 'Idle', progress: 0, storage_usage: 0,
    local_path: '', network_path: 'Not configured', auto_active: false
  });
  const [notification, setNotification] = useState(null);
  const [loading, setLoading]           = useState({});
  const [networkSaved, setNetworkSaved] = useState(false);
  const [prevStatus, setPrevStatus] = useState('Idle');

  const [manualEnabled, setManualEnabled] = useState(false);
  const [autoEnabled, setAutoEnabled]     = useState(false);
  const [showDestModal, setShowDestModal] = useState(false);
  const [activeTab, setActiveTab]         = useState('storage');

  const [network, setNetwork] = useState({
    protocol: 'SMB', ip: '', port: 445, username: '', password: '', path: ''
  });

  const [manual, setManual] = useState({
    cameras: [], start_date: '', end_date: '', start_time: '00:00:00', end_time: '23:59:59', format: 'ENC'
  });
  const [safeRetentionEnabled, setSafeRetentionEnabled] = useState(true);

  const [groups, setGroups] = useState(() => {
    try {
      const saved = localStorage.getItem("miradorai_groups");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [devices, setDevices] = useState(() => {
    try {
      const saved = localStorage.getItem("miradorai_devices");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [defaultRetention, setDefaultRetention] = useState(() => {
    try {
      const saved = localStorage.getItem("miradorai_default_retention");
      return saved ? parseInt(saved, 10) : 5;
    } catch { return 5; }
  });

  const [retentionPreview, setRetentionPreview] = useState(null);
  const [retentionAlert, setRetentionAlert] = useState(null);

  const [restore, setRestore]       = useState({
    cameras: [], start_date: '', end_date: '', use_smart_restore: false
  });
  const [smartPreview, setSmartPreview] = useState(null);

  const notify = (type, message) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 6000);
  };
  const setLoad = (k, v) => setLoading(p => ({ ...p, [k]: v }));

  const toggleCamera = (setState, ip) =>
    setState(prev => ({
      ...prev,
      cameras: prev.cameras.includes(ip)
        ? prev.cameras.filter(c => c !== ip)
        : [...prev.cameras, ip]
    }));

  const handleNetworkIpChange = ip => {
    setNetwork(n => ({
      ...n, ip,
      path: ip ? `\\\\${ip}\\checking` : n.path
    }));
  };

  useEffect(() => {
    const init = async () => {
      try {
        const [camRes, cfgRes, logRes] = await Promise.all([
          fetch(CAM_API),
          fetch(`${API}/config`),
          fetch(`${API}/logs`)
        ]);
        if (camRes.ok) setCameras(await camRes.json());
        if (logRes.ok) setLogs(await logRes.json());
        if (cfgRes.ok) {
          const cfg = await cfgRes.json();
          if (cfg.network) {
            setNetwork(n => ({ ...n, ...cfg.network }));
            setNetworkSaved(!!cfg.network.path);
          }
          if (cfg.auto)           setAutoEnabled(cfg.auto.enabled ?? false);
          if (cfg.retention_days) setDefaultRetention(cfg.retention_days);
          if (cfg.safe_retention_enabled !== undefined) setSafeRetentionEnabled(cfg.safe_retention_enabled);
        }
      } catch { notify('error', 'Connection failed.'); }
    };
    init();

    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API}/status`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch {}
    };
    fetchStatus();
    const statusPoll = setInterval(fetchStatus, 3000);

    const logPoll = setInterval(async () => {
      try {
        const lRes = await fetch(`${API}/logs`);
        if (lRes.ok) setLogs(await lRes.json());
      } catch {}
    }, 10000);

    return () => {
      clearInterval(statusPoll);
      clearInterval(logPoll);
    };
  }, []);

  useEffect(() => {
    if (status.status === prevStatus) return;
    if (prevStatus === 'Processing') {
      if (status.status === 'Completed') {
        notify('success', 'Manual backup completed successfully!');
      } else if (status.status === 'Failed') {
        notify('error', 'Manual backup failed. Please check the logs.');
      }
    }
    setPrevStatus(status.status);
  }, [status.status, prevStatus]);

  const handleTestConnection = async () => {
    if (!network.path.trim()) return notify('error', 'Enter path.');
    setLoad('test', true);
    try {
      const res = await fetch(`${API}/network/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(network)
      });
      const d = await res.json();
      res.ok ? notify('success', d.message) : notify('error', d.detail);
    } catch { notify('error', 'Test failed.'); }
    finally { setLoad('test', false); }
  };

  const handleSaveNetwork = async () => {
    if (!network.path.trim()) return notify('error', 'Enter path.');
    setLoad('saveNet', true);
    try {
      const res = await fetch(`${API}/network/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(network)
      });
      const d = await res.json();
      if (res.ok) { notify('success', 'Settings saved.'); setNetworkSaved(true); }
      else notify('error', d.detail);
    } catch { notify('error', 'Save failed.'); }
    finally { setLoad('saveNet', false); }
  };

  const handleAutoToggle = async enabled => {
    if (enabled && !networkSaved) return notify('error', 'Save network first.');
    setAutoEnabled(enabled);
    try {
      const res = await fetch(`${API}/auto/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      const d = await res.json();
      res.ok ? notify('success', d.message) : notify('error', d.detail);
    } catch { notify('error', 'Failed.'); }
  };

  const handleManualClick = () => {
    if (!manual.cameras.length) return notify('error', 'Select cameras.');
    if (!manual.start_date || !manual.end_date) return notify('error', 'Select dates.');
    setShowDestModal(true);
  };

  const handleManualStart = async (destinationPath) => {
    setShowDestModal(false);
    setLoad('manual', true);
    try {
      const res = await fetch(`${API}/manual/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...manual, destination_path: destinationPath })
      });
      const d = await res.json();
      res.ok ? notify('success', 'Backup started.') : notify('error', d.detail);
    } catch { notify('error', 'Start failed.'); }
    finally { setLoad('manual', false); }
  };

  const updateGroupRetention = (groupId, days) => {
    setRetentionPreview(null);
    setRetentionAlert(null);
    if (groupId === 'default') {
      setDefaultRetention(days);
      localStorage.setItem('miradorai_default_retention', days.toString());
    } else {
      const updated = groups.map(g => g.id === groupId ? { ...g, retention_days: days } : g);
      setGroups(updated);
      localStorage.setItem('miradorai_groups', JSON.stringify(updated));
    }
    // Updated silently, wait for "Apply" button to save and notify
  };

  const handleApplyRetention = async (backupFirst = false) => {
    const isBackupFirst = backupFirst === true;
    if (!networkSaved) return notify('error', 'Save network first.');
    setLoad('saveRetain', true);
    setRetentionAlert(null);
    const cameraConfigs = getCameraConfigs();
    try {
      // Step 1: Save retention rules to backend config
      const saveRes = await fetch(`${API}/retention/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retention_days: defaultRetention,
          camera_configs: cameraConfigs,
          retention_enabled: true, // Always treat it as enabled when applying
          safe_retention_enabled: safeRetentionEnabled,
          backup_first: isBackupFirst
        })
      });
      
      if (!saveRes.ok) {
        const errData = await saveRes.json();
        notify('error', errData.message || 'Failed to save retention rules.');
        setLoad('saveRetain', false);
        return;
      }

      // Step 2: Immediately execute deletion purge sweep
      const enforceRes = await fetch(`${API}/retention/enforce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retention_days: defaultRetention,
          camera_configs: cameraConfigs,
          safe_retention_enabled: safeRetentionEnabled,
          backup_first: isBackupFirst
        })
      });
      const d = await enforceRes.json();
      if (enforceRes.ok && d.status !== 'error') {
        notify('success', d.message);
        setRetentionPreview(null);
      } else {
        const errMsg = d.message || 'Retention cannot happen as some files are not stored in the backup.';
        notify('error', errMsg);
        setRetentionAlert({
          message: errMsg,
          missing: d.missing_files || []
        });
      }
    } catch (err) {
      notify('error', 'Failed to apply: ' + err.message);
    } finally {
      setLoad('saveRetain', false);
    }
  };

  const getCameraConfigs = () => {
    if (!Array.isArray(cameras)) return [];
    const devs = Array.isArray(devices) ? devices : [];
    const grps = Array.isArray(groups) ? groups : [];

    return cameras.map(cam => {
      if (!cam) return null;
      const matchedDevice = devs.find(d => d && (d.ip === cam.ip || d.name === cam.name));
      const groupId = matchedDevice?.group_id || 'default';
      let days = defaultRetention;
      
      if (matchedDevice && matchedDevice.retention_days !== undefined && matchedDevice.retention_days !== "inherit") {
        days = parseInt(matchedDevice.retention_days, 10);
      } else if (groupId !== 'default') {
        const groupObj = grps.find(g => g && g.id === groupId);
        if (groupObj && groupObj.retention_days !== undefined) {
          days = parseInt(groupObj.retention_days, 10);
        }
      }
      
      return { ip: cam.ip || "", days };
    }).filter(Boolean);
  };

  const handleRetentionPreview = async () => {
    setLoad('retPrev', true);
    setRetentionAlert(null);
    const cameraConfigs = getCameraConfigs();
    try {
      const res = await fetch(`${API}/retention/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retention_days: defaultRetention,
          camera_configs: cameraConfigs,
          safe_retention_enabled: safeRetentionEnabled
        })
      });
      const data = await res.json();
      setRetentionPreview(data);
      if (data.missing_in_backup_count > 0) {
        setRetentionAlert({
          message: `Retention cannot happen for all files because ${data.missing_in_backup_count} file(s) are not stored in the network backup.`,
          missing: data.missing_files || []
        });
      }
    } catch (err) { notify('error', 'Preview failed: ' + err.message); }
    finally { setLoad('retPrev', false); }
  };

  const handleRetentionEnforce = async () => {
    if (!networkSaved) return notify('error', 'Save network first.');
    setLoad('retain', true);
    setRetentionAlert(null);
    const cameraConfigs = getCameraConfigs();
    try {
      const res = await fetch(`${API}/retention/enforce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retention_days: defaultRetention,
          camera_configs: cameraConfigs
        })
      });
      const d = await res.json();
      if (res.ok && d.status !== 'error') {
        notify('success', d.message);
        setRetentionPreview(null);
      } else {
        const errMsg = d.message || 'Retention cannot happen as some files are not stored in the backup.';
        notify('error', errMsg);
        setRetentionAlert({
          message: errMsg,
          missing: d.missing_files || []
        });
      }
    } catch { notify('error', 'Failed.'); }
    finally { setLoad('retain', false); }
  };

  const handleRestoreStart = async () => {
    if (!networkSaved)           return notify('error', 'Save network first.');
    if (!restore.cameras.length) return notify('error', 'Select cameras.');
    if (!restore.start_date || !restore.end_date) return notify('error', 'Select range.');
    setLoad('restore', true);
    try {
      const res = await fetch(`${API}/restore/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restore)
      });
      const d = await res.json();
      res.ok ? notify('success', 'Restore started.') : notify('error', d.detail);
    } catch { notify('error', 'Restore failed.'); }
    finally { setLoad('restore', false); }
  };

  return (
    <div className="backup-page">
      {showDestModal && (
        <DestinationModal
          onConfirm={handleManualStart}
          onCancel={() => setShowDestModal(false)}
        />
      )}

      {/* Header */}
      <div className="backup-page-header">
        <div>
          <h1 className="backup-page-title">Backup Management</h1>
        </div>
        <div className="backup-stats-strip">
          <div className="stat-pill">
            <label>Status</label>
            <div className="stat-value">
              <div className={`status-dot ${status.status === 'Processing' ? 'active' : 'idle'}`} />
              {status.status}
            </div>
          </div>
          <div className="stat-pill">
            <label>Auto Backup</label>
            <div className="stat-value" style={{ color: status.auto_active ? 'var(--brand)' : 'var(--text-muted)' }}>
              {status.auto_active ? 'Active' : 'Offline'}
            </div>
          </div>
          <div className="stat-pill">
            <label>Network Usage</label>
            <div className="stat-value">
              {status.storage_usage}%
            </div>
          </div>
        </div>
      </div>



      <div className="backup-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* 1. Network Settings */}
          <SectionCard icon={<FaServer />} title="Network Storage" badge={networkSaved ? 'Linked' : null}>
            <div className="form-grid">
              <div className="input-group">
                <label>Protocol</label>
                <select className="backup-select" value={network.protocol} onChange={e => setNetwork(n => ({ ...n, protocol: e.target.value }))}>
                  <option>SMB</option>
                  <option>SFTP</option>
                </select>
              </div>
              <div className="input-group">
                <label>Host Address</label>
                <input type="text" className="backup-input" placeholder="192.168.1.1" value={network.ip} onChange={e => handleNetworkIpChange(e.target.value)} />
              </div>
              <div className="input-group">
                <label>Port</label>
                <input type="number" className="backup-input" value={network.port} onChange={e => setNetwork(n => ({ ...n, port: +e.target.value }))} />
              </div>
              <div className="input-group" style={{ gridColumn: 'span 2' }}>
                <label>Remote Path</label>
                <input type="text" className="backup-input" placeholder="\\host\share" value={network.path} onChange={e => setNetwork(n => ({ ...n, path: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn-secondary" style={{ padding: '6px 14px', fontSize: '15px', width: 'max-content' }} onClick={handleTestConnection} disabled={loading.test}>
                <FaBolt /> Test
              </button>
              <SpecularButton
                size="sm"
                radius={8}
                tint="#10b981"
                tintOpacity={0.10}
                blur={4}
                textColor={theme === 'light' ? "#065f46" : "#f0fff8"}
                lineColor="#10b981"
                baseColor={theme === 'light' ? "#d1fae5" : "#0d3326"}
                intensity={1.2}
                shineSize={12}
                shineFade={38}
                thickness={1}
                speed={0.35}
                followMouse
                proximity={220}
                autoAnimate={false}
                className="btn-primary"
                onClick={handleSaveNetwork}
                disabled={loading.saveNet}
              >
                Save Settings
              </SpecularButton>
            </div>
          </SectionCard>


          {/* 2. Manual Backup */}
          <SectionCard icon={<FaHistory />} title="Data Export">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="input-group">
                  <label>Source Cameras</label>
                  <div className="camera-selector">
                    {cameras.map(c => (
                      <div key={c.id} className="cam-item">
                        <Toggle checked={manual.cameras.includes(c.ip)} onChange={() => toggleCamera(setManual, c.ip)} />
                        <span>{c.name || c.ip}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="form-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px' }}>
                  <div className="input-group backup-input-wrapper">
                    <label>Start Date</label>
                    <DatePicker value={manual.start_date} onChange={val => setManual(m => ({ ...m, start_date: val }))} />
                  </div>
                  <div className="input-group">
                    <label>Start Time</label>
                    <input type="time" className="backup-input" step="1" value={manual.start_time} onChange={e => setManual(m => ({ ...m, start_time: e.target.value }))} />
                  </div>
                  <div className="input-group backup-input-wrapper">
                    <label>End Date</label>
                    <DatePicker value={manual.end_date} onChange={val => setManual(m => ({ ...m, end_date: val }))} />
                  </div>
                  <div className="input-group">
                    <label>End Time</label>
                    <input type="time" className="backup-input" step="1" value={manual.end_time} onChange={e => setManual(m => ({ ...m, end_time: e.target.value }))} />
                  </div>
                </div>
                {status.status === 'Processing' && (
                  <div className="progress-container">
                    <div className="progress-header">
                      <span>Exporting...</span>
                      <span>{status.progress}%</span>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill" style={{ width: `${status.progress}%` }} />
                    </div>
                  </div>
                )}
                <div style={{ alignSelf: 'flex-end' }}>
                  <SpecularButton
                    size="sm"
                    radius={8}
                    tint="#10b981"
                    tintOpacity={0.10}
                    blur={4}
                    textColor={theme === 'light' ? "#065f46" : "#f0fff8"}
                    lineColor="#10b981"
                    baseColor={theme === 'light' ? "#d1fae5" : "#0d3326"}
                    intensity={1.2}
                    shineSize={12}
                    shineFade={38}
                    thickness={1}
                    speed={0.35}
                    followMouse
                    proximity={220}
                    autoAnimate={false}
                    className="btn-primary"
                    onClick={handleManualClick}
                    disabled={loading.manual || status.status === 'Processing'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FaPlayCircle /> Export Records
                    </div>
                  </SpecularButton>
                </div>
              </div>
          </SectionCard>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* 4. Retention */}
          <SectionCard icon={<FaHistory />} title="Retention Policy">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.03)', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
              <div>
                <strong style={{ display: 'block', fontSize: '15px', color: 'var(--text-primary)' }}>Safe Retention Mode</strong>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Verify recording exists in backup storage before deleting from MinIO</span>
              </div>
              <Toggle checked={safeRetentionEnabled} onChange={checked => setSafeRetentionEnabled(checked)} />
            </div>

            <div className="input-group">
              <label style={{ fontSize: '17px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                Group-Level Retention Rules
              </label>
              
              <div className="group-retention-table-wrap">
                <table className="group-retention-table">
                  <thead>
                    <tr>
                      <th>Camera Group</th>
                      <th style={{ textAlign: 'center' }}>Active Cameras</th>
                      <th style={{ textAlign: 'right' }}>Retention Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Default Group Row */}
                    <tr>
                      <td style={{ fontWeight: 600 }}>Default / Unassigned</td>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        {devices.filter(d => !d.group_id || d.group_id === 'default').length} cams
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <select 
                          className="backup-select" 
                          style={{ width: '130px', display: 'inline-block', fontSize: '16px', padding: '4px 8px' }}
                          value={defaultRetention} 
                          onChange={e => updateGroupRetention('default', parseInt(e.target.value, 10))}
                        >
                          <option value={1}>1 Day</option>
                          <option value={3}>3 Days</option>
                          <option value={7}>7 Days</option>
                          <option value={15}>15 Days</option>
                          <option value={30}>30 Days</option>
                          <option value={60}>60 Days</option>
                        </select>
                      </td>
                    </tr>
                    
                    {/* Custom User Groups */}
                    {groups.map(g => {
                      const camCount = devices.filter(d => d.group_id === g.id).length;
                      return (
                        <tr key={g.id}>
                          <td style={{ fontWeight: 600 }}>{g.name}</td>
                          <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            {camCount} cam{camCount !== 1 ? 's' : ''}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <select 
                              className="backup-select" 
                              style={{ width: '130px', display: 'inline-block', fontSize: '16px', padding: '4px 8px' }}
                              value={g.retention_days ?? 5} 
                              onChange={e => updateGroupRetention(g.id, parseInt(e.target.value, 10))}
                            >
                              <option value={1}>1 Day</option>
                              <option value={3}>3 Days</option>
                              <option value={7}>7 Days</option>
                              <option value={15}>15 Days</option>
                              <option value={30}>30 Days</option>
                              <option value={60}>60 Days</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {retentionPreview && (
              <div className="help-box success" style={{ marginTop: 14, background: 'rgba(20, 184, 166, 0.08)', borderColor: 'var(--button-bg)' }}>
                <strong style={{ color: 'var(--brand)' }}>Preview Results:</strong> {retentionPreview.count} file(s) found exceeding group retention periods.
                {retentionPreview.count > 0 && (
                  <ul style={{ margin: '8px 0 0 16px', padding: 0, fontSize: '15px', color: 'var(--text-secondary)' }}>
                    {retentionPreview.files.map((f, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>
                        {f.file} ({f.camera}) - Modified: {f.modified}
                        {f.backed_up ? (
                          <span style={{ color: 'var(--brand)', marginLeft: 8, fontWeight: 600 }}>✓ Verified in Backup</span>
                        ) : (
                          <span style={{ color: 'var(--red)', marginLeft: 8, fontWeight: 600 }}>⚠️ Missing from Backup</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {retentionAlert && (
              <div className="help-box error" style={{ marginTop: 14, background: 'rgba(239, 68, 68, 0.08)', borderColor: 'var(--red)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <strong style={{ color: 'var(--red)', display: 'block', marginBottom: '4px' }}>⚠️ Retention Halted:</strong>
                  <span style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>{retentionAlert.message}</span>
                  {retentionAlert.missing && retentionAlert.missing.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>Files missing from network backup:</div>
                      <ul style={{ margin: '0 0 0 16px', padding: 0, fontSize: '15px', color: 'var(--text-secondary)' }}>
                        {retentionAlert.missing.map((f, idx) => (
                          <li key={idx} style={{ color: 'var(--text-secondary)' }}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <button 
                  className="btn-primary" 
                  style={{ background: 'var(--button-bg)', borderColor: 'var(--button-bg)', alignSelf: 'flex-start', padding: '6px 14px', fontSize: '14px', marginTop: 4 }}
                  onClick={() => handleApplyRetention(true)}
                  disabled={loading.saveRetain}
                >
                  {loading.saveRetain ? 'Processing...' : 'Backup Missing & Enforce Retention'}
                </button>
              </div>
            )}

            {status.status === 'Processing' && (
              <div className="progress-container" style={{ marginTop: 14 }}>
                <div className="progress-header">
                  <span>Processing Retention & Backup...</span>
                  <span>{status.progress}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width: `${status.progress}%` }} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'flex-end' }}>
              <SpecularButton
                size="sm"
                radius={8}
                tint="#10b981"
                tintOpacity={0.10}
                blur={4}
                textColor={theme === 'light' ? "#065f46" : "#f0fff8"}
                lineColor="#10b981"
                baseColor={theme === 'light' ? "#d1fae5" : "#0d3326"}
                intensity={1.2}
                shineSize={12}
                shineFade={38}
                thickness={1}
                speed={0.35}
                followMouse
                proximity={220}
                autoAnimate={false}
                className="btn-primary"
                onClick={handleApplyRetention}
                disabled={loading.saveRetain || status.status === 'Processing'}
              >
                Apply Retention Rules
              </SpecularButton>
            </div>
          </SectionCard>
        </div>
      </div>

      {notification && (
        <div className={`notification-toast ${notification.type}`}>
          {notification.message}
        </div>
      )}
    </div>
  );
}