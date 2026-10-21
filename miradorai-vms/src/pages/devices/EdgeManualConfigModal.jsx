import { useState, useRef, useMemo, useEffect } from "react";

const generateCameraId = (index) => {
  const rand = Math.random().toString(36).substring(2, 6);
  return `cam_${Date.now().toString(36)}_${rand}_${index || 1}`;
};

function extractUrls(text) {
  if (!text || typeof text !== "string") return [];
  const tokens = text.split(/[\r\n,;]+/);
  const urls = [];
  for (const token of tokens) {
    const trimmed = token.trim().replace(/^["']|["']$/g, "").trim();
    if (trimmed && /^(rtsp|rtsps|http|https):\/\/.+/i.test(trimmed)) {
      urls.push(trimmed);
    }
  }
  return urls;
}

function validateURL(url) {
  if (!url || typeof url !== "string") return false;
  return extractUrls(url).length > 0;
}

/**
 * Extracts the Edge ID identifier from a camera device document.
 * Checks explicit edge_id, stream_key pattern (<edge_id>_camera_<cam_id>),
 * RTSP URL path, edge_ip, or edge_name.
 */
function extractEdgeIdentifier(d) {
  if (!d) return null;
  // 1. Direct edge_id field (from MongoDB document)
  if (d.edge_id && typeof d.edge_id === "string" && d.edge_id.trim()) {
    return d.edge_id.trim();
  }
  // 2. Stream key prefix: e.g. "pi-site01_camera_cam_mvf8qonm_2" or "mirador2_camera_..."
  if (d.stream_key && typeof d.stream_key === "string") {
    const m = d.stream_key.match(/^([a-zA-Z0-9_\-]+?)(?:_camera_|_cam_|_channel_)/i);
    if (m && m[1]) return m[1].trim();
  }
  // 3. RTSP URL path prefix: e.g. rtsp://.../pi-site01_camera_...
  const url = d.recording_rtsp || d.rtsp_url || "";
  if (url && typeof url === "string") {
    const m = url.match(/\/([a-zA-Z0-9_\-]+?)(?:_camera_|_cam_|_channel_)/i);
    if (m && m[1]) return m[1].trim();
  }
  // 4. Edge IP or custom Edge Name
  if (d.edge_ip && typeof d.edge_ip === "string" && d.edge_ip.trim()) {
    return d.edge_ip.trim();
  }
  if (d.edge_name && typeof d.edge_name === "string" && d.edge_name.trim() && d.edge_name !== "Mirador Edge") {
    return d.edge_name.trim();
  }
  // 5. Fallback for edge sources: first segment before underscore
  if (d.source === "edge" && d.stream_key && typeof d.stream_key === "string") {
    const parts = d.stream_key.split("_");
    if (parts.length > 1 && parts[0].trim()) return parts[0].trim();
  }
  return null;
}

export default function EdgeManualConfigModal({
  apiBase,
  authHeaders,
  existingDevices = [],
  onClose,
  onSaved,
}) {
  const [activeTab, setActiveTab] = useState("edge"); // "edge" | "cameras"
  const [edgeId, setEdgeId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [infoNotice, setInfoNotice] = useState("");

  // Direct fetch fallback in case parent devices state is empty or still loading
  const [internalDevices, setInternalDevices] = useState([]);

  useEffect(() => {
    let active = true;
    const fetchExisting = async () => {
      try {
        const headers = typeof authHeaders === "function" ? authHeaders() : (authHeaders || {});
        const res = await fetch(`${apiBase || ""}/api/cameras`, { headers });
        if (res.ok && active) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : (data?.devices || []);
          if (Array.isArray(list) && list.length > 0) {
            setInternalDevices(list);
          }
        }
      } catch (e) {
        // Fallback silently if offline or network error
      }
    };
    fetchExisting();
    return () => {
      active = false;
    };
  }, [apiBase, authHeaders]);

  // Combine parent existingDevices and internalDevices
  const combinedDevices = useMemo(() => {
    const map = new Map();
    (existingDevices || []).forEach((d) => {
      const k = d.id || d._id || d.stream_key || d.rtsp_url;
      if (k) map.set(k, d);
    });
    (internalDevices || []).forEach((d) => {
      const k = d.id || d._id || d.stream_key || d.rtsp_url;
      if (k && !map.has(k)) {
        map.set(k, d);
      } else if (k) {
        map.set(k, { ...d, ...map.get(k) });
      }
    });
    return Array.from(map.values());
  }, [existingDevices, internalDevices]);

  // ── Sub-modal: "+ Add Camera" pop-up ────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCameraIndex, setEditingCameraIndex] = useState(null);

  // Sub-modal form fields
  const [camName, setCamName] = useState("");
  const [camId, setCamId] = useState("");
  const [camRtspUrl, setCamRtspUrl] = useState("");
  const [camUsername, setCamUsername] = useState("");
  const [camPassword, setCamPassword] = useState("");
  const [camEnabled, setCamEnabled] = useState(true);
  const [showCamPassword, setShowCamPassword] = useState(false);
  const [pendingQueue, setPendingQueue] = useState([]);
  const [modalAlert, setModalAlert] = useState("");

  const urlInputRef = useRef(null);

  // ── Existing Edge Devices Detection ─────────────────────────────────────────
  const existingEdges = useMemo(() => {
    if (!Array.isArray(combinedDevices)) return [];
    const map = new Map();
    combinedDevices.forEach((d) => {
      const edgeIdFound = extractEdgeIdentifier(d);
      if (!edgeIdFound) return;

      const idKey = edgeIdFound.toLowerCase().trim();
      if (!map.has(idKey)) {
        const resolvedDisplayName =
          d.edge_name && d.edge_name !== "Mirador Edge"
            ? d.edge_name
            : edgeIdFound;

        map.set(idKey, {
          edge_id: edgeIdFound,
          display_name: resolvedDisplayName,
          edge_ip: d.edge_ip || "",
          token: d.token || "",
          cameras: [],
        });
      }

      const edge = map.get(idKey);
      if (
        d.edge_name &&
        d.edge_name !== "Mirador Edge" &&
        (!edge.display_name || edge.display_name === edge.edge_id)
      ) {
        edge.display_name = d.edge_name;
      }

      const camId =
        d.camera_id ||
        (d.stream_key
          ? d.stream_key.replace(new RegExp(`^${edgeIdFound}_camera_`, "i"), "")
          : "") ||
        d.id ||
        d._id ||
        `cam_${edge.cameras.length + 1}`;

      const camRtsp = d.rtsp_url || d.recording_rtsp || "";

      // Deduplicate camera streams by rtsp_url or camera_id
      const isDuplicate = edge.cameras.some((c) => {
        if (camRtsp && c.rtsp_url && c.rtsp_url.toLowerCase() === camRtsp.toLowerCase()) return true;
        if (camId && c.camera_id && c.camera_id.toLowerCase() === String(camId).toLowerCase()) return true;
        return false;
      });

      if (!isDuplicate) {
        edge.cameras.push({
          camera_id: camId,
          name: d.name || d.device_name || `Camera ${edge.cameras.length + 1}`,
          rtsp_url: camRtsp,
          username: d.username || "",
          password: d.password || "",
          enabled: d.status !== "Offline" && d.enabled !== false,
        });
      }
    });
    return Array.from(map.values());
  }, [combinedDevices]);

  // Check if current Edge ID matches any already-registered edge device
  const matchedExistingEdge = useMemo(() => {
    const trimmed = edgeId.trim().toLowerCase();
    if (!trimmed) return null;
    return (
      existingEdges.find(
        (e) =>
          (e.edge_id && e.edge_id.toLowerCase() === trimmed) ||
          (e.edge_ip && e.edge_ip.toLowerCase() === trimmed) ||
          (e.display_name && e.display_name.toLowerCase() === trimmed)
      ) || null
    );
  }, [edgeId, existingEdges]);

  // Handle auto-populating details from matched edge
  const handleLoadExistingEdge = async () => {
    if (!matchedExistingEdge) return;
    setError("");
    setInfoNotice("");

    // Try backend config first for exact camera records & token
    try {
      const res = await fetch(
        `${apiBase}/api/edge-config/${encodeURIComponent(edgeId.trim())}`,
        { headers: authHeaders() }
      );
      if (res.ok) {
        const data = await res.json();
        if (data && data.display_name) {
          setDisplayName(data.display_name);
          if (data.token) setToken(data.token);
          if (Array.isArray(data.cameras) && data.cameras.length > 0) {
            setCameras(
              data.cameras.map((c) => ({
                camera_id: c.camera_id || generateCameraId(),
                name: c.name || "Camera",
                rtsp_url: c.rtsp_url || "",
                username: c.username || "",
                password: c.password || "",
                enabled: c.enabled !== false,
              }))
            );
            setInfoNotice(
              `Loaded ${data.cameras.length} camera(s) and settings from server for "${data.display_name}".`
            );
            return;
          }
        }
      }
    } catch (e) {
      // fallback to frontend cached data
    }

    if (matchedExistingEdge.display_name) {
      setDisplayName(matchedExistingEdge.display_name);
    }
    if (matchedExistingEdge.cameras?.length > 0) {
      setCameras(matchedExistingEdge.cameras);
      setInfoNotice(
        `Loaded ${matchedExistingEdge.cameras.length} camera(s) from "${matchedExistingEdge.display_name}".`
      );
    }
  };

  // Generate a distinct new Edge ID if user wants a separate device
  const handleSuggestNewId = () => {
    const base = edgeId.trim().replace(/[-_]\d+$/, "") || "edge";
    let counter = 2;
    let candidate = `${base}-${counter}`;
    while (
      existingEdges.some(
        (e) => (e.edge_id || "").toLowerCase() === candidate.toLowerCase()
      )
    ) {
      counter++;
      candidate = `${base}-${counter}`;
    }
    setEdgeId(candidate);
    setError("");
    setInfoNotice("");
  };

  const isEdgeValid =
    edgeId.trim() !== "" && displayName.trim() !== "" && token.trim().length >= 24;

  const validateEdge = () => {
    setError("");
    if (!edgeId.trim()) {
      setError("Please enter an Edge ID (e.g. pi-site01).");
      return false;
    }
    if (!displayName.trim()) {
      setError("Please enter a Display Name for this Edge device.");
      return false;
    }
    if (token.trim().length < 24) {
      setError("Edge token must be at least 24 characters long.");
      return false;
    }
    return true;
  };

  const handleNextToCameras = () => {
    if (validateEdge()) {
      setActiveTab("cameras");
      setError("");
    }
  };

  const handleTabClick = (tab) => {
    if (tab === "cameras") {
      if (validateEdge()) {
        setActiveTab("cameras");
        setError("");
      }
    } else {
      setActiveTab("edge");
      setError("");
    }
  };

  // ── Sub-modal Handlers (Stream URL-style popup) ─────────────────────────────
  const openAddCameraModal = () => {
    setEditingCameraIndex(null);
    setCamName("");
    setCamId(generateCameraId(cameras.length + 1));
    setCamRtspUrl("");
    setCamUsername("");
    setCamPassword("");
    setCamEnabled(true);
    setShowCamPassword(false);
    setPendingQueue([]);
    setModalAlert("");
    setShowAddModal(true);
    setTimeout(() => urlInputRef.current?.focus(), 80);
  };

  const openEditCameraModal = (index) => {
    const cam = cameras[index];
    if (!cam) return;
    setEditingCameraIndex(index);
    setCamName(cam.name || "");
    setCamId(cam.camera_id || "");
    setCamRtspUrl(cam.rtsp_url || "");
    setCamUsername(cam.username || "");
    setCamPassword(cam.password || "");
    setCamEnabled(cam.enabled !== false);
    setShowCamPassword(false);
    setPendingQueue([]);
    setModalAlert("");
    setShowAddModal(true);
  };

  const handleQueueCamera = () => {
    setModalAlert("");
    const urls = extractUrls(camRtspUrl);
    if (urls.length === 0) {
      const trimmed = camRtspUrl.trim();
      if (!trimmed) {
        setModalAlert("Please enter a Stream URL (e.g. rtsp://192.168.1.50:554/live).");
      } else {
        setModalAlert("Stream URL must start with rtsp://, rtsps://, http://, or https://");
      }
      return;
    }

    const existingUrls = new Set([
      ...cameras.filter((_, idx) => idx !== editingCameraIndex).map((c) => (c.rtsp_url || "").toLowerCase().trim()),
      ...pendingQueue.map((c) => (c.rtsp_url || "").toLowerCase().trim()),
    ]);

    const newItems = [];
    const baseName = camName.trim();
    const customId = camId.trim();

    urls.forEach((url) => {
      const normalizedUrl = url.toLowerCase().trim();
      if (existingUrls.has(normalizedUrl)) return;
      existingUrls.add(normalizedUrl);

      const nextNum = cameras.length + pendingQueue.length + newItems.length + 1;
      const name =
        urls.length === 1 && baseName
          ? baseName
          : baseName
          ? `${baseName} ${nextNum}`
          : `Camera ${nextNum}`;

      const finalId =
        urls.length === 1 && customId
          ? customId
          : customId
          ? `${customId}-${nextNum}`
          : generateCameraId(nextNum);

      newItems.push({
        camera_id: finalId,
        name,
        rtsp_url: url,
        username: camUsername.trim(),
        password: camPassword.trim(),
        enabled: Boolean(camEnabled),
      });
    });

    if (newItems.length === 0) {
      setModalAlert("The entered stream URL(s) have already been added.");
      return;
    }

    setPendingQueue((prev) => [...prev, ...newItems]);
    setCamRtspUrl("");
    setCamName("");
    setCamUsername("");
    setCamPassword("");
    setCamId(generateCameraId(cameras.length + pendingQueue.length + newItems.length + 1));
    setModalAlert("");
    urlInputRef.current?.focus();
  };

  const handleRemoveFromQueue = (url) => {
    setPendingQueue((prev) => prev.filter((c) => c.rtsp_url !== url));
  };

  const handleSaveModalCameras = () => {
    setModalAlert("");

    // Editing single camera mode
    if (editingCameraIndex !== null) {
      const urls = extractUrls(camRtspUrl);
      const trimmedUrl = urls[0] || camRtspUrl.trim();
      if (!trimmedUrl) {
        setModalAlert("Stream URL is required.");
        return;
      }
      if (!validateURL(trimmedUrl)) {
        setModalAlert("Stream URL must start with rtsp://, rtsps://, http://, or https://");
        return;
      }
      const updatedCam = {
        camera_id: camId.trim() || generateCameraId(editingCameraIndex + 1),
        name: camName.trim() || `Camera ${editingCameraIndex + 1}`,
        rtsp_url: trimmedUrl,
        username: camUsername.trim(),
        password: camPassword.trim(),
        enabled: Boolean(camEnabled),
      };
      setCameras((prev) =>
        prev.map((c, i) => (i === editingCameraIndex ? updatedCam : c))
      );
      setShowAddModal(false);
      return;
    }

    // Adding multiple cameras mode
    let toAdd = [...pendingQueue];

    // If user filled in the input fields but didn't click "+ Add", include them automatically
    if (camRtspUrl.trim()) {
      const urls = extractUrls(camRtspUrl);
      if (urls.length === 0) {
        setModalAlert(
          "Please enter valid URL(s) (starting with rtsp://, rtsps://, http://, or https://) or clear the field."
        );
        return;
      }

      const existingUrls = new Set([
        ...cameras.map((c) => (c.rtsp_url || "").toLowerCase().trim()),
        ...toAdd.map((c) => (c.rtsp_url || "").toLowerCase().trim()),
      ]);

      const baseName = camName.trim();
      const customId = camId.trim();

      urls.forEach((url) => {
        const normalizedUrl = url.toLowerCase().trim();
        if (existingUrls.has(normalizedUrl)) return;
        existingUrls.add(normalizedUrl);

        const nextNum = cameras.length + toAdd.length + 1;
        const name =
          urls.length === 1 && baseName
            ? baseName
            : baseName
            ? `${baseName} ${nextNum}`
            : `Camera ${nextNum}`;

        const finalId =
          urls.length === 1 && customId
            ? customId
            : customId
            ? `${customId}-${nextNum}`
            : generateCameraId(nextNum);

        toAdd.push({
          camera_id: finalId,
          name,
          rtsp_url: url,
          username: camUsername.trim(),
          password: camPassword.trim(),
          enabled: Boolean(camEnabled),
        });
      });
    }

    if (toAdd.length === 0) {
      setModalAlert("Please enter or add at least one camera stream.");
      return;
    }

    setCameras((prev) => [...prev, ...toAdd]);
    setShowAddModal(false);
    setError("");
  };

  const removeCamera = (index) => {
    setCameras((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleCameraEnabled = (index) => {
    setCameras((prev) =>
      prev.map((c, i) => (i === index ? { ...c, enabled: !c.enabled } : c))
    );
  };

  // ── Main Submit Handler ────────────────────────────────────────────────────
  const submit = async (event) => {
    if (event) event.preventDefault();
    setError("");
    setSuccess("");

    if (!validateEdge()) {
      setActiveTab("edge");
      return;
    }

    if (!cameras.length) {
      setError("Please add at least one camera to this Edge device.");
      setActiveTab("cameras");
      return;
    }

    setSaving(true);
    const id = edgeId.trim();

    try {
      const seenIds = new Set();
      const payloadCameras = cameras.map((c, idx) => {
        let cid = (c.camera_id || "").trim();
        if (!cid || seenIds.has(cid.toLowerCase())) {
          cid = generateCameraId(idx + 1);
        }
        seenIds.add(cid.toLowerCase());
        return {
          camera_id: cid,
          name: (c.name || "").trim() || `Camera ${idx + 1}`,
          rtsp_url: (c.rtsp_url || "").trim(),
          username: (c.username || "").trim(),
          password: (c.password || "").trim(),
          enabled: Boolean(c.enabled),
          ...(c.added_at ? { added_at: c.added_at } : {}),
          ...(c.updated_at ? { updated_at: c.updated_at } : {}),
        };
      });

      const response = await fetch(`${apiBase}/api/edge-config/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          edge_id: id,
          display_name: displayName.trim(),
          token: token.trim(),
          cameras: payloadCameras,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || `Save failed (HTTP ${response.status})`);
      }

      const isUpdate = Boolean(matchedExistingEdge);
      const successMsg = "Edge cameras saved successfully";
      setSuccess(
        isUpdate
          ? `Successfully updated "${displayName.trim()}" with ${data.camera_count || payloadCameras.length} camera(s). The Edge device will receive the updated configuration.`
          : `Successfully registered "${displayName.trim()}" with ${data.camera_count || payloadCameras.length} camera(s). The Edge device will receive this configuration.`
      );
      if (onSaved) onSaved({ ...data, camera_count: payloadCameras.length, message: successMsg });
      window.dispatchEvent(new Event("devicesUpdated"));
      window.dispatchEvent(
        new CustomEvent("showAppToast", {
          detail: {
            message: successMsg,
            subtitle: `${payloadCameras.length} camera${payloadCameras.length !== 1 ? "s" : ""} saved for "${displayName.trim()}"`,
            spinning: true,
            type: "success",
          },
        })
      );
      if (onClose) onClose();
    } catch (e) {
      setError(e.message || "Unable to save Edge configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeleteEdge = async () => {
    if (!matchedExistingEdge) return;
    const targetEdgeId = matchedExistingEdge.edge_id || edgeId.trim();
    const targetName = displayName.trim() || matchedExistingEdge.display_name || targetEdgeId;

    setDeleting(true);
    try {
      const headers = typeof authHeaders === "function" ? authHeaders() : (authHeaders || {});
      const res = await fetch(`${apiBase}/api/edge-config/${encodeURIComponent(targetEdgeId)}`, {
        method: "DELETE",
        headers,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to delete edge device");
      }

      const successMsg = `Edge device "${targetName}" and all cameras deleted successfully`;
      window.dispatchEvent(new Event("devicesUpdated"));
      window.dispatchEvent(
        new CustomEvent("showAppToast", {
          detail: {
            message: successMsg,
            subtitle: `${cameras.length} camera(s) removed`,
            spinning: true,
            type: "success",
          },
        })
      );
      if (onSaved) onSaved({ message: successMsg });
      setShowDeleteConfirm(false);
      if (onClose) onClose();
    } catch (err) {
      setError(err.message || "Failed to delete edge device");
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={saving || deleting ? undefined : onClose}>
      <div
        className="modal-box edge-config-modal-box"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div>
            <h2 className="modal-title">
              {matchedExistingEdge ? "Update Edge Device" : "Add Edge Device"}
            </h2>
            <p className="edge-cfg__subtitle">
              {matchedExistingEdge
                ? `Editing settings and cameras for existing device "${matchedExistingEdge.display_name}"`
                : "Configure Edge Gateway credentials and connected RTSP cameras"}
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="edge-cfg__tabs">
          <button
            type="button"
            className={`edge-cfg__tab ${activeTab === "edge" ? "edge-cfg__tab--active" : ""} ${
              isEdgeValid ? "edge-cfg__tab--completed" : ""
            }`}
            onClick={() => handleTabClick("edge")}
          >
            <span className="edge-cfg__step-num">
              {isEdgeValid ? (
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                "1"
              )}
            </span>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="8" rx="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" strokeLinecap="round" strokeWidth="2.5" />
              <line x1="6" y1="18" x2="6.01" y2="18" strokeLinecap="round" strokeWidth="2.5" />
            </svg>
            <span>Edge Details</span>
            {matchedExistingEdge && (
              <span className="edge-cfg__edit-indicator" title="Existing Edge">
                Existing
              </span>
            )}
          </button>

          <button
            type="button"
            className={`edge-cfg__tab ${activeTab === "cameras" ? "edge-cfg__tab--active" : ""}`}
            onClick={() => handleTabClick("cameras")}
          >
            <span className="edge-cfg__step-num">2</span>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
            <span>Camera Details</span>
            <span className="edge-cfg__badge">
              {cameras.length} Camera{cameras.length !== 1 ? "s" : ""}
            </span>
          </button>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          {/* Body */}
          <div className="edge-cfg__body">
            {error && (
              <div role="alert" className="modal-ui-alert">
                <svg className="modal-ui-alert-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div className="modal-ui-alert-text">{error}</div>
                <button
                  type="button"
                  className="modal-ui-alert-close"
                  onClick={() => setError("")}
                >
                  ✕
                </button>
              </div>
            )}

            {infoNotice && (
              <div className="edge-cfg__info-banner">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <div style={{ flex: 1, fontSize: "12.5px" }}>{infoNotice}</div>
                <button
                  type="button"
                  className="modal-ui-alert-close"
                  onClick={() => setInfoNotice("")}
                >
                  ✕
                </button>
              </div>
            )}

            {success && (
              <div className="edge-cfg__success-alert">
                <div className="edge-cfg__success-icon">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <strong>Configuration Saved!</strong>
                  <div style={{ fontSize: "13px", marginTop: "2px" }}>{success}</div>
                </div>
                <button
                  type="button"
                  className="modal-ui-alert-close"
                  onClick={() => setSuccess("")}
                >
                  ✕
                </button>
              </div>
            )}

            {/* TAB 1: EDGE DETAILS */}
            {activeTab === "edge" && (
              <div className="edge-cfg__tab-content">


                <div className="edge-cfg__grid-2">
                  <div className="modal-field">
                    <label className="modal-label">
                      Edge ID <span className="edge-cfg__req">*</span>
                    </label>
                    <input
                      className="modal-input"
                      required
                      maxLength={64}
                      value={edgeId}
                      onChange={(e) => {
                        setEdgeId(e.target.value);
                        setError("");
                        setInfoNotice("");
                      }}
                      placeholder="e.g. pi-site01"
                      disabled={saving}
                      autoFocus
                    />
                    <span className="edge-cfg__helper">
                      Unique hardware identifier for the Edge device
                    </span>
                  </div>

                  <div className="modal-field">
                    <label className="modal-label">
                      Display Name <span className="edge-cfg__req">*</span>
                    </label>
                    <input
                      className="modal-input"
                      required
                      maxLength={120}
                      value={displayName}
                      onChange={(e) => {
                        setDisplayName(e.target.value);
                        setError("");
                      }}
                      placeholder="e.g. Warehouse Edge, Floor 1"
                      disabled={saving}
                    />

                  </div>
                </div>

                {/* ── Existing Edge Detected Alert Box ──────────────────────── */}
                {matchedExistingEdge && (
                  <div className="edge-cfg__detected-card">
                    <div className="edge-cfg__detected-top">
                      <span className="edge-cfg__detected-badge">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        Existing Device Detected
                      </span>
                      <span className="edge-cfg__detected-name">
                        "{matchedExistingEdge.display_name}"
                      </span>
                    </div>

                    <p className="edge-cfg__detected-desc">
                      An Edge device with ID <code>{edgeId.trim()}</code> is already enrolled. Saving will{" "}
                      <strong>update and overwrite</strong> the settings for "{matchedExistingEdge.display_name}". It will NOT create a second device.
                    </p>

                    <div className="edge-cfg__detected-actions">
                      <button
                        type="button"
                        className="edge-cfg__detected-load-btn"
                        onClick={handleLoadExistingEdge}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Pre-fill "{matchedExistingEdge.display_name}" Details & Cameras
                      </button>

                      <button
                        type="button"
                        className="edge-cfg__detected-new-btn"
                        onClick={handleSuggestNewId}
                      >
                        Create as New Separate Device
                      </button>
                    </div>
                  </div>
                )}

                <div className="modal-field" style={{ marginTop: 12 }}>
                  <label className="modal-label">
                    Edge Token <span className="edge-cfg__req">*</span>
                  </label>
                  <div className="edge-cfg__input-wrap">
                    <input
                      className="modal-input"
                      type={showToken ? "text" : "password"}
                      required
                      minLength={24}
                      value={token}
                      onChange={(e) => {
                        setToken(e.target.value);
                        setError("");
                      }}
                      placeholder="Paste Edge security token (min 24 characters)"
                      autoComplete="new-password"
                      disabled={saving}
                      style={{ fontFamily: showToken ? "var(--font-mono, monospace)" : "inherit" }}
                    />
                    <button
                      type="button"
                      className="edge-cfg__eye-btn"
                      onClick={() => setShowToken(!showToken)}
                      title={showToken ? "Hide token" : "Show token"}
                      tabIndex={-1}
                    >
                      {showToken ? (
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
                  <span className="edge-cfg__helper">
                    Pre-shared authentication token configured on the Edge Gateway daemon
                  </span>
                </div>
              </div>
            )}

            {/* TAB 2: CAMERA DETAILS */}
            {activeTab === "cameras" && (
              <div className="edge-cfg__tab-content">
                <div className="edge-cfg__cam-header">
                  <div>
                    <h3 className="edge-cfg__cam-title">Connected Cameras</h3>
                    <p className="edge-cfg__cam-sub">
                      RTSP camera streams assigned to this Edge device
                    </p>
                  </div>
                  <button
                    type="button"
                    className="edge-cfg__add-btn"
                    onClick={openAddCameraModal}
                    disabled={saving}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add Camera
                  </button>
                </div>

                {cameras.length === 0 ? (
                  <div className="edge-cfg__empty-cams">
                    <div className="edge-cfg__compact-icon" style={{ width: 44, height: 44, borderRadius: 10 }}>
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M23 7l-7 5 7 5V7z" />
                        <rect x="1" y="5" width="15" height="14" rx="2" />
                      </svg>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <p style={{ margin: "0 0 4px", fontWeight: 600, color: "var(--text-primary)", fontSize: "14px" }}>
                        No cameras added yet
                      </p>
                      <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
                        Click '+ Add Camera' to add RTSP streams to this Edge device.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="edge-cfg__add-btn"
                      onClick={openAddCameraModal}
                      style={{ marginTop: 6 }}
                    >
                      + Add Camera
                    </button>
                  </div>
                ) : (
                  <div className="edge-cfg__compact-list">
                    {cameras.map((camera, index) => (
                      <div key={`${index}-${camera.camera_id}`} className="edge-cfg__compact-item">
                        <div className="edge-cfg__compact-left">
                          <div className="edge-cfg__compact-icon">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M23 7l-7 5 7 5V7z" />
                              <rect x="1" y="5" width="15" height="14" rx="2" />
                            </svg>
                          </div>
                          <div className="edge-cfg__compact-info">
                            <div className="edge-cfg__compact-name-row">
                              <span className="edge-cfg__compact-name">
                                {camera.name || `Camera ${index + 1}`}
                              </span>
                              <span className="edge-cfg__compact-id">
                                {camera.camera_id}
                              </span>
                            </div>
                            <span className="edge-cfg__compact-url" title={camera.rtsp_url}>
                              {camera.rtsp_url}
                            </span>
                          </div>
                        </div>

                        <div className="edge-cfg__compact-meta">
                          {camera.username && (
                            <span className="edge-cfg__auth-pill" title={`Username: ${camera.username}`}>
                              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                              </svg>
                              {camera.username}
                            </span>
                          )}

                          <button
                            type="button"
                            className={`edge-cfg__status-toggle ${camera.enabled ? "edge-cfg__status-toggle--active" : ""}`}
                            onClick={() => toggleCameraEnabled(index)}
                            title={camera.enabled ? "Camera is enabled (Click to disable)" : "Camera is disabled (Click to enable)"}
                          >
                            <span className="edge-cfg__status-dot" />
                            {camera.enabled ? "Active" : "Disabled"}
                          </button>

                          <button
                            type="button"
                            className="edge-cfg__action-icon-btn"
                            onClick={() => openEditCameraModal(index)}
                            title="Edit camera"
                          >
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            className="edge-cfg__action-icon-btn edge-cfg__action-icon-btn--danger"
                            onClick={() => removeCamera(index)}
                            title="Remove camera"
                          >
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="edge-cfg__footer">
            <div className="edge-cfg__footer-left">
              {activeTab === "cameras" ? (
                <button
                  type="button"
                  className="modal-btn modal-btn--cancel"
                  onClick={() => setActiveTab("edge")}
                  disabled={saving}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Back to Edge Details
                </button>
              ) : (
                <button
                  type="button"
                  className="modal-btn modal-btn--cancel"
                  onClick={onClose}
                  disabled={saving || deleting}
                >
                  Cancel
                </button>
              )}
              {matchedExistingEdge && (
                <button
                  type="button"
                  className="modal-btn modal-btn--cancel"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={saving || deleting}
                  style={{
                    color: "var(--red, #ef4444)",
                    borderColor: "rgba(239, 68, 68, 0.4)",
                    background: "rgba(239, 68, 68, 0.08)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  title="Delete this edge device and all its cameras"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                  <span>{deleting ? "Deleting…" : "Delete Edge"}</span>
                </button>
              )}
            </div>

            <div className="edge-cfg__footer-right">
              {activeTab === "edge" ? (
                <>
                  <button
                    type="button"
                    className="modal-btn modal-btn--cancel"
                    onClick={onClose}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="edge-cfg__next-btn"
                    onClick={handleNextToCameras}
                    disabled={saving}
                  >
                    <span>Next</span>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="modal-btn modal-btn--cancel"
                    onClick={onClose}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="edge-cfg__next-btn"
                    disabled={saving}
                  >
                    {saving ? (
                      <>
                        <span className="edge-cfg__spinner" />
                        <span>Saving Configuration…</span>
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                          <polyline points="17 21 17 13 7 13 7 21" />
                          <polyline points="7 3 7 8 15 8" />
                        </svg>
                        <span>
                          {matchedExistingEdge
                            ? `Update Edge Device ("${matchedExistingEdge.display_name}")`
                            : "Save"}
                        </span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* ── Sub-modal: Add / Edit Camera Popup (Stream URL Style) ────────────── */}
      {showAddModal && (
        <div
          className="edge-submodal__overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false);
          }}
        >
          <div className="edge-submodal__card" onClick={(e) => e.stopPropagation()}>
            <div className="edge-submodal__header">
              <div>
                <div className="edge-submodal__eyebrow">
                  {editingCameraIndex !== null ? "Camera Configuration" : "Stream Ingestion"}
                </div>
                <h3 className="edge-submodal__title">
                  {editingCameraIndex !== null ? "Edit Camera Stream" : "Add Cameras to Edge"}
                </h3>
              </div>
              <button
                type="button"
                className="edge-submodal__close"
                onClick={() => setShowAddModal(false)}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="edge-submodal__body">
              {modalAlert && (
                <div className="sum-ui-alert" style={{ marginBottom: 4 }}>
                  <svg className="sum-ui-alert-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <div className="sum-ui-alert-text">{modalAlert}</div>
                  <button
                    type="button"
                    className="sum-ui-alert-close"
                    onClick={() => setModalAlert("")}
                  >
                    ✕
                  </button>
                </div>
              )}



              <div className="edge-cfg__grid-2">
                <div className="modal-field">
                  <label className="modal-label">Camera Name (Optional)</label>
                  <input
                    className="modal-input"
                    placeholder="e.g. Front Gate, Lobby PTZ"
                    value={camName}
                    onChange={(e) => setCamName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleQueueCamera();
                    }}
                  />
                </div>

                <div className="modal-field">
                  <label className="modal-label">Camera ID</label>
                  <input
                    className="modal-input"
                    placeholder="e.g. cam01"
                    value={camId}
                    onChange={(e) => setCamId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleQueueCamera();
                    }}
                  />
                </div>
              </div>

              {/* Stream URL Input + Add Button Row */}
              <div className="modal-field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                  <label className="modal-label" style={{ margin: 0 }}>
                    Stream URL{editingCameraIndex === null ? "(s)" : ""} <span className="edge-cfg__req">*</span>
                  </label>
                  {editingCameraIndex === null && (
                    <span style={{ fontSize: "11px", color: "var(--teal, #10b981)", fontWeight: 500 }}>
                      Supports single or multiple URLs
                    </span>
                  )}
                </div>
                <div className="edge-submodal__add-row">
                  {editingCameraIndex !== null ? (
                    <input
                      ref={urlInputRef}
                      className="modal-input"
                      placeholder="rtsp://192.168.1.64:554/stream1"
                      value={camRtspUrl}
                      onChange={(e) => {
                        setCamRtspUrl(e.target.value);
                        setModalAlert("");
                      }}
                      style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "13px", flex: 1 }}
                    />
                  ) : (
                    <textarea
                      ref={urlInputRef}
                      className="modal-input"
                      rows={3}
                      placeholder={"rtsp://192.168.1.64:554/stream1"}
                      value={camRtspUrl}
                      onChange={(e) => {
                        setCamRtspUrl(e.target.value);
                        setModalAlert("");
                      }}
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "12.5px",
                        flex: 1,
                        resize: "vertical",
                        minHeight: "72px",
                        lineHeight: 1.5,
                      }}
                    />
                  )}
                  {editingCameraIndex === null && (
                    <button
                      type="button"
                      className="edge-submodal__btn-add"
                      onClick={handleQueueCamera}
                      title="Add entered stream URL(s) to queue"
                    >
                      {(() => {
                        const count = extractUrls(camRtspUrl).length;
                        return count > 1 ? `+ Add (${count})` : "+ Add";
                      })()}
                    </button>
                  )}
                </div>
                <span className="edge-cfg__helper" style={{ marginTop: "4px", display: "block" }}>
                  {editingCameraIndex === null
                    ? "Paste one or multiple RTSP URLs (separated by newlines, commas, or semicolons)."
                    : "RTSP stream URL for this camera."}
                </span>
              </div>

              {/* Optional Credentials */}
              <div className="edge-cfg__grid-2">
                <div className="modal-field">
                  <label className="modal-label">Username</label>
                  <input
                    className="modal-input"
                    placeholder="admin"
                    value={camUsername}
                    onChange={(e) => setCamUsername(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="modal-field">
                  <label className="modal-label">Password</label>
                  <div className="edge-cfg__input-wrap">
                    <input
                      className="modal-input"
                      type={showCamPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={camPassword}
                      onChange={(e) => setCamPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="edge-cfg__eye-btn"
                      onClick={() => setShowCamPassword(!showCamPassword)}
                      tabIndex={-1}
                    >
                      {showCamPassword ? (
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Queued Cameras List (like StreamURLModal items list) */}
              {editingCameraIndex === null && pendingQueue.length > 0 && (
                <div className="modal-field" style={{ marginTop: 4 }}>
                  <label className="modal-label">
                    {pendingQueue.length} Stream{pendingQueue.length > 1 ? "s" : ""} Queued to Add
                  </label>
                  <div className="edge-submodal__queue-list">
                    {pendingQueue.map((item) => (
                      <div key={item.camera_id} className="edge-submodal__queue-item">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#3b82f6"
                          strokeWidth="2"
                          style={{ flexShrink: 0, marginTop: 1 }}
                        >
                          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                        </svg>
                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                          <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {item.name} <span style={{ opacity: 0.6, fontSize: "11px", fontWeight: "normal" }}>({item.camera_id})</span>
                          </span>
                          <span style={{ fontSize: "12px", opacity: 0.8, fontFamily: "var(--font-mono, monospace)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {item.rtsp_url}
                          </span>
                        </div>
                        {item.username && (
                          <span className="edge-cfg__auth-pill" style={{ fontSize: "10.5px" }}>
                            {item.username}
                          </span>
                        )}
                        <button
                          type="button"
                          className="edge-submodal__queue-remove"
                          onClick={() => handleRemoveFromQueue(item.rtsp_url)}
                          title="Remove from queue"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="edge-submodal__footer">
              <button
                type="button"
                className="modal-btn modal-btn--cancel"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--save"
                onClick={handleSaveModalCameras}
              >
                {editingCameraIndex !== null
                  ? "Update Camera"
                  : (() => {
                      const unqueuedCount = extractUrls(camRtspUrl).length;
                      const totalCount = pendingQueue.length + unqueuedCount;
                      if (totalCount > 1) {
                        return `Add ${totalCount} Cameras`;
                      }
                      return "Add Camera";
                    })()}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Edge Confirmation Dialog */}
      {showDeleteConfirm && (
        <div
          className="edge-submodal__overlay"
          onClick={() => !deleting && setShowDeleteConfirm(false)}
        >
          <div
            className="edge-submodal__card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 440 }}
          >
            <div className="edge-submodal__header" style={{ borderBottom: "1px solid rgba(239, 68, 68, 0.2)" }}>
              <div>
                <div className="edge-submodal__eyebrow" style={{ color: "var(--red, #ef4444)" }}>
                  Danger Zone
                </div>
                <h3 className="edge-submodal__title" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--red, #ef4444)" }}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                  Delete Edge Device
                </h3>
              </div>
              {!deleting && (
                <button
                  type="button"
                  className="edge-submodal__close"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  ✕
                </button>
              )}
            </div>

            <div className="edge-submodal__body">
              <p style={{ margin: "0 0 12px", fontSize: "14px", lineHeight: "1.5" }}>
                Are you sure you want to delete Edge device <strong>"{displayName.trim() || matchedExistingEdge?.display_name || edgeId}"</strong>?
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
                This will delete the Edge device configuration and permanently remove all <strong>{cameras.length} connected camera{cameras.length !== 1 ? "s" : ""}</strong> from the system and database.
              </div>
            </div>

            <div className="edge-submodal__footer">
              <button
                type="button"
                className="modal-btn modal-btn--cancel"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                onClick={handleConfirmDeleteEdge}
                disabled={deleting}
                style={{
                  background: "var(--red, #ef4444)",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {deleting ? (
                  <>
                    <span className="edge-cfg__spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    <span>Deleting…</span>
                  </>
                ) : (
                  <span>Delete Edge & All Cameras</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
