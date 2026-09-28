
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/shared/Button";
import "./UserManagementPage.css";

const API = import.meta.env.VITE_API_URL || "";

import { encryptPassword, getPublicKey } from "../../utils/crypto";

function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token");
  return token ? { 
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json"
} : {
    "Content-Type": "application/json"
  };
}

const PasswordRules = ({ password }) => {
  const rules = [
    { label: "At least 12 characters long", test: p => p.length >= 12 },
    { label: "One uppercase letter", test: p => /[A-Z]/.test(p) },
    { label: "One lowercase letter", test: p => /[a-z]/.test(p) },
    { label: "One number", test: p => /[0-9]/.test(p) },
    { label: "One special character", test: p => /[!@#$%^&*(),.?":{}|<>]/.test(p) }
  ];

  return (
    <div style={{ marginTop: '8px', fontSize: '12px' }}>
      {rules.map((rule, idx) => {
        const passed = rule.test(password || "");
        return (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', color: passed ? '#10b981' : '#6b7280' }}>
            {passed ? (
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: '6px' }}><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: '6px' }}><circle cx="12" cy="12" r="10"/></svg>
            )}
            <span style={{ textDecoration: passed ? 'line-through' : 'none' }}>{rule.label}</span>
          </div>
        )
      })}
    </div>
  );
};

