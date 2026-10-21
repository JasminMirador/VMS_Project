import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import CameraThumb from "../../components/shared/CameraThumb";
import SearchBar from "../../components/shared/SearchBar";
import StatusBadge from "../../components/shared/StatusBadge";
import WebRTCPlayer_MediaMTX from "../../components/shared/WebRTCPlayer_MediaMTX";
import ManualSearchModal from "./ManualSearchModal";
import StreamURLModal from "./StreamURLModal";
import DiscoveryModal from "../../components/shared/DiscoveryModal";
import CreateGroupModal from "./CreateGroupModal";
import SpecularButton from "../../components/shared/SpecularButton";
import { useTheme } from "../../context/ThemeContext";
import "./AddDevicesPage.css";
import "./CamerasPage.css";
import useActivityLogger from "../../hooks/useActivityLogger";
import EdgeManualConfigModal from "./EdgeManualConfigModal";
import Toast from "../../components/shared/Toast";

import EdgeDevicesSection, {
isEdgeCamera,
CctvIcon,
EdgeBoxIcon,
EdgeCredentialsModal,
SectionHead,
} from "./Edgedevices";

const STREAM_API = import.meta.env.VITE_API_URL;
// Map backend status values to frontend-expected values for StatusBadge
function normalizeStatus(raw) {
  if (!raw) return "Offline";
  const s = raw.toLowerCase();
  if (["online", "streaming", "active", "running"].includes(s)) return "Online";
  if (["offline", "stopped", "error", "not_registered"].includes(s)) return "Offline";
  return raw;
}

