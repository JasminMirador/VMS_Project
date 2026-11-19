import React, { useState, useEffect, useRef } from 'react';
import DatePicker from "../shared/DatePicker";
import TimePicker from "../shared/TimePicker";
import DateTimePicker from "../shared/DateTimePicker";
import SpecularButton from "./../shared/SpecularButton";
import AnimatedDownloadButton from "./../shared/AnimatedDownloadButton";
import { useTheme } from "../../context/ThemeContext";
import './ProcessMetricsPanel.css';

const ProcessHistoryPanel = () => {
  const { theme } = useTheme();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [isDownloadOpen, setIsDownloadOpen] = useState(false);

  const dropdownRef = useRef(null);

  // Filter States
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedService, setSelectedService] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const fetchHistoryLogs = async (overrideParams = {}) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();

      const sDate = overrideParams.startDate !== undefined ? overrideParams.startDate : startDate;
      const eDate = overrideParams.endDate !== undefined ? overrideParams.endDate : endDate;
      const svc = overrideParams.selectedService !== undefined ? overrideParams.selectedService : selectedService;
      const st = overrideParams.selectedStatus !== undefined ? overrideParams.selectedStatus : selectedStatus;

      if (sDate) {
        try {
          params.append('start_date', new Date(sDate).toISOString());
        } catch {
          params.append('start_date', sDate);
        }
      }
      if (eDate) {
        try {
          params.append('end_date', new Date(eDate).toISOString());
        } catch {
          params.append('end_date', eDate);
        }
      }
      if (svc && svc !== 'all') params.append('service', svc);
      if (st && st !== 'all') params.append('status', st);
      params.append('limit', '250');

      const res = await fetch(`/api/dashboard/process-history?${params.toString()}`, {
        headers: { 'Authorization': token ? `Bearer ${token}` : '' }
      });
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
        setTotalCount(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch process history logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistoryLogs();
  }, []);

  // Close dropdown menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDownloadOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleApplyFilter = (e) => {
    e.preventDefault();
    fetchHistoryLogs();
  };

  const handleResetFilter = () => {
    setStartDate('');
    setEndDate('');
    setSelectedService('all');
    setSelectedStatus('all');
    fetchHistoryLogs({
      startDate: '',
      endDate: '',
      selectedService: 'all',
      selectedStatus: 'all'
    });
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return '-';
    try {
      let formattedIso = String(isoStr);
      if (!formattedIso.endsWith('Z') && !formattedIso.includes('+') && !formattedIso.includes('-')) {
        formattedIso += 'Z';
      }
      const d = new Date(formattedIso);
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch {
      return isoStr;
    }
  };

  // 1. Export as Excel / CSV Spreadsheet
  const handleExportExcel = () => {
    setIsDownloadOpen(false);
    if (!logs || logs.length === 0) {
      alert('No logs available to export.');
      return;
    }

    const headers = ['PID', 'Process / Service', 'Role / Camera IP', 'Start Date & Time', 'End / Stopped Time', 'Uptime Duration', 'Status', 'Exit Reason'];
    const rows = logs.map(l => [
      `"${l.pid || ''}"`,
      `"${l.name || l.service || ''}"`,
      `"${l.camera_ip && l.camera_ip !== 'N/A' ? l.camera_ip : (l.role || l.service || '')}"`,
      `"${formatDate(l.start_time)}"`,
      `"${l.status === 'ACTIVE' ? 'Currently Active' : formatDate(l.end_time)}"`,
      `"${l.uptime_formatted || `${l.uptime_seconds || 0}s`}"`,
      `"${l.status || ''}"`,
      `"${(l.exit_reason || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VMS_Process_Uptime_History_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 2. Export as Printable PDF Report
  const handleExportPDF = () => {
    setIsDownloadOpen(false);
    if (!logs || logs.length === 0) {
      alert('No logs available to export.');
      return;
    }

    const reportWindow = window.open('', '_blank');
    if (!reportWindow) {
      alert('Please allow popups to generate the PDF report.');
      return;
    }

    const nowStr = new Date().toLocaleString();
    const rowsHtml = logs.map((l, i) => `
      <tr style="background-color: ${i % 2 === 0 ? '#ffffff' : '#f8fafc'};">
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-family: monospace;">${l.pid}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${l.name || l.service}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${l.camera_ip && l.camera_ip !== 'N/A' ? l.camera_ip : (l.role || l.service)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${formatDate(l.start_time)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${l.status === 'ACTIVE' ? 'Currently Active' : formatDate(l.end_time)}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${l.uptime_formatted || `${l.uptime_seconds || 0}s`}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">
          <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: ${l.status === 'ACTIVE' ? '#166534' : '#991b1b'}; background-color: ${l.status === 'ACTIVE' ? '#dcfce7' : '#fee2e2'};">
            ${l.status}
          </span>
        </td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">${l.exit_reason || '-'}</td>
      </tr>
    `).join('');

    reportWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>MIRADOR VMS - Process Uptime & Downtime History Report</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; margin: 24px; color: #0f172a; }
            .header { border-bottom: 2px solid #0ea5e9; padding-bottom: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
            .title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0; }
            .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
            .meta { font-size: 12px; color: #475569; text-align: right; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
            th { background-color: #0f172a; color: #ffffff; text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
            .footer { margin-top: 24px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; text-align: center; }
            @page { size: landscape; margin: 15mm; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="title">MIRADOR VMS</h1>
              <div class="subtitle">Process Uptime & Downtime History Audit Report</div>
            </div>
            <div class="meta">
              <div><strong>Generated:</strong> ${nowStr}</div>
              <div><strong>Total Records:</strong> ${logs.length}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>PID</th>
                <th>Process / Service</th>
                <th>Role / Camera IP</th>
                <th>Start Date & Time</th>
                <th>End / Stopped Time</th>
                <th>Uptime Duration</th>
                <th>Status</th>
                <th>Exit Reason</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="footer">
            Confidential - Generated by MIRADOR AI Video Management System Process Inspector
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `);
    reportWindow.document.close();
  };

  return (
    <div className="vms-proc-panel">
      {/* Header */}
      <div className="vms-proc-header">
        <h3 className="vms-proc-title">Process Uptime & Downtime History Log</h3>
        
        <div className="vms-proc-actions">
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
            className="vms-proc-btn vms-proc-btn-primary"
            onClick={() => fetchHistoryLogs()}
            disabled={loading}
          >
            Refresh History
          </SpecularButton>

          {/* Download Report Dropdown */}
          <div className="vms-dropdown-wrapper" ref={dropdownRef}>
            <AnimatedDownloadButton
              onClick={() => setIsDownloadOpen(!isDownloadOpen)}
              tooltip="Download Report"
              text="Download Report ▾"
              style={{ '--width': '160px', '--height': '32px' }}
            />

            {isDownloadOpen && (
              <div className="vms-dropdown-menu">
                <button className="vms-dropdown-item" onClick={handleExportPDF}>
                  Export as PDF (.pdf)
                </button>
                <button className="vms-dropdown-item" onClick={handleExportExcel}>
                  Export as Excel (.csv)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <form className="vms-proc-controls" onSubmit={handleApplyFilter} style={{ background: 'var(--bg-surface, #121824)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border, #1e293b)', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '220px' }}>
          <label style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', fontWeight: 600, letterSpacing: '0.03em' }}>FROM DATE & TIME</label>
          <DateTimePicker 
            value={startDate} 
            onChange={(val) => setStartDate(val)} 
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '220px' }}>
          <label style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', fontWeight: 600, letterSpacing: '0.03em' }}>TO DATE & TIME</label>
          <DateTimePicker 
            value={endDate} 
            onChange={(val) => setEndDate(val)} 
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', fontWeight: 600, letterSpacing: '0.03em' }}>SERVICE NAME</label>
          <select 
            className="vms-proc-search-input" 
            value={selectedService} 
            onChange={(e) => setSelectedService(e.target.value)}
            style={{ width: '180px', colorScheme: theme === 'light' ? 'light' : 'dark', background: 'var(--bg-base, #0b0f17)', border: '1px solid var(--border, #1e293b)', color: 'var(--text-primary, #ffffff)' }}
          >
            <option value="all">All Services</option>
            <option value="run_api.py">API Server (run_api.py)</option>
            <option value="stream_manager.py">Stream Manager</option>
            <option value="run_scheduler.py">Scheduler</option>
            <option value="recorder_worker.py">Recorder Workers</option>
            <option value="ffmpeg">FFmpeg Transcoders</option>
            <option value="mongod.exe">MongoDB Database</option>
            <option value="minio.exe">MinIO Storage</option>
            <option value="mosquitto.exe">Mosquitto MQTT</option>
            <option value="mediamtx.exe">MediaMTX Streaming</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', fontWeight: 600, letterSpacing: '0.03em' }}>PROCESS STATUS</label>
          <select 
            className="vms-proc-search-input" 
            value={selectedStatus} 
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={{ width: '140px', colorScheme: theme === 'light' ? 'light' : 'dark', background: 'var(--bg-base, #0b0f17)', border: '1px solid var(--border, #1e293b)', color: 'var(--text-primary, #ffffff)' }}
          >
            <option value="all">All Statuses</option>
            <option value="ACTIVE">ACTIVE (Running)</option>
            <option value="STOPPED">STOPPED (Ended)</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
          <SpecularButton
            type="submit"
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
            className="vms-proc-btn vms-proc-btn-primary"
          >
            Filter
          </SpecularButton>
          <SpecularButton
            type="button"
            size="sm"
            radius={8}
            tint="#10b981"
            tintOpacity={0.10}
            blur={4}
            textColor={theme === 'light' ? "#065f46" : "#f0fff8"}
            lineColor="#10b981"
            baseColor={theme === 'light' ? "#f1f5f9" : "#1e293b"} // a bit different base color for Reset to look secondary
            intensity={1.2}
            shineSize={12}
            shineFade={38}
            thickness={1}
            speed={0.35}
            followMouse
            proximity={220}
            autoAnimate={false}
            className="vms-proc-btn"
            onClick={handleResetFilter}
          >
            Reset
          </SpecularButton>
        </div>
      </form>

      {/* History Table */}
      {loading ? (
        <div className="vms-proc-loading">
          <div className="vms-proc-spinner"></div>
          <span>Loading process history log entries...</span>
        </div>
      ) : (
        <div className="vms-proc-table-wrapper">
          <table className="vms-proc-table">
            <thead>
              <tr>
                <th>PID</th>
                <th>Process / Service</th>
                <th>Role / Camera IP</th>
                <th>Start Date & Time</th>
                <th>End / Stopped Time</th>
                <th>Uptime Duration</th>
                <th>Status</th>
                <th>Exit Reason</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan="8" className="vms-table-empty">No lifecycle history logs found for the selected filter.</td>
                </tr>
              ) : (
                logs.map((log, idx) => (
                  <tr key={`${log.pid}-${log.start_time}-${idx}`}>
                    <td className="vms-pid-cell"><code>{log.pid}</code></td>
                    <td className="vms-name-cell"><strong>{log.name || log.service}</strong></td>
                    <td>
                      {log.camera_ip && log.camera_ip !== 'N/A' ? (
                        <span className="vms-ip-tag">{log.camera_ip}</span>
                      ) : (
                        <span className="vms-role-tag">{log.role || log.service}</span>
                      )}
                    </td>
                    <td>{formatDate(log.start_time)}</td>
                    <td>{log.status === 'ACTIVE' ? <span style={{ color: 'var(--teal, #0ea5e9)', fontWeight: 600 }}>Currently Active</span> : formatDate(log.end_time)}</td>
                    <td><strong>{log.uptime_formatted || `${log.uptime_seconds || 0}s`}</strong></td>
                    <td>
                      {log.status === 'ACTIVE' ? (
                        <span className="vms-status-badge ok">ACTIVE</span>
                      ) : (
                        <span className="vms-status-badge warn" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                          STOPPED
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{log.exit_reason || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ProcessHistoryPanel;
