import { useMemo, useState } from "react";
import StatusBadge from "../../components/shared/StatusBadge";
import "./EdgeDevices.css";

/* ─── helpers ─────────────────────────────────────────────────────────────── */
export const isEdgeCamera = (d) => Boolean(d?.is_edge_camera || d?.source === "edge" || d?.edge_id || d?.edge_ip);

/* ─── icons ───────────────────────────────────────────────────────────────── */
const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

// Surveillance (CCTV) camera
export function CctvIcon({ size = 22 }) {
  return (
    <svg {...svgProps} width={size} height={size}>
      <path d="M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97" />
      <path d="M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z" />
      <path d="M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15" />
      <path d="M2 21v-4" />
      <path d="M7 9h.01" />
    </svg>
  );
}

// Edge box (small gateway / Raspberry Pi style box with antennas)
export function EdgeBoxIcon({ size = 22 }) {
  return (
    <svg {...svgProps} width={size} height={size}>
      <rect x="3" y="9" width="18" height="9" rx="2" />
      <path d="M8 9V5.5M16 9V5.5" />
      <path d="M7 13.5h.01M10 13.5h.01" />
      <path d="M14.5 13.5H18" />
      <path d="M7 18v2M17 18v2" />
    </svg>
  );
}

function Chevron({ open }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/* ─── section heading ─────────────────────────────────────────────────────── */
export function SectionHead({ title, count, sub, tone = "default", icon }) {
  return (
    <div className="sec-head">
      <div className="sec-head__row">
        {icon}
        <h2 className="sec-head__title">{title}</h2>
        <span className={`sec-head__count sec-head__count--${tone}`}>{count}</span>
      </div>
      {sub && <p className="sec-head__sub">{sub}</p>}
    </div>
  );
}

/* ─── stream cell (same logic as the main table) ──────────────────────────── */
function StreamCell({ d }) {
  const ss =
    typeof d.stream_status === "object"
      ? d.stream_status?.connected ? "streaming" : "error"
      : d.stream_status;
  const live = ss === "streaming" || d.status === "Online";
  const n = d.stream_count || d.stream_profiles?.length || 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {live ? (
        <span className="add-dev__stream add-dev__stream--live">● LIVE</span>
      ) : d.ws_url || d.stream_key ? (
        <span className="add-dev__stream add-dev__stream--pending">● {ss || d.status || "pending"}</span>
      ) : (
        <span className="add-dev__stream add-dev__stream--none">— not registered</span>
      )}
      {n > 0 && <span className="edge-profiles">{n} profile{n !== 1 ? "s" : ""}</span>}
    </div>
  );
}

