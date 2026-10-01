import { useState, useEffect, useCallback, useRef } from "react";
import DatePicker from "../../components/shared/DatePicker";
import SearchBar from "../../components/shared/SearchBar";
import "./Schedules.css";

// ── Toast Notification ────────────────────────────────────────────
const TOAST_DURATION = 3500;

function Toast({ message, subtitle, type = "success", onClose }) {
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(onClose, 350);
  }, [onClose]);

  useEffect(() => {
    const t = setTimeout(dismiss, TOAST_DURATION);
    return () => clearTimeout(t);
  }, [dismiss]);

  const configs = {
    success: {
      label: "Success",
      gradient: "linear-gradient(135deg, #00c48c 0%, #00a878 100%)",
      glow: "rgba(0, 196, 140, 0.35)",
      bar: "#00e6b8",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="rgba(0,196,140,0.2)" />
          <circle cx="12" cy="12" r="11" stroke="#00d4aa" strokeWidth="1.5" fill="none" />
          <polyline points="7 12.5 10.5 16 17 9" stroke="#00d4aa" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    error: {
      label: "Error",
      gradient: "linear-gradient(135deg, #ff5555 0%, #cc3333 100%)",
      glow: "rgba(255, 85, 85, 0.35)",
      bar: "#ff6b6b",
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="rgba(255,85,85,0.2)" />
          <circle cx="12" cy="12" r="11" stroke="#ff5555" strokeWidth="1.5" fill="none" />
          <line x1="8" y1="8" x2="16" y2="16" stroke="#ff5555" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="16" y1="8" x2="8" y2="16" stroke="#ff5555" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      ),
    },
  };

  const cfg = configs[type] || configs.success;

  return (
    <div className={`toast-v2${exiting ? " toast-v2--exit" : ""}`}>
      {/* Left accent bar */}
      <div className="toast-v2__accent" style={{ background: cfg.gradient }} />

      {/* Icon */}
      <div className="toast-v2__icon">{cfg.icon}</div>

      {/* Text */}
      <div className="toast-v2__body">
        <span className="toast-v2__label">{cfg.label}</span>
        <span className="toast-v2__msg">{message}</span>
        {subtitle && <span className="toast-v2__sub">{subtitle}</span>}
      </div>

      {/* Close */}
      <button className="toast-v2__close" onClick={dismiss} title="Dismiss">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>

      {/* Progress bar */}
      <div
        className="toast-v2__progress"
        style={{ "--toast-duration": `${TOAST_DURATION}ms`, "--toast-bar-color": cfg.bar }}
      />
    </div>
  );
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TOTAL_SLOTS = 24 * 12; // 5-min intervals

const BACKEND = import.meta.env.VITE_API_URL || "";

function getAuthHeaders() {
  const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
  return token ? { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

// ── Helpers ───────────────────────────────────────────────────────
function slotToTime(slot) {
  const h = Math.floor(slot / 12);
  const m = (slot % 12) * 5;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}



/** Convert a day's boolean mask to { from, to, enabled } */
function maskToDayRange(mask) {
  if (!mask) return { from: "08:00", to: "18:00", enabled: false };
  let start = null;
  let end = null;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && start === null) start = i;
    if (!mask[i] && start !== null && end === null) { end = i; break; }
  }
  if (start === null) return { from: "08:00", to: "18:00", enabled: false };
  const endSlot = end !== null ? end : mask.length;
  return { from: slotToTime(start), to: slotToTime(endSlot), enabled: true };
}

/** Convert { from, to } back to boolean mask */
function dayRangeToMask(from, to) {
  const mask = new Array(TOTAL_SLOTS).fill(false);
  const fromMins = timeToMinutes(from);
  const toMins   = timeToMinutes(to);
  if (toMins <= fromMins) return mask;
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const slotMins = i * 5;
    if (slotMins >= fromMins && slotMins < toMins) mask[i] = true;
  }
  return mask;
}

