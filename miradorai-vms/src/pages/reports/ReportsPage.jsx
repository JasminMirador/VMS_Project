import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { useI18n } from "../../i18n";
import "../Dashboard/DashboardNewPage.css";
import "./ReportsPage.css";
import { apiUrl, getEnv } from "../../config/appConfig";
import AiAlertModal from "../../components/shared/AiAlertModal";

/* ───────────────────────── data helpers ───────────────────────── */
const getAuthHeaders = () => {
  const token = localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token");
  return token ? { Authorization: "Bearer " + token } : {};
};
const api = async (path, timeoutMs = 12000) => {
  const cleanPath = path.startsWith("/api") ? path.slice(4) : path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl(cleanPath), {
      headers: getAuthHeaders(),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(path + " " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
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

function ExportDropdown({ onExportCsv, onExportXlsx, onExportPdf, onPrint, disabled }) {
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
          {onExportPdf && (
            <button
              type="button"
              className="dn-dropdown-item"
              onClick={() => {
                onExportPdf();
                setOpen(false);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              <span>Export PDF (.pdf)</span>
            </button>
          )}
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
          {onPrint && (
            <button
              type="button"
              className="dn-dropdown-item"
              onClick={() => {
                onPrint();
                setOpen(false);
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              <span>Print Report</span>
            </button>
          )}
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
    const q = search.toLowerCase().trim();
    return rows.filter((r) => {
      const ip = String(r.ip || "").toLowerCase();
      const ev = String(r.event || "").toLowerCase();
      const camName = String(r.camera_name || r.model || "").toLowerCase();
      const msg = String(r.message || "").toLowerCase();
      if (ip.includes(q) || ev.includes(q) || camName.includes(q) || msg.includes(q)) return true;
      if (q === "up" && (ev.includes("online") || msg.includes("online"))) return true;
      if (q === "down" && (ev.includes("offline") || msg.includes("offline"))) return true;
      return false;
    });
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
              placeholder="Search IP, event, cam name…"
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
              <th>Cam Name</th>
              <th>Event</th>
              <th>Message</th>
              <th>Acknowledged</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.length === 0 ? (
              <tr>
                <td colSpan="6" className="dn-empty">No camera events found.</td>
              </tr>
            ) : (
              currentRows.map((r, i) => {
                const isOff = /offline/i.test(r.event);
                return (
                  <tr key={i}>
                    <td className="muted">{r.timestamp ? new Date(r.timestamp).toLocaleString() : "—"}</td>
                    <td><b>{r.ip}</b></td>
                    <td>{r.camera_name || r.model || "—"}</td>
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

/* ───────────────────────── alert image helpers ───────────────────────── */
function getAlertImagePaths(alert, externalAiIp) {
  if (!alert) return [];
  const raw = alert.rawData || alert.raw || alert || {};
  const dataObj = alert.data || raw.data || {};

  const findLoc = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    const key = Object.keys(obj).find((k) => {
      const normalized = k.toLowerCase().replace(/_/g, "");
      return (
        normalized === "imagelocation" ||
        normalized === "imglocation" ||
        normalized === "imgelocation"
      );
    });
    return key ? obj[key] : null;
  };

  const imgLoc =
    findLoc(alert) ||
    findLoc(raw) ||
    findLoc(dataObj) ||
    alert.imageLocation ||
    alert.image_location ||
    raw.imageLocation ||
    raw.image_location;

  const minioPort = getEnv("MINIO_PORT") || "9000";
  const externalAiHost =
    externalAiIp || getEnv("EXTERNAL_AI_HOST") || window.location.hostname;
  const externalAiServicePort = getEnv("EXTERNAL_AI_SERVICE_PORT") || "3000";

  const paths = [];

  if (imgLoc) {
    if (imgLoc.startsWith("http")) {
      paths.push(imgLoc);
    } else {
      const cleanLoc = imgLoc.replace(/^\//, "");
      paths.push(
        `http://${externalAiHost}:${minioPort}/${cleanLoc}`,
        `http://${externalAiHost}/minio/${cleanLoc}`,
        `http://${externalAiHost}:${externalAiServicePort}/${cleanLoc}`,
        apiUrl(`/${cleanLoc}`),
        `/${cleanLoc}`
      );
    }
  }

  const findFrameLoc = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    const key = Object.keys(obj).find((k) => {
      const normalized = k.toLowerCase().replace(/_/g, "");
      return normalized === "framelocation" || normalized === "frame_location";
    });
    return key ? obj[key] : null;
  };
  const frameLoc =
    findFrameLoc(alert) ||
    findFrameLoc(raw) ||
    findFrameLoc(dataObj) ||
    alert.frameLocation ||
    raw.frameLocation;

  if (frameLoc) {
    if (frameLoc.startsWith("http")) {
      paths.push(frameLoc);
    } else {
      const cleanLoc = frameLoc.replace(/^\//, "");
      paths.push(
        `http://${externalAiHost}:${minioPort}/${cleanLoc}`,
        `http://${externalAiHost}/minio/${cleanLoc}`,
        `http://${externalAiHost}:${externalAiServicePort}/${cleanLoc}`,
        apiUrl(`/${cleanLoc}`),
        `/${cleanLoc}`
      );
    }
  }

  const persistedCandidates = [
    alert.thumbnailUrl,
    alert.snapshot_url,
    alert.snapshotUrl,
    alert.snapshot,
    alert.imageUrl,
    alert.image,
    alert.face_url,
    raw.snapshot_url,
    raw.snapshotUrl,
    raw.snapshot,
    raw.image_url,
    raw.imageUrl,
    raw.image,
  ];

  for (const p of persistedCandidates) {
    if (p && typeof p === "string" && p !== "—") {
      if (p.startsWith("http") || p.startsWith("data:")) {
        paths.push(p);
      } else {
        const clean = p.startsWith("/") ? p : `/${p}`;
        paths.push(apiUrl(clean));
        paths.push(p);
      }
    }
  }

  const alertIp = (
    alert.ip ||
    alert.ip_address ||
    raw.readerIp ||
    raw.reader_ip ||
    raw.ip ||
    ""
  ).replace(/_/g, ".");
  const alertTime =
    alert.time ||
    alert.received_at ||
    alert.timestamp ||
    raw.detectionTime ||
    "";
  if (alertIp && alertTime && alertIp !== "—") {
    paths.push(
      apiUrl(
        `/event-playback/snapshot?ip=${encodeURIComponent(
          alertIp
        )}&time=${encodeURIComponent(alertTime)}`
      )
    );
  }

  return Array.from(new Set(paths.filter(Boolean)));
}

async function fetchImageBase64(paths) {
  if (!paths || paths.length === 0) return null;
  const token = localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token") || "";
  const headers = token ? { Authorization: "Bearer " + token } : {};

  for (const url of paths) {
    if (!url) continue;
    if (typeof url === "string" && url.startsWith("data:image")) {
      return { dataUrl: url, width: 100, height: 75 };
    }

    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (dataUrl && typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
          const dims = await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.naturalWidth || 100, height: img.naturalHeight || 75 });
            img.onerror = () => resolve({ width: 100, height: 75 });
            img.src = dataUrl;
          });
          return { dataUrl, ...dims };
        }
      }
    } catch (_) {}

    try {
      const imgRes = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || 200;
            canvas.height = img.naturalHeight || 150;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
            resolve({ dataUrl, width: canvas.width, height: canvas.height });
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = reject;
        img.src = url;
      });
      if (imgRes?.dataUrl) return imgRes;
    } catch (_) {}
  }
  return null;
}

function AlertThumbnailCell({ alert, externalAiIp, onClick }) {
  const [imgIdx, setImgIdx] = useState(0);
  const [hasError, setHasError] = useState(false);

  const paths = useMemo(() => {
    return getAlertImagePaths(alert, externalAiIp);
  }, [alert, externalAiIp]);

  useEffect(() => {
    setImgIdx(0);
    setHasError(false);
  }, [paths]);

  if (!paths || paths.length === 0 || hasError || imgIdx >= paths.length) {
    return (
      <div
        style={{
          width: "calc(56 * var(--u, 1px))",
          height: "calc(36 * var(--u, 1px))",
          borderRadius: "calc(6 * var(--u, 1px))",
          background: "rgba(148, 163, 184, 0.08)",
          border: "1px dashed var(--dn-line2, rgba(148, 163, 184, 0.25))",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--dn-muted, #94a3b8)",
          fontSize: "calc(11 * var(--u, 1px))",
          userSelect: "none"
        }}
        title="No image available"
      >
        —
      </div>
    );
  }

  return (
    <div
      style={{
        width: "calc(56 * var(--u, 1px))",
        height: "calc(36 * var(--u, 1px))",
        borderRadius: "calc(6 * var(--u, 1px))",
        overflow: "hidden",
        border: "1px solid var(--dn-line2, rgba(148, 163, 184, 0.25))",
        cursor: "pointer",
        position: "relative",
        background: "#0f172a",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
        transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
        verticalAlign: "middle"
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick && onClick();
      }}
      title="Click to view alert details and snapshot"
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "scale(1.08)";
        e.currentTarget.style.borderColor = "var(--dn-brand, #0ea5e9)";
        e.currentTarget.style.boxShadow = "0 3px 8px rgba(0,0,0,0.2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
        e.currentTarget.style.borderColor = "var(--dn-line2, rgba(148, 163, 184, 0.25))";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.12)";
      }}
    >
      <img
        src={paths[imgIdx]}
        alt="Alert snapshot"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block"
        }}
        onError={() => {
          if (imgIdx < paths.length - 1) {
            setImgIdx((prev) => prev + 1);
          } else {
            setHasError(true);
          }
        }}
      />
    </div>
  );
}