function getAuthHeaders() {
  const t = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

// ─── Persisted Devices ───────────────────────────────────────────────────────
function usePersistedDevices() {
  const [devices, setDevices] = useState([]);

  const updateDevices = useCallback((updater) => {
    setDevices((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  return [devices, updateDevices];
}

import useGroups from "../../hooks/useGroups";


// ─── Empty State ─────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="add-dev__empty">
      <div className="add-dev__empty-icon">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.2" width="64" height="64" style={{ flexShrink: 0 }}>
          <rect x="8" y="16" width="40" height="28" rx="4" stroke="var(--border-light)" />
          <path d="M48 26l10 6-10 6V26z" stroke="var(--border-light)" />
          <circle cx="28" cy="30" r="6" stroke="var(--text-muted)" />
          <path d="M16 52h32" stroke="var(--border-light)" strokeLinecap="round" />
          <path d="M32 44v8" stroke="var(--border-light)" strokeLinecap="round" />
          <circle cx="50" cy="14" r="8" fill="var(--bg-elevated)" stroke="var(--border-light)" />
          <path d="M50 11v4M50 17h.01" stroke="var(--brand)" strokeLinecap="round" />
        </svg>
        <div className="add-dev__empty-pulse" />
      </div>
      <p className="add-dev__empty-title">No devices enrolled yet</p>
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function ContextMenu({ x, y, onEdit, onRemove, onStreamProfiles, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handle = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("contextmenu", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("contextmenu", handle);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{
        position: "fixed",
        top: Math.min(y, window.innerHeight - 150),
        left: Math.min(x, window.innerWidth - 180),
        zIndex: 9999,
      }}
    >
      <button className="ctx-item" onClick={() => { onStreamProfiles(); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}>
          <path d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14"/>
          <rect x="1" y="6" width="15" height="12" rx="2"/>
        </svg>
        Stream Profiles
      </button>
      <div className="ctx-divider" />
      <button className="ctx-item" onClick={() => { onEdit(); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}>
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        Edit
      </button>
      <div className="ctx-divider" />
      <button className="ctx-item ctx-item--danger" onClick={() => { onRemove(); onClose(); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ flexShrink: 0 }}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
        </svg>
        Remove
      </button>
    </div>
  );
}

// ─── Edit Device Modal ────────────────────────────────────────────────────────
// Group reassignment is kept here — useful for moving a camera after the fact.
export function EditDeviceModal({ device, groups, onClose, onSave }) {
  const { theme } = useTheme();
  const isEdge = isEdgeCamera(device);
  
  const initialRtsp = device.rtsp_url || device.recording_rtsp || device.source_rtsp || "";
  let initialUsername = device.username || "";
  let initialPassword = device.password || "";
  let initialCleanUrl = initialRtsp;

  if (initialRtsp) {
    const match = initialRtsp.match(/^(rtsps?:\/\/)(?:([^:]+)(?::([^@]+))?@)?(.*)$/i);
    if (match) {
      if (match[2]) initialUsername = decodeURIComponent(match[2]);
      if (match[3]) initialPassword = decodeURIComponent(match[3]);
      initialCleanUrl = match[1] + match[4];
    }
  }

  const [form, setForm] = useState({
    device_name: device.device_name || device.name || "",
    camera_id: device.camera_id || "",
    ip: device.ip || device.ip_address || "",
    mac: device.mac || "",
    manufacturer: device.manufacturer || "",
    model: device.model || "",
    username: initialUsername,
    password: initialPassword,
    clean_rtsp_url: initialCleanUrl,
    group_id: device.group_id || "default",
    enabled: device.enabled !== false && device.status !== "Offline",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [alertMsg, setAlertMsg] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (key === "device_name") setAlertMsg("");
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdge ? "Edit Edge Camera" : "Edit Device"}</h2>
          <button className="modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {alertMsg && (
            <div className="modal-ui-alert" style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", color: "var(--red)", padding: "10px 14px", borderRadius: "var(--radius-sm)", fontSize: "var(--font-size-content)", display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "16px" }}>
              <svg className="modal-ui-alert-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: "1px" }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div className="modal-ui-alert-text" style={{ flex: 1, lineHeight: 1.5 }}>{alertMsg}</div>
              <button className="modal-ui-alert-close" onClick={() => setAlertMsg("")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "18px", lineHeight: 1, padding: "2px" }}>✕</button>
            </div>
          )}

          {isEdge ? (
            <>
              {/* Edge Device Info Header Pill */}
              {(device.edge_name || device.edge_id) && (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "rgba(59, 130, 246, 0.08)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  marginBottom: "12px",
                  fontSize: "12.5px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <EdgeBoxIcon size={16} />
                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      Edge: {device.edge_name || device.edge_id}
                    </span>
                    {device.edge_id && device.edge_name !== device.edge_id && (
                      <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                        ({device.edge_id})
                      </span>
                    )}
                  </div>
                  <span style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "10px",
                    background: "rgba(59, 130, 246, 0.15)",
                    color: "var(--edge-accent, #3b82f6)"
                  }}>
                    Edge Stream
                  </span>
                </div>
              )}

              {/* Camera Name */}
              <div className="modal-field">
                <label className="modal-label">Camera Name</label>
                <input
                  className="modal-input"
                  value={form.device_name}
                  onChange={set("device_name")}
                  placeholder="e.g. Front Gate, Lobby PTZ"
                />
              </div>

              {/* Camera ID */}
              <div className="modal-field">
                <label className="modal-label">Camera ID</label>
                <input
                  className="modal-input"
                  value={form.camera_id}
                  onChange={set("camera_id")}
                  placeholder="e.g. cam01"
                />
              </div>

              {/* IP Address */}
              <div className="modal-field">
                <label className="modal-label">IP Address</label>
                <input
                  className="modal-input"
                  value={form.ip}
                  onChange={set("ip")}
                  placeholder="192.168.1.50"
                />
              </div>

              {/* Username */}
              <div className="modal-field">
                <label className="modal-label">Username</label>
                <input
                  className="modal-input"
                  value={form.username}
                  onChange={set("username")}
                  placeholder="admin"
                  autoComplete="off"
                />
              </div>

              {/* Password with Eye Toggle */}
              <div className="modal-field">
                <label className="modal-label">Password</label>
                <div style={{ position: "relative", width: "100%" }}>
                  <input
                    className="modal-input"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={set("password")}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    style={{ paddingRight: "36px", width: "100%", boxSizing: "border-box" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-muted)",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="3" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Stream URL */}
              <div className="modal-field">
                <label className="modal-label">Stream URL (RTSP)</label>
                <input
                  className="modal-input"
                  value={form.clean_rtsp_url}
                  onChange={set("clean_rtsp_url")}
                  placeholder="rtsp://192.168.1.64:554/live"
                  style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12.5px" }}
                />
              </div>

              {/* Status Toggle */}
              <div className="modal-field">
                <label className="modal-label">Camera Status</label>
                <div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      borderRadius: "20px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      border: "1px solid",
                      background: form.enabled ? "rgba(34, 197, 94, 0.12)" : "rgba(128, 128, 128, 0.12)",
                      borderColor: form.enabled ? "rgba(34, 197, 94, 0.3)" : "rgba(128, 128, 128, 0.3)",
                      color: form.enabled ? "#16a34a" : "var(--text-muted)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: form.enabled ? "#16a34a" : "var(--text-muted)",
                      }}
                    />
                    {form.enabled ? "Active / Online" : "Disabled / Offline"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {[
                { label: "Device Name", key: "device_name" },
                { label: "IP Address", key: "ip" },
                { label: "MAC Address", key: "mac" },
                { label: "Manufacturer", key: "manufacturer" },
                { label: "Model", key: "model" },
                { label: "Username", key: "username" },
                { label: "Password", key: "password" },
                { label: "RTSP URL", key: "clean_rtsp_url" },
              ].map(({ label, key }) => (
                <div className="modal-field" key={key}>
                  <label className="modal-label">{label}</label>
                  <input className="modal-input" value={form[key]} onChange={set(key)} placeholder={label} />
                </div>
              ))}
            </>
          )}

          <div className="modal-field">
            <label className="modal-label">Group</label>
            <div className="adp-custom-select" ref={dropdownRef} style={{ width: "100%" }}>
              <button
                type="button"
                className="modal-input"
                style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                <span>{form.group_id === "default" ? "Default" : groups.find(g => g.id === form.group_id)?.name || "Default"}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", marginLeft: "8px", opacity: 0.7 }}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {dropdownOpen && (
                <ul className="adp-dropdown-menu">
                  <li
                    className={`adp-dropdown-item ${form.group_id === "default" ? "active" : ""}`}
                    onClick={() => { setForm(f => ({ ...f, group_id: "default" })); setDropdownOpen(false); }}
                  >
                    Default
                  </li>
                  {groups.map(g => (
                    <li
                      key={g.id}
                      className={`adp-dropdown-item ${form.group_id === g.id ? "active" : ""}`}
                      onClick={() => { setForm(f => ({ ...f, group_id: g.id })); setDropdownOpen(false); }}
                    >
                      {g.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer" style={{ gap: "12px" }}>
          <SpecularButton
            onClick={onClose}
            size="sm"
            radius={6}
            tint="#475569"
            tintOpacity={0.1}
            blur={4}
            textColor={theme === 'light' ? "#334155" : "#ffffff"}
            lineColor="#64748b"
            baseColor={theme === 'light' ? "#f1f5f9" : "#1e293b"}
            intensity={1.2}
            shineSize={12}
            shineFade={38}
          >
            Cancel
          </SpecularButton>
          <SpecularButton
            onClick={() => {
              if (form.device_name) {
                const trimmed = form.device_name.trim();
                if (!/^[a-zA-Z0-9 _-]+$/.test(trimmed)) {
                  setAlertMsg("Device Name can only contain alphanumeric characters, spaces, dashes, and underscores.");
                  return;
                }
              }
              let final_rtsp_url = form.clean_rtsp_url;
              if (form.username || form.password) {
                const match = form.clean_rtsp_url.match(/^(rtsps?:\/\/)(.*)$/i);
                const u = form.username ? encodeURIComponent(form.username).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()) : "";
                const p = form.password ? encodeURIComponent(form.password).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()) : "";
                const credentials = `${u}${p ? ':' + p : ''}@`;
                if (match) {
                  final_rtsp_url = `${match[1]}${credentials}${match[2]}`;
                } else {
                  final_rtsp_url = `rtsp://${credentials}${form.clean_rtsp_url}`;
                }
              }
              const { clean_rtsp_url, ...restForm } = form;
              onSave({
                ...device,
                ...restForm,
                name: form.device_name,
                device_name: form.device_name,
                username: form.username,
                password: form.password,
                camera_id: form.camera_id || device.camera_id,
                rtsp_url: final_rtsp_url,
                source_rtsp: form.clean_rtsp_url || final_rtsp_url,
                recording_rtsp: final_rtsp_url,
                enabled: Boolean(form.enabled),
                status: form.enabled ? "Online" : "Offline",
              });
              onClose();
            }}
            size="sm"
            radius={6}
            tint="#3b82f6"
            tintOpacity={0.1}
            blur={4}
            textColor={theme === 'light' ? "#1e40af" : "#ffffff"}
            lineColor="#3b82f6"
            baseColor={theme === 'light' ? "#dbeafe" : "#1e3a8a"}
            intensity={1.2}
            shineSize={12}
            shineFade={38}
          >
            Save Changes
          </SpecularButton>
        </div>
      </div>
    </div>
  );
}

// ─── Remove Device Modal ──────────────────────────────────────────────────────
function RemoveDeviceModal({ device, onClose, onConfirm }) {
  const [isRemoving, setIsRemoving] = useState(false);

  const handleConfirm = async () => {
    setIsRemoving(true);
    await onConfirm(device.id || device.stream_key || device.camera_id || device.ip);
    setIsRemoving(false);
    onClose();
  };

  return (
    <div className="ec-overlay" onClick={isRemoving ? null : onClose}>
      <div className="ec-modal" onClick={(e) => e.stopPropagation()} style={{ width: 340 }}>
        <div className="ec-titlebar">
          <span className="ec-title">Remove Device</span>
          <div className="ec-titlebar-actions">
            {!isRemoving && (
              <button className="ec-title-btn" onClick={onClose} title="Close">✕</button>
            )}
          </div>
        </div>
        <div className="ec-body">
          {isRemoving ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "20px 0" }}>
              <div className="deleting-spinner"></div>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "var(--text-secondary)" }}>
                Removing device...
              </p>
            </div>
          ) : (
            <p className="ec-auth-desc" style={{ marginBottom: 0 }}>
              Are you sure you want to remove <strong>{device.name || device.ip}</strong> from the system?
            </p>
          )}
        </div>
        <div className="ec-footer">
          <div className="ec-footer-right" style={{ width: "100%", justifyContent: "flex-end", gap: "10px" }}>
            <button 
              className="ec-btn ec-btn--cancel" 
              onClick={onClose} 
              disabled={isRemoving}
              style={{ opacity: isRemoving ? 0.5 : 1 }}
            >
              Cancel
            </button>
            <button 
              className="ec-btn ec-btn--danger" 
              onClick={handleConfirm} 
              disabled={isRemoving}
              style={{ opacity: isRemoving ? 0.7 : 1 }}
            >
              {isRemoving ? "Removing..." : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RemoveEdgeModal({ edge, onClose, onConfirm }) {
  const [isRemoving, setIsRemoving] = useState(false);

  const handleConfirm = async () => {
    setIsRemoving(true);
    await onConfirm(edge);
    setIsRemoving(false);
    onClose();
  };

  const cameraCount = edge?.cameras?.length || 0;

  return (
    <div className="ec-overlay" onClick={isRemoving ? null : onClose}>
      <div className="ec-modal" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
        <div className="ec-titlebar">
          <span className="ec-title" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--red, #ef4444)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            Delete Edge Device
          </span>
          <div className="ec-titlebar-actions">
            {!isRemoving && (
              <button className="ec-title-btn" onClick={onClose} title="Close">✕</button>
            )}
          </div>
        </div>
        <div className="ec-body">
          {isRemoving ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "20px 0" }}>
              <div className="deleting-spinner"></div>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: "600", color: "var(--text-secondary)" }}>
                Deleting Edge device & all cameras...
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p className="ec-auth-desc" style={{ marginBottom: 0, fontSize: "14px", lineHeight: "1.5" }}>
                Are you sure you want to delete Edge device <strong>"{edge?.name || edge?.edge_id || edge?.ip}"</strong>?
              </p>
              <div style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                padding: "10px 14px",
                borderRadius: "6px",
                fontSize: "12.5px",
                color: "var(--text-secondary)"
              }}>
                <span style={{ color: "var(--red, #ef4444)", fontWeight: "600" }}>Warning: </span>
                This will permanently delete this Edge device and all <strong>{cameraCount} connected camera{cameraCount !== 1 ? "s" : ""}</strong> from the system and database.
              </div>
            </div>
          )}
        </div>
        <div className="ec-footer">
          <div className="ec-footer-right" style={{ width: "100%", justifyContent: "flex-end", gap: "10px" }}>
            <button 
              className="ec-btn ec-btn--cancel" 
              onClick={onClose} 
              disabled={isRemoving}
              style={{ opacity: isRemoving ? 0.5 : 1 }}
            >
              Cancel
            </button>
            <button 
              className="ec-btn ec-btn--danger" 
              onClick={handleConfirm} 
              disabled={isRemoving}
              style={{ opacity: isRemoving ? 0.7 : 1, background: "var(--red, #ef4444)" }}
            >
              {isRemoving ? "Deleting..." : "Delete Edge & Cameras"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── Add Edge Device Modal ────────────────────────────────────────────────────
function AddEdgeDeviceModal({ onClose, onConnected }) {
  const { theme } = useTheme();

  const [edgeIp, setEdgeIp] = useState("");
  const [edgeName, setEdgeName] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    const ip = edgeIp.trim();

    if (!ip) {
      setError("Please enter the Edge IP address.");
      return;
    }

    setConnecting(true);
    setError("");

    try {
      const response = await fetch(
        `http://${ip}:8000/api/edge/info`
      );

      if (!response.ok) {
        throw new Error("Unable to connect to Edge.");
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error("Edge is not available.");
      }

      const resolvedName = edgeName.trim() || data.name || "Mirador Edge";

      onConnected({
        ...data,
        ip,
        display_name: resolvedName,
        name: resolvedName,
        edge_name: resolvedName,
      });

    } catch (err) {
      console.error("Edge connection failed:", err);
      setError(
        "Unable to connect to Mirador Edge. Check the IP address and make sure the Edge service is running."
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={connecting ? undefined : onClose}>
      <div
        className="modal-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "480px", width: "100%" }}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            Add Edge Device
          </h2>

          <button
            className="modal-close"
            onClick={onClose}
            disabled={connecting}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="16"
              height="16"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body">

          {error && (
            <div
              className="modal-ui-alert"
              style={{
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "var(--red)",
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-content)",
                marginBottom: "16px"
              }}
            >
              {error}
            </div>
          )}

          <div className="modal-field">
            <label className="modal-label">
              Edge IP Address
            </label>

            <input
              className="modal-input"
              value={edgeIp}
              onChange={(e) => {
                setEdgeIp(e.target.value);
                setError("");
              }}
              placeholder="192.168.126.36"
              disabled={connecting}
              autoFocus
            />
          </div>

          <div className="modal-field" style={{ marginTop: 14 }}>
            <label className="modal-label">Edge Name (optional)</label>
            <input
              className="modal-input"
              value={edgeName}
              maxLength={40}
              onChange={(e) => setEdgeName(e.target.value)}
              placeholder="e.g. Warehouse Edge, Floor 1 Edge"
              disabled={connecting}
            />
          </div>

        </div>

        <div
          className="modal-footer"
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px"
          }}
        >
          <SpecularButton
            onClick={onClose}
            size="sm"
            radius={6}
            tint="#475569"
            tintOpacity={0.1}
            blur={4}
            textColor={theme === "light" ? "#334155" : "#ffffff"}
            lineColor="#64748b"
            baseColor={theme === "light" ? "#f1f5f9" : "#1e293b"}
            intensity={1.2}
            shineSize={12}
            shineFade={38}
            disabled={connecting}
          >
            Cancel
          </SpecularButton>

          <SpecularButton
            onClick={handleConnect}
            size="sm"
            radius={6}
            tint="#10b981"
            tintOpacity={0.1}
            blur={4}
            textColor={theme === "light" ? "#065f46" : "#ffffff"}
            lineColor="#10b981"
            baseColor={theme === "light" ? "#d1fae5" : "#0d3326"}
            intensity={1.2}
            shineSize={12}
            shineFade={38}
            disabled={connecting}
          >
            {connecting ? "Connecting..." : "Connect"}
          </SpecularButton>
        </div>
      </div>
    </div>
  );
}
function EdgeDeviceDetailsModal({
  edge,
  details,
  loading,
  error,
  onClose,
  onContinue,
}) {
  const { theme } = useTheme();

  const status = details?.status || "unknown";
  const isOnline = status.toLowerCase() === "online";

  const cardStyle = {
    padding: "16px",
    border: "1px solid var(--border-light)",
    borderRadius: "10px",
    background: "var(--bg-secondary)",
    minWidth: 0,
  };

  const labelStyle = {
    fontSize: "12px",
    color: "var(--text-muted)",
    marginBottom: "7px",
  };

  const valueStyle = {
    fontSize: "15px",
    fontWeight: 600,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "560px", maxWidth: "95vw" }}
      >
        <div className="modal-header">
          <h2 className="modal-title">Edge Device Details</h2>

          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div style={{ padding: "40px 10px", textAlign: "center" }}>
              Connecting to Edge and retrieving device details...
            </div>
          ) : error ? (
            <div
              style={{
                padding: "14px",
                borderRadius: "8px",
                color: "#ef4444",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
              }}
            >
              {error}
            </div>
          ) : details ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  marginBottom: "20px",
                }}
              >
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "12px",
                    background: "rgba(20,184,166,0.12)",
                    color: "var(--teal)",
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="26"
                    height="26"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  >
                    <rect x="3" y="4" width="18" height="14" rx="2" />
                    <path d="M8 21h8M12 18v3M7 8h10M7 12h6" />
                  </svg>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: "0 0 5px", fontSize: "18px" }}>
                    {details.name || "Mirador Edge"}
                  </h3>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                    {details.edge_id || "Edge device"} · {details.ip}
                  </div>
                </div>

                <span
                  style={{
                    padding: "5px 10px",
                    borderRadius: "20px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: isOnline ? "#16a34a" : "#ef4444",
                    background: isOnline
                      ? "rgba(34,197,94,0.10)"
                      : "rgba(239,68,68,0.10)",
                  }}
                >
                  ● {status}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "12px",
                }}
              >
                <div style={cardStyle}>
                  <div style={labelStyle}>Registered Channels</div>
                  <div style={{ ...valueStyle, fontSize: "26px" }}>
                    {details.registeredCount}
                  </div>
                  <div style={{ ...labelStyle, margin: "5px 0 0" }}>
                    Channels registered on Edge
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={labelStyle}>Active Streams</div>
                  <div style={{ ...valueStyle, fontSize: "26px" }}>
                    {details.streamingCount}
                  </div>
                  <div style={{ ...labelStyle, margin: "5px 0 0" }}>
                    Currently streaming
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={labelStyle}>Edge IP Address</div>
                  <div style={valueStyle}>{details.ip}</div>
                </div>

                <div style={cardStyle}>
                  <div style={labelStyle}>Software Version</div>
                  <div style={valueStyle}>{details.version || "Unknown"}</div>
                </div>

                <div style={{ ...cardStyle, gridColumn: "1 / -1" }}>
                  <div style={labelStyle}>Edge Device ID</div>
                  <div style={valueStyle}>{details.edge_id || "Unknown"}</div>
                </div>
              </div>

              {details.channels.length > 0 && (
                <div
                  style={{
                    marginTop: "18px",
                    fontSize: "13px",
                    color: "var(--text-muted)",
                  }}
                >
                  Registered channels are already configured on this Edge.
                  You can continue to discover additional cameras.
                </div>
              )}
            </>
          ) : null}
        </div>

        <div
          className="modal-footer"
          style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}
        >
          <button
            className="modal-btn modal-btn--cancel"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="modal-btn modal-btn--save"
            disabled={loading || !!error || !details}
            onClick={onContinue}
          >
            Continue to Cameras →
          </button>
        </div>
      </div>
    </div>
  );
}