function getRangeLabel(mask) {
  const { from, to, enabled } = maskToDayRange(mask);
  return enabled ? `${from} - ${to}` : "Always Off";
}

function makeEmptyWeek() {
  return Object.fromEntries(DAYS.map((d) => [d, new Array(TOTAL_SLOTS).fill(false)]));
}

// ── Time Input (manual HH:MM entry with fixed colon) ───────────────────
function TimeInput({ value, onChange, label, disabled = false }) {
  const [hRaw, setHRaw] = useState(value ? value.split(":")[0] : "00");
  const [mRaw, setMRaw] = useState(value ? value.split(":")[1] : "00");
  const hRef = useRef(null);
  const mRef = useRef(null);

  useEffect(() => {
    if (value) {
      setHRaw(value.split(":")[0]);
      setMRaw(value.split(":")[1]);
    }
  }, [value]);

  const commit = (e) => {
    // Prevent commit if we are just moving focus between hours and minutes
    if (e && (e.relatedTarget === hRef.current || e.relatedTarget === mRef.current)) {
      return;
    }

    let h = parseInt(hRaw, 10);
    let m = parseInt(mRaw, 10);

    if (isNaN(h)) h = value ? parseInt(value.split(":")[0], 10) : 0;
    if (isNaN(m)) m = value ? parseInt(value.split(":")[1], 10) : 0;

    if (h > 24) h = 24;
    if (m > 59) m = 59;

    const formatted = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    setHRaw(formatted.split(":")[0]);
    setMRaw(formatted.split(":")[1]);
    if (formatted !== value) {
      onChange(formatted);
    }
  };

  const handleHChange = (e) => {
    const val = e.target.value.replace(/\D/g, "");
    setHRaw(val);
    if (val.length === 2) {
      mRef.current?.focus();
    }
  };

  const handleMChange = (e) => {
    setMRaw(e.target.value.replace(/\D/g, ""));
  };

  const handleKeyDown = (e, field) => {
    if (e.key === "Enter") {
      e.target.blur();
    }
    if (e.key === "Backspace" && field === "m" && mRaw === "") {
      hRef.current?.focus();
    }
  };

  return (
    <div className={`time-input-wrap${disabled ? " time-input-wrap--disabled" : ""}`} title={label}>
      <input
        ref={hRef}
        className="ti-part"
        type="text"
        value={hRaw}
        placeholder="HH"
        disabled={disabled}
        onChange={handleHChange}
        onBlur={commit}
        onKeyDown={(e) => handleKeyDown(e, "h")}
        maxLength={2}
      />
      <span className="ti-sep">:</span>
      <input
        ref={mRef}
        className="ti-part"
        type="text"
        value={mRaw}
        placeholder="MM"
        disabled={disabled}
        onChange={handleMChange}
        onBlur={commit}
        onKeyDown={(e) => handleKeyDown(e, "m")}
        maxLength={2}
      />
    </div>
  );
}

