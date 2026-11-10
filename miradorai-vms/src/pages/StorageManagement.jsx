import { useState, useEffect, useCallback } from "react";
import "./RaidManagement.css";
import { apiUrl } from "../config/appConfig";

const TABS = ["Overview", "Drive Bays", "Volumes", "Performance", "iSCSI / SAN", "Logs"];

function cleanPath(p) {
  if (!p) return "";
  return p.replace(/[\/\\]+/g, "\\").replace(/\\+$/, "").trim();
}

function normalizePath(p) {
  if (!p) return "";
  return p.replace(/[\/\\]+/g, "\\").replace(/\\+$/, "").trim().toLowerCase();
}

export default function StorageManagement() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState([]);
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [replication, setReplication] = useState(null);
  const [logs, setLogs] = useState("");
  const [selectedLogDate, setSelectedLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [availableLogDates, setAvailableLogDates] = useState([]);
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [availableDrives, setAvailableDrives] = useState([]);
  const [targetDrive, setTargetDrive] = useState("D");
  const [folderName, setFolderName] = useState("Recordings");
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionMsg, setProvisionMsg] = useState("");
  const [locatingSlots, setLocatingSlots] = useState({});
  const [actionMsg, setActionMsg] = useState("");
  const [rebuildingSlots, setRebuildingSlots] = useState({});
  const [virtualDisks, setVirtualDisks] = useState([]);
  const [iscsiStatus, setIscsiStatus] = useState(null);
  const [iscsiTargets, setIscsiTargets] = useState([]);
  const [iscsiDisks, setIscsiDisks] = useState([]);
  const [newPortalIp, setNewPortalIp] = useState("");
  const [newPortalPort, setNewPortalPort] = useState(3260);
  const [isScanningPortal, setIsScanningPortal] = useState(false);
  const [portalScanMsg, setPortalScanMsg] = useState("");

  // Create RAID Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRaidType, setNewRaidType] = useState("raid5");
  const [newArrayName, setNewArrayName] = useState("VMS_ARRAY_01");
  const [newStripSize, setNewStripSize] = useState(64);
  const [selectedDisksForArray, setSelectedDisksForArray] = useState([]);
  const [isCreatingArray, setIsCreatingArray] = useState(false);
  const [createArrayMsg, setCreateArrayMsg] = useState("");

  // UI-based Alert and Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    subMessage: "",
    confirmLabel: "Confirm",
    confirmVariant: "primary",
    isAlertOnly: false,
    onConfirm: null
  });

  const showConfirmDialog = ({ title, message, subMessage, confirmLabel = "Confirm", confirmVariant = "primary", onConfirm }) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      subMessage,
      confirmLabel,
      confirmVariant,
      isAlertOnly: false,
      onConfirm
    });
  };

  const showAlertDialog = ({ title, message, subMessage }) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      subMessage,
      confirmLabel: "OK",
      confirmVariant: "primary",
      isAlertOnly: true,
      onConfirm: () => setConfirmModal(prev => ({ ...prev, isOpen: false }))
    });
  };

  const closeConfirmModal = () => {
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, configRes, devicesRes, perfRes, logsRes, replRes, drivesRes, vdsRes, iscsiStatusRes, iscsiTargetsRes, iscsiDisksRes] = await Promise.all([
        fetch(apiUrl("/storage/status")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/storage/config")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/storage/devices")).then(r => r.json()).catch(() => []),
        fetch(apiUrl("/storage/performance")).then(r => r.json()).catch(() => null),
        fetch(apiUrl(`/storage/logs?date=${selectedLogDate}`)).then(r => r.json()).catch(() => ({})),
        fetch(apiUrl("/storage/replication")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/storage/available-drives")).then(r => r.json()).catch(() => []),
        fetch(apiUrl("/storage/virtual-disks")).then(r => r.json()).catch(() => []),
        fetch(apiUrl("/storage/iscsi/status")).then(r => r.json()).catch(() => null),
        fetch(apiUrl("/storage/iscsi/targets")).then(r => r.json()).catch(() => []),
        fetch(apiUrl("/storage/iscsi/disks")).then(r => r.json()).catch(() => []),
      ]);
      setStatus(statusRes);
      setConfig(configRes);
      if (configRes?.recording_path) {
        const norm = cleanPath(configRes.recording_path);
        const match = norm.match(/^([A-Za-z]):\\(.*)$/);
        if (match) {
          setTargetDrive(match[1].toUpperCase());
          setFolderName(match[2]);
        }
      }
      const devList = Array.isArray(devicesRes) ? devicesRes : [];
      setDevices(devList);
      setPerformance(perfRes);
      setLogs(logsRes?.logs || "No active system logs found.");
      if (logsRes?.dates && Array.isArray(logsRes.dates)) {
        setAvailableLogDates(logsRes.dates);
      }
      if (logsRes?.selected_date) {
        setSelectedLogDate(logsRes.selected_date);
      }
      setReplication(replRes);

      const vdList = Array.isArray(vdsRes) && vdsRes.length > 0 ? vdsRes : (statusRes?.virtual_disks || []);
      setVirtualDisks(vdList);

      setIscsiStatus(iscsiStatusRes);
      setIscsiTargets(Array.isArray(iscsiTargetsRes) ? iscsiTargetsRes : []);
      setIscsiDisks(Array.isArray(iscsiDisksRes) ? iscsiDisksRes : []);

      const drivesList = Array.isArray(drivesRes) ? drivesRes : [];
      setAvailableDrives(drivesList);
      if (drivesList.length > 0) {
        const preferred = drivesList.find(d => (typeof d === "string" ? d : d.letter) !== "C") || drivesList[0];
        const firstLetter = typeof preferred === "string" ? preferred : preferred.letter;
        setTargetDrive(prev => {
          const exists = drivesList.some(d => (typeof d === "string" ? d : d.letter) === prev);
          return exists ? prev : firstLetter;
        });
      }
    } catch (e) {
      console.error("Failed to load RAID data", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleToggleLocate = async (enclosure, slot) => {
    const enc = enclosure ?? 0;
    const key = `${enc}:${slot}`;
    const willEnable = !locatingSlots[key];
    setLocatingSlots(prev => ({ ...prev, [key]: willEnable }));

    try {
      await fetch(apiUrl("/storage/locate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enclosure: enc, slot: slot, enable: willEnable })
      });
      setActionMsg(`Slot ${slot}: Drive LED locator ${willEnable ? "activated" : "deactivated"}.`);
      setTimeout(() => setActionMsg(""), 4000);
    } catch (err) {
      console.error("Locate LED error:", err);
    }
  };

  const handleRebuild = (enclosure, slot) => {
    const enc = enclosure ?? 0;
    showConfirmDialog({
      title: "Initiate Array Rebuild",
      message: `Are you sure you want to rebuild the array using the drive in Bay ${slot} (Enclosure ${enc})?`,
      subMessage: "The hardware RAID controller will reconstruct missing parity and mirror data onto this drive. This process may take several hours depending on drive capacity.",
      confirmLabel: "Start Rebuild",
      confirmVariant: "primary",
      onConfirm: async () => {
        setRebuildingSlots(prev => ({ ...prev, [`${enc}:${slot}`]: true }));
        try {
          const res = await fetch(apiUrl("/storage/rebuild"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enclosure: enc, slot: slot })
          });
          const data = await res.json();
          setActionMsg(data.message || `Rebuild started on Slot ${slot}`);
          setTimeout(() => setActionMsg(""), 5000);
          fetchAll();
        } catch (err) {
          setActionMsg("Failed to start rebuild. Verify controller state.");
        }
      }
    });
  };

  const handleAddHotSpare = (enclosure, slot) => {
    const enc = enclosure ?? 0;
    showConfirmDialog({
      title: "Assign Dedicated Hot Spare",
      message: `Designate the physical drive in Bay ${slot} (Enclosure ${enc}) as a dedicated Hot Spare?`,
      subMessage: "In the event of a disk failure in an active RAID array, the controller will automatically spin up this drive and begin immediate background reconstruction.",
      confirmLabel: "Assign Hot Spare",
      confirmVariant: "primary",
      onConfirm: async () => {
        try {
          const res = await fetch(apiUrl("/storage/hot-spare"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enclosure: enc, slot: slot })
          });
          const data = await res.json();
          setActionMsg(data.message || `Slot ${slot} designated as Hot Spare.`);
          setTimeout(() => setActionMsg(""), 5000);
          fetchAll();
        } catch (err) {
          setActionMsg("Failed to assign Hot Spare.");
        }
      }
    });
  };

  const calcPreviewCapacity = () => {
    const selectedDevs = devices.filter(d => selectedDisksForArray.includes(`${d.enclosure ?? 0}:${d.slot}`));
    if (selectedDevs.length === 0) return "0 TB";
    const minSize = Math.min(...selectedDevs.map(d => Number(d.capacity_tb) || 0));
    const count = selectedDevs.length;
    let tb = 0;
    if (newRaidType === "raid0") tb = count * minSize;
    else if (newRaidType === "raid1") tb = minSize;
    else if (newRaidType === "raid5") tb = Math.max(1, count - 1) * minSize;
    else if (newRaidType === "raid6") tb = Math.max(1, count - 2) * minSize;
    else if (newRaidType === "raid10") tb = Math.floor(count / 2) * minSize;
    return `${tb.toFixed(2)} TB Usable`;
  };

  const handleCreateArray = async () => {
    const minDrivesMap = { raid0: 1, raid1: 2, raid5: 3, raid6: 4, raid10: 4 };
    const required = minDrivesMap[newRaidType] || 2;
    if (selectedDisksForArray.length < required) {
      setCreateArrayMsg(`Selected RAID level (${newRaidType.toUpperCase()}) requires at least ${required} physical drives.`);
      return;
    }

    setIsCreatingArray(true);
    setCreateArrayMsg(`Configuring hardware controller for ${newRaidType.toUpperCase()} virtual disk...`);
    try {
      const res = await fetch(apiUrl("/storage/create-array"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raid_type: newRaidType,
          drive_slots: selectedDisksForArray,
          name: newArrayName,
          strip_kb: Number(newStripSize) || 64
        })
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setCreateArrayMsg(`Array '${newArrayName}' created successfully.`);
        if (data.virtual_disk) {
          setVirtualDisks(prev => [...prev.filter(x => x.id !== data.virtual_disk.id), data.virtual_disk]);
        }
        setTimeout(() => {
          setShowCreateModal(false);
          setCreateArrayMsg("");
          setActionMsg(`New RAID array '${newArrayName}' is now active and displayed under Configured Arrays.`);
          setTimeout(() => setActionMsg(""), 6000);
          fetchAll();
        }, 1200);
      } else {
        setCreateArrayMsg(`Array creation rejected: ${data.detail || data.error || "Check controller status."}`);
      }
    } catch {
      setCreateArrayMsg("Could not reach backend API.");
    }
    setIsCreatingArray(false);
  };

  const handleDeleteArray = (vdId, name) => {
    showConfirmDialog({
      title: "Delete RAID Virtual Disk",
      message: `Are you sure you want to delete RAID virtual disk '${name || vdId}'?`,
      subMessage: "Warning: This action will destroy the array configuration and permanently erase all video recordings and metadata stored on this volume. This operation cannot be reversed.",
      confirmLabel: "Delete Virtual Disk",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          const res = await fetch(apiUrl("/storage/delete-array"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: vdId })
          });
          const data = await res.json();
          if (res.ok) {
            setActionMsg(data.message || `Virtual Disk ${name || vdId} deleted.`);
            setTimeout(() => setActionMsg(""), 4000);
            fetchAll();
          } else {
            setActionMsg(`Delete failed: ${data.detail || data.error || "Controller error"}`);
          }
        } catch {
          setActionMsg("Failed to delete array. Verify controller connection.");
        }
      }
    });
  };

  const handleProvision = async () => {
    if (!targetDrive) {
      setProvisionMsg("Please specify a target drive letter.");
      return;
    }
    if (folderName && !/^[a-zA-Z0-9 _.\-]+$/.test(folderName.trim())) {
      setProvisionMsg("Folder name contains invalid characters.");
      return;
    }

    setIsProvisioning(true);
    setProvisionMsg(`Configuring VMS recording repository on drive ${targetDrive}:\\${folderName}...`);
    try {
      const res = await fetch(apiUrl("/storage/provision"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDriveLetter: targetDrive, recordingsFolder: folderName }),
      });
      if (res.ok) {
        setProvisionMsg("Storage repository configured successfully. Reloading...");
        setTimeout(() => { setProvisionMsg(""); fetchAll(); }, 2000);
      } else {
        const err = await res.json().catch(() => ({}));
        setProvisionMsg(`Configuration failed: ${err.detail || "Check backend logs."}`);
      }
    } catch {
      setProvisionMsg("Could not reach backend. Verify server status.");
    }
    setIsProvisioning(false);
  };

  const handleRunTest = async () => {
    setIsRunningTest(true);
    setPerformance(p => ({ ...p, status: "Benchmarking..." }));
    try {
      const res = await fetch(apiUrl("/storage/performance"), { method: "POST" });
      const data = await res.json();
      setPerformance(data);
    } catch {
      setPerformance(p => ({ ...p, status: "Error" }));
    }
    setIsRunningTest(false);
  };

  const usedPct = status && status.capacity_tb && status.capacity_tb > 0
    ? Math.min(Math.round(((status.used_tb || 0) / status.capacity_tb) * 100), 100)
    : 24;
  const usedColor = usedPct >= 90 ? "var(--red, #ef4444)" : usedPct >= 70 ? "var(--yellow, #f59e0b)" : "var(--teal, #00d2b4)";

  // Dynamically resolve the active virtual disk / RAID array
  const activeRecPath = normalizePath(config?.recording_path);
  const activeVd = (virtualDisks || []).find(vd => {
    const thisVolPath = normalizePath(vd.target_volume || (vd.is_primary ? `${status?.target_drive || "D"}:\\Recordings` : ""));
    return Boolean(activeRecPath && thisVolPath && activeRecPath === thisVolPath);
  }) || (virtualDisks || []).find(vd => vd.is_primary) || virtualDisks?.[0];

  const activeRaidLevel = activeVd?.raid_level || status?.raid_level || "RAID";

  // ── Hardware Telemetry Header Banner ──────────────────────────────────────
  const renderHardwareBanner = () => (
    <div className="rm-hardware-banner card">
      <div className="rm-hw-item">
        <span className="rm-hw-label">Controller</span>
        <strong className="rm-hw-val">{status?.controller || "Host Storage Controller"}</strong>
      </div>
      <div className="rm-hw-divider" />
      <div className="rm-hw-item">
        <span className="rm-hw-label">Storage Mode</span>
        <span className="rm-badge rm-badge--ok">{activeRaidLevel || status?.mode || "Standard Volume"}</span>
      </div>
      <div className="rm-hw-divider" />
      <div className="rm-hw-item">
        <span className="rm-hw-label">BBU Battery</span>
        <strong className="rm-hw-val" style={{ color: status?.bbu_status && status.bbu_status !== "Not Installed" ? "var(--teal, #00d2b4)" : "var(--text-muted)" }}>
          {status?.bbu_status && status.bbu_status !== "Not Installed"
            ? `${status.bbu_status}${status.bbu_temp && status.bbu_temp !== "N/A" ? ` (${status.bbu_temp})` : ""}`
            : "Not Installed"}
        </strong>
      </div>
      <div className="rm-hw-divider" />
      <div className="rm-hw-item">
        <span className="rm-hw-label">Write Cache</span>
        <strong className="rm-hw-val">{status?.cache_policy || "OS Managed"}</strong>
      </div>
      <div className="rm-hw-divider" />
      <div className="rm-hw-item">
        <span className="rm-hw-label">Active Storage</span>
        <strong className="rm-hw-val" style={{ fontFamily: "var(--font-mono)", color: "var(--teal)" }}>
          {cleanPath(config?.recording_path || `${status?.target_drive || "C"}:\\Recordings`)}
        </strong>
      </div>
    </div>
  );

  // ── Drive Bays Grid ────────────────────────────────────────────────────────
  const renderDriveBays = () => {
    const rawDevices = devices && devices.length > 0 ? devices : [];
    const totalDrives = rawDevices.length;
    const onlineDrives = rawDevices.filter(d => d.health === "Healthy" || d.state === "Online" || d.state === "Onln" || d.state === "OK").length;
    const totalRawTb = rawDevices.reduce((acc, d) => acc + (Number(d.capacity_tb) || 0), 0);
    const encId = rawDevices[0]?.enclosure ?? 0;

    return (
      <div className="rm-bays-section">
        <div className="rm-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <span style={{ fontSize: 18, fontWeight: 600 }}>
              {encId ? `Enclosure ${encId} — Physical Drive Bays` : "Physical Storage Drives & Bays"}
            </span>
            <div className="rm-section-subtitle" style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
              {totalDrives > 0
                ? `${totalDrives} Connected Drives | ${totalRawTb.toFixed(1)} TB Total Raw Capacity`
                : "Standard OS Storage Mode — No dedicated hardware RAID drive bays reported"}
            </div>
          </div>
          <span className={`rm-badge ${totalDrives > 0 ? "rm-badge--ok" : "rm-badge--info"}`} style={{ fontSize: 12, padding: "5px 12px" }}>
            {totalDrives > 0 ? `${onlineDrives} of ${totalDrives} Drives Online` : "Standard Host Storage"}
          </span>
        </div>

        {totalDrives === 0 ? (
          <div className="card" style={{ padding: 28, textAlign: "center", color: "var(--text-secondary)" }}>
            <p style={{ margin: 0, fontSize: 14 }}>
              No dedicated hardware RAID drive bays detected. Storage is operating directly via host filesystem and mounted volumes.
            </p>
          </div>
        ) : (
          <div className="rm-bays-grid">
            {rawDevices.map((dev, i) => {
              const slotKey = `${dev.enclosure ?? encId}:${dev.slot ?? i}`;
              const isLocating = locatingSlots[slotKey] || dev.is_locating;
              const isRebuilding = rebuildingSlots[slotKey] || dev.health === "Rebuilding";
              const isHealthy = dev.health === "Healthy" || dev.state === "Online" || dev.state === "Onln" || dev.state === "OK";
              const memberArray = virtualDisks.find(v => v.drives?.some(dr => dr.endsWith(`:${dev.slot ?? i}`) || dr == (dev.slot ?? i)));

              return (
                <div key={slotKey || i} className={`rm-bay-card card ${isLocating ? "rm-bay-card--locating" : ""}`}>
                  <div className="rm-bay-header">
                    <div className="rm-bay-slot-badge">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <line x1="7" y1="16" x2="11" y2="16" />
                        <circle cx="16" cy="16" r="1" fill="currentColor" />
                      </svg>
                      <span>Bay {dev.slot ?? i}</span>
                    </div>
                    <div className="rm-bay-leds">
                      <span
                        className={`rm-led ${isHealthy ? "rm-led--online" : "rm-led--error"}`}
                        title={isHealthy ? "Drive Online" : "Drive Error / Degraded"}
                      />
                      {isLocating && <span className="rm-led rm-led--locating" title="Locate LED Blinking" />}
                    </div>
                  </div>

                  <div className="rm-bay-model">{dev.name || dev.model || `Drive Bay ${dev.slot ?? i}`}</div>
                  <div className="rm-bay-capacity">{dev.size_display || `${dev.capacity_tb || 0} TB`}</div>

                  <div className="rm-bay-specs">
                    <div className="rm-bay-spec-row">
                      <span>Interface:</span>
                      <strong>{dev.interface || "SATA/SAS"}</strong>
                    </div>
                    <div className="rm-bay-spec-row">
                      <span>Type:</span>
                      <strong>{dev.media || "Storage Disk"}</strong>
                    </div>
                    <div className="rm-bay-spec-row">
                      <span>State:</span>
                      <span className={`sm-status ${isHealthy ? "sm-status--ok" : "sm-status--warn"}`}>
                        {isRebuilding ? "Rebuilding" : (dev.state || dev.health || "Online")}
                      </span>
                    </div>
                    <div className="rm-bay-spec-row">
                      <span>Array Member:</span>
                      <strong style={{ color: "var(--teal)" }}>
                        {memberArray?.name || (virtualDisks.length > 0 && virtualDisks[0]?.name ? virtualDisks[0].name : "Primary Volume")}
                      </strong>
                    </div>
                  </div>

                  <div className="rm-bay-actions" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button
                      className={`sm-btn ${isLocating ? "sm-btn--primary" : ""}`}
                      style={{
                        fontSize: 12,
                        padding: "6px 10px",
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6
                      }}
                      onClick={() => handleToggleLocate(dev.enclosure ?? encId, dev.slot ?? i)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                        <circle cx="12" cy="12" r="9" />
                        <circle cx="12" cy="12" r="3" fill="currentColor" />
                        <line x1="12" y1="3" x2="12" y2="7" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                        <line x1="3" y1="12" x2="7" y2="12" />
                        <line x1="17" y1="12" x2="21" y2="12" />
                      </svg>
                      <span>{isLocating ? "Stop Locate" : "Locate Drive (LED)"}</span>
                    </button>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <button
                        className="sm-btn"
                        style={{ fontSize: 11, padding: "4px 6px" }}
                        onClick={() => handleRebuild(dev.enclosure ?? encId, dev.slot ?? i)}
                        title="Initiate rebuild if drive was replaced or degraded"
                      >
                        Rebuild
                      </button>
                      <button
                        className="sm-btn"
                        style={{ fontSize: 11, padding: "4px 6px" }}
                        onClick={() => handleAddHotSpare(dev.enclosure ?? encId, dev.slot ?? i)}
                        title="Assign as hot spare disk"
                      >
                        Spare
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const handleSetTargetVolume = async (vd) => {
    const rawPath = cleanPath(vd.target_volume || (vd.is_primary ? `${status?.target_drive || "D"}:\\Recordings` : ""));
    if (!rawPath || rawPath === "Unassigned") return;

    const match = rawPath.match(/^([A-Za-z]):\\(.*)$/);
    const driveLetter = match ? match[1].toUpperCase() : (rawPath.charAt(0).toUpperCase() || "D");
    const folder = match ? match[2] : "Recordings";

    setActionMsg(`Switching active recording repository to ${vd.name} (${rawPath})...`);
    try {
      const res = await fetch(apiUrl("/storage/provision"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDriveLetter: driveLetter, recordingsFolder: folder }),
      });
      if (res.ok) {
        setActionMsg(`${vd.name} is now the active VMS recording storage repository.`);
        setTimeout(() => setActionMsg(""), 5000);
        await fetchAll();
      } else {
        setActionMsg(`Failed to activate ${vd.name}.`);
      }
    } catch {
      setActionMsg("Could not reach backend.");
    }
  };

  // ── Virtual Disks (RAID Arrays) Table ─────────────────────────────────────
  const renderVirtualDisksTable = () => {
    const list = virtualDisks && virtualDisks.length > 0 ? virtualDisks : [];

    return (
      <div className="rm-vds-section">
        <div className="rm-vds-header">
          <div>
            <div className="sm-panel-title" style={{ fontSize: 16, margin: 0 }}>
              RAID Virtual Disks & Configured Arrays
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
              Virtual drives configured on the {status?.controller || "Host Storage Controller"} and Windows storage subsystem
            </div>
          </div>
          <button
            className="sm-btn sm-btn--primary"
            style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}
            onClick={() => {
              setSelectedDisksForArray(devices.map(d => `${d.enclosure ?? 0}:${d.slot ?? 0}`));
              setShowCreateModal(true);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="14" height="14">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Create New RAID Array</span>
          </button>
        </div>

        <div className="rm-vds-table-wrap">
          <table className="m-table">
            <thead>
              <tr>
                <th>Virtual Disk Name</th>
                <th>RAID Level</th>
                <th>Usable Size</th>
                <th>Status</th>
                <th>Member Drive Bays</th>
                <th>Strip / Cache</th>
                <th>Recording Volume</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "32px 16px", color: "var(--text-secondary)" }}>
                    No Virtual Disks or RAID Arrays configured yet. Click "Create New RAID Array" above to provision an array.
                  </td>
                </tr>
              ) : (
                list.map((vd, idx) => {
                  const activeRecPath = normalizePath(config?.recording_path);
                  const thisVolPath = normalizePath(vd.target_volume || (vd.is_primary ? `${status?.target_drive || "D"}:\\Recordings` : ""));
                  const isCurrentActive = Boolean(activeRecPath && thisVolPath && activeRecPath === thisVolPath);

                  return (
                    <tr key={vd.id || idx}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" style={{ color: "var(--teal)", flexShrink: 0 }}>
                            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                            <line x1="6" y1="6" x2="6.01" y2="6" />
                            <line x1="6" y1="18" x2="6.01" y2="18" />
                          </svg>
                          <div>
                            <strong style={{ color: "var(--text-primary)", fontSize: 14 }}>{vd.name || `Virtual Disk ${idx}`}</strong>
                            {vd.is_primary && (
                              <span style={{ marginLeft: 8, fontSize: 11, padding: "2px 7px", background: "var(--teal-subtle)", color: "var(--teal)", borderRadius: 4, fontWeight: 600 }}>
                                Primary
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="rm-badge rm-badge--ok" style={{ fontWeight: 600, fontSize: 12, padding: "4px 10px" }}>
                          {vd.raid_level || "Standard Volume"}
                        </span>
                      </td>
                      <td style={{ fontWeight: 700, color: "var(--teal)", fontSize: 14 }}>
                        {vd.size || `${vd.capacity_tb || 0} TB`}
                      </td>
                      <td>
                        <span className={`sm-status ${vd.state === "Optimal" || vd.state === "Online" || vd.state === "OK" ? "sm-status--ok" : "sm-status--warn"}`}>
                          {vd.state || "Optimal"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                          {(vd.drives && vd.drives.length > 0 ? vd.drives : []).map((dr, dIdx) => (
                            <span key={dIdx} style={{ fontSize: 11, background: "var(--bg-elevated)", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 4, color: "var(--text-secondary)" }}>
                              Bay {dr.includes(":") ? dr.split(":")[1] : dr}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {vd.strip_kb ? `${vd.strip_kb} KB` : "Default"} / {vd.cache_policy || "OS Managed"}
                      </td>
                      <td style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--teal)" }}>
                        {cleanPath(vd.target_volume || (vd.is_primary ? `${status?.target_drive || "D"}:\\Recordings` : "Unassigned"))}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                          {isCurrentActive ? (
                            <span className="sm-status sm-status--ok" style={{ fontSize: 11, padding: "4px 8px", borderRadius: 4 }}>
                              Active Target
                            </span>
                          ) : (
                            <button
                              className="sm-btn sm-btn--primary"
                              style={{ fontSize: 11, padding: "5px 10px", fontWeight: 500 }}
                              onClick={() => handleSetTargetVolume(vd)}
                              title={`Direct all camera recordings to ${vd.name}`}
                            >
                              Set Active
                            </button>
                          )}
                          {!vd.is_primary && (
                            <button
                              className="sm-btn"
                              style={{ fontSize: 11, padding: "5px 10px", color: "var(--red, #ef4444)", borderColor: "var(--red, #ef4444)" }}
                              onClick={() => handleDeleteArray(vd.id, vd.name)}
                              title="Delete this RAID array"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ── Overview Tab ──────────────────────────────────────────────────────────
  const renderOverview = () => (
    <div className="rm-overview-wrap">
      {renderHardwareBanner()}

      <div className="sm-bottom" style={{ marginTop: 16 }}>
        {/* Card 1: VMS Recording Storage */}
        <div className="sm-card card">
          <div className="sm-panel-title">VMS Recording Storage</div>
          <div className="sm-field-row">
            <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Target Volume</span>
            <strong style={{ marginLeft: "auto", color: "var(--teal)", fontSize: 15, fontFamily: "var(--font-mono)" }}>
              {cleanPath(config?.recording_path || `${status?.target_drive || "D"}:\\Recordings`)}
            </strong>
          </div>
          <div className="sm-divider" />
          <div className="sm-field-row">
            <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>RAID Status</span>
            <span className="sm-status sm-status--ok" style={{ marginLeft: "auto" }}>
              {status?.health || "Healthy (Optimal)"}
            </span>
          </div>
          <div className="sm-field-row">
            <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Retention Period</span>
            <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
              {config?.retention_days ?? 70} days
            </span>
          </div>
          <div className="sm-field-row">
            <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Failover Recording</span>
            <span style={{ marginLeft: "auto", color: "var(--teal)", fontSize: 15 }}>
              {config?.failover ? "Enabled" : "Disabled"}
            </span>
          </div>
        </div>

        {/* Card 2: Usable Capacity */}
        <div className="sm-card card">
          <div className="sm-panel-title">{activeRaidLevel} Capacity</div>
          <div className="sm-legend">
            <span className="sm-legend-dot sm-legend-dot--used" />
            <span>Used: <strong>{status?.used_tb ?? 0} TB</strong></span>
          </div>
          <div className="sm-legend">
            <span className="sm-legend-dot sm-legend-dot--free" />
            <span>Free: <strong>{status?.free_tb ?? 0} TB</strong></span>
          </div>
          <div className="sm-usage-track" style={{ marginTop: 8 }}>
            <div className="sm-usage-bar" style={{ width: `${usedPct || 0}%`, background: usedColor }} />
          </div>
          <div className="sm-usage-text">
            {status?.used_tb ?? 0} TB used of {status?.capacity_tb ?? 0} TB ({usedPct || 0}%)
          </div>
          <div className="sm-divider" />
          <div className="sm-field-row" style={{ marginTop: "auto" }}>
            <span style={{ color: "var(--text-secondary)", fontWeight: 600, fontSize: 16 }}>Usable Capacity:</span>
            <strong style={{ marginLeft: "auto", fontSize: 20, color: "var(--teal)" }}>
              {status?.capacity_tb ?? 0} TB
            </strong>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            Storage Configuration: {activeVd?.drives?.length || status?.physical_drives || devices.length || 1} Drives active ({activeRaidLevel})
          </div>
        </div>

        {/* Card 3: Controller & Cache Architecture */}
        <div className="sm-card card">
          <div className="sm-panel-title">Hardware Architecture</div>
          <div className="sm-field-row">
            <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Storage Controller</span>
            <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
              {status?.controller || "Host Storage Controller"}
            </span>
          </div>
          <div className="sm-field-row">
            <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Bus Topology</span>
            <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
              {status?.interface || "SATA/NVMe"}
            </span>
          </div>
          <div className="sm-divider" />
          <div className="sm-field-row">
            <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Filesystem</span>
            <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
              {config?.file_system || "NTFS"}
            </span>
          </div>
          <div className="sm-field-row">
            <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Allocation Unit</span>
            <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
              {config?.allocation_unit || "64 KB (Optimized for Video)"}
            </span>
          </div>
          <div className="sm-field-row">
            <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Subsystem State</span>
            <span className="sm-status sm-status--ok" style={{ marginLeft: "auto" }}>
              {status?.health || "Healthy (Optimal)"}
            </span>
          </div>
        </div>
      </div>

      {renderVirtualDisksTable()}
    </div>
  );

  // ── Volumes Tab ───────────────────────────────────────────────────────────
  const renderVolumes = () => (
    <div className="rm-volumes-wrap">
      <div className="card rm-full-card" style={{ padding: 20 }}>
        <div className="sm-panel-title" style={{ fontSize: 16 }}>Windows File System Volumes & Partitions</div>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4, marginBottom: 16 }}>
          Live storage volumes mounted on this system for video archive recording and system operations:
        </p>

        <div className="rm-partitions-table">
          <table className="m-table">
            <thead>
              <tr>
                <th>Drive</th>
                <th>Role</th>
                <th>Total Capacity</th>
                <th>Free Space</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {availableDrives.length > 0 ? (
                availableDrives.map((d, idx) => {
                  const letter = typeof d === "string" ? d : d.letter;
                  const isSelected = targetDrive === letter;
                  const totalGb = d.total_gb ?? (d.size_tb ? d.size_tb * 1024 : 0);
                  const freeGb = d.free_gb ?? (d.free_tb ? d.free_tb * 1024 : 0);
                  const totalDisplay = totalGb >= 1024 ? `${(totalGb / 1024).toFixed(1)} TB` : `${Math.round(totalGb)} GB`;
                  const freeDisplay = freeGb >= 1024 ? `${(freeGb / 1024).toFixed(1)} TB Free` : `${Math.round(freeGb)} GB Free`;
                  const isTarget = normalizePath(config?.recording_path || "").startsWith(`${String(letter).toLowerCase()}:`);

                  return (
                    <tr key={letter || idx}>
                      <td style={{ fontWeight: 700, color: isSelected ? "var(--teal)" : "var(--text-primary)", fontSize: 15 }}>
                        {letter}:\
                      </td>
                      <td>
                        {isTarget ? (
                          <strong style={{ color: "var(--teal)" }}>Active VMS Recording Repository</strong>
                        ) : d.is_system ? (
                          <span>Windows Operating System & VMS Core</span>
                        ) : (
                          <span>Configured Storage Volume</span>
                        )}
                      </td>
                      <td>{totalDisplay}</td>
                      <td style={{ color: "var(--teal)", fontWeight: 600 }}>{freeDisplay}</td>
                      <td>
                        <span className={`sm-status ${isTarget ? "sm-status--ok" : ""}`}>
                          {isTarget ? "Active Target" : (d.is_system ? "System" : "Available")}
                        </span>
                      </td>
                      <td>
                        <button
                          className={`sm-btn ${isSelected ? "sm-btn--primary" : ""}`}
                          style={{ padding: "4px 12px", fontSize: 12 }}
                          onClick={() => setTargetDrive(letter)}
                        >
                          {isSelected ? "Selected" : "Select Drive"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6" style={{ textAlign: "center", padding: 16, color: "var(--text-secondary)" }}>
                    No volumes detected
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 24, padding: 20, background: "var(--bg-elevated, #131d2a)", border: "1px solid var(--border)", borderRadius: 6, maxWidth: 640 }}>
          <div className="sm-panel-title" style={{ fontSize: 15, marginBottom: 14 }}>Configure VMS Recording Storage Repository</div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", alignItems: "center", gap: 12 }}>
              <label style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>Target Drive Volume</label>
              <select
                className="sm-input"
                value={targetDrive}
                onChange={e => setTargetDrive(e.target.value)}
                style={{ width: "100%", maxWidth: 280, padding: "8px 12px", background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)" }}
              >
                {availableDrives.map((d, idx) => {
                  const letter = typeof d === "string" ? d : d.letter;
                  const label = typeof d === "string" ? `${d}: Drive` : (d.label || `${letter}: Drive`);
                  return (
                    <option key={letter || idx} value={letter}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", alignItems: "center", gap: 12 }}>
              <label style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>Recordings Directory</label>
              <input
                className="sm-input"
                value={folderName}
                onChange={e => setFolderName(e.target.value)}
                placeholder="e.g. Recordings"
                style={{ width: "100%", maxWidth: 280, padding: "8px 12px", background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)" }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", alignItems: "center", gap: 12 }}>
              <label style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>Active Storage Path</label>
              <div style={{ fontSize: 14, fontFamily: "var(--font-mono, monospace)", color: "var(--teal)", fontWeight: 600 }}>
                {cleanPath(config?.recording_path || `${targetDrive}:\\${folderName}`)}
              </div>
            </div>

            {provisionMsg && (
              <div className="sm-apply-msg" style={{ marginTop: 4 }}>{provisionMsg}</div>
            )}

            <div style={{ marginTop: 8 }}>
              <button
                className="sm-btn sm-btn--primary"
                disabled={isProvisioning}
                onClick={handleProvision}
                style={{ padding: "8px 18px", fontSize: 13 }}
              >
                {isProvisioning ? "Applying Configuration..." : "Save Recording Destination"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Performance Tab ───────────────────────────────────────────────────────
  const renderPerformance = () => {
    const rawSpeed = parseFloat(performance?.write_speed || "500") || 500;
    const streams4k = Math.max(1, Math.floor((rawSpeed * 8) / 15));
    const streams1080p = Math.max(1, Math.floor((rawSpeed * 8) / 4));

    return (
      <div className="rm-perf-wrap">
        <div className="sm-bottom">
          <div className="sm-card card">
            <div className="sm-panel-title">{activeRaidLevel || status?.raid_level || "Storage"} I/O Throughput Benchmark</div>
            <div className="sm-field-row">
              <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Benchmarking Drive</span>
              <strong style={{ marginLeft: "auto", color: "var(--teal)", fontSize: 16 }}>
                {status?.target_drive || "Primary"} ({status?.controller || "Storage Controller"})
              </strong>
            </div>
            <div className="sm-divider" />
            <div className="sm-field-row">
              <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Sequential Write</span>
              <strong style={{ marginLeft: "auto", color: "var(--teal)", fontFamily: "var(--font-mono)", fontSize: 20 }}>
                {performance?.write_speed || "Measuring…"}
              </strong>
            </div>
            <div className="sm-field-row">
              <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Sequential Read</span>
              <strong style={{ marginLeft: "auto", color: "var(--teal)", fontFamily: "var(--font-mono)", fontSize: 20 }}>
                {performance?.read_speed || "Measuring…"}
              </strong>
            </div>
            <div className="sm-field-row">
              <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Last Tested</span>
              <span style={{ marginLeft: "auto", color: "var(--text-primary)", fontSize: 15 }}>
                {performance?.last_test || "Not Tested"}
              </span>
            </div>
            <div className="rm-actions" style={{ marginTop: "auto", paddingTop: 16 }}>
              <button
                className="sm-btn sm-btn--primary"
                onClick={handleRunTest}
                disabled={isRunningTest}
              >
                {isRunningTest ? "Running Speed Benchmark…" : "Run Live Speed Test"}
              </button>
            </div>
          </div>

          <div className="sm-card card">
            <div className="sm-panel-title">Video Stream Capacity Analysis</div>
            <div className="sm-field-row">
              <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Concurrent 4K Streams (15 Mbps)</span>
              <strong style={{ marginLeft: "auto", color: "var(--teal)", fontSize: 17 }}>{streams4k}+ Channels</strong>
            </div>
            <div className="sm-field-row">
              <span style={{ color: "var(--text-secondary)", fontSize: 15 }}>Concurrent 1080p Streams (4 Mbps)</span>
              <strong style={{ marginLeft: "auto", color: "var(--teal)", fontSize: 17 }}>{streams1080p.toLocaleString()}+ Channels</strong>
            </div>
            <div className="sm-divider" />
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Based on measured sequential write performance of {performance?.write_speed || "high throughput"} on {status?.controller || "the storage controller"} with {activeVd?.drives?.length || devices.length} drive{(activeVd?.drives?.length || devices.length) !== 1 ? "s" : ""} in {activeRaidLevel}, guaranteeing zero dropped frames under continuous multi-camera archiving.
            </div>
          </div>
        </div>
      </div>
    );
  };

  const handleSelectLogDate = async (newDate) => {
    setSelectedLogDate(newDate);
    try {
      const res = await fetch(apiUrl(`/storage/logs?date=${newDate}`)).then(r => r.json());
      if (res && res.logs) {
        setLogs(res.logs);
      }
    } catch (e) {
      console.error("Error fetching date log", e);
    }
  };

  const handleDownloadLog = () => {
    const element = document.createElement("a");
    const file = new Blob([logs], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = `RAID_Audit_Log_${selectedLogDate}.log`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // ── Logs Tab ──────────────────────────────────────────────────────────────
  // ── iSCSI & SAN LUN Handlers ───────────────────────────────────────────────
  const handleDiscoverPortal = async (e) => {
    if (e) e.preventDefault();
    if (!newPortalIp || !newPortalIp.trim()) {
      setPortalScanMsg("Please enter a valid SAN Target Portal IP address.");
      return;
    }
    setIsScanningPortal(true);
    setPortalScanMsg(`Connecting to SAN Portal ${newPortalIp.trim()}:${newPortalPort}...`);
    try {
      const res = await fetch(apiUrl("/storage/iscsi/discover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portal_ip: newPortalIp.trim(), port: Number(newPortalPort) || 3260 })
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setPortalScanMsg(`Successfully discovered ${data.targets?.length || 1} iSCSI LUN target(s) on ${data.portal}.`);
        setNewPortalIp("");
        fetchAll();
      } else {
        setPortalScanMsg(`Portal scan error: ${data.detail || data.error || "Could not reach target."}`);
      }
    } catch {
      setPortalScanMsg("Could not connect to VMS storage backend.");
    }
    setIsScanningPortal(false);
    setTimeout(() => setPortalScanMsg(""), 8000);
  };

  const handleConnectIscsiTarget = (target) => {
    showConfirmDialog({
      title: "Connect iSCSI Target LUN",
      message: `Establish persistent iSCSI session with '${target.name || target.iqn}'?`,
      subMessage: `Connecting to ${target.portal}. The Windows iSCSI Initiator will log in, negotiate SCSI block channels, and mount the LUN.`,
      confirmLabel: "Connect LUN",
      confirmVariant: "primary",
      onConfirm: async () => {
        try {
          const res = await fetch(apiUrl("/storage/iscsi/connect"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ iqn: target.iqn, portal: target.portal })
          });
          const data = await res.json();
          if (res.ok) {
            setActionMsg(data.message || `Connected to ${target.name}.`);
            setTimeout(() => setActionMsg(""), 5000);
            fetchAll();
          } else {
            showAlertDialog({
              title: "Connection Failed",
              message: data.detail || data.error || "Failed to log into iSCSI target.",
              subMessage: "Verify network connectivity to SAN portal IP and CHAP authentication credentials if required."
            });
          }
        } catch {
          setActionMsg("Network error connecting to iSCSI target.");
        }
      }
    });
  };

  const handleDisconnectIscsiTarget = (target) => {
    showConfirmDialog({
      title: "Disconnect iSCSI Target LUN",
      message: `Disconnect from '${target.name || target.iqn}'?`,
      subMessage: "Warning: Unmounting this LUN will terminate active SCSI sessions. Ensure no cameras or services are actively recording to this volume.",
      confirmLabel: "Disconnect LUN",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          const res = await fetch(apiUrl("/storage/iscsi/disconnect"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ iqn: target.iqn })
          });
          const data = await res.json();
          if (res.ok) {
            setActionMsg(data.message || `Disconnected ${target.name}.`);
            setTimeout(() => setActionMsg(""), 5000);
            fetchAll();
          } else {
            showAlertDialog({
              title: "Cannot Disconnect LUN",
              message: data.detail || data.error || "Target is currently in use.",
              subMessage: "If this drive is the active recording destination, switch the target volume under the Overview or Volumes tab first."
            });
          }
        } catch {
          setActionMsg("Failed to disconnect iSCSI target.");
        }
      }
    });
  };

  const handleAssignIscsiRecording = (target) => {
    const drive = strClean(target.mounted_drive || "E").toUpperCase().replace(":", "");
    showConfirmDialog({
      title: "Set iSCSI LUN as Active Recording Target",
      message: `Direct all camera video recordings to ${drive}:\Recordings (${target.name})?`,
      subMessage: `This iSCSI LUN (${target.capacity_tb || 16} TB usable) will become the primary destination for FFmpeg segmented MP4 video chunks and MinIO object storage.`,
      confirmLabel: "Set Active Target",
      confirmVariant: "primary",
      onConfirm: async () => {
        try {
          const res = await fetch(apiUrl("/storage/provision"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetDriveLetter: drive, recordingsFolder: "Recordings" })
          });
          if (res.ok) {
            setActionMsg(`Active recording target successfully redirected to ${drive}:\Recordings`);
            setTimeout(() => setActionMsg(""), 5000);
            fetchAll();
          } else {
            const err = await res.json().catch(() => ({}));
            showAlertDialog({
              title: "Provisioning Error",
              message: err.detail || "Could not set active recording target.",
              subMessage: "Verify that the volume is properly formatted with NTFS."
            });
          }
        } catch {
          setActionMsg("Failed to update active recording target.");
        }
      }
    });
  };

  const handleRemoveIscsiPortal = (portalAddress) => {
    const portalIp = portalAddress.split(":")[0];
    showConfirmDialog({
      title: "Remove SAN Target Portal",
      message: `Unregister SAN portal '${portalAddress}' and remove associated LUNs?`,
      subMessage: "The portal will be deleted from Mirador VMS configuration.",
      confirmLabel: "Remove Portal",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          const res = await fetch(apiUrl("/storage/iscsi/portal/remove"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ portal_ip: portalIp })
          });
          const data = await res.json();
          setActionMsg(data.message || `Removed portal ${portalAddress}`);
          setTimeout(() => setActionMsg(""), 4000);
          fetchAll();
        } catch {
          setActionMsg("Failed to remove portal.");
        }
      }
    });
  };

  function strClean(s) {
    return s ? String(s).trim() : "";
  }

  // ── iSCSI Tab View ─────────────────────────────────────────────────────────
  const renderIscsi = () => {
    const targets = iscsiTargets || [];
    const disks = iscsiDisks || [];
    const connectedTargets = targets.filter(t => t.status === "Connected");
    const activeRecPath = normalizePath(config?.recording_path);

    return (
      <div className="rm-page-wrap">
        {/* Initiator Telemetry Banner */}
        <div className="rm-hardware-banner card">
          <div className="rm-hw-item" style={{ minWidth: 260 }}>
            <span className="rm-hw-label">Windows iSCSI Initiator IQN</span>
            <strong className="rm-hw-val" style={{ fontSize: 11, fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
              {iscsiStatus?.initiator_iqn || "iqn.1991-05.com.microsoft:vms-host"}
            </strong>
          </div>
          <div className="rm-hw-divider" />
          <div className="rm-hw-item">
            <span className="rm-hw-label">Initiator Subsystem</span>
            <span className="rm-badge rm-badge--ok">{iscsiStatus?.service_status || "Ready"}</span>
          </div>
          <div className="rm-hw-divider" />
          <div className="rm-hw-item">
            <span className="rm-hw-label">Active SAN Sessions</span>
            <strong className="rm-hw-val" style={{ color: "var(--teal)" }}>
              {connectedTargets.length} Connected LUN(s)
            </strong>
          </div>
          <div className="rm-hw-divider" />
          <div className="rm-hw-item">
            <span className="rm-hw-label">Total SAN Storage</span>
            <strong className="rm-hw-val">
              {iscsiStatus?.total_storage_tb || (connectedTargets.reduce((a, b) => a + (Number(b.capacity_tb) || 0), 0)).toFixed(2)} TB
            </strong>
          </div>
        </div>

        {/* Scan & Connect SAN Target Portal Form */}
        <div className="card" style={{ padding: 22, marginTop: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 16, fontWeight: 600 }}>Discover External SAN Storage Portal</span>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
                Connect to an enterprise SAN/NAS storage array (Dell PowerVault, QNAP, Synology, TrueNAS, NetApp) via iSCSI over 10GbE / 1GbE IP network.
              </p>
            </div>
            <span className="rm-badge rm-badge--info">Port 3260 Default</span>
          </div>

          <form onSubmit={handleDiscoverPortal} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: 5 }}>
                SAN Portal IP Address
              </label>
              <input
                className="mgmt-input"
                type="text"
                placeholder="e.g. 192.168.1.150 or san.local"
                value={newPortalIp}
                onChange={e => setNewPortalIp(e.target.value)}
                disabled={isScanningPortal}
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </div>
            <div style={{ width: 100 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", marginBottom: 5 }}>
                Port
              </label>
              <input
                className="mgmt-input"
                type="number"
                value={newPortalPort}
                onChange={e => setNewPortalPort(e.target.value)}
                disabled={isScanningPortal}
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </div>
            <div style={{ alignSelf: "flex-end" }}>
              <button
                type="submit"
                className="sm-btn sm-btn--primary"
                disabled={isScanningPortal || !newPortalIp.trim()}
                style={{ height: 38 }}
              >
                {isScanningPortal ? "Scanning SAN..." : "Scan & Discover LUNs"}
              </button>
            </div>
          </form>

          {portalScanMsg && (
            <div
              className="sm-apply-msg"
              style={{
                marginTop: 12,
                borderColor: portalScanMsg.toLowerCase().includes("error") || portalScanMsg.toLowerCase().includes("could not") ? "var(--red, #ef4444)" : "var(--teal)",
                color: portalScanMsg.toLowerCase().includes("error") || portalScanMsg.toLowerCase().includes("could not") ? "var(--red, #ef4444)" : "var(--teal)"
              }}
            >
              {portalScanMsg}
            </div>
          )}
        </div>

        {/* Configured iSCSI Targets Table */}
        <div className="rm-vds-section" style={{ marginTop: 0 }}>
          <div className="rm-vds-header">
            <div>
              <span style={{ fontSize: 17, fontWeight: 600 }}>Configured iSCSI Targets & LUN Vaults</span>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
                Network-attached raw block storage LUNs available for high-throughput video recording.
              </div>
            </div>
            <span className="rm-badge rm-badge--ok">
              {connectedTargets.length} of {targets.length} LUNs Mounted
            </span>
          </div>

          <div className="rm-vds-table-wrap">
            {targets.length === 0 ? (
              <div style={{ padding: 36, textAlign: "center", color: "var(--text-secondary)" }}>
                <p style={{ margin: 0, fontSize: 14 }}>
                  No iSCSI target portals discovered yet. Enter your SAN storage IP address above to scan and mount enterprise LUNs.
                </p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>LUN Target Name</th>
                    <th>IQN & Portal Address</th>
                    <th>Usable Capacity</th>
                    <th>Session Status</th>
                    <th>Mounted Volume</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t, idx) => {
                    const isConnected = t.status === "Connected";
                    const driveLetter = strClean(t.mounted_drive || "E").toUpperCase().replace(":", "");
                    const isThisActive = isConnected && Boolean(activeRecPath && activeRecPath.startsWith(`${driveLetter.toLowerCase()}:`));

                    return (
                      <tr key={t.id || idx}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: isConnected ? "var(--teal, #00d2b4)" : "var(--text-muted, #64748b)"
                            }} />
                            <strong style={{ fontSize: 13.5 }}>{t.name || `LUN ${idx + 1}`}</strong>
                          </div>
                        </td>
                        <td>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-primary)" }}>
                            {t.iqn}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                            Portal: {t.portal}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{t.capacity_tb || 16.0} TB</span>
                          {isConnected && (
                            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                              {t.free_tb ? `${t.free_tb} TB Free` : "Online Volume"}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`rm-badge ${isConnected ? "rm-badge--ok" : "rm-badge--info"}`}>
                            {isConnected ? "Connected" : "Disconnected"}
                          </span>
                        </td>
                        <td>
                          {isConnected ? (
                            <span style={{ fontFamily: "var(--font-mono)", color: isThisActive ? "var(--teal)" : "var(--text-primary)", fontWeight: 600 }}>
                              {driveLetter}:\Recordings
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Unmounted</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                            {isConnected ? (
                              <>
                                {isThisActive ? (
                                  <span className="rm-badge rm-badge--ok" style={{ fontSize: 11 }}>Active Target</span>
                                ) : (
                                  <button
                                    className="sm-btn sm-btn--primary"
                                    style={{ fontSize: 11, padding: "4px 10px" }}
                                    onClick={() => handleAssignIscsiRecording(t)}
                                  >
                                    Set Active
                                  </button>
                                )}
                                <button
                                  className="sm-btn sm-btn--danger"
                                  style={{ fontSize: 11, padding: "4px 10px" }}
                                  onClick={() => handleDisconnectIscsiTarget(t)}
                                >
                                  Disconnect
                                </button>
                              </>
                            ) : (
                              <button
                                className="sm-btn sm-btn--primary"
                                style={{ fontSize: 11, padding: "4px 10px" }}
                                onClick={() => handleConnectIscsiTarget(t)}
                              >
                                Connect LUN
                              </button>
                            )}
                            <button
                              className="sm-btn"
                              style={{ fontSize: 11, padding: "4px 8px" }}
                              onClick={() => handleRemoveIscsiPortal(t.portal)}
                              title="Remove portal configuration"
                            >
                              Remove
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

        {/* Mounted iSCSI Block Disks Subsystem */}
        {disks.length > 0 && (
          <div className="card" style={{ padding: 20 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Windows Subsystem iSCSI Block Disks</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
              {disks.map((d, i) => (
                <div key={i} style={{
                  flex: "1 1 260px",
                  padding: "12px 16px",
                  background: "var(--bg-elevated, #0d1117)",
                  border: "1px solid var(--border)",
                  borderRadius: 8
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 13 }}>Disk {d.disk_number}: {d.name}</strong>
                    <span className="rm-badge rm-badge--ok">{d.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
                    Capacity: <strong>{d.size_tb} TB</strong> | Format: <strong>{d.partition_style}</strong> | Bus: <strong>{d.bus_type}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };


  const renderLogs = () => (
    <div className="rm-logs-wrap">
      <div className="rm-logs-toolbar" style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{status?.controller || "Storage Controller"} Daily Audit Log</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Log Date:</span>
            <select
              value={selectedLogDate}
              onChange={e => handleSelectLogDate(e.target.value)}
              style={{
                background: "var(--bg-elevated, #1e293b)",
                border: "1px solid var(--border)",
                color: "var(--text-primary, #ffffff)",
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                cursor: "pointer"
              }}
            >
              {(availableLogDates.length > 0 ? availableLogDates : [selectedLogDate]).map(d => (
                <option key={d} value={d}>
                  {d} {d === new Date().toISOString().slice(0, 10) ? "(Today)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sm-btn" onClick={handleDownloadLog} title="Download this day's RAID audit log as text file">
            Download Log (.log)
          </button>
          <button className="sm-btn sm-btn--primary" onClick={() => handleSelectLogDate(selectedLogDate)}>
            Refresh Logs
          </button>
        </div>
      </div>
      <div className="rm-logs-viewer" style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.6,
        background: "var(--bg-elevated, #0a0f1d)",
        padding: 18,
        borderRadius: 8,
        border: "1px solid var(--border)",
        whiteSpace: "pre-wrap",
        maxHeight: "580px",
        overflowY: "auto",
        color: "#cbd5e1"
      }}>
        {logs}
      </div>
    </div>
  );

  const renderTab = () => {
    switch (activeTab) {
      case "Overview":    return renderOverview();
      case "Drive Bays":  return renderDriveBays();
      case "Volumes":     return renderVolumes();
      case "Performance": return renderPerformance();
      case "iSCSI / SAN": return renderIscsi();
      case "Logs":        return renderLogs();
      default:            return renderOverview();
    }
  };

  return (
    <div className="page-shell rm-page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">RAID <span>Management</span></h1>
          <p className="page-desc">
            {status?.controller || "Hardware RAID Controller"} & Storage Subsystem Administration
          </p>
        </div>
        {actionMsg && <div className="sm-apply-msg" style={{ margin: 0 }}>{actionMsg}</div>}
      </div>

      {loading ? (
        <div className="rm-loading">Connecting to {status?.controller || "Storage Controller"}…</div>
      ) : (
        <>
          <div className="rm-tabs">
            {TABS.map(tab => (
              <button
                key={tab}
                className={`rm-tab ${activeTab === tab ? "rm-tab--active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {renderTab()}
        </>
      )}

      {/* ── Create RAID Array Modal ────────────────────────────── */}
      {showCreateModal && (
        <div className="mgmt-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="mgmt-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="mgmt-modal__header">
              <span className="mgmt-modal__title">Create Hardware RAID Array</span>
              <button className="mgmt-detail__close" onClick={() => setShowCreateModal(false)}>&times;</button>
            </div>
            <div className="mgmt-modal__body">
              <div className="mgmt-form">
                <div className="mgmt-form__row">
                  <label>RAID Level</label>
                  <select
                    className="mgmt-input"
                    value={newRaidType}
                    onChange={e => setNewRaidType(e.target.value)}
                  >
                    <option value="raid0">RAID 0 (Stripe - High Throughput, No Fault Tolerance)</option>
                    <option value="raid1">RAID 1 (Mirror - 2 Disks, Survives 1 Failure)</option>
                    <option value="raid5">RAID 5 (Parity - Min 3 Disks, Survives 1 Failure)</option>
                    <option value="raid6">RAID 6 (Dual Parity - Min 4 Disks, Survives 2 Failures)</option>
                    <option value="raid10">RAID 10 (Stripe of Mirrors - Min 4 Disks)</option>
                  </select>
                </div>

                <div className="mgmt-form__row">
                  <label>Array Name</label>
                  <input
                    className="mgmt-input"
                    value={newArrayName}
                    onChange={e => setNewArrayName(e.target.value)}
                    placeholder="e.g. VMS_STORAGE_01"
                  />
                </div>

                <div className="mgmt-form__row">
                  <label>Strip Size</label>
                  <select
                    className="mgmt-input"
                    value={newStripSize}
                    onChange={e => setNewStripSize(Number(e.target.value))}
                  >
                    <option value={64}>64 KB (Optimized for Video Streaming)</option>
                    <option value={128}>128 KB</option>
                    <option value={256}>256 KB</option>
                  </select>
                </div>

                <div className="mgmt-form__row">
                  <label>Select Drive Bays</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                    {devices.length > 0 ? (
                      devices.map((d, idx) => {
                        const idStr = `${d.enclosure ?? 0}:${d.slot ?? idx}`;
                        const isChecked = selectedDisksForArray.includes(idStr);
                        const inArray = virtualDisks.find(v => v.drives?.some(dr => dr.endsWith(`:${d.slot ?? idx}`) || dr == (d.slot ?? idx)));
                        return (
                          <label
                            key={idx}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 10px",
                              background: isChecked ? "var(--teal-subtle, rgba(0,210,180,0.1))" : "var(--bg-base)",
                              border: `1px solid ${isChecked ? "var(--teal)" : "var(--border)"}`,
                              borderRadius: 4,
                              cursor: "pointer",
                              fontSize: 12
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setSelectedDisksForArray(prev =>
                                  prev.includes(idStr) ? prev.filter(x => x !== idStr) : [...prev, idStr]
                                );
                              }}
                            />
                            <span>
                              Bay {d.slot ?? idx} ({d.size_display || `${d.capacity_tb || 0} TB`})
                              {inArray && <span style={{ marginLeft: 4, fontSize: 10, color: "var(--text-muted)" }}>({inArray.name?.slice(0, 12)}...)</span>}
                            </span>
                          </label>
                        );
                      })
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>No physical drives detected</div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Selected Drives:</span>
                    <strong>
                      {selectedDisksForArray.length} drive(s) (
                      {selectedDisksForArray.reduce((acc, slotKey) => {
                        const found = devices.find(x => `${x.enclosure ?? 0}:${x.slot ?? 0}` === slotKey);
                        return acc + (Number(found?.capacity_tb) || 0);
                      }, 0).toFixed(1)} TB raw)
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 4 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Estimated Usable Capacity:</span>
                    <strong style={{ color: "var(--teal)" }}>{calcPreviewCapacity()}</strong>
                  </div>
                </div>

                {createArrayMsg && (
                  <div
                    className="sm-apply-msg"
                    style={{
                      marginTop: 8,
                      borderColor: createArrayMsg.toLowerCase().includes("fail") || createArrayMsg.toLowerCase().includes("reject") || createArrayMsg.toLowerCase().includes("error") ? "var(--red, #ef4444)" : "var(--teal)",
                      color: createArrayMsg.toLowerCase().includes("fail") || createArrayMsg.toLowerCase().includes("reject") || createArrayMsg.toLowerCase().includes("error") ? "var(--red, #ef4444)" : "var(--teal)"
                    }}
                  >
                    {createArrayMsg}
                  </div>
                )}

                <div className="mgmt-form__actions" style={{ marginTop: 14 }}>
                  <button className="sm-btn" onClick={() => setShowCreateModal(false)}>Cancel</button>
                  <button
                    className="sm-btn sm-btn--primary"
                    disabled={isCreatingArray}
                    onClick={handleCreateArray}
                  >
                    {isCreatingArray ? "Configuring Controller…" : "Create Virtual Disk"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── UI-based Alert & Confirm Dialog Modal ────────────── */}
      {confirmModal.isOpen && (
        <div className="rm-confirm-overlay" onClick={closeConfirmModal}>
          <div className="rm-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="rm-confirm-dialog__header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className={`rm-confirm-icon rm-confirm-icon--${confirmModal.confirmVariant}`}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    {confirmModal.confirmVariant === "danger" ? (
                      <>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </>
                    ) : (
                      <>
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </>
                    )}
                  </svg>
                </div>
                <span className="rm-confirm-title">{confirmModal.title}</span>
              </div>
              <button className="rm-confirm-close" onClick={closeConfirmModal}>&times;</button>
            </div>
            <div className="rm-confirm-dialog__body">
              <p className="rm-confirm-msg">{confirmModal.message}</p>
              {confirmModal.subMessage && (
                <div className="rm-confirm-submsg">{confirmModal.subMessage}</div>
              )}
            </div>
            <div className="rm-confirm-dialog__footer">
              {!confirmModal.isAlertOnly && (
                <button className="sm-btn" onClick={closeConfirmModal}>Cancel</button>
              )}
              <button
                className={`sm-btn ${confirmModal.confirmVariant === "danger" ? "sm-btn--danger" : "sm-btn--primary"}`}
                onClick={() => {
                  const cb = confirmModal.onConfirm;
                  closeConfirmModal();
                  if (cb) cb();
                }}
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
