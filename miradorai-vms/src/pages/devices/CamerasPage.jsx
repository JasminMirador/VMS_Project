import { useState, useEffect } from "react";
import SearchBar from "../../components/shared/SearchBar";
import Modal from "../../components/shared/Modal";
import { CAMERA_FEATURES_CONFIG } from "../../data/navConfig";
import "./CamerasPage.css";
import SpecularButton from "../../components/shared/SpecularButton";
import { useTheme } from "../../context/ThemeContext";
import MaskingPage from "./MaskingPage";
import { useNavigate } from "react-router-dom";
import useActivityLogger from "../../hooks/useActivityLogger";

import useGroups from "../../hooks/useGroups";

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveDevices(devices) {
  try { localStorage.setItem("miradorai_devices", JSON.stringify(devices)); } catch {}
}

const API_BASE = import.meta.env.VITE_API_URL;
const INLINE_PAGES = ["masking"];

export default function CamerasPage({ onNavigate, onCameraSelect }) {
  const { theme } = useTheme();
  const [cameras, setCameras]           = useState(loadDevices);
  const [groups, setGroups, fetchGroups]= useGroups();
  const [filter, setFilter]             = useState("");
  const [selected, setSelected]         = useState(null);
  const [checked, setChecked]           = useState([]);
  const [editModal, setEditModal]       = useState(null);
  const [editForm, setEditForm]         = useState({});
  const [authModal, setAuthModal]       = useState(null);
  const [authForm, setAuthForm]         = useState({ username: "", password: "" });
  const [activePage, setActivePage]     = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupChecked, setGroupChecked] = useState([]);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editGroupValue, setEditGroupValue] = useState("");
  const [uiError, setUiError] = useState("");
  const navigate = useNavigate();
  const { logAction } = useActivityLogger();

  useEffect(() => {
    const fetchLatestDevices = async () => {
      try {
        const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
        const res = await fetch(`${API_BASE}/api/cameras`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          const backendDevices = Array.isArray(data) ? data : (data.devices || []);
          
          setCameras(backendDevices);
          saveDevices(backendDevices);
        }
      } catch (err) {
        console.error("Failed to fetch latest devices from backend:", err);
      }
    };
    fetchLatestDevices();
  }, []);

  const handleSaveGroupName = async (groupId) => {
    const trimmed = editingGroupName.trim();
    if (!trimmed) {
      setEditingGroupId(null);
      return;
    }
    if (!/^[a-zA-Z0-9 _-]+$/.test(trimmed)) {
      setUiError("Group Name can only contain alphanumeric characters, spaces, dashes, and underscores.");
      return;
    }
    const updatedGroups = groups.map(g => 
      g.id === groupId ? { ...g, name: trimmed } : g
    );
    setGroups(updatedGroups);
    setEditingGroupId(null);

    try {
      const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
      await fetch(`${API_BASE}/api/groups/${groupId}`, {
        method: "PUT",
        headers: {
          "Authorization": token ? `Bearer ${token}` : "",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: editingGroupName.trim() })
      });
      fetchGroups(); // refresh to get latest state
    } catch (e) {
      console.error("Failed to update group name", e);
    }
  };

  // ── Build grouped data ──
  const groupedData = Object.values(
    cameras.reduce((acc, cam) => {
      const gid = cam.group_id || "default";
      if (!acc[gid]) {
        acc[gid] = {
          group_id: gid,
          name: gid === "default"
            ? "Default"
            : (groups.find(g => g.id === gid)?.name || gid),
          cameras: [],
        };
      }
      acc[gid].cameras.push(cam);
      return acc;
    }, groups.reduce((acc, g) => {
      acc[g.id] = { group_id: g.id, name: g.name, cameras: [] };
      return acc;
    }, { default: { group_id: "default", name: "Default", cameras: [] } }))
  );

  // Filter groups by search
  const filteredGroups = groupedData.filter((group) =>
    !filter ||
    group.name.toLowerCase().includes(filter.toLowerCase()) ||
    group.cameras.some((c) =>
      [c.name, c.ip, c.mac, c.model, c.manufacturer].some(
        (v) => v && String(v).toLowerCase().includes(filter.toLowerCase())
      )
    )
  );

  const allChecked = filteredGroups.length > 0 && filteredGroups.every((g) => checked.includes(g.group_id));
  const toggleAll  = () => setChecked(allChecked ? [] : filteredGroups.map((g) => g.group_id));
  const toggleGroup = (gid) => setChecked((s) =>
    s.includes(gid) ? s.filter((x) => x !== gid) : [...s, gid]
  );

  const toggleGroupEnabled = (groupId) => {
    const groupCams = cameras.filter(c => (c.group_id || "default") === groupId);
    const allEnabled = groupCams.every(c => c.enabled !== false);
    const willBeEnabled = !allEnabled;
    const updated = cameras.map(c =>
      (c.group_id || "default") === groupId
        ? { ...c, enabled: willBeEnabled }
        : c
    );
    setCameras(updated);
    saveDevices(updated);

    // Call camera action on backend for each camera in the group
    groupCams.forEach(cam => {
      if ((cam.enabled !== false) !== willBeEnabled) {
        callCameraAction(cam, willBeEnabled ? "enable" : "disable");
        logAction(
          willBeEnabled ? "Camera enabled" : "Camera disabled",
          "camera",
          { ip: cam.ip }
        );
      }
    });

    // Also update selectedGroup state if it matches this group
    if (selectedGroup && selectedGroup.group_id === groupId) {
      setSelectedGroup((sg) => ({
        ...sg,
        cameras: sg.cameras.map((c) => ({ ...c, enabled: willBeEnabled })),
      }));
    }
  };

  const openGroupPanel = (group) => {
    setSelectedGroup(group);
    setGroupChecked([]);
  };

  const toggleGroupCam = (camId) => {
    setGroupChecked((s) =>
      s.includes(camId) ? s.filter((x) => x !== camId) : [...s, camId]
    );
  };

  const handleDeleteGroupCams = async () => {
    const camsToRemove = cameras.filter(c => groupChecked.includes(c.id));
    let hasError = false;
    for (const cam of camsToRemove) {
      try {
        const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
        const res = await fetch(`${API_BASE}/api/cameras/delete-by-rtsp`, { 
          method: "DELETE",
          headers: { 
            "Authorization": "Bearer " + (token || ""),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ rtsp_url: cam.rtsp_url })
        });
        if (!res.ok) {
          let errMsg = "Failed to delete camera. Admin privileges required.";
          try {
            const errData = await res.json();
            errMsg = errData.detail || errMsg;
          } catch(e) {}
          setUiError(errMsg);
          hasError = true;
          break;
        }
        const data = await res.json();
        console.log("✅ Deleted from DB:", data);
        logAction("Camera deleted", "camera", { ip: cam.ip });
      } catch (err) {
        console.error("❌ Delete failed:", err);
        setUiError("Network error while deleting camera.");
        hasError = true;
        break;
      }
    }

    if (hasError) {
      setGroupChecked([]);
      return;
    }

    const updated = cameras.filter(c => !groupChecked.includes(c.id));
    setCameras(updated);
    saveDevices(updated);
    setGroupChecked([]);
    if (selectedGroup) {
      const updatedGroup = {
        ...selectedGroup,
        cameras: selectedGroup.cameras.filter(c => !groupChecked.includes(c.id)),
      };
      setSelectedGroup(updatedGroup.cameras.length > 0 ? updatedGroup : null);
    }
  };

  const handleExecuteConfirm = async () => {
    if (!confirmAction) return;
    setConfirmLoading(true);
    try {
      await confirmAction.onConfirm();
    } catch (err) {
      console.error("Error executing confirm action:", err);
    } finally {
      setConfirmLoading(false);
      setConfirmAction(null);
    }
  };

  const handleMoveToGroup = async (targetGroupId) => {
    const updated = cameras.map(c =>
      groupChecked.includes(c.id)
        ? { ...c, group_id: targetGroupId }
        : c
    );
    setCameras(updated);
    saveDevices(updated);
    
    // Call backend API for each moved camera
    const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
    for (const cam of updated) {
      if (groupChecked.includes(cam.id)) {
        try {
          await fetch(`${API_BASE}/api/cameras/by-ip/${cam.ip}`, {
            method: "PUT",
            headers: {
              "Authorization": "Bearer " + (token || ""),
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ group_id: targetGroupId })
          });
        } catch (e) {
          console.error("Failed to update camera group on backend", e);
        }
      }
    }

    setShowMoveModal(false);
    setGroupChecked([]);
    setSelectedGroup(null);
  };

  const callCameraAction = (cam, action) => {
    if (!cam.ip) return;
    const ip     = encodeURIComponent(cam.ip);
    const url    = `${API_BASE}/api/cameras/by-ip/${ip}/${action}`;
    const method = action === "delete" ? "DELETE" : "POST";
    
    const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
    const headers = {
      "Authorization": "Bearer " + (token || ""),
      "Content-Type": "application/json"
    };

    fetch(url, { method, headers })
      .then((r) => r.json())
      .then((d) => console.log(`[CAMERA] ${action} OK for ${cam.ip}:`, d))
      .catch((err) => console.error(`[CAMERA] ${action} FAILED for ${cam.ip}:`, err));
  };

  const toggleEnabled = (cam, e) => {
    e.stopPropagation();
    const willBeEnabled = cam.enabled === false;
    const updated = cameras.map((c) =>
      String(c.id) === String(cam.id) ? { ...c, enabled: willBeEnabled } : c
    );
    setCameras(updated);
    saveDevices(updated);

    // Also update selectedGroup state so panel reflects change immediately
    if (selectedGroup) {
      setSelectedGroup((sg) => ({
        ...sg,
        cameras: sg.cameras.map((c) =>
          String(c.id) === String(cam.id) ? { ...c, enabled: willBeEnabled } : c
        ),
      }));
    }

    callCameraAction(cam, willBeEnabled ? "enable" : "disable");
    logAction(
      willBeEnabled ? "Camera enabled" : "Camera disabled",
      "camera",
      { ip: cam.ip }
    );
  };

  const openEdit = (c) => {
    setEditForm({
      enabled:     c.enabled !== false,
      name:        c.name        || "",
      description: c.description || "",
      ip:          c.ip          || "",
      port:        c.port ? Number(c.port) : 80,
      username:    c.username    || "",
      password:    c.password    || "",
    });
    setEditModal(c);
  };

  const saveEdit = () => {
    if (editForm.name) {
      const trimmed = editForm.name.trim();
      if (!/^[a-zA-Z0-9 _-]+$/.test(trimmed)) {
        setUiError("Camera Name can only contain alphanumeric characters, spaces, dashes, and underscores.");
        return;
      }
    }

    const prev    = cameras.find((c) => String(c.id) === String(editModal.id));
    const updated = cameras.map((c) =>
      String(c.id) === String(editModal.id) ? { ...c, ...editForm } : c
    );
    setCameras(updated);
    saveDevices(updated);
    if (prev) {
      const wasEnabled = prev.enabled !== false;
      const nowEnabled = editForm.enabled;
      if (wasEnabled && !nowEnabled) callCameraAction(editModal, "disable");
      else if (!wasEnabled && nowEnabled) callCameraAction(editModal, "enable");
    }
    setEditModal(null);
  };

  const openAuth = (e, c) => {
    e.stopPropagation();
    setAuthForm({ username: c.username || "", password: c.password || "" });
    setAuthModal(c);
  };

  const confirmAuth = () => {
    const updated = cameras.map((c) =>
      String(c.id) === String(authModal.id)
        ? { ...c, username: authForm.username, password: authForm.password }
        : c
    );
    setCameras(updated);
    saveDevices(updated);
    if (editModal && String(editModal.id) === String(authModal.id)) {
      setEditForm((f) => ({ ...f, username: authForm.username, password: authForm.password }));
    }
    setAuthModal(null);
  };

  const handleRemoveGroups = async () => {
    if (checked.length === 0) return;
    const camIdsToRemove = cameras
      .filter(c => checked.includes(c.group_id || "default"))
      .map(c => c.id);

    const camsToRemove = cameras.filter(c => camIdsToRemove.includes(c.id));
    let hasError = false;
    for (const cam of camsToRemove) {
      try {
        const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
        const res = await fetch(`${API_BASE}/api/cameras/delete-by-rtsp`, { 
          method: "DELETE",
          headers: { 
            "Authorization": "Bearer " + (token || ""),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ rtsp_url: cam.rtsp_url })
        });
        if (!res.ok) {
          let errMsg = "Failed to delete camera. Admin privileges required.";
          try {
            const errData = await res.json();
            errMsg = errData.detail || errMsg;
          } catch(e) {}
          setUiError(errMsg);
          hasError = true;
          break;
        }
        const data = await res.json();
        console.log("✅ Deleted from DB:", data);
        logAction("Camera deleted", "camera", { ip: cam.ip });
      } catch (err) {
        console.error("❌ Delete failed:", err);
        setUiError("Network error while deleting camera.");
        hasError = true;
        break;
      }
    }

    if (hasError) {
      setChecked([]);
      return;
    }

    const updated = cameras.filter(c => !camIdsToRemove.includes(c.id));
    setCameras(updated);
    saveDevices(updated);

    // Remove the selected groups from the groups state and localStorage
    const updatedGroups = groups.filter(g => !checked.includes(g.id));
    setGroups(updatedGroups);

    for (const gid of checked) {
      try {
        const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
        await fetch(`${API_BASE}/api/groups/${gid}`, {
          method: "DELETE",
          headers: {
            "Authorization": token ? `Bearer ${token}` : "",
          }
        });
      } catch (e) {
        console.error("Failed to delete group", e);
      }
    }
    fetchGroups(); // sync with backend

    setChecked([]);
    setSelectedGroup(null);
  };

  // All unique groups for Move To modal
  const allGroupOptions = [
    { id: "default", name: "Default" },
    ...groups.map(g => ({ id: g.id, name: g.name })),
  ];

  const selectedCam = null;

  /* ── Inline masking page ── */
  if (activePage === "masking" && selectedCam) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <div>
            <h1 className="page-title"><span>Masking</span></h1>
            <p className="page-desc">{selectedCam.name || selectedCam.ip}</p>
          </div>
          <button
            className="ec-btn ec-btn--cancel"
            style={{ alignSelf: "center" }}
            onClick={() => setActivePage(null)}
          >
            ← Back to Cameras
          </button>
        </div>
        <MaskingPage camera={selectedCam} />
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header__left">
          <h1 className="page-title">Manage <span>Camera Groups</span></h1>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Filter groups or cameras..." />
      </div>

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

      <div className="app-content">
        <div className={`cameras-content-layout ${selectedGroup ? "has-panel" : ""}`}>

          {/* ── Group table ── */}
          <div className="card cam-table-wrap">
            <table className="m-table">
              <thead>
                <tr>
                  <th style={{ width: 36, color: "rgba(255, 255, 255, 0.5)" }}>
                    <input
                      type="checkbox"
                      className="m-checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                    />
                  </th>
                  <th style={{ width: 72, color: "rgba(255, 255, 255, 0.5)" }}>Active</th>
                  <th style={{ color: "rgba(255, 255, 255, 0.5)" }}>Group Name</th>
                  <th style={{ textAlign: "center", color: "rgba(255, 255, 255, 0.5)" }}>Total Cameras</th>
                  <th style={{ textAlign: "center", color: "rgba(255, 255, 255, 0.5)" }}>Active</th>
                  <th style={{ textAlign: "center", color: "rgba(255, 255, 255, 0.5)" }}>Disabled</th>
                  <th style={{ width: 140, color: "rgba(255, 255, 255, 0.5)" }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="m-table__empty" style={{ textAlign: "center", height: "350px", verticalAlign: "middle", color: "var(--text-muted)", fontSize: "16px" }}>
                      {cameras.length === 0
                        ? "No cameras enrolled. Go to Add Devices to get started."
                        : "No groups match your filter."}
                    </td>
                  </tr>
                ) : filteredGroups.map((group) => {
                  const total       = group.cameras.length;
                  const activeCount = group.cameras.filter(c => c.enabled !== false).length;
                  const isChecked   = checked.includes(group.group_id);
                  const isSel       = selectedGroup?.group_id === group.group_id;

                  return (
                    <tr
                      key={group.group_id}
                      className={[
                        "m-table__row",
                        isSel     ? "m-table__row--selected" : "",
                        isChecked ? "m-table__row--selected" : "",
                      ].join(" ")}
                    >
                      {/* Checkbox */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="m-checkbox"
                          checked={isChecked}
                          onChange={() => toggleGroup(group.group_id)}
                        />
                      </td>

                      {/* Active toggle (affects all cameras in group) */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <label className="cam-toggle" title={activeCount > 0 ? "Disable all" : "Enable all"}>
                          <input
                            type="checkbox"
                            checked={activeCount > 0}
                            onChange={() => toggleGroupEnabled(group.group_id)}
                          />
                          <span className="cam-toggle-track">
                            <span className="cam-toggle-thumb" />
                          </span>
                        </label>
                      </td>

                      {/* Group Name */}
                      <td className="m-table__primary">
                        {editingGroupId === group.group_id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }} onClick={(e) => e.stopPropagation()}>
                            <input
                              className="ec-input"
                              style={{ height: "26px", padding: "0 6px" }}
                              value={editingGroupName}
                              onChange={(e) => setEditingGroupName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveGroupName(group.group_id);
                                if (e.key === "Escape") setEditingGroupId(null);
                              }}
                              autoFocus
                            />
                            <button
                              className="ec-btn ec-btn--primary"
                              style={{ padding: "0 8px", height: "26px", fontSize: "15px" }}
                              onClick={() => handleSaveGroupName(group.group_id)}
                            >
                              Save
                            </button>
                            <button
                              className="ec-btn ec-btn--cancel"
                              style={{ padding: "0 8px", height: "26px", fontSize: "15px" }}
                              onClick={() => setEditingGroupId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            {group.name}
                            {group.group_id !== "default" && (
                              <button
                                title="Edit Group Name"
                                style={{
                                  background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center"
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingGroupId(group.group_id);
                                  setEditingGroupName(group.name);
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Total Cameras */}
                      <td>
                        <span className="group-total">{total}</span>
                      </td>
                      {/* Active */}
                      <td>
                        <span className="group-active">{activeCount}</span>
                      </td>
                      {/* Disabled */}
                      <td>
                        <span className="group-disabled">{total - activeCount}</span>
                      </td>

                      {/* View All button */}
                      <td>
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
                          className="ec-btn ec-btn--primary"
                          onClick={() => openGroupPanel(group)}
                        >
                          <span style={{ whiteSpace: "nowrap" }}>View All Cameras</span>
                        </SpecularButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Right Side Panel (Group) ── */}
          {selectedGroup && (
            <div className="card cam-side-panel">
              <div className="cam-side-header">
                <h3>{selectedGroup.name}</h3>
                <button className="close-btn" onClick={() => setSelectedGroup(null)}>✕</button>
              </div>

              <div className="cam-side-body">
                {selectedGroup.cameras.length === 0 ? (
                  <div className="m-table__empty" style={{ padding: "1rem" }}>No cameras in this group.</div>
                ) : selectedGroup.cameras.map((cam) => {
                  const isEnabled    = cam.enabled !== false;
                  const isCamChecked = groupChecked.includes(cam.id);

                  return (
                    <div
                      key={cam.id}
                      className={`cam-side-item ${isCamChecked ? "checked" : ""}`}
                      onClick={() => toggleGroupCam(cam.id)}
                    >
                      <input
                        type="checkbox"
                        checked={isCamChecked}
                        onChange={() => toggleGroupCam(cam.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="cam-item-info">
                        <div className="cam-item-name">{cam.name || cam.ip}</div>
                        <div className="cam-item-ip notranslate">{cam.ip}</div>
                      </div>
                      <label className="cam-toggle" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) => toggleEnabled(cam, e)}
                        />
                        <span className="cam-toggle-track">
                          <span className="cam-toggle-thumb" />
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>

              {/* Panel footer */}
              <div className="ec-panel__footer">
                <div className="ec-panel__footer-left">
                  <span>{groupChecked.length} selected</span>
                </div>
                <div className="ec-panel__footer-right">
                  <button
                    className="ec-btn ec-btn--danger"
                    disabled={groupChecked.length === 0}
                    onClick={() => {
                      setConfirmAction({
                        title: "Delete Cameras",
                        message: `Are you sure you want to delete ${groupChecked.length} selected camera(s)?`,
                        onConfirm: handleDeleteGroupCams
                      });
                    }}
                  >
                    Delete
                  </button>
                  <button
                    className="ec-btn ec-btn--primary"
                    disabled={groupChecked.length === 0}
                    onClick={() => setShowMoveModal(true)}
                  >
                    Move To
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="page-footer">
        <span className="cameras-count">
          {groupedData.length} group{groupedData.length !== 1 ? "s" : ""}
          <span className="cameras-count-active">
            {" "}· {cameras.length} total cameras · {cameras.filter(c => c.enabled !== false).length} active
          </span>
        </span>
        <div className="page-footer-right">
          <button
            className="m-btn m-btn--danger"
            disabled={checked.length === 0}
            onClick={() => setConfirmAction({
              title: "Remove Groups",
              message: `Are you sure you want to remove the ${checked.length} selected group(s)? All cameras within them will also be deleted.`,
              onConfirm: handleRemoveGroups
            })}
          >
            {checked.length > 1 ? `Remove Groups (${checked.length})` : "Remove Group"}
          </button>
        </div>
      </div>

      {/* ── Move To Modal ── */}
      {showMoveModal && (
        <div className="ec-overlay" onClick={() => setShowMoveModal(false)}>
          <div className="ec-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ec-titlebar">
              <span className="ec-title">Move Cameras To Group</span>
              <div className="ec-titlebar-actions">
                <button className="ec-title-btn" onClick={() => setShowMoveModal(false)} title="Close">✕</button>
              </div>
            </div>
            <div className="ec-body">
              <p className="ec-auth-desc">
                Select a group to move <strong>{groupChecked.length} camera{groupChecked.length !== 1 ? "s" : ""}</strong> to:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                {allGroupOptions
                  .filter(g => g.id !== selectedGroup?.group_id)
                  .map((g) => (
                    <button
                      key={g.id}
                      className="ec-btn ec-btn--primary"
                      style={{ textAlign: "left", justifyContent: "flex-start" }}
                      onClick={() => handleMoveToGroup(g.id)}
                    >
                      {g.name}
                    </button>
                  ))}
                {allGroupOptions.filter(g => g.id !== selectedGroup?.group_id).length === 0 && (
                  <p style={{ opacity: 0.6, fontSize: "0.85rem" }}>No other groups available.</p>
                )}
              </div>
            </div>
            <div className="ec-footer">
              <div className="ec-footer-right">
                <button className="ec-btn ec-btn--cancel" onClick={() => setShowMoveModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Camera Modal ── */}
      {editModal && (
        <div className="ec-overlay" onClick={() => setEditModal(null)}>
          <div className="ec-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ec-titlebar">
              <span className="ec-title">Edit Camera</span>
              <div className="ec-titlebar-actions">
                <button className="ec-title-btn" title="Help">?</button>
                <button className="ec-title-btn" onClick={() => setEditModal(null)} title="Close">✕</button>
              </div>
            </div>
            <div className="ec-body">
              <div className="ec-section-title">Settings</div>
              <div className="ec-toggle-row">
                <div className="ec-toggle-info">
                  <span className="ec-toggle-label">Enabled</span>
                  <span className="ec-toggle-sub">
                    {editForm.enabled ? "Camera will stream and record" : "Camera will not stream or record"}
                  </span>
                </div>
                <label className="cam-toggle cam-toggle--lg">
                  <input
                    type="checkbox"
                    checked={editForm.enabled}
                    onChange={(e) => setEditForm((f) => ({ ...f, enabled: e.target.checked }))}
                  />
                  <span className="cam-toggle-track"><span className="cam-toggle-thumb" /></span>
                </label>
              </div>
              <div className="ec-field-row">
                <label className="ec-field-label">Name:</label>
                <input
                  className="ec-input ec-input--highlight"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="ec-field-row ec-field-row--top">
                <label className="ec-field-label">Description:</label>
                <textarea
                  className="ec-textarea"
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="ec-field-row">
                <label className="ec-field-label">Address:</label>
                <input
                  className="ec-input"
                  value={editForm.ip}
                  onChange={(e) => setEditForm((f) => ({ ...f, ip: e.target.value }))}
                />
              </div>
              <div className="ec-field-row">
                <label className="ec-field-label">Port:</label>
                <input
                  className="ec-input ec-input--short"
                  value={editForm.port}
                  onChange={(e) => setEditForm((f) => ({ ...f, port: e.target.value }))}
                />
              </div>
              <div className="ec-section-title ec-section-title--spaced">Credentials</div>
              <div className="ec-field-row">
                <label className="ec-field-label">Username:</label>
                <input
                  className="ec-input"
                  value={editForm.username}
                  onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                />
              </div>
              <div className="ec-field-row">
                <label className="ec-field-label">Password:</label>
                <input
                  className="ec-input"
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                />
              </div>
            </div>
            <div className="ec-footer">
              <button className="ec-btn ec-btn--help">Help</button>
              <div className="ec-footer-right">
                <button className="ec-btn ec-btn--primary" onClick={saveEdit}>OK</button>
                <button className="ec-btn ec-btn--cancel" onClick={() => setEditModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Authentication Required Modal ── */}
      {authModal && (
        <div className="ec-overlay" onClick={() => setAuthModal(null)}>
          <div className="ec-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ec-titlebar">
              <span className="ec-title">Authentication Required</span>
              <div className="ec-titlebar-actions">
                <button className="ec-title-btn" title="Help">?</button>
                <button className="ec-title-btn" onClick={() => setAuthModal(null)} title="Close">✕</button>
              </div>
            </div>
            <div className="ec-body">
              <p className="ec-auth-desc">
                The device configuration tab of <strong>'{authModal.name}'</strong> is requesting a username and password.
              </p>
              <div className="ec-field-row">
                <label className="ec-field-label">Username:</label>
                <input
                  className="ec-input ec-input--highlight"
                  value={authForm.username}
                  autoFocus
                  onChange={(e) => setAuthForm((f) => ({ ...f, username: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && confirmAuth()}
                />
              </div>
              <div className="ec-field-row">
                <label className="ec-field-label">Password:</label>
                <input
                  className="ec-input"
                  type="password"
                  value={authForm.password}
                  onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && confirmAuth()}
                />
              </div>
            </div>
            <div className="ec-footer">
              <button className="ec-btn ec-btn--help">Help</button>
              <div className="ec-footer-right">
                <button className="ec-btn ec-btn--primary" onClick={confirmAuth}>OK</button>
                <button className="ec-btn ec-btn--cancel" onClick={() => setAuthModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation Modal ── */}
      {confirmAction && (
        <div className="ec-overlay" onClick={confirmLoading ? null : () => setConfirmAction(null)}>
          <div className="ec-modal" onClick={(e) => e.stopPropagation()} style={{ width: 340 }}>
            <div className="ec-titlebar">
              <span className="ec-title">{confirmAction.title}</span>
              <div className="ec-titlebar-actions">
                {!confirmLoading && (
                  <button className="ec-title-btn" onClick={() => setConfirmAction(null)} title="Close">✕</button>
                )}
              </div>
            </div>
            <div className="ec-body">
              {confirmLoading ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "20px 0" }}>
                  <div className="deleting-spinner"></div>
                  <p style={{ margin: 0, fontSize: "18px", fontWeight: "600", color: "var(--text-secondary)" }}>
                    Deleting...
                  </p>
                </div>
              ) : (
                <p className="ec-auth-desc" style={{ marginBottom: 0 }}>
                  {confirmAction.message}
                </p>
              )}
            </div>
            <div className="ec-footer">
              <div className="ec-footer-right" style={{ width: "100%", justifyContent: "flex-end", gap: "10px" }}>
                <button 
                  className="ec-btn ec-btn--cancel" 
                  onClick={() => setConfirmAction(null)}
                  disabled={confirmLoading}
                  style={{ opacity: confirmLoading ? 0.5 : 1 }}
                >
                  Cancel
                </button>
                <button 
                  className="ec-btn ec-btn--danger" 
                  onClick={handleExecuteConfirm}
                  disabled={confirmLoading}
                  style={{ opacity: confirmLoading ? 0.7 : 1 }}
                >
                  {confirmLoading ? "Deleting..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}