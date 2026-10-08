import { useEffect, useRef, useState } from "react";
import SearchBar from "../../components/shared/SearchBar";
import SpecularButton from "../../components/shared/SpecularButton";
import { useTheme } from "../../context/ThemeContext";
import "./StorageManagementPage.css";

const BACKEND = import.meta.env.VITE_API_URL || "";

// ── Path helpers ────────────────────────────────────────────────────────────
// The backend always works with Linux container paths (/recordings/...).
// The UI shows Windows-friendly paths (D:\REC\...) for readability.
// These two helpers convert between the two representations.

function toDisplayPath(containerPath) {
  if (!containerPath) return "";
  return containerPath.replace(/\//g, "\\");
}

function toContainerPath(displayPath) {
  if (!displayPath) return "";
  return displayPath.trim().replace(/\\/g, "/");
}

// ── Component ────────────────────────────────────────────────────────────────
export default function StorageManagementPage() {
  const { theme } = useTheme();
  const [rows, setRows]                 = useState([]);
  const [selected, setSelected]         = useState(null);
  const [loading, setLoading]           = useState(true);
  const [filter, setFilter]             = useState("");

  // folder stores the DISPLAY path (D:\REC\...) shown in the input box
  const [folder, setFolder]             = useState("");
  const [allocated, setAllocated]       = useState(352);
  const [allocError, setAllocError]     = useState("");
  const [allocWarning, setAllocWarning] = useState("");
  const [addModal, setAddModal]         = useState(false);
  const [newPath, setNewPath]           = useState("");
  const [applyMsg, setApplyMsg]         = useState("");

  // ── Fetch storage info from backend ──────────────────────────────────────
  const fetchStorage = () => {
    setLoading(true);
    fetch(`${BACKEND}/api/storage/management`)
      .then((r) => r.json())
      .then((data) => {
        // Backend returns container_path; we show display_path / location
        const mapped = data.map((row) => ({
          ...row,
          // Prefer the display_path field; fall back to converting location
          display: row.display_path || toDisplayPath(row.container_path || row.location || ""),
        }));
        setRows(mapped);
        if (mapped.length > 0) {
          setSelected(0);
          setFolder(mapped[0].display);
          setAllocated(mapped[0].allocated || 352);
        }
      })
      .catch(() => {
        // Fallback: ask the recorder what path it's currently using
        fetch(`${BACKEND}/api/recordings/status`)
          .then((r) => r.json())
          .then((status) => {
            const containerPath = status.recording_path || "/recordings";
            const display       = status.display_path   || toDisplayPath(containerPath);
            const mock = [{
              location:       display,
              container_path: containerPath,
              display:        display,
              type:           "Local Disk",
              total:          475,
              used:           16,
              free:           459,
              allocated:      459,
              status:         "Recording",
              server:         "MIRADOR",
            }];
            setRows(mock);
            setSelected(0);
            setFolder(mock[0].display);
            setAllocated(mock[0].allocated);
          })
          .catch(() => {
            const mock = [{
              location:       "D:\\REC",
              container_path: "/recordings",
              display:        "D:\\REC",
              type:           "Local Disk",
              total:          475,
              used:           16,
              free:           459,
              allocated:      459,
              status:         "Recording",
              server:         "MIRADOR",
            }];
            setRows(mock);
            setSelected(0);
            setFolder(mock[0].display);
            setAllocated(mock[0].allocated);
          });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchStorage(); }, []);

  const sel = rows[selected] ?? null;

  const filtered = rows.filter((r) =>
    !filter ||
    [r.display, r.location, r.type, r.status, r.server].some((v) =>
      v && String(v).toLowerCase().includes(filter.toLowerCase())
    )
  );

  const usedPct   = sel ? Math.min(Math.round((sel.used / sel.total) * 100), 100) : 0;
  const usedColor = usedPct >= 90 ? "#ef4444" : usedPct >= 70 ? "#f59e0b" : "var(--teal)";

  const handleAllocChange = (newVal) => {
    if (!sel) return;
    if (newVal < sel.used) {
      setAllocError(
        `Cannot reduce to ${newVal} GB — disk already has ${sel.used} GB of recordings. ` +
        `Delete older recordings first, then reduce the allocation.`
      );
      setAllocWarning("");
    } else if (newVal - sel.used <= 0.2) {
      setAllocError("");
      setAllocWarning(
        `Warning: Remaining free space under allocation will be less than 200 MB. Please allocate more space.`
      );
    } else {
      setAllocError("");
      setAllocWarning("");
    }
    setAllocated(newVal);
  };

  const handleRemove = async () => {
    if (sel === null) return;
    if (!window.confirm(`Remove storage location "${sel.display || sel.location}"?`)) return;
    
    try {
      await fetch(`${BACKEND}/api/storage/locations?container_path=${encodeURIComponent(sel.container_path)}`, {
        method: "DELETE"
      });
      fetchStorage();
      setSelected(null);
    } catch (err) {
      console.error("Failed to remove storage location:", err);
    }
  };

  const handleAdd = async () => {
    if (!newPath.trim()) return;
    const containerPath = toContainerPath(newPath.trim());
    const display       = toDisplayPath(containerPath);
    
    try {
      await fetch(`${BACKEND}/api/storage/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_path: display,
          container_path: containerPath,
          allocated: 100
        })
      });
      fetchStorage();
      setAddModal(false);
      setNewPath("");
    } catch (err) {
      console.error("Failed to add storage location:", err);
    }
  };

  // ── Apply: convert display path → container path, send to backend ─────────
  const handleApply = async () => {
    if (allocError) return;

    // Warning before 200 MB (0.2 GB) remaining space check:
    if (sel && (allocated - sel.used <= 0.2)) {
      alert("⚠️ Warning: Remaining free space under the allocation limit is less than 200 MB! Please increase the allocation to ensure uninterrupted recording.");
    }

    const displayInput  = folder.trim();
    const containerPath = toContainerPath(displayInput);

    if (!containerPath) {
      setApplyMsg("❌ Please enter a valid folder path.");
      setTimeout(() => setApplyMsg(""), 4000);
      return;
    }

    setApplyMsg("Applying...");

    try {
      const res = await fetch(`${BACKEND}/api/storage/apply`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          // Always send the container path — backend validates & persists it
          recording_path: containerPath,
          folder:         containerPath,
          allocated,
        }),
      });

      const json = await res.json();
      if (res.ok) {
        // Use the display_path the backend echoes back, or derive it ourselves
        const newDisplay = json.display_path || toDisplayPath(json.recording_path || containerPath);
        setApplyMsg(`✅ ${json.message || "Settings updated and saved successfully!"}`);

        // Update the displayed row
        if (selected !== null) {
          setRows((prev) =>
            prev.map((r, i) =>
              i === selected
                ? {
                    ...r,
                    location:       newDisplay,
                    container_path: json.recording_path || containerPath,
                    display:        newDisplay,
                    allocated:      allocated, // Sync local state allocated value!
                  }
                : r
            )
          );
          setFolder(newDisplay);
          
          // Re-fetch storage options to refresh free/used calculations!
          fetchStorage();
        }
      } else {
        setApplyMsg(`❌ ${(typeof json.detail === "string" ? json.detail : (Array.isArray(json.detail) ? json.detail.map(d => d.msg || "Invalid input").join(", ") : ("Failed to apply settings.")))}`);
      }
    } catch {
      setApplyMsg("❌ Could not reach backend. Is the server running?");
    }

    setTimeout(() => setApplyMsg(""), 6000);
  };

  return (
    <div className="page-shell">

      <div className="page-header">
        <div>
          <h1 className="page-title">Storage <span>Management</span></h1>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      <div className="sm-table-wrap card">
        <table className="m-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              {["Location", "Allocated", "Used", "Status", "Server"].map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="m-table__empty">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="m-table__empty">No storage locations configured.</td></tr>
            ) : filtered.map((r, i) => {
              const isSel = selected === i;
              const pct   = r.total ? Math.round((r.used / r.total) * 100) : 0;
              const warn  = pct >= 90;
              return (
                <tr
                  key={i}
                  className={`m-table__row ${isSel ? "m-table__row--selected" : ""}`}
                  onClick={() => {
                    setSelected(i);
                    setFolder(r.display || r.location || "");
                    setAllocated(r.allocated || 352);
                    setAllocWarning("");
                  }}
                >
                  <td>
                    <div className="sm-disk-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <ellipse cx="12" cy="6" rx="8" ry="3"/>
                        <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/>
                        <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>
                      </svg>
                      {warn && <span className="sm-disk-warn">⚠</span>}
                    </div>
                  </td>
                  <td className="m-table__primary sm-location">{r.display || r.location}</td>
                  <td>{r.allocated} GB</td>
                  <td>{r.used} GB</td>
                  <td>
                    <span className={`sm-status ${warn ? "sm-status--warn" : "sm-status--ok"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td>{r.server}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sm-table-actions">
        <button className="sm-btn sm-btn--danger" disabled={selected === null} onClick={handleRemove}>Remove</button>
      </div>

      {sel && (
        <div className="sm-bottom">

          {/* Card 1: Overview & Total Capacity */}
          <div className="sm-card card">
            <div className="sm-panel-title">Overview</div>

            <div className="sm-legend">
              <span className="sm-legend-dot sm-legend-dot--used" />
              <span>Used: <strong>{sel.used} GB</strong></span>
            </div>
            <div className="sm-legend">
              <span className="sm-legend-dot sm-legend-dot--free" />
              <span>Free: <strong>{sel.free} GB</strong></span>
            </div>
            <div className="sm-legend">
              <span className="sm-legend-dot sm-legend-dot--other" />
              <span>Other data: <strong>{Math.max(0, sel.total - sel.used - sel.free).toFixed(0)} GB</strong></span>
            </div>

            <div className="sm-divider" style={{ marginTop: "auto" }} />

            <div className="sm-field-row" style={{ marginTop: 8 }}>
              <span className="sm-field-label sm-field-label--lg">Total Capacity:</span>
              <strong style={{ marginLeft: "auto", fontSize: "20px", color: "var(--teal)" }}>{sel.total} GB</strong>
            </div>
          </div>

          {/* Card 2: Disk Usage & Space Allocation */}
          <div className="sm-card card">
            <div className="sm-panel-title">Disk Usage</div>

            <div className="sm-usage-label">DISK USAGE</div>
            <div className="sm-usage-track">
              <div className="sm-usage-bar" style={{ width: `${usedPct}%`, background: usedColor }} />
            </div>
            <div className="sm-usage-text">
              {sel.used} GB used of {sel.total} GB ({usedPct}%)
            </div>

            <div className="sm-divider" />

            <div className="sm-field-row">
              <label className="sm-field-label sm-field-label--lg">Allocated Limit:</label>
            </div>
            <div className="sm-slider-row">
              <input
                type="range"
                min={10}
                max={sel.total || 500}
                value={allocated}
                onChange={(e) => handleAllocChange(Number(e.target.value))}
                className="sm-slider"
              />
              <span className="sm-slider-val">{allocated} GB</span>
            </div>

            {allocError && (
              <div className="sm-alloc-warning" style={{ background: "rgba(239, 68, 68, 0.12)", borderColor: "#ef4444" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span style={{ color: "#fca5a5" }}>{allocError}</span>
              </div>
            )}

            {allocWarning && (
              <div className="sm-alloc-warning" style={{ background: "rgba(245, 158, 11, 0.12)", borderColor: "#f59e0b" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span style={{ color: "#fde047" }}>{allocWarning}</span>
              </div>
            )}

            <div className="sm-field-row" style={{ justifyContent: "flex-end", marginTop: "auto", paddingTop: 10 }}>
              <SpecularButton
                size="md"
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
                className="sm-btn sm-btn--primary"
                disabled={!!allocError}
                onClick={handleApply}
              >
                Save Allocation
              </SpecularButton>
            </div>
          </div>

          {/* Card 3: Status to Apply */}
          <div className="sm-card card">
            <div className="sm-panel-title">Status to Apply</div>

            <div className="sm-field-row" style={{ marginBottom: 6 }}>
              <label className="sm-field-label sm-field-label--lg">Status:</label>
              <span className={`sm-status ${usedPct >= 90 ? "sm-status--warn" : "sm-status--ok"}`}>
                {sel.status}
              </span>
            </div>

            <div className="sm-divider" />

            <div className="sm-field-row">
              <label className="sm-field-label sm-field-label--lg">Folder:</label>
            </div>

            <div className="sm-folder-row">
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="Enter parent folder name (e.g., Recordings or VMS_Data)"
                className="sm-input"
              />
            </div>


            {applyMsg && <div className="sm-apply-msg">{applyMsg}</div>}

            <div className="sm-field-row" style={{ justifyContent: "flex-end", marginTop: "auto", paddingTop: 10 }}>
              <SpecularButton
                size="md"
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
                className="sm-btn sm-btn--primary"
                disabled={!!allocError}
                onClick={handleApply}
              >
                Save Parent Folder
              </SpecularButton>
            </div>
          </div>

        </div>
      )}

      {addModal && (
        <div className="mgmt-modal-overlay" onClick={() => setAddModal(false)}>
          <div className="mgmt-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mgmt-modal__header">
              <span className="mgmt-modal__title">Add MinIO Parent Folder</span>
              <button className="mgmt-detail__close" onClick={() => setAddModal(false)}>✕</button>
            </div>
            <div className="mgmt-modal__body">
              <div className="mgmt-form">
                <div className="mgmt-form__row">
                  <label>Folder Name</label>
                  <input
                    className="mgmt-input"
                    style={{ flex: 1 }}
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    placeholder="e.g., Recordings or site-B/Recordings"
                    title="Enter the MinIO parent folder name."
                  />
                </div>
                <div className="sm-modal-help">
                  Enter the parent folder name for MinIO storage (e.g., <code>Recordings</code>).
                </div>
                <div className="mgmt-form__actions">
                  <button className="sm-btn" onClick={() => setAddModal(false)}>Cancel</button>
                  <button className="sm-btn sm-btn--primary" onClick={handleAdd}>Add</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}