// ─── Edge Channels Modal ──────────────────────────────────────────────────────
function EdgeChannelsModal({ edge, channels, loading, error, onClose, onContinue }) {
  const [selected, setSelected] = useState(new Set());
  const [collapsedBrands, setCollapsedBrands] = useState(new Set());

  const brandOf = (c) => (c.manufacturer || c.brand || "").trim() || "Cameras";

  const groupedChannels = useMemo(() => {
    const map = {};
    channels.forEach((c) => {
      const b = brandOf(c);
      if (!map[b]) map[b] = [];
      map[b].push(c);
    });
    return map;
  }, [channels]);

  const sortedBrands = useMemo(
    () => Object.keys(groupedChannels).sort(),
    [groupedChannels]
  );

  const toggleChannel = (ip) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(ip) ? next.delete(ip) : next.add(ip);
      return next;
    });
  };

  const isBrandAllSelected = (brand) => {
    const cams = groupedChannels[brand] || [];
    return cams.length > 0 && cams.every((c) => selected.has(c.ip));
  };

  const toggleBrandAll = (brand) => {
    const cams = groupedChannels[brand] || [];
    const allSelected = isBrandAllSelected(brand);
    setSelected((prev) => {
      const next = new Set(prev);
      cams.forEach((c) => (allSelected ? next.delete(c.ip) : next.add(c.ip)));
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(
      selected.size === channels.length
        ? new Set()
        : new Set(channels.map((c) => c.ip))
    );
  };

  const toggleBrandCollapse = (brand) => {
    setCollapsedBrands((prev) => {
      const next = new Set(prev);
      next.has(brand) ? next.delete(brand) : next.add(brand);
      return next;
    });
  };

  const handleContinue = () => {
    onContinue(channels.filter((c) => selected.has(c.ip)));
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal-box"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "620px",
          maxWidth: "95vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Select Edge Cameras</h2>
            <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--text-muted)" }}>
              Edge: {edge?.display_name || edge?.name || "Mirador Edge"} ({edge?.ip})
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ minHeight: 0, overflow: "hidden" }}>
          {loading && (
            <div
              style={{
                padding: "48px 20px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                textAlign: "center",
              }}
            >
              <div className="edge-discovering-spinner" />
              <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                Discovering cameras...
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Scanning connected ONVIF devices on Edge network
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: "12px",
                marginBottom: "15px",
                borderRadius: "8px",
                color: "#ef4444",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
              }}
            >
              {error}
            </div>
          )}

          {!loading && !error && channels.length > 0 && (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "14px",
                }}
              >
                <div>
                  <strong>{channels.length} cameras discovered</strong>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "3px" }}>
                    Select the cameras you want to add.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleAll}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--teal)",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  {selected.size === channels.length ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div className="edge-channels-list">
                {sortedBrands.map((brand) => {
                  const brandCams = groupedChannels[brand] || [];
                  const isCollapsed = collapsedBrands.has(brand);
                  const allSelected = isBrandAllSelected(brand);

                  return (
                    <div key={brand} className="edge-brand-group">
                      <div
                        className="edge-brand-header"
                        onClick={() => toggleBrandCollapse(brand)}
                      >
                        <div className="edge-brand-title">
                          <span
                            className={`edge-brand-caret ${
                              isCollapsed ? "edge-brand-caret--collapsed" : ""
                            }`}
                          >
                            ▼
                          </span>
                          <CctvIcon size={16} />
                          <strong>{brand === "Cameras" ? "Discovered Cameras" : brand}</strong>
                          <span className="edge-brand-count">
                            ({brandCams.length} Camera{brandCams.length !== 1 ? "s" : ""})
                          </span>
                        </div>
                      </div>

                      {!isCollapsed && (
                        <div className="edge-brand-content">
                          {brandCams.length > 1 && (
                            <div
                              className="edge-brand-select-all"
                              onClick={() => toggleBrandAll(brand)}
                            >
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={() => toggleBrandAll(brand)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span>Select All {brand}</span>
                            </div>
                          )}

                          <div className="edge-brand-cams">
                            {brandCams.map((camera) => {
                              const isSelected = selected.has(camera.ip);
                              return (
                                <label
                                  key={camera.ip}
                                  className={`edge-cam-card ${
                                    isSelected ? "edge-cam-card--selected" : ""
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleChannel(camera.ip)}
                                  />
                                  <div className="edge-cam-info">
                                    <div className="edge-cam-title">Camera {camera.ip}</div>
                                    <div className="edge-cam-model">
                                      {camera.manufacturer || "Camera"}
                                      {" · "}
                                      {camera.model || camera.ip}
                                    </div>
                                  </div>
                                  <span className="edge-cam-badge">Discovered</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {!loading && !error && channels.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>
              No cameras were discovered on this Edge device.
            </div>
          )}
        </div>

        <div
          className="modal-footer"
          style={{ display: "flex", justifyContent: "flex-end", gap: "10px", flexShrink: 0 }}
        >
          <button className="modal-btn modal-btn--cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="modal-btn modal-btn--save"
            disabled={selected.size === 0 || loading}
            onClick={handleContinue}
          >
            Continue ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AddDevicesPage({ onNavigate }) {
  const { theme } = useTheme();
  const { logActivity } = useActivityLogger();
  const [filter, setFilter] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [showStreamURL, setShowStreamURL] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [showEdgeDevice, setShowEdgeDevice] = useState(false);
  const [connectedEdge, setConnectedEdge] = useState(null);
  const [showEdgeDetails, setShowEdgeDetails] = useState(false);
  const [edgeDetails, setEdgeDetails] = useState(null);
  const [edgeDetailsLoading, setEdgeDetailsLoading] = useState(false);
  const [edgeDetailsError, setEdgeDetailsError] = useState("");
  const [edgeChannels, setEdgeChannels] = useState([]);
  const [showEdgeChannels, setShowEdgeChannels] = useState(false);
  const [edgeChannelsLoading, setEdgeChannelsLoading] = useState(false);
  const [edgeChannelsError, setEdgeChannelsError] = useState("");
  const [showEdgeCredentials, setShowEdgeCredentials] = useState(false);
  const [selectedEdgeChannels, setSelectedEdgeChannels] = useState([]);
  const [showEdgeConfigModal, setShowEdgeConfigModal] = useState(false);

  
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [uiError, setUiError] = useState("");
  


  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target)) {
        setFilterDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [toastNotification, setToastNotification] = useState(null);

  useEffect(() => {
    const handleToastEvent = (e) => {
      if (e?.detail) {
        setToastNotification(e.detail);
      }
    };
    window.addEventListener("showAppToast", handleToastEvent);
    return () => window.removeEventListener("showAppToast", handleToastEvent);
  }, []);

  const [enrolling, setEnrolling] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState("");
  const [enrollProgress, setEnrollProgress] = useState(0);
  const [enrollTotal, setEnrollTotal] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [successEnrollData, setSuccessEnrollData] = useState(null);
  const [devices, setDevices] = usePersistedDevices();
  const [groups, setGroups, fetchGroups] = useGroups();
  const [ctxMenu, setCtxMenu] = useState(null);
  const [editDevice, setEditDevice] = useState(null);
  const [deviceToRemove, setDeviceToRemove] = useState(null);
  const [edgeToRemove, setEdgeToRemove] = useState(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [previewDevice, setPreviewDevice] = useState(null);


  // selectedGroupId is owned here but only mutated/read through modals (FIX 1).
  const [selectedGroupId, setSelectedGroupId] = useState("default");
  const { logAction } = useActivityLogger();



  const isFetchingRef = useRef(false);

  const fetchLatestDevices = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const res = await fetch(`${STREAM_API}/api/cameras`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        const backendDevices = Array.isArray(data) ? data : (data.devices || []);
        setDevices((prev) => {
          const updated = [];
          prev.forEach((localCam) => {
            let match = backendDevices.find((b) => 
              (b.stream_key && localCam.stream_key && b.stream_key === localCam.stream_key) ||
              (b.id && localCam.id && b.id === localCam.id) ||
              (b._id && localCam.id && b._id === localCam.id) ||
              (b.camera_id && localCam.camera_id && b.camera_id === localCam.camera_id) ||
              (b.ip && localCam.ip && b.rtsp_url && localCam.rtsp_url && b.ip === localCam.ip && b.rtsp_url === localCam.rtsp_url)
            );
            if (!match) {
              match = backendDevices.find((b) => b.ip === localCam.ip && b.channel === localCam.channel);     
            }
            
            if (match) {
              const computedBackendName = match.name || match.device_name || (`${match.manufacturer || ""} ${match.model || ""}`.trim());
              const resolvedId = match.id || match._id || localCam.id || match.stream_key || (match.edge_id && match.camera_id ? `${match.edge_id}_${match.camera_id}` : match.ip);
              updated.push({
                ...localCam,
                ...match,
                id: resolvedId,
                edge_id: match.edge_id || localCam.edge_id,
                edge_ip: match.edge_ip || localCam.edge_ip,
                edge_name: match.edge_name || localCam.edge_name,
                type: match.type || localCam.type || "entrance",
                name: computedBackendName || localCam.name || `Camera @ ${match.ip}`,
                status: normalizeStatus(match.status || localCam.status),
                group_id: localCam.group_id && localCam.group_id !== "default" ? localCam.group_id : (match.group_id || "default"),
              });
            }
          });
          
          const backendOnly = backendDevices.filter((b) => !prev.some((localCam) => 
            (b.stream_key && localCam.stream_key && b.stream_key === localCam.stream_key) ||
            (b.id && localCam.id && b.id === localCam.id) ||
            (b._id && localCam.id && b._id === localCam.id) ||
            (b.camera_id && localCam.camera_id && b.camera_id === localCam.camera_id) ||
            (!b.stream_key && !b.id && b.ip === localCam.ip && b.channel === localCam.channel)
          )).map((b) => {
            const bName = b.name || b.device_name || (`${b.manufacturer || ""} ${b.model || ""}`.trim()) || `Camera @ ${b.ip}`;
            const resolvedId = b.id || b._id || b.stream_key || (b.edge_id && b.camera_id ? `${b.edge_id}_${b.camera_id}` : b.ip);
            return { 
              ...b, 
              id: resolvedId,
              edge_id: b.edge_id,
              edge_ip: b.edge_ip,
              edge_name: b.edge_name,
              type: b.type || "entrance", 
              name: bName, 
              status: normalizeStatus(b.status) 
            };
          });
          return [...updated, ...backendOnly];
        });
      }
    } catch (err) {
      console.error("Failed to fetch latest devices/shards from backend:", err);
    } finally {
      isFetchingRef.current = false;
    }
  }, [setDevices]);

  useEffect(() => {
    fetchLatestDevices();
  }, []);

  // Capture snapshot when live preview plays
  useEffect(() => {
    if (!previewDevice || (!previewDevice.ws_url && !previewDevice.stream_key)) return;

    let intervalId;
    let attempts = 0;

    const captureFrame = () => {
      const video = document.querySelector(".modal-body video");
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 117;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.7);

          // Update devices state (thumbnail is updated in UI immediately and saved to DB below)
          setDevices((prev) =>
            prev.map((d) =>
              String(d.id) === String(previewDevice.id)
                ? { ...d, thumbnail: dataUrl }
                : d
            )
          );
          
          if (previewDevice.ip) {
            fetch(`${STREAM_API}/api/cameras/by-ip/${previewDevice.ip}`, {
              method: "PUT",
              headers: getAuthHeaders(),
              body: JSON.stringify({ thumbnail: dataUrl }),
            }).catch(err => console.error("Failed to save thumbnail to DB:", err));
          }
          
          console.log(`[SNAPSHOT] Successfully captured live frame for camera ID: ${previewDevice.id}`);
          clearInterval(intervalId);
        } catch (e) {
          console.error("Failed to capture video frame:", e);
        }
      }

      attempts++;
      if (attempts > 30) { // Stop polling after 15 seconds
        clearInterval(intervalId);
      }
    };

    // Check every 500ms for active video stream to capture a fresh frame
    intervalId = setInterval(captureFrame, 500);

    return () => {
      clearInterval(intervalId);
    };
  }, [previewDevice, setDevices]);

  // ── Smart modal openers — pre-select active group (FIX 5) ────────────────
  const openManualSearch = () => {
    setSelectedGroupId(activeGroup === "all" ? "default" : activeGroup);
    setShowManualSearch(true);
  };
  const openDiscovery = () => {
    setSelectedGroupId(activeGroup === "all" ? "default" : activeGroup);
    setShowDiscovery(true);
  };
  const openStreamURL = () => {
    setSelectedGroupId(activeGroup === "all" ? "default" : activeGroup);
    setShowStreamURL(true);
  };

  // ── Filtered list (search + group) ───────────────────────────────────────
  const matchesFilters = (d) => {
    const matchSearch =
      (d.name || "").toLowerCase().includes(filter.toLowerCase()) ||
      (d.ip || "").toLowerCase().includes(filter.toLowerCase());
    const matchGroup =
      activeGroup === "all" || (d.group_id || "default") === activeGroup;
    return matchSearch && matchGroup;
  };

  const filtered = devices.filter((d) => !isEdgeCamera(d) && matchesFilters(d));
  const edgeFiltered = devices.filter((d) => isEdgeCamera(d) && matchesFilters(d));
  const hasEdge = edgeFiltered.length > 0;

  const onlineCount = filtered.filter((d) => d.status === "Online").length;
  const countForGroup = (gid) => devices.filter((d) => (d.group_id || "default") === gid).length;

  // ── Create Group — toolbar action (FIX 3) ────────────────────────────────
  const handleCreateGroup = () => {
    setShowCreateGroup(true);
  };

  const handleCreateGroupSubmit = async (name) => {
    try {
      const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/groups`, {
        method: "POST",
        headers: {
          "Authorization": token ? `Bearer ${token}` : "",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        const newGroup = await res.json();
        setGroups((prev) => [...prev, newGroup]);
      }
    } catch (e) {
      console.error("Failed to create group", e);
    }
  };

  // ── Delete Group ─────────────────────────────────────────────────────────
  const handleDeleteGroup = async (groupId) => {
    if (!window.confirm("Delete this group? Cameras will move to Default.")) return;
    
    try {
      const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
      await fetch(`${import.meta.env.VITE_API_URL}/api/groups/${groupId}`, {
        method: "DELETE",
        headers: { "Authorization": token ? `Bearer ${token}` : "" }
      });
      fetchGroups();
    } catch (e) {
      console.error("Failed to delete group", e);
    }
    
    setDevices((prev) =>
      prev.map((d) => d.group_id === groupId ? { ...d, group_id: "default" } : d)
    );
    if (activeGroup === groupId) setActiveGroup("all");
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchLatestDevices();
    setTimeout(() => setRefreshing(false), 1200);
  };

  const handleRowContextMenu = useCallback((e, deviceId) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, deviceId });
  }, []);

  const handleEditDevice = useCallback((deviceId) => {
    const device = devices.find((d) => 
      (d.id && d.id === deviceId) || 
      (d.stream_key && d.stream_key === deviceId) || 
      (d.camera_id && d.camera_id === deviceId) ||
      (d.ip && d.ip === deviceId)
    );
    if (device) setEditDevice(device);
  }, [devices]);

  const handleSaveDevice = useCallback(async (updated) => {
    try {
      if (updated.device_name) {
        updated.name = updated.device_name;
      }
      const { name, ...payload } = updated;
      const targetIp = updated.ip || updated.ip_address || "unknown";
      await fetch(`${STREAM_API}/api/cameras/by-ip/${encodeURIComponent(targetIp)}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...payload,
          name: updated.name,
          device_name: updated.device_name,
        }),
      });
      fetchLatestDevices();
    } catch (e) {
      console.error("Failed to update DB:", e);
    }
    setDevices((prev) => prev.map((d) => (d.id === updated.id || (d.camera_id && d.camera_id === updated.camera_id)) ? updated : d));
  }, [setDevices, fetchLatestDevices]);

  const performRemoveDevice = useCallback(async (deviceId) => {
    const device = devices.find((d) => 
      (d.id && d.id === deviceId) || 
      (d.stream_key && d.stream_key === deviceId) || 
      (d.camera_id && d.camera_id === deviceId) ||
      (d.ip && d.ip === deviceId)
    );
    if (!device) return;
    try {
      const res = await fetch(`${STREAM_API}/api/cameras/delete-by-rtsp`, { 
        method: "DELETE",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          rtsp_url: device.rtsp_url || device.recording_rtsp || device.source_rtsp || "",
          stream_key: device.stream_key,
          camera_id: device.camera_id,
          edge_id: device.edge_id,
          ip: device.ip || device.ip_address,
          id: device.id || device._id,
        })
      });
      if (!res.ok) {
        let errMsg = "Failed to delete camera. Admin privileges required.";
        try {
          const errData = await res.json();
          errMsg = (typeof errData.detail === "string" ? errData.detail : (Array.isArray(errData.detail) ? errData.detail.map(d => d.msg || "Invalid input").join(", ") : errMsg));
        } catch(e) {}
        setUiError(errMsg);
        return; // Don't remove from UI
      }
    } catch (err) {
      console.error("❌ Failed to delete from DB:", err);
      setUiError("Network error while deleting camera.");
      return;
    }
    setDevices((prev) => prev.filter((d) => 
      d.id !== deviceId && 
      (!device.stream_key || d.stream_key !== device.stream_key) &&
      (!device.camera_id || d.camera_id !== device.camera_id)
    ));
    fetchLatestDevices();
    window.dispatchEvent(new Event("devicesUpdated"));
  }, [devices, setDevices, fetchLatestDevices]);

  const handleRemoveDevice = useCallback((deviceId) => {
    const device = devices.find((d) => 
      (d.id && d.id === deviceId) || 
      (d.stream_key && d.stream_key === deviceId) || 
      (d.camera_id && d.camera_id === deviceId) ||
      (d.ip && d.ip === deviceId)
    );
    if (device) setDeviceToRemove(device);
  }, [devices]);

  const performDeleteEdge = useCallback(async (edge) => {
    if (!edge) return;
    const edgeId = edge.edge_id || edge.ip;
    if (!edgeId) return;

    try {
      const res = await fetch(`${STREAM_API}/api/edge-config/${encodeURIComponent(edgeId)}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        let errMsg = "Failed to delete edge device.";
        try {
          const errData = await res.json();
          errMsg = errData.detail || errMsg;
        } catch(e) {}
        setUiError(errMsg);
        return;
      }

      // Optimistically remove all cameras belonging to this edge from UI state
      setDevices((prev) =>
        prev.filter((d) => {
          if (edge.edge_id && d.edge_id === edge.edge_id) return false;
          if (edge.ip && d.edge_ip === edge.ip) return false;
          if (edgeId && d.stream_key && d.stream_key.startsWith(`${edgeId}_camera_`)) return false;
          return true;
        })
      );

      fetchLatestDevices();
      window.dispatchEvent(new Event("devicesUpdated"));

      const successMsg = `Edge device "${edge.name || edgeId}" and all cameras deleted successfully`;
      window.dispatchEvent(
        new CustomEvent("showAppToast", {
          detail: {
            message: successMsg,
            subtitle: `${edge.cameras?.length || 0} camera(s) removed`,
            spinning: true,
            type: "success",
          },
        })
      );
      setToastNotification({
        message: successMsg,
        subtitle: `${edge.cameras?.length || 0} camera(s) removed`,
        type: "success",
        spinning: true,
      });
    } catch (err) {
      console.error("❌ Failed to delete edge device:", err);
      setUiError("Network error while deleting edge device.");
    }
  }, [setDevices, fetchLatestDevices]);

  const handleStreamProfiles = useCallback((deviceId) => {
    const device = devices.find((d) => 
      (d.id && d.id === deviceId) || 
      (d.stream_key && d.stream_key === deviceId) || 
      (d.camera_id && d.camera_id === deviceId) ||
      (d.ip && d.ip === deviceId)
    );
    if (device && device.ip) {
      localStorage.setItem("miradorai_selected_camera_ip", device.ip);
    }
    localStorage.setItem("miradorai_selected_camera_id", String(device?.id || device?.stream_key || deviceId));
    if (onNavigate) onNavigate("stream-profiles");
  }, [devices, onNavigate]);

  // ── handleDiscoveredDevices ───────────────────────────────────────────────
  // selectedGroupId is set via openDiscovery() before the modal opens,
  // so the closure captures the correct value.
  const handleDiscoveredDevices = useCallback((discoveredDevices) => {
    if (!discoveredDevices || discoveredDevices.length === 0) return;

    const failed = discoveredDevices.filter((d) => !d.ws_url);
    if (failed.length > 0) {
      console.warn(
        `[AddDevices] ${failed.length} device(s) failed OME registration:`,
        failed.map((d) => `${d.ip} ch${d.channel ?? 0} — ${d.stream_status}`)
      );
    }

    const targetGroup = selectedGroupId; // captured from modal context
    const addedDevicesList = [];

    setDevices((prev) => {
      let next = [...prev];

      for (const d of discoveredDevices) {
        const streamKey = d.stream_key || d.stream_name ||
          `${d.ip.replace(/\./g, "_")}_cam${d.channel ?? 0}`;

        const device = {
          id: d.id || `device-${d.ip}-cam${d.channel ?? 0}`,
          type: "entrance",
          name: d.cameraName || d.name ||
            `${d.manufacturer || ""} ${d.model || ""}`.trim() ||
            `Camera @ ${d.ip}`,
          ip: d.ip,
          channel: d.channel ?? 0,
          mac: d.mac || "—",
          status: d.ws_url ? "Online" : "Offline",
          manufacturer: d.manufacturer || "Unknown",
          model: d.model || "Unknown",
          firmware: d.firmware || "",
          rtsp_url: d.rtsp_url || null,
          ws_url: d.ws_url || null,
          stream_key: d.stream_key || streamKey,
          sub_stream_key: d.sub_stream_key || null,
          sub_stream_rtsp: d.sub_stream_rtsp || null,
          stream_status: d.ws_url ? "streaming" : (d.stream_status || "not_registered"),
          stream_profiles: d.profiles || d.stream_profiles || [],
          stream_count: d.stream_count || d.profiles?.length || 0,
          physical_camera_count: d.physical_camera_count || 1,
          label: d.label || d.profile_name || "",
          source: "discovery",
          group_id: d.group_id || targetGroup,        // ✅ per-device first, then fallback
        };

        const existingIndex = next.findIndex(
          (item) =>
            item.id === device.id ||
            (item.stream_key && item.stream_key === streamKey)
        );

        if (existingIndex !== -1) {
          next[existingIndex] = { ...next[existingIndex], ...device };
          addedDevicesList.push(next[existingIndex]);
        } else {
          next.push(device);
          addedDevicesList.push(device);
        }

        logAction("Camera added", "camera", { ip: d.ip, channel: d.channel ?? 0, source: "discovery" });
      }

      return next;
    });

    const allFailed = addedDevicesList.every(d => d.stream_status === "error" || d.stream_status === "not_registered" || (!d.ws_url && !d.stream_key));
    const someFailed = addedDevicesList.some(d => d.stream_status === "error" || d.stream_status === "not_registered" || (!d.ws_url && !d.stream_key));
    
    let title = "Discovery Cameras Added";
    let desc = `Successfully registered and added ${addedDevicesList.length} camera(s) to the system.`;
    let isError = false;

    if (allFailed) {
      title = "Stream Registration Failed";
      desc = "The discovered cameras were added, but failed to register streams with OME.";
      isError = true;
    } else if (someFailed) {
      title = "Partial Success";
      desc = "The discovered cameras were added, but some failed to register streams with OME.";
      isError = true;
    }

    setSuccessEnrollData({
      title,
      desc,
      isError,
      devices: addedDevicesList
    });
  }, [setDevices, selectedGroupId]);

  // ── handleEnroll — group_id comes from ManualSearchModal field ────────────
  const handleEnroll = async (device) => {
    setShowManualSearch(false);
    setEnrolling(true);

    const { ip, user, pass, discovered, cameraName, channels, channel, group_id, port } = device;
    const enrichedName = discovered?.model
      ? `${discovered.manufacturer} ${discovered.model}`
      : null;

    const channelsToEnroll = channels && channels.length > 0 ? channels : [{ source: channel ?? 0 }];
    const totalCount = channelsToEnroll.length;
    setEnrollTotal(totalCount);
    setEnrollProgress(10);
    setEnrollMsg(totalCount === 1 ? `Connecting and probing camera ${ip}…` : `Enrolling ${totalCount} camera channels…`);

    const addedDevices = [];
    let hasError = false;

    try {
      for (let i = 0; i < channelsToEnroll.length; i++) {
        const ch = channelsToEnroll[i];
        // Force channel to 0 for single physical cameras to ensure merging with Stream URL adds
        const safeChannel = channelsToEnroll.length === 1 ? 0 : (ch.source ?? 0);
        const startPct = Math.round((i / totalCount) * 85) + 10;
        const endPct = Math.round(((i + 1) / totalCount) * 85) + 10;

        setEnrollProgress(startPct);
        setEnrollMsg(`Registering channel ${i + 1} of ${totalCount} (${ip})…`);

        const probeRes = await fetch(`${STREAM_API}/api/onvif/probe`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ 
            ip, 
            port: Number(port) || 80, 
            username: user, 
            password: pass, 
            channel: safeChannel, 
            group_id: group_id || selectedGroupId,
            save_to_db: true
          }),
        });
        const probeData = probeRes.ok ? await probeRes.json() : null;

        const streamKey =
          probeData?.stream_key ||
          `${ip.replace(/\./g, "_")}_cam${safeChannel}`;

        const nameSuffix = channelsToEnroll.length > 1 ? ` (Cam ${safeChannel})` : "";
        const baseName = cameraName ? `${cameraName}${nameSuffix}` : (enrichedName ? `${enrichedName}${nameSuffix}` : `Camera @ ${ip} (Cam ${safeChannel})`);

        const updated = {
          id: `device-${ip}-cam${safeChannel}-${Date.now()}`,
          type: "entrance",
          name: baseName,
          ip,
          channel: safeChannel,
          mac: discovered?.mac || probeData?.mac || "—",
          status: probeData?.ws_url ? "Online" : "Offline",
          manufacturer: discovered?.manufacturer || probeData?.manufacturer || "Unknown",
          model: discovered?.model || probeData?.model || "Unknown",
          firmware: probeData?.firmware || discovered?.firmware || "",
          serial: probeData?.serial || discovered?.serial || "",
          ptz: probeData?.ptz || discovered?.ptz || "No",
          rtsp_url: probeData?.rtsp_url || probeData?.stream_uri || null,
          ws_url: probeData?.ws_url || null,
          stream_key: probeData?.stream_key || streamKey,
          sub_stream_key: probeData?.sub_stream_key || null,
          sub_stream_rtsp: probeData?.sub_stream_rtsp || null,
          stream_status: probeData?.status || "error",
          stream_profiles: probeData?.profiles || discovered?.profiles || [],
          stream_count: probeData?.stream_count || discovered?.stream_count || 0,
          physical_camera_count: probeData?.physical_camera_count || 1,
          source: "onvif",
          group_id: group_id || selectedGroupId,
        };

        addedDevices.push(updated);
        
        if (!probeData?.ws_url || probeData?.status === "error") {
          hasError = true;
        }

        setDevices((prev) => {
          const existingIndex = prev.findIndex(
            (item) =>
              (item.stream_key && streamKey && item.stream_key === streamKey) ||
              (item.ip === ip && item.channel === safeChannel)
          );

          if (existingIndex !== -1) {
            updated.id = prev[existingIndex].id;
            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], ...updated };
            return next;
          }
          return [...prev, updated];
        });

        logAction("Camera added", "camera", { ip, channel: safeChannel });
        setEnrollProgress(endPct);
      }

      setEnrollProgress(100);
      setEnrollMsg("Camera enrolled successfully!");
      await new Promise(r => setTimeout(r, 350));

      setSuccessEnrollData({
        title: hasError ? "Partial Success / Failed" : (addedDevices.length > 1 ? `Successfully added ${addedDevices.length} Cameras` : "Camera Added Successfully"),
        desc: hasError 
          ? "Some or all cameras were probed, but failed to register streams with OME."
          : "The selected cameras have been successfully registered and added to the system.",
        isError: hasError,
        devices: addedDevices
      });
    } finally {
      setEnrolling(false);
      setEnrollMsg("");
      setEnrollProgress(0);
    }
  };

  // ── handleAddStreamURLs — group_id comes from StreamURLModal field ─────────
  const handleAddStreamURLs = async (payload) => {
    setShowStreamURL(false);
    setEnrolling(true);

    const items = Array.isArray(payload)
      ? payload.map(u => (typeof u === "string" ? { name: "", url: u } : u))
      : (payload.items
          ? payload.items
          : (payload.urls || []).map(u => ({ name: payload.cameraName || "", url: u }))
        );
    const cameraName = Array.isArray(payload) ? "" : (payload.cameraName || "");
    const groupId = Array.isArray(payload)
      ? selectedGroupId
      : (payload.group_id || selectedGroupId);           // ✅ from modal field

    const totalCount = items.length;
    setEnrollTotal(totalCount);
    setEnrollProgress(10);
    setEnrollMsg(totalCount === 1 ? "Registering stream URL…" : `Registering ${totalCount} stream URLs…`);

    const addedEntries = [];

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const url = typeof item === "string" ? item : item.url;
        const customName = typeof item === "object" ? (item.name || "") : "";

        const startPct = Math.round((i / totalCount) * 85) + 10;
        const endPct = Math.round(((i + 1) / totalCount) * 85) + 10;

        setEnrollProgress(startPct);
        setEnrollMsg(`Registering stream ${i + 1} of ${totalCount}…`);

        let ip = "—";
        try { ip = new URL(url).hostname; } catch { }

        const streamName = customName.trim()
          ? customName.trim()
          : (cameraName
              ? (items.length > 1 ? `${cameraName} (${i + 1})` : cameraName)
              : `Stream @ ${ip}`);

        try {
          const res = await fetch(`${STREAM_API}/api/streams/register`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ rtsp_url: url, group_id: groupId, device_name: streamName }),
          });
          const data = res.ok ? await res.json() : null;

          const streamKey = data?.stream_key || data?.stream_key ||
            `${ip.replace(/\./g, "_")}_rtsp${i}`;

          const entry = {
            id: `device-rtsp-${streamKey}-${Date.now()}`,
            type: "entrance",
            name: streamName,
            ip,
            channel: 0,
            mac: "—",
            status: data?.ws_url ? "Online" : "Offline",
            manufacturer: "Unknown",
            model: "Unknown",
            rtsp_url: url,
            ws_url: data?.ws_url || null,
            stream_key: streamKey,
            stream_status: data?.ws_url ? "streaming" : "error",
            stream_profiles: [],
            stream_count: 0,
            physical_camera_count: 1,
            source: "rtsp",
            group_id: groupId,                      // ✅ from modal field
          };

          setDevices((prev) => {
            const existingIndex = prev.findIndex(
              (item) =>
              (item.stream_key && streamKey && item.stream_key === streamKey) ||              item.rtsp_url === url
            );
            if (existingIndex !== -1) {
              entry.id = prev[existingIndex].id;
              const next = [...prev];
              next[existingIndex] = { ...next[existingIndex], ...entry };
              return next;
            }
            return [...prev, entry];
          });

          addedEntries.push(entry);
          logAction("Camera added", "camera", { ip, source: "stream_url" });

        } catch {
          const streamKey = `${ip.replace(/\./g, "_")}_rtsp${i}`;
          const entry = {
            id: `device-rtsp-${Date.now()}-${i}`,
            type: "entrance", name: streamName, ip, channel: 0,
            mac: "—", status: "Offline", manufacturer: "Unknown", model: "Unknown",
            rtsp_url: url, ws_url: null, stream_key: streamKey,
            stream_status: "error", stream_profiles: [], stream_count: 0,
            physical_camera_count: 1, source: "rtsp",
            group_id: groupId,                      // ✅ from modal field
          };
          setDevices((prev) => {
             const existingIndex = prev.findIndex((item) => 
              item.rtsp_url === url
            );
            if (existingIndex !== -1) {
              entry.id = prev[existingIndex].id;
              const next = [...prev];
              next[existingIndex] = { ...next[existingIndex], ...entry };
              return next;
            }
            return [...prev, entry];
          });
          addedEntries.push(entry);
        }

        setEnrollProgress(endPct);
      }

      setEnrollProgress(100);
      setEnrollMsg("Streams enrolled successfully!");
      await new Promise(r => setTimeout(r, 350));
    } finally {
      setEnrolling(false);
      setEnrollMsg("");
      setEnrollProgress(0);
    }

    if (addedEntries.length > 0) {
      const allFailed = addedEntries.every(d => d.stream_status === "error" || (!d.ws_url && !d.stream_key));
      const someFailed = addedEntries.some(d => d.stream_status === "error" || (!d.ws_url && !d.stream_key));
      
      let title = addedEntries.length === 1 ? "Camera Added Successfully" : "Cameras Added Successfully";
      let desc = addedEntries.length === 1 
        ? "The camera has been successfully registered and added to the system."
        : `Successfully registered and added ${addedEntries.length} camera(s) to the system.`;
      let isError = false;

      if (allFailed) {
        title = "Stream Registration Failed";
        desc = "The camera streams failed to register with OME.";
        isError = true;
      } else if (someFailed) {
        title = "Partial Success";
        desc = "Some camera streams failed to register with OME.";
        isError = true;
      }

      setSuccessEnrollData({
        title,
        desc,
        isError,
        devices: addedEntries
      });
    }
  };
