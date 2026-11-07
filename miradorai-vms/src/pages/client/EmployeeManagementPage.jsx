import React, { useState, useEffect, useRef } from "react";
import "./EmployeeManagementPage.css";

export default function EmployeeManagementPage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [toast, setToast] = useState(null);

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    department: "General",
    status: "authorised",
  });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [previewModalImg, setPreviewModalImg] = useState(null);

  // Webcam capture state
  const [webcamActive, setWebcamActive] = useState(false);
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);

  const SYNOPSIS_API = `http://${import.meta.env.VITE_API_HOST || window.location.hostname}:8005`;

  const showNotification = (msg, isError = false) => {
    setToast({ text: msg, isError });
    setTimeout(() => setToast(null), 4500);
  };

  const fetchWithFallback = async (endpoint, options = {}) => {
    // Try synopsis service (port 8005) first, then fallback to backend (/api) on port 8000
    try {
      const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis${endpoint}`, options);
      if (res.ok) return res;
    } catch (e) {
      // ignore and fallback
    }
    return await fetch(`/api${endpoint}`, options);
  };

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const res = await fetchWithFallback("/employees");
      if (!res.ok) throw new Error("Failed to load employee directory");
      const data = await res.json();
      setEmployees(data || []);
    } catch (err) {
      console.error(err);
      showNotification("Could not connect to biometric employee database", true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const handleOpenAdd = () => {
    setFormData({
      name: "",
      email: "",
      department: "General",
      status: "authorised",
    });
    setPhotoFile(null);
    setPhotoPreview(null);
    stopWebcam();
    setShowAddModal(true);
  };

  const handleOpenEdit = (emp) => {
    setSelectedEmp(emp);
    setFormData({
      name: emp.name || "",
      email: emp.email || "",
      department: emp.department || "General",
      status: (emp.status || "authorised").toLowerCase(),
    });
    setPhotoFile(null);
    setPhotoPreview(
      emp.photo_url
        ? `${SYNOPSIS_API}/a1/v1/synopsis${emp.photo_url.startsWith("/") ? "" : "/"}${emp.photo_url}`
        : null
    );
    stopWebcam();
    setShowEditModal(true);
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
      stopWebcam();
    }
  };

  // Webcam capture helpers
  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 480 } });
      mediaStreamRef.current = stream;
      setWebcamActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.error("Camera access error:", err);
      showNotification("Cannot access webcam for photo capture.", true);
    }
  };

  const stopWebcam = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setWebcamActive(false);
  };

  const captureWebcamSnapshot = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 480;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `capture_${Date.now()}.jpg`, { type: "image/jpeg" });
        setPhotoFile(file);
        setPhotoPreview(URL.createObjectURL(blob));
        stopWebcam();
      }
    }, "image/jpeg", 0.92);
  };

  // Create Employee
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      showNotification("Employee name is required.", true);
      return;
    }

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("name", formData.name.trim());
      form.append("email", formData.email.trim());
      form.append("department", formData.department.trim());
      form.append("status", formData.status);
      if (photoFile) {
        form.append("photo", photoFile);
      }

      const res = await fetchWithFallback("/employees", {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to create employee");
      }

      showNotification(`Employee ${data.name} added successfully with clearance: ${data.status}!`);
      setShowAddModal(false);
      fetchEmployees();
    } catch (err) {
      console.error(err);
      showNotification(err.message || "Failed to add employee.", true);
    } finally {
      setSubmitting(false);
      stopWebcam();
    }
  };

  // Update Employee
  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedEmp) return;
    if (!formData.name.trim()) {
      showNotification("Employee name cannot be blank.", true);
      return;
    }

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("name", formData.name.trim());
      form.append("email", formData.email.trim());
      form.append("department", formData.department.trim());
      form.append("status", formData.status);
      if (photoFile) {
        form.append("photo", photoFile);
      }

      const res = await fetchWithFallback(`/employees/${selectedEmp.emp_id}`, {
        method: "PUT",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to update employee");
      }

      showNotification(`Employee ${data.name} updated successfully.`);
      setShowEditModal(false);
      fetchEmployees();
    } catch (err) {
      console.error(err);
      showNotification(err.message || "Failed to update employee.", true);
    } finally {
      setSubmitting(false);
      stopWebcam();
    }
  };

  // Quick toggle status between authorised and suspended directly in list
  const handleToggleStatus = async (emp) => {
    const newStatus = (emp.status || "").toLowerCase() === "authorised" ? "suspended" : "authorised";
    try {
      const form = new FormData();
      form.append("status", newStatus);
      const res = await fetchWithFallback(`/employees/${emp.emp_id}`, {
        method: "PUT",
        body: form,
      });
      if (res.ok) {
        setEmployees((prev) =>
          prev.map((e) => (e.emp_id === emp.emp_id ? { ...e, status: newStatus } : e))
        );
        showNotification(
          `${emp.name} is now ${newStatus.toUpperCase()}`
        );
      }
    } catch (e) {
      console.error(e);
      showNotification("Failed to toggle employee clearance status", true);
    }
  };

  // Delete Employee
  const handleDeleteConfirm = async () => {
    if (!selectedEmp) return;
    setSubmitting(true);
    try {
      const res = await fetchWithFallback(`/employees/${selectedEmp.emp_id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete employee");
      showNotification(`Employee ${selectedEmp.name} removed from database.`);
      setShowDeleteModal(false);
      setSelectedEmp(null);
      fetchEmployees();
    } catch (err) {
      console.error(err);
      showNotification(err.message || "Failed to delete employee", true);
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered employees list
  const filteredEmployees = employees.filter((emp) => {
    const q = searchQuery.toLowerCase().trim();
    const matchSearch =
      !q ||
      (emp.name && emp.name.toLowerCase().includes(q)) ||
      (emp.email && emp.email.toLowerCase().includes(q)) ||
      (emp.department && emp.department.toLowerCase().includes(q));

    const empStatus = (emp.status || "authorised").toLowerCase();
    const matchStatus =
      statusFilter === "all" ||
      (statusFilter === "authorised" && empStatus === "authorised") ||
      (statusFilter === "suspended" && empStatus === "suspended");

    return matchSearch && matchStatus;
  });

  const totalCount = employees.length;
  const authorisedCount = employees.filter((e) => (e.status || "").toLowerCase() === "authorised").length;
  const suspendedCount = employees.filter((e) => (e.status || "").toLowerCase() === "suspended").length;
  const biometricCount = employees.filter((e) => e.has_face_embedding).length;

  return (
    <div className="emp-page">
      {/* Toast Notification */}
      {toast && (
        <div className={`emp-toast ${toast.isError ? "error" : ""}`}>
          <span className="material-icons-outlined" style={{ color: toast.isError ? "#ef4444" : "var(--teal)" }}>
            {toast.isError ? "error_outline" : "verified"}
          </span>
          <span style={{ fontSize: "0.88rem", fontWeight: 500, flex: 1 }}>{toast.text}</span>
          <button
            onClick={() => setToast(null)}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}
          >
            <span className="material-icons-outlined" style={{ fontSize: "1.1rem" }}>close</span>
          </button>
        </div>
      )}

      {/* Header */}
      <header className="emp-header">
        <div className="emp-title-wrap">
          <div className="emp-header-icon">
            <span className="material-icons-outlined" style={{ fontSize: "1.6rem" }}>badge</span>
          </div>
          <div>
            <h2 className="emp-title">Employee Management</h2>
            <p className="emp-subtitle">
              Manage personnel records, department access clearance, and facial biometric enrollment
            </p>
          </div>
        </div>
        <button className="emp-add-btn" onClick={handleOpenAdd}>
          <span className="material-icons-outlined" style={{ fontSize: "1.2rem" }}>person_add</span>
          Add Employee
        </button>
      </header>

      {/* Stat Cards */}
      <div className="emp-stats-grid">
        <div className="emp-stat-card">
          <div className="emp-stat-icon-wrap total">
            <span className="material-icons-outlined">groups</span>
          </div>
          <div className="emp-stat-info">
            <span className="emp-stat-value">{totalCount}</span>
            <span className="emp-stat-label">Total Personnel</span>
          </div>
        </div>

        <div className="emp-stat-card">
          <div className="emp-stat-icon-wrap authorised">
            <span className="material-icons-outlined">check_circle</span>
          </div>
          <div className="emp-stat-info">
            <span className="emp-stat-value">{authorisedCount}</span>
            <span className="emp-stat-label">Authorised Active</span>
          </div>
        </div>

        <div className="emp-stat-card">
          <div className="emp-stat-icon-wrap suspended">
            <span className="material-icons-outlined">gpp_bad</span>
          </div>
          <div className="emp-stat-info">
            <span className="emp-stat-value">{suspendedCount}</span>
            <span className="emp-stat-label">Suspended</span>
          </div>
        </div>

        <div className="emp-stat-card">
          <div className="emp-stat-icon-wrap biometric">
            <span className="material-icons-outlined">face</span>
          </div>
          <div className="emp-stat-info">
            <span className="emp-stat-value">{biometricCount}</span>
            <span className="emp-stat-label">Facial Biometric Enrolled</span>
          </div>
        </div>
      </div>

      {/* Main Panel */}
      <div className="emp-panel">
        <div className="emp-toolbar">
          <div className="emp-search-wrap">
            <span className="material-icons-outlined emp-search-icon" style={{ fontSize: "1.15rem" }}>search</span>
            <input
              type="text"
              className="emp-search-input"
              placeholder="Search by name, email, or department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="emp-filters">
            <button
              className={`emp-filter-pill ${statusFilter === "all" ? "active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              All ({totalCount})
            </button>
            <button
              className={`emp-filter-pill ${statusFilter === "authorised" ? "active" : ""}`}
              onClick={() => setStatusFilter("authorised")}
            >
              ✓ Authorised ({authorisedCount})
            </button>
            <button
              className={`emp-filter-pill ${statusFilter === "suspended" ? "active" : ""}`}
              onClick={() => setStatusFilter("suspended")}
            >
              ⚠ Suspended ({suspendedCount})
            </button>
          </div>
        </div>

        {/* Employees Table */}
        <div className="emp-table-container">
          {loading ? (
            <div className="emp-empty-state">
              <span className="spinner" style={{ width: "32px", height: "32px", marginBottom: "12px" }}></span>
              <p>Loading employee directory...</p>
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="emp-empty-state">
              <span className="material-icons-outlined emp-empty-icon">person_off</span>
              <p style={{ fontWeight: 600, fontSize: "1rem", margin: 0, color: "var(--text-primary)" }}>
                {searchQuery || statusFilter !== "all"
                  ? "No matching employees found"
                  : "No employees registered in the system"}
              </p>
              <p style={{ fontSize: "0.85rem", marginTop: "4px" }}>
                {searchQuery || statusFilter !== "all"
                  ? "Try adjusting your search criteria or filter."
                  : "Click 'Add Employee' to enroll company personnel into the database."}
              </p>
            </div>
          ) : (
            <table className="emp-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Clearance Status</th>
                  <th>Biometric Face Enrollment</th>
                  <th>Registered</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((emp) => {
                  const isAuth = (emp.status || "").toLowerCase() === "authorised";
                  const photoSrc = emp.photo_url
                    ? (emp.photo_url.startsWith("http")
                        ? emp.photo_url
                        : emp.photo_url.startsWith("/api")
                          ? emp.photo_url
                          : `${SYNOPSIS_API}/a1/v1/synopsis${emp.photo_url.startsWith("/") ? "" : "/"}${emp.photo_url}`)
                    : null;
                  const initials = (emp.name || "?")
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();

                  return (
                    <tr key={emp.emp_id}>
                      <td>
                        <div className="emp-person-cell">
                          {photoSrc ? (
                            <img
                              src={photoSrc}
                              alt={emp.name}
                              className="emp-avatar"
                              onClick={() => setPreviewModalImg({ url: photoSrc, name: emp.name })}
                              title="Click to preview biometric photo"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="emp-avatar-placeholder" title="No biometric photo enrolled">
                              {initials}
                            </div>
                          )}
                          <div>
                            <span className="emp-name-text">{emp.name}</span>
                            <span className="emp-email-text">{emp.email || "No email provided"}</span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <span className="emp-dept-badge">
                          <span className="material-icons-outlined" style={{ fontSize: "0.9rem", marginRight: "4px" }}>domain</span>
                          {emp.department || "General"}
                        </span>
                      </td>

                      <td>
                        <div
                          className={`emp-status-badge ${isAuth ? "authorised" : "suspended"}`}
                          onClick={() => handleToggleStatus(emp)}
                          title="Click to toggle status (Authorised ↔ Suspended)"
                        >
                          <span className="emp-status-dot"></span>
                          <span>{isAuth ? "Authorised" : "Suspended"}</span>
                        </div>
                      </td>

                      <td>
                        {emp.has_face_embedding ? (
                          <span className="emp-bio-badge enrolled" title="YuNet and SFace feature vectors enrolled">
                            <span className="material-icons-outlined" style={{ fontSize: "1rem" }}>face</span>
                            Enrolled
                          </span>
                        ) : (
                          <span className="emp-bio-badge none" title="Upload a face photo to enable AI face recognition">
                            <span className="material-icons-outlined" style={{ fontSize: "1rem" }}>no_photography</span>
                            Pending Photo
                          </span>
                        )}
                      </td>

                      <td>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                          {emp.created_at ? new Date(emp.created_at).toLocaleDateString() : "—"}
                        </span>
                      </td>

                      <td>
                        <div className="emp-actions-row" style={{ justifyContent: "flex-end" }}>
                          <button
                            className="emp-action-btn"
                            title="Edit Employee Details"
                            onClick={() => handleOpenEdit(emp)}
                          >
                            <span className="material-icons-outlined" style={{ fontSize: "1.05rem" }}>edit</span>
                          </button>
                          <button
                            className="emp-action-btn delete"
                            title="Delete Employee"
                            onClick={() => {
                              setSelectedEmp(emp);
                              setShowDeleteModal(true);
                            }}
                          >
                            <span className="material-icons-outlined" style={{ fontSize: "1.05rem" }}>delete</span>
                          </button>
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

      {/* ADD EMPLOYEE MODAL */}
      {showAddModal && (
        <div className="emp-modal-overlay" onClick={() => !submitting && setShowAddModal(false)}>
          <div className="emp-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="emp-modal-header">
              <h3 className="emp-modal-title">
                <span className="material-icons-outlined" style={{ color: "var(--teal)" }}>person_add</span>
                Enroll New Employee
              </h3>
              <button
                className="emp-modal-close"
                onClick={() => !submitting && setShowAddModal(false)}
                disabled={submitting}
              >
                <span className="material-icons-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="emp-modal-body">
                <div className="emp-form-group">
                  <label className="emp-form-label">
                    Full Name <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="emp-form-input"
                    placeholder="e.g. John Doe"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Email Address</label>
                  <input
                    type="email"
                    className="emp-form-input"
                    placeholder="e.g. john.doe@company.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Department</label>
                  <select
                    className="emp-form-select"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  >
                    <option value="General">General</option>
                    <option value="Security">Security</option>
                    <option value="IT & Infrastructure">IT & Infrastructure</option>
                    <option value="Engineering">Engineering</option>
                    <option value="Operations">Operations</option>
                    <option value="Management">Management</option>
                    <option value="Human Resources">Human Resources</option>
                    <option value="Finance">Finance</option>
                  </select>
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Clearance Status</label>
                  <div className="emp-status-selector">
                    <label
                      className={`emp-status-option authorised ${formData.status === "authorised" ? "active" : ""}`}
                    >
                      <input
                        type="radio"
                        name="add_status"
                        value="authorised"
                        checked={formData.status === "authorised"}
                        onChange={() => setFormData({ ...formData, status: "authorised" })}
                      />
                      <div>
                        <div style={{ fontWeight: 600, color: "#10b981", fontSize: "0.86rem" }}>Authorised</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>Access Granted</div>
                      </div>
                    </label>

                    <label
                      className={`emp-status-option suspended ${formData.status === "suspended" ? "active" : ""}`}
                    >
                      <input
                        type="radio"
                        name="add_status"
                        value="suspended"
                        checked={formData.status === "suspended"}
                        onChange={() => setFormData({ ...formData, status: "suspended" })}
                      />
                      <div>
                        <div style={{ fontWeight: 600, color: "#f59e0b", fontSize: "0.86rem" }}>Suspended</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>Access Suspended</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Facial Photo Enrollment */}
                <div className="emp-form-group">
                  <label className="emp-form-label">
                    <span className="material-icons-outlined" style={{ fontSize: "1rem", color: "var(--teal)" }}>face</span>
                    Biometric Facial Enrollment Photo
                  </label>

                  {webcamActive ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{ width: "100%", maxHeight: "240px", borderRadius: "10px", background: "#000" }}
                      />
                      <div style={{ display: "flex", gap: "10px" }}>
                        <button
                          type="button"
                          className="emp-btn-submit"
                          onClick={captureWebcamSnapshot}
                        >
                          <span className="material-icons-outlined">camera</span> Capture Photo
                        </button>
                        <button
                          type="button"
                          className="emp-btn-cancel"
                          onClick={stopWebcam}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : photoPreview ? (
                    <div className="emp-photo-preview-wrap">
                      <img src={photoPreview} alt="Preview" className="emp-photo-preview-img" />
                      <div className="emp-photo-preview-meta">
                        <span className="emp-photo-chip">
                          <span className="material-icons-outlined" style={{ fontSize: "0.9rem" }}>check</span>
                          Photo Ready for Face Enrollment
                        </span>
                        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                          <label
                            htmlFor="emp-photo-input-add"
                            className="emp-btn-cancel"
                            style={{ padding: "4px 10px", fontSize: "0.75rem", cursor: "pointer" }}
                          >
                            Change Photo
                          </label>
                          <button
                            type="button"
                            className="emp-btn-cancel"
                            onClick={() => {
                              setPhotoFile(null);
                              setPhotoPreview(null);
                            }}
                            style={{ padding: "4px 10px", fontSize: "0.75rem", color: "#ef4444" }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="emp-photo-dropzone">
                      <label htmlFor="emp-photo-input-add" style={{ cursor: "pointer", width: "100%" }}>
                        <span className="material-icons-outlined" style={{ fontSize: "2.4rem", color: "var(--teal)", marginBottom: "6px" }}>
                          add_a_photo
                        </span>
                        <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--text-primary)" }}>
                          Upload Frontal Face Photo
                        </div>
                        <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                          JPEG or PNG. YuNet will automatically detect and align face features.
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={startWebcam}
                        className="emp-btn-cancel"
                        style={{ marginTop: "10px", display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", padding: "5px 12px" }}
                      >
                        <span className="material-icons-outlined" style={{ fontSize: "1rem" }}>videocam</span>
                        Capture via Webcam
                      </button>
                    </div>
                  )}

                  <input
                    id="emp-photo-input-add"
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoSelect}
                    style={{ display: "none" }}
                  />
                </div>
              </div>

              <div className="emp-modal-footer">
                <button
                  type="button"
                  className="emp-btn-cancel"
                  onClick={() => setShowAddModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="emp-btn-submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <span className="spinner"></span> Enrolling...
                    </>
                  ) : (
                    <>
                      <span className="material-icons-outlined" style={{ fontSize: "1.1rem" }}>save</span>
                      Save Employee
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT EMPLOYEE MODAL */}
      {showEditModal && selectedEmp && (
        <div className="emp-modal-overlay" onClick={() => !submitting && setShowEditModal(false)}>
          <div className="emp-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="emp-modal-header">
              <h3 className="emp-modal-title">
                <span className="material-icons-outlined" style={{ color: "var(--teal)" }}>edit</span>
                Edit Employee Details
              </h3>
              <button
                className="emp-modal-close"
                onClick={() => !submitting && setShowEditModal(false)}
                disabled={submitting}
              >
                <span className="material-icons-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleUpdateSubmit}>
              <div className="emp-modal-body">
                <div className="emp-form-group">
                  <label className="emp-form-label">
                    Full Name <span className="required">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    className="emp-form-input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Email Address</label>
                  <input
                    type="email"
                    className="emp-form-input"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Department</label>
                  <select
                    className="emp-form-select"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  >
                    <option value="General">General</option>
                    <option value="Security">Security</option>
                    <option value="IT & Infrastructure">IT & Infrastructure</option>
                    <option value="Engineering">Engineering</option>
                    <option value="Operations">Operations</option>
                    <option value="Management">Management</option>
                    <option value="Human Resources">Human Resources</option>
                    <option value="Finance">Finance</option>
                  </select>
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Clearance Status</label>
                  <div className="emp-status-selector">
                    <label
                      className={`emp-status-option authorised ${formData.status === "authorised" ? "active" : ""}`}
                    >
                      <input
                        type="radio"
                        name="edit_status"
                        value="authorised"
                        checked={formData.status === "authorised"}
                        onChange={() => setFormData({ ...formData, status: "authorised" })}
                      />
                      <div>
                        <div style={{ fontWeight: 600, color: "#10b981", fontSize: "0.86rem" }}>Authorised</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>Access Granted</div>
                      </div>
                    </label>

                    <label
                      className={`emp-status-option suspended ${formData.status === "suspended" ? "active" : ""}`}
                    >
                      <input
                        type="radio"
                        name="edit_status"
                        value="suspended"
                        checked={formData.status === "suspended"}
                        onChange={() => setFormData({ ...formData, status: "suspended" })}
                      />
                      <div>
                        <div style={{ fontWeight: 600, color: "#f59e0b", fontSize: "0.86rem" }}>Suspended</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>Access Blocked</div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Facial Photo Enrollment */}
                <div className="emp-form-group">
                  <label className="emp-form-label">
                    <span className="material-icons-outlined" style={{ fontSize: "1rem", color: "var(--teal)" }}>face</span>
                    Biometric Facial Enrollment Photo
                  </label>

                  {webcamActive ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        style={{ width: "100%", maxHeight: "240px", borderRadius: "10px", background: "#000" }}
                      />
                      <div style={{ display: "flex", gap: "10px" }}>
                        <button
                          type="button"
                          className="emp-btn-submit"
                          onClick={captureWebcamSnapshot}
                        >
                          <span className="material-icons-outlined">camera</span> Capture Photo
                        </button>
                        <button
                          type="button"
                          className="emp-btn-cancel"
                          onClick={stopWebcam}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : photoPreview ? (
                    <div className="emp-photo-preview-wrap">
                      <img src={photoPreview} alt="Preview" className="emp-photo-preview-img" />
                      <div className="emp-photo-preview-meta">
                        <span className="emp-photo-chip">
                          <span className="material-icons-outlined" style={{ fontSize: "0.9rem" }}>check</span>
                          Enrolled Photo
                        </span>
                        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                          <label
                            htmlFor="emp-photo-input-edit"
                            className="emp-btn-cancel"
                            style={{ padding: "4px 10px", fontSize: "0.75rem", cursor: "pointer" }}
                          >
                            Replace Photo
                          </label>
                          <button
                            type="button"
                            onClick={startWebcam}
                            className="emp-btn-cancel"
                            style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                          >
                            Webcam
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="emp-photo-dropzone">
                      <label htmlFor="emp-photo-input-edit" style={{ cursor: "pointer", width: "100%" }}>
                        <span className="material-icons-outlined" style={{ fontSize: "2.4rem", color: "var(--teal)", marginBottom: "6px" }}>
                          add_a_photo
                        </span>
                        <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--text-primary)" }}>
                          Upload Frontal Face Photo
                        </div>
                        <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                          JPEG or PNG. YuNet will automatically detect and align face features.
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={startWebcam}
                        className="emp-btn-cancel"
                        style={{ marginTop: "10px", display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", padding: "5px 12px" }}
                      >
                        <span className="material-icons-outlined" style={{ fontSize: "1rem" }}>videocam</span>
                        Capture via Webcam
                      </button>
                    </div>
                  )}

                  <input
                    id="emp-photo-input-edit"
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoSelect}
                    style={{ display: "none" }}
                  />
                </div>
              </div>

              <div className="emp-modal-footer">
                <button
                  type="button"
                  className="emp-btn-cancel"
                  onClick={() => setShowEditModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button type="submit" className="emp-btn-submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <span className="spinner"></span> Updating...
                    </>
                  ) : (
                    <>
                      <span className="material-icons-outlined" style={{ fontSize: "1.1rem" }}>save</span>
                      Update Employee
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {showDeleteModal && selectedEmp && (
        <div className="emp-modal-overlay" onClick={() => !submitting && setShowDeleteModal(false)}>
          <div className="emp-modal-card" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
            <div className="emp-modal-header">
              <h3 className="emp-modal-title" style={{ color: "#ef4444" }}>
                <span className="material-icons-outlined" style={{ color: "#ef4444" }}>warning</span>
                Delete Employee
              </h3>
              <button
                className="emp-modal-close"
                onClick={() => !submitting && setShowDeleteModal(false)}
                disabled={submitting}
              >
                <span className="material-icons-outlined">close</span>
              </button>
            </div>
            <div className="emp-modal-body">
              <p style={{ margin: 0, fontSize: "0.92rem", color: "var(--text-primary)", lineHeight: 1.5 }}>
                Are you sure you want to delete <strong>{selectedEmp.name}</strong> from the employee database?
              </p>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                This will delete their record and all enrolled facial biometric vectors. Any future detections of this person will be classified as <strong>Unauthorised</strong>.
              </p>
            </div>
            <div className="emp-modal-footer">
              <button
                type="button"
                className="emp-btn-cancel"
                onClick={() => setShowDeleteModal(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="emp-btn-danger"
                onClick={handleDeleteConfirm}
                disabled={submitting}
              >
                {submitting ? "Deleting..." : "Delete Employee"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PHOTO PREVIEW MODAL */}
      {previewModalImg && (
        <div className="emp-modal-overlay" onClick={() => setPreviewModalImg(null)}>
          <div
            style={{
              background: "var(--bg-surface)",
              borderRadius: "14px",
              padding: "16px",
              maxWidth: "460px",
              boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
              border: "1px solid var(--border)",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{previewModalImg.name}</span>
              <button
                onClick={() => setPreviewModalImg(null)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex" }}
              >
                <span className="material-icons-outlined">close</span>
              </button>
            </div>
            <img
              src={previewModalImg.url}
              alt={previewModalImg.name}
              style={{ width: "100%", maxHeight: "360px", objectFit: "contain", borderRadius: "8px" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
