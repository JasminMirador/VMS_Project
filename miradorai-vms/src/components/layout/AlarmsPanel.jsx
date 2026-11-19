import { useState } from "react";
import "./AlarmsPanel.css";

const INITIAL_ALARMS = [
  { id: 1, time: "17-03-2026 06:39:11", category: "System alarm",     description: "Windows Time service has encountered an error: The computer did not resync because no time data was available.", read: false },
  { id: 2, time: "17-03-2026 04:12:34", category: "System alarm",     description: "Windows Time service has encountered an error: The computer did not resync because no time data was available.", read: false },
  { id: 3, time: "17-03-2026 04:01:11", category: "System alarm",     description: "Windows Time service has encountered an error: The computer did not resync because no time data was available.", read: false },
  { id: 4, time: "16-03-2026 23:45:00", category: "Device alarm",     description: "Video signal restored on Station PTZ Orientation A.", read: true },
  { id: 5, time: "16-03-2026 22:10:05", category: "Device alarm",     description: "Camera Station Entrance Multisensor went offline.", read: true },
  { id: 6, time: "16-03-2026 20:33:18", category: "Recording",        description: "Recording storage is above 90% capacity.", read: true },
];

const MOCK_TASKS = [
  { id: 1, time: "17-03-2026 06:00:00", category: "Scheduled", description: "Daily backup completed successfully.",              status: "Done" },
  { id: 2, time: "16-03-2026 18:00:00", category: "Firmware",  description: "Firmware update available for AXIS P3245-V.",       status: "Pending" },
];

function loadAlarms() {
  try {
    const saved = localStorage.getItem("miradorai_alarms");
    if (saved) return JSON.parse(saved);
    localStorage.setItem("miradorai_alarms", JSON.stringify(INITIAL_ALARMS));
    return INITIAL_ALARMS;
  } catch { return INITIAL_ALARMS; }
}

function saveAlarms(alarms) {
  try { localStorage.setItem("miradorai_alarms", JSON.stringify(alarms)); }
  catch {}
}

export default function AlarmsPanel({ open, onClose }) {
  const [tab,    setTab]    = useState("alarms");
  const [alarms, setAlarms] = useState(loadAlarms);

  const displayAlarms = alarms.filter((a) => {
    const cat = String(a.category || "").toLowerCase();
    const desc = String(a.description || "").toLowerCase();
    const typ = String(a.type || "").toLowerCase();
    return !cat.includes("motion") && !desc.includes("motion") && !typ.includes("motion");
  });
  const unread = displayAlarms.filter((a) => !a.read).length;

  const persist = (updated) => {
    setAlarms(updated);
    saveAlarms(updated);
  };

  const markAllRead = () => persist(alarms.map((a) => ({ ...a, read: true })));
  const clearAll    = () => persist([]);
  const markRead    = (id) => persist(alarms.map((a) => a.id === id ? { ...a, read: true } : a));

  if (!open) return null;

  return (
    <div className="alarms-panel">

      {/* Header */}
      <div className="alarms-panel__header">
        <div className="alarms-panel__tabs">
          <button
            className={`alarms-tab ${tab === "alarms" ? "alarms-tab--active" : ""}`}
            onClick={() => setTab("alarms")}>
            Alarms
            {unread > 0 && <span className="alarms-tab__badge">{unread}</span>}
          </button>
          <button
            className={`alarms-tab ${tab === "tasks" ? "alarms-tab--active" : ""}`}
            onClick={() => setTab("tasks")}>
            Tasks
            <span className="alarms-tab__badge alarms-tab__badge--neutral">{MOCK_TASKS.length}</span>
          </button>
        </div>

        <div className="alarms-panel__actions">
          {tab === "alarms" && (
            <>
              <button className="alarms-action-btn" onClick={markAllRead} disabled={unread === 0}>
                Mark all read
              </button>
              <button className="alarms-action-btn alarms-action-btn--danger" onClick={clearAll} disabled={alarms.length === 0}>
                Clear all
              </button>
            </>
          )}
          <button className="alarms-close-btn" onClick={onClose} title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="alarms-panel__body">

        {/* ── Alarms tab ── */}
        {tab === "alarms" && (
          <table className="alarms-table">
            <thead>
              <tr>
                <th style={{ width: 14 }}></th>
                <th>Time</th>
                <th>Category</th>
                <th>Description</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {displayAlarms.length === 0 ? (
                <tr>
                  <td colSpan={5} className="alarms-table__empty">No alarms.</td>
                </tr>
              ) : displayAlarms.map((a) => (
                <tr key={a.id} className={!a.read ? "alarms-table__row--unread" : ""}>
                  <td>
                    {!a.read && <div className="alarms-unread-dot" />}
                  </td>
                  <td className="alarms-time">{a.time}</td>
                  <td>
                    <span className={`alarms-category-badge alarms-category-badge--${
                      a.category === "System alarm"     ? "system"   :
                      a.category === "Motion detection" ? "motion"   :
                      a.category === "Device alarm"     ? "device"   :
                      a.category === "Recording"        ? "recording": "default"
                    }`}>
                      {a.category}
                    </span>
                  </td>
                  <td className="alarms-desc">{a.description}</td>
                  <td>
                    {!a.read && (
                      <button className="alarms-action-btn alarms-action-btn--sm"
                        onClick={() => markRead(a.id)}>
                        Dismiss
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ── Tasks tab ── */}
        {tab === "tasks" && (
          <table className="alarms-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Category</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_TASKS.map((t) => (
                <tr key={t.id}>
                  <td className="alarms-time">{t.time}</td>
                  <td className="alarms-category">{t.category}</td>
                  <td className="alarms-desc">{t.description}</td>
                  <td>
                    <span className={`alarms-status alarms-status--${t.status.toLowerCase()}`}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>
    </div>
  );
}