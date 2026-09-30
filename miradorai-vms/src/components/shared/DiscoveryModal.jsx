import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./DiscoveryModal.css";

const API_BASE = import.meta.env.VITE_API_URL;


export default function DiscoveryModal({
  isOpen,
  onClose,
  onAddDevices,
  groups,
  selectedGroupId,
  setSelectedGroupId
}) {
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Initializing network scan...");
  const [error, setError] = useState(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [brandCreds, setBrandCreds] = useState({});
  const [cameraCreds, setCameraCreds] = useState({});
  const [showCredModal, setShowCredModal] = useState(false);
  const [showPasswords, setShowPasswords] = useState({});
  const [isRegistering, setIsRegistering] = useState(false);
  const [regStatus, setRegStatus] = useState({});
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [dropdownPos, setDropdownPos] = useState(null); // ← NEW: screen position for the portaled dropdown
  const [alertMsg, setAlertMsg] = useState("");
  const [collapsedBrands, setCollapsedBrands] = useState(new Set());

  const progressTimerRef = useRef(null);
  const dropdownRef = useRef(null);

  const closeDropdown = () => {
    setOpenDropdownId(null);
    setDropdownPos(null);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close the dropdown on scroll so a stale position never floats in the
  // wrong place. capture:true is required because the inner
  // .dm-brand-cams-list scroll event doesn't bubble to window normally.
  useEffect(() => {
    if (!openDropdownId) return;
    const handleScroll = () => closeDropdown();
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [openDropdownId]);

  const startProgressTicker = () => {
    let current = 0;
    const tick = () => {
      current = current < 60
        ? current + 12
        : current < 85
        ? current + 2
        : current;
      setProgress(current);
      if (current < 85) {
        progressTimerRef.current = setTimeout(tick, 300);
      }
    };
    progressTimerRef.current = setTimeout(tick, 300);
  };

  const stopProgressTicker = () => {
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  const startDiscovery = async () => {
    const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
    setIsScanning(true);
    setError(null);
    setAlertMsg("");
    setDiscoveredDevices([]);
    setSelectedDevices(new Set());
    setRegStatus({});
    setBrandCreds({});
    setProgress(0);
    setHasScanned(false);
    setStatusMessage("Scanning network for ONVIF cameras…");

    startProgressTicker();

    let devices = [];
    try {
      const response = await fetch(`${API_BASE}/api/discover-devices`, {
        headers: {
          Authorization: "Bearer " + token
        }
      });
      if (response.ok) {
        const data = await response.json();
        devices = data.devices || [];
        console.log("[Discovery] Backend returned:", devices);
      } else {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
    } catch (fetchErr) {
      console.error("[Discovery] Backend API failed:", fetchErr.message);
      setError(fetchErr.message);
    }

    stopProgressTicker();
    setProgress(100);
    setDiscoveredDevices(devices);
    setStatusMessage(
      devices.length > 0
        ? `Found ${devices.length} camera${devices.length !== 1 ? "s" : ""}`
        : "No cameras found"
    );
    setHasScanned(true);
    setIsScanning(false);
  };

  useEffect(() => {
    startDiscovery();
    return () => stopProgressTicker();
  }, []);

  const toggleOne = (id) => {
    const s = new Set(selectedDevices);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedDevices(s);
    setAlertMsg("");
  };

  const toggleAll = () => {
    setSelectedDevices(
      selectedDevices.size === discoveredDevices.length
        ? new Set()
        : new Set(discoveredDevices.map((d) => d.id))
    );
    setAlertMsg("");
  };

  const toggleBrandCollapse = (brand) => {
    setCollapsedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(brand)) {
        next.delete(brand);
      } else {
        next.add(brand);
      }
      return next;
    });
  };

  const handleAddClick = () => {
    const initBrand = {};
    const initCam = {};
    const selectedList = discoveredDevices.filter((d) => selectedDevices.has(d.id));
    const selectedBrands = new Set(selectedList.map(d => d.manufacturer || "Unknown"));
    
    selectedBrands.forEach(brand => {
      initBrand[brand] = brandCreds[brand] || { username: "", password: "" };
    });
    
    selectedList.forEach(device => {
      const displayName = getDeviceDisplayName(device);
      initCam[device.id] = cameraCreds[device.id] || {
        name: displayName,
        groupId: selectedGroupId || "default"
      };
    });
    
    setBrandCreds(initBrand);
    setCameraCreds(initCam);
    setShowCredModal(true);
  };

  const updateBrandCred = (brand, field, value) => {
    setBrandCreds((prev) => ({
      ...prev,
      [brand]: { ...prev[brand], [field]: value },
    }));
  };

  const updateCameraCred = (deviceId, field, value) => {
    setCameraCreds((prev) => ({
      ...prev,
      [deviceId]: { ...prev[deviceId], [field]: value },
    }));
  };

  const togglePasswordVisibility = (brand) => {
    setShowPasswords((prev) => ({
      ...prev,
      [brand]: !prev[brand],
    }));
  };

  const handleCredKeyDown = (e, brand, isLast) => {
    if (e.key === "Enter" && isLast) {
      handleEnroll();
    }
  };

  // ── Enroll & Stream ───────────────────────────────────────────────
  const handleEnroll = async () => {
    setShowCredModal(false);
    const toAdd = discoveredDevices.filter((d) => selectedDevices.has(d.id));
    setIsRegistering(true);

    const initStatus = {};
    toAdd.forEach((d) => { initStatus[d.id] = { status: "pending" }; });
    setRegStatus(initStatus);

    const results = await Promise.all(
      toAdd.map(async (device) => {
        const brand = device.manufacturer || "Unknown";
        const brandInfo = brandCreds[brand] || {};
        const camInfo = cameraCreds[device.id] || {};

        const probePayload = {
          ip: device.ip,
          username: brandInfo.username || "",
          password: brandInfo.password || "",
          group_id: camInfo.groupId || "default",
          device_name: camInfo.name || ""
        };

        const devicePort = device.port;
        if (devicePort && !isNaN(devicePort) && Number(devicePort) > 0) {
          probePayload.port = Number(devicePort);
        }

        setRegStatus((prev) => ({
          ...prev,
          [device.id]: { status: "registering" }
        }));

        let ws_url = null;
        let stream_key = null;
        let stream_status = "error";
        let rtsp_url = null;

        let enrichedName = null;
        let enrichedManufacturer = device.manufacturer || "Unknown";
        let enrichedModel = device.model || "Unknown";
        let enrichedFirmware = null;
        let enrichedSerial = null;

        let streamProfiles = [];
        let streamCount = 0;

        let data = null;
        try {
          const res = await fetch(`${API_BASE}/api/onvif/probe`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": "Bearer " + ((localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token")) || "")
            },
            body: JSON.stringify(probePayload),
          });

          data = await res.json();

          if (!res.ok) {
            setAlertMsg(`${device.ip} → ${data.detail || "Camera limit exceeded"}`);

            setRegStatus((prev) => ({
              ...prev,
              [device.id]: { status: "error", error: data.detail }
            }));

            return null;
          }

          if (data?.success && data?.ws_url) {
            ws_url = data.ws_url;
            stream_key = data.stream_key || data.stream_key || null;
            stream_status = data.status || "streaming";
            rtsp_url = data.rtsp_url || data.stream_uri || null;

            enrichedManufacturer = data.manufacturer || enrichedManufacturer;
            enrichedModel = data.model || enrichedModel;
            enrichedFirmware = data.firmware || null;
            enrichedSerial = data.serial || null;

            enrichedName = `${enrichedManufacturer} ${enrichedModel}`.trim();

            streamProfiles = data.profiles || [];
            streamCount = data.stream_count ?? streamProfiles.length;

            setRegStatus((prev) => ({
              ...prev,
              [device.id]: { status: "success", ws_url }
            }));
          } else {
            const errMsg = data?.error || `HTTP ${res.status}`;
            setRegStatus((prev) => ({
              ...prev,
              [device.id]: { status: "error", error: errMsg }
            }));
          }

        } catch (err) {
          setRegStatus((prev) => ({
            ...prev,
            [device.id]: { status: "error", error: err.message }
          }));
        }

        return {
          id: `device-${device.ip}-${Date.now()}`,
          type: "entrance",
          name:
            camInfo.name ||
            enrichedName ||
            `Camera @ ${device.ip}`,
          ip: device.ip,
          group_id: camInfo.groupId || "default",
          mac: data?.mac || device.mac || "—",
          status: ws_url ? "Online" : "Offline",
          manufacturer: enrichedManufacturer,
          model: enrichedModel,
          firmware: enrichedFirmware,
          serial: enrichedSerial,
          rtsp_url,
          ws_url,
          stream_key,
          stream_status,
          source: "discovery",
          stream_profiles: streamProfiles,
          stream_count: streamCount,
        };
      })
    );

    await new Promise((r) => setTimeout(r, 600));
    setIsRegistering(false);
    onAddDevices(results.filter(Boolean));
    onClose();
  };

  const RegBadge = ({ deviceId }) => {
    const s = regStatus[deviceId];
    if (!s) return null;
    const map = {
      pending:     { label: "Pending…",    cls: "dm-reg--pending"  },
      registering: { label: "Probing…",    cls: "dm-reg--progress" },
      success:     { label: "✓ Streaming", cls: "dm-reg--success"  },
      error:       { label: "✗ Failed",    cls: "dm-reg--error"    },
    };
    const { label, cls } = map[s.status] || {};
    return (
      <span className={`dm-reg-badge ${cls}`} title={s.error || s.ws_url || ""}>
        {label}
      </span>
    );
  };

  const selectedList = discoveredDevices.filter((d) => selectedDevices.has(d.id));

  useEffect(() => {
    if (!showCredModal) return;
    const handleKeyDown = (e) => {
      if (e.target.tagName !== 'INPUT') return;
      const inputs = document.querySelectorAll('.dm-cred-modal input[tabindex]:not([tabindex="-1"])');
      const currentIndex = Array.from(inputs).findIndex(input => input === e.target);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % inputs.length;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + inputs.length) % inputs.length;
      } else {
        return;
      }
      e.preventDefault();
      inputs[nextIndex].focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCredModal, selectedList]);

  // Group discovered devices by manufacturer/brand
  const groupedDevices = {};
  discoveredDevices.forEach((device) => {
    const brand = device.manufacturer || "Unknown";
    if (!groupedDevices[brand]) {
      groupedDevices[brand] = [];
    }
    groupedDevices[brand].push(device);
  });

  // Helper to compare IP addresses numerically in ascending order
  const compareIps = (ipA, ipB) => {
    const partsA = (ipA || "").split('.').map(num => parseInt(num, 10) || 0);
    const partsB = (ipB || "").split('.').map(num => parseInt(num, 10) || 0);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const valA = partsA[i] ?? 0;
      const valB = partsB[i] ?? 0;
      if (valA !== valB) {
        return valA - valB;
      }
    }
    return 0;
  };

  // Sort devices within each brand group by IP in ascending order
  Object.keys(groupedDevices).forEach((brand) => {
    groupedDevices[brand].sort((a, b) => compareIps(a.ip, b.ip));
  });

  const sortedBrands = Object.keys(groupedDevices).sort((a, b) => {
    if (a === "Unknown") return 1;
    if (b === "Unknown") return -1;
    return a.localeCompare(b);
  });

  const isBrandAllSelected = (brand) => {
    const brandDevices = groupedDevices[brand] || [];
    return brandDevices.every((d) => selectedDevices.has(d.id));
  };

  const toggleBrandAll = (brand) => {
    const brandDevices = groupedDevices[brand] || [];
    const allSel = isBrandAllSelected(brand);
    setSelectedDevices((prev) => {
      const next = new Set(prev);
      brandDevices.forEach((d) => {
        if (allSel) {
          next.delete(d.id);
        } else {
          next.add(d.id);
        }
      });
      return next;
    });
    setAlertMsg("");
  };

  const getDeviceDisplayName = (device) => {
    if (device.name) return device.name;
    const model = device.model || "Camera";
    const mfg = device.manufacturer || "Unknown";
    if (mfg !== "Unknown" && model !== "Unknown") {
      if (model.toLowerCase().startsWith(mfg.toLowerCase())) {
        return model;
      }
      return `${mfg} ${model}`;
    }
    return model;
  };

  // Group selected devices by manufacturer/brand for credentials modal
  const selectedGrouped = {};
  selectedList.forEach((device) => {
    const brand = device.manufacturer || "Unknown";
    if (!selectedGrouped[brand]) {
      selectedGrouped[brand] = [];
    }
    selectedGrouped[brand].push(device);
  });

  // Sort selected devices within each brand group by IP in ascending order
  Object.keys(selectedGrouped).forEach((brand) => {
    selectedGrouped[brand].sort((a, b) => compareIps(a.ip, b.ip));
  });

  const selectedBrands = Object.keys(selectedGrouped).sort((a, b) => {
    if (a === "Unknown") return 1;
    if (b === "Unknown") return -1;
    return a.localeCompare(b);
  });

  return (
    <>
      <div className="dm-overlay" onClick={onClose}>
        <div className="dm-modal" onClick={(e) => e.stopPropagation()}>

          <div className="dm-header">
            <div className="dm-header-left">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                <path d="M11 8v6M8 11h6"/>
              </svg>
              Scan Network
            </div>
            <button className="dm-close" onClick={onClose} tabIndex={-1}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="dm-body">
            {alertMsg && (
              <div className="dm-ui-alert">
                <svg className="dm-ui-alert-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div className="dm-ui-alert-text">{alertMsg}</div>
                <button className="dm-ui-alert-close" onClick={() => setAlertMsg("")}>✕</button>
              </div>
            )}

            {!hasScanned && !isScanning && (
              <div className="dm-center">
                <div className="dm-empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    <path d="M2 12h20"/>
                  </svg>
                </div>
                <div className="dm-empty-title">Auto-Discover Cameras</div>
                <div className="dm-empty-sub">
                  Automatically scans your network for ONVIF-compatible cameras.
                
                </div>
                <button className="dm-start-btn" onClick={startDiscovery} tabIndex={1}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Start Discovery
                </button>
              </div>
            )}

            {isScanning && (
              <div className="dm-center dm-center--radar">
                <div className="dm-radar-container">
                  <div className="dm-radar">
                    <div className="dm-radar-beam"></div>
                    <div className="dm-radar-pulse dm-radar-pulse-1"></div>
                    <div className="dm-radar-pulse dm-radar-pulse-2"></div>
                    <div className="dm-radar-pulse dm-radar-pulse-3"></div>
                  </div>
                  <div className="dm-radar-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
                      <path d="M12 2v20M2 12h20M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10A10 10 0 0 1 2 12 10 10 0 0 1 12 2z"/>
                    </svg>
                  </div>
                </div>
                <div className="dm-scan-msg">{statusMessage}</div>
                <div className="dm-progress-wrap">
                  <div className="dm-progress-bar">
                    <div
                      className="dm-progress-fill"
                      style={{ width: `${progress}%`, transition: "width 0.3s ease-out" }}
                    />
                  </div>
                  <span className="dm-progress-pct">{progress}%</span>
                </div>
              </div>
            )}

            {hasScanned && !isScanning && discoveredDevices.length > 0 && (
              <div className="dm-results">
                <div className="dm-results-header">
                  <span className="dm-results-count">
                    Found <strong>{discoveredDevices.length}</strong> camera{discoveredDevices.length !== 1 ? "s" : ""}
                  </span>
                  <button className="dm-select-all" onClick={toggleAll} disabled={isRegistering} tabIndex={2}>
                    {selectedDevices.size === discoveredDevices.length ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <div className="dm-device-list">
                  {sortedBrands.map((brand) => {
                    const brandDevices = groupedDevices[brand] || [];
                    const isCollapsed = collapsedBrands.has(brand);
                    const allSelected = isBrandAllSelected(brand);
                    return (
                      <div key={brand} className="dm-brand-group">
                        <div className="dm-brand-header" onClick={() => toggleBrandCollapse(brand)}>
                          <div className="dm-brand-title">
                            <span className={`dm-brand-caret ${isCollapsed ? "dm-brand-caret--collapsed" : ""}`}>
                              ▼
                            </span>
                            <strong>{brand}</strong> ({brandDevices.length} Camera{brandDevices.length !== 1 ? "s" : ""})
                          </div>
                        </div>

                        {!isCollapsed && (
                          <div className="dm-brand-content">
                            <div className="dm-brand-select-all" onClick={() => toggleBrandAll(brand)}>
                              <input
                                type="checkbox"
                                className="dm-cb"
                                checked={allSelected}
                                disabled={isRegistering}
                                onChange={() => toggleBrandAll(brand)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span className="dm-brand-select-all-label">Select All {brand}</span>
                            </div>

                            <div className="dm-brand-devices">
                              {brandDevices.map((device, index) => {
                                const sel = selectedDevices.has(device.id);
                                return (
                                  <div
                                    key={device.id}
                                    className={`dm-device ${sel ? "dm-device--selected" : ""} ${isRegistering ? "dm-device--disabled" : ""}`}
                                    onClick={() => !isRegistering && toggleOne(device.id)}
                                  >
                                    <input
                                      type="checkbox"
                                      className="dm-cb"
                                      checked={sel}
                                      disabled={isRegistering}
                                      tabIndex={3 + index}
                                      onChange={() => toggleOne(device.id)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <div className="dm-device-icon">
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                                        <rect x="2" y="7" width="15" height="10" rx="2"/>
                                        <path d="M17 9l5-3v12l-5-3"/>
                                      </svg>
                                    </div>
                                    <div className="dm-device-info" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                      <div className="dm-device-name" style={{ fontWeight: "600", fontSize: "16px" }}>
                                        {getDeviceDisplayName(device)}
                                      </div>
                                      <div className="dm-device-ip" style={{ fontFamily: "monospace", fontSize: "13.5px" }}>
                                        {device.ip}
                                      </div>
                                    </div>
                                    {isRegistering && sel
                                      ? <RegBadge deviceId={device.id} />
                                      : (
                                        <div className={`dm-status ${device.status === "online" ? "dm-status--online" : "dm-status--offline"}`}>
                                          <span className="dm-status-dot"/>
                                          {device.status === "online" ? "Online" : "Offline"}
                                        </div>
                                      )
                                    }
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {hasScanned && !isScanning && discoveredDevices.length === 0 && (
              <div className="dm-center">
                <div className="dm-empty-icon dm-empty-icon--warn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <div className="dm-empty-title">{error ? "Discovery Failed" : "No Cameras Found"}</div>
                <div className="dm-empty-sub">
                  {error || "No ONVIF cameras were detected on the network."}
                </div>
                <button className="dm-start-btn" onClick={startDiscovery} tabIndex={1}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Try Again
                </button>
              </div>
            )}
          </div>

          {hasScanned && !isScanning && discoveredDevices.length > 0 && (
            <div className="dm-footer">
              <button
                className="dm-btn dm-btn--cancel"
                onClick={onClose}
                disabled={isRegistering}
                tabIndex={discoveredDevices.length + 3}
              >
                Cancel
              </button>
              <button
                className="dm-btn dm-btn--primary"
                disabled={isRegistering}
                onClick={() => {
                  if (selectedDevices.size === 0) {
                    setAlertMsg("Please select at least one camera checkbox from the list to add!");
                    return;
                  }
                  setAlertMsg("");
                  handleAddClick();
                }}
                tabIndex={discoveredDevices.length + 4}
              >
                {isRegistering
                  ? "Registering…"
                  : selectedDevices.size > 0
                    ? `Add ${selectedDevices.size} Camera${selectedDevices.size !== 1 ? "s" : ""}`
                    : "Add Devices"
                }
              </button>
            </div>
          )}
        </div>
      </div>

      {showCredModal && (
        <div className="dm-overlay dm-overlay--front" onClick={() => setShowCredModal(false)}>
          <div className="dm-cred-modal" onClick={(e) => e.stopPropagation()}>

            <div className="dm-header">
              <div className="dm-header-left">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Enter Camera Credentials
              </div>
              <button className="dm-close" onClick={() => setShowCredModal(false)} tabIndex={-1}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="dm-cred-body">

              <p className="dm-cred-hint">
                Enter credentials once for all selected cameras of each brand.
              </p>

              <div className="dm-cred-list">
                {selectedBrands.map((brand, bIndex) => {
                  const brandDevices = selectedGrouped[brand] || [];
                  const isLast = bIndex === selectedBrands.length - 1;
                  const baseTab = bIndex * 200 + 1;
                  return (
                    <div key={brand} className="dm-brand-cred-card">
                      {/* LEFT COLUMN: Selected camera names and group allocations */}
                      <div className="dm-brand-cred-left">
                        <div className="dm-brand-cred-header">
                          <span className="dm-brand-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                              <rect x="2" y="7" width="15" height="10" rx="2"/>
                              <path d="M17 9l5-3v12l-5-3"/>
                            </svg>
                          </span>
                          <span className="dm-brand-cred-title">
                            {brand} ({brandDevices.length} camera{brandDevices.length !== 1 ? "s" : ""})
                          </span>
                        </div>

                        <div className="dm-brand-cams-list">
                          {brandDevices.map((device, devIndex) => {
                            const camSetting = cameraCreds[device.id] || { name: getDeviceDisplayName(device), groupId: "default" };
                            const camTabBase = baseTab + devIndex * 2;
                            const isThisOpen = openDropdownId === device.id;
                            return (
                              <div key={device.id} className="dm-brand-cam-item">
                                <div className="dm-brand-cam-ip">{device.ip}</div>
                                
                                <input
                                  className="dm-cred-input dm-cam-name-input"
                                  placeholder="Camera Name"
                                  tabIndex={camTabBase}
                                  value={camSetting.name}
                                  onChange={(e) => updateCameraCred(device.id, "name", e.target.value)}
                                  autoComplete="off"
                                />

                                <div className="dm-custom-select" style={{ width: "120px" }}>
                                  <button
                                    type="button"
                                    className="dm-select-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isThisOpen) {
                                        closeDropdown();
                                      } else {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setDropdownPos({
                                          top: rect.bottom + 4,
                                          left: rect.left,
                                          width: rect.width,
                                        });
                                        setOpenDropdownId(device.id);
                                      }
                                    }}
                                  >
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {(!camSetting.groupId || camSetting.groupId === "default") 
                                        ? "Default" 
                                        : groups?.find(g => g.id === camSetting.groupId)?.name || "Default"}
                                    </span>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isThisOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s", color: "var(--text-muted)", flexShrink: 0, marginLeft: "4px" }}>
                                      <path d="M6 9l6 6 6-6"/>
                                    </svg>
                                  </button>

                                  {/* ── FIX: portaled to document.body so it can't be clipped by
                                      .dm-brand-cams-list's overflow-y: auto ── */}
                                  {isThisOpen && dropdownPos && createPortal(
                                    <ul
                                      className="dm-dropdown-menu"
                                      ref={dropdownRef}
                                      style={{
                                        position: "fixed",
                                        top: dropdownPos.top,
                                        left: dropdownPos.left,
                                        width: dropdownPos.width,
                                        zIndex: 10000,
                                      }}
                                    >
                                      <li
                                        className={`dm-dropdown-item ${(!camSetting.groupId || camSetting.groupId === "default") ? "active" : ""}`}
                                        onClick={() => { updateCameraCred(device.id, "groupId", "default"); closeDropdown(); }}
                                      >
                                        Default
                                      </li>
                                      {groups?.map((g) => (
                                        <li
                                          key={g.id}
                                          className={`dm-dropdown-item ${camSetting.groupId === g.id ? "active" : ""}`}
                                          onClick={() => { updateCameraCred(device.id, "groupId", g.id); closeDropdown(); }}
                                        >
                                          {g.name}
                                        </li>
                                      ))}
                                    </ul>,
                                    document.body
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* RIGHT COLUMN: Single Username and Password fields for the brand */}
                      <div className="dm-brand-cred-fields">
                        <div className="dm-cred-field-col">
                          <label className="dm-cred-sublabel">Username</label>
                          <input
                            className="dm-cred-input"
                            placeholder="Username"
                            tabIndex={baseTab + brandDevices.length * 2}
                            value={brandCreds[brand]?.username || ""}
                            onChange={(e) => updateBrandCred(brand, "username", e.target.value)}
                            autoComplete="off"
                          />
                        </div>

                        <div className="dm-cred-field-col">
                          <label className="dm-cred-sublabel">Password</label>
                          <div className="dm-password-wrapper">
                            <input
                              className="dm-cred-input dm-password-input"
                              placeholder="Password"
                              type={showPasswords[brand] ? "text" : "password"}
                              tabIndex={baseTab + brandDevices.length * 2 + 1}
                              value={brandCreds[brand]?.password || ""}
                              onChange={(e) => updateBrandCred(brand, "password", e.target.value)}
                              onKeyDown={(e) => handleCredKeyDown(e, brand, isLast)}
                              autoComplete="new-password"
                            />
                            <button
                              type="button"
                              className="dm-eye-btn"
                              onClick={() => togglePasswordVisibility(brand)}
                              tabIndex={-1}
                            >
                              {showPasswords[brand] ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                  <circle cx="12" cy="12" r="3"/>
                                </svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                  <line x1="1" y1="1" x2="23" y2="23"/>
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="dm-footer">
              <button
                className="dm-btn dm-btn--cancel"
                onClick={() => setShowCredModal(false)}
                tabIndex={9998}
              >
                Back
              </button>
              <button
                className="dm-btn dm-btn--primary"
                onClick={handleEnroll}
                tabIndex={9999}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Enroll & Stream
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}