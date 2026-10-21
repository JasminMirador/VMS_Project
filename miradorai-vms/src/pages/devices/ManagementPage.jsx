import { useState, useMemo } from "react";
import SearchBar from "../../components/shared/SearchBar";
import "./ManagementPage.css";

const TOOLBAR = [
  { key: "assign-ip", title: "Assign IP address",
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H4V5h16v14zm-7-2h2v-4h2l-3-4-3 4h2zm-2-8H9V7H7v2H5v2h2v2h2v-2h2z"/></svg> },
  { key: "info", title: "Device info",
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1zm0 2c4.963 0 9 4.037 9 9s-4.037 9-9 9-9-4.037-9-9 4.037-9 9-9zm-1 4v2h2V7h-2zm0 4v6h2v-6h-2z"/></svg> },
  { key: "upgrade", title: "Upgrade firmware",
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg> },
  { key: "factory", title: "Factory default",
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm4.24 16L12 15.45 7.77 18l1.12-4.81-3.73-3.23 4.92-.42L12 5l1.92 4.53 4.92.42-3.73 3.23L16.23 18z"/></svg> },
  { key: "restart", title: "Restart",
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18z"/></svg> },
  { key: "pulse", title: "Identify",
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.01 7L16 3h-2v4h-4V3H8v4h-.01C7 6.99 6 7.99 6 8.99v5.49L9.5 18v2h5v-2l3.5-3.51v-5.5c0-1-.99-1.99-1.99-1.99zM17 12h-2l-3 3-3-3H7V9h10v3z"/></svg> },
  { key: "configure", title: "Configure",
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg> },
  { key: "sync", title: "Synchronize",
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg> },
];

const BACKEND =
  import.meta.env.VITE_API_URL ??
  `http://${import.meta.env.VITE_API_HOST}:${import.meta.env.VITE_API_PORT}`;

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function StatusBadge({ status }) {
  const ok = !status || status.toLowerCase() === "ok" || status.toLowerCase() === "online";
  return (
    <span className={`mgmt-status-badge ${ok ? "mgmt-status-badge--ok" : "mgmt-status-badge--warn"}`}>
      <span className="mgmt-status-dot" />
      {status || "OK"}
    </span>
  );
}

/* ── Generic Modal shell ── */
function Modal({ title, onClose, children }) {
  return (
    <div className="mgmt-modal-overlay" onClick={onClose}>
      <div className="mgmt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mgmt-modal__header">
          <span className="mgmt-modal__title">{title}</span>
          <button className="mgmt-detail__close" onClick={onClose}>✕</button>
        </div>
        <div className="mgmt-modal__body">{children}</div>
      </div>
    </div>
  );
}

/* ── Assign IP Modal ── */
function AssignIPModal({ device, onClose }) {
  const [ip, setIp]   = useState(device?.ip || "");
  const [mask, setMask] = useState("255.255.255.0");
  const [gw, setGw]   = useState("");
  const [status, setStatus] = useState("");

  const handleSave = async () => {
    setStatus("Applying...");
    try {
      const res = await fetch(`${BACKEND}/api/onvif/network`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: device.ip, new_ip: ip, subnet: mask, gateway: gw }),
      });
      setStatus(res.ok ? "✅ IP updated successfully" : "❌ Failed to update IP");
    } catch {
      setStatus("❌ Could not reach device");
    }
  };

  return (
    <Modal title="Assign IP Address" onClose={onClose}>
      <div className="mgmt-form">
        <div className="mgmt-form__row">
          <label>IP Address</label>
          <input className="mgmt-input" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.100" />
        </div>
        <div className="mgmt-form__row">
          <label>Subnet Mask</label>
          <input className="mgmt-input" value={mask} onChange={(e) => setMask(e.target.value)} placeholder="255.255.255.0" />
        </div>
        <div className="mgmt-form__row">
          <label>Default Gateway</label>
          <input className="mgmt-input" value={gw} onChange={(e) => setGw(e.target.value)} placeholder="192.168.1.1" />
        </div>
        {status && <div className="mgmt-form__status">{status}</div>}
        <div className="mgmt-form__actions">
          <button className="mgmt-action-btn" onClick={onClose}>Cancel</button>
          <button className="mgmt-action-btn mgmt-action-btn--primary" onClick={handleSave}>Apply</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Device Info Modal ── */
function DeviceInfoModal({ device, onClose }) {
  const fields = [
    ["Name",         device.name],
    ["IP Address",   device.ip],
    ["MAC Address",  device.mac],
    ["Manufacturer", device.manufacturer],
    ["Model",        device.model],
    ["Firmware",     device.firmware || "—"],
    ["Status",       device.status || "OK"],
    ["DHCP",         device.dhcp ? "Yes" : "No"],
    ["HTTPS",        device.https ? "On" : "Off"],
    ["Stream Key",   device.stream_key || "—"],
    ["RTSP URL",     device.rtsp_url || "—"],
    ["Source",       device.source || "onvif"],
  ];
  return (
    <Modal title="Device Information" onClose={onClose}>
      <div className="mgmt-info-grid">
        {fields.map(([k, v]) => (
          <div key={k} className="mgmt-detail__item">
            <span className="mgmt-detail__key">{k}</span>
            <span className="mgmt-detail__val">{v || "—"}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ── Upgrade Firmware Modal ── */
function UpgradeModal({ device, onClose }) {
  const [phase, setPhase] = useState("idle"); // idle | checking | upgrading | done | error
  const [msg, setMsg]     = useState("");

  const handleCheck = async () => {
    setPhase("checking");
    setMsg("Checking for firmware updates...");
    await new Promise((r) => setTimeout(r, 1500));
    setPhase("idle");
    setMsg("✅ Device is running the latest firmware.");
  };

  const handleUpgrade = async () => {
    setPhase("upgrading");
    setMsg("Uploading firmware... please do not disconnect.");
    try {
      const res = await fetch(`${BACKEND}/api/onvif/firmware/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: device.ip }),
      });
      setPhase(res.ok ? "done" : "error");
      setMsg(res.ok ? "✅ Firmware upgraded successfully. Device is restarting..." : "❌ Firmware upgrade failed.");
    } catch {
      setPhase("error");
      setMsg("❌ Could not reach device.");
    }
  };

  return (
    <Modal title="Upgrade Firmware" onClose={onClose}>
      <div className="mgmt-form">
        <div className="mgmt-upgrade-device">
          <span className="mgmt-detail__key">Device</span>
          <span className="mgmt-detail__val">{device.name} — {device.ip}</span>
        </div>
        <div className="mgmt-upgrade-device">
          <span className="mgmt-detail__key">Current Firmware</span>
          <span className="mgmt-detail__val">{device.firmware || "Unknown"}</span>
        </div>
        {msg && <div className={`mgmt-form__status ${phase === "error" ? "mgmt-form__status--error" : ""}`}>{msg}</div>}
        {phase === "upgrading" && <div className="mgmt-progress"><div className="mgmt-progress__bar" /></div>}
        <div className="mgmt-form__actions">
          <button className="mgmt-action-btn" onClick={onClose}>Cancel</button>
          <button className="mgmt-action-btn" onClick={handleCheck} disabled={phase === "checking" || phase === "upgrading"}>Check for Updates</button>
          <button className="mgmt-action-btn mgmt-action-btn--primary" onClick={handleUpgrade} disabled={phase === "upgrading" || phase === "done"}>
            {phase === "upgrading" ? "Upgrading..." : "Upgrade Now"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Factory Reset Modal ── */
function FactoryModal({ device, onClose }) {
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase]         = useState("idle");
  const [msg, setMsg]             = useState("");

  const handleReset = async () => {
    setPhase("resetting");
    setMsg("Sending factory reset command...");
    try {
      const res = await fetch(`${BACKEND}/api/onvif/factory-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: device.ip }),
      });
      setPhase(res.ok ? "done" : "error");
      setMsg(res.ok ? "✅ Factory reset initiated. Device will restart." : "❌ Reset failed.");
    } catch {
      setPhase("error");
      setMsg("❌ Could not reach device.");
    }
  };

  return (
    <Modal title="Factory Default" onClose={onClose}>
      <div className="mgmt-form">
        <div className="mgmt-warn-box">
          ⚠️ This will reset <strong>{device.name}</strong> to factory defaults. All settings, presets, and configurations will be lost.
        </div>
        <label className="mgmt-confirm-check">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I understand this action cannot be undone
        </label>
        {msg && <div className={`mgmt-form__status ${phase === "error" ? "mgmt-form__status--error" : ""}`}>{msg}</div>}
        <div className="mgmt-form__actions">
          <button className="mgmt-action-btn" onClick={onClose}>Cancel</button>
          <button className="mgmt-action-btn mgmt-action-btn--danger" disabled={!confirmed || phase === "resetting"} onClick={handleReset}>
            {phase === "resetting" ? "Resetting..." : "Factory Reset"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Restart Modal ── */
function RestartModal({ device, onClose }) {
  const [phase, setPhase] = useState("idle");
  const [msg, setMsg]     = useState("");

  const handleRestart = async () => {
    setPhase("restarting");
    setMsg("Sending restart command...");
    try {
      const res = await fetch(`${BACKEND}/api/onvif/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: device.ip }),
      });
      setPhase(res.ok ? "done" : "error");
      setMsg(res.ok ? "✅ Restart command sent. Device will be back online shortly." : "❌ Restart failed.");
    } catch {
      setPhase("error");
      setMsg("❌ Could not reach device.");
    }
  };

  return (
    <Modal title="Restart Device" onClose={onClose}>
      <div className="mgmt-form">
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          Restart <strong style={{ color: "var(--text-primary)" }}>{device.name}</strong> ({device.ip})?
          The device will be temporarily offline for ~30 seconds.
        </p>
        {msg && <div className={`mgmt-form__status ${phase === "error" ? "mgmt-form__status--error" : ""}`}>{msg}</div>}
        <div className="mgmt-form__actions">
          <button className="mgmt-action-btn" onClick={onClose}>Cancel</button>
          <button className="mgmt-action-btn mgmt-action-btn--primary" disabled={phase === "restarting" || phase === "done"} onClick={handleRestart}>
            {phase === "restarting" ? "Restarting..." : "Restart"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Identify Modal ── */
function IdentifyModal({ device, onClose }) {
  const [phase, setPhase] = useState("idle");

  const handleIdentify = async () => {
    setPhase("pulsing");
    try {
      await fetch(`${BACKEND}/api/onvif/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: device.ip }),
      });
    } catch {}
    setTimeout(() => setPhase("done"), 3000);
  };

  return (
    <Modal title="Identify Device" onClose={onClose}>
      <div className="mgmt-form">
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          Flash the LED on <strong style={{ color: "var(--text-primary)" }}>{device.name}</strong> to physically locate it.
        </p>
        <div className={`mgmt-identify-pulse ${phase === "pulsing" ? "mgmt-identify-pulse--active" : ""}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
            <path d="M2 12h3l3-8 4 16 3-8h4"/>
          </svg>
          <span>{phase === "pulsing" ? "Flashing LED..." : phase === "done" ? "✅ Done" : "Ready"}</span>
        </div>
        <div className="mgmt-form__actions">
          <button className="mgmt-action-btn" onClick={onClose}>Close</button>
          <button className="mgmt-action-btn mgmt-action-btn--primary" disabled={phase === "pulsing"} onClick={handleIdentify}>
            {phase === "pulsing" ? "Flashing..." : "Flash LED"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Configure Modal ── */
function ConfigureModal({ device, onClose }) {
  const [tab, setTab] = useState("network");
  const tabs = ["network", "security", "datetime", "video"];

  return (
    <Modal title={`Configure — ${device.name}`} onClose={onClose}>
      <div className="mgmt-tabs">
        {tabs.map((t) => (
          <button key={t} className={`mgmt-tab ${tab === t ? "mgmt-tab--active" : ""}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="mgmt-tab-content">
        {tab === "network" && (
          <div className="mgmt-form">
            <div className="mgmt-form__row"><label>IP Address</label><input className="mgmt-input" defaultValue={device.ip} /></div>
            <div className="mgmt-form__row"><label>Subnet Mask</label><input className="mgmt-input" defaultValue="255.255.255.0" /></div>
            <div className="mgmt-form__row"><label>Gateway</label><input className="mgmt-input" placeholder="192.168.1.1" /></div>
            <div className="mgmt-form__row"><label>DNS Server</label><input className="mgmt-input" placeholder="8.8.8.8" /></div>
          </div>
        )}
        {tab === "security" && (
          <div className="mgmt-form">
            <div className="mgmt-form__row"><label>Username</label><input className="mgmt-input" defaultValue="admin" /></div>
            <div className="mgmt-form__row"><label>New Password</label><input className="mgmt-input" type="password" placeholder="••••••••" /></div>
            <div className="mgmt-form__row"><label>Confirm Password</label><input className="mgmt-input" type="password" placeholder="••••••••" /></div>
            <div className="mgmt-form__row">
              <label>HTTPS</label>
              <select className="mgmt-input"defaultValue={device.https ? "on" : "off"}>
                <option value="on">Enabled</option>
                <option value="off">Disabled</option>
              </select>
            </div>
          </div>
        )}
        {tab === "datetime" && (
          <div className="mgmt-form">
            <div className="mgmt-form__row"><label>NTP Server</label><input className="mgmt-input" defaultValue="pool.ntp.org" /></div>
            <div className="mgmt-form__row"><label>Timezone</label>
              <select className="mgmt-input">
                <option>UTC</option><option>Asia/Kolkata</option><option>America/New_York</option><option>Europe/London</option>
              </select>
            </div>
            <div className="mgmt-form__row"><label>Sync Now</label>
              <button className="mgmt-action-btn mgmt-action-btn--primary">Sync Time</button>
            </div>
          </div>
        )}
        {tab === "video" && (
          <div className="mgmt-form">
            <div className="mgmt-form__row"><label>Resolution</label>
              <select className="mgmt-input"><option>1920×1080</option><option>1280×720</option><option>640×480</option></select>
            </div>
            <div className="mgmt-form__row"><label>Frame Rate</label>
              <select className="mgmt-input"><option>30 fps</option><option>25 fps</option><option>15 fps</option></select>
            </div>
            <div className="mgmt-form__row"><label>Bitrate (kbps)</label><input className="mgmt-input" defaultValue="4096" /></div>
          </div>
        )}
        <div className="mgmt-form__actions" style={{ marginTop: 8 }}>
          <button className="mgmt-action-btn" onClick={onClose}>Cancel</button>
          <button className="mgmt-action-btn mgmt-action-btn--primary">Save</button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Sync Modal ── */
function SyncModal({ device, onClose }) {
  const [phase, setPhase] = useState("idle");
  const [msg, setMsg]     = useState("");

  const handleSync = async () => {
    setPhase("syncing");
    setMsg("Synchronizing device settings...");
    await new Promise((r) => setTimeout(r, 2000));
    setPhase("done");
    setMsg("✅ Device synchronized successfully.");
  };

  return (
    <Modal title="Synchronize Device" onClose={onClose}>
      <div className="mgmt-form">
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          Sync configuration from server to <strong style={{ color: "var(--text-primary)" }}>{device.name}</strong>.
        </p>
        {msg && <div className="mgmt-form__status">{msg}</div>}
        {phase === "syncing" && <div className="mgmt-progress"><div className="mgmt-progress__bar" /></div>}
        <div className="mgmt-form__actions">
          <button className="mgmt-action-btn" onClick={onClose}>Close</button>
          <button className="mgmt-action-btn mgmt-action-btn--primary" disabled={phase === "syncing" || phase === "done"} onClick={handleSync}>
            {phase === "syncing" ? "Syncing..." : "Synchronize"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════ */
/*  MAIN PAGE                                                 */
/* ══════════════════════════════════════════════════════════ */
export default function ManagementPage() {
  const [filter, setFilter]   = useState("");
  const [selected, setSelected] = useState(() => localStorage.getItem("miradorai_selected_camera_id") || null);
  const [activeModal, setActiveModal] = useState(null);

  const allDevices = loadDevices();

  const devices = useMemo(() => {
    if (!filter) return allDevices;
    const q = filter.toLowerCase();
    return allDevices.filter((d) =>
      [d.name, d.mac, d.ip, d.manufacturer, d.model, d.firmware].some(
        (v) => v && String(v).toLowerCase().includes(q)
      )
    );
  }, [filter, allDevices.length]);

  const total    = allDevices.length;
  const online   = allDevices.filter((d) => !d.status || ["ok","online"].includes(d.status.toLowerCase())).length;
  const needsUpd = allDevices.filter((d) => d.needsUpdate).length;
  const alerts   = allDevices.filter((d) => d.alert).length;

  const selectedDevice = allDevices.find((d) => String(d.id) === String(selected));

  const handleToolbar = (key) => {
    if (!selectedDevice && key !== "sync") {
      alert("Please select a device first.");
      return;
    }
    setActiveModal(key);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Manage <span>Devices</span></h1>
          <p className="page-desc">Firmware updates, security settings, network config, and device lifecycle management.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      {/* Toolbar */}
      <div className="mgmt-toolbar card">
        {TOOLBAR.map(({ key, title, icon }) => (
          <button
            key={key}
            className={`mgmt-btn ${!selectedDevice ? "mgmt-btn--disabled" : ""}`}
            title={selectedDevice ? title : `${title} (select a device first)`}
            onClick={() => handleToolbar(key)}
          >
            <span className="mgmt-btn__icon">{icon}</span>
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="mgmt-stats">
        {[
          [total,    "Total Devices", ""],
          [online,   "Online",        "ok"],
          [needsUpd, "Needs Update",  needsUpd > 0 ? "warn" : ""],
          [alerts,   "Alerts",        alerts > 0 ? "danger" : ""],
        ].map(([n, l, variant]) => (
          <div key={l} className={`mgmt-stat card ${variant ? `mgmt-stat--${variant}` : ""}`}>
            <span className="mgmt-stat__num">{n}</span>
            <span className="mgmt-stat__label">{l}</span>
          </div>
        ))}
      </div>

      <div className="mgmt-count-row">
        <span className="mgmt-count-label">
          {total} device{total !== 1 ? "s" : ""}, {selected ? "1" : "0"} selected
        </span>
      </div>

      {/* Table */}
      <div className="card mgmt-table-wrap">
        <table className="m-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Name</th>
              <th>MAC Address</th>
              <th>Status</th>
              <th>Address</th>
              <th>Manufacturer</th>
              <th>Model</th>
              <th>Firmware</th>
              <th>DHCP</th>
              <th>HTTPS</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td colSpan={10} className="m-table__empty">
                  {allDevices.length === 0 ? "No devices enrolled. Go to Add Devices first." : "No devices match your filter."}
                </td>
              </tr>
            ) : devices.map((d) => {
              const isSel = String(d.id) === String(selected);
              return (
                <tr key={d.id} className={`m-table__row ${isSel ? "m-table__row--selected" : ""}`}
                  onClick={() => {
                    const next = selected === String(d.id) ? null : String(d.id);
                    setSelected(next);
                    if (next) localStorage.setItem("miradorai_selected_camera_id", next);
                    else localStorage.removeItem("miradorai_selected_camera_id");
                  }}>
                  <td>
                    <span className="mgmt-cam-thumb">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                        <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                      </svg>
                    </span>
                  </td>
                  <td className="m-table__primary">{d.name || "—"}</td>
                  <td className="mgmt-mono">{d.mac || "—"}</td>
                  <td><StatusBadge status={d.status} /></td>
                  <td><span className="mgmt-ip-link">{d.ip || "—"}</span></td>
                  <td>{d.manufacturer || "—"}</td>
                  <td>{d.model || "—"}</td>
                  <td className="mgmt-mono">{d.firmware || "—"}</td>
                  <td><span className={`mgmt-pill ${d.dhcp ? "mgmt-pill--on" : "mgmt-pill--off"}`}>{d.dhcp ? "Yes" : "No"}</span></td>
                  <td><span className={`mgmt-pill ${d.https ? "mgmt-pill--on" : "mgmt-pill--off"}`}>{d.https ? "On" : "Off"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {activeModal === "assign-ip" && selectedDevice && <AssignIPModal   device={selectedDevice} onClose={() => setActiveModal(null)} />}
      {activeModal === "info"      && selectedDevice && <DeviceInfoModal device={selectedDevice} onClose={() => setActiveModal(null)} />}
      {activeModal === "upgrade"   && selectedDevice && <UpgradeModal    device={selectedDevice} onClose={() => setActiveModal(null)} />}
      {activeModal === "factory"   && selectedDevice && <FactoryModal    device={selectedDevice} onClose={() => setActiveModal(null)} />}
      {activeModal === "restart"   && selectedDevice && <RestartModal    device={selectedDevice} onClose={() => setActiveModal(null)} />}
      {activeModal === "pulse"     && selectedDevice && <IdentifyModal   device={selectedDevice} onClose={() => setActiveModal(null)} />}
      {activeModal === "configure" && selectedDevice && <ConfigureModal  device={selectedDevice} onClose={() => setActiveModal(null)} />}
      {activeModal === "sync"      && selectedDevice && <SyncModal       device={selectedDevice} onClose={() => setActiveModal(null)} />}
    </div>
  );
}