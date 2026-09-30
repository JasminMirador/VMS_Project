import { useState, useEffect, useMemo } from "react";
import SearchBar from "../../components/shared/SearchBar";
import "./RecycleBinPage.css";

const BACKEND = "http://192.168.126.200:8000";

/* ── Toast ── */
function Toast({ toast }) {
  if (!toast) return null;
  const isError = toast.type === "error";
  return (
    <div className={`rb-toast ${isError ? "rb-toast--error" : "rb-toast--success"}`}>
      {isError ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      )}
      <span>{toast.msg}</span>
    </div>
  );
}

/* ── Confirm Modal ── */
function ConfirmModal({ modal, onConfirm, onCancel }) {
  if (!modal) return null;
  return (
    <div className="rb-modal-overlay" onClick={onCancel}>
      <div className="rb-modal" onClick={e => e.stopPropagation()}>
        <div className="rb-modal__icon rb-modal__icon--warning">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h3 className="rb-modal__title">{modal.title}</h3>
        <p className="rb-modal__body">{modal.message}</p>
        {/* {modal.danger && (
                      <div className="rb-modal__warn">This action <strong>cannot be undone</strong>. Only the camera entry will be removed. Recordings and alert history are <strong>kept</strong>.</div>

        )} */}
        <div className="rb-modal__actions">
          <button className="m-btn m-btn--elevated" onClick={onCancel}>Cancel</button>
          <button className={`m-btn ${modal.danger ? "m-btn--danger" : "m-btn--primary"}`} onClick={onConfirm}>
            {modal.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecycleBinPage() {
  const [search, setSearch] = useState("");
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const showConfirm = (config, action) => {
    setModal(config);
    setPendingAction(() => action);
  };

  const handleModalConfirm = async () => {
    setModal(null);
    if (pendingAction) await pendingAction();
    setPendingAction(null);
  };

  const handleModalCancel = () => {
    setModal(null);
    setPendingAction(null);
  };

  const fetchTrash = async () => {
    try {
      setLoading(true);
      const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token")) || "";
      const res = await fetch(`${BACKEND}/api/cameras/trash`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch recycle bin");
      const data = await res.json();
      setCameras(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTrash(); }, []);

  const handleRestore = (cam) => {
    showConfirm(
      {
        title: "Restore Camera",
        message: `Restore "${cam.device_name || cam.name || cam.ip}" back to the active system?`,
        confirmLabel: "Restore",
        danger: false,
      },
      async () => {
        try {
          const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token")) || "";
          const res = await fetch(`${BACKEND}/api/cameras/${cam.ip}/restore`, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (!res.ok) throw new Error("Failed to restore");
          showToast(`Camera "${cam.device_name || cam.ip}" restored successfully!`);
          await fetchTrash();
        } catch (err) {
          showToast("Error restoring camera: " + err.message, "error");
        }
      }
    );
  };

  const handleHardDelete = (cam) => {
    showConfirm(
      {
        title: "Erase Permanently",
        message: `You are about to permanently delete "${cam.device_name || cam.name || cam.ip}".`,
        confirmLabel: "Erase Permanently",
        danger: true,
      },
      async () => {
        try {
          const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token")) || "";
          const res = await fetch(`${BACKEND}/api/cameras/${cam.ip}/hard`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (!res.ok) throw new Error("Failed to erase");
          showToast(`Camera "${cam.device_name || cam.ip}" permanently erased.`);
          await fetchTrash();
        } catch (err) {
          showToast("Error erasing camera: " + err.message, "error");
        }
      }
    );
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cameras.filter(c =>
      (c.device_name || "").toLowerCase().includes(q) ||
      (c.ip || "").toLowerCase().includes(q)
    );
  }, [cameras, search]);

  const formatIST = (dateStr) => {
    if (!dateStr) return "—";
    const utcStr = dateStr.endsWith("Z") || dateStr.includes("+") ? dateStr : dateStr + "Z";
    return new Date(utcStr).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Recycle Bin</h1>
          {/* <p className="page-desc">Manage soft-deleted cameras. Restore them to the system or permanently erase their data.</p> */}
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <SearchBar value={search} onChange={setSearch} placeholder="Search deleted cameras..." />
          <button className="m-btn m-btn--elevated" onClick={fetchTrash}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.22-10.27l-5.32 5.32" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
        ) : error ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#ef4444" }}>{error}</div>
        ) : cameras.length === 0 ? (
          <div style={{ flex: 1, width: "100%", textAlign: "center", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", minHeight: "300px" }}>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <p>The recycle bin is empty.</p>
          </div>
        ) : (
          <div className="m-table-wrap" style={{ flex: 1, overflow: "auto" }}>
            <table className="m-table">
              <thead>
                <tr>
                  <th>Device Name</th>
                  <th>IP Address</th>
                  <th>Deleted At</th>
                  <th>Deleted By</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.ip} className="m-table__row">
                    <td style={{ color: "var(--text-primary)", fontWeight: "500" }}>{c.device_name || c.name || "Unknown"}</td>
                    <td style={{ fontFamily: "monospace", color: "var(--teal)" }}>{c.ip}</td>
                    <td>{formatIST(c.deleted_at)}</td>
                    <td>{c.deleted_by || (() => { try { return JSON.parse(localStorage.getItem("miradorai_user"))?.email || "admin@example.com"; } catch { return "admin@example.com"; } })()}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "8px" }}>
                        <button className="m-btn m-btn--primary" onClick={() => handleRestore(c)}>
                          Restore
                        </button>
                        <button className="m-btn m-btn--danger" onClick={() => handleHardDelete(c)}>
                          Erase
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && cameras.length > 0 && (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)" }}>No cameras match your search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* In-UI Confirm Modal */}
      <ConfirmModal modal={modal} onConfirm={handleModalConfirm} onCancel={handleModalCancel} />

      {/* In-UI Toast Notification */}
      <Toast toast={toast} />
    </div>
  );
}

export default RecycleBinPage;