export default function UserManagementPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [showConfirmEditPassword, setShowConfirmEditPassword] = useState(false);

  // Form states
  const [createForm, setCreateForm] = useState({ email: "", password: "", role: "client", allowedCameras: [] });
  const [editForm, setEditForm] = useState({ role: "client", newPassword: "", confirmPassword: "", allowedCameras: [] });
  const [cameras, setCameras] = useState([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("miradorai_devices");
      if (stored) {
        setCameras(JSON.parse(stored).filter(c => c.enabled !== false));
      }
    } catch (e) {
      console.error("Failed to load cameras for permission config:", e);
    }
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/auth/users`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const sortedUsers = (data.users || []).sort((a, b) => {
          const dateA = new Date(a.createdAt || 0);
          const dateB = new Date(b.createdAt || 0);
          return dateB - dateA;
        });
        setUsers(sortedUsers);
      } else {
        setError(data.detail || "Failed to fetch users directory.");
      }
    } catch (err) {
      setError("Cannot connect to VMS Central Management Server.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!createForm.email || !createForm.password) {
      setError("Email and password fields are required.");
      return;
    }

    if (
      createForm.password.length < 12 ||
      !/[A-Z]/.test(createForm.password) ||
      !/[a-z]/.test(createForm.password) ||
      !/[0-9]/.test(createForm.password) ||
      !/[!@#$%^&*(),.?":{}|<>]/.test(createForm.password)
    ) {
      setError("Password does not meet the complexity requirements.");
      return;
    }

    try {
      const pubKey = await getPublicKey(API);
      const encryptedPassword = await encryptPassword(createForm.password, pubKey);
      const res = await fetch(`${API}/api/auth/users`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ ...createForm, password: encryptedPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(`Account for ${createForm.email} created successfully!`);
        setCreateForm({ email: "", password: "", role: "client", allowedCameras: [] });
        setShowCreateModal(false);
        fetchUsers();
      } else {
        setError(data.detail || "Failed to create user.");
      }
    } catch (err) {
      setError("Network error: Could not complete registration.");
    }
  };

  const handleEditClick = (user) => {
    setSelectedUser(user);
    setEditForm({ 
      role: user.role, 
      newPassword: "", 
      confirmPassword: "", 
      allowedCameras: user.allowedCameras || [] 
    });
    setShowEditModal(true);
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (editForm.newPassword && editForm.newPassword !== editForm.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (editForm.newPassword) {
      if (
        editForm.newPassword.length < 12 ||
        !/[A-Z]/.test(editForm.newPassword) ||
        !/[a-z]/.test(editForm.newPassword) ||
        !/[0-9]/.test(editForm.newPassword) ||
        !/[!@#$%^&*(),.?":{}|<>]/.test(editForm.newPassword)
      ) {
        setError("Password does not meet the complexity requirements.");
        return;
      }
    }

    const payload = { 
      role: editForm.role,
      allowedCameras: editForm.allowedCameras
    };
    if (editForm.newPassword) {
      const pubKey = await getPublicKey(API);
      payload.password = await encryptPassword(editForm.newPassword, pubKey);
    }

    try {
      const res = await fetch(`${API}/api/auth/users/${encodeURIComponent(selectedUser.email)}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(`User ${selectedUser.email} updated successfully.`);
        setShowEditModal(false);
        setSelectedUser(null);
        fetchUsers();
      } else {
        setError(data.detail || "Failed to update user.");
      }
    } catch (err) {
      setError("Network error: Could not save updates.");
    }
  };

  const handleToggleBlock = async (user) => {
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API}/api/auth/users/${encodeURIComponent(user.email)}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ is_blocked: !user.is_blocked })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(`User ${user.email} successfully ${!user.is_blocked ? "blocked" : "unblocked"}.`);
        fetchUsers();
      } else {
        setError(data.detail || "Failed to update user status.");
      }
    } catch (err) {
      setError("Network error: Could not update user status.");
    }
  };

  const handleDeleteUser = async (user) => {
    if (!window.confirm(`Are you sure you want to delete user: ${user.email}?`)) {
      return;
    }

    setError("");
    setSuccess("");
    try {
      const res = await fetch(`${API}/api/auth/users/${encodeURIComponent(user.email)}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(`User ${user.email} successfully deleted.`);
        fetchUsers();
      } else {
        setError(data.detail || "Failed to delete user.");
      }
    } catch (err) {
      setError("Network error: Could not delete user.");
    }
  };

  const getRoleLabel = (role) => {
    switch (role) {
      case "admin": return "Administrator";
      case "client": return "Client Node";
      case "operator": return "Live Operator";
      default: return role;
    }
  };

  const getFormatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    try {
      let dStr = dateStr;
      if (!dStr.endsWith("Z") && !dStr.includes("+") && !dStr.match(/-\d{2}:\d{2}$/)) {
        // Ensure space is replaced by T for strict ISO parsing, and append Z to force UTC
        dStr = dStr.replace(" ", "T") + "Z";
      }
      return new Date(dStr).toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata"
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="vs-page um-page">
      <div className="vs-header um-header">
        <div>
          <h1 className="vs-title um-title">User <span>Directory</span></h1>
        </div>
        <button className="m-btn m-btn--primary" onClick={() => { setError(""); setSuccess(""); setShowCreateModal(true); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="15" height="15">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Add User
        </button>
      </div>

      {error && !showCreateModal && !showEditModal && (
        <div className="um-banner error-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      {success && !showCreateModal && !showEditModal && (
        <div className="um-banner success-banner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {success}
        </div>
      )}

      <div className="vs-panel um-panel">
        <div className="vs-panel-header um-panel-header">
          <h2>Active Registered Users ({users.length})</h2>
        </div>
        <div className="vs-panel-body um-panel-body">
          {loading ? (
            <div className="vs-state-msg">Fetching users list...</div>
          ) : users.length === 0 ? (
            <div className="vs-state-msg">No users enrolled in database.</div>
          ) : (
            <div className="um-table-container">
              <table className="um-table">
                <thead>
                  <tr>
                    <th>Email Address</th>
                    <th>Assigned Role</th>
                    <th>Registered At</th>
                    <th className="th-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.email}>
                      <td className="td-email">
                        <div className="td-avatar">
                          {u.email.charAt(0).toUpperCase()}
                        </div>
                        <span>{u.email}</span>
                      </td>
                      <td>
                        <span className={`um-role-badge badge-${u.role}`}>
                          {getRoleLabel(u.role)}
                        </span>
                      </td>
                      <td className="td-date">{getFormatDate(u.createdAt)}</td>
                      <td className="td-actions">
                        <button className="m-btn m-btn--elevated" style={{ padding: '8px', minWidth: 'auto' }} onClick={() => handleEditClick(u)} title="Modify Role or Reset Password">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ margin: 0 }}>
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button className={`m-btn ${u.is_blocked ? "m-btn--primary" : "m-btn--danger"}`} style={{ padding: '8px', minWidth: 'auto' }} onClick={() => handleToggleBlock(u)} title={u.is_blocked ? "Unblock User" : "Block User"}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ margin: 0 }}>
                            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                            <line x1="12" y1="2" x2="12" y2="12" />
                          </svg>
                        </button>
                        <button className="m-btn m-btn--elevated" style={{ padding: '8px', minWidth: 'auto' }} onClick={() => navigate(`/logs?user_email=${encodeURIComponent(u.email)}&tab=ui`)} title="View User Activity">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ margin: 0 }}>
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        </button>
                        <button className="m-btn m-btn--danger" style={{ padding: '8px', minWidth: 'auto' }} onClick={() => handleDeleteUser(u)} title="Delete User Account">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" style={{ margin: 0 }}>
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-box um-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Enlist New User</h2>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateUser}>
              <div className="modal-body">
                {error && (
                  <div style={{ color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {error}
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    className="form-input"
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    placeholder="Enter email address"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <div style={{ position: "relative", width: "100%" }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      className="form-input"
                      style={{ paddingRight: "40px" }}
                      value={createForm.password}
                      onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                      placeholder="Minimum 12 characters"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
                    >
                      {showPassword ? (
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      )}
                    </button>
                  </div>
                  <PasswordRules password={createForm.password} />
                </div>
                <div className="form-group">
                  <label className="form-label">System Access Role</label>
                  <select
                    className="form-select"
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                  >
                    <option value="client">Client</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                {createForm.role !== "admin" && (
                  <div className="form-group">
                    <label className="form-label">Allowed Camera Access</label>
                    <div className="camera-select-list">
                      <label className="camera-select-all">
                        <input
                          type="checkbox"
                          checked={createForm.allowedCameras.length === 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setCreateForm({ ...createForm, allowedCameras: [] });
                            }
                          }}
                        />
                        <span>All Cameras (Unrestricted)</span>
                      </label>
                      {cameras.map(c => {
                        const isChecked = createForm.allowedCameras.includes(String(c.id));
                        return (
                          <label key={c.id} className="camera-select-item">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const updated = e.target.checked
                                  ? [...createForm.allowedCameras, String(c.id)]
                                  : createForm.allowedCameras.filter(id => id !== String(c.id));
                                setCreateForm({ ...createForm, allowedCameras: updated });
                              }}
                            />
                            <span>{c.name} ({c.ip})</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="m-btn m-btn--elevated" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="m-btn m-btn--primary">Register User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {showEditModal && selectedUser && (
        <div className="modal-overlay" onClick={() => { setShowEditModal(false); setSelectedUser(null); }}>
          <div className="modal-box um-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Manage Account: {selectedUser.email}</h2>
              <button className="modal-close" onClick={() => { setShowEditModal(false); setSelectedUser(null); }}>✕</button>
            </div>
            <form onSubmit={handleUpdateUser}>
              <div className="modal-body">
                {error && (
                  <div style={{ color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    {error}
                  </div>
                )}
                <div className="form-group">
                  <label className="form-label">System Access Role</label>
                  <select
                    className="form-select"
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  >
                    <option value="client">Client</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                {editForm.role !== "admin" && (
                  <div className="form-group">
                    <label className="form-label">Allowed Camera Access</label>
                    <div className="camera-select-list">
                      <label className="camera-select-all">
                        <input
                          type="checkbox"
                          checked={editForm.allowedCameras.length === 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditForm({ ...editForm, allowedCameras: [] });
                            }
                          }}
                        />
                        <span>All Cameras (Unrestricted)</span>
                      </label>
                      {cameras.map(c => {
                        const isChecked = editForm.allowedCameras.includes(String(c.id));
                        return (
                          <label key={c.id} className="camera-select-item">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const updated = e.target.checked
                                  ? [...editForm.allowedCameras, String(c.id)]
                                  : editForm.allowedCameras.filter(id => id !== String(c.id));
                                setEditForm({ ...editForm, allowedCameras: updated });
                              }}
                            />
                            <span>{c.name} ({c.ip})</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="um-divider" />
                <h3 className="form-subtitle">Reset Password (Optional)</h3>

                <div className="form-group">
                  <label className="form-label">New Password</label>
                  <div style={{ position: "relative", width: "100%" }}>
                    <input
                      type={showEditPassword ? "text" : "password"}
                      className="form-input"
                      style={{ paddingRight: "40px" }}
                      value={editForm.newPassword}
                      onChange={(e) => setEditForm({ ...editForm, newPassword: e.target.value })}
                      placeholder="Leave blank to keep current password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPassword(!showEditPassword)}
                      style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
                    >
                      {showEditPassword ? (
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      )}
                    </button>
                  </div>
                  <PasswordRules password={editForm.newPassword} />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirm New Password</label>
                  <div style={{ position: "relative", width: "100%" }}>
                    <input
                      type={showConfirmEditPassword ? "text" : "password"}
                      className="form-input"
                      style={{ paddingRight: "40px" }}
                      value={editForm.confirmPassword}
                      onChange={(e) => setEditForm({ ...editForm, confirmPassword: e.target.value })}
                      placeholder="Retype password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmEditPassword(!showConfirmEditPassword)}
                      style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
                    >
                      {showConfirmEditPassword ? (
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="m-btn m-btn--elevated" onClick={() => { setShowEditModal(false); setSelectedUser(null); }}>Cancel</button>
                <button type="submit" className="m-btn m-btn--primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
