import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { useWebSocket } from "../../hooks/useWebSocket";
import { useI18n } from "../../i18n";
import {
  DEMO_FLEET, DEMO_SUMMARY, DEMO_HOURLY, DEMO_STORAGE, DEMO_BITRATE, DEMO_BANDWIDTH,
  DEMO_OUTAGES, DEMO_ATTENTION, DEMO_REPORT,
} from "./dashboardDemo";
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
const toLocalInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const parseTs = (v) => { if (!v) return NaN; const d = new Date(String(v).replace(" ", "T")); return d.getTime(); };
const camHealth = (c) => {
  if (c.status === "error" || c.fps === 0) return "error";
  if (!c.fps) return "connecting";
  if (c.fps < 10) return "warning";
  return "online";
};
const S1 = "#3987e5", S2 = "#d95926", S3 = "#199e70";
const CAM_PAGE = 8;
const SAMPLE_GROUPS = ["Main gate", "Lobby", "Parking", "Warehouse", "Perimeter", "Server room"];

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

/** rounded-top bar chart. items: [{label, value, hi?}] */
function BarChart({ items, yMax, ticks, xLabels, peakLabel, nowIndex, slots, w = 640, h = 290 }) {
  const bl = 34, bb = 24, bt = 14;
  const max = yMax || Math.max(...items.map((i) => i.value), 1);
  const gy = (v) => bt + (h - bt - bb) * (1 - v / max);
  const step = (w - bl - 8) / (slots || items.length);
  const pk = items.reduce((a, b, i) => (b.value > items[a].value ? i : a), 0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" className="dn-chart" role="img">
      {(ticks || [0, max / 2, max]).map((v) => (
        <g key={v}>
          <line x1={bl} x2={w - 4} y1={gy(v)} y2={gy(v)} className="dn-gridline" />
          <text x={bl - 8} y={gy(v) + 4} textAnchor="end" className="dn-axis">{Math.round(v)}</text>
        </g>
      ))}
      {items.map((it, i) => {
        if (!it.value) return null;
        const x = bl + i * step + 3, bw = Math.max(4, step - 6), y = gy(it.value);
        return <path key={i} className="dn-fill" opacity={i === pk ? 1 : 0.55} d={`M${x},${gy(0)}V${y + 4}a4 4 0 014-4h${bw - 8}a4 4 0 014 4V${gy(0)}Z`} />;
      })}
      {nowIndex != null && (<>
        <line x1={bl + nowIndex * step} x2={bl + nowIndex * step} y1={bt} y2={gy(0)} className="dn-nowline" />
        <text x={bl + nowIndex * step + 6} y={bt + 10} className="dn-axis">{peakLabel?.now}</text>
      </>)}
      {peakLabel?.text && items[pk]?.value > 0 && (
        <text x={Math.min(w - 50, Math.max(bl + 30, bl + pk * step + step / 2))} y={gy(items[pk].value) - 7} textAnchor="middle" className="dn-peak">{peakLabel.text(items[pk], pk)}</text>
      )}
      {(xLabels || []).map(([i, l]) => <text key={l + i} x={bl + i * step + step / 2} y={h - 6} textAnchor="middle" className="dn-axis">{l}</text>)}
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

/** collapsible raw-data table (keeps the original tabular reports available) */
function DataTable({ rows, keys, T }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  if (!rows.length) return null;
  const shown = rows.slice((page - 1) * 10, page * 10);
  return (
    <div className="dn-dtbl">
      <button type="button" className="dn-btn sm" onClick={() => setOpen(!open)}>{open ? T("hideData") : T("showData", { n: rows.length })}</button>
      {open && (
        <div className="dn-panel dn-dtbl-body">
          <div className="dn-scroll">
            <table className="dn-tbl cap">
              <thead><tr>{keys.map((k) => <th key={k}>{k.replace(/_/g, " ")}</th>)}</tr></thead>
              <tbody>{shown.map((r, i) => <tr key={i}>{keys.map((k) => <td key={k}>{String(r[k] ?? "—")}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="dn-foot"><span>{rows.length}</span><span className="dn-pager"><button type="button" className="dn-btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>{page} / {pages}<button type="button" className="dn-btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button></span></div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */
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
  const [activeRecorders, setActiveRecorders] = useState([]);
  const [cameraHealth, setCameraHealth] = useState([]);
  const [healthInfo, setHealthInfo] = useState(null);
  const [serverMetrics, setServerMetrics] = useState(null);
  const [storageDiag, setStorageDiag] = useState(null);
  const [bitrateDiag, setBitrateDiag] = useState(null);
  const [bandwidth, setBandwidth] = useState(null);
  const [infraAlerts, setInfraAlerts] = useState(null);
  const [hist30, setHist30] = useState(null);
  const [streamHist, setStreamHist] = useState([]);
  const [bitrateFilter, setBitrateFilter] = useState("24h");
  const [isAiActive, setIsAiActive] = useState(false);

  // cameras table
  const [camFilter, setCamFilter] = useState("all");
  const [camSearch, setCamSearch] = useState("");
  const [camPage, setCamPage] = useState(1);
  const [restartMsg, setRestartMsg] = useState("");

  // reports
  const [rFrom, setRFrom] = useState(toLocalInput(startOfDay()));
  const [rTo, setRTo] = useState(toLocalInput(new Date()));
  const [rSource, setRSource] = useState("all");
  const [rStatus, setRStatus] = useState("all");
  const [rep, setRep] = useState(null);
  const [rLoading, setRLoading] = useState(false);
  const [rMsg, setRMsg] = useState("");
  const [tip, setTip] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sf, setSf] = useState(null);
  const [gPage, setGPage] = useState(1);
  const [showFailed, setShowFailed] = useState(false);
  const [hotMode, setHotMode] = useState("treemap");
  const [latMode, setLatMode] = useState("hist");
  const [availMode, setAvailMode] = useState("bars");
  const [relMode, setRelMode] = useState("bars");
  const secRefs = useRef({});

  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);

  /* ── initial + manual refresh load (same endpoints as the existing dashboard) ── */
  useEffect(() => {
    let off = false;
    (async () => {
      const from30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const to = new Date().toISOString();
      const [sum, ev, cams, status, health, metrics, ch, infra, hist, ai] = await Promise.all([
        safe("/api/dashboard/summary"), safe("/api/dashboard/events"), safe("/api/cameras"),
        safe("/api/recordings/status"), safe("/api/health"), safe("/api/infrastructure/metrics"), safe("/api/camera-health"),
        safe(`/api/infrastructure/alerts?limit=5000&from_date=${from30}&to_date=${to}`),
        safe(`/api/reports/history?from_date=${from30}&to_date=${to}&live_only=false`),
        safe("/api/integrations"),
      ]);
      if (off) return;
      if (sum) setSummary((p) => ({ ...p, ...sum, history: p.history }));
      setEvents(Array.isArray(ev) ? ev : []);
      setCameras(Array.isArray(cams) ? cams : []);
      if (status) setActiveRecorders(status.active_recorders || []);
      setHealthInfo(health);
      setServerMetrics(metrics);
      setCameraHealth(Array.isArray(ch) ? ch : []);
      setInfraAlerts(Array.isArray(infra) ? infra : null);
      setHist30(hist && hist.status === "success" && Array.isArray(hist.data) ? hist.data : null);
      const list = Array.isArray(ai) ? ai : ai?.integrations || [];
      setIsAiActive(list.some((i) => /mirador.?ai|external_ai/i.test(JSON.stringify(i)) && (i.enabled || i.active || i.status === "active")));
      setLoaded(true);
    })();
    return () => { off = true; };
  }, [tick]);

  useEffect(() => {
    let off = false;
    Promise.all([safe("/api/storage/diagnostics"), safe(`/api/bitrate/diagnostics?filter_type=${bitrateFilter}`), safe("/api/cameras/bandwidth")])
      .then(([s, b, w]) => { if (off) return; setStorageDiag(s); setBitrateDiag(b); setBandwidth(w); });
    return () => { off = true; };
  }, [bitrateFilter, tick]);

  /* ── websocket sync (same topics as the existing dashboard) ── */
  useEffect(() => {
    if (!systemMetrics) return;
    setSummary((p) => ({ ...p, cpu: systemMetrics.cpu ?? p.cpu, ram: systemMetrics.ram ?? p.ram, disk: systemMetrics.disk ?? p.disk,
      history: { cpu: [...(p.history?.cpu || []), systemMetrics.cpu].slice(-24) } }));
  }, [systemMetrics]);
  useEffect(() => {
    const env = eventsByTopic.alerts;
    if (env && env.data) {
      setEvents((p) => [env.data, ...p.filter((e) => (e.event_id || e._id) !== (env.data.event_id || env.data._id))]);
      setSummary((p) => ({ ...p, alarms_today: (p.alarms_today || 0) + 1 }));
    }
  }, [eventsByTopic.alerts]);
  useEffect(() => {
    const env = eventsByTopic.camera_status;
    if (env && env.data) {
      const { ip, status } = env.data;
      setCameras((p) => p.map((c) => (c.ip === ip || c.ip_address === ip ? { ...c, enabled: status === "online" } : c)));
    }
  }, [eventsByTopic.camera_status]);
  useEffect(() => {
    const list = eventsByTopic["dashboard_overview"];
    if (!list || !list.length) return;
    const d = list[list.length - 1]?.payload;
    if (!d) return;
    if (d.summary) setSummary((p) => ({ ...p, ...d.summary, history: { cpu: [...(p.history?.cpu || []), d.summary.cpu ?? p.cpu].slice(-24) } }));
    if (d.events) setEvents(d.events);
    if (d.cameras) setCameras(d.cameras);
    if (d.active_recorders) setActiveRecorders(d.active_recorders);
    if (d.camera_health) setCameraHealth(Array.isArray(d.camera_health) ? d.camera_health : []);
    setLoaded(true);
  }, [eventsByTopic["dashboard_overview"]]);
  useEffect(() => { if (summary.active_streams != null) setStreamHist((h) => [...h, num(summary.active_streams)].slice(-20)); }, [summary.active_streams]);

  /* ── fleet normalisation (real, else sample) ── */
  const groupOf = (c) => {
    const g = c.group || c.group_name || c.groupName || c.camera_group || c.location || c.site || c.area || c.zone || c.folder || c.category;
    if (g && String(g).trim()) return String(g).trim();
    return String(c.name || "").includes(",") ? String(c.name).split(",")[0].trim() : null;
  };
  const uptimeByName = useMemo(() => {
    const m = {};
    (hist30 || []).forEach((r) => { const up = num(r.camera_hours_up), dn = num(r.camera_hours_down); if (up + dn > 0) m[r.name || r.ip] = (up / (up + dn)) * 100; });
    return m;
  }, [hist30]);

  const realFleet = useMemo(() => {
    const findH = (c) => cameraHealth.find((h) => h.name === c.name || h.stream === c.stream_key || h.stream === c.name || (c.ip && h.ip === c.ip));
    const mk = (c, h) => {
      const hs = h ? camHealth(h) : "online";
      const state = hs === "error" ? "off" : hs === "warning" ? "issue" : "on";
      const ts = h?.timestamp ? (Date.now() - parseTs(h.timestamp)) / 1000 : 0;
      return {
        name: c.name || c.device_name || c.camera_name || h?.name || c.ip,
        ip: c.ip || c.ip_address || h?.ip || "",
        group: groupOf(c), state,
        reason: state === "off" ? "offline" : state === "issue" ? "lowFps" : "online",
        stream: h ? (h.fps ? `${h.fps} fps` : "") : "",
        bitrate: h && h.bitrate > 0 ? h.bitrate / 1024 : 0,
        uptime: uptimeByName[c.name] ?? null,
        lastSeen: state === "on" ? 0 : Math.max(0, ts),
        stream_key: c.stream_key, raw: c,
      };
    };
    let list = cameras.filter((c) => c.enabled !== false).map((c) => mk(c, findH(c)));
    if (!list.length && cameraHealth.length) list = cameraHealth.map((h) => mk(h, h));
    return list;
  }, [cameras, cameraHealth, uptimeByName]); // eslint-disable-line

  const fleetDemo = realFleet.length === 0;
  // Real cameras without usable group info are spread over sample groups (flagged as sample data).
  const { fleet, groupDemo } = useMemo(() => {
    if (fleetDemo) return { fleet: DEMO_FLEET, groupDemo: false };
    // When nothing reports online (no live status yet), show a sample mix of online / issue / offline.
    const noLive = !realFleet.some((f) => f.state !== "off");
    const withState = (f, i) => {
      if (!noLive) return f;
      const m = i % 9;
      if (m === 4 || m === 8) return { ...f, state: "issue", reason: "lowFps", stream: "1080p, 9 fps", bitrate: 2.4 };
      if (m === 6) return f;
      return { ...f, state: "on", reason: "online", stream: "1080p, 25 fps", bitrate: 4 + (i % 5) };
    };
    const named = new Set(realFleet.map((f) => f.group).filter(Boolean));
    if (named.size >= 2) return { fleet: realFleet.map((f, i) => withState({ ...f, group: f.group || T("allCameras") }, i)), groupDemo: noLive };
    return { fleet: realFleet.map((f, i) => withState({ ...f, group: SAMPLE_GROUPS[i % SAMPLE_GROUPS.length] }, i)), groupDemo: true };
  }, [fleetDemo, realFleet, T]);
  const nOn = fleet.filter((f) => f.state === "on").length;
  const nIssue = fleet.filter((f) => f.state === "issue").length;
  const nOff = fleet.filter((f) => f.state === "off").length;
  const nTotal = fleet.length;
  const recOf = fleetDemo ? 62 : realFleet.filter((f) => activeRecorders.includes(f.stream_key)).length;
  const failedList = fleetDemo ? [] : realFleet.filter((f) => !activeRecorders.includes(f.stream_key));
  const failedN = fleetDemo ? nTotal - recOf : failedList.length;
  const groups = useMemo(() => {
    const m = new Map();
    fleet.forEach((f) => { if (sf && f.state !== sf) return; if (!m.has(f.group)) m.set(f.group, []); m.get(f.group).push(f); });
    return [...m.entries()];
  }, [fleet, sf]);
  const G_PER = 4;
  const gPages = Math.max(1, Math.ceil(groups.length / G_PER));
  const gp = Math.min(gPage, gPages);
  const pagedGroups = groups.slice((gp - 1) * G_PER, gp * G_PER);

  /* ── overview values ── */
  const metricsDemo = !(summary.cpu || summary.ram || summary.disk);
  const cpu = metricsDemo ? DEMO_SUMMARY.cpu : num(summary.cpu);
  const ram = metricsDemo ? DEMO_SUMMARY.ram : num(summary.ram);
  const cpuHist = summary.history?.cpu?.length > 1 ? summary.history.cpu : DEMO_SUMMARY.cpuHist;
  const stDemo = !storageDiag || !num(storageDiag.total_gb);
  const sd = stDemo ? DEMO_STORAGE : storageDiag;
  const usedTB = num(sd.used_gb) / 1024, totalTB = num(sd.total_gb) / 1024, freeTB = num(sd.free_gb) / 1024;
  const diskPct = num(sd.usage_pct) || (totalTB ? (usedTB / totalTB) * 100 : 0);
  const sumDemo = fleetDemo && !summary.active_streams && !summary.alarms_today;
  const streams = sumDemo ? DEMO_SUMMARY.streams : num(summary.active_streams);
  const alarms = sumDemo ? DEMO_SUMMARY.alarms : num(summary.alarms_today);
  const streamSeries = sumDemo || streamHist.length < 2 ? DEMO_SUMMARY.streamHist : streamHist;

  const hourly = useMemo(() => {
    const today = dayKey(new Date());
    const arr = Array(new Date().getHours() + 1).fill(0);
    let hit = 0;
    events.forEach((e) => {
      const ts = parseTs(e.timestamp || e.received_at || e.time || e.created_at || e.event_time);
      if (!isNaN(ts) && dayKey(new Date(ts)) === today) { arr[new Date(ts).getHours()]++; hit++; }
    });
    return hit ? arr : null;
  }, [events]);
  const hourlyDemo = !hourly;
  const hours = hourly || DEMO_HOURLY;

  const attention = useMemo(() => {
    if (fleetDemo) return DEMO_ATTENTION;
    return fleet.filter((f) => f.state !== "on").sort((a, b) => (a.state === "off" ? 0 : 1) - (b.state === "off" ? 0 : 1)).slice(0, 8)
      .map((f) => ({ kind: f.state === "off" ? "crit" : "warn", reason: f.reason, name: f.name, ago: f.lastSeen }));
  }, [fleet, fleetDemo]);
  const attentionN = fleetDemo ? 5 : nOff + nIssue;

  const rangeDays = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const outDemo = infraAlerts == null || (infraAlerts.length === 0 && fleetDemo);
  const nameByIp = (ip) => { const c = cameras.find((x) => x.ip === ip || x.ip_address === ip); return c?.name || c?.device_name || ip; };
  const offEvents = useMemo(() => (infraAlerts || []).filter((a) => a.event === "device_offline" && (!a.type || String(a.type).toLowerCase() === "camera")), [infraAlerts]);
  const outages = useMemo(() => {
    if (outDemo) return DEMO_OUTAGES.slice(0, 6);
    const since = Date.now() - Math.max(rangeDays, range === "today" ? 7 : rangeDays) * 86400000;
    const m = {};
    offEvents.filter((a) => parseTs(a.timestamp) >= since).forEach((a) => { const n = nameByIp(a.ip) || a.model || "—"; m[n] = (m[n] || 0) + 1; });
    return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [offEvents, outDemo, range]); // eslint-disable-line

  const subLine = fleetDemo ? T("subDemo") : nOff + nIssue === 0 ? T("subAllGood") : T("subIssues", { off: nOff, issues: nIssue });
  const subDot = nOff + nIssue === 0 && !fleetDemo ? "good" : "warn";

  /* ── health tab values ── */
  const bd = !bitrateDiag || !bitrateDiag.trend_data?.length ? DEMO_BITRATE : bitrateDiag;
  const bwd = !bandwidth || !bandwidth.top_cameras?.length ? DEMO_BANDWIDTH : bandwidth;
  const bdDemo = bd === DEMO_BITRATE, bwDemo = bwd === DEMO_BANDWIDTH;
  const hi = healthInfo || { status: "ok", version: DEMO_SUMMARY.version };
  const sm = serverMetrics || { uptime: DEMO_SUMMARY.uptime };
  const serverDemo = !healthInfo && !serverMetrics;

  const camRows = useMemo(() => {
    const order = { off: 0, issue: 1, on: 2 };
    const q = camSearch.trim().toLowerCase();
    return [...fleet].sort((a, b) => order[a.state] - order[b.state])
      .filter((f) => (camFilter === "all" || f.state === camFilter) && (!q || `${f.name} ${f.ip} ${f.group}`.toLowerCase().includes(q)));
  }, [fleet, camFilter, camSearch]);
  const camPages = Math.max(1, Math.ceil(camRows.length / CAM_PAGE));
  useEffect(() => { setCamPage(1); }, [camFilter, camSearch]);

  const trendPoints = useMemo(() => (sd.trend_history || []).map((p) => ({ v: num(p.used_gb) / 1024, ts: p.timestamp })), [sd]);
  const addedTB = trendPoints.length > 1 ? trendPoints[trendPoints.length - 1].v - trendPoints[0].v : 0;
  const fullDate = sd.predicted_exhaustion_date ? new Date(sd.predicted_exhaustion_date) : null;

  const restartCamera = async (cam) => {
    const ipRaw = cam.ip;
    if (!ipRaw) return;
    const ip = encodeURIComponent(ipRaw);
    const headers = { ...getAuthHeaders(), "Content-Type": "application/json" };
    const raw = cam.raw || {};
    try {
      if (raw.assigned_schedule_id && String(raw.assigned_schedule_id).toLowerCase() === "never") {
        await fetch(`${API_BASE}/api/recordings/assign-schedule`, { method: "POST", headers, body: JSON.stringify({ camera_id: raw.id || raw.stream_key || ipRaw, schedule_id: "Always", motion_only: !!raw.motion_only }) }).catch(() => {});
      }
      await fetch(`${API_BASE}/api/cameras/by-ip/${ip}/disable`, { method: "POST", headers });
      await new Promise((r) => setTimeout(r, 1500));
      await fetch(`${API_BASE}/api/cameras/by-ip/${ip}/enable`, { method: "POST", headers });
      setRestartMsg(T("restartSent", { name: cam.name }));
    } catch { setRestartMsg(T("restartFailed")); }
  };

  /* ── reports ── */
  const buildReports = useCallback(async (fromS, toS, source, status) => {
    const fromT = new Date(fromS).getTime(), toT = new Date(toS).getTime();
    const fromIso = new Date(fromT).toISOString(), toIso = new Date(toT).toISOString();
    const span = toT - fromT;
    const prevFrom = new Date(fromT - span).toISOString();
    const [al, lv, tp, hs, prev] = await Promise.all([
      safe(`/api/infrastructure/alerts?limit=5000&from_date=${fromIso}&to_date=${toIso}`),
      safe(`/api/alerts?${new URLSearchParams({ limit: 5000, from_date: fromIso, to_date: toIso, source, status }).toString()}`),
      safe("/api/infrastructure/topology"),
      safe(`/api/reports/history?from_date=${fromIso}&to_date=${toIso}&live_only=false`),
      safe(`/api/reports/history?from_date=${prevFrom}&to_date=${fromIso}&live_only=false`),
    ]);
    const out = { sample: {}, prev: null };
    if (Array.isArray(al)) {
      out.alerts = al.filter((a) => { const ts = parseTs(a.timestamp); return ts >= fromT && ts <= toT && a.type && a.type.toLowerCase() === "camera"; })
        .map((a) => ({ timestamp: a.timestamp, ip: a.ip || "—", model: a.model || "—", type: a.type || "—", event: a.event || "—", message: a.message || "—", acknowledged: a.acknowledged ? "Yes" : "No" }));
    }
    const liveList = Array.isArray(lv) ? lv : lv?.alerts;
    if (Array.isArray(liveList)) {
      out.live = liveList.filter((a) => {
        let v = a.received_at || a.time; if (!v) return false;
        if (!v.includes("-") && !v.includes("T")) { const d = new Date(); v = `${dayKey(d)}T${v}`; }
        const ts = parseTs(v); return !isNaN(ts) && ts >= fromT && ts <= toT;
      }).map((a) => ({
        timestamp: a.received_at || "—", ip_address: a.ip ? a.ip.replace(/_/g, ".") : "—", classification: a.type || "—",
        event: a.scenario || a.feature || a.subType || "—", details: a.employeeName || a.label || a.vehicleType || a.message || "—",
        status: a.status === "Resolved" || a.resolved_at ? "Resolved" : a.status === "Acknowledged" || a.acknowledged_at ? "Acknowledged" : "Active",
      }));
    }
    if (tp && Array.isArray(tp.nodes)) {
      out.health = tp.nodes.map((n) => ({
        device_id: n.id || "—", ip_address: n.ip || "—", manufacturer: n.manufacturer || "—", model: n.model || "—", device_type: n.type || "—",
        current_status: n.status || "offline", latency_ms: n.latency != null ? `${n.latency} ms` : "—", uptime_duration: n.uptime || "—",
        online_since: n.last_seen || "—", reboot_count: n.reboot_count != null ? String(n.reboot_count) : "0", last_reboot: n.last_reboot || "—",
        _lat: n.latency != null ? num(n.latency) : null, _group: n.manufacturer || n.type || "—", _name: n.name || n.id || n.ip,
      }));
    }
    const mkHist = (d) => {
      const uniq = {};
      d.forEach((c) => { const k = c.ip || c.name || "unknown"; if (!uniq[k]) uniq[k] = c; });
      return Object.values(uniq).map((c) => {
        const hh = (v) => { const m = Math.round(num(v) * 60); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
        return { camera_name: c.name || "—", ip_address: c.ip || "—", cam_up_hrs: hh(c.camera_hours_up), cam_down_hrs: hh(c.camera_hours_down),
          rec_up_hrs: hh(c.recording_hours_up), rec_down_hrs: hh(c.recording_hours_down), storage_consumed: (num(c.storage_consumed_bytes) / 1024 ** 3).toFixed(2) + " GB",
          _up: num(c.camera_hours_up), _down: num(c.camera_hours_down), _rup: num(c.recording_hours_up), _rdown: num(c.recording_hours_down) };
      });
    };
    if (hs && hs.status === "success" && Array.isArray(hs.data)) out.history = mkHist(hs.data);
    if (prev && prev.status === "success" && Array.isArray(prev.data)) out.prev = mkHist(prev.data);
    ["alerts", "live", "health", "history"].forEach((k) => {
      if (!out[k] || (out[k].length === 0 && fleetDemo)) { out[k] = DEMO_REPORT[k]; out.sample[k] = true; }
    });
    return out;
  }, [fleetDemo]);

  const generate = useCallback(async () => {
    setRLoading(true); setRMsg("");
    try { const r = await buildReports(rFrom, rTo, rSource, rStatus); setRep(r); return r; }
    catch { setRMsg(T("reportFail")); return null; }
    finally { setRLoading(false); }
  }, [buildReports, rFrom, rTo, rSource, rStatus, T]);

  useEffect(() => { if (tab === "reports" && !rep) generate(); }, [tab]); // eslint-disable-line
  const pickRange = (k) => {
    setRange(k);
    const d = k === "today" ? 0 : k === "7d" ? 7 : 30;
    const from = startOfDay(new Date(Date.now() - d * 86400000));
    setRFrom(toLocalInput(from)); setRTo(toLocalInput(new Date())); setRep(null);
  };
  useEffect(() => { if (tab === "reports" && !rep && !rLoading) generate(); }, [rep]); // eslint-disable-line

  const DATASETS = [
    { key: "alerts", rt: "alerts", keys: ["timestamp", "ip", "model", "type", "event", "message", "acknowledged"] },
    { key: "live", rt: "live_alerts", keys: ["timestamp", "ip_address", "classification", "event", "details", "status"] },
    { key: "health", rt: "health", keys: ["device_id", "ip_address", "manufacturer", "model", "device_type", "current_status", "latency_ms", "uptime_duration", "online_since", "reboot_count", "last_reboot"] },
    { key: "history", rt: "history", keys: ["camera_name", "ip_address", "cam_up_hrs", "cam_down_hrs", "rec_up_hrs", "rec_down_hrs", "storage_consumed"] },
  ];
  const dsKeys = (d) => d.keys.filter((k) => !(d.key === "live" && rSource === "built_in" && k === "details"));
  const saveBlob = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); };
  const csvOf = (list, r) => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return "﻿" + list.map((d) => { const keys = dsKeys(d); return [T("rt." + d.rt), keys.join(","), ...(r[d.key] || []).map((row) => keys.map((k) => esc(row[k])).join(","))].join("\n"); }).join("\n\n");
  };
  const exportCsv = async (only) => {
    const r = rep || (await generate()); if (!r) return;
    const list = only ? DATASETS.filter((d) => d.rt === only) : DATASETS;
    const blob = new Blob([csvOf(list, r)], { type: "text/csv;charset=utf-8" });
    const name = only ? `${only}_report.csv` : "dashboard_report.csv";
    saveBlob(blob, name);
  };
  const exportXlsx = async () => {
    const r = rep || (await generate()); if (!r) return;
    const wb = XLSX.utils.book_new();
    DATASETS.forEach((d) => { const keys = dsKeys(d); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((r[d.key] || []).map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])))), d.rt.slice(0, 31)); });
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveBlob(blob, "dashboard_report.xlsx");
  };

  /* report derivations */
  const rd = useMemo(() => {
    if (!rep) return null;
    const a = rep.alerts || [], live = rep.live || [], h = rep.health || [], hs = rep.history || [];
    const fromT = new Date(rFrom).getTime(), toT = new Date(rTo).getTime();
    const nDays = Math.min(14, Math.max(7, Math.ceil((toT - fromT) / 86400000)));
    const anchor = rep.sample.alerts || rep.sample.live ? Date.now() : toT;
    const days = Array.from({ length: nDays }, (_, i) => dayKey(new Date(anchor - (nDays - 1 - i) * 86400000)));
    const dayIdx = (ts) => days.indexOf(String(ts).slice(0, 10));
    // group 1
    const offs = a.filter((r) => /offline/i.test(r.event));
    const perDay = days.map(() => 0);
    offs.forEach((r) => { const i = dayIdx(r.timestamp); if (i >= 0) perDay[i]++; });
    const byCam = {}; offs.forEach((r) => { const n = rep.sample.alerts ? r.ip : nameByIp(r.ip); byCam[n] = (byCam[n] || 0) + 1; });
    const offenders = Object.entries(byCam).sort((x, y) => y[1] - x[1]).slice(0, 5);
    const ackN = a.filter((r) => r.acknowledged === "Yes").length, openN = a.length - ackN;
    const openList = a.filter((r) => r.acknowledged !== "Yes").sort((x, y) => parseTs(y.timestamp) - parseTs(x.timestamp)).slice(0, 3);
    // group 2
    const typeCount = {}; live.forEach((r) => { typeCount[r.classification] = (typeCount[r.classification] || 0) + 1; });
    const types = Object.entries(typeCount).sort((x, y) => y[1] - x[1]);
    const series = types.slice(0, 3).map(([name], si) => ({ name, color: [S1, S2, S3][si], vals: days.map(() => 0) }));
    live.forEach((r) => { const s = series.find((x) => x.name === r.classification); const i = dayIdx(r.timestamp); if (s && i >= 0) s.vals[i]++; });
    const camCount = {}; live.forEach((r) => { camCount[r.ip_address] = (camCount[r.ip_address] || 0) + 1; });
    const hot = Object.entries(camCount).sort((x, y) => y[1] - x[1]).slice(0, 6);
    // group 3
    const online = h.filter((r) => String(r.current_status).toLowerCase() === "online").length;
    const byGroup = {}; h.forEach((r) => { const g = r._group || r.device_type; byGroup[g] = byGroup[g] || [0, 0]; byGroup[g][1]++; if (String(r.current_status).toLowerCase() === "online") byGroup[g][0]++; });
    const lats = h.filter((r) => r._lat != null);
    const bins = Array(10).fill(0); lats.forEach((r) => { bins[Math.min(9, Math.floor(r._lat / 10))]++; });
    const overLimit = lats.filter((r) => r._lat > 50).length;
    const reboots = h.map((r) => ({ n: r._name || r.ip_address, ip: r.ip_address, c: num(r.reboot_count) })).filter((r) => r.c > 0).sort((x, y) => y.c - x.c).slice(0, 5);
    // group 4
    const pct = (u, d) => (u + d > 0 ? (u / (u + d)) * 100 : 100);
    const av = hs.map((r) => ({ n: r.camera_name, v: pct(r._up, r._down) })).sort((x, y) => x.v - y.v);
    const rel = hs.map((r) => ({ n: r.camera_name, v: pct(r._rup, r._rdown) })).sort((x, y) => x.v - y.v);
    const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x.v, 0) / arr.length : 0);
    const prevAv = rep.prev && rep.prev.length ? mean(rep.prev.map((r) => ({ v: pct(r._up, r._down) }))) : null;
    const prevRel = rep.prev && rep.prev.length ? mean(rep.prev.map((r) => ({ v: pct(r._rup, r._rdown) }))) : null;
    const avM = mean(av), relM = mean(rel);
    return { days, perDay, offs, offenders, ackN, openN, openList, types, series, hot, live, online, h, byGroup, bins, overLimit, lats, reboots, av, rel, avM, relM, score: (avM + relM) / 2,
      dScore: prevAv != null ? (avM + relM) / 2 - (prevAv + prevRel) / 2 : rep.sample.history ? 0.8 : null, dAv: prevAv != null ? avM - prevAv : rep.sample.history ? 0.3 : null, dRel: prevRel != null ? relM - prevRel : rep.sample.history ? 1.5 : null,
      nCamsOff: new Set(offs.map((r) => r.ip)).size };
  }, [rep, rFrom, rTo]); // eslint-disable-line

  const histBins = (arr) => { const edges = [90, 95, 98, 99, 100.01]; const b = Array(5).fill(0); arr.forEach((x) => { const i = edges.findIndex((e) => x.v < e); b[i < 0 ? 4 : i]++; }); return [[`<90%`, b[0]], ["90–95%", b[1]], ["95–98%", b[2]], ["98–99%", b[3]], ["99–100%", b[4]]]; };
  const jump = (k) => secRefs.current[k]?.scrollIntoView({ behavior: "smooth", block: "start" });
  const treemap = (hot) => {
    if (!hot.length) return null;
    const cols = [hot.slice(0, 1), hot.slice(1, 3), hot.slice(3, 6)].filter((c) => c.length);
    const op = [0.95, 0.78, 0.6, 0.5, 0.4, 0.3];
    let n = 0;
    return (
      <div className="dn-tm">
        {cols.map((c, ci) => (
          <div key={ci} style={{ flex: c.reduce((s, x) => s + x[1], 0) }}>
            {c.map(([name, v]) => { const o = op[n++]; return <div key={name} className={`dn-tmb ${o < 0.6 ? "lt" : ""}`} style={{ flex: v, background: `rgba(34,211,238,${o})` }}><span>{name}</span><b>{v}</b></div>; })}
          </div>
        ))}
      </div>
    );
  };

  /* ───────────────────────── render: overview ───────────────────────── */
  const Overview = (
    <div className="dn-grid">
      <Panel T={T} className="c8" title={T("cameraFleet")} demo={fleetDemo || groupDemo || sumDemo || stDemo}
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
        <div className="dn-m t2"><div><div className="k">{T("alarmsToday")}</div><div className="v">{alarms}</div><div className="n">{sumDemo ? <><IcUp />{T("moreThanYesterday", { n: DEMO_SUMMARY.alarmsDelta })}</> : T("criticalN", { n: events.filter((e) => /intrusion|offline|error/i.test(e.event_type || "")).length })}</div></div><Spark values={hours.length > 1 ? hours : DEMO_SUMMARY.alarmHist} w={300} h={40} /></div>
        <div className="dn-m t3"><div><div className="k">{T("storageUsed")}</div><div className="v">{usedTB.toFixed(1)} <u>{T("ofTB", { n: totalTB.toFixed(0) })}</u></div><div className="dn-ret"><span>{T("estRetention")}</span><b>{sd.retention_days != null ? `${sd.retention_days} ${T("days")}` : T("calculating")}</b></div></div><div className="dn-pb"><i style={{ width: `${Math.min(100, diskPct)}%` }} /></div></div>
          </div>
          <div className="dn-mx">
            {groups.length === 0 && <div className="dn-empty">—</div>}
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

      <Panel T={T} className="c4" title={T("systemHealth")} sub={null} right={<small className="dn-s2 inl">{T("thisServer")}</small>} demo={metricsDemo}>
        <div className="dn-hrow"><div className="dn-hh"><span>CPU</span><span className="p">{Math.round(cpu)}%</span></div><AreaFlat values={cpuHist} /><div className={`dn-st ${cpu > 85 ? "crit" : cpu > 60 ? "warn" : "good"}`}>{cpu > 85 ? <IcCrit /> : cpu > 60 ? <IcWarn /> : <IcOk />}{cpu > 85 ? T("critical") : cpu > 60 ? T("highAbove", { n: 60 }) : T("normal")}</div></div>
        <div className="dn-hrow"><div className="dn-hh"><span>{T("memory")}</span><span className="p">{Math.round(ram)}%</span></div><Meter pct={ram} marks={[60, 85]} /><div className={`dn-st ${ram > 85 ? "crit" : ram > 60 ? "warn" : "good"}`}>{ram > 60 ? <IcWarn /> : <IcOk />}{ram > 85 ? T("critical") : ram > 60 ? T("highAbove", { n: 60 }) : T("normal")}</div></div>
        <div className="dn-hrow"><div className="dn-hh"><span>{T("disk")}</span><span className="p">{Math.round(diskPct)}%</span></div><Meter pct={diskPct} marks={[80, 90]} /><div className={`dn-st ${diskPct > 90 ? "crit" : diskPct > 80 ? "warn" : "good"}`}>{diskPct > 80 ? <IcWarn /> : <IcOk />}{T("normalFree", { n: freeTB.toFixed(1) })}</div></div>
      </Panel>


      <Panel T={T} className="c6" title={T("needsAttention")} sub={null} right={<small className="dn-s2 inl">{T("openN", { n: attentionN })}</small>} demo={fleetDemo}>
        {attention.length === 0 ? <div className="dn-empty ok">{T("nothingAttention")}</div> : (
          <ul className="dn-al">
            {attention.map((a, i) => (
              <li key={i}>
                <span className={`dn-ai ${a.kind}`}>{KIND_ICON[a.kind]}</span>
                <div><b>{a.reason === "offline" ? T("camOffline") : T("streamDegraded", { why: T("reason." + a.reason) })}</b><small>{a.name}</small></div>
                <time>{ago(a.ago)}</time>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="dn-link" onClick={() => setTab("health")}>{T("viewAllAlerts")}</button>
      </Panel>


      <Panel T={T} className="c6" title={T("frequentOutages")} sub={null} right={<small className="dn-s2 inl">{T("offlineEventsRange", { n: range === "today" ? 7 : rangeDays })}</small>} demo={outDemo}>
        {outages.length === 0 ? <div className="dn-empty ok">{T("noOutages")}</div> : <HBars rows={outages.map((o) => [o.name, o.count])} />}
      </Panel>

    </div>
  );

  /* ───────────────────────── render: health & storage ───────────────────────── */
  /* ── health overview values ── */
  const availPct = nTotal ? (nOn / nTotal) * 100 : 0;
  const recPct = nTotal ? (recOf / nTotal) * 100 : 0;
  const serverOk = serverDemo || String(hi.status).toLowerCase() === "ok";
  const storagePts = Math.min(100, Math.max(0, (100 - diskPct) * 2));
  const healthScore = Math.round(0.35 * availPct + 0.3 * recPct + 0.2 * storagePts + 0.15 * (serverOk ? 100 : 40));
  const scoreColor = healthScore >= 85 ? "var(--dn-ok)" : healthScore >= 60 ? "var(--dn-warn)" : "var(--dn-crit-t)";
  const areasN = [nOff + nIssue > 0, failedN > 0, diskPct > 80, !serverOk].filter(Boolean).length;
  const camSt = nOn === 0 && nTotal > 0 ? "bad" : nOff + nIssue > 0 ? "warn" : "ok";
  const strSt = nIssue > 0 ? "warn" : "ok";
  const recSt = recOf === 0 && nTotal > 0 ? "bad" : failedN > 0 ? "warn" : "ok";
  const stoSt = diskPct > 90 ? "bad" : diskPct > 80 ? "warn" : "ok";
  const failedNames = fleetDemo ? ["Lobby, Camera 4", "Parking, Exit", "Warehouse, Dock 1", "Gate, Lane B"] : failedList.map((c) => c.name);
  const restartAll = async () => { for (const c of failedList) await restartCamera(c); };
  const groupShare = useMemo(() => {
    const m = new Map();
    fleet.forEach((f) => m.set(f.group, (m.get(f.group) || 0) + (Number(f.bitrate) > 0 ? Number(f.bitrate) : 0)));
    let arr = [...m.entries()];
    if (arr.every(([, v]) => v === 0)) arr = [...new Map(fleet.map((f) => [f.group, fleet.filter((x) => x.group === f.group).length])).entries()];
    arr.sort((a, b) => b[1] - a[1]);
    const total = arr.reduce((t, [, v]) => t + v, 0) || 1;
    const top = arr.slice(0, 5).map(([g, v], i) => ({ g, tb: (usedTB * v) / total, pct: (v / total) * 100, c: GROUP_COLORS[i] }));
    const rest = arr.slice(5).reduce((t, [, v]) => t + v, 0);
    if (rest > 0) top.push({ g: T("otherGroups"), tb: (usedTB * rest) / total, pct: (rest / total) * 100, c: "var(--dn-line2)" });
    return top;
  }, [fleet, usedTB, T]);
  const bwTotal = Math.max(num(bwd.total_bandwidth), 1);
  const bwTop = bwd.top_cameras.slice(0, 5);
  const bwOther = Math.max(0, bwTotal - bwTop.reduce((t, c) => t + num(c.bitrate), 0));
  const NODE_ICON = { ok: <IcOk />, warn: <IcWarn />, bad: <IcCrit /> };

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
          <div className={`dn-node ${recSt}`}><div className="t"><span>{T("pipeRecorder")}</span><i className="dn-sdot" /></div><div className="v">{recOf} <u>{T("ofRecording", { n: nTotal })}</u></div><div className="n">{recOf > 0 || fleetDemo ? T("running") : T("stopped")}</div></div>
          <div className={`dn-node ${stoSt}`}><div className="t"><span>{T("pipeStorage")}</span><i className="dn-sdot" /></div><div className="v">{Math.round(diskPct)}% <u>{T("usedLc")}</u></div><div className="n">{sd.retention_days != null ? T("retentionLeft", { n: sd.retention_days }) : T("calculating")}</div></div>
        </div>
        <div className="dn-srv">
          <span>{T("serverUptime")}<b>{sm.uptime ?? "—"}</b></span>
          <span>{T("appVersion")}<b>{hi.version ?? "—"}</b></span>
          <span>{T("backendStatus")}<b className={serverOk ? "good" : "bad"}>{serverOk ? T("healthy") : String(hi.status)}</b></span>
          <span className="sp"><Pill kind={serverOk ? "good" : "warn"} icon={<IcOk />}>API</Pill>{hi.watchdog && <Pill kind="good" icon={<IcOk />}>{T("watchdog")}: {hi.watchdog}</Pill>}{serverDemo && <><Pill kind="good" icon={<IcOk />}>{T("database")}</Pill><Pill kind="good" icon={<IcOk />}>{T("streamer")}</Pill></>}</span>
          {(serverDemo || fleetDemo) && <span className="dn-tag">{T("sample")}</span>}
        </div>
      </section>

      {failedN > 0 && (
        <div className="c12" ref={(el) => { secRefs.current.failed = el; }}>
          <div className="dn-alertbar">
            <span className="dn-ai crit"><IcCrit /></span>
            <div className="tx"><h2>{T("notRecordingN", { n: failedN })}</h2><small className="dn-s2">{T("failedSub")}</small></div>
            <div className="dn-cchips">{failedNames.slice(0, 4).map((n, i) => <span key={i}>{n}</span>)}{failedNames.length > 4 && <span>+{failedNames.length - 4}</span>}</div>
            <button type="button" className="dn-btn" onClick={() => setShowFailed(!showFailed)}>{showFailed ? T("hideList") : T("viewList")}</button>
            {!fleetDemo && <button type="button" className="dn-btn pri" onClick={restartAll}>{T("restartAll")}</button>}
          </div>
          {restartMsg && <div className="dn-note">{restartMsg}</div>}
          {showFailed && !fleetDemo && (
            <section className="dn-panel" style={{ marginTop: "calc(14 * var(--u))" }}>
              <ul className="dn-al">
                {failedList.map((c, i) => (<li key={i}><span className="dn-ai crit"><IcCrit /></span><div><b>{c.name}</b><small>{c.ip}</small></div><button type="button" className="dn-btn sm" onClick={() => restartCamera(c)}>{T("restart")}</button></li>))}
              </ul>
            </section>
          )}
        </div>
      )}

      <Panel T={T} className="c8" title={T("storageGrowth")} sub={T("storageGrowthSub")} demo={stDemo}>
        <div className="dn-stat3 colr"><div>{T("avgPerDay")}<b>{sd.avg_daily_consumption != null ? sd.avg_daily_consumption : "—"}<u>GB</u></b></div><div>{T("addedInPeriod")}<b>{addedTB.toFixed(1)}<u>TB</u></b></div><div className="w">{T("predictedFull")}<b>{fullDate ? fmtD(fullDate) : "—"}</b></div></div>
        <TrendChart points={trendPoints} w={760} h={250} reserve={fullDate ? 0.48 : 0} yTicks={[0, 5, 10, 15, 20].map((v) => Math.round((totalTB * v) / 20))} yFmt={(v) => `${v} TB`}
          extra={({ x, y, right, left }) => {
            const n = trendPoints.length, last = n ? trendPoints[n - 1] : null;
            return (<>
              <line x1={left} x2={right} y1={y(totalTB)} y2={y(totalTB)} className="dn-capline" />
              <text x={left + 6} y={y(totalTB) + 16} className="dn-axis dn-warn-t">{T("capacityN", { n: totalTB.toFixed(0) })}</text>
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

      <Panel T={T} className="c4" title={T("spaceGoes")} sub={T("spaceGoesSub", { n: usedTB.toFixed(1) })} demo={stDemo || groupDemo}>
        <div className="dn-share">{groupShare.map((g, i) => <i key={i} style={{ width: `${g.pct}%`, background: g.c }} title={g.g} />)}</div>
        <ul className="dn-lg2">{groupShare.map((g, i) => <li key={i}><span style={{ background: g.c }} />{g.g}<b>{g.tb.toFixed(1)} TB</b></li>)}</ul>
        <div className="dn-ret2">
          <Ring pct={Math.min(100, ((sd.retention_days || 0) / 60) * 100)} size={92} sw={13} color="var(--dn-c2)"><b>{sd.retention_days != null ? sd.retention_days : "—"}</b></Ring>
          <div><h3>{T("daysRetention")}</h3><small className="dn-s2">{T("retentionNote", { total: totalTB.toFixed(0), free: freeTB.toFixed(1) })}</small></div>
        </div>
        {sd.warning_status && <div className="dn-note crit">{T("storageWarn")}</div>}
      </Panel>

      <Panel T={T} className="c6" title={T("bitrateTrend")} sub={T("totalStreamBw")} demo={bdDemo}
        right={<Seg small options={[["1h", "1 h"], ["24h", "24 h"], ["7d", "7 d"]]} value={bitrateFilter} onChange={setBitrateFilter} />}>
        <div className="dn-stat3 colr"><div>{T("current")}<b>{bd.current_bitrate}<u>Mbps</u></b></div><div>{T("average")}<b>{bd.avg_bitrate}<u>Mbps</u></b></div><div>{T("peak")}<b>{bd.peak_bitrate}<u>Mbps</u></b></div></div>
        <TrendChart points={bd.trend_data.map((p) => ({ v: num(p.bitrate_mbps), ts: p.timestamp }))} unitLabel="Mbps"
          yTicks={(() => { const m = Math.max(50, Math.ceil(Math.max(...bd.trend_data.map((p) => num(p.bitrate_mbps)), 1) / 50) * 50); return [0, m / 4, m / 2, (m * 3) / 4, m]; })()}
          xLabels={[[0, (bd.trend_data[0] ? new Date(bd.trend_data[0].timestamp).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }) : "")], [1, T("now")]]} />
      </Panel>
      <Panel T={T} className="c6" title={T("bandwidthConsumers")} sub={T("topByBitrate")} demo={bwDemo} right={<small className="dn-s2 inl">{T("shareOf", { n: bwd.total_bandwidth })}</small>}>
        <div className="dn-share tall">{bwTop.map((c, i) => <i key={i} style={{ width: `${(num(c.bitrate) / bwTotal) * 100}%`, background: GROUP_COLORS[i % 5] }} />)}{bwOther > 0 && <i style={{ width: `${(bwOther / bwTotal) * 100}%`, background: "var(--dn-line2)" }} />}</div>
        <ul className="dn-hb dn-click colr">
          {bwTop.map((c, i) => {
            const nm = bwDemo ? c.name : cameras.find((x) => x.ip === c.ip || x.ip_address === c.ip || (c.id && (x.id === c.id || x._id === c.id)))?.name || c.name;
            const mx = Math.max(...bwTop.map((x) => num(x.bitrate)), 1);
            return (<li key={i} onClick={() => navigate("/cameras")}><div className="dn-row"><span><i className="dn-cdot" style={{ background: GROUP_COLORS[i % 5] }} />{nm}<small>{c.ip}</small></span><b>{c.bitrate} Mbps</b></div><div className="dn-track"><i style={{ width: `${(num(c.bitrate) / mx) * 100}%`, background: GROUP_COLORS[i % 5] }} /></div></li>);
          })}
        </ul>
      </Panel>

      <Panel T={T} className="c12" title={T("cameraHealthMon")} sub={T("problemsFirst")} demo={fleetDemo || groupDemo}
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

  /* ───────────────────────── render: reports ───────────────────────── */
  const S = rep?.sample || {};
  const sec = (k, title, sub, children) => (
    <div ref={(el) => { secRefs.current[k] = el; }} className="dn-sec">
      <div className="dn-grph"><h3>{title}</h3><span>{sub}</span></div>
      <div className="dn-grid">{children}</div>
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
          <button type="button" className="dn-btn" onClick={() => { setTick((x) => x + 1); setRep(null); }}><IcRefresh />{T("refresh")}</button>
        </div>
      </div>
      <nav className="dn-tabs" role="tablist">
        {["overview", "health"].map((k) => <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{T("tab." + k)}</button>)}
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
    </div>
  );
}
