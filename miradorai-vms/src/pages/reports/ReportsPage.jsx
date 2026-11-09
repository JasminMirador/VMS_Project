import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import { useI18n } from "../../i18n";
import "../Dashboard/DashboardNewPage.css";
import { apiUrl } from "../../config/appConfig";

/* ───────────────────────── data helpers ───────────────────────── */
const getAuthHeaders = () => {
  const token = localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token");
  return token ? { Authorization: "Bearer " + token } : {};
};
const api = async (path) => {
  const cleanPath = path.startsWith("/api") ? path.slice(4) : path;
  const res = await fetch(apiUrl(cleanPath), { headers: getAuthHeaders() });
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

/* ───────────────────────── tiny svg icons ───────────────────────── */
const I16 = ({ children }) => <svg viewBox="0 0 16 16" aria-hidden="true">{children}</svg>;
const I24 = ({ children }) => <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>;
const IcRefresh = () => <I24><path d="M20 11a8 8 0 00-14.4-4.2L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0014.4 4.2l1.6-1.7M20 20v-4.5h-4.5" /></I24>;
const IcSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

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

/* ───────────────────────── custom themed dropdowns ───────────────────────── */
function ThemedSelect({ value, onChange, options, placeholder = "Select..." }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleOutside);
    }
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const selectedOption = options.find((o) => o.value === value) || options[0];

  return (
    <div className="dn-themed-select" ref={ref}>
      <button
        type="button"
        className={`dn-select-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="dn-select-label">{selectedOption ? selectedOption.label : placeholder}</span>
        <svg
          className={`dn-select-chevron ${open ? "rotated" : ""}`}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 8 10 12 14 8" />
        </svg>
      </button>
      {open && (
        <div className="dn-select-menu">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                className={`dn-select-option ${isSelected ? "selected" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <svg className="dn-select-check" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExportDropdown({ onExportCsv, onExportXlsx, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleOutside);
    }
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div className="dn-dropdown-wrap" ref={ref}>
      <button
        type="button"
        className={`dn-btn ${open ? "on" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>Export</span>
        <svg
          style={{
            width: "calc(13 * var(--u))",
            height: "calc(13 * var(--u))",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.2s ease"
          }}
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 8 10 12 14 8" />
        </svg>
      </button>

      {open && (
        <div className="dn-dropdown-menu">
          <button
            type="button"
            className="dn-dropdown-item"
            onClick={() => {
              onExportCsv();
              setOpen(false);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <span>Export CSV (.csv)</span>
          </button>
          <button
            type="button"
            className="dn-dropdown-item"
            onClick={() => {
              onExportXlsx();
              setOpen(false);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <path d="M8 13h8M8 17h8M12 13v8" />
            </svg>
            <span>Export Excel (.xlsx)</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── custom table views ───────────────────────── */
function HistoryTable({ rows, T }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      String(r.camera_name || "").toLowerCase().includes(q) ||
      String(r.ip_address || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="dn-panel" style={{ padding: "calc(18 * var(--u))" }}>
      <div className="dn-ph" style={{ marginBottom: "calc(14 * var(--u))" }}>
        <div>
          <h2>{T("rt.history")}</h2>
          <small className="dn-s2">
            {filtered.length} {filtered.length === 1 ? "camera" : "cameras"} recorded • Camera & recording availability with storage consumption
          </small>
        </div>
        <div className="dn-ph-r">
          <div className="dn-srch">
            <IcSearch />
            <input
              type="text"
              placeholder="Search camera or IP…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      </div>

      <div className="dn-scroll">
        <table className="dn-tbl">
          <thead>
            <tr>
              <th>Camera Name</th>
              <th>IP Address</th>
              <th>Cam Up (hrs)</th>
              <th>Cam Down (hrs)</th>
              <th>Rec Up (hrs)</th>
              <th>Rec Down (hrs)</th>
              <th>Storage Consumed</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.length === 0 ? (
              <tr>
                <td colSpan="7" className="dn-empty">No camera history records found.</td>
              </tr>
            ) : (
              currentRows.map((r, i) => (
                <tr key={r.ip_address + i}>
                  <td><b>{r.camera_name}</b></td>
                  <td className="muted">{r.ip_address}</td>
                  <td style={{ color: "var(--dn-ok, #22c55e)", fontWeight: "600" }}>{r.cam_up_hrs}</td>
                  <td style={{ color: "var(--dn-crit-t, #ef4444)", fontWeight: "600" }}>{r.cam_down_hrs}</td>
                  <td style={{ color: "var(--dn-ok, #22c55e)", fontWeight: "600" }}>{r.rec_up_hrs}</td>
                  <td style={{ color: "var(--dn-crit-t, #ef4444)", fontWeight: "600" }}>{r.rec_down_hrs}</td>
                  <td>
                    <span style={{
                      display: "inline-block",
                      background: "rgba(34, 211, 238, 0.12)",
                      color: "var(--dn-brand, #22d3ee)",
                      padding: "calc(3 * var(--u)) calc(8 * var(--u))",
                      borderRadius: "calc(6 * var(--u))",
                      fontWeight: "700",
                      fontSize: "calc(12.5 * var(--u))"
                    }}>
                      {r.storage_consumed}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="dn-foot">
        <span>Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} cameras</span>
        <span className="dn-pager">
          <button type="button" className="dn-btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span>{page} / {totalPages}</span>
          <button type="button" className="dn-btn sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
        </span>
      </div>
    </div>
  );
}

function AlertsTable({ rows, T }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      String(r.ip || "").toLowerCase().includes(q) ||
      String(r.event || "").toLowerCase().includes(q) ||
      String(r.model || "").toLowerCase().includes(q) ||
      String(r.message || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="dn-panel" style={{ padding: "calc(18 * var(--u))" }}>
      <div className="dn-ph" style={{ marginBottom: "calc(14 * var(--u))" }}>
        <div>
          <h2>{T("rt.alerts")}</h2>
          <small className="dn-s2">{filtered.length} events recorded</small>
        </div>
        <div className="dn-ph-r">
          <div className="dn-srch">
            <IcSearch />
            <input
              type="text"
              placeholder="Search IP, event, model…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      </div>

      <div className="dn-scroll">
        <table className="dn-tbl">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Device IP</th>
              <th>Model</th>
              <th>Type</th>
              <th>Event</th>
              <th>Message</th>
              <th>Acknowledged</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.length === 0 ? (
              <tr>
                <td colSpan="7" className="dn-empty">No camera events found.</td>
              </tr>
            ) : (
              currentRows.map((r, i) => {
                const isOff = /offline/i.test(r.event);
                return (
                  <tr key={i}>
                    <td className="muted">{r.timestamp ? new Date(r.timestamp).toLocaleString() : "—"}</td>
                    <td><b>{r.ip}</b></td>
                    <td>{r.model}</td>
                    <td>{r.type}</td>
                    <td>
                      <span style={{
                        display: "inline-block",
                        background: isOff ? "rgba(239, 68, 68, 0.15)" : "rgba(34, 197, 94, 0.15)",
                        color: isOff ? "var(--dn-crit-t, #ef4444)" : "var(--dn-ok, #22c55e)",
                        padding: "calc(2 * var(--u)) calc(8 * var(--u))",
                        borderRadius: "calc(99 * var(--u))",
                        fontWeight: "600",
                        fontSize: "calc(11.5 * var(--u))",
                        textTransform: "uppercase"
                      }}>
                        {r.event?.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td>{r.message}</td>
                    <td>
                      <span style={{
                        fontWeight: "600",
                        color: r.acknowledged === "Yes" ? "var(--dn-ok, #22c55e)" : "var(--dn-muted)"
                      }}>
                        {r.acknowledged}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="dn-foot">
        <span>Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} records</span>
        <span className="dn-pager">
          <button type="button" className="dn-btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span>{page} / {totalPages}</span>
          <button type="button" className="dn-btn sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
        </span>
      </div>
    </div>
  );
}

function LiveAlertsTable({ rows, rSource, T }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      String(r.ip_address || "").toLowerCase().includes(q) ||
      String(r.classification || "").toLowerCase().includes(q) ||
      String(r.event || "").toLowerCase().includes(q) ||
      String(r.details || "").toLowerCase().includes(q) ||
      String(r.status || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="dn-panel" style={{ padding: "calc(18 * var(--u))" }}>
      <div className="dn-ph" style={{ marginBottom: "calc(14 * var(--u))" }}>
        <div>
          <h2>{T("rt.live_alerts")}</h2>
          <small className="dn-s2">{filtered.length} analytics events detected</small>
        </div>
        <div className="dn-ph-r">
          <div className="dn-srch">
            <IcSearch />
            <input
              type="text"
              placeholder="Search IP, event, status…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      </div>

      <div className="dn-scroll">
        <table className="dn-tbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>Camera IP</th>
              <th>Classification</th>
              <th>Event</th>
              {rSource !== "built_in" && <th>Details</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.length === 0 ? (
              <tr>
                <td colSpan={rSource !== "built_in" ? 6 : 5} className="dn-empty">No analytics alerts found.</td>
              </tr>
            ) : (
              currentRows.map((r, i) => {
                const isResolved = r.status === "Resolved";
                const isAck = r.status === "Acknowledged";
                return (
                  <tr key={i}>
                    <td className="muted">{r.timestamp ? new Date(r.timestamp).toLocaleString() : "—"}</td>
                    <td><b>{r.ip_address}</b></td>
                    <td><span className="dn-tag">{r.classification}</span></td>
                    <td>{r.event}</td>
                    {rSource !== "built_in" && <td>{r.details}</td>}
                    <td>
                      <span style={{
                        display: "inline-block",
                        background: isResolved ? "rgba(34, 197, 94, 0.15)" : isAck ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)",
                        color: isResolved ? "var(--dn-ok, #22c55e)" : isAck ? "var(--dn-warn, #f59e0b)" : "var(--dn-crit-t, #ef4444)",
                        padding: "calc(2 * var(--u)) calc(8 * var(--u))",
                        borderRadius: "calc(99 * var(--u))",
                        fontWeight: "600",
                        fontSize: "calc(11.5 * var(--u))"
                      }}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="dn-foot">
        <span>Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} records</span>
        <span className="dn-pager">
          <button type="button" className="dn-btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span>{page} / {totalPages}</span>
          <button type="button" className="dn-btn sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
        </span>
      </div>
    </div>
  );
}

function HealthTable({ rows, T }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      String(r.device_id || "").toLowerCase().includes(q) ||
      String(r.ip_address || "").toLowerCase().includes(q) ||
      String(r.manufacturer || "").toLowerCase().includes(q) ||
      String(r.model || "").toLowerCase().includes(q) ||
      String(r.device_type || "").toLowerCase().includes(q) ||
      String(r.current_status || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="dn-panel" style={{ padding: "calc(18 * var(--u))" }}>
      <div className="dn-ph" style={{ marginBottom: "calc(14 * var(--u))" }}>
        <div>
          <h2>{T("rt.health")}</h2>
          <small className="dn-s2">{filtered.length} infrastructure devices monitored</small>
        </div>
        <div className="dn-ph-r">
          <div className="dn-srch">
            <IcSearch />
            <input
              type="text"
              placeholder="Search device, IP, type…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      </div>

      <div className="dn-scroll">
        <table className="dn-tbl">
          <thead>
            <tr>
              <th>Device ID</th>
              <th>IP Address</th>
              <th>Manufacturer & Model</th>
              <th>Type</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Uptime</th>
              <th>Online Since</th>
              <th>Reboots</th>
              <th>Last Reboot</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.length === 0 ? (
              <tr>
                <td colSpan="10" className="dn-empty">No device health records found.</td>
              </tr>
            ) : (
              currentRows.map((r, i) => {
                const isOnline = String(r.current_status).toLowerCase() === "online";
                const reboots = num(r.reboot_count);
                return (
                  <tr key={i}>
                    <td><b>{r.device_id}</b></td>
                    <td className="muted">{r.ip_address}</td>
                    <td>{r.manufacturer} {r.model}</td>
                    <td><span className="dn-tag">{r.device_type}</span></td>
                    <td>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "calc(6 * var(--u))",
                        background: isOnline ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                        color: isOnline ? "var(--dn-ok, #22c55e)" : "var(--dn-crit-t, #ef4444)",
                        padding: "calc(2 * var(--u)) calc(8 * var(--u))",
                        borderRadius: "calc(99 * var(--u))",
                        fontWeight: "600",
                        fontSize: "calc(11.5 * var(--u))"
                      }}>
                        <i style={{
                          width: "calc(7 * var(--u))",
                          height: "calc(7 * var(--u))",
                          borderRadius: "50%",
                          background: isOnline ? "var(--dn-ok, #22c55e)" : "var(--dn-crit, #ef4444)"
                        }} />
                        {r.current_status}
                      </span>
                    </td>
                    <td>{r.latency_ms}</td>
                    <td>{r.uptime_duration}</td>
                    <td className="muted">{r.online_since !== "—" ? new Date(r.online_since).toLocaleString() : "—"}</td>
                    <td style={{ color: reboots > 0 ? "var(--dn-crit-t, #ef4444)" : "var(--dn-text)", fontWeight: reboots > 0 ? "700" : "400" }}>
                      {r.reboot_count}
                    </td>
                    <td className="muted">{r.last_reboot !== "—" ? new Date(r.last_reboot).toLocaleString() : "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="dn-foot">
        <span>Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} records</span>
        <span className="dn-pager">
          <button type="button" className="dn-btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span>{page} / {totalPages}</span>
          <button type="button" className="dn-btn sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>›</button>
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────── main component ───────────────────────── */
export default function ReportsPage() {
  const { t } = useI18n();
  const T = useCallback((k, p) => t("dashNew." + k, p), [t]);

  // Filters state
  const [reportType, setReportType] = useState("history"); // history, alerts, live, health, all
  const [viewMode, setViewMode] = useState("tabular"); // tabular | graphical
  const [range, setRange] = useState("today");
  const [rFrom, setRFrom] = useState(toLocalInput(startOfDay()));
  const [rTo, setRTo] = useState(toLocalInput(new Date()));
  const [rSource, setRSource] = useState("all");
  const [rStatus, setRStatus] = useState("all");
  const [allSubTab, setAllSubTab] = useState("history");

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
      safe(`/api/reports/history?from_date=${fromIso}&to_date=${toIso}`),
      safe(`/api/reports/history?from_date=${prevFrom}&to_date=${fromIso}`),
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
        const storageGb = (num(c.storage_consumed_bytes) / 1024 ** 3);
        return {
          camera_name: c.name || "—",
          ip_address: c.ip || "—",
          cam_up_hrs: hh(c.camera_hours_up),
          cam_down_hrs: hh(c.camera_hours_down),
          rec_up_hrs: hh(c.recording_hours_up),
          rec_down_hrs: hh(c.recording_hours_down),
          storage_consumed: storageGb.toFixed(2) + " GB",
          _storageGb: storageGb,
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
      setRMsg(T("reportFail") || "Failed to generate report.");
      return null;
    } finally {
      setRLoading(false);
    }
  }, [buildReports, rFrom, rTo, rSource, rStatus, T]);

  useEffect(() => {
    generate();
  }, [generate]);

  const pickRange = (k) => {
    setRange(k);
    const d = k === "today" ? 0 : k === "7d" ? 7 : 30;
    const from = startOfDay(new Date(Date.now() - d * 86400000));
    setRFrom(toLocalInput(from));
    setRTo(toLocalInput(new Date()));
  };

  const DATASETS = [
    { key: "history", rt: "history", label: "Camera & Recording History", keys: ["camera_name", "ip_address", "cam_up_hrs", "cam_down_hrs", "rec_up_hrs", "rec_down_hrs", "storage_consumed"] },
    { key: "alerts", rt: "alerts", label: "Camera Up/Down Events", keys: ["timestamp", "ip", "model", "type", "event", "message", "acknowledged"] },
    { key: "live", rt: "live_alerts", label: "Analytics Alerts", keys: ["timestamp", "ip_address", "classification", "event", "details", "status"] },
    { key: "health", rt: "health", label: "Device Health & Uptime", keys: ["device_id", "ip_address", "manufacturer", "model", "device_type", "current_status", "latency_ms", "uptime_duration", "online_since", "reboot_count", "last_reboot"] },
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
      return [T("rt." + d.rt) || d.label, keys.join(","), ...(r[d.key] || []).map((row) => keys.map((k) => esc(row[k])).join(","))].join("\n");
    }).join("\n\n");
  };

  const exportCsv = async () => {
    const r = rep || (await generate());
    if (!r) return;
    const targetKey = reportType === "all" ? null : reportType;
    const list = targetKey ? DATASETS.filter((d) => d.key === targetKey || d.rt === targetKey) : DATASETS;
    const blob = new Blob([csvOf(list, r)], { type: "text/csv;charset=utf-8" });
    const name = targetKey ? `${targetKey}_report.csv` : "vms_report.csv";
    saveBlob(blob, name);
  };

  const exportXlsx = async () => {
    const r = rep || (await generate());
    if (!r) return;
    const targetKey = reportType === "all" ? null : reportType;
    const list = targetKey ? DATASETS.filter((d) => d.key === targetKey || d.rt === targetKey) : DATASETS;
    const wb = XLSX.utils.book_new();
    list.forEach((d) => {
      const keys = dsKeys(d);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((r[d.key] || []).map((row) => Object.fromEntries(keys.map((k) => [k, row[k]])))), d.rt.slice(0, 31));
    });
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const name = targetKey ? `${targetKey}_report.xlsx` : "vms_report.xlsx";
    saveBlob(blob, name);
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
    const storageRank = [...hs].sort((x, y) => (y._storageGb || 0) - (x._storageGb || 0)).slice(0, 6).map((r) => [r.camera_name, Number((r._storageGb || 0).toFixed(2)), "GB"]);

    return {
      days, perDay, offs, offenders, types, hot, live, online, h, byGroup, reboots, av, rel, storageRank,
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
        {/* Controls Card */}
        <section className="dn-panel c12" style={{ marginBottom: "calc(16 * var(--u))" }}>
          <div className="dn-ph">
            <div>
              <h2>{T("reportPeriod") || "Report Period & Filters"}</h2>
              <small className="dn-s2">Configure time range, report type, and target filters</small>
            </div>
          </div>

          <div
            className="dn-form"
            style={{
              gridTemplateColumns:
                reportType === "live"
                  ? (isAiActive ? "repeat(auto-fit, minmax(210px, 1fr))" : "repeat(auto-fit, minmax(220px, 1fr))")
                  : reportType === "all"
                  ? "repeat(auto-fit, minmax(220px, 1fr))"
                  : "repeat(auto-fit, minmax(240px, 1fr))",
              margin: 0
            }}
          >
            {/* From Date */}
            <div className="dn-fld">
              <label>{T("from")}</label>
              <div className="dn-inp">
                <input type="datetime-local" value={rFrom} onChange={(e) => setRFrom(e.target.value)} />
              </div>
            </div>

            {/* To Date */}
            <div className="dn-fld">
              <label>{T("to")}</label>
              <div className="dn-inp">
                <input type="datetime-local" value={rTo} onChange={(e) => setRTo(e.target.value)} />
              </div>
            </div>

            {/* Report Type Dropdown */}
            <div className="dn-fld">
              <label>{T("reportType") || "Report Type"}</label>
              <ThemedSelect
                value={reportType}
                onChange={setReportType}
                options={[
                  { value: "history", label: "Camera and recording history" },
                  { value: "alerts", label: "Camera up and down events" },
                  { value: "live", label: "Analytics alerts" },
                  { value: "health", label: "Device health and uptime" },
                  { value: "all", label: "All Reports (Combined Overview)" }
                ]}
              />
            </div>

            {(reportType === "live" || reportType === "all") && (
              <div className="dn-fld">
                <label>{T("source")}</label>
                <ThemedSelect
                  value={rSource}
                  onChange={setRSource}
                  options={[
                    { value: "all", label: T("allEvents") || "All Events" },
                    { value: "built_in", label: T("builtIn") || "Built-in" },
                    ...(isAiActive ? [{ value: "external_ai", label: "Mirador AI" }] : [])
                  ]}
                />
              </div>
            )}

            {(reportType === "live") && (
              <div className="dn-fld">
                <label>{T("status")}</label>
                <ThemedSelect
                  value={rStatus}
                  onChange={setRStatus}
                  options={[
                    { value: "all", label: "All Statuses" },
                    { value: "Active", label: T("s.active") || "Active" },
                    { value: "Acknowledged", label: T("s.acknowledged") || "Acknowledged" },
                    { value: "Resolved", label: T("s.resolved") || "Resolved" }
                  ]}
                />
              </div>
            )}
          </div>

          {/* Quick Date Chips & View Toggle Bar */}
          <div className="dn-flex" style={{ marginTop: "calc(16 * var(--u))", gap: "calc(12 * var(--u))", flexWrap: "wrap", alignItems: "center" }}>
            <div className="dn-chips">
              {[["today", T("today")], ["7d", T("days7")], ["30d", T("days30")]].map(([k, lbl]) => (
                <button key={k} type="button" className={`dn-chip ${range === k ? "on" : ""}`} onClick={() => pickRange(k)}>{lbl}</button>
              ))}
            </div>

            {/* View Mode Toggle: Tabular vs Graphical */}
            <div className="dn-seg" style={{ marginInlineStart: "auto" }}>
              <button
                type="button"
                className={viewMode === "tabular" ? "on" : ""}
                onClick={() => setViewMode("tabular")}
              >
                Tabular View
              </button>
              <button
                type="button"
                className={viewMode === "graphical" ? "on" : ""}
                onClick={() => setViewMode("graphical")}
              >
                Graphical View
              </button>
            </div>

            <div style={{ display: "flex", gap: "calc(8 * var(--u))", alignItems: "center" }}>
              <button type="button" className="dn-btn pri" disabled={rLoading} onClick={generate}>
                {rLoading ? T("generating") : T("generateReport")}
              </button>
              <ExportDropdown onExportCsv={exportCsv} onExportXlsx={exportXlsx} disabled={rLoading} />
            </div>
          </div>

          {rMsg && <div className="dn-note" style={{ marginTop: "calc(10 * var(--u))" }}>{rMsg}</div>}
        </section>

        {/* Report Content */}
        {rep && (
          <div className="dn-sec-wrap">
            {/* ───────────── TABULAR VIEW ───────────── */}
            {viewMode === "tabular" && (
              <>
                {reportType === "history" && (
                  <HistoryTable rows={rep.history || []} T={T} />
                )}

                {reportType === "alerts" && (
                  <AlertsTable rows={rep.alerts || []} T={T} />
                )}

                {reportType === "live" && (
                  <LiveAlertsTable rows={rep.live || []} rSource={rSource} T={T} />
                )}

                {reportType === "health" && (
                  <HealthTable rows={rep.health || []} T={T} />
                )}

                {reportType === "all" && (
                  <div className="dn-panel" style={{ padding: "calc(20 * var(--u))" }}>
                    <div className="dn-tabs" style={{ marginBottom: "calc(16 * var(--u))" }}>
                      <button className={allSubTab === "history" ? "on" : ""} onClick={() => setAllSubTab("history")}>
                        {T("rt.history")}
                      </button>
                      <button className={allSubTab === "alerts" ? "on" : ""} onClick={() => setAllSubTab("alerts")}>
                        {T("rt.alerts")}
                      </button>
                      <button className={allSubTab === "live" ? "on" : ""} onClick={() => setAllSubTab("live")}>
                        {T("rt.live_alerts")}
                      </button>
                      <button className={allSubTab === "health" ? "on" : ""} onClick={() => setAllSubTab("health")}>
                        {T("rt.health")}
                      </button>
                    </div>

                    {allSubTab === "history" && <HistoryTable rows={rep.history || []} T={T} />}
                    {allSubTab === "alerts" && <AlertsTable rows={rep.alerts || []} T={T} />}
                    {allSubTab === "live" && <LiveAlertsTable rows={rep.live || []} rSource={rSource} T={T} />}
                    {allSubTab === "health" && <HealthTable rows={rep.health || []} T={T} />}
                  </div>
                )}
              </>
            )}

            {/* ───────────── GRAPHICAL VIEW ───────────── */}
            {viewMode === "graphical" && rd && (
              <>
                {(reportType === "history" || reportType === "all") && sec("history", T("camAvail"), T("hoursConnected"), (
                  <>
                    <Panel className="c4" title={T("camAvailShort")}>
                      <HBars rows={rd.av.slice(0, 6).map((x) => [x.n, Number(x.v.toFixed(1)), "%"])} />
                    </Panel>
                    <Panel className="c4" title={T("recReliabilityShort")}>
                      <HBars rows={rd.rel.slice(0, 6).map((x) => [x.n, Number(x.v.toFixed(1)), "%"])} />
                    </Panel>
                    <Panel className="c4" title="Storage Consumed by Camera">
                      <HBars rows={rd.storageRank} color="var(--dn-brand)" />
                    </Panel>
                  </>
                ))}

                {(reportType === "alerts" || reportType === "all") && sec("outages", T("outageTimeline"), T("offlineAcross", { n: rd.offs.length, m: rd.nCamsOff }), (
                  <>
                    <Panel className="c8" title={T("offlinePerDay")}>
                      <BarChart items={rd.perDay.map((val, idx) => ({ label: rd.days[idx], value: val }))} xLabels={rd.days.map((d, i) => [i, d.slice(5)])} />
                    </Panel>
                    <Panel className="c4" title={T("topOffenders")}>
                      <HBars rows={rd.offenders} />
                    </Panel>
                  </>
                ))}

                {(reportType === "live" || reportType === "all") && sec("alerts", T("alertBreakdown"), T("alertsInPeriod", { n: rd.live.length }), (
                  <>
                    <Panel className="c8" title={T("alertVolume")}>
                      <HBars rows={rd.types.map(([t, count]) => [t, count])} />
                    </Panel>
                    <Panel className="c4" title={T("cameraHotspots")}>
                      <HBars rows={rd.hot} />
                    </Panel>
                  </>
                ))}

                {(reportType === "health" || reportType === "all") && sec("health", T("fleetHealthOverview"), T("devicesChecked", { n: rd.h.length }), (
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
                  </>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
