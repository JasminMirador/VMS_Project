import { useState, useEffect, useRef, useCallback } from "react";
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

  const updateDevices = (updater) => {
    setDevices((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // We are fully relying on the DB now, so no localStorage caching here.
      window.dispatchEvent(new Event("devicesUpdated"));
      return next;
    });
  };

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
          <path d="M50 11v4M50 17h.01" stroke="var(--teal)" strokeLinecap="round" />
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
  
  const initialRtsp = device.rtsp_url || "";
  let initialUsername = "";
  let initialPassword = "";
  let initialCleanUrl = initialRtsp;

  if (initialRtsp) {
    const match = initialRtsp.match(/^(rtsps?:\/\/)(?:([^:]+)(?::([^@]+))?@)?(.*)$/i);
    if (match) {
      initialUsername = match[2] ? decodeURIComponent(match[2]) : "";
      initialPassword = match[3] ? decodeURIComponent(match[3]) : "";
      initialCleanUrl = match[1] + match[4];
    }
  }

  const [form, setForm] = useState({
    device_name: device.device_name || device.name || "",
    ip: device.ip || "",
    mac: device.mac || "",
    manufacturer: device.manufacturer || "",
    model: device.model || "",
    username: initialUsername,
    password: initialPassword,
    clean_rtsp_url: initialCleanUrl,
    group_id: device.group_id || "default",
  });

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
          <h2 className="modal-title">Edit Device</h2>
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
              const { clean_rtsp_url, username, password, ...restForm } = form;
              onSave({ ...device, ...restForm, rtsp_url: final_rtsp_url });
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
    await onConfirm(device.id);
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AddDevicesPage({ onNavigate }) {
  const { theme } = useTheme();
  const { logActivity } = useActivityLogger();
  const [filter, setFilter] = useState("");
  const [activeGroup, setActiveGroup] = useState("all");
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [showStreamURL, setShowStreamURL] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
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
  const [enrolling, setEnrolling] = useState(false);
  const [enrollMsg, setEnrollMsg] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [successEnrollData, setSuccessEnrollData] = useState(null);
  const [devices, setDevices] = usePersistedDevices();
  const [groups, setGroups, fetchGroups] = useGroups();
  const [ctxMenu, setCtxMenu] = useState(null);
  const [editDevice, setEditDevice] = useState(null);
  const [deviceToRemove, setDeviceToRemove] = useState(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [previewDevice, setPreviewDevice] = useState(null);


  // selectedGroupId is owned here but only mutated/read through modals (FIX 1).
  const [selectedGroupId, setSelectedGroupId] = useState("default");
  const { logAction } = useActivityLogger();

  useEffect(() => {
    const fetchLatestDevices = async () => {
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
                (b.ip && localCam.ip && b.rtsp_url && localCam.rtsp_url && b.ip === localCam.ip && b.rtsp_url === localCam.rtsp_url)
              );
              if (!match) {
                match = backendDevices.find((b) => b.ip === localCam.ip && b.channel === localCam.channel);     
              }
              
              if (match) {
                const computedBackendName = match.name || match.device_name || (`${match.manufacturer || ""} ${match.model || ""}`.trim());
                updated.push({
                  ...localCam,
                  ...match,
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
              (!b.stream_key && !b.id && b.ip === localCam.ip && b.channel === localCam.channel)
            )).map((b) => {
              const bName = b.name || b.device_name || (`${b.manufacturer || ""} ${b.model || ""}`.trim()) || `Camera @ ${b.ip}`;
              return { ...b, type: b.type || "entrance", name: bName, status: normalizeStatus(b.status) };
            });
            return [...updated, ...backendOnly];
          });
        }
      } catch (err) {
        console.error("Failed to fetch latest devices/shards from backend:", err);
      }
    };
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
  const filtered = devices.filter((d) => {
    const matchSearch =
      (d.name || "").toLowerCase().includes(filter.toLowerCase()) ||
      (d.ip || "").toLowerCase().includes(filter.toLowerCase());
    const matchGroup =
      activeGroup === "all" || (d.group_id || "default") === activeGroup;
    return matchSearch && matchGroup;
  });

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
    setTimeout(() => setRefreshing(false), 1200);
  };

  const handleRowContextMenu = useCallback((e, deviceId) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, deviceId });
  }, []);

  const handleEditDevice = useCallback((deviceId) => {
    const device = devices.find((d) => d.id === deviceId);
    if (device) setEditDevice(device);
  }, [devices]);

  const handleSaveDevice = useCallback(async (updated) => {
    try {
      if (updated.device_name) {
        updated.name = updated.device_name;
      }
      const { name, ... payload } = updated;
      await fetch(`${STREAM_API}/api/cameras/by-ip/${updated.ip}`, {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error("Failed to update DB:", e);
    }
    setDevices((prev) => prev.map((d) => d.id === updated.id ? updated : d));
  }, [setDevices]);

  const performRemoveDevice = useCallback(async (deviceId) => {
    const device = devices.find((d) => d.id === deviceId);
    if (!device) return;
    try {
      const res = await fetch(`${STREAM_API}/api/cameras/delete-by-rtsp`, { 
        method: "DELETE",
        headers: getAuthHeaders(),
        body: JSON.stringify({ rtsp_url: device.rtsp_url })
      });
            if (!res.ok) {
        let errMsg = "Failed to delete camera. Admin privileges required.";
        try {
          const errData = await res.json();
          errMsg = errData.detail || errMsg;
        } catch(e) {}
        setUiError(errMsg);
        return; // Don't remove from UI
      }
    } catch (err) {
      console.error("❌ Failed to delete from DB:", err);
            setUiError("Network error while deleting camera.");
      return;
    }
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
  }, [devices, setDevices]);

  const handleRemoveDevice = useCallback((deviceId) => {
    const device = devices.find((d) => d.id === deviceId);
    if (device) setDeviceToRemove(device);
  }, [devices]);

  const handleStreamProfiles = useCallback((deviceId) => {
    const device = devices.find((d) => d.id === deviceId);
    if (device && device.ip) {
      localStorage.setItem("miradorai_selected_camera_ip", device.ip);
    }
    localStorage.setItem("miradorai_selected_camera_id", String(deviceId));
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
    setEnrolling(true);
    setShowManualSearch(false);

    const { ip, user, pass, discovered, cameraName, channels, channel, group_id, port } = device;
    const enrichedName = discovered?.model
      ? `${discovered.manufacturer} ${discovered.model}`
      : null;

    const channelsToEnroll = channels && channels.length > 0 ? channels : [{ source: channel ?? 0 }];
    const addedDevices = [];
    let hasError = false;

    for (let i = 0; i < channelsToEnroll.length; i++) {
      const ch = channelsToEnroll[i];
      // Force channel to 0 for single physical cameras to ensure merging with Stream URL adds
      const safeChannel = channelsToEnroll.length === 1 ? 0 : (ch.source ?? 0);
      setEnrollMsg(`Registering camera ${i + 1} of ${channelsToEnroll.length}…`);

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
    }

    setEnrolling(false);
    setEnrollMsg("");

    setSuccessEnrollData({
      title: hasError ? "Partial Success / Failed" : (addedDevices.length > 1 ? `Successfully added ${addedDevices.length} Cameras` : "Camera Added Successfully"),
      desc: hasError 
        ? "Some or all cameras were probed, but failed to register streams with OME."
        : "The selected cameras have been successfully registered and added to the system.",
      isError: hasError,
      devices: addedDevices
    });
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

    const addedEntries = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const url = typeof item === "string" ? item : item.url;
      const customName = typeof item === "object" ? (item.name || "") : "";

      setEnrollMsg(`Registering stream ${i + 1} of ${items.length}…`);

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
    }

    setEnrolling(false);
    setEnrollMsg("");

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

        <div className="add-dev__table-wrap card">
          {filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <table className="m-table">
              <thead>
                <tr>
                  <th style={{ width: 60, color: "rgba(255, 255, 255, 0.5)" }}></th>
                  {["Device Name", "IP Address", "MAC Address", "Status", "Manufacturer", "Model", "Shard"].map((c) => (
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

                  return (
                    <tr
                      key={d.id}
                      className="m-table__row"
                      onContextMenu={(e) => handleRowContextMenu(e, d.id)}
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
                            <CameraThumb type={d.type} />
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
                      <td>
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
                      </td>
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


      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

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
            <div className="enrolling-spinner-container">
              <div className="enrolling-spinner"></div>
              <div className="enrolling-pulse"></div>
            </div>
            <h3 className="enrolling-title">Enrolling Device</h3>
            <p className="enrolling-msg">{enrollMsg || "Please wait while we register the camera stream..."}</p>
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
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="success-device-icon" style={{color: (d.stream_status === "error" || d.stream_status === "not_registered" || (!d.ws_url && !d.stream_key)) ? "#ef4444" : "var(--teal)"}}>
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
              <h2 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--teal)" }}>
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
                <span>Status: <strong style={{ color: previewDevice.stream_status === "streaming" || previewDevice.status === "Online" ? "var(--teal)" : "var(--text-muted)" }}>
                  {typeof previewDevice.stream_status === "object" ? (previewDevice.stream_status?.connected ? "streaming" : "error") : (previewDevice.stream_status || "offline")}
                </strong></span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}