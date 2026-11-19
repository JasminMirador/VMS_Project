import React, { useState, useEffect, useRef } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from "recharts";
import {
  Play,
  Square,
  AlertTriangle,
  Download,
  FileText,
  Cpu,
  Database,
  Activity,
  HardDrive,
  Wifi,
  Video,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
  Settings,
  RefreshCw,
  Sliders
} from "lucide-react";
import "./PerformanceTestPage.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function PerformanceTestPage() {
  const [activeRun, setActiveRun] = useState(null);
  const [runsList, setRunsList] = useState([]);
  const [topology, setTopology] = useState(null);
  const [liveSample, setLiveSample] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [stages, setStages] = useState([]);
  const [activeTab, setActiveTab] = useState("cpu_mem"); // 'cpu_mem' | 'gpu' | 'io_net'
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Modals
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState(null);

  // Configuration Form State
  const [configName, setConfigName] = useState("Xeon Capacity Benchmark");
  const [targetCameras, setTargetCameras] = useState(100);
  const [testDurationMinutes, setTestDurationMinutes] = useState(10);
  const [testMode, setTestMode] = useState("sustained"); // "sustained" | "progressive"
  const [baselineSec, setBaselineSec] = useState(60);
  const [spikeAnalysis, setSpikeAnalysis] = useState(null);

  const [enableRecording, setEnableRecording] = useState(true);
  const [enableEncryption, setEnableEncryption] = useState(true);
  const [enableMinio, setEnableMinio] = useState(true);
  const [streamCodec, setStreamCodec] = useState("H.264");
  const [streamResolution, setStreamResolution] = useState("1080p (1920x1080)");
  const [streamFps, setStreamFps] = useState(20);
  const [streamBitrate, setStreamBitrate] = useState(4096);
  const [maxCpuThreshold, setMaxCpuThreshold] = useState(95);
  const [minDiskThreshold, setMinDiskThreshold] = useState(30);

  const getAuthToken = () =>
    localStorage.getItem("miradorai_token") ||
    sessionStorage.getItem("miradorai_token") ||
    localStorage.getItem("token") ||
    sessionStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    "";

  const getAuthHeaders = () => {
    const t = getAuthToken();
    return {
      Authorization: t ? `Bearer ${t}` : "",
      "Content-Type": "application/json"
    };
  };

  // Fetch initial topology and status
  useEffect(() => {
    fetchTopology();
    fetchRuns();
    checkActiveStatus();
  }, []);

  // Polling loop
  useEffect(() => {
    let timer = null;
    const poll = async () => {
      const targetId = activeRun?.run_id || selectedRunId;
      if (targetId) {
        await fetchLiveMetrics(targetId);
        await fetchStages(targetId);
        await fetchSpikes(targetId);
      }
      await checkActiveStatus();
    };

    poll();
    timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [activeRun?.run_id, selectedRunId]);

  const fetchTopology = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/performance-test/system-topology`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setTopology(data.topology);
        if (data.topology?.detected_camera_profile?.detected) {
          const det = data.topology.detected_camera_profile;
          if (det.codec) setStreamCodec(det.codec);
          if (det.resolution) setStreamResolution(det.resolution);
          if (det.fps) setStreamFps(det.fps);
          if (det.bitrate_kbps) setStreamBitrate(det.bitrate_kbps);
        }
      }
    } catch (e) {
      console.error("Failed fetching topology", e);
    }
  };

  const checkActiveStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/performance-test/status`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.is_running && data.run) {
          setActiveRun(data.run);
          if (!selectedRunId) setSelectedRunId(data.run.run_id);
        } else if (activeRun && !data.is_running) {
          // Just completed
          setActiveRun(null);
          fetchRuns();
        }
      }
    } catch (e) {
      console.error("Status check error", e);
    }
  };

  const fetchRuns = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/performance-test/runs?limit=20`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setRunsList(data.runs || []);
        if (!selectedRunId && data.runs && data.runs.length > 0) {
          setSelectedRunId(data.runs[0].run_id);
        }
      }
    } catch (e) {
      console.error("Failed fetching runs list", e);
    }
  };

  const fetchLiveMetrics = async (runId) => {
    try {
      const res = await fetch(`${API_BASE}/api/performance-test/run/${runId}/live`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.sample) {
          setLiveSample(data.sample);
          
          // Append to chart data buffer (keep last 40 points)
          const newPt = {
            time: new Date(data.sample.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            vms_cpu: data.sample.attribution?.vms_total_cpu_pct || 0,
            server_cpu: data.sample.server_total?.cpu_pct || 0,
            vms_ram: data.sample.attribution?.vms_total_ram_gb || 0,
            server_ram: data.sample.server_total?.ram_used_gb || 0,
            gpu_util: data.sample.gpu?.utilization_pct || 0,
            vram_gb: roundNumber((data.sample.gpu?.vram_used_mb || 0) / 1024, 2),
            disk_write: data.sample.server_total?.disk_write_mb_s || 0,
            net_rx: data.sample.server_total?.net_rx_mbps || 0,
            active_cams: data.sample.camera_count || 0
          };

          setChartData((prev) => {
            const updated = [...prev, newPt];
            return updated.slice(-40);
          });
        }
      }
    } catch (e) {
      console.error("Metrics fetch error", e);
    }
  };

  const fetchStages = async (runId) => {
    try {
      const res = await fetch(`${API_BASE}/api/performance-test/run/${runId}/stages`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStages(data.stages || []);
      }
    } catch (e) {
      console.error("Stages fetch error", e);
    }
  };

  const fetchSpikes = async (runId) => {
    try {
      const res = await fetch(`${API_BASE}/api/performance-test/run/${runId}/spikes`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setSpikeAnalysis(data.analysis || null);
      }
    } catch (e) {
      console.error("Spikes fetch error", e);
    }
  };

  const formatSeconds = (totalSec) => {
    if (!totalSec || totalSec <= 0) return "00m 00s";
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return `${m}m ${s < 10 ? "0" : ""}${s}s`;
  };

  const handleCreateRun = async () => {
    setErrorMsg("");
    setLoading(true);
    try {
      const numCams = Number(targetCameras) || 100;
      const durationMins = Number(testDurationMinutes) || 10;
      const payload = {
        name: configName || `Capacity Benchmark (${numCams} Cameras - ${durationMins}m)`,
        target_camera_count: numCams,
        test_duration_minutes: durationMins,
        test_mode: testMode,
        baseline_duration_sec: Number(baselineSec) || 60,
        profiles: {
          codec: streamCodec,
          resolution: streamResolution,
          fps: Number(streamFps),
          bitrate_kbps: Number(streamBitrate)
        },
        enable_recording: enableRecording,
        enable_encryption: enableEncryption,
        enable_minio_upload: enableMinio,
        safety_thresholds: {
          max_server_cpu_pct: Number(maxCpuThreshold),
          min_free_disk_gb: Number(minDiskThreshold),
          max_dropped_frames_pct: 20
        }
      };

      const res = await fetch(`${API_BASE}/api/performance-test/run`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to create run");

      setShowConfigModal(false);
      setSelectedRunId(data.run.run_id);
      await fetchRuns();
      setShowConfirmModal(true); // Ask confirmation before starting
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartRun = async (runId) => {
    setErrorMsg("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/performance-test/run/${runId}/start`, {
        method: "POST",
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to start run");
      setShowConfirmModal(false);
      setChartData([]);
      await checkActiveStatus();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStopRun = async () => {
    if (!activeRun) return;
    setLoading(true);
    try {
      await fetch(`${API_BASE}/api/performance-test/run/${activeRun.run_id}/stop`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ reason: "Operator clicked Stop button in UI" })
      });
      await checkActiveStatus();
      await fetchRuns();
    } catch (e) {
      console.error("Stop run error", e);
    } finally {
      setLoading(false);
    }
  };

  const roundNumber = (val, dec = 1) => {
    if (val === undefined || val === null || isNaN(val)) return 0;
    return Number(val).toFixed(dec);
  };

  const currentRunInfo = runsList.find((r) => r.run_id === selectedRunId) || activeRun;

  return (
    <div className="perf-lab-container">
      {/* ── HEADER ────────────────────────────────────────────── */}
      <div className="perf-lab-header">
        <div>
          <div className="perf-lab-title-row">
            <h1 className="perf-lab-title">Performance Test Lab</h1>
            {activeRun ? (
              <span className={`status-pill pill-${activeRun.status.toLowerCase()}`}>
                <Activity size={13} className="spin-slow" /> {activeRun.status}
              </span>
            ) : currentRunInfo ? (
              <span className={`status-pill pill-${(currentRunInfo.status || "created").toLowerCase()}`}>
                {currentRunInfo.status}
              </span>
            ) : (
              <span className="status-pill pill-idle">IDLE</span>
            )}
          </div>
          <p className="perf-lab-subtitle">
            Controlled capacity benchmark and test-attributable telemetry inspector for dedicated Windows VMS.
          </p>
        </div>

        <div className="perf-header-actions">
          <button className="btn-secondary" onClick={() => setShowConfigModal(true)} disabled={!!activeRun}>
            <Sliders size={15} /> Configure Run
          </button>

          {activeRun ? (
            <button className="btn-danger" onClick={handleStopRun} disabled={loading}>
              <Square size={15} /> Stop Run
            </button>
          ) : currentRunInfo && currentRunInfo.status === "CREATED" ? (
            <button className="btn-primary" onClick={() => handleStartRun(currentRunInfo.run_id)} disabled={loading}>
              <Play size={15} /> Start Run
            </button>
          ) : null}

          {selectedRunId && (
            <div className="export-btn-group">
              <a
                href={`${API_BASE}/api/performance-test/run/${selectedRunId}/export/csv?token=${encodeURIComponent(getAuthToken())}`}
                target="_blank"
                rel="noreferrer"
                className="btn-outline"
                title="Download raw metric samples CSV"
              >
                <Download size={14} /> CSV
              </a>
              <a
                href={`${API_BASE}/api/performance-test/run/${selectedRunId}/export/html?token=${encodeURIComponent(getAuthToken())}`}
                target="_blank"
                rel="noreferrer"
                className="btn-outline"
                title="Open executive PDF/HTML report"
              >
                <FileText size={14} /> Report
              </a>
            </div>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="perf-alert-banner">
          <AlertTriangle size={16} /> <span>{errorMsg}</span>
        </div>
      )}

      {/* ── LIVE SUSTAINED RUN PROGRESS BANNER ─────────────────── */}
      {activeRun && (
        <div className="perf-progress-banner">
          <div className="progress-banner-left">
            <div className="progress-title">
              <Activity size={18} className="spin-slow" />
              <span>
                Sustained Benchmark Active: <strong>{liveSample?.services?.mediamtx?.test_paths_active || liveSample?.camera_count || activeRun?.config?.target_camera_count || targetCameras} Cameras</strong> Under Test
              </span>
            </div>
            <div className="progress-subtitle">
              Stage {activeRun.current_stage?.index || 1}: {activeRun.current_stage?.name || "Target Sustained Load"} • 
              Elapsed: <strong>{formatSeconds(liveSample?.stage_progress?.elapsed_sec || activeRun.current_stage?.elapsed_sec || 0)}</strong> / {formatSeconds(liveSample?.stage_progress?.duration_sec || activeRun.current_stage?.duration_sec || (activeRun.config?.test_duration_minutes || 10) * 60)} • 
              Remaining: <strong className="progress-remaining-time">{formatSeconds(liveSample?.stage_progress?.remaining_sec || activeRun.current_stage?.remaining_sec || 0)}</strong>
            </div>
          </div>
          <div className="progress-banner-right">
            <div className="progress-bar-track">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${liveSample?.stage_progress?.progress_pct || activeRun.current_stage?.progress_pct || 0}%` }}
              />
            </div>
            <span className="progress-pct-label">
              {liveSample?.stage_progress?.progress_pct || activeRun.current_stage?.progress_pct || 0}%
            </span>
          </div>
        </div>
      )}

      {/* ── SECTION A: OVERVIEW BENTO TILES ───────────────────── */}
      <div className="perf-bento-grid">
        {/* Card 1: Attributed CPU vs Whole-Server */}
        <div className="bento-card highlight-card">
          <div className="card-top">
            <span className="card-label">VMS Attributed CPU</span>
            <Cpu size={16} className="card-icon" />
          </div>
          <div className="card-metric">
            <span className="val-main">
              {roundNumber(liveSample?.attribution?.vms_total_cpu_pct || 0)}%
            </span>
            <span className="val-delta">
              (Δ {roundNumber(liveSample?.attribution?.delta_cpu_pct || 0)}% test)
            </span>
          </div>
          <div className="card-footer-note">
            Server Context: {roundNumber(liveSample?.server_total?.cpu_pct || 0)}% Total System CPU
          </div>
        </div>

        {/* Card 2: Memory Attribution */}
        <div className="bento-card">
          <div className="card-top">
            <span className="card-label">VMS Process Memory</span>
            <Database size={16} className="card-icon" />
          </div>
          <div className="card-metric">
            <span className="val-main">
              {roundNumber(liveSample?.attribution?.vms_total_ram_gb || 0)} GB
            </span>
            <span className="val-sub">
              / {roundNumber(liveSample?.server_total?.ram_total_gb || topology?.total_ram_gb || 64)} GB Total
            </span>
          </div>
          <div className="card-footer-note">
            Total Server Used: {roundNumber(liveSample?.server_total?.ram_used_gb || 0)} GB ({roundNumber(liveSample?.server_total?.ram_pct || 0)}%)
          </div>
        </div>

        {/* Card 3: GPU & VRAM */}
        <div className="bento-card">
          <div className="card-top">
            <span className="card-label">GPU & VRAM (RTX 2000 Ada)</span>
            <Activity size={16} className="card-icon" />
          </div>
          <div className="card-metric">
            <span className="val-main">
              {roundNumber(liveSample?.gpu?.utilization_pct || 0)}%
            </span>
            <span className="val-sub">
              {roundNumber((liveSample?.gpu?.vram_used_mb || 0) / 1024, 2)} / {roundNumber((liveSample?.gpu?.vram_total_mb || 16384) / 1024, 0)} GB
            </span>
          </div>
          <div className="card-footer-note">
            {topology?.gpu_detected ? `${topology?.gpu_model} • ${liveSample?.gpu?.temperature_c || 0}°C` : "Pure CPU Mode"}
          </div>
        </div>

        {/* Card 4: Storage Volume & Write Throughput */}
        <div className="bento-card">
          <div className="card-top">
            <span className="card-label">Recording Storage I/O</span>
            <HardDrive size={16} className="card-icon" />
          </div>
          <div className="card-metric">
            <span className="val-main">
              {roundNumber(liveSample?.server_total?.disk_write_mb_s || 0)} MB/s
            </span>
            <span className="val-sub">Write Throughput</span>
          </div>
          <div className="card-footer-note">
            Usable Space: {roundNumber((liveSample?.server_total?.disk_free_gb || 0) / 1024, 2)} TB Free
          </div>
        </div>

        {/* Card 5: Ingest Streams & Deliveries */}
        <div className="bento-card">
          <div className="card-top">
            <span className="card-label">Active Logical Feeds</span>
            <Video size={16} className="card-icon" />
          </div>
          <div className="card-metric">
            <span className="val-main">
              {liveSample?.services?.mediamtx?.test_paths_active || liveSample?.camera_count || 0}
            </span>
            <span className="val-sub">
              / {currentRunInfo?.config?.target_camera_count || liveSample?.camera_count || targetCameras} Target
            </span>
          </div>
          <div className="card-footer-note">
            Ingest Network RX: {roundNumber(liveSample?.server_total?.net_rx_mbps || 0)} Mbps
          </div>
        </div>

        {/* Card 6: Video Stream Profile Specification */}
        <div className="bento-card">
          <div className="card-top">
            <span className="card-label">Benchmark Profile Under Test</span>
            <Layers size={16} className="card-icon" />
          </div>
          <div className="card-metric">
            <span className="val-main">
              {currentRunInfo?.config?.target_camera_count || targetCameras} Cams • {currentRunInfo?.config?.test_duration_minutes || testDurationMinutes}m
            </span>
            <span className="val-sub">
              {currentRunInfo?.config?.profiles?.codec || streamCodec} ({currentRunInfo?.config?.profiles?.fps || streamFps} FPS)
            </span>
          </div>
          <div className="card-footer-note">
            Target Bitrate: {currentRunInfo?.config?.profiles?.bitrate_kbps ? `${Math.round(currentRunInfo.config.profiles.bitrate_kbps / 1024)} Mbps` : "4 Mbps"} • {currentRunInfo?.config?.test_mode === "progressive" ? "Progressive" : "Sustained"}
          </div>
        </div>
      </div>

      {/* ── SECTION B: TIME-SERIES CHARTS & ANOMALIES ─────────── */}
      <div className="perf-chart-section">
        <div className="chart-header">
          <div className="chart-tabs">
            <button
              className={`tab-btn ${activeTab === "cpu_mem" ? "active" : ""}`}
              onClick={() => setActiveTab("cpu_mem")}
            >
              CPU & Memory Allocation
            </button>
            <button
              className={`tab-btn ${activeTab === "gpu" ? "active" : ""}`}
              onClick={() => setActiveTab("gpu")}
            >
              GPU & Video RAM
            </button>
            <button
              className={`tab-btn ${activeTab === "io_net" ? "active" : ""}`}
              onClick={() => setActiveTab("io_net")}
            >
              Disk I/O & Network RX
            </button>
            <button
              className={`tab-btn ${activeTab === "spikes" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("spikes");
                const rid = selectedRunId || activeRun?.run_id;
                if (rid) fetchSpikes(rid);
              }}
            >
              CPU Spikes & Reasons {spikeAnalysis?.total_spikes > 0 ? `(${spikeAnalysis.total_spikes})` : ""}
            </button>
          </div>

          <div className="chart-stage-indicator">
            <Layers size={14} /> Stage {activeRun?.current_stage?.index || 0}: {activeRun?.current_stage?.name || "Ready"}
          </div>
        </div>

        <div className="perf-chart-wrapper chart-wrapper">
          {chartData.length === 0 && activeTab !== "spikes" ? (
            <div className="chart-empty-state">
              <Activity size={32} className="text-muted" />
              <p>No metric samples collected yet. Start a test run to stream live charts.</p>
            </div>
          ) : activeTab === "cpu_mem" ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} unit="%" />
                <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "6px" }} />
                <Legend />
                <Area type="monotone" dataKey="vms_cpu" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.25} name="VMS Attributed CPU %" />
                <Line type="monotone" dataKey="server_cpu" stroke="#f59e0b" strokeDasharray="4 4" dot={false} name="Whole-Server CPU % (Context)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : activeTab === "gpu" ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "6px" }} />
                <Legend />
                <Line type="monotone" dataKey="gpu_util" stroke="#10b981" strokeWidth={2} name="GPU Utilization %" />
                <Line type="monotone" dataKey="vram_gb" stroke="#a855f7" strokeWidth={2} name="VRAM Used (GB)" />
              </LineChart>
            </ResponsiveContainer>
          ) : activeTab === "io_net" ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "6px" }} />
                <Legend />
                <Line type="monotone" dataKey="disk_write" stroke="#ec4899" strokeWidth={2} name="Disk Write (MB/s)" />
                <Line type="monotone" dataKey="net_rx" stroke="#3b82f6" strokeWidth={2} name="Network RX (Mbps)" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="spikes-inspector">
              <div className="spikes-kpi-grid">
                <div className="spikes-kpi-card">
                  <div className="spikes-kpi-label">Detected CPU Spikes</div>
                  <div className="spikes-kpi-val" style={{ color: spikeAnalysis?.total_spikes > 3 ? "#ef4444" : "#0284c7" }}>
                    {spikeAnalysis?.total_spikes || 0}
                  </div>
                </div>
                <div className="spikes-kpi-card">
                  <div className="spikes-kpi-label">Peak Spike CPU</div>
                  <div className="spikes-kpi-val" style={{ color: "#ef4444" }}>
                    {spikeAnalysis?.max_spike_pct || 0}%
                  </div>
                </div>
                <div className="spikes-kpi-card">
                  <div className="spikes-kpi-label">Workload Stability Score</div>
                  <div className="spikes-kpi-val" style={{ color: "#10b981" }}>
                    {spikeAnalysis?.stability_score_pct || 100}%
                  </div>
                </div>
                <div className="spikes-kpi-card">
                  <div className="spikes-kpi-label">Primary Culprit Subsystem</div>
                  <div className="spikes-kpi-val primary-culprit-text">
                    {spikeAnalysis?.primary_culprit_subsystem || "Stable Profile"}
                  </div>
                </div>
              </div>

              <div className="spikes-table-wrap">
                <table className="perf-table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Time Offset</th>
                      <th>Peak CPU (VMS / Server)</th>
                      <th>Baseline (Δ Jump)</th>
                      <th>Duration</th>
                      <th>Responsible Subsystem</th>
                      <th>Root Cause & Technical Reason</th>
                      <th>Impact Assessment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!spikeAnalysis?.spikes || spikeAnalysis.spikes.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="table-empty" style={{ color: "#10b981", padding: 18 }}>
                          ✓ No abnormal CPU spikes detected. The test run is operating within normal steady-state parameters.
                        </td>
                      </tr>
                    ) : (
                      spikeAnalysis.spikes.map((sp) => (
                        <tr key={sp.spike_id}>
                          <td><strong>#{sp.spike_id}</strong></td>
                          <td>{sp.time_offset}</td>
                          <td style={{ color: "#ef4444", fontWeight: 700 }}>
                            {sp.peak_vms_cpu_pct}% <span className="text-muted" style={{ fontWeight: 400 }}>(Srv: {sp.peak_server_cpu_pct}%)</span>
                          </td>
                          <td>
                            {sp.baseline_cpu_pct}% <span style={{ color: "#ef4444", fontSize: 11 }}>+{sp.delta_jump_pct}%</span>
                          </td>
                          <td>{sp.duration_sec}s</td>
                          <td className="spike-subsystem-col">{sp.primary_subsystem}</td>
                          <td style={{ fontSize: 12, lineHeight: 1.4 }}>{sp.reason}</td>
                          <td>
                            <span className={sp.impact_assessment?.includes("Low") ? "badge-low" : sp.impact_assessment?.includes("Moderate") ? "badge-moderate" : "badge-high"}>
                              {sp.impact_assessment}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION C: STAGE COMPARISON TABLE ─────────────────── */}
      <div className="perf-table-section">
        <h3 className="section-title">Progressive Camera-Load Stage Comparison</h3>
        <div className="table-responsive">
          <table className="perf-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Target Feeds</th>
                <th>Active Verified</th>
                <th>VMS CPU (Avg / P95)</th>
                <th>Server CPU</th>
                <th>VMS RAM (Avg / Peak)</th>
                <th>Net Ingest RX</th>
                <th>Disk Write</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {stages.length === 0 ? (
                <tr>
                  <td colSpan={9} className="table-empty">
                    No stage summary records yet. Complete stages will appear here with statistical P95 breakdowns.
                  </td>
                </tr>
              ) : (
                stages.map((st, i) => (
                  <tr key={i}>
                    <td><strong>Stage {st.stage_index}</strong></td>
                    <td>{st.camera_count}</td>
                    <td>{st.active_verified_cameras}</td>
                    <td>
                      {st.vms_cpu?.avg}% <span className="text-muted">/ {st.vms_cpu?.p95}%</span>
                    </td>
                    <td>{st.server_cpu?.avg}%</td>
                    <td>
                      {st.vms_ram_gb?.avg} GB <span className="text-muted">(Pk: {st.vms_ram_gb?.peak} GB)</span>
                    </td>
                    <td>{st.network_rx_mbps?.avg} Mbps</td>
                    <td>{st.disk_write_mb_s?.avg} MB/s</td>
                    <td>
                      <span className={`badge-${st.status?.toLowerCase()}`}>
                        {st.status === "PASS" ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {st.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION D: RUN HISTORY SELECTOR ───────────────────── */}
      <div className="perf-history-section">
        <h3 className="section-title">Historical Test Runs</h3>
        <div className="history-grid">
          {runsList.map((r) => (
            <div
              key={r.run_id}
              className={`history-card ${r.run_id === selectedRunId ? "selected" : ""}`}
              onClick={() => setSelectedRunId(r.run_id)}
            >
              <div className="hist-top">
                <span className="hist-name">{r.name}</span>
                <span className={`status-pill pill-${(r.status || "created").toLowerCase()}`}>{r.status}</span>
              </div>
              <div className="hist-meta">
                <span><Clock size={12} /> {new Date(r.created_at).toLocaleDateString()}</span>
                <span>Max Stable: <strong>{r.summary?.max_stable_camera_count ?? "—"} Cams</strong></span>
              </div>
              <div className="hist-meta" style={{ marginTop: 4 }}>
                <span className="hist-profile-meta">
                  {r.config?.profiles?.codec || "H.264"} • {r.config?.profiles?.resolution || "1080p"} • {r.config?.profiles?.fps || 20} FPS
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── MODAL: CONFIGURE TEST RUN ─────────────────────────── */}
      {showConfigModal && (
        <div className="modal-backdrop">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3>Configure Performance Test Run</h3>
              <button className="btn-close" onClick={() => setShowConfigModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <label className="form-label">Run Benchmark Title</label>
              <input
                type="text"
                className="form-input"
                value={configName}
                onChange={(e) => setConfigName(e.target.value)}
              />

              <div className="form-toggles">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={enableRecording}
                    onChange={(e) => setEnableRecording(e.target.checked)}
                  />
                  <span>Enable Recording Pipeline</span>
                </label>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={enableEncryption}
                    onChange={(e) => setEnableEncryption(e.target.checked)}
                  />
                  <span>Enable AES Encryption</span>
                </label>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={enableMinio}
                    onChange={(e) => setEnableMinio(e.target.checked)}
                  />
                  <span>Enable MinIO S3 Sync</span>
                </label>
              </div>

              <div className="form-row">
                <div>
                  <label className="form-label">Safety CPU Hard-Stop (%)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={maxCpuThreshold}
                    onChange={(e) => setMaxCpuThreshold(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Min Free Disk Hard-Stop (GB)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={minDiskThreshold}
                    onChange={(e) => setMinDiskThreshold(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 6 }}>
                <label className="form-label" style={{ margin: 0 }}>Tested Stream Profile Specification</label>
                {topology?.detected_camera_profile?.detected && (
                  <span className="detected-profile-badge">
                    ✓ Auto-detected from {topology.detected_camera_profile.camera_name}
                  </span>
                )}
              </div>
              <div className="form-row">
                <div>
                  <label className="form-label">Video Compression Codec</label>
                  <select
                    className="form-input"
                    value={streamCodec}
                    onChange={(e) => setStreamCodec(e.target.value)}
                  >
                    <option value="H.264">H.264 (AVC)</option>
                    <option value="H.265">H.265 (HEVC)</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Stream Resolution</label>
                  <select
                    className="form-input"
                    value={streamResolution}
                    onChange={(e) => setStreamResolution(e.target.value)}
                  >
                    <option value="1080p (1920x1080)">1080p Full HD (1920x1080)</option>
                    <option value="720p (1280x720)">720p HD (1280x720)</option>
                    <option value="4K UHD (3840x2160)">4K UHD (3840x2160)</option>
                    <option value="Native Physical">Native Physical Resolution</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label className="form-label">Target Frame Rate (FPS)</label>
                  <input
                    type="number"
                    className="form-input"
                    min="1"
                    max="60"
                    value={streamFps}
                    onChange={(e) => setStreamFps(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Target Bitrate (kbps)</label>
                  <input
                    type="number"
                    className="form-input"
                    min="512"
                    step="512"
                    value={streamBitrate}
                    onChange={(e) => setStreamBitrate(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row" style={{ marginTop: 6 }}>
                <div>
                  <label className="form-label">Number of Cameras to Test (Dynamic)</label>
                  <input
                    type="number"
                    className="form-input"
                    min="1"
                    max="500"
                    value={targetCameras}
                    onChange={(e) => setTargetCameras(e.target.value)}
                  />
                  <div className="preset-pill-group">
                    {[10, 25, 50, 100, 150, 200].map((num) => (
                      <button
                        key={num}
                        type="button"
                        className={`preset-pill ${Number(targetCameras) === num ? "active" : ""}`}
                        onClick={() => setTargetCameras(num)}
                      >
                        {num} Cams
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="form-label">Sustained Run Duration (Minutes)</label>
                  <input
                    type="number"
                    className="form-input"
                    min="1"
                    max="1440"
                    value={testDurationMinutes}
                    onChange={(e) => setTestDurationMinutes(e.target.value)}
                  />
                  <div className="preset-pill-group">
                    {[5, 10, 15, 30, 60].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        className={`preset-pill ${Number(testDurationMinutes) === mins ? "active" : ""}`}
                        onClick={() => setTestDurationMinutes(mins)}
                      >
                        {mins} Min
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="form-label">Benchmark Execution Mode</label>
              <div className="mode-toggle-group">
                <button
                  type="button"
                  className={`mode-toggle-btn ${testMode === "sustained" ? "active" : ""}`}
                  onClick={() => setTestMode("sustained")}
                >
                  <span>Sustained Target Load</span>
                  <span>Directly tests {targetCameras} cameras sustained for {testDurationMinutes} min</span>
                </button>
                <button
                  type="button"
                  className={`mode-toggle-btn ${testMode === "progressive" ? "active" : ""}`}
                  onClick={() => setTestMode("progressive")}
                >
                  <span>Progressive Stepped Stages</span>
                  <span>Steps 25% → 50% → 75% → {targetCameras} cameras</span>
                </button>
              </div>

              <div className="config-summary-card">
                <strong>Benchmark Profile Summary:</strong> Will benchmark <strong>{targetCameras} camera feeds</strong> running simultaneously under active streaming & recording for at least <strong>{testDurationMinutes} minutes</strong> continuously. Estimated write volume: ~{((Number(targetCameras) * Number(streamBitrate) * Number(testDurationMinutes) * 60) / (8 * 1024 * 1024)).toFixed(1)} GB.
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setShowConfigModal(false)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={handleCreateRun} disabled={loading}>
                {loading ? "Creating..." : "Save & Proceed"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CONFIRMATION BEFORE LAUNCH ─────────────────── */}
      {showConfirmModal && (
        <div className="modal-backdrop">
          <div className="modal-dialog">
            <div className="modal-header">
              <h3 style={{ color: "#f59e0b" }}>Confirm Resource-Intensive Benchmark</h3>
              <button type="button" className="btn-close" onClick={() => setShowConfirmModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p className="confirm-modal-intro">
                You are about to launch a benchmark with <strong>{targetCameras} logical feeds</strong> running continuously for at least <strong>{testDurationMinutes} minutes</strong> under sustained workload.
              </p>
              <ul className="confirm-modal-list">
                <li>Target Feeds: <strong>{targetCameras} Cameras</strong> ({testMode === "sustained" ? "Direct Sustained Load" : "Progressive Stages"})</li>
                <li>Duration: <strong>{testDurationMinutes} Minutes</strong> minimum sustained run time</li>
                <li>Stream Profile: <strong>{streamCodec} • {streamResolution} • {streamFps} FPS • {streamBitrate} kbps</strong></li>
                <li>Physical cameras will be polled once via MediaMTX loopback.</li>
                <li>All created resources will be tagged and cleaned up automatically upon test completion.</li>
                <li>Automatic safety threshold stops are armed for CPU &gt; {maxCpuThreshold}% and Disk &lt; {minDiskThreshold} GB.</li>
              </ul>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setShowConfirmModal(false)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={() => handleStartRun(selectedRunId)} disabled={loading}>
                {loading ? "Starting..." : "Acknowledge & Launch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