const handleEdgeChannelsContinue = (selectedChannels) => {
  console.log(
    "[EDGE] Selected cameras:",
    selectedChannels
  );

  setSelectedEdgeChannels(selectedChannels);
  setShowEdgeChannels(false);
  setShowEdgeCredentials(true);
};
const handleEdgeCredentialsSubmit = async (cameras) => {
  console.log("[EDGE] Camera credentials submitted:", cameras);

  if (!connectedEdge?.ip) {
    setUiError("Edge device is not connected.");
    return;
  }

  try {
    setEnrolling(true);
    const totalCount = cameras.length;
    setEnrollTotal(totalCount);
    setEnrollProgress(10);
    setEnrollMsg(totalCount === 1 ? "Connecting to Edge device…" : `Preparing ${totalCount} cameras for enrollment…`);

    const addedDevices = [];

    const edgeName = connectedEdge.display_name || connectedEdge.name || "Mirador Edge";

    for (let idx = 0; idx < cameras.length; idx++) {
      const camera = cameras[idx];
      const startPct = Math.round((idx / totalCount) * 85) + 10;
      const midPct = Math.round(((idx + 0.5) / totalCount) * 85) + 10;
      const endPct = Math.round(((idx + 1) / totalCount) * 85) + 10;
      const camLabel = camera.custom_name || camera.ip;

      console.log("[EDGE] Registering camera:", camera.ip);
      setEnrollProgress(startPct);
      setEnrollMsg(`Registering camera ${idx + 1} of ${totalCount} (${camLabel}) on Edge…`);

      // ============================================================
      // STEP 1 — Register camera on Raspberry Pi Edge
      // ============================================================
      const edgeResponse = await fetch(
        `http://${connectedEdge.ip}:8000/api/edge/cameras/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            xaddr: camera.xaddr,
            username: camera.username,
            password: camera.password,
          }),
        }
      );

      const edgeData = await edgeResponse.json();

      console.log(
        "[EDGE] Registration response:",
        edgeData
      );

      if (!edgeResponse.ok || !edgeData.success) {
        throw new Error(
          edgeData.detail ||
          `Edge registration failed for ${camera.ip}`
        );
      }

      setEnrollProgress(midPct);
      setEnrollMsg(`Registering stream for ${camLabel} in VMS…`);

      // ============================================================
      // STEP 2 — Register Edge RTSP stream in VMS
      // ============================================================
      const edgeStreamUrl = edgeData.stream_url;

      const cameraName =
        camera.custom_name ||
        `${edgeData.manufacturer || "Camera"} ${edgeData.model || camera.ip}`;

      if (!edgeStreamUrl) {
        throw new Error(
          `Edge did not return a stream URL for ${camera.ip}`
        );
      }

      console.log(
        "[VMS] Registering Edge stream:",
        edgeStreamUrl
      );

      const vmsResponse = await fetch(
        `${STREAM_API}/api/streams/register`,
        {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            rtsp_url: edgeStreamUrl,
            ip: camera.ip,
            group_id: selectedGroupId,
            device_name: cameraName,
            source: "edge",
            edge_ip: connectedEdge.ip,
            edge_name: edgeName,
            manufacturer: edgeData.manufacturer || "Unknown",
            model: edgeData.model || "Unknown",
            mac: edgeData.mac || "",
          }),
        }
      );

      const vmsData = await vmsResponse.json();

      console.log(
        "[VMS] Stream registration response:",
        vmsData
      );

      if (!vmsResponse.ok || !vmsData.success) {
        throw new Error(
          vmsData.detail ||
          vmsData.message ||
          `VMS stream registration failed for ${camera.ip}`
        );
      }

      // ============================================================
      // STEP 3 — Build the VMS device object
      // ============================================================
      const streamKey =
        vmsData.stream_key || null;

      const wsUrl =
        vmsData.ws_url || null;

      const device = {
        id:
          `edge-${edgeData.camera_id || camera.ip}`,

        type: "entrance",

        name: cameraName,

        ip: camera.ip,

        channel: 0,

        mac: edgeData.mac || "—",

        status:
          vmsData.status === "streaming"
            ? "Online"
            : "Offline",

        manufacturer:
          edgeData.manufacturer || "Unknown",

        model:
          edgeData.model || "Unknown",

        firmware:
          edgeData.firmware || "",

        serial:
          edgeData.serial || "",

        rtsp_url:
          edgeStreamUrl,

        ws_url:
          wsUrl,

        stream_key:
          streamKey,

        stream_status:
          vmsData.status || "streaming",

        stream_profiles:
          edgeData.profiles || [],

        stream_count:
          edgeData.profiles?.length || 1,

        physical_camera_count: 1,

        source: "edge",

        edge_ip:
          connectedEdge.ip,

        edge_name: edgeName,

        edge_camera_id:
          edgeData.camera_id,

        group_id:
          selectedGroupId,
      };

      console.log(
        "[VMS] Final Edge device:",
        device
      );

      addedDevices.push(device);

      // Update UI
      setDevices((prev) => {
        const updatedPrev = prev.map((item) => {
          if (item.edge_ip === connectedEdge.ip) {
            return { ...item, edge_name: edgeName };
          }
          return item;
        });

        const existingIndex = updatedPrev.findIndex(
          (item) =>
            item.edge_ip === connectedEdge.ip &&
            item.ip === camera.ip
        );

        if (existingIndex !== -1) {
          const next = [...updatedPrev];

          next[existingIndex] = {
            ...next[existingIndex],
            ...device,
          };

          return next;
        }

        return [...updatedPrev, device];
      });

      setEnrollProgress(endPct);
    }

    setEnrollProgress(100);
    setEnrollMsg(totalCount === 1 ? "Camera enrolled successfully!" : `All ${totalCount} cameras enrolled successfully!`);
    await new Promise(r => setTimeout(r, 350));

    console.log(
      "[EDGE] Successfully added:",
      addedDevices
    );

    setShowEdgeCredentials(false);

    setSuccessEnrollData({
      title:
        addedDevices.length === 1
          ? "Edge Camera Added Successfully"
          : "Edge Cameras Added Successfully",

      desc:
        addedDevices.length === 1
          ? "The camera has been registered on Mirador Edge and added to the VMS."
          : `${addedDevices.length} cameras have been registered on Mirador Edge and added to the VMS.`,

      isError: false,

      devices: addedDevices,
    });

  } catch (error) {
    console.error(
      "[EDGE] Camera registration failed:",
      error
    );

    setUiError(
      error.message ||
      "Failed to register Edge camera."
    );

  } finally {
    setEnrolling(false);
    setEnrollMsg("");
    setEnrollProgress(0);
  }
};
  const handleEdgeConnected = async (edge) => {
    console.log("[EDGE] Connected:", edge);

    setConnectedEdge(edge);
    setShowEdgeDevice(false);
    setShowEdgeChannels(false);
    setShowEdgeCredentials(false);

    setEdgeDetails(null);
    setEdgeDetailsError("");
    setEdgeDetailsLoading(true);
    setShowEdgeDetails(true);

    try {
      const baseUrl = `http://${edge.ip}:8000`;

      const [infoResponse, channelsResponse] = await Promise.all([
        fetch(`${baseUrl}/api/edge/info`),
        fetch(`${baseUrl}/api/edge/channels`),
      ]);

      if (!infoResponse.ok) {
        throw new Error(`Edge details request failed: HTTP ${infoResponse.status}`);
      }

      if (!channelsResponse.ok) {
        throw new Error(`Edge channels request failed: HTTP ${channelsResponse.status}`);
      }

      const infoData = await infoResponse.json();
      const channelsData = await channelsResponse.json();

      if (!infoData.success || !channelsData.success) {
        throw new Error("The Edge device returned an unsuccessful response.");
      }

      const registeredChannels = Array.isArray(channelsData.channels)
        ? channelsData.channels
        : [];

      const streamingCount = registeredChannels.filter(
        (channel) =>
          channel.streaming === true ||
          channel.status === "streaming"
      ).length;

      setEdgeDetails({
        ...infoData,
        ip: edge.ip,
        registeredCount:
          typeof channelsData.count === "number"
            ? channelsData.count
            : registeredChannels.length,
        streamingCount,
        channels: registeredChannels,
      });

    } catch (error) {
      console.error("[EDGE] Details request failed:", error);

      setEdgeDetailsError(
        error.message ||
        "Unable to retrieve details from this Edge device."
      );
    } finally {
      setEdgeDetailsLoading(false);
    }
  };
  const handleEdgeDetailsContinue = async () => {
    if (!connectedEdge?.ip) return;

    setEdgeDetailsError("");
    setEdgeChannels([]);
    setEdgeChannelsError("");
    setEdgeChannelsLoading(true);
    setShowEdgeDetails(false);
    setShowEdgeChannels(true);

    try {
      const response = await fetch(
        `http://${connectedEdge.ip}:8000/api/edge/discover`
      );

      if (!response.ok) {
        throw new Error(`Camera discovery failed: HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error("The Edge device could not discover cameras.");
      }

      setEdgeChannels(Array.isArray(data.cameras) ? data.cameras : []);
    } catch (error) {
      console.error("[EDGE] Discovery failed:", error);
      setEdgeChannelsError(
        error.message || "Unable to discover cameras from this Edge device."
      );
    } finally {
      setEdgeChannelsLoading(false);
    }
  };
  const handleRenameEdge = async (edgeIp, newName) => {
    if (!edgeIp || !newName) return;
    const trimmed = newName.trim();
    if (!trimmed) return;

    setDevices((prev) =>
      prev.map((d) => (d.edge_ip === edgeIp ? { ...d, edge_name: trimmed } : d))
    );

    try {
      await fetch(`${STREAM_API}/api/edge-devices/rename`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ edge_ip: edgeIp, edge_name: trimmed }),
      });
    } catch (err) {
      console.error("Failed to rename edge device on backend:", err);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="page-shell add-dev__layout">

      {/* ── LEFT SIDEBAR — group list only, no create button (FIX 4) ────── */}


      {/* ── MAIN CONTENT ──────────────────────────────────────────────────── */}
      <div className="add-dev__main">
                {uiError && (
          <div style={{ background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", padding: "12px 16px", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.3)", marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{uiError}</span>
            </div>
            <button onClick={() => setUiError("")} style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "16px", padding: "0 8px" }}>✕</button>
          </div>
        )}
        <div className="page-header">
          <div className="page-header__left">
            <h1 className="page-title">Add <span>Devices</span></h1>
          </div>

          <div className="add-dev__toolbar">
            <button className="m-btn m-btn--elevated" onClick={openManualSearch}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              Manual Search
            </button>
            <button className="m-btn m-btn--elevated" onClick={openDiscovery}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="9"/><path d="M12 2v20"/><path d="M2 12h20"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>
              Scan Network
            </button>
            <button className="m-btn m-btn--elevated" onClick={openStreamURL}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
              Stream URL
            </button>
            <button
              className="m-btn m-btn--elevated"
              // onClick={() => setShowEdgeDevice(true)}
              onClick={() => setShowEdgeConfigModal(true)}

            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                width="14"
                height="14"
              >
                <rect x="3" y="4" width="18" height="14" rx="2" />
                <path d="M8 21h8" />
                <path d="M12 18v3" />
                <path d="M7 8h10" />
                <path d="M7 12h6" />
              </svg>

              Add Edge Device
            </button>
            <SpecularButton
              size="sm"
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
              className="m-btn m-btn--primary"
              onClick={handleCreateGroup}
            >

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
                Create Group
              </div>
            </SpecularButton>
          </div>
        </div>

        <div className="add-dev__options-bar">
          <SearchBar value={filter} onChange={setFilter} placeholder="Filter devices..." />

          <div className="adp-custom-select" ref={filterDropdownRef}>
            <button
              type="button"
              className="adp-select-btn"
              onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
            >
              <span>
                {activeGroup === "all" ? "All Cameras" : activeGroup === "default" ? "Default" : groups.find(g => g.id === activeGroup)?.name || "All Cameras"}
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: filterDropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", marginLeft: "8px", color: "var(--text-muted)" }}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {filterDropdownOpen && (
              <ul className="adp-dropdown-menu">
                <li
                  className={`adp-dropdown-item ${activeGroup === "all" ? "active" : ""}`}
                  onClick={() => { setActiveGroup("all"); setFilterDropdownOpen(false); }}
                >
                  All Cameras
                </li>
                <li
                  className={`adp-dropdown-item ${activeGroup === "default" ? "active" : ""}`}
                  onClick={() => { setActiveGroup("default"); setFilterDropdownOpen(false); }}
                >
                  Default
                </li>
                {groups.map(g => (
                  <li
                    key={g.id}
                    className={`adp-dropdown-item ${activeGroup === g.id ? "active" : ""}`}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
                    onClick={() => { setActiveGroup(g.id); setFilterDropdownOpen(false); }}
                  >
                    <span>{g.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteGroup(g.id);
                        setFilterDropdownOpen(false);
                      }}
                      title="Delete group"
                      className="adp-dropdown-delete-btn"
                    >✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {hasEdge && filtered.length > 0 && (
          <SectionHead
            icon={<span className="edge-section__icon" style={{ color: "var(--teal)" }}><CctvIcon size={18} /></span>}
            title="Cameras"
            count={filtered.length}
            sub="Added by manual search, network scan, or stream URL"
          />
        )}

        {(filtered.length > 0 || !hasEdge) && (
        <div className={`add-dev__table-wrap card ${hasEdge ? "add-dev__table-wrap--has-edge" : ""}`}>
          {filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <table className="m-table">
              <thead>
                <tr>
                  <th style={{ width: 60, color: "rgba(255, 255, 255, 0.5)" }}></th>
                  {["Device Name", "IP Address", "MAC Address", "Status", "Manufacturer", "Model"/* , "Shard" */].map((c) => (
                    <th key={c} style={{ color: "rgba(255, 255, 255, 0.5)" }}>{c}</th>
                  ))}
                  <th style={{ color: "rgba(255, 255, 255, 0.5)" }}>Group</th>
                  <th style={{ color: "rgba(255, 255, 255, 0.5)" }}>Stream</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const groupLabel =
                    d.group_id === "default" || !d.group_id
                      ? "Default"
                      : groups.find((g) => g.id === d.group_id)?.name || "Default";

                  const camKey = d.id || d.stream_key || d.camera_id || d.ip;

                  return (
                    <tr
                      key={camKey}
                      className="m-table__row"
                      onContextMenu={(e) => handleRowContextMenu(e, camKey)}
                    >
                      <td
                        onClick={() => setPreviewDevice(d)}
                        style={{ cursor: "pointer" }}
                        title="Click to play live preview"
                      >
                        <div className="thumb-container">
                          {d.thumbnail ? (
                            <img
                              src={d.thumbnail}
                              alt={d.name}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                display: "block",
                                borderRadius: "inherit"
                              }}
                            />
                          ) : (
                            <div className="thumb-fallback"><CctvIcon size={22} /></div>
                          )}
                          <div className="thumb-play-overlay">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        </div>
                      </td>
                      <td className="m-table__primary">
                        <div className="add-dev__name-cell">
                          {d.name}
                          {d.physical_camera_count > 1 && (
                            <span className="m-badge m-badge--purple">
                              CAM {(d.channel ?? 0) + 1}
                            </span>
                          )}
                        </div>
                      </td>
                      <td><code className="add-dev__ip">{d.ip}</code></td>
                      <td><code className="add-dev__ip">{d.mac}</code></td>
                      <td><StatusBadge status={d.status} /></td>
                      <td>{d.manufacturer}</td>
                      <td>{d.model}</td>
                      {/* <td>
                        <span className="add-dev__shard-tag" style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "3px 8px",
                          borderRadius: "4px",
                          fontSize: "11px",
                          fontWeight: "500",
                          background: "rgba(74, 106, 153, 0.15)",
                          color: "#4a6a99",
                          border: "1px solid rgba(74, 106, 153, 0.25)"
                        }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                          </svg>
                          {d.shard_prefix || "shard1"}
                        </span>
                      </td> */}
                      <td>
                        <span className="add-dev__group-tag">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                          </svg>
                          {groupLabel}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {(() => {
                            const ss = typeof d.stream_status === "object"
                              ? (d.stream_status?.connected ? "streaming" : "error")
                              : d.stream_status;
                            return (ss === "streaming" || d.status === "Online")
                              ? <span className="add-dev__stream add-dev__stream--live">● LIVE</span>
                              : (d.ws_url || d.stream_key)
                                ? <span className="add-dev__stream add-dev__stream--pending">
                                  ● {ss || d.status || "pending"}
                                </span>
                                : <span className="add-dev__stream add-dev__stream--none">— not registered</span>;
                          })()}
                          {(d.stream_count > 0 || d.stream_profiles?.length > 0) && (
                            <span style={{ fontSize: 10, color: "#4a6a99" }}>
                              {d.stream_count || d.stream_profiles?.length} profile{
                                (d.stream_count || d.stream_profiles?.length) !== 1 ? "s" : ""
                              }
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        )}

        <EdgeDevicesSection
          devices={edgeFiltered}
          groups={groups}
          onPreview={setPreviewDevice}
          onContextMenu={handleRowContextMenu}
          onRenameEdge={handleRenameEdge}
          onDeleteEdge={setEdgeToRemove}
        />


      </div>

    

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {showEdgeConfigModal && (
        <EdgeManualConfigModal
          apiBase={STREAM_API}
          authHeaders={getAuthHeaders}
          existingDevices={devices}
          onClose={() => setShowEdgeConfigModal(false)}
          onSaved={(savedData) => {
            fetchLatestDevices();
            setToastNotification({
              message: "Edge cameras saved successfully",
              subtitle: savedData?.camera_count
                ? `${savedData.camera_count} camera(s) synchronized`
                : undefined,
              spinning: true,
              type: "success",
            });
          }}
        />
      )}

      {showEdgeDetails && (
        <EdgeDeviceDetailsModal
          edge={connectedEdge}
          details={edgeDetails}
          loading={edgeDetailsLoading}
          error={edgeDetailsError}
          onClose={() => setShowEdgeDetails(false)}
          onContinue={handleEdgeDetailsContinue}
        />
      )}

      {showEdgeDevice && (
        <AddEdgeDeviceModal
          onClose={() => setShowEdgeDevice(false)}
          onConnected={handleEdgeConnected}
        />
      )}

      {showEdgeChannels && (
        <EdgeChannelsModal
          edge={connectedEdge}
          channels={edgeChannels}
          loading={edgeChannelsLoading}
          error={edgeChannelsError}
          onClose={() => setShowEdgeChannels(false)}
          onContinue={handleEdgeChannelsContinue}
        />
      )}
      {showEdgeCredentials && (
        <EdgeCredentialsModal
          edge={connectedEdge}
          channels={selectedEdgeChannels}
          onClose={() => {
            setShowEdgeCredentials(false);
            setShowEdgeChannels(true);
          }}
          onAdd={handleEdgeCredentialsSubmit}
        />
      )}
      {/* FIX 1 ✅ — group selector lives INSIDE ManualSearchModal */}
      {showManualSearch && (
        <ManualSearchModal
          onClose={() => setShowManualSearch(false)}
          onEnroll={handleEnroll}
          groups={groups}
          selectedGroupId={selectedGroupId}
          setSelectedGroupId={setSelectedGroupId}
        />
      )}

      {/* DiscoveryModal — group props passed, selectedGroupId captured via closure */}
      {showDiscovery && (
        <DiscoveryModal
          isOpen={showDiscovery}
          onClose={() => setShowDiscovery(false)}
          onAddDevices={handleDiscoveredDevices}
          groups={groups}
          selectedGroupId={selectedGroupId}
          setSelectedGroupId={setSelectedGroupId}
        />
      )}

      {/* FIX 1 ✅ — group selector lives INSIDE StreamURLModal */}
      {showStreamURL && (
        <StreamURLModal
          onClose={() => setShowStreamURL(false)}
          onAdd={handleAddStreamURLs}
          groups={groups}
          selectedGroupId={selectedGroupId}
          setSelectedGroupId={setSelectedGroupId}
        />
      )}

      {editDevice && (
        <EditDeviceModal
          device={editDevice}
          groups={groups}
          onClose={() => setEditDevice(null)}
          onSave={handleSaveDevice}
        />
      )}
      {deviceToRemove && (
        <RemoveDeviceModal
          device={deviceToRemove}
          onClose={() => setDeviceToRemove(null)}
          onConfirm={performRemoveDevice}
        />
      )}
      {edgeToRemove && (
        <RemoveEdgeModal
          edge={edgeToRemove}
          onClose={() => setEdgeToRemove(null)}
          onConfirm={performDeleteEdge}
        />
      )}
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onCreate={handleCreateGroupSubmit}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onEdit={() => handleEditDevice(ctxMenu.deviceId)}
          onRemove={() => handleRemoveDevice(ctxMenu.deviceId)}
          onStreamProfiles={() => handleStreamProfiles(ctxMenu.deviceId)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Enrolling loading indicator overlay */}
      {enrolling && (
        <div className="enrolling-overlay">
          <div className="enrolling-card">
            <div className="enrolling-progress-wrap">
              <svg className="enrolling-progress-svg" viewBox="0 0 88 88" width="80" height="80">
                <circle
                  className="enrolling-progress-bg"
                  cx="44"
                  cy="44"
                  r="36"
                  strokeWidth="5"
                  fill="none"
                />
                <circle
                  className="enrolling-progress-bar"
                  cx="44"
                  cy="44"
                  r="36"
                  strokeWidth="5"
                  fill="none"
                  strokeDasharray={2 * Math.PI * 36}
                  strokeDashoffset={2 * Math.PI * 36 * (1 - Math.min(100, Math.max(0, enrollProgress || 0)) / 100)}
                  strokeLinecap="round"
                />
              </svg>
              <div className="enrolling-progress-text">
                <span className="enrolling-progress-number">{Math.round(enrollProgress || 0)}</span>
                <span className="enrolling-progress-pct">%</span>
              </div>
            </div>

            <h3 className="enrolling-title">Enrolling Device{enrollTotal > 1 ? "s" : ""}</h3>
            <p className="enrolling-msg">{enrollMsg || "Please wait while we register the camera stream..."}</p>

            <div className="enrolling-bar-track">
              <div
                className="enrolling-bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, enrollProgress || 0))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Success Modal Popup */}
      {successEnrollData && (
        <div className="modal-overlay success-modal-overlay" onClick={() => setSuccessEnrollData(null)}>
          <div className="modal-box success-modal-box" onClick={(e) => e.stopPropagation()} style={successEnrollData.isError ? { borderColor: 'rgba(239, 68, 68, 0.2)' } : {}}>
            <div className="success-modal-header" style={successEnrollData.isError ? { background: 'linear-gradient(180deg, rgba(239, 68, 68, 0.05) 0%, transparent 100%)' } : {}}>
              <div className="success-icon-container" style={successEnrollData.isError ? { background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)', boxShadow: '0 0 20px rgba(239, 68, 68, 0.15)' } : {}}>
                {successEnrollData.isError ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="success-checkmark" style={{ color: '#ef4444' }}>
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="success-checkmark">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <h2 className="success-modal-title" style={successEnrollData.isError ? { color: '#ef4444' } : {}}>{successEnrollData.title}</h2>
              <p className="success-modal-desc">
                {successEnrollData.desc || (successEnrollData.devices.length === 1 
                  ? "The camera has been successfully registered and added to the system."
                  : `Successfully registered and added ${successEnrollData.devices.length} camera(s) to the system.`)
                }
              </p>
            </div>
            <div className="success-modal-body">
              <div className="success-devices-list">
                {successEnrollData.devices.map((d, index) => (
                  <div className="success-device-card" key={index}>
                    <div className="success-device-header">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="success-device-icon" style={{color: (d.stream_status === "error" || d.stream_status === "not_registered" || (!d.ws_url && !d.stream_key)) ? "#ef4444" : "var(--brand)"}}>
                        <rect x="3" y="3" width="18" height="12" rx="2" />
                        <path d="M21 10l4 3v-6l-4 3" />
                      </svg>
                      <span className="success-device-name">{d.name}</span>
                    </div>
                    <div className="success-device-details">
                      <div className="success-detail-row">
                        <span className="success-detail-label">IP Address</span>
                        <span className="success-detail-val">{d.ip}</span>
                      </div>
                      <div className="success-detail-row">
                        <span className="success-detail-label">Manufacturer</span>
                        <span className="success-detail-val">{d.manufacturer}</span>
                      </div>
                      <div className="success-detail-row">
                        <span className="success-detail-label">Model</span>
                        <span className="success-detail-val">{d.model}</span>
                      </div>
                      <div className="success-detail-row">
                        <span className="success-detail-label">Group</span>
                        <span className="success-detail-val">
                          {d.group_id === "default" || !d.group_id 
                            ? "Default" 
                            : groups.find(g => g.id === d.group_id)?.name || "Default"
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="success-modal-footer">
              <button 
                className="modal-btn modal-btn--save success-modal-ok-btn" 
                onClick={() => setSuccessEnrollData(null)}
                style={successEnrollData.isError ? { background: '#ef4444', boxShadow: '0 4px 12px rgba(239, 68, 68, 0.25)' } : {}}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Preview Modal */}
      {previewDevice && (
        <div className="modal-overlay" onClick={() => setPreviewDevice(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "720px", width: "100%", padding: 0 }}>
            <div className="modal-header" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-light)" }}>
              <h2 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--brand)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" style={{ flexShrink: 0 }}>
                  <path d="M23 7l-7 5 7 5V7z" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                {previewDevice.name || "Live Camera Stream"}
              </h2>
              <button className="modal-close" onClick={() => setPreviewDevice(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="modal-body" style={{ padding: "20px" }}>
              {(previewDevice.ws_url || previewDevice.stream_key) ? (
                <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border-light)" }}>
                  <WebRTCPlayer_MediaMTX streamKey={previewDevice.stream_key || (previewDevice.ip ? previewDevice.ip.replace(/\./g, "_") : "")} cameraId={previewDevice.id} />
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", minHeight: "260px", color: "var(--text-secondary)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48" style={{ color: "var(--red, #ef4444)" }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <p style={{ margin: 0, fontSize: "15px", fontWeight: "600" }}>Live stream not configured</p>
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)", textAlign: "center" }}>
                    This camera does not have an active WebRTC stream registered yet.
                  </p>
                </div>
              )}
              <div style={{ marginTop: "14px", display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--text-muted)" }}>
                <span>IP Address: <strong>{previewDevice.ip}</strong></span>
                <span>Status: <strong style={{ color: previewDevice.stream_status === "streaming" || previewDevice.status === "Online" ? "var(--brand)" : "var(--text-muted)" }}>
                  {typeof previewDevice.stream_status === "object" ? (previewDevice.stream_status?.connected ? "streaming" : "error") : (previewDevice.stream_status || "offline")}
                </strong></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {toastNotification && (
        <Toast
          message={toastNotification.message}
          subtitle={toastNotification.subtitle}
          spinning={toastNotification.spinning}
          type={toastNotification.type || "success"}
          onClose={() => setToastNotification(null)}
        />
      )}
    </div>
  );
}