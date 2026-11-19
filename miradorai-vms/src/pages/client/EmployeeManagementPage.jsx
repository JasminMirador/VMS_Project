import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Users,
  UserPlus,
  UserCheck,
  UserX,
  Search,
  X,
  Camera,
  Upload,
  Trash2,
  Edit3,
  Eye,
  RefreshCw,
  Building2,
  Mail,
  Calendar,
  Check,
  AlertCircle,
  CheckCircle2,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Lock,
  Unlock,
  Save,
  Plus,
} from "lucide-react";
import { apiUrl, synopsisUrl } from "../../config/appConfig";
import "./EmployeeManagementPage.css";

const DEPARTMENTS = [
  "Backend",
  "Frontend",
  "Software Testing",
  "Admin",
  "IT",
  "Internship",
  "AIML",
  "Devops",
  "Software Engineer",
];

function getAuthHeaders() {
  const token =
    localStorage.getItem("miradorai_token") ||
    sessionStorage.getItem("miradorai_token");
  return token
    ? {
        Authorization: "Bearer " + token,
      }
    : {};
}

export default function EmployeeManagementPage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState("table"); // "table" | "grid"
  const [toast, setToast] = useState(null);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    department: DEPARTMENTS[0],
    status: "authorised",
  });

  // Photos state: array of { file, preview, isExisting, url }
  const [photos, setPhotos] = useState([]);

  // Gallery lightbox modal state
  const [galleryEmp, setGalleryEmp] = useState(null);
  const [activeGalleryIdx, setActiveGalleryIdx] = useState(0);

  const fileInputRef = useRef(null);

  const SYNOPSIS_API =
    window.__ENV__?.SYNOPSIS_BASE_URL ||
    `${window.location.protocol}//${window.location.hostname}:8005`;

  const showNotification = (msg, isError = false) => {
    setToast({ text: msg, isError });
    setTimeout(() => setToast(null), 4000);
  };

  // Convert raw photo URL to full usable URL
  const getFullPhotoUrl = (url) => {
    if (!url) return null;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("blob:") || url.startsWith("data:")) return url;
    if (url.startsWith("/api")) return url;

    // Static employee face images are served directly by synopsis service
    return `${SYNOPSIS_API}/a1/v1/synopsis${url.startsWith("/") ? "" : "/"}${url}`;
  };

  // Fetch with fallback between synopsis service & backend
  const fetchWithFallback = async (endpoint, options = {}) => {
    try {
      const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis${endpoint}`, options);
      if (res.ok) return res;
    } catch (e) {
      // fallback
    }

    return await fetch(`/api${endpoint}`, {
      ...options,
      headers: {
        ...getAuthHeaders(),
        ...(options.headers || {}),
      },
    });
  };

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const res = await fetchWithFallback("/employees");
      if (!res.ok) throw new Error("Failed to load employee directory");
      const data = await res.json();
      setEmployees(Array.isArray(data) ? data : data.employees || []);
    } catch (err) {
      console.error("Employee fetch error:", err);
      showNotification("Could not sync with Employee Database.", true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  // Open Add Modal
  const handleOpenAdd = () => {
    setFormData({
      name: "",
      email: "",
      department: DEPARTMENTS[0],
      status: "authorised",
    });
    setPhotos([]);
    setShowAddModal(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (emp) => {
    setSelectedEmp(emp);
    setFormData({
      name: emp.name || "",
      email: emp.email || "",
      department: emp.department || DEPARTMENTS[0],
      status: (emp.status || "authorised").toLowerCase(),
    });

    const urls =
      emp.photo_urls && emp.photo_urls.length > 0
        ? emp.photo_urls
        : emp.photo_url
        ? [emp.photo_url]
        : [];

    const loaded = urls.slice(0, 5).map((u) => ({
      file: null,
      preview: getFullPhotoUrl(u),
      isExisting: true,
      url: u,
    }));

    setPhotos(loaded);
    setShowEditModal(true);
  };

  // Open Gallery Lightbox
  const handleOpenGallery = (emp) => {
    setGalleryEmp(emp);
    setActiveGalleryIdx(0);
  };

  // File Upload Handlers
  const handlePhotoSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setPhotos((prev) => {
      const remaining = 5 - prev.length;
      if (remaining <= 0) return prev;
      const newItems = files.slice(0, remaining).map((file) => ({
        file,
        preview: URL.createObjectURL(file),
        isExisting: false,
      }));
      return [...prev, ...newItems];
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemovePhoto = (idx, e) => {
    e.stopPropagation();
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
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

      const files = photos.filter((p) => p && p.file).map((p) => p.file);
      files.forEach((f) => {
        form.append("photos", f);
      });

      const res = await fetchWithFallback("/employees", {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to enroll employee.");
      }

      showNotification(`Employee ${data.name || formData.name} enrolled successfully.`);
      setShowAddModal(false);
      fetchEmployees();
    } catch (err) {
      console.error(err);
      showNotification(err.message || "Enrollment failed.", true);
    } finally {
      setSubmitting(false);
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

      const keptExistingUrls = photos
        .filter((p) => p && p.isExisting && p.url)
        .map((p) => p.url);
      form.append("existing_photos", JSON.stringify(keptExistingUrls));

      const newFiles = photos.filter((p) => p && p.file).map((p) => p.file);
      newFiles.forEach((f) => {
        form.append("photos", f);
      });

      const res = await fetchWithFallback(`/employees/${selectedEmp.emp_id}`, {
        method: "PUT",
        body: form,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to update employee.");
      }

      showNotification(`Employee ${data.name || formData.name} updated.`);
      setShowEditModal(false);
      fetchEmployees();
    } catch (err) {
      console.error(err);
      showNotification(err.message || "Failed to update employee.", true);
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle Clearance Status (Authorised <-> Suspended)
  const handleToggleStatus = async (emp) => {
    const newStatus =
      (emp.status || "").toLowerCase() === "authorised"
        ? "suspended"
        : "authorised";

    try {
      const form = new FormData();
      form.append("status", newStatus);

      const res = await fetchWithFallback(`/employees/${emp.emp_id}`, {
        method: "PUT",
        body: form,
      });

      if (res.ok) {
        setEmployees((prev) =>
          prev.map((e) =>
            e.emp_id === emp.emp_id ? { ...e, status: newStatus } : e
          )
        );
        showNotification(
          `${emp.name} clearance is now ${newStatus.toUpperCase()}`
        );
      } else {
        throw new Error("Failed to change status");
      }
    } catch (e) {
      console.error(e);
      showNotification("Failed to toggle clearance status.", true);
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

      if (!res.ok) {
        throw new Error("Failed to delete employee record.");
      }

      showNotification(`Employee ${selectedEmp.name} removed from database.`);
      setShowDeleteModal(false);
      setSelectedEmp(null);
      fetchEmployees();
    } catch (err) {
      console.error(err);
      showNotification(err.message || "Failed to delete employee.", true);
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered list
  const filteredEmployees = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return employees.filter((emp) => {
      const nameMatch = emp.name && emp.name.toLowerCase().includes(q);
      const emailMatch = emp.email && emp.email.toLowerCase().includes(q);
      const deptMatch = emp.department && emp.department.toLowerCase().includes(q);
      const idMatch = emp.emp_id && emp.emp_id.toLowerCase().includes(q);
      const searchOk = !q || nameMatch || emailMatch || deptMatch || idMatch;

      const deptOk =
        deptFilter === "all" ||
        (emp.department || "").toLowerCase() === deptFilter.toLowerCase();

      const status = (emp.status || "").toLowerCase();
      const pCount =
        emp.photos_count ||
        (emp.photo_urls ? emp.photo_urls.length : emp.photo_url ? 1 : 0);

      let statusOk = true;
      if (statusFilter === "authorised") statusOk = status === "authorised";
      else if (statusFilter === "suspended") statusOk = status === "suspended";
      else if (statusFilter === "pending_photos") statusOk = pCount === 0;

      return searchOk && deptOk && statusOk;
    });
  }, [employees, searchQuery, deptFilter, statusFilter]);

  // Aggregate Counters
  const totalCount = employees.length;
  const authorisedCount = employees.filter(
    (e) => (e.status || "").toLowerCase() === "authorised"
  ).length;
  const suspendedCount = employees.filter(
    (e) => (e.status || "").toLowerCase() === "suspended"
  ).length;
  const biometricCount = employees.filter(
    (e) =>
      e.has_face_embedding ||
      (e.photos_count && e.photos_count > 0) ||
      (e.photo_urls && e.photo_urls.length > 0) ||
      e.photo_url
  ).length;
  const pendingPhotosCount = totalCount - biometricCount;

  // Render Multi-Photo / Webcam Uploader
  const renderPhotoUploader = () => {
    const canAddMore = photos.length < 5;

    return (
      <div className="emp-photo-section">
        <div className="emp-photo-section-header">
          <label className="emp-form-label" style={{ margin: 0 }}>
            Employee Photos
          </label>
          <span className="emp-photo-counter-text">
            {photos.length} / 5 photos
          </span>
        </div>

        <div className="emp-photos-strip">
          {photos.map((p, idx) => (
            <div
              key={idx}
              className="emp-photo-thumb"
              title={idx === 0 ? "Primary Profile Photo" : `Angle Photo ${idx + 1}`}
            >
              <img src={p.preview} alt={`Employee Photo ${idx + 1}`} />
              {idx === 0 && <span className="emp-photo-primary-badge">PRIMARY</span>}
              <button
                type="button"
                className="emp-photo-del-btn"
                onClick={(e) => handleRemovePhoto(idx, e)}
                title="Remove photo"
              >
                <X size={12} />
              </button>
            </div>
          ))}

          {canAddMore && (
            <div
              className="emp-photo-add-trigger"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              title="Add Photo"
            >
              <Plus size={20} />
              <span className="emp-photo-add-text">Add Photo</span>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handlePhotoSelect}
          style={{ display: "none" }}
        />
      </div>
    );
  };

  return (
    <div className="emp-page">
      {/* Toast Notification */}
      {toast && (
        <div className={`emp-toast ${toast.isError ? "error" : "success"}`}>
          {toast.isError ? (
            <AlertCircle size={18} color="#ef4444" />
          ) : (
            <CheckCircle2 size={18} color="var(--teal)" />
          )}
          <span style={{ flex: 1, fontWeight: 500 }}>{toast.text}</span>
          <button
            onClick={() => setToast(null)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Header */}
      <header className="emp-header">
        <div className="emp-title-wrap">
          <div className="emp-header-icon">
            <Users size={24} />
          </div>
          <div className="emp-title-text">
            <h1>
              Employee <span>Directory</span>
            </h1>
            <p className="emp-subtitle">
              Manage employee records, clearance authorizations, and facial biometric enrollment
            </p>
          </div>
        </div>

        <div className="emp-header-actions">
          <div className="emp-view-toggle">
            <button
              className={`emp-view-btn ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
              title="Table View"
            >
              <List size={16} />
            </button>
            <button
              className={`emp-view-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Grid Cards View"
            >
              <LayoutGrid size={16} />
            </button>
          </div>

          <button
            className="emp-btn-icon"
            onClick={fetchEmployees}
            title="Refresh Directory"
          >
            <RefreshCw size={16} className={loading ? "emp-spinner" : ""} />
          </button>

          <button className="emp-btn-primary" onClick={handleOpenAdd}>
            <UserPlus size={16} />
            Enroll Employee
          </button>
        </div>
      </header>

      {/* Overview Stat Cards */}
      <div className="emp-stats-grid">
        <div className="emp-stat-card">
          <div className="emp-stat-icon-wrap total">
            <Users size={22} />
          </div>
          <div className="emp-stat-info">
            <span className="emp-stat-value">{totalCount}</span>
            <span className="emp-stat-label">Total Employees</span>
          </div>
        </div>

        <div className="emp-stat-card">
          <div className="emp-stat-icon-wrap authorised">
            <ShieldCheck size={22} />
          </div>
          <div className="emp-stat-info">
            <span className="emp-stat-value">{authorisedCount}</span>
            <span className="emp-stat-label">Authorised Active</span>
          </div>
        </div>

        <div className="emp-stat-card">
          <div className="emp-stat-icon-wrap suspended">
            <ShieldAlert size={22} />
          </div>
          <div className="emp-stat-info">
            <span className="emp-stat-value">{suspendedCount}</span>
            <span className="emp-stat-label">Access Suspended</span>
          </div>
        </div>

        <div className="emp-stat-card">
          <div className="emp-stat-icon-wrap biometric">
            <Sparkles size={22} />
          </div>
          <div className="emp-stat-info">
            <span className="emp-stat-value">{biometricCount}</span>
            <span className="emp-stat-label">Biometric Enrolled</span>
          </div>
        </div>
      </div>

      {/* Main Content Panel */}
      <div className="emp-main-panel">
        {/* Toolbar */}
        <div className="emp-toolbar">
          <div className="emp-toolbar-left">
            <div className="emp-search-box">
              <Search size={16} className="emp-search-icon" />
              <input
                type="text"
                className="emp-search-input"
                placeholder="Search by name, email, department, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="emp-search-clear"
                  onClick={() => setSearchQuery("")}
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <select
              className="emp-dept-select"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="all">All Departments</option>
              {DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          <div className="emp-status-tabs">
            <button
              className={`emp-tab-btn ${statusFilter === "all" ? "active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              All <span className="emp-tab-count">{totalCount}</span>
            </button>
            <button
              className={`emp-tab-btn ${statusFilter === "authorised" ? "active" : ""}`}
              onClick={() => setStatusFilter("authorised")}
            >
              Authorised <span className="emp-tab-count">{authorisedCount}</span>
            </button>
            <button
              className={`emp-tab-btn ${statusFilter === "suspended" ? "active" : ""}`}
              onClick={() => setStatusFilter("suspended")}
            >
              Suspended <span className="emp-tab-count">{suspendedCount}</span>
            </button>
            <button
              className={`emp-tab-btn ${statusFilter === "pending_photos" ? "active" : ""}`}
              onClick={() => setStatusFilter("pending_photos")}
            >
              Pending Photos <span className="emp-tab-count">{pendingPhotosCount}</span>
            </button>
          </div>
        </div>

        {/* Content View: Table or Grid */}
        {loading ? (
          <div className="emp-empty-state">
            <div className="emp-spinner" style={{ width: 28, height: 28, marginBottom: 12 }}></div>
            <p>Loading employee directory...</p>
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="emp-empty-state">
            <div className="emp-empty-icon">
              <UserX size={26} />
            </div>
            <h3 style={{ margin: "0 0 6px 0", color: "var(--text-primary)" }}>
              No employees found
            </h3>
            <p style={{ margin: 0, fontSize: "13px" }}>
              {searchQuery || deptFilter !== "all" || statusFilter !== "all"
                ? "Try adjusting your search criteria or clearing active filters."
                : "No employees enrolled yet. Click 'Enroll Employee' to get started."}
            </p>
          </div>
        ) : viewMode === "table" ? (
          <div className="emp-table-wrap">
            <table className="emp-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Clearance</th>
                  <th>Facial Biometrics</th>
                  <th>Registered</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((emp) => {
                  const isAuth = (emp.status || "").toLowerCase() === "authorised";
                  const primaryPhoto =
                    emp.photo_url || (emp.photo_urls && emp.photo_urls[0]);
                  const photoSrc = getFullPhotoUrl(primaryPhoto);
                  const pCount =
                    emp.photos_count ||
                    (emp.photo_urls
                      ? emp.photo_urls.length
                      : emp.photo_url
                      ? 1
                      : 0);
                  const hasPhotos = Boolean(
                    emp.has_face_embedding || pCount > 0 || primaryPhoto
                  );

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
                          <div
                            className="emp-avatar-wrap"
                            onClick={() => hasPhotos && handleOpenGallery(emp)}
                            title={
                              hasPhotos
                                ? "Click to view photo gallery"
                                : "No photo enrolled"
                            }
                          >
                            {photoSrc ? (
                              <img
                                src={photoSrc}
                                alt={emp.name}
                                className="emp-avatar-img"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                  const fallback = e.currentTarget.parentElement?.querySelector(".emp-avatar-placeholder");
                                  if (fallback) fallback.style.display = "flex";
                                }}
                              />
                            ) : null}
                            <div
                              className="emp-avatar-placeholder"
                              style={{ display: photoSrc ? "none" : "flex" }}
                            >
                              {initials}
                            </div>
                          </div>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span className="emp-name-text">{emp.name}</span>
                              {pCount > 1 && (
                                <span
                                  className="emp-photos-count-pill"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenGallery(emp);
                                  }}
                                  title={`${pCount} photos enrolled. Click to view.`}
                                >
                                  📷 {pCount}
                                </span>
                              )}
                            </div>
                            <div className="emp-id-subtext">
                              {emp.emp_id || "EMP-LOCAL"}
                            </div>
                            {emp.email && (
                              <div className="emp-email-text">{emp.email}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td>
                        <span className="emp-dept-pill">
                          <Building2 size={13} />
                          {emp.department || "General"}
                        </span>
                      </td>

                      <td>
                        <div
                          className={`emp-clearance-pill ${
                            isAuth ? "authorised" : "suspended"
                          }`}
                          onClick={() => handleToggleStatus(emp)}
                          title={`Status: ${
                            isAuth ? "Authorised" : "Suspended"
                          }. Click to toggle.`}
                        >
                          <span className="emp-status-dot"></span>
                          <span>{isAuth ? "Authorised" : "Suspended"}</span>
                        </div>
                      </td>

                      <td>
                        {hasPhotos ? (
                          <span
                            className="emp-bio-pill enrolled"
                            onClick={() => handleOpenGallery(emp)}
                            title="Click to view enrolled face photos"
                          >
                            <Camera size={13} />
                            Enrolled ({pCount || 1})
                          </span>
                        ) : (
                          <span className="emp-bio-pill pending">
                            <AlertCircle size={13} />
                            No Photos
                          </span>
                        )}
                      </td>

                      <td>
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          {emp.created_at
                            ? new Date(emp.created_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </span>
                      </td>

                      <td>
                        <div className="emp-actions-cell">
                          {hasPhotos && (
                            <button
                              className="emp-action-btn gallery"
                              onClick={() => handleOpenGallery(emp)}
                              title="View Enrolled Photos"
                            >
                              <Eye size={15} />
                            </button>
                          )}
                          <button
                            className="emp-action-btn toggle"
                            onClick={() => handleToggleStatus(emp)}
                            title={
                              isAuth
                                ? "Suspend Access Clearance"
                                : "Grant Authorised Clearance"
                            }
                          >
                            {isAuth ? <Lock size={15} /> : <Unlock size={15} />}
                          </button>
                          <button
                            className="emp-action-btn"
                            onClick={() => handleOpenEdit(emp)}
                            title="Edit Employee Profile"
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            className="emp-action-btn delete"
                            onClick={() => {
                              setSelectedEmp(emp);
                              setShowDeleteModal(true);
                            }}
                            title="Delete Employee Record"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Grid View */
          <div className="emp-grid-wrap">
            {filteredEmployees.map((emp) => {
              const isAuth = (emp.status || "").toLowerCase() === "authorised";
              const primaryPhoto =
                emp.photo_url || (emp.photo_urls && emp.photo_urls[0]);
              const photoSrc = getFullPhotoUrl(primaryPhoto);
              const pCount =
                emp.photos_count ||
                (emp.photo_urls ? emp.photo_urls.length : emp.photo_url ? 1 : 0);
              const hasPhotos = Boolean(
                emp.has_face_embedding || pCount > 0 || primaryPhoto
              );

              const initials = (emp.name || "?")
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase();

              return (
                <div key={emp.emp_id} className="emp-card">
                  <div className="emp-card-top">
                    <div
                      className="emp-avatar-wrap"
                      onClick={() => hasPhotos && handleOpenGallery(emp)}
                      title={hasPhotos ? "Click to view photo gallery" : "No photo"}
                    >
                      {photoSrc ? (
                        <img
                          src={photoSrc}
                          alt={emp.name}
                          className="emp-card-avatar"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                            const fallback = e.currentTarget.parentElement?.querySelector(".emp-card-avatar-placeholder");
                            if (fallback) fallback.style.display = "flex";
                          }}
                        />
                      ) : null}
                      <div
                        className="emp-card-avatar-placeholder"
                        style={{ display: photoSrc ? "none" : "flex" }}
                      >
                        {initials}
                      </div>
                    </div>

                    <div className="emp-card-meta">
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span className="emp-card-name">{emp.name}</span>
                        {pCount > 1 && (
                          <span
                            className="emp-photos-count-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenGallery(emp);
                            }}
                          >
                            📷 {pCount}
                          </span>
                        )}
                      </div>
                      <div className="emp-id-subtext">
                        {emp.emp_id || "EMP-LOCAL"}
                      </div>
                      <div className="emp-card-email">
                        {emp.email || "No email on file"}
                      </div>
                    </div>
                  </div>

                  <div className="emp-card-pills">
                    <span className="emp-dept-pill">
                      <Building2 size={13} />
                      {emp.department || "General"}
                    </span>

                    <div
                      className={`emp-clearance-pill ${
                        isAuth ? "authorised" : "suspended"
                      }`}
                      onClick={() => handleToggleStatus(emp)}
                      title="Click to toggle clearance"
                    >
                      <span className="emp-status-dot"></span>
                      <span>{isAuth ? "Authorised" : "Suspended"}</span>
                    </div>

                    {hasPhotos ? (
                      <span
                        className="emp-bio-pill enrolled"
                        onClick={() => handleOpenGallery(emp)}
                      >
                        <Camera size={13} />
                        {pCount} Photos
                      </span>
                    ) : (
                      <span className="emp-bio-pill pending">
                        <AlertCircle size={13} />
                        No Photos
                      </span>
                    )}
                  </div>

                  <div className="emp-card-footer">
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                      {emp.created_at
                        ? new Date(emp.created_at).toLocaleDateString()
                        : ""}
                    </span>

                    <div className="emp-actions-cell">
                      {hasPhotos && (
                        <button
                          className="emp-action-btn gallery"
                          onClick={() => handleOpenGallery(emp)}
                          title="View Enrolled Photos"
                        >
                          <Eye size={14} />
                        </button>
                      )}
                      <button
                        className="emp-action-btn toggle"
                        onClick={() => handleToggleStatus(emp)}
                        title={isAuth ? "Suspend Access" : "Authorise Access"}
                      >
                        {isAuth ? <Lock size={14} /> : <Unlock size={14} />}
                      </button>
                      <button
                        className="emp-action-btn"
                        onClick={() => handleOpenEdit(emp)}
                        title="Edit Details"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        className="emp-action-btn delete"
                        onClick={() => {
                          setSelectedEmp(emp);
                          setShowDeleteModal(true);
                        }}
                        title="Delete Record"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ENROLL NEW EMPLOYEE MODAL */}
      {showAddModal && (
        <div
          className="emp-modal-overlay"
          onClick={() => !submitting && setShowAddModal(false)}
        >
          <div
            className="emp-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="emp-modal-header">
              <h3 className="emp-modal-title">
                <UserPlus size={18} color="var(--teal, #10b981)" />
                Enroll New Employee
              </h3>
              <button
                className="emp-modal-close"
                onClick={() => !submitting && setShowAddModal(false)}
                disabled={submitting}
              >
                <X size={18} />
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
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                  />
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Email Address</label>
                  <input
                    type="email"
                    className="emp-form-input"
                    placeholder="e.g. john.doe@company.com"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                  />
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Department</label>
                  <select
                    className="emp-form-select"
                    value={formData.department}
                    onChange={(e) =>
                      setFormData({ ...formData, department: e.target.value })
                    }
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Clearance Status</label>
                  <div className="emp-clearance-selector">
                    <div
                      className={`emp-clearance-opt authorised ${
                        formData.status === "authorised" ? "active" : ""
                      }`}
                      onClick={() =>
                        setFormData({ ...formData, status: "authorised" })
                      }
                    >
                      <div
                        className={`emp-radio-circle ${
                          formData.status === "authorised" ? "checked authorised" : ""
                        }`}
                      />
                      <div>
                        <div className="emp-clearance-title authorised">
                          Authorised
                        </div>
                        <div className="emp-clearance-sub">
                          Access Granted
                        </div>
                      </div>
                    </div>

                    <div
                      className={`emp-clearance-opt suspended ${
                        formData.status === "suspended" ? "active" : ""
                      }`}
                      onClick={() =>
                        setFormData({ ...formData, status: "suspended" })
                      }
                    >
                      <div
                        className={`emp-radio-circle ${
                          formData.status === "suspended" ? "checked suspended" : ""
                        }`}
                      />
                      <div>
                        <div className="emp-clearance-title suspended">
                          Suspended
                        </div>
                        <div className="emp-clearance-sub">
                          Access Suspended
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Multi-Angle Photo Enrollment */}
                {renderPhotoUploader()}
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
                <button
                  type="submit"
                  className="emp-btn-submit"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <span className="emp-spinner"></span> Saving...
                    </>
                  ) : (
                    <>
                      <Save size={16} /> Save Employee
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
        <div
          className="emp-modal-overlay"
          onClick={() => !submitting && setShowEditModal(false)}
        >
          <div
            className="emp-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="emp-modal-header">
              <h3 className="emp-modal-title">
                <Edit3 size={18} color="var(--teal, #10b981)" />
                Edit Employee
              </h3>
              <button
                className="emp-modal-close"
                onClick={() => !submitting && setShowEditModal(false)}
                disabled={submitting}
              >
                <X size={18} />
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
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                  />
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Email Address</label>
                  <input
                    type="email"
                    className="emp-form-input"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                  />
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Department</label>
                  <select
                    className="emp-form-select"
                    value={formData.department}
                    onChange={(e) =>
                      setFormData({ ...formData, department: e.target.value })
                    }
                  >
                    {!DEPARTMENTS.includes(formData.department) &&
                      formData.department && (
                        <option value={formData.department}>
                          {formData.department}
                        </option>
                      )}
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="emp-form-group">
                  <label className="emp-form-label">Clearance Status</label>
                  <div className="emp-clearance-selector">
                    <div
                      className={`emp-clearance-opt authorised ${
                        formData.status === "authorised" ? "active" : ""
                      }`}
                      onClick={() =>
                        setFormData({ ...formData, status: "authorised" })
                      }
                    >
                      <div
                        className={`emp-radio-circle ${
                          formData.status === "authorised" ? "checked authorised" : ""
                        }`}
                      />
                      <div>
                        <div className="emp-clearance-title authorised">
                          Authorised
                        </div>
                        <div className="emp-clearance-sub">
                          Access Granted
                        </div>
                      </div>
                    </div>

                    <div
                      className={`emp-clearance-opt suspended ${
                        formData.status === "suspended" ? "active" : ""
                      }`}
                      onClick={() =>
                        setFormData({ ...formData, status: "suspended" })
                      }
                    >
                      <div
                        className={`emp-radio-circle ${
                          formData.status === "suspended" ? "checked suspended" : ""
                        }`}
                      />
                      <div>
                        <div className="emp-clearance-title suspended">
                          Suspended
                        </div>
                        <div className="emp-clearance-sub">
                          Access Suspended
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Multi-Angle Photo Enrollment */}
                {renderPhotoUploader()}
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
                <button
                  type="submit"
                  className="emp-btn-submit"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <span className="emp-spinner"></span> Saving...
                    </>
                  ) : (
                    <>
                      <Save size={16} /> Save Employee
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
        <div
          className="emp-modal-overlay"
          onClick={() => !submitting && setShowDeleteModal(false)}
        >
          <div
            className="emp-modal-card"
            style={{ maxWidth: "440px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="emp-modal-header">
              <h3 className="emp-modal-title" style={{ color: "#ef4444" }}>
                <AlertTriangle size={18} color="#ef4444" />
                Delete Employee Record
              </h3>
              <button
                className="emp-modal-close"
                onClick={() => !submitting && setShowDeleteModal(false)}
                disabled={submitting}
              >
                <X size={18} />
              </button>
            </div>

            <div className="emp-modal-body">
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5 }}>
                Are you sure you want to permanently delete{" "}
                <strong>{selectedEmp.name}</strong> ({selectedEmp.emp_id})?
              </p>
              <div
                style={{
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  borderRadius: "8px",
                  padding: "12px",
                  fontSize: "12px",
                  color: "#fca5a5",
                  lineHeight: 1.4,
                }}
              >
                This action will wipe all enrolled biometric face embeddings. Any
                future camera detection of this individual will be flagged as an{" "}
                <strong>Unauthorised Person</strong> alarm.
              </div>
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

      {/* PHOTO GALLERY LIGHTBOX MODAL */}
      {galleryEmp && (
        <div
          className="emp-modal-overlay"
          onClick={() => setGalleryEmp(null)}
        >
          <div
            className="emp-modal-card"
            style={{ maxWidth: "520px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="emp-modal-header">
              <div>
                <h3 className="emp-modal-title">
                  <ImageIcon size={18} color="var(--brand)" />
                  {galleryEmp.name} - Enrolled Biometrics
                </h3>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: 2 }}>
                  {galleryEmp.department} • {galleryEmp.emp_id} •{" "}
                  <span
                    style={{
                      color:
                        (galleryEmp.status || "").toLowerCase() === "authorised"
                          ? "#10b981"
                          : "#f59e0b",
                      fontWeight: 600,
                    }}
                  >
                    {(galleryEmp.status || "Authorised").toUpperCase()}
                  </span>
                </div>
              </div>
              <button
                className="emp-modal-close"
                onClick={() => setGalleryEmp(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="emp-modal-body">
              {(() => {
                const urls = (
                  galleryEmp.photo_urls && galleryEmp.photo_urls.length > 0
                    ? galleryEmp.photo_urls
                    : [galleryEmp.photo_url]
                ).filter(Boolean);

                const currentPhotoUrl = getFullPhotoUrl(urls[activeGalleryIdx] || urls[0]);

                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div
                      style={{
                        width: "100%",
                        height: "280px",
                        background: "#000000",
                        borderRadius: "10px",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <img
                        src={currentPhotoUrl}
                        alt="Enrolled Face Large"
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          objectFit: "contain",
                        }}
                      />
                    </div>

                    <div className="emp-gallery-grid">
                      {urls.map((u, idx) => {
                        const full = getFullPhotoUrl(u);
                        const isCurrent = idx === activeGalleryIdx;
                        return (
                          <div
                            key={idx}
                            className="emp-gallery-item"
                            style={{
                              borderColor: isCurrent
                                ? "var(--brand)"
                                : "var(--border-light)",
                              cursor: "pointer",
                              opacity: isCurrent ? 1 : 0.65,
                            }}
                            onClick={() => setActiveGalleryIdx(idx)}
                          >
                            <img src={full} alt={`Face angle ${idx + 1}`} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="emp-modal-footer">
              <button
                type="button"
                className="emp-btn-cancel"
                onClick={() => setGalleryEmp(null)}
              >
                Close Gallery
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
