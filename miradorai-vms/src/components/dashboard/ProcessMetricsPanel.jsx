import React, { useState, useEffect } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import './ProcessMetricsPanel.css';

const ProcessMetricsPanel = ({ onOpenScalingReport, onOpenLiveStreamingReport }) => {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  const { isConnected: isWsConnected, eventsByTopic } = useWebSocket(['process_metrics']);

  const fetchMetrics = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/dashboard/system-metrics/processes', {
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
      
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      
      const data = await res.json();
      if (data && data.success === false) {
        throw new Error(data.error || 'Failed to load process metrics');
      }
      setMetrics(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch process metrics:', err);
      setError(err.message || 'Failed to load process metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch, then WS will take over
    fetchMetrics();
  }, []);

  useEffect(() => {
    if (eventsByTopic['process_metrics']?.length > 0) {
      const lastEvent = eventsByTopic['process_metrics'][eventsByTopic['process_metrics'].length - 1];
      if (lastEvent && lastEvent.payload) {
        setMetrics(lastEvent.payload);
        setLoading(false);
        setError(null);
      }
    }
  }, [eventsByTopic]);

  const handleKillOrphaned = async () => {
    if (!window.confirm('Are you sure you want to terminate all stale duplicate and zombie processes?')) return;
    
    setActionLoading(true);
    setActionMessage(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/dashboard/system-metrics/kill-orphaned-ffmpeg', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
      const result = await res.json();
      if (result.success) {
        let msg = `Successfully terminated ${result.terminated_count} zombie FFmpeg process(es).`;
        if (result.failed_pids && result.failed_pids.length > 0) {
          const firstErr = result.failed_pids[0];
          msg += ` Failed to terminate ${result.failed_pids.length} process(es) due to Windows permission/AccessDenied errors (e.g. PID ${firstErr.pid} running under SYSTEM). Try restarting the backend API server as Administrator.`;
        }
        setActionMessage(msg);
        fetchMetrics();
      } else {
        setActionMessage(`Error: ${result.error || 'Failed to kill processes'}`);
      }
    } catch (err) {
      setActionMessage(`Failed to execute action: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !metrics) {
    return (
      <div className="vms-proc-panel vms-proc-loading">
        <div className="vms-proc-spinner"></div>
        <span>Gathering VMS Process Metrics...</span>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="vms-proc-panel vms-proc-error">
        <p>⚠️ Unable to load process metrics: {error}</p>
        <button onClick={fetchMetrics} className="vms-proc-btn">Retry</button>
      </div>
    );
  }

  const { summary = {}, processes = {} } = metrics || {};
  
  // Aggregate all processes into a single flat list for filtering
  const allProcs = [
    ...(processes.python_services || []),
    ...(processes.recorder_workers || []),
    ...(processes.ffmpeg_processes || []),
    ...(processes.infrastructure || []),
    ...(processes.frontend || []),
    ...(processes.auxiliary || [])
  ];

  const filteredProcs = allProcs.filter(p => {
    // Tab filter
    if (activeTab === 'ffmpeg' && p.role !== 'FFmpeg Stream Transcoder') return false;
    if (activeTab === 'python' && !p.name?.toLowerCase().includes('python') && !p.name?.toLowerCase().includes('vms')) return false;
    if (activeTab === 'workers' && p.role !== 'Active Recording & Encryption Worker' && p.role !== 'Standby Worker') return false;
    if (activeTab === 'infra' && !['mongod.exe', 'minio.exe', 'mosquitto.exe', 'mediamtx.exe'].some(i => (p.service || '').toLowerCase().includes(i))) return false;

    // Search filter
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (p.name || '').toLowerCase().includes(term) ||
      (p.role || '').toLowerCase().includes(term) ||
      (p.camera_ip || '').toLowerCase().includes(term) ||
      String(p.pid).includes(term)
    );
  });

  return (
    <div className="vms-proc-panel">
      {/* Top Header & Actions */}
      <div className="vms-proc-header">
        <h3 className="vms-proc-title">Process & Hardware Metrics</h3>
        <div className="vms-proc-actions">
          {(summary.total_stale_orphaned_count > 0 || summary.orphaned_ffmpeg_count > 0) && (
            <button 
              className="vms-proc-btn vms-proc-btn-danger"
              onClick={handleKillOrphaned}
              disabled={actionLoading}
            >
              ⚡ Clean {summary.total_stale_orphaned_count || summary.orphaned_ffmpeg_count} Stale / Zombie Processes
            </button>
          )}
          <button 
            className="vms-proc-btn vms-proc-btn-primary"
            onClick={onOpenLiveStreamingReport}
            style={{ marginRight: '10px' }}
          >
            📡 Live Streaming Report
          </button>
          <button 
            className="vms-proc-btn vms-proc-btn-primary"
            onClick={onOpenScalingReport}
          >
            📊 Hardware Scaling Report
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="vms-proc-alert">
          {actionMessage}
          <button onClick={() => setActionMessage(null)}>✕</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="vms-proc-cards-grid">
        <div className="vms-proc-card">
          <span className="vms-card-label">Total VMS CPU</span>
          <span className="vms-card-value">{summary.total_vms_cpu_percent ?? 0}%</span>
          <div className="vms-card-sub">Overall Sys: {summary.system_overall_cpu_percent ?? 0}%</div>
        </div>

        <div className="vms-proc-card">
          <span className="vms-card-label">Total VMS RAM</span>
          <span className="vms-card-value">{summary.total_vms_ram_gb ?? 0} GB</span>
          <div className="vms-card-sub">({summary.total_vms_ram_mb ?? 0} MB)</div>
        </div>

        <div className="vms-proc-card">
          <span className="vms-card-label">FFmpeg Transcoders</span>
          <span className="vms-card-value">{summary.total_ffmpeg_processes ?? 0} Processes</span>
          <div className="vms-card-sub">
            {summary.orphaned_ffmpeg_count > 0 ? (
              <span className="vms-badge-warn">⚠️ {summary.orphaned_ffmpeg_count} Zombie</span>
            ) : (
              <span className="vms-badge-ok">✓ All Streams Mapped</span>
            )}
          </div>
        </div>

        <div className="vms-proc-card">
          <span className="vms-card-label">Recorder Workers</span>
          <span className="vms-card-value">{summary.total_recorder_workers ?? 0} Active</span>
          <div className="vms-card-sub">Sharded Workers</div>
        </div>

        <div className="vms-proc-card">
          <span className="vms-card-label">Infra Engines</span>
          <span className="vms-card-value">{summary.total_infrastructure_services ?? 0} Services</span>
          <div className="vms-card-sub">MongoDB, MinIO, Mosquitto, MediaMTX</div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="vms-proc-controls">
        <div className="vms-proc-tabs">
          <button 
            className={`vms-proc-tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All ({allProcs.length})
          </button>
          <button 
            className={`vms-proc-tab ${activeTab === 'ffmpeg' ? 'active' : ''}`}
            onClick={() => setActiveTab('ffmpeg')}
          >
            FFmpeg ({processes.ffmpeg_processes?.length || 0})
          </button>
          <button 
            className={`vms-proc-tab ${activeTab === 'workers' ? 'active' : ''}`}
            onClick={() => setActiveTab('workers')}
          >
            Workers ({processes.recorder_workers?.length || 0})
          </button>
          <button 
            className={`vms-proc-tab ${activeTab === 'python' ? 'active' : ''}`}
            onClick={() => setActiveTab('python')}
          >
            Python Backend ({processes.python_services?.length || 0})
          </button>
          <button 
            className={`vms-proc-tab ${activeTab === 'infra' ? 'active' : ''}`}
            onClick={() => setActiveTab('infra')}
          >
            Infrastructure ({processes.infrastructure?.length || 0})
          </button>
        </div>

        <div className="vms-proc-search">
          <input 
            type="text" 
            className="vms-proc-search-input"
            placeholder="Search by PID, Name, IP, or Service..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Process Table */}
      <div className="vms-proc-table-wrapper">
        <table className="vms-proc-table">
          <thead>
            <tr>
              <th>PID</th>
              <th>Process Name</th>
              <th>Role / Camera IP</th>
              <th>CPU %</th>
              <th>RAM (MB)</th>
              <th>Threads</th>
              <th>Handles</th>
              <th>Uptime</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredProcs.length === 0 ? (
              <tr>
                <td colSpan="9" className="vms-table-empty">No processes match the current filter.</td>
              </tr>
            ) : (
              filteredProcs.map((p, idx) => (
                <tr key={`${p.pid}-${idx}`} className={p.is_orphaned ? 'vms-row-orphaned' : ''}>
                  <td className="vms-pid-cell"><code>{p.pid}</code></td>
                  <td className="vms-name-cell">{p.name}</td>
                  <td>
                    {p.camera_ip && p.camera_ip !== 'N/A' ? (
                      <span className="vms-ip-tag">📹 {p.camera_ip}</span>
                    ) : (
                      <span className="vms-role-tag">{p.role || p.service || 'Process'}</span>
                    )}
                  </td>
                  <td>
                    <span className={`vms-metric-tag ${p.cpu_percent > 15 ? 'high' : ''}`}>
                      {p.cpu_percent}%
                    </span>
                  </td>
                  <td>
                    {(() => {
                      const isHighRam = (p.name?.includes('API Server') || p.service === 'minio.exe' || p.service === 'mongod.exe')
                        ? p.ram_mb > 3500
                        : p.ram_mb > 300;
                      return (
                        <span className={`vms-metric-tag ${isHighRam ? 'high' : ''}`}>
                          {p.ram_mb} MB
                        </span>
                      );
                    })()}
                  </td>
                  <td>{p.threads || '-'}</td>
                  <td>{p.handles || '-'}</td>
                  <td>{p.uptime_seconds ? `${Math.floor(p.uptime_seconds / 60)}m ${p.uptime_seconds % 60}s` : '-'}</td>
                  <td>
                    {p.is_orphaned ? (
                      <span className="vms-status-badge warn">⚠️ Zombie</span>
                    ) : (
                      <span className="vms-status-badge ok">Active</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ProcessMetricsPanel;