// ── Day Bar (visual bar on the right) ────────────────────────────
function DayBar({ from, to, enabled }) {
  const fromPct = (timeToMinutes(from) / (24 * 60)) * 100;
  const toPct   = (timeToMinutes(to)   / (24 * 60)) * 100;
  const width   = Math.max(0, toPct - fromPct);

  const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

  return (
    <div className="day-bar-wrap">
      <div className="day-bar-track">
        {HOUR_TICKS.map((h) => (
          <div
            key={h}
            className={`day-bar-tick${h % 6 === 0 ? " major" : ""}`}
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}
        {enabled && width > 0 && (
          <div
            className="day-bar-fill"
            style={{ left: `${fromPct}%`, width: `${width}%` }}
            title={`${from} – ${to}`}
          />
        )}
      </div>
      <div className="day-bar-labels">
        {HOUR_TICKS.map((h) => (
          <span
            key={h}
            className="day-bar-label"
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {h.toString().padStart(2, "0")}:00
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Week Grid ─────────────────────────────────────────────────────
function WeekGrid({ week, onChange }) {
  const getDayRanges = useCallback(() =>
    Object.fromEntries(DAYS.map((d) => [d, maskToDayRange(week[d])])),
    [week]
  );

  const [ranges, setRanges] = useState(getDayRanges);

  useEffect(() => { setRanges(getDayRanges()); }, [getDayRanges]);

  const updateDay = (day, field, value) => {
    const updatedDayObj = { ...ranges[day], [field]: value };
    const updatedRanges = { ...ranges, [day]: updatedDayObj };
    setRanges(updatedRanges);

    const { from, to, enabled } = updatedDayObj;
    const newWeek = { ...week, [day]: enabled ? dayRangeToMask(from, to) : new Array(TOTAL_SLOTS).fill(false) };
    onChange(newWeek);
  };

  const toggleEnabled = (day) => {
    const wasEnabled = ranges[day].enabled;
    const existingFrom = ranges[day].from && ranges[day].from !== "00:00" ? ranges[day].from : "08:00";
    const existingTo   = ranges[day].to   && ranges[day].to   !== "00:00" ? ranges[day].to   : "18:00";
    
    const updatedDayObj = { ...ranges[day], enabled: !wasEnabled, from: existingFrom, to: existingTo };
    const updatedRanges = { ...ranges, [day]: updatedDayObj };
    setRanges(updatedRanges);

    const { from, to, enabled } = updatedDayObj;
    const newWeek = { ...week, [day]: enabled ? dayRangeToMask(from, to) : new Array(TOTAL_SLOTS).fill(false) };
    onChange(newWeek);
  };

  return (
    <div className="week-grid-v2">
      {/* Header */}
      <div className="wgv2-header">
        <div className="wgv2-col-day">Day</div>
        <div className="wgv2-col-from">From</div>
        <div className="wgv2-col-to">To</div>
        <div className="wgv2-col-bar">Timeline (24 h)</div>
      </div>

      {DAYS.map((day) => {
        const r = ranges[day] || { from: "08:00", to: "18:00", enabled: false };
        return (
          <div key={day} className={`wgv2-row${r.enabled ? " wgv2-row--active" : ""}`}>

            {/* Day checkbox + label */}
            <div className="wgv2-col-day">
              <label className="wgv2-day-toggle">
                <input
                  type="checkbox"
                  className="wgv2-checkbox"
                  checked={r.enabled}
                  onChange={() => toggleEnabled(day)}
                />
                <span className="wgv2-checkmark" />
                <span className="wgv2-day-name">{day}</span>
              </label>
            </div>

            {/* From input — always visible, disabled when day is off */}
            <div className="wgv2-col-from">
              <TimeInput
                label="From"
                value={r.from}
                disabled={!r.enabled}
                onChange={(v) => updateDay(day, "from", v)}
              />
            </div>

            {/* To input — always visible, disabled when day is off */}
            <div className="wgv2-col-to">
              <TimeInput
                label="To"
                value={r.to}
                disabled={!r.enabled}
                onChange={(v) => updateDay(day, "to", v)}
              />
            </div>

            {/* Visual bar */}
            <div className="wgv2-col-bar">
              <DayBar from={r.from} to={r.to} enabled={r.enabled} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Exception Calendar ───────────────────────────────────────────
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDayOfMonth(y, m) { return (new Date(y, m, 1).getDay() + 6) % 7; }

function ExceptionCalendar({ exceptions, onChange }) {
  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); } else setViewMonth((m) => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0);  setViewYear((y) => y + 1); } else setViewMonth((m) => m + 1); };

  const monthLabel  = new Date(viewYear, viewMonth, 1).toLocaleString("default", { month: "long", year: "numeric" });
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay    = getFirstDayOfMonth(viewYear, viewMonth);

  const toDate = (e) => (e instanceof Date ? e : new Date(e));
  const isException = (d) => exceptions.some((e) => { const dt = toDate(e); return dt.getFullYear() === viewYear && dt.getMonth() === viewMonth && dt.getDate() === d; });
  const isToday     = (d) => today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d;

  const toggleDay = (d) => {
    const date = new Date(viewYear, viewMonth, d);
    if (isException(d)) onChange(exceptions.filter((e) => { const dt = toDate(e); return !(dt.getFullYear() === viewYear && dt.getMonth() === viewMonth && dt.getDate() === d); }));
    else onChange([...exceptions, date]);
  };

  const cells = [];
  const prevDays = getDaysInMonth(viewYear, viewMonth === 0 ? 11 : viewMonth - 1);
  for (let i = 0; i < firstDay; i++)
    cells.push(<div key={`p${i}`} className="cal-cell other">{prevDays - firstDay + i + 1}</div>);
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(
      <div key={d} className={`cal-cell${isException(d) ? " exception" : ""}${isToday(d) ? " today" : ""}`} onClick={() => toggleDay(d)}>{d}</div>
    );
  for (let d = 1; cells.length < 42; d++)
    cells.push(<div key={`n${d}`} className="cal-cell other">{d}</div>);

  return (
    <div className="cal-wrap">
      <div className="cal-header">
        <button className="cal-nav" onClick={prevMonth}>&#8249;</button>
        <span className="cal-month-label">{monthLabel}</span>
        <button className="cal-nav" onClick={nextMonth}>&#8250;</button>
      </div>
      <div className="cal-grid">
        {["Mo","Tu","We","Th","Fr","Sa","Su"].map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {cells}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────
export default function Schedules() {
  const [schedules,      setSchedules]      = useState([]);
  const [selectedId,     setSelectedId]     = useState(null);
  const [filter,         setFilter]         = useState("");
  const [showExceptions, setShowExceptions] = useState(false);
  const [loading,        setLoading]        = useState(false);
  const [toast,          setToast]          = useState(null);

  const showToast = useCallback((message, subtitle = "", type = "success") => {
    setToast({ message, subtitle, type, key: Date.now() });
  }, []);

  useEffect(() => { fetchSchedules(); }, []);

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${BACKEND}/api/storage/schedules`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      let fetchedSchedules = Array.isArray(data) ? data : [];

      let usedScheduleIds = new Set();
      
      // Check local storage
      try {
        const saved = localStorage.getItem("miradorai_devices");
        if (saved) {
           const localDevs = JSON.parse(saved);
           localDevs.forEach(d => {
             if (d.assigned_schedule_id) usedScheduleIds.add(d.assigned_schedule_id);
           });
        }
      } catch (e) {}

      // Check backend
      try {
        const devRes = await fetch(`${BACKEND}/api/cameras`, { headers: getAuthHeaders() });
        if (devRes.ok) {
           const devData = await devRes.json();
           const devices = Array.isArray(devData) ? devData : (devData.devices || []);
           devices.forEach(d => {
             if (d.assigned_schedule_id) usedScheduleIds.add(d.assigned_schedule_id);
           });
        }
      } catch (err) {}

      fetchedSchedules = fetchedSchedules.map(s => ({
        ...s,
        status: usedScheduleIds.has(s.id) ? "active" : "inactive"
      }));

      setSchedules(fetchedSchedules);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const selected = schedules.find((s) => s.id === selectedId) || null;
  const filtered = schedules.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()));

  const addNew = () => {
    const s = { id: Date.now(), name: "New schedule", week: makeEmptyWeek(), exceptions: [] };
    setSchedules((prev) => [...prev, s]);
    setSelectedId(s.id);
  };

  const remove = async () => {
    if (!selectedId) return;
    const target = schedules.find((s) => s.id === selectedId);
    try {
      await fetch(`${BACKEND}/api/storage/schedules/${selectedId}`, { 
        method: "DELETE",
        headers: getAuthHeaders()
      });
    } catch (err) { console.error(err); }
    finally {
      setSchedules((prev) => prev.filter((s) => s.id !== selectedId));
      setSelectedId(null);
      if (target) {
        showToast("Schedule Removed", `"${target.name}" was successfully deleted.`);
      }
    }
  };

  const updateSelected = (patch) =>
    setSchedules((prev) => prev.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));

  return (
    <div className="schedules-page">
      <div className="page-header">
        <div className="page-header__left">
          <h1 className="page-title">Schedules</h1>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Filter schedules..." />
      </div>

      {/* In-UI Toast */}
      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          subtitle={toast.subtitle}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div className="sch-main-content">
        {/* Schedule list table */}
        <div className="sch-table-wrap">
          <table className="m-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className={`m-table__row ${selectedId === s.id ? "m-table__row--selected" : ""}`}
                  onClick={() => setSelectedId(s.id)}
                >
                  <td className="m-table__primary">{s.name}</td>
                  <td>
                    <span className={`m-badge ${s.status === "active" ? "m-badge--teal" : "m-badge--purple"}`}>
                      {s.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sch-actions">
          <button className="m-btn m-btn--elevated" onClick={addNew}>New Schedule</button>
          <button className="m-btn m-btn--danger" onClick={remove} disabled={!selectedId}>Remove</button>
        </div>

        {selected && (
          <div className="sch-detail card">
            <div className="sch-detail-body" style={{ marginTop: '8px' }}>
              <div className="sch-name-row">
                <label className="sch-name-label">Name:</label>
                <input
                  className="ec-input"
                  value={selected.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                />
                <button 
                  className="m-btn m-btn--elevated" 
                  style={{ marginLeft: "auto" }}
                  onClick={() => setShowExceptions(true)}
                >
                  Schedule Exceptions
                </button>
              </div>
              <h3 className="week-title">Week schedule</h3>
              <WeekGrid week={selected.week} onChange={(week) => updateSelected({ week })} />

              <div className="sch-apply-row">
                <button
                  className="m-btn m-btn--primary"
                  disabled={loading}
                  onClick={async () => {
                    const trimmedName = selected.name.trim();
                    if (!trimmedName || !/^[a-zA-Z0-9 _.\-]+$/.test(trimmedName)) {
                      showToast("Invalid Name", "Schedule name can only contain letters, numbers, spaces, hyphens, underscores, and dots.", "error");
                      return;
                    }
                    setLoading(true);
                    try {
                      const readableRanges = {};
                      DAYS.forEach((d) => { readableRanges[d] = getRangeLabel(selected.week[d]); });
                      const payload = { ...selected, ranges: readableRanges };
                      const res = await fetch(`${BACKEND}/api/storage/schedules`, {
                        method: "POST",
                        headers: getAuthHeaders(),
                        body: JSON.stringify(payload),
                      });
                      if (!res.ok) {
                        showToast("Error", "Failed to save schedule. Check the name format.", "error");
                        return;
                      }
                      showToast(
                        "Schedule Applied",
                        `"${selected.name}" has been saved and is now active.`
                      );
                    } catch (err) { 
                      console.error(err);
                      showToast("Error", "An error occurred while saving the schedule.", "error");
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  {loading ? "Saving..." : "Apply"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Side Panel Overlay & Drawer */}
      <div className={`exc-sp-overlay ${showExceptions ? "visible" : ""}`} onClick={() => setShowExceptions(false)} />
      <div className={`exc-side-panel ${showExceptions ? "open" : ""}`}>
        <div className="exc-sp-header">
          <h3>Exceptions: {selected?.name}</h3>
          <button className="exc-sp-close" onClick={() => setShowExceptions(false)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="1" y1="1" x2="13" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="13" y1="1" x2="1" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="exc-sp-body">
          {selected && (
            <>
              <DatePicker
                mode="multiple"
                isPopover={false}
                value={selected.exceptions || []}
                onChange={(exceptions) => updateSelected({ exceptions })}
              />
              <p className="exc-note" style={{ marginTop: "16px", fontSize: "12.5px", lineHeight: "1.4" }}>
                Select specific dates as exceptions. On these selected days, no recordings or scheduled events will take place.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}