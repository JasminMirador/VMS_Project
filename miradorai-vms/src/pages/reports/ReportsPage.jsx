import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { useI18n } from "../../i18n";
import "../Dashboard/DashboardNewPage.css";

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

const S1 = "#3987e5", S2 = "#d95926", S3 = "#199e70";

/* ───────────────────────── tiny svg icons ───────────────────────── */
const I16 = ({ children }) => <svg viewBox="0 0 16 16" aria-hidden="true">{children}</svg>;
const I24 = ({ children }) => <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
const IcRefresh = () => <I24><path d="M20 11a8 8 0 00-14.4-4.2L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0014.4 4.2l1.6-1.7M20 20v-4.5h-4.5" /></I24>;

/* ───────────────────────── chart helpers ───────────────────────── */
function BarChart({ items, yMax, ticks, xLabels, peakLabel, nowIndex, slots, w = 640, h = 290 }) {
  const bl = 34, bb = 24, bt = 14;
  const max = yMax || Math.max(...items.map((i) => i.value), 1);
  const gy = (v) => bt + (h - bt - bb) * (1 - v / max);
  const step = (w - bl - 8) / (slots || items.length || 1);
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

function Panel({ title, sub, right, className = "", children }) {
  return (
    <section className={`dn-panel ${className}`}>
      <div className="dn-ph">
        <div><h2>{title}</h2>{sub && <small className="dn-s2">{sub}</small>}</div>
        <div className="dn-ph-r">{right}</div>
      </div>
      {children}
    </section>
  );
}

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

export default function ReportsPage() {
  const { t } = useI18n();
  const T = useCallback((k, p) => t("dashNew." + k, p), [t]);

  const [range, setRange] = useState("today");
  const [rFrom, setRFrom] = useState(toLocalInput(startOfDay()));
  const [rTo, setRTo] = useState(toLocalInput(new Date()));
  const [rSource, setRSource] = useState("all");
  const [rStatus, setRStatus] = useState("all");
  const [isAiActive, setIsAiActive] = useState(false);
  const [cameras, setCameras] = useState([]);

  const [rep, setRep] = useState(null);
  const [rLoading, setRLoading] = useState(false);
  const [rMsg, setRMsg] = useState("");
  const secRefs = useRef({});

  // Check integration and cameras
  useEffect(() => {
    safe("/api/integrations").then((ai) => {
      const list = Array.isArray(ai) ? ai : ai?.integrations || [];
      setIsAiActive(list.some((i) => /mirador.?ai|external_ai/i.test(JSON.stringify(i)) && (i.enabled || i.active || i.status === "active")));
    });
    safe("/api/cameras").then((cams) => {
      if (Array.isArray(cams)) setCameras(cams);
    });
  }, []);

  const nameByIp = useCallback((ip) => {
    const c = cameras.find((x) => x.ip === ip || x.ip_address === ip);
    return c?.name || c?.device_name || ip;
  }, [cameras]);

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

    const out = {};
    if (Array.isArray(al)) {
      out.alerts = al.filter((a) => {
        const ts = parseTs(a.timestamp);
        return ts >= fromT && ts <= toT && a.type && a.type.toLowerCase() === "camera";
      }).map((a) => ({
        timestamp: a.timestamp,
        ip: a.ip || "—",
        model: a.model || "—",
        type: a.type || "—",
        event: a.event || "—",
        message: a.message || "—",
        acknowledged: a.acknowledged ? "Yes" : "No"
      }));
    } else {
      out.alerts = [];
    }

    const liveList = Array.isArray(lv) ? lv : lv?.alerts;
    if (Array.isArray(liveList)) {
      out.live = liveList.filter((a) => {
        let v = a.received_at || a.time;
        if (!v) return false;
        if (!v.includes("-") && !v.includes("T")) {
          const d = new Date();
          v = `${dayKey(d)}T${v}`;
        }
        const ts = parseTs(v);
        return !isNaN(ts) && ts >= fromT && ts <= toT;
      }).map((a) => ({
        timestamp: a.received_at || "—",
        ip_address: a.ip ? a.ip.replace(/_/g, ".") : "—",
        classification: a.type || "—",
        event: a.scenario || a.feature || a.subType || "—",
        details: a.employeeName || a.label || a.vehicleType || a.message || "—",
        status: a.status === "Resolved" || a.resolved_at ? "Resolved" : a.status === "Acknowledged" || a.acknowledged_at ? "Acknowledged" : "Active",
      }));
    } else {
      out.live = [];
    }

    if (tp && Array.isArray(tp.nodes)) {
      out.health = tp.nodes.map((n) => ({
        device_id: n.id || "—",
        ip_address: n.ip || "—",
        manufacturer: n.manufacturer || "—",
        model: n.model || "—",
        device_type: n.type || "—",
        current_status: n.status || "offline",
        latency_ms: n.latency != null ? `${n.latency} ms` : "—",
        uptime_duration: n.uptime || "—",
        online_since: n.last_seen || "—",
        reboot_count: n.reboot_count != null ? String(n.reboot_count) : "0",
        last_reboot: n.last_reboot || "—",
        _lat: n.latency != null ? num(n.latency) : null,
        _group: n.manufacturer || n.type || "—",
        _name: n.name || n.id || n.ip,
      }));
    } else {
      out.health = [];
    }

    const mkHist = (d) => {
      const uniq = {};
      d.forEach((c) => {
        const k = c.ip || c.name || "unknown";
        if (!uniq[k]) uniq[k] = c;
      });
      return Object.values(uniq).map((c) => {
        const hh = (v) => {
          const m = Math.round(num(v) * 60);
          return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
        };
        return {
          camera_name: c.name || "—",
          ip_address: c.ip || "—",
          cam_up_hrs: hh(c.camera_hours_up),
          cam_down_hrs: hh(c.camera_hours_down),
          rec_up_hrs: hh(c.recording_hours_up),
          rec_down_hrs: hh(c.recording_hours_down),
          storage_consumed: (num(c.storage_consumed_bytes) / 1024 ** 3).toFixed(2) + " GB",
          _up: num(c.camera_hours_up),
          _down: num(c.camera_hours_down),
          _rup: num(c.recording_hours_up),
          _rdown: num(c.recording_hours_down)
        };
      });
    };

    if (hs && hs.status === "success" && Array.isArray(hs.data)) out.history = mkHist(hs.data);
    else out.history = [];
    if (prev && prev.status === "success" && Array.isArray(prev.data)) out.prev = mkHist(prev.data);

    return out;
  }, []);

  const generate = useCallback(async () => {
    setRLoading(true);
    setRMsg("");
    try {
      const r = await buildReports(rFrom, rTo, rSource, rStatus);
      setRep(r);
      return r;
    } catch {
      setRMsg(T("reportFail"));
      return null;
    } finally {
      setRLoading(false);
    }
  }, [buildReports, rFrom, rTo, rSource, rStatus, T]);

  useEffect(() => {
    generate();
  }, []); // Initial load on mount

  const pickRange = (k) => {
    setRange(k);
    const d = k === "today" ? 0 : k === "7d" ? 7 : 30;
    const from = startOfDay(new Date(Date.now() - d * 86400000));
    setRFrom(toLocalInput(from));
    setRTo(toLocalInput(new Date()));
    setRep(null);
  };

  const DATASETS = [
    { key: "alerts", rt: "alerts", keys: ["timestamp", "ip", "model", "type", "event", "message", "acknowledged"] },
    { key: "live", rt: "live_alerts", keys: ["timestamp", "ip_address", "classification", "event", "details", "status"] },
    { key: "health", rt: "health", keys: ["device_id", "ip_address", "manufacturer", "model", "device_type", "current_status", "latency_ms", "uptime_duration", "online_since", "reboot_count", "last_reboot"] },
    { key: "history", rt: "history", keys: ["camera_name", "ip_address", "cam_up_hrs", "cam_down_hrs", "rec_up_hrs", "rec_down_hrs", "storage_consumed"] },
  ];
  const dsKeys = (d) => d.keys.filter((k) => !(d.key === "live" && rSource === "built_in" && k === "details"));

  const saveBlob = (blob, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };

  const csvOf = (list, r) => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return "﻿" + list.map((d) => {
      const keys = dsKeys(d);
      return [T("rt." + d.rt), keys.join(","), ...(r[d.key] || []).map((row) => keys.map((k) => esc(row[k])).join(","))].join("\n");
    }).join("\n\n");
  };

  const exportCsv = async (only) => {
    const r = rep || (await generate());
    if (!r) return;
    const list = only ? DATASETS.filter((d) => d.rt === only) : DATASETS;
    const blob = new Blob([csvOf(list, r)], { type: "text/csv;charset=utf-8" });
    const name = only ? `${only}_report.csv` : "vms_report.csv";
    saveBlob(blob, name);
  };

  const exportXlsx = async () => {
    const r = rep || (await generate());
    if (!r) return;
    const wb = XLSX.utils.book_new();
    DATASETS.forEach((d) => {
      const keys = dsKeys(d);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((r[d.key] || []).map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])))), d.rt.slice(0, 31));
    });
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveBlob(blob, "vms_report.xlsx");
  };

  const rd = useMemo(() => {
    if (!rep) return null;
    const a = rep.alerts || [], live = rep.live || [], h = rep.health || [], hs = rep.history || [];
    const fromT = new Date(rFrom).getTime(), toT = new Date(rTo).getTime();
    const nDays = Math.min(14, Math.max(7, Math.ceil((toT - fromT) / 86400000)));
    const anchor = toT;
    const days = Array.from({ length: nDays }, (_, i) => dayKey(new Date(anchor - (nDays - 1 - i) * 86400000)));
    const dayIdx = (ts) => days.indexOf(String(ts).slice(0, 10));

    const offs = a.filter((r) => /offline/i.test(r.event));
    const perDay = days.map(() => 0);
    offs.forEach((r) => { const i = dayIdx(r.timestamp); if (i >= 0) perDay[i]++; });
    const byCam = {};
    offs.forEach((r) => { const n = nameByIp(r.ip); byCam[n] = (byCam[n] || 0) + 1; });
    const offenders = Object.entries(byCam).sort((x, y) => y[1] - x[1]).slice(0, 5);

    const typeCount = {};
    live.forEach((r) => { typeCount[r.classification] = (typeCount[r.classification] || 0) + 1; });
    const types = Object.entries(typeCount).sort((x, y) => y[1] - x[1]);

    const camCount = {};
    live.forEach((r) => { camCount[r.ip_address] = (camCount[r.ip_address] || 0) + 1; });
    const hot = Object.entries(camCount).sort((x, y) => y[1] - x[1]).slice(0, 6);

    const online = h.filter((r) => String(r.current_status).toLowerCase() === "online").length;
    const byGroup = {};
    h.forEach((r) => {
      const g = r._group || r.device_type;
      byGroup[g] = byGroup[g] || [0, 0];
      byGroup[g][1]++;
      if (String(r.current_status).toLowerCase() === "online") byGroup[g][0]++;
    });

    const reboots = h.map((r) => ({ n: r._name || r.ip_address, ip: r.ip_address, c: num(r.reboot_count) })).filter((r) => r.c > 0).sort((x, y) => y.c - x.c).slice(0, 5);

    const pct = (u, d) => (u + d > 0 ? (u / (u + d)) * 100 : 100);
    const av = hs.map((r) => ({ n: r.camera_name, v: pct(r._up, r._down) })).sort((x, y) => x.v - y.v);
    const rel = hs.map((r) => ({ n: r.camera_name, v: pct(r._rup, r._rdown) })).sort((x, y) => x.v - y.v);

    return {
      days, perDay, offs, offenders, types, hot, live, online, h, byGroup, reboots, av, rel,
      nCamsOff: new Set(offs.map((r) => r.ip)).size
    };
  }, [rep, rFrom, rTo, nameByIp]);

  const sec = (k, title, sub, children) => (
    <div key={k} ref={(el) => { secRefs.current[k] = el; }} className="dn-sec">
      <div className="dn-grph"><h3>{title}</h3><span>{sub}</span></div>
      <div className="dn-grid">{children}</div>
    </div>
  );

  return (
    <div className="dn-page" style={{ padding: "calc(20 * var(--u))" }}>
      <div className="dn-hd">
        <div>
          <h1>{T("reports")}</h1>
        </div>
        <div className="dn-ctl">
          <button type="button" className="dn-btn" onClick={generate}>
            <IcRefresh />{T("refresh")}
          </button>
        </div>
      </div>

      <div className="dn-reports-wrap">
        <section className="dn-panel c12" style={{ marginBottom: "calc(16 * var(--u))" }}>
          <div className="dn-ph">
            <div>
              <h2>{T("reportPeriod")}</h2>
              <small className="dn-s2">{T("appliesToAll")}</small>
            </div>
          </div>
          <div className="dn-form four">
            <div className="dn-fld">
              <label>{T("from")}</label>
              <div className="dn-inp"><input type="datetime-local" value={rFrom} onChange={(e) => setRFrom(e.target.value)} /></div>
            </div>
            <div className="dn-fld">
              <label>{T("to")}</label>
              <div className="dn-inp"><input type="datetime-local" value={rTo} onChange={(e) => setRTo(e.target.value)} /></div>
            </div>
            <div className="dn-fld">
              <label>{T("source")}</label>
              <div className="dn-inp">
                <select value={rSource} onChange={(e) => setRSource(e.target.value)}>
                  <option value="all">{T("allEvents")}</option>
                  <option value="built_in">{T("builtIn")}</option>
                  {isAiActive && <option value="external_ai">Mirador AI</option>}
                </select>
              </div>
            </div>
            <div className="dn-fld">
              <label>{T("status")}</label>
              <div className="dn-inp">
                <select value={rStatus} onChange={(e) => setRStatus(e.target.value)}>
                  <option value="all">All</option>
                  <option value="Active">{T("s.active")}</option>
                  <option value="Acknowledged">{T("s.acknowledged")}</option>
                  <option value="Resolved">{T("s.resolved")}</option>
                </select>
              </div>
            </div>
          </div>
          <div className="dn-flex" style={{ marginTop: "calc(16 * var(--u))", gap: "calc(10 * var(--u))", flexWrap: "wrap", alignItems: "center" }}>
            <div className="dn-chips">
              {[["today", T("today")], ["7d", T("days7")], ["30d", T("days30")]].map(([k, lbl]) => (
                <button key={k} type="button" className={`dn-chip ${range === k ? "on" : ""}`} onClick={() => pickRange(k)}>{lbl}</button>
              ))}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: "calc(8 * var(--u))" }}>
              <button type="button" className="dn-btn pri" disabled={rLoading} onClick={generate}>
                {rLoading ? T("generating") : T("generateReport")}
              </button>
              <button type="button" className="dn-btn" onClick={() => exportCsv()}>{T("exportCsv")}</button>
              <button type="button" className="dn-btn" onClick={() => exportXlsx()}>{T("exportExcel")}</button>
            </div>
          </div>
          {rMsg && <div className="dn-note" style={{ marginTop: "calc(10 * var(--u))" }}>{rMsg}</div>}
        </section>

        {rep && rd && (
          <div className="dn-sec-wrap">
            {sec("outages", T("outageTimeline"), T("offlineAcross", { n: rd.offs.length, m: rd.nCamsOff }), (
              <>
                <Panel className="c8" title={T("offlinePerDay")}>
                  <BarChart items={rd.perDay.map((val, idx) => ({ label: rd.days[idx], value: val }))} xLabels={rd.days.map((d, i) => [i, d.slice(5)])} />
                </Panel>
                <Panel className="c4" title={T("topOffenders")}>
                  <HBars rows={rd.offenders} />
                </Panel>
                <div className="c12">
                  <DataTable rows={rep.alerts || []} keys={dsKeys(DATASETS[0])} T={T} />
                </div>
              </>
            ))}

            {sec("alerts", T("alertBreakdown"), T("alertsInPeriod", { n: rd.live.length }), (
              <>
                <Panel className="c8" title={T("alertVolume")}>
                  <HBars rows={rd.types.map(([t, count]) => [t, count])} />
                </Panel>
                <Panel className="c4" title={T("cameraHotspots")}>
                  <HBars rows={rd.hot} />
                </Panel>
                <div className="c12">
                  <DataTable rows={rep.live || []} keys={dsKeys(DATASETS[1])} T={T} />
                </div>
              </>
            ))}

            {sec("health", T("fleetHealthOverview"), T("devicesChecked", { n: rd.h.length }), (
              <>
                <Panel className="c6" title={T("onlineOfflineDevices")}>
                  <div className="dn-stat3 colr">
                    <div>Online<b>{rd.online}</b></div>
                    <div>Offline<b>{rd.h.length - rd.online}</b></div>
                  </div>
                  <HBars rows={Object.entries(rd.byGroup).map(([grp, [on, total]]) => [grp, on, ` / ${total}`])} />
                </Panel>
                <Panel className="c6" title={T("rebootRanking")}>
                  <HBars rows={rd.reboots.map((r) => [r.n, r.c])} />
                </Panel>
                <div className="c12">
                  <DataTable rows={rep.health || []} keys={dsKeys(DATASETS[2])} T={T} />
                </div>
              </>
            ))}

            {sec("history", T("camAvail"), T("hoursConnected"), (
              <>
                <Panel className="c6" title={T("camAvailShort")}>
                  <HBars rows={rd.av.slice(0, 6).map((x) => [x.n, Number(x.v.toFixed(1)), "%"])} />
                </Panel>
                <Panel className="c6" title={T("recReliabilityShort")}>
                  <HBars rows={rd.rel.slice(0, 6).map((x) => [x.n, Number(x.v.toFixed(1)), "%"])} />
                </Panel>
                <div className="c12">
                  <DataTable rows={rep.history || []} keys={dsKeys(DATASETS[3])} T={T} />
                </div>
              </>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