/* ─── Edge section: one block per edge box, with its cameras inside ───────── */
export default function EdgeDevicesSection({ devices, groups, onPreview, onContextMenu, onRenameEdge, onDeleteEdge }) {
  const [collapsed, setCollapsed] = useState({});
  const [editingEdgeIp, setEditingEdgeIp] = useState(null);
  const [editingName, setEditingName] = useState("");

  const edges = useMemo(() => {
    const map = new Map();
    devices.forEach((d) => {
      let edgeId = d.edge_id || "";
      if (!edgeId && d.stream_key && d.stream_key.includes("_camera_")) {
        edgeId = d.stream_key.split("_camera_")[0];
      }
      const key = edgeId || d.edge_ip || d.edge_name || "mirador-edge";
      if (!map.has(key)) {
        map.set(key, { edge_id: edgeId, ip: d.edge_ip || "", name: "", cameras: [] });
      }
      const edge = map.get(key);
      if (edgeId && !edge.edge_id) edge.edge_id = edgeId;
      if (d.edge_ip && !edge.ip) edge.ip = d.edge_ip;

      // Prioritize explicit custom names over generic fallback "Mirador Edge"
      if (d.edge_name && d.edge_name !== "Mirador Edge") {
        edge.name = d.edge_name;
      } else if (d.display_name && d.display_name !== "Mirador Edge") {
        edge.name = d.display_name;
      } else if (d.edge_name && !edge.name) {
        edge.name = d.edge_name;
      }

      edge.cameras.push(d);
    });
    return [...map.values()].map((e) => ({
      ...e,
      name: e.name || (e.ip && e.ip !== "unknown" ? `Edge ${e.ip}` : (e.edge_id || "Mirador Edge")),
    }));
  }, [devices]);

  if (edges.length === 0) return null;

  const toggle = (ip) => setCollapsed((p) => ({ ...p, [ip]: !p[ip] }));

  const handleSaveRename = (edgeIp) => {
    if (!editingName.trim()) return;
    if (onRenameEdge) {
      onRenameEdge(edgeIp, editingName.trim());
    }
    setEditingEdgeIp(null);
  };

  return (
    <section className="edge-section">
      <SectionHead
        tone="edge"
        icon={<span className="edge-section__icon"><EdgeBoxIcon size={18} /></span>}
        title="Edge devices"
        count={devices.length}
        sub={`${edges.length} edge device${edges.length !== 1 ? "s" : ""} and their connected cameras`}
      />

      {edges.map((edge) => {
        const edgeKey = edge.edge_id || edge.ip || edge.name;
        const open = !collapsed[edgeKey];
        const online = edge.cameras.filter((c) => c.status === "Online").length;

        return (
          <div className="edge-box" key={edgeKey}>
            <div
              className="edge-box__head"
              onClick={() => toggle(edgeKey)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  toggle(edgeKey);
                }
              }}
              aria-expanded={open}
            >
              <span className="edge-box__icon"><EdgeBoxIcon size={22} /></span>
              <span className="edge-box__meta">
                {editingEdgeIp === edge.ip ? (
                  <div
                    className="edge-box__rename-form"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      className="modal-input"
                      value={editingName}
                      maxLength={40}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSaveRename(edge.ip);
                        } else if (e.key === "Escape") {
                          setEditingEdgeIp(null);
                        }
                      }}
                      autoFocus
                      style={{ padding: "3px 8px", fontSize: 13, height: 28 }}
                    />
                    <button
                      type="button"
                      className="modal-btn modal-btn--save"
                      style={{ padding: "3px 10px", fontSize: 12, height: 28 }}
                      onClick={() => handleSaveRename(edge.ip)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="modal-btn modal-btn--cancel"
                      style={{ padding: "3px 8px", fontSize: 12, height: 28 }}
                      onClick={() => setEditingEdgeIp(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="edge-box__name">{edge.name}</span>
                    {onRenameEdge && (
                      <button
                        type="button"
                        className="edge-box__rename-btn"
                        title="Rename edge device"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingEdgeIp(edge.ip);
                          setEditingName(edge.name);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    )}
                    {onDeleteEdge && (
                      <button
                        type="button"
                        className="edge-box__delete-btn"
                        title="Delete Edge device and all connected cameras"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteEdge(edge);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
                {edge.ip && edge.ip !== "unknown" && (
                  <code className="edge-box__ip">{edge.ip}</code>
                )}
              </span>
              <span className="edge-box__stats">
                <span className="edge-pill">{edge.cameras.length} camera{edge.cameras.length !== 1 ? "s" : ""}</span>
                <span className={`edge-pill ${online > 0 ? "edge-pill--ok" : "edge-pill--off"}`}>{online} online</span>
              </span>
              <span className="edge-box__chev"><Chevron open={open} /></span>
            </div>

            {open && (
              <div className="edge-box__body">
                <table className="m-table">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}></th>
                      {["Device Name", "IP Address", "Status", /* "Shard", */ "Group", "Stream"].map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {edge.cameras.map((d) => {
                      const groupLabel =
                        !d.group_id || d.group_id === "default"
                          ? "Default"
                          : groups.find((g) => g.id === d.group_id)?.name || "Default";

                      const camKey = d.id || d.stream_key || d.camera_id || d.ip;

                      return (
                        <tr key={camKey} className="m-table__row" onContextMenu={(e) => onContextMenu(e, camKey)}>
                          <td onClick={() => onPreview(d)} style={{ cursor: "pointer" }} title="Click to play live preview">
                            <div className="thumb-container">
                              {d.thumbnail ? (
                                <img
                                  src={d.thumbnail}
                                  alt={d.name}
                                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: "inherit" }}
                                />
                              ) : (
                                <div className="thumb-fallback"><CctvIcon size={22} /></div>
                              )}
                              <div className="thumb-play-overlay">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>
                              </div>
                            </div>
                          </td>
                          <td className="m-table__primary">
                            <div className="add-dev__name-cell">
                              {d.name}
                            </div>
                          </td>
                          <td><code className="add-dev__ip">{d.ip}</code></td>
                          <td><StatusBadge status={d.status} /></td>
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
                          <td><StreamCell d={d} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ─── Credentials modal: one login per brand, optional camera names ───────── */
export function EdgeCredentialsModal({ channels, edge, onClose, onAdd }) {
  const brandOf = (c) => (c.manufacturer || c.brand || "").trim() || "Cameras";

  const brands = useMemo(() => {
    const map = new Map();
    channels.forEach((c) => {
      const b = brandOf(c);
      if (!map.has(b)) map.set(b, []);
      map.get(b).push(c);
    });
    return [...map.entries()].map(([brand, cameras]) => ({ brand, cameras }));
  }, [channels]);

  const [shared, setShared] = useState({});     // brand -> { username, password }
  const [separate, setSeparate] = useState({}); // brand -> true = per-camera logins
  const [perCam, setPerCam] = useState({});     // ip    -> { username, password }
  const [names, setNames] = useState({});       // ip    -> optional camera name

  const setShare = (brand, field, v) =>
    setShared((p) => ({ ...p, [brand]: { ...p[brand], [field]: v } }));
  const setCam = (ip, field, v) =>
    setPerCam((p) => ({ ...p, [ip]: { ...p[ip], [field]: v } }));

  const credsFor = (c) => (separate[brandOf(c)] ? perCam[c.ip] : shared[brandOf(c)]);

  const isValid = channels.every((c) => {
    const cr = credsFor(c);
    return cr?.username?.trim() && cr?.password;
  });

  const submit = () =>
    onAdd(
      channels.map((c) => {
        const cr = credsFor(c) || {};
        return {
          ...c,
          username: (cr.username || "").trim(),
          password: cr.password || "",
          custom_name: (names[c.ip] || "").trim(),
        };
      })
    );

  return (
    <div className="modal-overlay">
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ width: 620, maxWidth: "95vw" }}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Camera Credentials</h2>
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
              Adding to {edge?.display_name || edge?.name || "Mirador Edge"} ({edge?.ip})
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="ecm-list">
            {brands.map(({ brand, cameras }) => {
              const sep = !!separate[brand];
              return (
                <div className="ecm-group" key={brand}>
                  <div className="ecm-group__head">
                    <span className="ecm-group__title">
                      <CctvIcon size={16} />
                      {brand === "Cameras" ? "Selected cameras" : brand}
                    </span>
                    <span className="ecm-group__count">{cameras.length} camera{cameras.length !== 1 ? "s" : ""}</span>
                  </div>

                  {!sep && (
                    <div className="ecm-shared">
                      <div className="modal-field">
                        <label className="modal-label">Username</label>
                        <input
                          className="modal-input"
                          value={shared[brand]?.username || ""}
                          onChange={(e) => setShare(brand, "username", e.target.value)}
                          placeholder="Username"
                        />
                      </div>
                      <div className="modal-field">
                        <label className="modal-label">Password</label>
                        <input
                          className="modal-input"
                          type="password"
                          value={shared[brand]?.password || ""}
                          onChange={(e) => setShare(brand, "password", e.target.value)}
                          placeholder="Password"
                        />
                      </div>
                      <div className="ecm-hint">
                        {cameras.length > 1 ? `Used for all ${cameras.length} cameras` : "Used for this camera"}
                      </div>
                    </div>
                  )}

                  {cameras.length > 1 && (
                    <label className="ecm-toggle">
                      <input
                        type="checkbox"
                        checked={sep}
                        onChange={(e) => setSeparate((p) => ({ ...p, [brand]: e.target.checked }))}
                      />
                      Use different credentials per camera
                    </label>
                  )}

                  <div className="ecm-cams">
                    {cameras.map((c) => (
                      <div className="ecm-cam" key={c.ip}>
                        <div className="ecm-cam__top">
                          <code className="ecm-cam__ip">{c.ip}</code>
                          <input
                            className="modal-input ecm-cam__name"
                            value={names[c.ip] || ""}
                            maxLength={40}
                            onChange={(e) => setNames((p) => ({ ...p, [c.ip]: e.target.value }))}
                            placeholder="Camera name (optional)"
                          />
                        </div>
                        {sep && (
                          <div className="ecm-cam__creds">
                            <input
                              className="modal-input"
                              value={perCam[c.ip]?.username || ""}
                              onChange={(e) => setCam(c.ip, "username", e.target.value)}
                              placeholder="Username"
                            />
                            <input
                              className="modal-input"
                              type="password"
                              value={perCam[c.ip]?.password || ""}
                              onChange={(e) => setCam(c.ip, "password", e.target.value)}
                              placeholder="Password"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="modal-btn modal-btn--cancel" onClick={onClose}>Back</button>
          <button className="modal-btn modal-btn--save" disabled={!isValid} onClick={submit}>
            Add Selected ({channels.length})
          </button>
        </div>
      </div>
    </div>
  );
}