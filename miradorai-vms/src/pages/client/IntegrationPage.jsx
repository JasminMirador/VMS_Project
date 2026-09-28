import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Button from "../../components/shared/Button";
import Toggle from "../../components/shared/Toggle";
import "./IntegrationPage.css";

function generateRandomId() {
  return Math.random().toString().slice(2, 18).padEnd(16, "0");
}

function formatDate(timestamp) {
  if (!timestamp) {
    const now = new Date();
    return now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " " + now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  }
  const d = typeof timestamp === "number" ? new Date(timestamp * 1000) : new Date(timestamp);
  if (isNaN(d.getTime())) return "Recently";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// Icon for connection types
function IntegrationTypeIcon({ type = "" }) {
  const t = (type || "").toLowerCase();
  if (/(redis|sql|mongo|db|database)/.test(t)) {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14a8 3 0 0 0 16 0V5" />
        <path d="M4 12a8 3 0 0 0 16 0" />
      </svg>
    );
  }
  if (/(mqtt|kafka|queue|broker|stream|topic)/.test(t)) {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11a9 9 0 0 1 9 9" />
        <path d="M4 4a16 16 0 0 1 16 16" />
        <circle cx="5" cy="19" r="1.5" />
      </svg>
    );
  }
  if (/(ai|ml|vision|model|mirador)/.test(t)) {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="7" y="7" width="10" height="10" rx="1" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export default function IntegrationPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [connections, setConnections] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [isPinging, setIsPinging] = useState(false);

  // Toast state
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const showToast = (message, type = "success") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type, leaving: false });
    toastTimerRef.current = setTimeout(() => {
      setToast((t) => (t ? { ...t, leaving: true } : t));
      setTimeout(() => setToast(null), 280);
    }, 3400);
  };

  const dismissToast = () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast((t) => (t ? { ...t, leaving: true } : t));
    setTimeout(() => setToast(null), 280);
  };

  // Form state
  const [formData, setFormData] = useState({
    id: generateRandomId(),
    type: "",
    isActive: true,
    autoReconnect: true,
    serverName: "",
    serverIp: "",
    isConnected: false,
    host: "",
    port: "",
    username: "",
    password: "",
    streams: [],
    updated_at: null,
  });

  const isEditing = connections.some((c) => c.id === formData.id || c._id === formData.id);

  // Copy ID Helper
  const handleCopyId = (id) => {
    if (!id) return;
    navigator.clipboard?.writeText(id);
    setCopiedId(true);
    showToast("Connection ID copied to clipboard.", "info");
    setTimeout(() => setCopiedId(false), 2000);
  };

  const fetchIntegrations = async () => {
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("miradorai_token");
      const headers = { Authorization: token ? `Bearer ${token}` : "" };
      const API_BASE = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${API_BASE}/api/integrations`, { headers });
      if (res.ok) {
        const data = await res.json();
        setConnections(data);

        // Sync with route param if present
        const parts = location.pathname.split("/").filter(Boolean);
        if (parts[0] === "integration" && parts[1] && parts[1] !== "new") {
          const targetId = decodeURIComponent(parts[1]);
          const found = data.find(
            (c) =>
              c.id === targetId ||
              c._id === targetId ||
              (c.type && c.type.toLowerCase() === targetId.toLowerCase())
          );
          if (found) {
            setFormData({
              ...found,
              autoReconnect: found.autoReconnect !== false,
            });
            setFormErrors({});
            setShowForm(true);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch integrations", err);
    }
  };

  useEffect(() => {
    fetchIntegrations();
  }, []);

  // Sync route changes to form state (e.g. clicking sidebar connection item)
  useEffect(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts[0] === "integration") {
      if (parts[1] && parts[1] !== "new") {
        const targetId = decodeURIComponent(parts[1]);
        const found = connections.find(
          (c) =>
            c.id === targetId ||
            c._id === targetId ||
            (c.type && c.type.toLowerCase() === targetId.toLowerCase())
        );
        if (found) {
          setFormData({
            ...found,
            autoReconnect: found.autoReconnect !== false,
          });
          setFormErrors({});
          setShowForm(true);
        }
      } else if (parts[1] === "new") {
        setFormData({
          id: generateRandomId(),
          type: "",
          isActive: true,
          autoReconnect: true,
          serverName: "",
          serverIp: "",
          isConnected: false,
          host: "",
          port: "",
          username: "",
          password: "",
          streams: [],
          updated_at: null,
        });
        setFormErrors({});
        setShowForm(true);
      } else {
        setShowForm(false);
      }
    }
  }, [location.pathname, connections]);

  const handleNewConnection = () => {
    setFormData({
      id: generateRandomId(),
      type: "",
      isActive: true,
      autoReconnect: true,
      serverName: "",
      serverIp: "",
      isConnected: false,
      host: "",
      port: "",
      username: "",
      password: "",
      streams: [],
      updated_at: null,
    });
    setFormErrors({});
    setShowForm(true);
    navigate("/integration/new");
  };

  const handleEditConnection = (conn) => {
    setFormData({
      ...conn,
      autoReconnect: conn.autoReconnect !== false,
    });
    setFormErrors({});
    setShowForm(true);
    navigate(`/integration/${conn.id || conn._id}`);
  };

  const handleAddStream = () => {
    setFormData({
      ...formData,
      streams: [...formData.streams, { id: Date.now(), name: "", value: "" }],
    });
  };

  const handleRemoveStream = (id) => {
    setFormData({
      ...formData,
      streams: formData.streams.filter((s) => s.id !== id),
    });
  };

  const handleStreamChange = (id, field, value) => {
    setFormData({
      ...formData,
      streams: formData.streams.map((s) => (s.id === id ? { ...s, [field]: value } : s)),
    });
  };

  const handleDeleteConnection = async (id) => {
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("miradorai_token");
      const headers = { Authorization: token ? `Bearer ${token}` : "" };
      const API_BASE = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${API_BASE}/api/integrations/${id}`, { method: "DELETE", headers });
      if (res.ok) {
        setConnections(connections.filter((c) => c.id !== id));
        window.dispatchEvent(new Event("integrationsUpdated"));
        showToast("Connection removed.", "success");
      } else {
        showToast("Couldn't remove that connection.", "error");
      }
    } catch (err) {
      console.error("Failed to delete integration", err);
      showToast("Couldn't remove that connection.", "error");
    }
  };

  const handlePingServer = async () => {
    if (!formData.serverIp.trim()) {
      return setFormErrors({ ...formErrors, serverIp: "Enter an IP address first" });
    }
    setIsPinging(true);
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("miradorai_token");
      const API_BASE = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${API_BASE}/api/integrations/ping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ serverIp: formData.serverIp.trim() }),
      });
      if (res.ok) {
        setFormData({ ...formData, isConnected: true });
        setFormErrors({ ...formErrors, serverIp: null });
        showToast("Server reachable & connected successfully!", "success");
      } else {
        setFormData({ ...formData, isConnected: false });
        setFormErrors({ ...formErrors, serverIp: "Could not reach IP" });
        showToast("Could not reach server IP.", "error");
      }
    } catch (err) {
      setFormData({ ...formData, isConnected: false });
      setFormErrors({ ...formErrors, serverIp: "Connection failed" });
      showToast("Network connection check failed.", "error");
    } finally {
      setIsPinging(false);
    }
  };

  const handleSave = async () => {
    let errors = {};

    if (!formData.type.trim()) {
      errors.type = "Integration Type is required.";
    } else if (!/^[a-zA-Z0-9\s-_]+$/.test(formData.type.trim())) {
      errors.type = "Type contains invalid characters.";
    } else if (/^\d+$/.test(formData.type.trim())) {
      errors.type = "Type cannot be only numbers.";
    }

    if (!formData.serverName?.trim()) {
      errors.serverName = "Server Name is required.";
    }

    if (!formData.serverIp.trim()) {
      errors.serverIp = "Server IP is required.";
    } else {
      const ipRegex = /^(((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,11}|localhost|[a-zA-Z0-9-_]+)(:\d+)?$/;
      if (!ipRegex.test(formData.serverIp.trim())) {
        errors.serverIp = "Enter a valid IP address or hostname (port is optional).";
      }
    }

    if (!formData.host.trim()) {
      errors.host = "Host Address is required.";
    } else {
      const hostRegex = /^(((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,11}|localhost|[a-zA-Z0-9-_]+)(:\d+)?$/;
      if (!hostRegex.test(formData.host.trim())) {
        errors.host = "Enter a valid IP address or hostname.";
      }
    }

    if (!formData.port.trim()) {
      errors.port = "Port is required.";
    } else if (!/^\d+$/.test(formData.port.trim()) || parseInt(formData.port.trim(), 10) < 1 || parseInt(formData.port.trim(), 10) > 65535) {
      errors.port = "Port must be a number between 1 and 65535.";
    }

    let hasStreamError = false;
    for (let stream of formData.streams) {
      if (!stream.name.trim() || !stream.value.trim()) {
        hasStreamError = true;
      }
    }
    if (hasStreamError) {
      errors.streams = "All streams must have a Name and a Topic/Key.";
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      showToast("Please check the form for errors.", "error");
      return;
    }

    setFormErrors({});

    try {
      const token = localStorage.getItem("token") || localStorage.getItem("miradorai_token");
      const headers = {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      };

      const API_BASE = import.meta.env.VITE_API_URL || "";
      const exists = connections.find((c) => c.id === formData.id || c._id === formData.id);

      const payload = {
        ...formData,
        updated_at: Date.now() / 1000,
      };

      const res = await fetch(`${API_BASE}/api/integrations${exists ? `/${formData.id}` : ""}`, {
        method: exists ? "PUT" : "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        fetchIntegrations();
        window.dispatchEvent(new Event("integrationsUpdated"));
        setShowForm(false);
        navigate("/integration");
        showToast(exists ? "Connection updated successfully." : "Connection saved successfully.", "success");
      } else {
        console.error("Failed to save integration");
        showToast("Failed to save connection. Please try again.", "error");
      }
    } catch (err) {
      console.error("Error saving integration", err);
      showToast("Failed to save connection. Please try again.", "error");
    }
  };

  const handleCancel = () => {
    setFormErrors({});
    setShowForm(false);
    navigate("/integration");
  };

  return (
    <div className="integration-page-container">
      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div className="integration-top-header">
        <div className="integration-top-header__left">
          {showForm && (
            <button className="integration-back-circle-btn" onClick={handleCancel} title="Back to Connections">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <div className="integration-header-icon-badge">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <div>
            <h1 className="integration-header-title">
              {showForm ? (isEditing ? "Edit Connection" : "New Connection") : "Integrations"}
            </h1>
            {!showForm && (
              <p className="integration-header-subtitle">
                Manage databases, message brokers, and AI server connections.
              </p>
            )}
          </div>
        </div>

        {showForm && (
          <div className="integration-top-header__right">
            <div
              className={`integration-status-pill ${
                formData.isConnected
                  ? "is-connected"
                  : formData.isActive
                  ? "is-active"
                  : "is-inactive"
              }`}
            >
              <span className="integration-status-dot" />
              <span>
                {formData.isConnected
                  ? "Connected"
                  : formData.isActive
                  ? "Active"
                  : "Disconnected"}
              </span>
            </div>

            <div className="integration-last-updated">
              <svg className="integration-last-updated__icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <div className="integration-last-updated__content">
                <span className="integration-last-updated__label">Last Updated</span>
                <span className="integration-last-updated__time">
                  {formatDate(formData.updated_at || formData.created_at)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── CONTENT ────────────────────────────────────────────────────────── */}
      {!showForm ? (
        /* Table / List View */
        <div className="integration-list-view">
          <div className="integration-list-header">
            <div className="integration-list-title-wrap">
              <h2 className="integration-card-title" style={{ fontSize: "18px" }}>
                Configured Connections
              </h2>
              <span className="integration-count-badge">
                {connections.length} {connections.length === 1 ? "Active" : "Total"}
              </span>
            </div>
            <Button label="+ New Connection" onClick={handleNewConnection} />
          </div>

          {connections.length === 0 ? (
            <div className="integration-empty">
              <div className="integration-empty__icon">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 9l6 6M4.93 19.07l3.54-3.54M19.07 4.93l-3.54 3.54"></path>
                  <path d="M8.5 8.5l-2 2a3.54 3.54 0 0 0 5 5l2-2M15.5 15.5l2-2a3.54 3.54 0 0 0-5-5l-2 2"></path>
                </svg>
              </div>
              <p className="integration-empty__title">No connections configured yet</p>
              <p className="integration-empty__sub">
                Connect a database, message broker, or AI server to start streaming data into the VMS.
              </p>
              <Button label="+ Create First Connection" onClick={handleNewConnection} />
            </div>
          ) : (
          <div className="integration-table-wrap">
            <table className="integration-table">
              <thead>
                <tr>
                  <th style={{ width: "170px" }}>Connection ID</th>
                  <th style={{ width: "170px" }}>Integration Type</th>
                  <th>Server Name</th>
                  <th>Server IP</th>
                  <th>Host : Port</th>
                  <th style={{ width: "120px" }}>Status</th>
                  <th style={{ width: "90px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((conn) => (
                  <tr key={conn.id || conn._id}>
                    <td>
                      <div className="integration-id-cell">
                        <span>{conn.id ? `${conn.id.slice(0, 10)}…` : "—"}</span>
                        {conn.id && (
                          <button
                            type="button"
                            className="integration-overview-copy-btn"
                            onClick={() => handleCopyId(conn.id)}
                            title="Copy Full ID"
                          >
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="integration-type-text">{conn.type || "Custom"}</span>
                    </td>
                    <td style={{ color: "var(--text-secondary)" }}>{conn.serverName || "—"}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "12.5px" }}>{conn.serverIp || "—"}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "12.5px" }}>
                      {conn.host ? `${conn.host}${conn.port ? `:${conn.port}` : ""}` : "—"}
                    </td>
                    <td>
                      <div className={`status-badge ${conn.isActive ? "active" : ""}`}>
                        <span className="status-badge__dot" />
                        {conn.isActive ? "Active" : "Inactive"}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "8px", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="connection-action-btn edit-btn"
                          onClick={() => handleEditConnection(conn)}
                          title="Edit Connection"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="connection-action-btn delete-btn"
                          onClick={() => handleDeleteConnection(conn.id || conn._id)}
                          title="Delete Connection"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      ) : (
        /* 2-Column Edit / New Form Layout */
        <div className="integration-layout-grid">
          {/* LEFT COLUMN: Settings Cards */}
          <div className="integration-layout-main">
            {/* 1. General Settings Card */}
            <div className="integration-card-modern">
              <div className="integration-card-header">
                <div className="integration-card-badge badge-blue">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </div>
                <div className="integration-card-header__text">
                  <h3 className="integration-card-title">General Settings</h3>
                  <p className="integration-card-subtitle">Basic information about the integration connection.</p>
                </div>
              </div>

              <div className="integration-form-grid">
                {/* Connection ID */}
                <div className="integration-field-group">
                  <label className="integration-field-label">
                    Connection ID
                    <span className="integration-info-icon" title="Unique identifier assigned to this connection">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                    </span>
                  </label>
                  <div className="integration-input-box">
                    <span className="integration-input-icon">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="4" y1="9" x2="20" y2="9" />
                        <line x1="4" y1="15" x2="20" y2="15" />
                        <line x1="10" y1="3" x2="8" y2="21" />
                        <line x1="16" y1="3" x2="14" y2="21" />
                      </svg>
                    </span>
                    <input
                      type="text"
                      className="integration-input-modern read-only"
                      value={formData.id}
                      readOnly
                    />
                    <button
                      type="button"
                      className="integration-input-action-btn"
                      onClick={() => handleCopyId(formData.id)}
                      title="Copy Connection ID"
                    >
                      {copiedId ? (
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--teal)" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Integration Type */}
                <div className="integration-field-group">
                  <label className="integration-field-label">Integration Type</label>
                  <div className="integration-input-box">
                    <span className="integration-input-icon">
                      <IntegrationTypeIcon type={formData.type} />
                    </span>
                    <input
                      type="text"
                      list="integration-type-options"
                      className={`integration-input-modern ${formErrors.type ? "has-error" : ""}`}
                      value={formData.type}
                      onChange={(e) => {
                        setFormData({ ...formData, type: e.target.value });
                        if (formErrors.type) setFormErrors({ ...formErrors, type: null });
                      }}
                      placeholder="e.g. Mirador AI, Kafka, MQTT, Redis"
                    />
                    <datalist id="integration-type-options">
                      <option value="Mirador AI" />
                      <option value="Kafka" />
                      <option value="MQTT" />
                      <option value="Redis" />
                      <option value="MongoDB" />
                      <option value="Camera / ONVIF" />
                    </datalist>
                  </div>
                  {formErrors.type && <span className="integration-field-error">{formErrors.type}</span>}
                </div>

                {/* Server Name */}
                <div className="integration-field-group">
                  <label className="integration-field-label">Server Name</label>
                  <div className="integration-input-box">
                    <span className="integration-input-icon">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                        <line x1="6" y1="6" x2="6.01" y2="6" />
                        <line x1="6" y1="18" x2="6.01" y2="18" />
                      </svg>
                    </span>
                    <input
                      type="text"
                      className={`integration-input-modern ${formErrors.serverName ? "has-error" : ""}`}
                      value={formData.serverName || ""}
                      onChange={(e) => {
                        setFormData({ ...formData, serverName: e.target.value });
                        if (formErrors.serverName) setFormErrors({ ...formErrors, serverName: null });
                      }}
                      placeholder="e.g. Main AI Server"
                    />
                  </div>
                  {formErrors.serverName && <span className="integration-field-error">{formErrors.serverName}</span>}
                </div>

                {/* Server IP + Connect Button */}
                <div className="integration-field-group">
                  <label className="integration-field-label">Server IP</label>
                  <div style={{ display: "flex", gap: "8px", width: "100%" }}>
                    <div className="integration-input-box" style={{ flex: 1 }}>
                      <span className="integration-input-icon">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="2" y1="12" x2="22" y2="12" />
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                      </span>
                      <input
                        type="text"
                        className={`integration-input-modern ${formErrors.serverIp ? "has-error" : ""}`}
                        value={formData.serverIp}
                        onChange={(e) => {
                          setFormData({ ...formData, serverIp: e.target.value, isConnected: false });
                          if (formErrors.serverIp) setFormErrors({ ...formErrors, serverIp: null });
                        }}
                        placeholder="e.g. 192.168.126.18"
                      />
                    </div>
                    <button
                      type="button"
                      className={`integration-ping-btn ${formData.isConnected ? "is-connected" : ""}`}
                      onClick={handlePingServer}
                      disabled={isPinging}
                    >
                      {isPinging ? (
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" className="spin">
                          <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                        </svg>
                      ) : formData.isConnected ? (
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                      )}
                      <span>{formData.isConnected ? "Connected" : isPinging ? "Testing…" : "Connect"}</span>
                    </button>
                  </div>
                  {formErrors.serverIp && <span className="integration-field-error">{formErrors.serverIp}</span>}
                </div>

                {/* Status Bar */}
                <div className="integration-field-group full-width">
                  <div className="integration-status-row">
                    <div className="integration-status-row__left">
                      <span className="integration-status-row__label">Status</span>
                      <div
                        className={`integration-status-pill ${
                          formData.isConnected
                            ? "is-connected"
                            : formData.isActive
                            ? "is-active"
                            : "is-inactive"
                        }`}
                      >
                        <span className="integration-status-dot" />
                        <span>
                          {formData.isConnected
                            ? "Connected"
                            : formData.isActive
                            ? "Active"
                            : "Disconnected"}
                        </span>
                      </div>
                    </div>

                    <div className="integration-status-row__right">
                      <label className="integration-toggle-item">
                        <span className="integration-active-badge-label">
                          {formData.isActive ? "ACTIVE" : "INACTIVE"}
                        </span>
                        <Toggle
                          value={formData.isActive}
                          onChange={async (v) => {
                            const updatedForm = { ...formData, isActive: v };
                            setFormData(updatedForm);

                            const exists = connections.find((c) => c.id === formData.id || c._id === formData.id);
                            if (exists) {
                              try {
                                const token = localStorage.getItem("token") || localStorage.getItem("miradorai_token");
                                const API_BASE = import.meta.env.VITE_API_URL || "";
                                const targetId = formData.id || formData._id;
                                const payload = {
                                  ...exists,
                                  ...updatedForm,
                                  updated_at: Date.now() / 1000,
                                };
                                const res = await fetch(`${API_BASE}/api/integrations/${targetId}`, {
                                  method: "PUT",
                                  headers: {
                                    "Content-Type": "application/json",
                                    Authorization: token ? `Bearer ${token}` : "",
                                  },
                                  body: JSON.stringify(payload),
                                });
                                if (res.ok) {
                                  fetchIntegrations();
                                  window.dispatchEvent(new Event("integrationsUpdated"));
                                }
                              } catch (err) {
                                console.error("Failed to persist active status", err);
                              }
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Connection Details Card */}
            <div className="integration-card-modern">
              <div className="integration-card-header">
                <div className="integration-card-badge badge-purple">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                </div>
                <div className="integration-card-header__text">
                  <h3 className="integration-card-title">Connection Details</h3>
                  <p className="integration-card-subtitle">Host and authentication details for the connection.</p>
                </div>
              </div>

              <div className="integration-form-grid">
                {/* Host Address */}
                <div className="integration-field-group">
                  <label className="integration-field-label">Host Address</label>
                  <div className="integration-input-box">
                    <span className="integration-input-icon">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    </span>
                    <input
                      type="text"
                      className={`integration-input-modern ${formErrors.host ? "has-error" : ""}`}
                      value={formData.host}
                      onChange={(e) => {
                        setFormData({ ...formData, host: e.target.value });
                        if (formErrors.host) setFormErrors({ ...formErrors, host: null });
                      }}
                      placeholder="e.g. 127.0.0.1"
                    />
                  </div>
                  {formErrors.host && <span className="integration-field-error">{formErrors.host}</span>}
                </div>

                {/* Port */}
                <div className="integration-field-group">
                  <label className="integration-field-label">Port</label>
                  <div className="integration-input-box">
                    <span className="integration-input-icon">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <path d="M9 8v4" />
                        <path d="M12 8v4" />
                        <path d="M15 8v4" />
                        <path d="M8 16h8" />
                      </svg>
                    </span>
                    <input
                      type="text"
                      className={`integration-input-modern ${formErrors.port ? "has-error" : ""}`}
                      value={formData.port}
                      onChange={(e) => {
                        setFormData({ ...formData, port: e.target.value });
                        if (formErrors.port) setFormErrors({ ...formErrors, port: null });
                      }}
                      placeholder="e.g. 6379"
                    />
                  </div>
                  {formErrors.port && <span className="integration-field-error">{formErrors.port}</span>}
                </div>

                {/* Username */}
                <div className="integration-field-group">
                  <label className="integration-field-label">Username (Optional)</label>
                  <div className="integration-input-box">
                    <span className="integration-input-icon">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </span>
                    <input
                      type="text"
                      className="integration-input-modern"
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      placeholder="Enter username"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="integration-field-group">
                  <label className="integration-field-label">Password (Optional)</label>
                  <div className="integration-input-box">
                    <span className="integration-input-icon">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input
                      type={showPassword ? "text" : "password"}
                      className="integration-input-modern"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      className="integration-input-action-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Topics / Streams Card */}
            <div className="integration-card-modern">
              <div className="integration-card-header" style={{ justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div className="integration-card-badge badge-teal">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="integration-card-title">Topics / Streams</h3>
                    <p className="integration-card-subtitle">Configure the topics or streams for this integration.</p>
                  </div>
                </div>
                <button type="button" className="integration-btn-outline-sm" onClick={handleAddStream}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Stream
                </button>
              </div>

              {formErrors.streams && (
                <div className="integration-field-error" style={{ marginBottom: "12px" }}>
                  {formErrors.streams}
                </div>
              )}

              {formData.streams.length === 0 ? (
                <div className="integration-streams-empty">
                  No topics or streams configured. Click <strong>+ Add Stream</strong> to map message streams.
                </div>
              ) : (
                <div className="integration-streams-list">
                  {formData.streams.map((stream) => (
                    <div key={stream.id} className="integration-stream-item">
                      <div className="integration-drag-handle" title="Drag to reorder">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="9" cy="6" r="1" />
                          <circle cx="9" cy="12" r="1" />
                          <circle cx="9" cy="18" r="1" />
                          <circle cx="15" cy="6" r="1" />
                          <circle cx="15" cy="12" r="1" />
                          <circle cx="15" cy="18" r="1" />
                        </svg>
                      </div>
                      <input
                        type="text"
                        className="integration-input-modern"
                        value={stream.name}
                        onChange={(e) => handleStreamChange(stream.id, "name", e.target.value)}
                        placeholder="Stream Name (e.g. cam, live_events)"
                      />
                      <input
                        type="text"
                        className="integration-input-modern"
                        value={stream.value}
                        onChange={(e) => handleStreamChange(stream.id, "value", e.target.value)}
                        placeholder="Topic / Key (e.g. vms:events)"
                      />
                      <button
                        type="button"
                        className="integration-stream-delete-btn"
                        onClick={() => handleRemoveStream(stream.id)}
                        title="Delete Stream"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
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

          {/* RIGHT COLUMN: Overview & Actions */}
          <div className="integration-layout-side">
            {/* 1. Connection Overview Card */}
            <div className="integration-card-modern integration-overview-card">
              <div className="integration-overview-banner">
                <div className="integration-overview-badge">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                  </svg>
                </div>
                <div>
                  <h4 className="integration-overview-title">Connection Overview</h4>
                  <p className="integration-overview-sub">Quick glance at your integration settings.</p>
                </div>
              </div>

              <div className="integration-overview-list">
                {/* ID */}
                <div className="integration-overview-item">
                  <div className="integration-overview-item__left">
                    <div className="integration-overview-item__icon">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      </svg>
                    </div>
                    <div className="integration-overview-item__info">
                      <span className="integration-overview-item__label">Connection ID</span>
                      <span className="integration-overview-item__val mono">{formData.id}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="integration-overview-copy-btn"
                    onClick={() => handleCopyId(formData.id)}
                    title="Copy ID"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  </button>
                </div>

                {/* Type */}
                <div className="integration-overview-item">
                  <div className="integration-overview-item__left">
                    <div className="integration-overview-item__icon">
                      <IntegrationTypeIcon type={formData.type} />
                    </div>
                    <div className="integration-overview-item__info">
                      <span className="integration-overview-item__label">Integration Type</span>
                      <span className="integration-overview-item__val">{formData.type || "Not configured"}</span>
                    </div>
                  </div>
                </div>

                {/* Server Name */}
                <div className="integration-overview-item">
                  <div className="integration-overview-item__left">
                    <div className="integration-overview-item__icon">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                        <line x1="6" y1="6" x2="6.01" y2="6" />
                        <line x1="6" y1="18" x2="6.01" y2="18" />
                      </svg>
                    </div>
                    <div className="integration-overview-item__info">
                      <span className="integration-overview-item__label">Server Name</span>
                      <span className="integration-overview-item__val">{formData.serverName || "—"}</span>
                    </div>
                  </div>
                </div>

                {/* Server IP */}
                <div className="integration-overview-item">
                  <div className="integration-overview-item__left">
                    <div className="integration-overview-item__icon">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                      </svg>
                    </div>
                    <div className="integration-overview-item__info">
                      <span className="integration-overview-item__label">Server IP</span>
                      <span className="integration-overview-item__val mono">{formData.serverIp || "—"}</span>
                    </div>
                  </div>
                </div>

                {/* Status */}
                <div className="integration-overview-item">
                  <div className="integration-overview-item__left">
                    <div className="integration-overview-item__icon">
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: (formData.isConnected || formData.isActive)
                            ? "#10b981"
                            : "var(--text-muted)",
                          boxShadow: (formData.isConnected || formData.isActive)
                            ? "0 0 0 2px rgba(16, 185, 129, 0.25)"
                            : "none",
                        }}
                      />
                    </div>
                    <div className="integration-overview-item__info">
                      <span className="integration-overview-item__label">Status</span>
                      <div
                        className={`integration-status-pill ${
                          formData.isConnected
                            ? "is-connected"
                            : formData.isActive
                            ? "is-active"
                            : "is-inactive"
                        }`}
                        style={{ padding: "3px 10px", fontSize: "11px", marginTop: "2px" }}
                      >
                        <span className="integration-status-dot" style={{ width: "5px", height: "5px" }} />
                        <span>
                          {formData.isConnected
                            ? "Connected"
                            : formData.isActive
                            ? "Active"
                            : "Disconnected"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="integration-side-actions">
              <button type="button" className="integration-btn-primary-large" onClick={handleSave}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v14a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                Save Changes
              </button>

              <button type="button" className="integration-btn-cancel-large" onClick={handleCancel}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`integration-toast integration-toast--${toast.type} ${toast.leaving ? "is-leaving" : ""}`}>
          <span className="integration-toast__icon">
            {toast.type === "error" ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            ) : toast.type === "info" ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          <span className="integration-toast__msg">{toast.message}</span>
          <button className="integration-toast__close" onClick={dismissToast} aria-label="Dismiss">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}