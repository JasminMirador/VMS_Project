import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useI18n } from "../../i18n";
import "./DashboardNewPage.css";

/* ───────────────────────── data helpers ───────────────────────── */
const API_BASE = import.meta.env.VITE_API_URL || "";
const getAuthHeaders = () => {
  const token = localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token");
  return token ? { Authorization: "Bearer " + token } : {};
};
const api = async (path) => {
  const res = await fetch(API_BASE + path, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(path + " " + res.status);
  return res.json();
};
const safe = (path) => api(path).catch(() => null);
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const parseTs = (v) => { if (!v) return NaN; const d = new Date(String(v).replace(" ", "T")); return d.getTime(); };
const camHealth = (c) => {
  if (c.status === "error" || c.status === "offline" || c.fps === 0) return "error";
  if (!c.fps) return "connecting";
  if (c.fps < 10) return "warning";
  return "online";
};
const S1 = "#3987e5", S2 = "#d95926", S3 = "#199e70";
const CAM_PAGE = 8;

/* ───────────────────────── tiny svg icons ───────────────────────── */
const I16 = ({ children }) => <svg viewBox="0 0 16 16" aria-hidden="true">{children}</svg>;
const I24 = ({ children }) => <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
const IcOk = () => <I16><circle cx="8" cy="8" r="6.2" /><path d="M5.3 8.2l1.9 1.9 3.5-3.9" /></I16>;
const IcWarn = () => <I16><path d="M8 2.2l6.2 11H1.8z" /><path d="M8 6.6v3.2" /><circle cx="8" cy="11.7" r=".35" /></I16>;
const IcCrit = () => <I16><circle cx="8" cy="8" r="6.2" /><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" /></I16>;
const IcChev = () => <I16><path d="M4 6l4 4 4-4" /></I16>;
const IcUp = () => <I16><path d="M3.5 10.5L8 6l4.5 4.5" /></I16>;
const IcCal = () => <I24><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></I24>;
const IcRefresh = () => <I24><path d="M20 11a8 8 0 00-14.4-4.2L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0014.4 4.2l1.6-1.7M20 20v-4.5h-4.5" /></I24>;
const IcSearch = () => <I24><circle cx="11" cy="11" r="7" /><path d="M21 21l-5.2-5.2" /></I24>;
const KIND_ICON = { crit: <IcCrit />, warn: <IcWarn /> };

/* ───────────────────────── chart helpers ───────────────────────── */
const linePts = (vals, w, h, pad2 = 2) => {
  const max = Math.max(...vals), min = Math.min(...vals);
  const x = (i) => pad2 + (i * (w - 2 * pad2)) / Math.max(1, vals.length - 1);
  const y = (v) => h - pad2 - ((v - min) / (max - min || 1)) * (h - 2 * pad2);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return { path: "M" + pts.join("L"), area: `M${x(0)},${h}L` + pts.join("L") + `L${x(vals.length - 1)},${h}Z`, last: [x(vals.length - 1), y(vals[vals.length - 1])] };
};

function Spark({ values, w = 120, h = 34 }) {
  const v = (values || []).map(num);
  if (v.length < 2) return <span className="dn-spark-empty" />;
  const l = linePts(v, w, h, 3);
  return (
    <svg className="dn-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={l.area} className="dn-fill" opacity=".12" />
      <path d={l.path} className="dn-stroke" fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={l.last[0]} cy={l.last[1]} r="3.2" className="dn-fill dn-halo" />
    </svg>
  );
}

function AreaFlat({ values }) {
  const v = (values || []).map(num);
  if (v.length < 2) return null;
  const l = linePts(v, 300, 54, 3);
  return (
    <svg viewBox="0 0 300 54" width="100%" height="54" preserveAspectRatio="none" aria-hidden="true">
      <path d={l.area} className="dn-fill" opacity=".12" />
      <path d={l.path} className="dn-stroke" fill="none" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}



/** time-series area chart with y gridlines */
function TrendChart({ points, w = 700, h = 210, yTicks, yFmt = (v) => v, xLabels, unitLabel, extra, reserve = 0 }) {
  const bl = 44, bb = 28, bt = 10, br = 12;
  const vals = points.map((p) => p.v);
  const max = yTicks ? yTicks[yTicks.length - 1] : Math.max(...vals, 1);
  const y = (v) => bt + (h - bt - bb) * (1 - v / max);
  const x = (i) => bl + (i * (w - bl - br) * (1 - reserve)) / Math.max(1, points.length - 1);
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" className="dn-chart" role="img">
      {(yTicks || [0, max / 2, max]).map((v) => (
        <g key={v}><line x1={bl} x2={w - br} y1={y(v)} y2={y(v)} className="dn-gridline" /><text x={bl - 8} y={y(v) + 4} textAnchor="end" className="dn-axis">{yFmt(v)}</text></g>
      ))}
      {points.length > 1 && (<>
        <path d={`M${x(0)},${y(0)}L${pts.join("L")}L${x(points.length - 1)},${y(0)}Z`} className="dn-fill" opacity=".12" />
        <path d={`M${pts.join("L")}`} className="dn-stroke" fill="none" strokeWidth="2" strokeLinejoin="round" />
      </>)}
      {(xLabels || []).map(([f, l]) => <text key={l} x={x(Math.round(f * (points.length - 1)))} y={h - 8} textAnchor="middle" className="dn-axis">{l}</text>)}
      {unitLabel && <text x={bl + 4} y={bt + 8} className="dn-axis">{unitLabel}</text>}
      {extra && extra({ x, y, right: w - br, left: bl })}
    </svg>
  );
}

/* ───────────────────────── small ui pieces ───────────────────────── */
function Panel({ title, sub, right, className = "", demo, T, children }) {
  return (
    <section className={`dn-panel ${className}`}>
      <div className="dn-ph">
        <div><h2>{title}</h2>{sub && <small className="dn-s2">{sub}</small>}</div>
        <div className="dn-ph-r">{demo && <span className="dn-tag">{T("sample")}</span>}{right}</div>
      </div>
      {children}
    </section>
  );
}
const Pill = ({ kind, icon, children }) => <span className={`dn-pill ${kind}`}>{icon}{children}</span>;
const KV = ({ k, v, cls = "", onClick }) => (
  <div className="dn-kv"><span className={onClick ? "dn-lnk" : ""} onClick={onClick}>{k}</span><b className={cls}>{v}</b></div>
);
const GROUP_COLORS = ["var(--dn-c1)", "var(--dn-c2)", "var(--dn-c3)", "var(--dn-c4)", "var(--dn-c5)"];
function Ring({ pct, size = 140, sw = 11, color = "var(--dn-brand)", children }) {
  const r = 54, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct));
  return (
    <div className="dn-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 140 140" width={size} height={size} aria-hidden="true">
        <circle cx="70" cy="70" r={r} fill="none" className="dn-ring-bg" strokeWidth={sw} />
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 70 70)" />
      </svg>
      <div className="dn-ring-in">{children}</div>
    </div>
  );
}
const Meter = ({ pct, marks = [] }) => (
  <div className="dn-meter"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />{marks.map((m) => <b key={m} style={{ insetInlineStart: `${m}%` }} />)}</div>
);
const Stk = ({ parts }) => <div className="dn-stk">{parts.map((p, i) => <i key={i} style={{ flex: Math.max(p.v, 0.0001), background: p.c }} />)}</div>;
const Seg = ({ options, value, onChange, small }) => (
  <div className={`dn-seg ${small ? "sm" : ""}`}>{options.map(([k, label]) => <button type="button" key={k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{label}</button>)}</div>
);
function HBars({ rows, max, fmt = (v) => v, color }) {
  const m = max || Math.max(...rows.map((r) => r[1]), 1);
  if (!rows.length) return <div className="dn-empty">—</div>;
  return (
    <ul className="dn-hb">
      {rows.map(([n, v, sub]) => (
        <li key={n + (sub || "")}>
          <div className="dn-row"><span>{n}{sub && <small>{sub}</small>}</span><b>{fmt(v)}</b></div>
          <div className="dn-track"><i style={{ width: `${Math.min(100, (v / m) * 100)}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}



/* ───────────────────────── main dashboard page ───────────────────────── */
export default function DashboardNewPage() {
  const { t, language } = useI18n();
  const T = useCallback((k, p) => t("dashNew." + k, p), [t]);
  const navigate = useNavigate();
  const loc = language === "ar" ? "ar" : "en-GB";
  const fmtDT = (d) => new Date(d).toLocaleString(loc, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtD = (d) => new Date(d).toLocaleDateString(loc, { day: "numeric", month: "short" });
  const ago = (sec) => {
    if (!(sec > 0)) return T("live");
    if (sec < 3600) return T("minAgo", { n: Math.max(1, Math.round(sec / 60)) });
    if (sec < 86400) return T("hAgo", { n: Math.round(sec / 3600) });
    return T("dAgo", { n: Math.round(sec / 86400) });
  };

  const { isConnected, systemMetrics, eventsByTopic } = useWebSocket(["alerts", "camera_status", "system_metrics", "dashboard_overview"]);

  const [tab, setTab] = useState("overview");
  const [range, setRange] = useState("today");
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(new Date());
  const [loaded, setLoaded] = useState(false);

  const [summary, setSummary] = useState({ total_cameras: 0, active_streams: 0, alarms_today: 0, cpu: 0, ram: 0, disk: 0, history: { cpu: [] } });
  const [events, setEvents] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [groupsList, setGroupsList] = useState([]);
  const [activeRecorders, setActiveRecorders] = useState([]);
  const [cameraHealth, setCameraHealth] = useState([]);
  const [healthInfo, setHealthInfo] = useState(null);
  const [serverMetrics, setServerMetrics] = useState(null);
  const [storageDiag, setStorageDiag] = useState(null);
  const [bitrateDiag, setBitrateDiag] = useState(null);
  const [bandwidth, setBandwidth] = useState(null);
  const [infraAlerts, setInfraAlerts] = useState(null);
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [hist30, setHist30] = useState(null);
  const [streamHist, setStreamHist] = useState([]);
  const [bitrateFilter, setBitrateFilter] = useState("24h");
  const [isAiActive, setIsAiActive] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [alertActionLoading, setAlertActionLoading] = useState(false);

  // cameras table
  const [camFilter, setCamFilter] = useState("all");
  const [camSearch, setCamSearch] = useState("");
  const [camPage, setCamPage] = useState(1);
  const [restartMsg, setRestartMsg] = useState("");

  // overview & health states
  const [tip, setTip] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sf, setSf] = useState(null);
  const [gPage, setGPage] = useState(1);
  const [showFailed, setShowFailed] = useState(false);
  const secRefs = useRef({});

  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);

  /* ── initial + manual refresh load from backend APIs ── */
  useEffect(() => {
    let off = false;
    (async () => {
      const from30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const to = new Date().toISOString();
      const [sum, ev, cams, grps, status, health, metrics, ch, infra, hist, ai, alts] = await Promise.all([
        safe("/api/dashboard/summary"),
        safe("/api/dashboard/events?limit=100"),
        safe("/api/cameras"),
        safe("/api/groups"),
        safe("/api/recordings/status"),
        safe("/api/health"),
        safe("/api/infrastructure/metrics"),
        safe("/api/camera-health"),
        safe(`/api/infrastructure/alerts?limit=5000&from_date=${from30}&to_date=${to}`),
        safe(`/api/reports/history?from_date=${from30}&to_date=${to}&live_only=false`),
        safe("/api/integrations"),
        safe("/api/alerts?limit=50&status=Active")
      ]);
      if (off) return;
      if (sum) {
        setSummary((p) => {
          const cpuHist = sum.cpu_history && sum.cpu_history.length > 0 
            ? sum.cpu_history 
            : [...(p.history?.cpu || []), sum.cpu].slice(-24);
          return {
            ...p,
            ...sum,
            history: { cpu: cpuHist }
          };
        });
      }
      setEvents(Array.isArray(ev) ? ev : []);
      setCameras(Array.isArray(cams) ? cams : []);
      setGroupsList(Array.isArray(grps) ? grps : []);
      if (status) setActiveRecorders(status.active_recorders || []);
      setHealthInfo(health);
      setServerMetrics(metrics);
      setCameraHealth(Array.isArray(ch) ? ch : []);
      setInfraAlerts(Array.isArray(infra) ? infra : []);
      setHist30(hist && hist.status === "success" && Array.isArray(hist.data) ? hist.data : []);
      setActiveAlerts(alts?.alerts || (Array.isArray(alts) ? alts : []));
      const list = Array.isArray(ai) ? ai : ai?.integrations || [];
      setIsAiActive(list.some((i) => /mirador.?ai|external_ai/i.test(JSON.stringify(i)) && (i.enabled || i.active || i.status === "active")));
      setLoaded(true);
    })();
    return () => { off = true; };
  }, [tick]);

  useEffect(() => {
    let off = false;
    Promise.all([
      safe("/api/storage/diagnostics"),
      safe(`/api/bitrate/diagnostics?filter_type=${bitrateFilter}`),
      safe("/api/cameras/bandwidth")
    ]).then(([s, b, w]) => {
      if (off) return;
      if (s) setStorageDiag(s);
      if (b) setBitrateDiag(b);
      if (w) setBandwidth(w);
    });
    return () => { off = true; };
  }, [bitrateFilter, tick]);

  /* ── websocket live telemetry sync ── */
  useEffect(() => {
    if (!systemMetrics) return;
    setSummary((p) => ({
      ...p,
      cpu: systemMetrics.cpu ?? p.cpu,
      ram: systemMetrics.ram ?? p.ram,
      disk: systemMetrics.disk ?? p.disk,
      history: { cpu: [...(p.history?.cpu || []), systemMetrics.cpu].slice(-24) }
    }));
  }, [systemMetrics]);

  useEffect(() => {
    const env = eventsByTopic.alerts;
    if (env && env.data) {
      setEvents((p) => [env.data, ...p.filter((e) => (e.event_id || e._id || e.id) !== (env.data.event_id || env.data._id || env.data.id))]);
      setActiveAlerts((p) => [env.data, ...p.filter((e) => (e.event_id || e._id || e.id) !== (env.data.event_id || env.data._id || env.data.id))]);
      setSummary((p) => ({ ...p, alarms_today: (p.alarms_today || 0) + 1 }));
    }
  }, [eventsByTopic.alerts]);

  useEffect(() => {
    const env = eventsByTopic.camera_status;
    if (env && env.data) {
      const { ip, status } = env.data;
      setCameras((p) => p.map((c) => (c.ip === ip || c.ip_address === ip ? { ...c, enabled: status === "online" } : c)));
      setCameraHealth((p) => p.map((h) => (h.ip === ip ? { ...h, status: status } : h)));
    }
  }, [eventsByTopic.camera_status]);

  useEffect(() => {
    const list = eventsByTopic["dashboard_overview"];
    if (!list || !list.length) return;
    const d = list[list.length - 1]?.payload;
    if (!d) return;
    if (d.summary) {
      setSummary((p) => ({
        ...p,
        ...d.summary,
        history: { cpu: [...(p.history?.cpu || []), d.summary.cpu ?? p.cpu].slice(-24) }
      }));
    }
    if (d.events) setEvents(d.events);
    if (d.cameras) setCameras(d.cameras);
    if (d.active_recorders) setActiveRecorders(d.active_recorders);
    if (d.camera_health) setCameraHealth(Array.isArray(d.camera_health) ? d.camera_health : []);
    setLoaded(true);
  }, [eventsByTopic["dashboard_overview"]]);

  useEffect(() => {
    if (summary.active_streams != null) {
      setStreamHist((h) => [...h, num(summary.active_streams)].slice(-20));
    }
  }, [summary.active_streams]);

  /* ── real group mapping and fleet normalisation ── */
  const groupMap = useMemo(() => {
    const map = {};
    (groupsList || []).forEach((g) => {
      if (g.id) map[g.id] = g.name;
      if (g._id) map[g._id] = g.name;
    });
    return map;
  }, [groupsList]);

  const getCameraGroup = useCallback((c) => {
    if (c.group_id && groupMap[c.group_id]) return groupMap[c.group_id];
    const g = c.group || c.group_name || c.groupName || c.camera_group || c.location || c.site || c.area || c.zone;
    if (g && String(g).trim()) return String(g).trim();
    if (c.name && String(c.name).includes(",")) return String(c.name).split(",")[0].trim();
    return "Default Group";
  }, [groupMap]);

  const uptimeByName = useMemo(() => {
    const m = {};
    (hist30 || []).forEach((r) => {
      const up = num(r.camera_hours_up), dn = num(r.camera_hours_down);
      if (up + dn > 0) m[r.name || r.ip] = (up / (up + dn)) * 100;
    });
    return m;
  }, [hist30]);

  const realFleet = useMemo(() => {
    const findH = (c) => cameraHealth.find((h) => 
      (c.stream_key && (h.stream === c.stream_key || h.name === c.stream_key)) ||
      (c.name && (h.name === c.name || h.stream === c.name)) ||
      (c.ip && (h.ip === c.ip || (h.stream && h.stream.includes(c.ip.replace(/\./g, "_")))))
    );

    const mk = (c, h) => {
      const isEnabled = c.enabled !== false;
      const streamKey = c.stream_key || c.streamKey || c.ip?.replace(/\./g, "_");
      const isRecording = activeRecorders.includes(streamKey) || 
                          activeRecorders.includes(c.stream_key) || 
                          activeRecorders.includes(c.ip) ||
                          activeRecorders.includes(c.ip?.replace(/\./g, "_"));
      const isStreaming = c.stream_status === "streaming" || c.status === "streaming";
      const hasStreamError = c.stream_status === "error";

      let state = "on";
      let reason = "online";
      
      if (!isEnabled) {
        state = "off";
        reason = "offline";
      } else if (isRecording || isStreaming) {
        if (hasStreamError && !isRecording) {
          state = "issue";
          reason = "lowFps";
        } else if (h && h.fps && h.fps < 10 && h.fps > 0) {
          state = "issue";
          reason = "lowFps";
        } else {
          state = "on";
          reason = "online";
        }
      } else if (hasStreamError) {
        state = "issue";
        reason = "noSignal";
      } else if (h && (h.status === "online" || (h.fps && h.fps > 0))) {
        state = (h.fps && h.fps < 10) ? "issue" : "on";
        reason = (h.fps && h.fps < 10) ? "lowFps" : "online";
      } else if (c.status === "offline" || (h && h.status === "offline" && !isRecording && !isStreaming)) {
        state = "off";
        reason = "offline";
      } else {
        state = "on";
        reason = "online";
      }

      const ts = h?.timestamp ? (Date.now() - parseTs(h.timestamp)) / 1000 : 0;
      const prof = c.stream_profiles && c.stream_profiles[0] ? c.stream_profiles[0] : null;
      const fpsVal = h?.fps ? `${h.fps} fps` : prof?.fps ? `${prof.fps} fps` : "25 fps";
      const resVal = h?.resolution || prof?.resolution || "1080p";
      const streamText = state === "off" ? T("noSignal") : `${resVal}, ${fpsVal}`;
      const bitrateMbps = h && h.bitrate > 0 
        ? Number((h.bitrate / 1024).toFixed(1)) 
        : prof && prof.bitrate > 0 
          ? Number((prof.bitrate / 1024).toFixed(1)) 
          : (state === "on" ? 4.0 : 0);

      return {
        name: c.name || c.device_name || c.camera_name || h?.name || c.ip || "Camera",
        ip: c.ip || c.ip_address || h?.ip || "",
        group: getCameraGroup(c),
        state,
        reason,
        stream: streamText,
        bitrate: bitrateMbps,
        uptime: uptimeByName[c.name] ?? uptimeByName[c.ip] ?? (state === "on" ? 99.8 : 0),
        lastSeen: state === "on" ? 0 : Math.max(0, ts),
        stream_key: streamKey || c.id || c.ip,
        raw: c,
      };
    };

    let list = cameras.map((c) => mk(c, findH(c)));
    if (!list.length && cameraHealth.length) {
      list = cameraHealth.map((h) => mk(h, h));
    }
    return list;
  }, [cameras, cameraHealth, activeRecorders, uptimeByName, getCameraGroup, T]);

  const fleet = realFleet;
  const nOn = fleet.filter((f) => f.state === "on").length;
  const nIssue = fleet.filter((f) => f.state === "issue").length;
  const nOff = fleet.filter((f) => f.state === "off").length;
  const nTotal = fleet.length || num(summary.total_cameras);
  
  const recOf = realFleet.filter((f) => 
    activeRecorders.includes(f.stream_key) || 
    activeRecorders.includes(f.raw?.stream_key) || 
    activeRecorders.includes(f.ip) ||
    activeRecorders.includes(f.ip?.replace(/\./g, "_"))
  ).length;

  const failedList = realFleet.filter((f) => 
    f.raw?.enabled !== false && 
    !activeRecorders.includes(f.stream_key) && 
    !activeRecorders.includes(f.raw?.stream_key) && 
    !activeRecorders.includes(f.ip) &&
    !activeRecorders.includes(f.ip?.replace(/\./g, "_"))
  );
  const failedN = failedList.length;

  const groups = useMemo(() => {
    const m = new Map();
    fleet.forEach((f) => { 
      if (sf && f.state !== sf) return; 
      if (!m.has(f.group)) m.set(f.group, []); 
      m.get(f.group).push(f); 
    });
    return [...m.entries()];
  }, [fleet, sf]);

  const G_PER = 4;
  const gPages = Math.max(1, Math.ceil(groups.length / G_PER));
  const gp = Math.min(gPage, gPages);
  const pagedGroups = groups.slice((gp - 1) * G_PER, gp * G_PER);

  /* ── real overview values ── */
  const cpu = num(summary.cpu);
  const ram = num(summary.ram);
  const cpuHist = summary.history?.cpu?.length > 1 
    ? summary.history.cpu 
    : (summary.cpu_history?.length > 1 ? summary.cpu_history : [cpu, cpu]);

  const usedTB = (num(storageDiag?.used_gb) || (num(summary.disk) ? (num(summary.disk) / 100) * 1024 : 0)) / 1024;
  const rawTotalTB = (num(storageDiag?.total_gb) || 1024) / 1024;
  const totalTB = Math.max(usedTB, rawTotalTB);
  const freeTB = (num(storageDiag?.free_gb) || Math.max(0, (totalTB - usedTB) * 1024)) / 1024;
  const diskPct = num(storageDiag?.usage_pct) || num(summary.disk) || (totalTB > 0 ? (usedTB / totalTB) * 100 : 0);
  const retentionDays = storageDiag?.retention_days != null ? Math.round(storageDiag.retention_days) : null;

  const alarms = num(summary.alarms_today);
  const hours = useMemo(() => {
    if (summary.hourly_alarms && Array.isArray(summary.hourly_alarms)) {
      return summary.hourly_alarms;
    }
    const today = dayKey(new Date());
    const arr = Array(new Date().getHours() + 1).fill(0);
    events.forEach((e) => {
      const ts = parseTs(e.timestamp || e.received_at || e.time || e.created_at || e.event_time);
      if (!isNaN(ts) && dayKey(new Date(ts)) === today) {
        const h = new Date(ts).getHours();
        if (h < arr.length) arr[h]++;
      }
    });
    return arr;
  }, [summary.hourly_alarms, events]);

  const attention = useMemo(() => {
    const list = [];
    (summary.alerts || []).forEach((a, i) => {
      list.push({ kind: "crit", reason: "systemAlert", name: a, ago: 0, id: `sys-${i}` });
    });
    fleet.filter((f) => f.state !== "on").forEach((f) => {
      list.push({ kind: f.state === "off" ? "crit" : "warn", reason: f.reason, name: f.name, ago: f.lastSeen, id: `cam-${f.ip}` });
    });
    (activeAlerts || []).forEach((a) => {
      const isCrit = /intrusion|offline|fire|gun|tamper/i.test(a.type || a.scenario || "");
      list.push({
        kind: isCrit ? "crit" : "warn",
        reason: a.type || a.scenario || "Alert",
        name: a.camera_name || a.ip || "Camera",
        ago: a.received_at ? Math.max(0, (Date.now() - parseTs(a.received_at)) / 1000) : 0,
        raw: a,
        id: a.id || a._id
      });
    });
    return list.slice(0, 8);
  }, [summary.alerts, fleet, activeAlerts]);
  const attentionN = attention.length;

  const rangeDays = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const nameByIp = useCallback((ip) => {
    const c = cameras.find((x) => x.ip === ip || x.ip_address === ip);
    return c?.name || c?.device_name || ip;
  }, [cameras]);

  const offEvents = useMemo(() => 
    (infraAlerts || []).filter((a) => 
      a.event === "device_offline" && (!a.type || String(a.type).toLowerCase() === "camera")
    ), 
    [infraAlerts]
  );

  const outages = useMemo(() => {
    const since = Date.now() - Math.max(rangeDays, range === "today" ? 7 : rangeDays) * 86400000;
    const m = {};
    offEvents.filter((a) => parseTs(a.timestamp) >= since).forEach((a) => {
      const n = nameByIp(a.ip) || a.model || a.ip || "—";
      m[n] = (m[n] || 0) + 1;
    });
    return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [offEvents, range, rangeDays, nameByIp]);

  /* ── health & diagnostics values ── */
  const bd = useMemo(() => {
    if (bitrateDiag && bitrateDiag.trend_data && bitrateDiag.trend_data.length > 0) {
      return bitrateDiag;
    }
    const liveBitrates = cameraHealth.map((h) => num(h.bitrate) / 1024).filter((b) => b > 0);
    const curr = Number(liveBitrates.reduce((sum, b) => sum + b, 0).toFixed(1));
    return {
      current_bitrate: curr,
      avg_bitrate: curr,
      peak_bitrate: curr,
      trend_data: curr > 0 ? [{ timestamp: "Now", bitrate_mbps: curr }] : []
    };
  }, [bitrateDiag, cameraHealth]);

  const bwd = useMemo(() => {
    if (bandwidth && bandwidth.top_cameras && bandwidth.top_cameras.length > 0) {
      return bandwidth;
    }
    const withBitrate = cameraHealth
      .map((h) => ({
        name: h.name || h.stream || h.ip,
        ip: h.ip,
        bitrate: Number((num(h.bitrate) / 1024).toFixed(1))
      }))
      .filter((c) => c.bitrate > 0)
      .sort((a, b) => b.bitrate - a.bitrate);

    const total = withBitrate.reduce((sum, c) => sum + c.bitrate, 0);
    const top_cameras = withBitrate.slice(0, 5).map((c) => ({
      ...c,
      percentage: total > 0 ? Number(((c.bitrate / total) * 100).toFixed(1)) : 0
    }));

    return {
      total_bandwidth: Number(total.toFixed(1)),
      top_cameras
    };
  }, [bandwidth, cameraHealth]);

  const hi = healthInfo || { status: summary.status || "Healthy", version: "1.0.0" };
  const sm = serverMetrics || {};

  const camRows = useMemo(() => {
    const order = { off: 0, issue: 1, on: 2 };
    const q = camSearch.trim().toLowerCase();
    return [...fleet].sort((a, b) => order[a.state] - order[b.state])
      .filter((f) => (camFilter === "all" || f.state === camFilter) && (!q || `${f.name} ${f.ip} ${f.group}`.toLowerCase().includes(q)));
  }, [fleet, camFilter, camSearch]);
  const camPages = Math.max(1, Math.ceil(camRows.length / CAM_PAGE));
  useEffect(() => { setCamPage(1); }, [camFilter, camSearch]);

  const trendPoints = useMemo(() => {
    if (storageDiag?.trend_history && storageDiag.trend_history.length > 0) {
      return storageDiag.trend_history.map((p) => ({ v: num(p.used_gb) / 1024, ts: p.timestamp }));
    }
    return [{ v: usedTB, ts: new Date().toISOString() }];
  }, [storageDiag, usedTB]);

  const addedTB = trendPoints.length > 1 ? trendPoints[trendPoints.length - 1].v - trendPoints[0].v : 0;
  const fullDate = storageDiag?.predicted_exhaustion_date ? new Date(storageDiag.predicted_exhaustion_date) : null;

  /* ── camera restart action ── */
  const restartCamera = async (cam) => {
    const ipRaw = cam.ip;
    if (!ipRaw) return;
    const ip = encodeURIComponent(ipRaw);
    const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
    const raw = cam.raw || {};
    try {
      if (raw.assigned_schedule_id && String(raw.assigned_schedule_id).toLowerCase() === "never") {
        await fetch(`${API_BASE}/api/recordings/assign-schedule`, {
          method: "POST",
          headers,
          body: JSON.stringify({ camera_id: raw.id || raw.stream_key || ipRaw, schedule_id: "Always", motion_only: !!raw.motion_only })
        }).catch(() => {});
      }
      await fetch(`${API_BASE}/api/cameras/by-ip/${ip}/disable`, { method: "POST", headers });
      await new Promise((r) => setTimeout(r, 1500));
      await fetch(`${API_BASE}/api/cameras/by-ip/${ip}/enable`, { method: "POST", headers });
      setRestartMsg(T("restartSent", { name: cam.name }));
    } catch { 
      setRestartMsg(T("restartFailed")); 
    }
  };

  /* ── alert status update action (referring to dashboard_router.py) ── */
  const updateAlertStatus = async (alertId, newStatus, note = "") => {
    if (!alertId) return;
    setAlertActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/alerts/${encodeURIComponent(alertId)}/status`, {
        method: "PUT",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status: newStatus,
          action: newStatus,
          note
        })
      });
      if (res.ok) {
        setActiveAlerts((prev) => prev.filter((a) => (a.id || a._id) !== alertId));
        if (selectedAlert && (selectedAlert.id === alertId || selectedAlert._id === alertId)) {
          setSelectedAlert(null);
        }
      }
    } catch (err) {
      console.error("Failed to update alert status:", err);
    } finally {
      setAlertActionLoading(false);
    }
  };



  /* ───────────────────────── render: overview tab ───────────────────────── */
  const Overview = (
    <div className="dn-grid">
      <Panel T={T} className="c8" title={T("cameraFleet")}
        right={<div className="dn-legend">{[["on", "st.online", null], ["issue", "st.issue", <I16 key="i"><path d="M8 4v5" /><circle cx="8" cy="11.8" r=".4" /></I16>], ["off", "st.offline", <I16 key="o"><path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4" /></I16>]].map(([k, lbl, ic]) => (
          <button key={k} type="button" className={`dn-lg ${sf === k ? "act" : ""} ${sf && sf !== k ? "dim" : ""}`} aria-pressed={sf === k} onClick={() => { setSf(sf === k ? null : k); setGPage(1); }}><i className={`dn-sq ${k} sm`}>{ic}</i>{T(lbl)}<b>{k === "on" ? nOn : k === "issue" ? nIssue : nOff}</b></button>
        ))}</div>}>
        <div className="dn-fleet">
          <div className="dn-ftop">
            <div className="dn-m t1">
              <div>
                <div className="k">{T("camerasOnline")}</div>
                <div className="v">{nOn} <u>{T("ofN", { n: nTotal })}</u></div>
                <div className="dn-fl">
                  <span><i style={{ background: "var(--dn-warn)" }} /><b>{nIssue}</b>{T("streamIssues")}</span>
                  <span><i style={{ background: "var(--dn-crit)" }} /><b>{nOff}</b>{T("offline")}</span>
                  <span><i style={{ background: "var(--dn-ok-fill)" }} /><b>{recOf}</b>{T("recordingLc")}</span>
                </div>
              </div>
              <Stk parts={[{ v: nOn, c: "var(--dn-ok-fill)" }, { v: nIssue, c: "var(--dn-warn)" }, { v: nOff, c: "var(--dn-crit)" }]} />
            </div>
            <div className="dn-m t2">
              <div>
                <div className="k">{T("alarmsToday")}</div>
                <div className="v">{alarms}</div>
                <div className="n">{T("criticalN", { n: events.filter((e) => /intrusion|offline|error|tamper|alarm/i.test(e.event_type || e.type || e.scenario || "")).length })}</div>
              </div>
              <Spark values={hours.length > 1 ? hours : [0, 0]} w={300} h={40} />
            </div>
            <div className="dn-m t3">
              <div>
                <div className="k">{T("storageUsed")}</div>
                <div className="v">{usedTB.toFixed(1)} <u>{T("ofTB", { n: totalTB.toFixed(1) })}</u></div>
                <div className="dn-ret">
                  <span>{T("estRetention")}</span>
                  <b>{retentionDays != null ? `${retentionDays} ${T("days")}` : T("calculating")}</b>
                </div>
              </div>
              <div className="dn-pb"><i style={{ width: `${Math.min(100, diskPct)}%` }} /></div>
            </div>
          </div>
          <div className="dn-mx">
            {groups.length === 0 && (
              <div className="dn-empty ok">
                {cameras.length === 0 ? "No cameras configured yet." : "No cameras match current filter."}
                {cameras.length === 0 && (
                  <div style={{ marginTop: "12px" }}>
                    <button type="button" className="dn-btn pri sm" onClick={() => navigate("/add-devices")}>
                      Add Cameras
                    </button>
                  </div>
                )}
              </div>
            )}
            {pagedGroups.map(([g, list]) => {
              const isOpen = !collapsed.has(g);
              const cnt = (st) => list.filter((f) => f.state === st).length;
              return (
                <div key={g} className={`dn-grp ${isOpen ? "open" : ""}`}>
                  <button type="button" className="dn-grp-h" aria-expanded={isOpen}
                    onClick={() => setCollapsed((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; })}>
                    <span className="dn-grp-t"><i className="dn-chev"><IcChev /></i><i className="dn-gdot" style={{ background: GROUP_COLORS[Math.max(0, groups.findIndex(([x]) => x === g)) % 5] }} />{g}</span>
                    <em>{T("camerasN", { n: list.length })}</em>
                  </button>
                  {isOpen ? (
                    <div className="dn-sqs">
                      {list.map((f, i) => (
                        <i key={i} className={`dn-sq ${f.state}`}
                          onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: r.left + r.width / 2, y: r.top, f }); }}
                          onMouseLeave={() => setTip(null)}>
                          {f.state === "issue" && <I16><path d="M8 4v5" /><circle cx="8" cy="11.8" r=".4" /></I16>}
                          {f.state === "off" && <I16><path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4" /></I16>}
                        </i>
                      ))}
                    </div>
                  ) : (
                    <div className="dn-grp-sum"><span><i className="dn-sq on sm" />{cnt("on")}</span>{cnt("issue") > 0 && <span><i className="dn-sq issue sm" />{cnt("issue")}</span>}{cnt("off") > 0 && <span><i className="dn-sq off sm" />{cnt("off")}</span>}</div>
                  )}
                </div>
              );
            })}
          </div>
          {gPages > 1 && (
            <nav className="dn-gpg" aria-label="Groups">
              <button type="button" className="dn-gpb" disabled={gp <= 1} onClick={() => setGPage(gp - 1)} aria-label="Previous"><IcChev /></button>
              {Array.from({ length: gPages }, (_, i) => <button type="button" key={i} className={`dn-gpd ${gp === i + 1 ? "on" : ""}`} onClick={() => setGPage(i + 1)} aria-label={`${i + 1}`} aria-current={gp === i + 1} />)}
              <button type="button" className="dn-gpb nx" disabled={gp >= gPages} onClick={() => setGPage(gp + 1)} aria-label="Next"><IcChev /></button>
            </nav>
          )}
        </div>
      </Panel>

      <Panel T={T} className="c4" title={T("systemHealth")} sub={null} right={<small className="dn-s2 inl">{T("thisServer")}</small>}>
        <div className="dn-hrow"><div className="dn-hh"><span>CPU</span><span className="p">{Math.round(cpu)}%</span></div><AreaFlat values={cpuHist} /><div className={`dn-st ${cpu > 85 ? "crit" : cpu > 60 ? "warn" : "good"}`}>{cpu > 85 ? <IcCrit /> : cpu > 60 ? <IcWarn /> : <IcOk />}{cpu > 85 ? T("critical") : cpu > 60 ? T("highAbove", { n: 60 }) : T("normal")}</div></div>
        <div className="dn-hrow"><div className="dn-hh"><span>{T("memory")}</span><span className="p">{Math.round(ram)}%</span></div><Meter pct={ram} marks={[60, 85]} /><div className={`dn-st ${ram > 85 ? "crit" : ram > 60 ? "warn" : "good"}`}>{ram > 60 ? <IcWarn /> : <IcOk />}{ram > 85 ? T("critical") : ram > 60 ? T("highAbove", { n: 60 }) : T("normal")}</div></div>
        <div className="dn-hrow"><div className="dn-hh"><span>{T("disk")}</span><span className="p">{Math.round(diskPct)}%</span></div><Meter pct={diskPct} marks={[80, 90]} /><div className={`dn-st ${diskPct > 90 ? "crit" : diskPct > 80 ? "warn" : "good"}`}>{diskPct > 90 ? <IcCrit /> : diskPct > 80 ? <IcWarn /> : <IcOk />}{diskPct > 90 ? `${T("critical")}, ${freeTB.toFixed(1)} TB free` : diskPct > 80 ? `${T("highAbove", { n: 80 })}, ${freeTB.toFixed(1)} TB free` : T("normalFree", { n: freeTB.toFixed(1) })}</div></div>
      </Panel>

      <Panel T={T} className="c6" title={T("needsAttention")} sub={null} right={<small className="dn-s2 inl">{T("openN", { n: attentionN })}</small>}>
        {attention.length === 0 ? <div className="dn-empty ok">{T("nothingAttention")}</div> : (
          <ul className="dn-al">
            {attention.map((a, i) => (
              <li key={a.id || i} onClick={() => a.raw && setSelectedAlert(a)}>
                <span className={`dn-ai ${a.kind}`}>{KIND_ICON[a.kind]}</span>
                <div>
                  <b>{a.reason === "offline" ? T("camOffline") : a.reason === "lowFps" ? T("streamDegraded", { why: T("reason.lowFps") }) : a.reason}</b>
                  <small>{a.name}</small>
                </div>
                <time>{ago(a.ago)}</time>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="dn-link" onClick={() => setTab("health")}>{T("viewAllAlerts")}</button>
      </Panel>

      <Panel T={T} className="c6" title={T("frequentOutages")} sub={null} right={<small className="dn-s2 inl">{T("offlineEventsRange", { n: range === "today" ? 7 : rangeDays })}</small>}>
        {outages.length === 0 ? <div className="dn-empty ok">{T("noOutages")}</div> : <HBars rows={outages.map((o) => [o.name, o.count])} />}
      </Panel>
    </div>
  );

  /* ───────────────────────── render: health & storage tab ───────────────────────── */
  const availPct = nTotal ? (nOn / nTotal) * 100 : 100;
  const recPct = nTotal ? (recOf / nTotal) * 100 : 100;
  const serverOk = String(hi.status || summary.status || "").toLowerCase() === "ok" || String(hi.status || summary.status || "").toLowerCase() === "healthy";
  const storagePts = Math.min(100, Math.max(0, (100 - diskPct) * 2));
  const healthScore = Math.round(0.35 * availPct + 0.3 * recPct + 0.2 * storagePts + 0.15 * (serverOk ? 100 : 40));
  const scoreColor = healthScore >= 85 ? "var(--dn-ok)" : healthScore >= 60 ? "var(--dn-warn)" : "var(--dn-crit-t)";
  const areasN = [nOff + nIssue > 0, failedN > 0, diskPct > 80, !serverOk].filter(Boolean).length;
  const camSt = nOn === 0 && nTotal > 0 ? "bad" : nOff + nIssue > 0 ? "warn" : "ok";
  const strSt = nIssue > 0 ? "warn" : "ok";
  const recSt = recOf === 0 && nTotal > 0 ? "bad" : failedN > 0 ? "warn" : "ok";
  const stoSt = diskPct > 90 ? "bad" : diskPct > 80 ? "warn" : "ok";
  const failedNames = failedList.map((c) => c.name);
  const restartAll = async () => { for (const c of failedList) await restartCamera(c); };

  const groupShare = useMemo(() => {
    const m = new Map();
    fleet.forEach((f) => m.set(f.group, (m.get(f.group) || 0) + (Number(f.bitrate) > 0 ? Number(f.bitrate) : 1)));
    let arr = [...m.entries()];
    arr.sort((a, b) => b[1] - a[1]);
    const total = arr.reduce((t, [, v]) => t + v, 0) || 1;
    const top = arr.slice(0, 5).map(([g, v], i) => ({ g, tb: (usedTB * v) / total, pct: (v / total) * 100, c: GROUP_COLORS[i % 5] }));
    const rest = arr.slice(5).reduce((t, [, v]) => t + v, 0);
    if (rest > 0) top.push({ g: T("otherGroups"), tb: (usedTB * rest) / total, pct: (rest / total) * 100, c: "var(--dn-line2)" });
    return top;
  }, [fleet, usedTB, T]);

  const bwTotal = Math.max(num(bwd.total_bandwidth), 1);
  const bwTop = bwd.top_cameras.slice(0, 5);
  const bwOther = Math.max(0, bwTotal - bwTop.reduce((t, c) => t + num(c.bitrate), 0));

  const Health = (
    <div className="dn-grid">
      <section className="dn-panel dn-hero c12">
        <div className="dn-score">
          <Ring pct={healthScore} color={scoreColor}><b>{healthScore}</b></Ring>
          <div>
            <h2>{T("overallHealth")}</h2>
            <small className="dn-s2">{T("overallSub")}</small>
            <div className={`dn-areas ${areasN ? "warn" : "ok"}`}>{areasN ? <><IcWarn />{T("areasNeed", { n: areasN })}</> : <><IcOk />{T("allHealthy")}</>}</div>
          </div>
        </div>
        <div className="dn-pipe">
          <div className={`dn-node ${camSt}`}><div className="t"><span>{T("pipeCameras")}</span><i className="dn-sdot" /></div><div className="v">{nOn} <u>{T("ofOnline", { n: nTotal })}</u></div><div className="n">{T("offIssues", { off: nOff, iss: nIssue })}</div></div>
          <div className={`dn-node ${strSt}`}><div className="t"><span>{T("pipeStreams")}</span><i className="dn-sdot" /></div><div className="v">{bd.current_bitrate} <u>Mbps</u></div><div className="n">{T("peakAvg", { p: bd.peak_bitrate, a: bd.avg_bitrate })}</div></div>
          <div className={`dn-node ${recSt}`}><div className="t"><span>{T("pipeRecorder")}</span><i className="dn-sdot" /></div><div className="v">{recOf} <u>{T("ofRecording", { n: nTotal })}</u></div><div className="n">{recOf > 0 ? T("running") : T("stopped")}</div></div>
          <div className={`dn-node ${stoSt}`}><div className="t"><span>{T("pipeStorage")}</span><i className="dn-sdot" /></div><div className="v">{Math.round(diskPct)}% <u>{T("usedLc")}</u></div><div className="n">{retentionDays != null ? T("retentionLeft", { n: retentionDays }) : T("calculating")}</div></div>
        </div>
        <div className="dn-srv">
          <span>{T("serverUptime")}<b>{sm.uptime ?? "—"}</b></span>
          <span>{T("appVersion")}<b>v{hi.version ?? "1.0.0"}</b></span>
          <span>{T("backendStatus")}<b className={serverOk ? "good" : "bad"}>{serverOk ? T("healthy") : String(hi.status || summary.status)}</b></span>
          <span className="sp"><Pill kind={serverOk ? "good" : "warn"} icon={<IcOk />}>API</Pill>{hi.watchdog && <Pill kind="good" icon={<IcOk />}>{T("watchdog")}: {hi.watchdog}</Pill>}<Pill kind="good" icon={<IcOk />}>{T("database")}</Pill><Pill kind="good" icon={<IcOk />}>{T("streamer")}</Pill></span>
        </div>
      </section>

      {failedN > 0 && (
        <div className="c12" ref={(el) => { secRefs.current.failed = el; }}>
          <div className="dn-alertbar">
            <span className="dn-ai crit"><IcCrit /></span>
            <div className="tx"><h2>{T("notRecordingN", { n: failedN })}</h2><small className="dn-s2">{T("failedSub")}</small></div>
            <div className="dn-cchips">{failedNames.slice(0, 4).map((n, i) => <span key={i}>{n}</span>)}{failedNames.length > 4 && <span>+{failedNames.length - 4}</span>}</div>
            <button type="button" className="dn-btn" onClick={() => setShowFailed(!showFailed)}>{showFailed ? T("hideList") : T("viewList")}</button>
            <button type="button" className="dn-btn pri" onClick={restartAll}>{T("restartAll")}</button>
          </div>
          {restartMsg && <div className="dn-note">{restartMsg}</div>}
          {showFailed && (
            <section className="dn-panel" style={{ marginTop: "calc(14 * var(--u))" }}>
              <ul className="dn-al">
                {failedList.map((c, i) => (<li key={i}><span className="dn-ai crit"><IcCrit /></span><div><b>{c.name}</b><small>{c.ip}</small></div><button type="button" className="dn-btn sm" onClick={() => restartCamera(c)}>{T("restart")}</button></li>))}
              </ul>
            </section>
          )}
        </div>
      )}

      <Panel T={T} className="c8" title={T("storageGrowth")} sub={T("storageGrowthSub")}>
        <div className="dn-stat3 colr"><div>{T("avgPerDay")}<b>{storageDiag?.avg_daily_consumption != null ? storageDiag.avg_daily_consumption : "—"}<u>GB</u></b></div><div>{T("addedInPeriod")}<b>{addedTB.toFixed(1)}<u>TB</u></b></div><div className="w">{T("predictedFull")}<b>{fullDate ? fmtD(fullDate) : "—"}</b></div></div>
        <TrendChart points={trendPoints} w={760} h={250} reserve={fullDate ? 0.48 : 0} yTicks={[0, 5, 10, 15, 20].map((v) => Math.round((totalTB * v) / 20))} yFmt={(v) => `${v} TB`}
          extra={({ x, y, right, left }) => {
            const n = trendPoints.length, last = n ? trendPoints[n - 1] : null;
            return (<>
              <line x1={left} x2={right} y1={y(totalTB)} y2={y(totalTB)} className="dn-capline" />
              <text x={left + 6} y={y(totalTB) + 16} className="dn-axis dn-warn-t">{T("capacityN", { n: totalTB.toFixed(1) })}</text>
              {last && <circle cx={x(n - 1)} cy={y(last.v)} r="4" className="dn-fill dn-halo" />}
              {last && <text x={x(n - 1) - 10} y={y(last.v) - 10} textAnchor="end" className="dn-peak">{T("tbToday", { n: last.v.toFixed(1) })}</text>}
              {last && fullDate && <><line x1={x(n - 1)} y1={y(last.v)} x2={right} y2={y(totalTB)} className="dn-stroke dn-proj" />
                <circle cx={right} cy={y(totalTB)} r="4" className="dn-hollow" />
                <text x={right + 2} y={y(totalTB) + 44} textAnchor="end" className="dn-peak">{T("fullOn", { d: fmtD(fullDate) })}</text></>}
              {n > 0 && <text x={left} y={242} className="dn-axis">{fmtD(trendPoints[0].ts)}</text>}
              {last && <text x={x(n - 1)} y={242} textAnchor="middle" className="dn-axis">{T("today")}</text>}
              {fullDate && <text x={right} y={242} textAnchor="end" className="dn-axis">{fmtD(fullDate)}</text>}
            </>);
          }} />
      </Panel>

      <Panel T={T} className="c4" title={T("spaceGoes")} sub={T("spaceGoesSub", { n: usedTB.toFixed(1) })}>
        <div className="dn-share">{groupShare.map((g, i) => <i key={i} style={{ width: `${g.pct}%`, background: g.c }} title={g.g} />)}</div>
        <ul className="dn-lg2">{groupShare.map((g, i) => <li key={i}><span style={{ background: g.c }} />{g.g}<b>{g.tb.toFixed(1)} TB</b></li>)}</ul>
        <div className="dn-ret2">
          <Ring pct={Math.min(100, ((retentionDays || 0) / 60) * 100)} size={92} sw={13} color="var(--dn-c2)"><b>{retentionDays != null ? retentionDays : "—"}</b></Ring>
          <div><h3>{T("daysRetention")}</h3><small className="dn-s2">{T("retentionNote", { total: totalTB.toFixed(1), free: freeTB.toFixed(1) })}</small></div>
        </div>
        {storageDiag?.warning_status && <div className="dn-note crit">{T("storageWarn")}</div>}
      </Panel>

      <Panel T={T} className="c6" title={T("bitrateTrend")} sub={T("totalStreamBw")}
        right={<Seg small options={[["1h", "1 h"], ["24h", "24 h"], ["7d", "7 d"]]} value={bitrateFilter} onChange={setBitrateFilter} />}>
        <div className="dn-stat3 colr"><div>{T("current")}<b>{bd.current_bitrate}<u>Mbps</u></b></div><div>{T("average")}<b>{bd.avg_bitrate}<u>Mbps</u></b></div><div>{T("peak")}<b>{bd.peak_bitrate}<u>Mbps</u></b></div></div>
        <TrendChart points={bd.trend_data.map((p) => ({ v: num(p.bitrate_mbps), ts: p.timestamp }))} unitLabel="Mbps"
          yTicks={(() => { const m = Math.max(50, Math.ceil(Math.max(...bd.trend_data.map((p) => num(p.bitrate_mbps)), 1) / 50) * 50); return [0, m / 4, m / 2, (m * 3) / 4, m]; })()}
          xLabels={[[0, (bd.trend_data[0] ? new Date(bd.trend_data[0].timestamp).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }) : "")], [1, T("now")]]} />
      </Panel>
      <Panel T={T} className="c6" title={T("bandwidthConsumers")} sub={T("topByBitrate")} right={<small className="dn-s2 inl">{T("shareOf", { n: bwd.total_bandwidth })}</small>}>
        <div className="dn-share tall">{bwTop.map((c, i) => <i key={i} style={{ width: `${(num(c.bitrate) / bwTotal) * 100}%`, background: GROUP_COLORS[i % 5] }} />)}{bwOther > 0 && <i style={{ width: `${(bwOther / bwTotal) * 100}%`, background: "var(--dn-line2)" }} />}</div>
        <ul className="dn-hb dn-click colr">
          {bwTop.map((c, i) => {
            const nm = cameras.find((x) => x.ip === c.ip || x.ip_address === c.ip || (c.id && (x.id === c.id || x._id === c.id)))?.name || c.name;
            const mx = Math.max(...bwTop.map((x) => num(x.bitrate)), 1);
            return (<li key={i} onClick={() => navigate("/cameras")}><div className="dn-row"><span><i className="dn-cdot" style={{ background: GROUP_COLORS[i % 5] }} />{nm}<small>{c.ip}</small></span><b>{c.bitrate} Mbps</b></div><div className="dn-track"><i style={{ width: `${(num(c.bitrate) / mx) * 100}%`, background: GROUP_COLORS[i % 5] }} /></div></li>);
          })}
        </ul>
      </Panel>

      <Panel T={T} className="c12" title={T("cameraHealthMon")} sub={T("problemsFirst")}
        right={<div className="dn-cp"><div className="dn-chips">
          {[["all", T("allN", { n: nTotal })], ["on", T("nOnline", { n: nOn })], ["issue", T("nIssues", { n: nIssue })], ["off", T("nOffline", { n: nOff })]].map(([k, l]) => <button type="button" key={k} className={`dn-chip st-${k} ${camFilter === k ? "on" : ""}`} onClick={() => { setCamFilter(camFilter === k || k === "all" ? "all" : k); setCamPage(1); }}>{l}</button>)}
        </div><label className="dn-srch"><IcSearch /><input value={camSearch} onChange={(e) => setCamSearch(e.target.value)} placeholder={T("searchCameras")} /></label></div>}>
        <div className="dn-scroll">
          <table className="dn-tbl">
            <thead><tr><th>{T("camera")}</th><th>{T("group")}</th><th>{T("status")}</th><th>{T("stream")}</th><th>{T("bitrate")}</th><th>{T("uptime30")}</th><th className="r">{T("lastSeen")}</th></tr></thead>
            <tbody>
              {camRows.length === 0 && <tr><td colSpan={7} className="dn-empty">{T("noCameras")}</td></tr>}
              {camRows.slice((camPage - 1) * CAM_PAGE, camPage * CAM_PAGE).map((f, i) => (
                <tr key={f.ip + i}>
                  <td><b>{f.name}</b><small>{f.ip}</small></td><td><span className="dn-gtag"><i style={{ background: GROUP_COLORS[Math.max(0, groups.findIndex(([g]) => g === f.group)) % 5] }} />{f.group}</span></td>
                  <td><Pill kind={f.state === "on" ? "good" : f.state === "issue" ? "warn" : "crit"} icon={f.state === "on" ? <IcOk /> : f.state === "issue" ? <IcWarn /> : <IcCrit />}>{f.state === "on" ? T("st.online") : f.state === "off" ? T("st.offline") : T("reason." + f.reason)}</Pill></td>
                  <td>{f.state === "off" ? T("noSignal") : f.stream || "—"}</td>
                  <td>{f.bitrate > 0 ? `${Number(f.bitrate).toFixed(1)} Mbps` : T("none")}</td>
                  <td>{f.uptime != null ? <span className="dn-up"><span className="dn-track thin"><i className={f.uptime >= 99 ? "g" : f.uptime >= 97 ? "y" : "r"} style={{ width: `${Math.min(100, Number(f.uptime))}%` }} /></span><b>{Number(f.uptime).toFixed(1)}%</b></span> : "—"}</td>
                  <td className="r muted">{ago(f.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="dn-foot"><span>{T("showingN", { n: Math.min(CAM_PAGE, camRows.length), total: camRows.length })}</span>
          <span className="dn-pager"><button type="button" className="dn-btn sm" disabled={camPage <= 1} onClick={() => setCamPage(camPage - 1)}>‹</button>{T("pageOf", { n: camPage, total: camPages })}<button type="button" className="dn-btn sm" disabled={camPage >= camPages} onClick={() => setCamPage(camPage + 1)}>›</button></span></div>
      </Panel>
    </div>
  );

  return (
    <div className="dn-page">
      <div className="dn-hd">
        <div>
          <h1>{T("title")}</h1>
        </div>
        <div className="dn-ctl">
          <span>{T("updated", { time: now.toLocaleTimeString(loc) })}</span>
          {!isConnected && <em className="dn-offline">{T("wsOffline")}</em>}
          <button type="button" className="dn-btn" onClick={() => setTick((x) => x + 1)}><IcRefresh />{T("refresh")}</button>
        </div>
      </div>
      <nav className="dn-tabs" role="tablist">
        {["overview", "health"].map((k) => (
          <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {T("tab." + k)}
          </button>
        ))}
      </nav>
      {!loaded && tab === "overview" && <div className="dn-loadbar" />}
      {tab === "overview" ? Overview : Health}
      
      {tip && tab === "overview" && (
        <div className="dn-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.f.name}</b>
          {tip.f.ip && <span>{tip.f.ip}</span>}
          <em className={tip.f.state}>{tip.f.state === "on" ? T("st.online") : tip.f.state === "off" ? T("st.offline") : T("reason." + tip.f.reason)}</em>
        </div>
      )}

      {/* Alert Detail Modal (connected to dashboard_router.py) */}
      {selectedAlert && (
        <div className="dn-modal-overlay" onClick={() => setSelectedAlert(null)}>
          <div className="dn-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dn-modal-h">
              <h3>{selectedAlert.reason || selectedAlert.name}</h3>
              <button type="button" className="dn-modal-close" onClick={() => setSelectedAlert(null)}>✕</button>
            </div>
            <div className="dn-modal-b">
              <div className="dn-kv"><span>Camera</span><b>{selectedAlert.name}</b></div>
              {selectedAlert.raw?.ip && <div className="dn-kv"><span>IP Address</span><b>{selectedAlert.raw.ip}</b></div>}
              {selectedAlert.raw?.received_at && <div className="dn-kv"><span>Trigger Time</span><b>{fmtDT(selectedAlert.raw.received_at)}</b></div>}
              {selectedAlert.raw?.status && <div className="dn-kv"><span>Status</span><b>{selectedAlert.raw.status}</b></div>}
              
              {selectedAlert.raw?.ip && (
                <div className="dn-modal-thumb">
                  <img
                    src={`${API_BASE}/api/alerts/thumbnail?ip=${encodeURIComponent(selectedAlert.raw.ip)}&time=${encodeURIComponent(selectedAlert.raw.time || selectedAlert.raw.received_at || '')}`}
                    alt="Alert snapshot"
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                </div>
              )}
            </div>
            <div className="dn-modal-f">
              {selectedAlert.raw?.id && (
                <>
                  <button
                    type="button"
                    className="dn-btn warn"
                    disabled={alertActionLoading}
                    onClick={() => updateAlertStatus(selectedAlert.raw.id, "Acknowledged")}
                  >
                    Acknowledge
                  </button>
                  <button
                    type="button"
                    className="dn-btn good"
                    disabled={alertActionLoading}
                    onClick={() => updateAlertStatus(selectedAlert.raw.id, "Resolved")}
                  >
                    Resolve
                  </button>
                </>
              )}
              <button type="button" className="dn-btn" onClick={() => setSelectedAlert(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