function LiveAlertsTable({ rows, rSource, T, externalAiIp }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const pageSize = 10;

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) =>
      String(r.ip_address || "").toLowerCase().includes(q) ||
      String(r.classification || "").toLowerCase().includes(q) ||
      String(r.event || "").toLowerCase().includes(q) ||
      String(r.details || "").toLowerCase().includes(q) ||
      String(r.status || "").toLowerCase().includes(q) ||
      String(r.acknowledged_note || "").toLowerCase().includes(q) ||
      String(r.resolved_note || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const selectedIndex = useMemo(() => {
    if (!selectedAlert) return -1;
    const sid = selectedAlert.id || selectedAlert._id;
    return filtered.findIndex(
      (r) => (r.id || r._id) === sid || (r.rawAlert && (r.rawAlert.id || r.rawAlert._id) === sid)
    );
  }, [filtered, selectedAlert]);

  const handlePrev = selectedIndex > 0 ? () => {
    const prevItem = filtered[selectedIndex - 1];
    setSelectedAlert(prevItem?.rawAlert || prevItem);
  } : null;

  const handleNext = selectedIndex >= 0 && selectedIndex < filtered.length - 1 ? () => {
    const nextItem = filtered[selectedIndex + 1];
    setSelectedAlert(nextItem?.rawAlert || nextItem);
  } : null;

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
              <th>Status</th>
              <th>Acknowledged Note / By</th>
              <th>Resolved Note / By</th>
              <th>Image</th>
            </tr>
          </thead>
          <tbody>
            {currentRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="dn-empty">No analytics alerts found.</td>
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
                    <td className="muted" style={{ maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.acknowledged_note !== "—" ? r.acknowledged_note : ""}>
                      {r.acknowledged_note || "—"}
                    </td>
                    <td className="muted" style={{ maxWidth: "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.resolved_note !== "—" ? r.resolved_note : ""}>
                      {r.resolved_note || "—"}
                    </td>
                    <td>
                      <AlertThumbnailCell
                        alert={r}
                        externalAiIp={externalAiIp}
                        onClick={() => setSelectedAlert(r.rawAlert || r)}
                      />
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

      {selectedAlert && (
        <AiAlertModal
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onPrev={handlePrev}
          onNext={handleNext}
        />
      )}
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
          <small className="dn-s2">{filtered.length} infrastructure devices monitored • Live status & uptime</small>
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
                const isDegraded = String(r.current_status).toLowerCase() === "degraded";
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
                        background: isOnline
                          ? "rgba(34, 197, 94, 0.15)"
                          : isDegraded
                          ? "rgba(234, 179, 8, 0.15)"
                          : "rgba(239, 68, 68, 0.15)",
                        color: isOnline
                          ? "var(--dn-ok, #22c55e)"
                          : isDegraded
                          ? "var(--dn-warn, #eab308)"
                          : "var(--dn-crit-t, #ef4444)",
                        padding: "calc(2 * var(--u)) calc(8 * var(--u))",
                        borderRadius: "calc(99 * var(--u))",
                        fontWeight: "600",
                        fontSize: "calc(11.5 * var(--u))"
                      }}>
                        <i style={{
                          width: "calc(7 * var(--u))",
                          height: "calc(7 * var(--u))",
                          borderRadius: "50%",
                          background: isOnline
                            ? "var(--dn-ok, #22c55e)"
                            : isDegraded
                            ? "var(--dn-warn, #eab308)"
                            : "var(--dn-crit, #ef4444)"
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

/* ───────────────────────── schedule modal ───────────────────────── */
function ScheduleReportModal({ isOpen, onClose, currentReportType }) {
  const [recipients, setRecipients] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [scheduleType, setScheduleType] = useState("daily");
  const [selectedReportType, setSelectedReportType] = useState(
    currentReportType && currentReportType !== "all" ? currentReportType : "alerts"
  );
  const [format, setFormat] = useState("pdf");
  const [sendTime, setSendTime] = useState("09:00");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [statusType, setStatusType] = useState("");
  const [schedulesList, setSchedulesList] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  const fetchSchedules = async () => {
    setLoadingList(true);
    try {
      const res = await fetch(apiUrl("/reports/schedules"), {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSchedulesList(data.schedules || []);
        }
      }
    } catch (err) {
      console.error("Failed to load schedules:", err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSchedules();
      setStatusMsg("");
      if (currentReportType && currentReportType !== "all") {
        setSelectedReportType(currentReportType);
      }
    }
  }, [isOpen, currentReportType]);

  const addRecipient = (emailStr) => {
    const raw = (emailStr || tagInput).trim().replace(/,$/, "");
    if (!raw) return;
    const parts = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    const validEmails = parts.filter((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
    if (validEmails.length > 0) {
      setRecipients((prev) => Array.from(new Set([...prev, ...validEmails])));
      setTagInput("");
    } else {
      setStatusMsg("Please enter a valid email address");
      setStatusType("error");
    }
  };

  const removeRecipient = (idx) => {
    setRecipients((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const finalRecipients = [...recipients];
    if (tagInput.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tagInput.trim())) {
      if (!finalRecipients.includes(tagInput.trim())) {
        finalRecipients.push(tagInput.trim());
      }
    }
    if (finalRecipients.length === 0) {
      setStatusMsg("Please enter at least one recipient email address.");
      setStatusType("error");
      return;
    }

    setLoading(true);
    setStatusMsg("");
    try {
      const res = await fetch(apiUrl("/reports/schedules"), {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report_type: selectedReportType,
          schedule_type: scheduleType,
          recipients: finalRecipients,
          format: format,
          send_time: sendTime,
          enabled: enabled,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg("Email schedule created successfully!");
        setStatusType("success");
        setRecipients([]);
        setTagInput("");
        fetchSchedules();
      } else {
        setStatusMsg(`Failed: ${data.message || data.detail || "Error creating schedule"}`);
        setStatusType("error");
      }
    } catch (err) {
      setStatusMsg("Failed to connect to backend server.");
      setStatusType("error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(apiUrl(`/reports/schedules/${id}`), {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        fetchSchedules();
      }
    } catch (err) {
      console.error("Failed to delete schedule:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="rp-modal-backdrop" onClick={onClose}>
      <div className="rp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rp-modal-header">
          <div className="rp-modal-title">
            <span className="rp-modal-icon-wrap">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </span>
            <span>Automated Email Report Schedule</span>
          </div>
          <button type="button" className="rp-modal-close" onClick={onClose} title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="rp-modal-body">
            <div className="rp-form-group">
              <label className="rp-label">Recipient Email(s)</label>
              <div className="rp-tag-container">
                {recipients.map((em, i) => (
                  <span key={i} className="rp-tag">
                    {em}
                    <button type="button" className="rp-tag-remove" onClick={() => removeRecipient(i)}>×</button>
                  </span>
                ))}
                <input
                  type="text"
                  className="rp-tag-input"
                  placeholder={recipients.length === 0 ? "Type email and press Enter or comma..." : "Add another email..."}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addRecipient();
                    }
                  }}
                  onBlur={() => addRecipient()}
                />
              </div>
              <span className="rp-subtext">Enter one or more recipient email addresses. Press Enter or comma after each.</span>
            </div>

            <div className="rp-grid-2">
              <div className="rp-form-group">
                <label className="rp-label">Report Type</label>
                <select
                  className="rp-select"
                  value={selectedReportType}
                  onChange={(e) => setSelectedReportType(e.target.value)}
                >
                  <option value="alerts">Camera Up/Down History</option>
                  <option value="live_alerts">Analytics Alerts</option>
                  <option value="health">Device Health & Uptime</option>
                  <option value="alerts,live_alerts,health">All Reports Summary</option>
                </select>
              </div>

              <div className="rp-form-group">
                <label className="rp-label">Attachment Format</label>
                <select className="rp-select" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="pdf">PDF (.pdf)</option>
                  <option value="xlsx">Microsoft Excel (.xlsx)</option>
                  <option value="csv">CSV (.csv)</option>
                </select>
              </div>
            </div>

            <div className="rp-grid-2">
              <div className="rp-form-group">
                <label className="rp-label">Frequency / Schedule</label>
                <select className="rp-select" value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="immediate">Immediate (On System Outage)</option>
                </select>
              </div>

              <div className="rp-form-group">
                <label className="rp-label">Send Time</label>
                <input
                  type="time"
                  className="rp-input"
                  value={sendTime}
                  disabled={scheduleType === "immediate"}
                  onChange={(e) => setSendTime(e.target.value)}
                />
              </div>
            </div>

            <label className="rp-checkbox-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>Enable automated delivery schedule</span>
            </label>

            {statusMsg && (
              <div style={{
                padding: "8px 12px",
                borderRadius: "8px",
                fontSize: "12.5px",
                fontWeight: 500,
                background: statusType === "success" ? "var(--dn-brand-tint, rgba(34, 211, 238, 0.12))" : "rgba(239, 68, 68, 0.12)",
                color: statusType === "success" ? "var(--dn-brand, #0891b2)" : "#ef4444",
                border: `1px solid ${statusType === "success" ? "var(--dn-brand, #0891b2)" : "#ef4444"}`
              }}>
                {statusMsg}
              </div>
            )}

            {/* Active schedules list */}
            <div className="rp-schedules-section">
              <label className="rp-label" style={{ marginBottom: "8px", display: "block" }}>
                Active Automated Schedules ({schedulesList.length})
              </label>
              {loadingList ? (
                <div style={{ fontSize: "12px", color: "var(--dn-muted)" }}>Loading schedules...</div>
              ) : schedulesList.length === 0 ? (
                <div style={{ fontSize: "12px", color: "var(--dn-muted)" }}>No schedules configured yet.</div>
              ) : (
                <div className="rp-schedules-list">
                  {schedulesList.map((sch) => (
                    <div key={sch.id || sch._id} className="rp-schedule-item">
                      <div>
                        <div className="rp-sch-title">
                          {sch.report_type} ({sch.schedule_type})
                        </div>
                        <div className="rp-sch-meta">
                          Recipients: {(sch.recipients || []).join(", ")} | Format: {(sch.format || "pdf").toUpperCase()} | Time: {sch.send_time || "09:00"}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="rp-sch-del"
                        title="Delete schedule"
                        onClick={() => handleDelete(sch.id || sch._id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rp-modal-footer">
            <button type="button" className="rp-btn-sec" onClick={onClose}>
              Close
            </button>
            <button type="submit" className="rp-btn-pri" disabled={loading}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              <span>{loading ? "Saving..." : "Save Schedule"}</span>
            </button>
          </div>
        </form>
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
  const [externalAiIp, setExternalAiIp] = useState(getEnv("EXTERNAL_AI_HOST"));
  const [cameras, setCameras] = useState([]);
  const [rep, setRep] = useState(null);
  const [rLoading, setRLoading] = useState(false);
  const [rMsg, setRMsg] = useState("");
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const secRefs = useRef({});

  // Check integration and cameras
  useEffect(() => {
    safe("/api/integrations").then((ai) => {
      const list = Array.isArray(ai) ? ai : ai?.integrations || [];
      const aiInt = list.find(i => (i.isActive || i.active || i.enabled || i.status === "active") && (i.type?.toLowerCase().includes('ai') || i.serverName?.toLowerCase().includes('ai') || /mirador.?ai|external_ai/i.test(JSON.stringify(i))));
      const anyActive = list.find(i => (i.isActive || i.active || i.enabled || i.status === "active") && i.serverIp);
      if (aiInt && aiInt.serverIp) {
        setIsAiActive(true);
        setExternalAiIp(aiInt.serverIp.split(':')[0]);
      } else if (anyActive && anyActive.serverIp) {
        setIsAiActive(true);
        setExternalAiIp(anyActive.serverIp.split(':')[0]);
      } else {
        setIsAiActive(list.some((i) => /mirador.?ai|external_ai/i.test(JSON.stringify(i)) && (i.enabled || i.active || i.status === "active")));
      }
    });
    safe("/api/cameras").then((cams) => {
      if (Array.isArray(cams)) setCameras(cams);
    });
  }, []);

  const nameByIp = useCallback((ip) => {
    const c = cameras.find((x) => x.ip === ip || x.ip_address === ip);
    return c?.name || c?.device_name || ip;
  }, [cameras]);

  const buildReports = useCallback(async (fromS, toS, source, status, targetType = "all") => {
    const fromT = new Date(fromS).getTime(), toT = new Date(toS).getTime();
    const fromIso = new Date(fromT).toISOString(), toIso = new Date(toT).toISOString();
    const span = toT - fromT;
    const prevFrom = new Date(fromT - span).toISOString();

    const needAlerts = targetType === "all" || targetType === "alerts";
    const needLive = targetType === "all" || targetType === "live";
    const needHealth = targetType === "all" || targetType === "health";
    const needHistory = targetType === "all" || targetType === "history";

    const [al, lv, tp, hs, prev] = await Promise.all([
      needAlerts ? safe(`/api/infrastructure/alerts?limit=5000&from_date=${fromIso}&to_date=${toIso}`) : Promise.resolve([]),
      needLive ? safe(`/api/alerts?${new URLSearchParams({ limit: 5000, from_date: fromIso, to_date: toIso, source, status }).toString()}`) : Promise.resolve([]),
      (needHealth || needAlerts) ? safe("/api/infrastructure/topology") : Promise.resolve(null),
      needHistory ? safe(`/api/reports/history?from_date=${fromIso}&to_date=${toIso}`) : Promise.resolve(null),
      needHistory ? safe(`/api/reports/history?from_date=${prevFrom}&to_date=${fromIso}`) : Promise.resolve(null),
    ]);

    const out = {};
    if (Array.isArray(al)) {
      out.alerts = al.filter((a) => {
        const ts = parseTs(a.timestamp);
        return ts >= fromT && ts <= toT && a.type && a.type.toLowerCase() === "camera";
      }).map((a) => ({
        timestamp: a.timestamp,
        ip: a.ip || "—",
        camera_name: nameByIp(a.ip) || a.model || "—",
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
      }).map((a) => {
        const raw = a.rawData || a.raw || a;
        const locKey = Object.keys(raw || {}).find((k) => {
          const n = k.toLowerCase().replace(/_/g, "");
          return n === "imagelocation" || n === "imglocation" || n === "imgelocation";
        });
        const locVal = locKey ? raw[locKey] : (a.imageLocation || a.image_location);
        const readerIp = a.ip || a.readerIp || raw.readerIp || raw.reader_ip || a.ip_address || "";
        const formattedIp = (readerIp || "").replace(/_/g, ".");

        const initialImage = locVal ? (
          locVal.startsWith("http")
            ? locVal
            : `http://${externalAiIp || getEnv("EXTERNAL_AI_HOST") || window.location.hostname}:${getEnv("MINIO_PORT") || "9000"}/${locVal.replace(/^\//, "")}`
        ) : (a.snapshot_url || a.snapshotUrl || a.snapshot || a.imageUrl || a.image || "");

        const ackNote = a.acknowlege_note || a.acknowledge_note || a.acknowledged_note || a.acknowledgedNote || raw.acknowlege_note || raw.acknowledge_note || raw.acknowledged_note || raw.acknowledgedNote || "";
        const ackBy = a.acknowledged_by || a.acknowledgedBy || a.acknowledge_by || a.acknowledgedUser || raw.acknowledged_by || raw.acknowledgedBy || "";
        let ackDisplay = "—";
        if (ackNote && ackBy) ackDisplay = `${ackNote} (${ackBy})`;
        else if (ackNote) ackDisplay = ackNote;
        else if (ackBy) ackDisplay = ackBy;

        const resNote = a.resolve_note || a.resolved_note || a.resolvedNote || a.notes || raw.resolve_note || raw.resolved_note || raw.resolvedNote || raw.notes || "";
        const resBy = a.resolved_by || a.resolvedBy || a.resolve_by || a.resolvedUser || raw.resolved_by || raw.resolvedBy || "";
        let resDisplay = "—";
        if (resNote && resBy) resDisplay = `${resNote} (${resBy})`;
        else if (resNote) resDisplay = resNote;
        else if (resBy) resDisplay = resBy;

        return {
          ...a,
          rawData: raw,
          id: a.id || a._id,
          timestamp: a.received_at || a.time || "—",
          ip_address: formattedIp || "—",
          classification: a.type || raw.type || "—",
          event: a.scenario || a.feature || raw.feature || a.subType || raw.subType || "—",
          details: a.employeeName || raw.employeeName || a.label || raw.label || a.vehicleType || a.message || "—",
          status: a.status === "Resolved" || a.resolved_at ? "Resolved" : a.status === "Acknowledged" || a.acknowledged_at ? "Acknowledged" : "Active",
          acknowledged_note: ackDisplay,
          resolved_note: resDisplay,
          image: initialImage || "—",
          rawAlert: a,
        };
      });
    } else {
      out.live = [];
    }

    if (tp && Array.isArray(tp.nodes)) {
      out.health = tp.nodes.map((n) => {
        let status = n.status || "offline";
        if ((n.stream_status === "dead" && n.latency == null) || (n.packet_loss === 100 && n.latency == null)) {
          status = "offline";
        }
        return {
          device_id: n.id || "—",
          ip_address: n.ip || "—",
          manufacturer: n.manufacturer || "—",
          model: n.model || "—",
          device_type: n.type || "—",
          current_status: status,
          latency_ms: n.latency != null ? `${n.latency} ms` : "—",
          uptime_duration: n.uptime || (status === "offline" ? "0m" : "—"),
          online_since: n.last_seen || "—",
          reboot_count: n.reboot_count != null ? String(n.reboot_count) : "0",
          last_reboot: n.last_reboot || "—",
          _lat: n.latency != null ? num(n.latency) : null,
          _group: n.manufacturer || n.type || "—",
          _name: n.name || n.id || n.ip,
        };
      });
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
  }, [externalAiIp, nameByIp]);

  const generate = useCallback(async (forcedType) => {
    setRLoading(true);
    setRMsg("");
    try {
      const activeType = forcedType || reportType;
      const r = await buildReports(rFrom, rTo, rSource, rStatus, activeType);
      setRep(r);
      return r;
    } catch {
      setRMsg(T("reportFail") || "Failed to generate report.");
      return null;
    } finally {
      setRLoading(false);
    }
  }, [buildReports, rFrom, rTo, rSource, rStatus, reportType, T]);

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
    { key: "alerts", rt: "alerts", label: "Camera Up/Down Events", keys: ["timestamp", "ip", "camera_name", "event", "message", "acknowledged"] },
    { key: "live", rt: "live_alerts", label: "Analytics Alerts", keys: ["timestamp", "ip_address", "classification", "event", "status", "acknowledged_note", "resolved_note", "image"] },
    { key: "health", rt: "health", label: "Device Health & Uptime", keys: ["device_id", "ip_address", "manufacturer", "model", "device_type", "current_status", "latency_ms", "uptime_duration", "online_since", "reboot_count", "last_reboot"] },
  ];
  const dsKeys = (d) => d.keys;

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

  const exportPdf = async () => {
    setRLoading(true);
    try {
      const r = rep || (await generate());
      if (!r) return;
      const targetKey = reportType === "all" ? null : reportType;
      const list = targetKey ? DATASETS.filter((d) => d.key === targetKey || d.rt === targetKey) : DATASETS;

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      // Document Header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42);
      doc.text("MIRADOR AI VIDEO MANAGEMENT SOFTWARE", 14, 15);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      const dateStr = `Period: ${rFrom.replace("T", " ")} to ${rTo.replace("T", " ")}   |   Generated: ${new Date().toLocaleString()}`;
      doc.text(dateStr, 14, 21);

      let startY = 27;

      for (let idx = 0; idx < list.length; idx++) {
        const d = list[idx];
        const rows = r[d.key] || [];
        const keys = dsKeys(d);
        const headers = keys.map((k) => k.replace(/_/g, " ").toUpperCase());
        const imageColIdx = keys.indexOf("image");

        // Preload image base64 for rows if image column is present
        const imagesMap = {};
        if (imageColIdx !== -1) {
          const BATCH_SIZE = 8;
          for (let b = 0; b < rows.length; b += BATCH_SIZE) {
            const chunk = rows.slice(b, b + BATCH_SIZE);
            const loaded = await Promise.all(
              chunk.map(async (row, cIdx) => {
                const rowIdx = b + cIdx;
                const paths = getAlertImagePaths(row.rawAlert || row, externalAiIp);
                const img = await fetchImageBase64(paths);
                return { rowIdx, img };
              })
            );
            loaded.forEach(({ rowIdx, img }) => {
              if (img) imagesMap[rowIdx] = img;
            });
          }
        }

        const tableData = rows.map((row, rowIdx) =>
          keys.map((k) => {
            if (k === "image") {
              return imagesMap[rowIdx] ? "" : (row[k] && row[k] !== "—" ? "Image" : "—");
            }
            return row[k] === null || row[k] === undefined ? "—" : String(row[k]);
          })
        );

        if (idx > 0) {
          doc.addPage();
          startY = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(30, 41, 59);
        doc.text(T("rt." + d.rt) || d.label, 14, startY);

        const columnStyles = {};
        if (imageColIdx !== -1) {
          columnStyles[imageColIdx] = {
            minCellHeight: 24,
            cellWidth: 38,
            halign: "center",
            valign: "middle",
          };
        }

        doc.autoTable({
          head: [headers],
          body: tableData.length > 0 ? tableData : [keys.map(() => "No records found")],
          startY: startY + 4,
          styles: {
            fontSize: 8.5,
            cellPadding: 2.5,
            overflow: "linebreak",
            valign: "middle",
            textColor: [15, 23, 42],
          },
          headStyles: {
            fillColor: [15, 23, 42],
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: 9,
          },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          columnStyles,
          theme: "striped",
          didParseCell: (data) => {
            if (data.section === "head") {
              data.cell.styles.textColor = [255, 255, 255];
              data.cell.styles.fontStyle = "bold";
              data.cell.styles.fontSize = 9;
            }
          },
          didDrawCell: (data) => {
            if (imageColIdx !== -1 && data.section === "body" && data.column.index === imageColIdx) {
              const rowIdx = data.row.index;
              const imgObj = imagesMap[rowIdx];
              if (imgObj?.dataUrl) {
                try {
                  const pad = 0.8;
                  const boxX = data.cell.x + pad;
                  const boxY = data.cell.y + pad;
                  const boxW = data.cell.width - pad * 2;
                  const boxH = data.cell.height - pad * 2;

                  const imgRatio = (imgObj.width || 4) / (imgObj.height || 3);
                  const boxRatio = boxW / boxH;
                  let w = boxW;
                  let h = boxH;
                  if (imgRatio > boxRatio) {
                    h = boxW / imgRatio;
                  } else {
                    w = boxH * imgRatio;
                  }
                  const x = boxX + (boxW - w) / 2;
                  const y = boxY + (boxH - h) / 2;

                  const fmt = imgObj.dataUrl.includes("image/png") ? "PNG" : "JPEG";
                  doc.addImage(imgObj.dataUrl, fmt, x, y, w, h);
                } catch (err) {
                  // ignore
                }
              }
            }
          },
        });

        startY = (doc.lastAutoTable?.finalY || startY) + 12;
      }

      const name = targetKey ? `${targetKey}_report.pdf` : "vms_report.pdf";
      doc.save(name);
    } catch (e) {
      console.error("[Reports] Export PDF failed:", e);
    } finally {
      setRLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
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

            <div style={{ display: "flex", gap: "calc(8 * var(--u))", alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="dn-btn pri" disabled={rLoading} onClick={generate}>
                {rLoading ? T("generating") : T("generateReport")}
              </button>
              <ExportDropdown
                onExportCsv={exportCsv}
                onExportXlsx={exportXlsx}
                onExportPdf={exportPdf}
                onPrint={handlePrint}
                disabled={rLoading}
              />
              <button
                type="button"
                className="dn-btn"
                disabled={rLoading}
                onClick={handlePrint}
                title="Print report"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9" />
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                  <rect x="6" y="14" width="12" height="8" />
                </svg>
                <span>Print</span>
              </button>
              <button
                type="button"
                className="dn-btn"
                onClick={() => setScheduleModalOpen(true)}
                title="Schedule automated email delivery"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <span>Schedule Email</span>
              </button>
            </div>
          </div>

          {rMsg && <div className="dn-note" style={{ marginTop: "calc(10 * var(--u))" }}>{rMsg}</div>}
        </section>

        {/* Loading Spinner Below Controls */}
        {rLoading && (
          <div className="dn-panel" style={{
            padding: "calc(48 * var(--u)) calc(20 * var(--u))",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "calc(14 * var(--u))",
            marginTop: "calc(16 * var(--u))",
            borderRadius: "calc(12 * var(--u))"
          }}>
            <div style={{
              width: "40px",
              height: "40px",
              border: "3.5px solid rgba(226, 232, 240, 0.7)",
              borderTopColor: "var(--dn-brand, #0284c7)",
              borderRadius: "50%",
              animation: "rpSpin 0.75s linear infinite"
            }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "15px", fontWeight: "600", color: "var(--dn-text, #1e293b)" }}>
                Generating Report Data...
              </div>
              <small style={{ fontSize: "12.5px", color: "var(--dn-muted, #64748b)" }}>
                Please wait while we query and compile events for the selected period
              </small>
            </div>
            <style>{`
              @keyframes rpSpin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )}

        {/* Report Content */}
        {!rLoading && rep && (
          <div className="dn-sec-wrap">
            {/* ───────────── PRINT-ONLY HEADER ───────────── */}
            <div className="dn-print-header">
              <h1>MIRADOR AI VIDEO MANAGEMENT SOFTWARE</h1>
              <p><strong>Report:</strong> {reportType === "all" ? "All Telemetry & System Reports" : DATASETS.find(d => d.key === reportType || d.rt === reportType)?.label || reportType}</p>
              <p><strong>Selected Period:</strong> {rFrom.replace("T", " ")} to {rTo.replace("T", " ")} &nbsp;|&nbsp; <strong>Generated:</strong> {new Date().toLocaleString()}</p>
            </div>
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
                  <LiveAlertsTable rows={rep.live || []} rSource={rSource} T={T} externalAiIp={externalAiIp} />
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
                    {allSubTab === "live" && <LiveAlertsTable rows={rep.live || []} rSource={rSource} T={T} externalAiIp={externalAiIp} />}
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

      <ScheduleReportModal
        isOpen={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        currentReportType={reportType === "all" ? "alerts,live_alerts,health" : (reportType === "live" ? "live_alerts" : reportType)}
      />
    </div>
  );
}
