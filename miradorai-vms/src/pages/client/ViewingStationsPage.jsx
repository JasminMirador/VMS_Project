import { useState, useEffect, useRef } from "react";
import WebRTCPlayer_MediaMTX from "../../components/shared/WebRTCPlayer_MediaMTX";
import rrwebPlayer from 'rrweb-player';
import 'rrweb-player/dist/style.css';
import "./ViewingStationsPage.css";

const API = import.meta.env.VITE_API_URL;

function getAuthHeaders() {
  const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
  return token ? { "Authorization": "Bearer " + token } : {};
}

function CellDropdown({ value, onChange, cameras }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedCam = cameras.find(c => String(c.id) === String(value));
  const label = selectedCam ? `${selectedCam.name} (${selectedCam.ip})` : "-- [Empty Cell] --";

  return (
    <div className="vs-cell-dropdown" ref={dropdownRef}>
      <button 
        type="button" 
        className={`vs-cell-dropdown-trigger ${isOpen ? "active" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="vs-cell-dropdown-label">{label}</span>
        <svg className={`vs-cell-chevron ${isOpen ? "open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div className="vs-cell-dropdown-menu">
          <button
            type="button"
            className={`vs-cell-dropdown-item ${!value ? "selected" : ""}`}
            onClick={() => { onChange(""); setIsOpen(false); }}
          >
            -- [Empty Cell] --
          </button>
          {cameras.map(cam => (
            <button
              key={cam.id}
              type="button"
              className={`vs-cell-dropdown-item ${String(value) === String(cam.id) ? "selected" : ""}`}
              onClick={() => { onChange(cam.id); setIsOpen(false); }}
            >
              {cam.name} ({cam.ip})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ViewingStationsPage() {
  const [stations, setStations] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState(null);
  
  // Layout Builder State
  const [gridSize, setGridSize] = useState("2x2");
  const [cellAssignments, setCellAssignments] = useState([]);
  const [pushStatus, setPushStatus] = useState({ success: null, message: "" });
  const [pushing, setPushing] = useState(false);

  // Monitor Station State
  const [monitorStation, setMonitorStation] = useState(null);
  const [monitorMode, setMonitorMode] = useState("rrweb"); // "rrweb" | "webrtc"

  const handleMonitorStation = (station, mode) => {
    setMonitorMode(mode);
    setMonitorStation(station);
  };

  // Load cameras
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("miradorai_devices") || "[]");
      setCameras(stored.filter(c => c.enabled !== false));
    } catch (e) {
      console.error("Failed to load local devices list:", e);
    }
  }, []);

  // Fetch viewing stations
  const fetchStations = async () => {
    try {
      const res = await fetch(`${API}/api/viewing-stations`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setStations(data.stations || []);
        }
      }
    } catch (e) {
      console.error("Failed to fetch stations:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStations();
    const interval = setInterval(fetchStations, 4000);
    return () => clearInterval(interval);
  }, []);

  // Handle grid size change
  useEffect(() => {
    const parts = gridSize.split("x");
    const rows = parseInt(parts[0], 10) || 2;
    const cols = parseInt(parts[1], 10) || 2;
    const cellsCount = rows * cols;
    
    setCellAssignments(prev => {
      const next = Array(cellsCount).fill(null);
      for (let i = 0; i < Math.min(prev.length, cellsCount); i++) {
        next[i] = prev[i];
      }
      return next;
    });
  }, [gridSize]);

  // Set builder layout based on selected station's layout
  const handleEditStationLayout = (station) => {
    setSelectedStation(station);
    setPushStatus({ success: null, message: "" });
    
    const active = station.active_layout;
    if (active) {
      setGridSize(active.grid || "2x2");
      const order = active.device_order || [];
      setCellAssignments(order);
    } else {
      setGridSize("2x2");
      setCellAssignments(Array(4).fill(null));
    }
  };

  const handleCellChange = (index, value) => {
    setCellAssignments(prev => {
      const next = [...prev];
      next[index] = value || null;
      return next;
    });
  };

  const handlePushLayout = async () => {
    if (!selectedStation) return;
    setPushing(true);
    setPushStatus({ success: null, message: "" });
    
    try {
      const res = await fetch(`${API}/api/viewing-stations/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          station_id: selectedStation.station_id,
          grid: gridSize,
          device_order: cellAssignments
        })
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        setPushStatus({ success: true, message: `Successfully pushed layout to ${selectedStation.name}!` });
        fetchStations();
      } else {
        setPushStatus({ success: false, message: (typeof data.detail === "string" ? data.detail : (Array.isArray(data.detail) ? data.detail.map(d => d.msg || "Invalid input").join(", ") : ("Failed to push layout." )))});
      }
    } catch (e) {
      setPushStatus({ success: false, message: "Network error occurred." });
    } finally {
      setPushing(false);
    }
  };

  const getCameraName = (id) => {
    if (!id) return "Empty Cell";
    const cam = cameras.find(c => String(c.id) === String(id));
    return cam ? cam.name : `Camera [${id}]`;
  };

  return (
    <div className="vs-page">
      <div className="vs-header">
        <h1 className="vs-title">Viewing Stations Directory</h1>
      </div>

      <div className="vs-content-layout">
        
        {/* Terminals Directory List */}
        <div className="vs-panel vs-list-panel">
          <div className="vs-panel-header">
            <h2>Active Terminals ({stations.length})</h2>
          </div>
          <div className="vs-panel-body">
            {loading ? (
              <div className="vs-state-msg">Loading terminals directory...</div>
            ) : stations.length === 0 ? (
              <div className="vs-state-msg">No workstations detected on the network yet. Open the <strong>Live View</strong> page on any workstation to register.</div>
            ) : (
              <div className="vs-grid-list">
                {stations.map(st => {
                  const isSelected = selectedStation?.station_id === st.station_id;
                  const activeGrid = st.active_layout?.grid || "None";
                  const activeCamsCount = st.active_feeds_count || 0;
                  
                  return (
                    <div 
                      key={st.station_id} 
                      className={`vs-station-card ${st.is_online ? "online" : "offline"} ${isSelected ? "selected" : ""}`}
                      onClick={() => handleEditStationLayout(st)}
                    >
                      <div className="vs-card-header" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
                          <div style={{ overflow: "hidden", paddingRight: "8px" }}>
                            <span className="vs-station-name" style={{ display: "block", marginBottom: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.name}</span>
                            {st.email && st.email !== "Unknown" && (
                              <>
                                <span 
                                  className="vs-station-id" 
                                  style={{
                                    fontSize: "12px", 
                                    color: "var(--text-primary)", 
                                    display: "block",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis"
                                  }}
                                  title={st.email}
                                >
                                  {st.email}
                                </span>
                                <span 
                                  className="vs-station-id" 
                                  style={{
                                    fontSize: "11px", 
                                    color: "var(--text-primary)", 
                                    marginTop: "2px", 
                                    display: "block",
                                    textTransform: "capitalize"
                                  }}
                                >
                                  Role: {st.role || "Not provided by backend"}
                                </span>
                              </>
                            )}
                          </div>
                          <div className={`vs-status-badge ${st.is_online ? "online" : "offline"}`} style={{ flexShrink: 0 }}>
                            {st.is_online ? "Online" : "Offline"}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                          {/* rrweb mode — no permission needed */}
                          <button
                            className="m-btn"
                            style={{ 
                              padding: "6px 12px", 
                              fontSize: "11px", 
                              backgroundColor: "rgba(16, 185, 129, 0.1)", 
                              color: "var(--primary-color)", 
                              borderColor: "var(--primary-color)",
                              border: "1px solid",
                              borderRadius: "4px",
                              fontWeight: "600"
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMonitorStation(st, "rrweb");
                            }}
                            title="App Mirror — streams the VMS application UI (no permission required)"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13" style={{ marginRight: "5px" }}>
                              <rect x="2" y="3" width="20" height="14" rx="2" />
                              <line x1="8" y1="21" x2="16" y2="21" />
                              <line x1="12" y1="17" x2="12" y2="21" />
                            </svg>
                            App Mirror
                          </button>
                          {/* WebRTC mode — full system screen, requires permission */}
                          <button
                            className="m-btn m-btn--primary"
                            style={{ 
                              padding: "6px 12px", 
                              fontSize: "11px",
                              borderRadius: "4px",
                              fontWeight: "600"
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMonitorStation(st, "webrtc");
                            }}
                            title="Screen Share — streams entire OS screen including video feeds (requires user permission on target)"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13" style={{ marginRight: "5px" }}>
                              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                            </svg>
                            Screen Share
                          </button>
                        </div>
                      </div>
                      
                      <div className="vs-card-details">
                        <div className="vs-detail-row">
                          <span className="label">Current Grid:</span>
                          <span className="value highlight">{activeGrid} Grid</span>
                        </div>
                        <div className="vs-detail-row">
                          <span className="label">Active Feeds:</span>
                          <span className="value">{activeCamsCount} camera{activeCamsCount !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="vs-detail-row">
                          <span className="label">Last Seen:</span>
                          <span className="value">
                            {st.last_seen > 0 ? new Date(st.last_seen * 1000).toLocaleTimeString() : "Never"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Remote Layout Builder Panel */}
        <div className="vs-panel vs-builder-panel">
          <div className="vs-panel-header">
            <h2>Remote Layout Controller</h2>
          </div>
          <div className="vs-panel-body">
            {!selectedStation ? (
              <div className="vs-builder-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="48" height="48">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <path d="M8 21h8M12 17v4"/>
                </svg>
                <p>Select a viewing terminal from the directory list on the left to configure and push a remote layout.</p>
              </div>
            ) : (
              <div className="vs-builder-container">
                <div className="vs-builder-top">
                  <h3>Target Terminal: <span className="highlight">{selectedStation.name}</span></h3>
                  {!selectedStation.is_online && (
                    <div className="vs-warning-banner">
                      ⚠️ Note: This terminal is currently offline. Pushed layouts will apply immediately once the station re-connects.
                    </div>
                  )}
                </div>

                <div className="vs-form-group">
                  <label className="vs-form-label">Select Grid Format</label>
                  <div className="vs-grid-selector" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {["2x2", "2x3", "3x2", "3x3", "3x4", "4x4", "8x8"].map(g => (
                      <button 
                        key={g} 
                        className={`vs-grid-btn ${gridSize === g ? "active" : ""}`}
                        onClick={() => setGridSize(g)}
                        type="button"
                        style={{ flex: "1 0 calc(25% - 6px)", minWidth: "70px", padding: "8px 10px" }}
                      >
                        {g} Grid
                      </button>
                    ))}
                  </div>
                </div>

                <div className="vs-form-group">
                  <label className="vs-form-label">Configure Cells Configuration</label>
                  
                  {/* Grid Layout Preview Form */}
                  <div 
                    className="vs-builder-grid"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${parseInt(gridSize.split("x")[1], 10) || 2}, 1fr)`,
                      gap: "12px",
                      marginTop: "12px"
                    }}
                  >
                    {cellAssignments.map((assignedId, idx) => (
                      <div key={idx} className="vs-builder-cell">
                        <span className="vs-cell-num">Cell {idx + 1}</span>
                        <CellDropdown
                          value={assignedId || ""}
                          onChange={(val) => handleCellChange(idx, val)}
                          cameras={cameras}
                        />
                        <div className="vs-cell-preview-name">
                          {getCameraName(assignedId)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {pushStatus.message && (
                  <div className={`vs-status-banner ${pushStatus.success ? "success" : "error"}`}>
                    {pushStatus.message}
                  </div>
                )}

                <div className="vs-builder-actions">
                  <button
                    className="m-btn m-btn--primary"
                    onClick={handlePushLayout}
                    disabled={pushing}
                    type="button"
                  >
                    {pushing ? "Pushing Layout..." : "Push Layout to Terminal"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {monitorStation && (
        <div className="modal-overlay" onClick={() => setMonitorStation(null)}>
          <div className="modal-box" style={{ width: "90%", maxWidth: "1200px", background: "var(--bg-surface)", border: "1px solid var(--border-color)", padding: "20px" }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">
                  {monitorMode === "webrtc" ? "🖥 Screen Share" : "📺 App Mirror"}: {monitorStation.name}
                </h2>
                <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "2px 0 0 0" }}>
                  {monitorMode === "webrtc"
                    ? "Full system screen — user will be prompted to share their screen on the target terminal"
                    : "Application-level stream — mirrors VMS UI without any permission prompt"}
                </p>
              </div>
              <button className="modal-close" onClick={() => setMonitorStation(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ minHeight: "500px", padding: 0, marginTop: "16px" }}>
              {!monitorStation.is_online ? (
                <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                  Station is offline.
                </div>
              ) : monitorMode === "webrtc" ? (
                <LiveMirrorMonitor station={monitorStation} />
              ) : (
                <RrwebMirrorMonitor station={monitorStation} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LiveMirrorMonitor({ station }) {
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  
  useEffect(() => {
    let ws = null;
    const apiBase = import.meta.env.VITE_API_URL || '';

    const getRtcConfig = async () => {
      try {
        const res = await fetch(`${apiBase}/api/viewing-stations/ice-servers`);
        if (res.ok) {
          const data = await res.json();
          if (data.iceServers && data.iceServers.length > 0) {
            console.log("[LiveMirror] Loaded Twilio ICE servers:", data.iceServers.length);
            return { iceServers: data.iceServers };
          }
        }
      } catch (e) {
        console.warn("[LiveMirror] Error fetching dynamic ICE servers:", e);
      }
      return {
        iceServers: [
          { urls: "stun:global.stun.twilio.com:3478" },
          { urls: "stun:stun.l.google.com:19302" },
          {
            urls: "turn:global.turn.twilio.com:3478?transport=udp",
            username: "d3caa20dc03b96f465cf78ae677e43a12842daa2b27febcef8d41ac2ee74db84",
            credential: "iPnaKnb4WYyxGP6nlQap2K5Adx4resPtdbt6hxK/YSw="
          },
          {
            urls: "turn:global.turn.twilio.com:3478?transport=tcp",
            username: "d3caa20dc03b96f465cf78ae677e43a12842daa2b27febcef8d41ac2ee74db84",
            credential: "iPnaKnb4WYyxGP6nlQap2K5Adx4resPtdbt6hxK/YSw="
          },
          {
            urls: "turn:global.turn.twilio.com:443?transport=tcp",
            username: "d3caa20dc03b96f465cf78ae677e43a12842daa2b27febcef8d41ac2ee74db84",
            credential: "iPnaKnb4WYyxGP6nlQap2K5Adx4resPtdbt6hxK/YSw="
          }
        ]
      };
    };

    const cleanupWebRTC = () => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };

    let wsUrl = '';
    
    if (apiBase) {
      wsUrl = apiBase.replace(/^http/, 'ws') + `/ws/events?topics=station_${station.station_id}_stream`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/events?topics=station_${station.station_id}_stream`;
    }
    
    console.log("[LiveMirror] Connecting to stream:", wsUrl);
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
       console.log("[LiveMirror] Connected! Sending start_webrtc command to:", station.station_id);
       ws.send(JSON.stringify({
          action: "publish",
          topic: `station_${station.station_id}`,
          pub_event: "start_webrtc",
          data: {}
       }));
    };

    ws.onmessage = async (msg) => {
       try {
         const data = JSON.parse(msg.data);
         
         if (data.event === "webrtc_offer") {
            console.log("[LiveMirror] Received webrtc_offer");
            cleanupWebRTC();
            const rtcConfig = await getRtcConfig();
            const pc = new RTCPeerConnection(rtcConfig);
            pcRef.current = pc;
            pcRef.current.remoteDescriptionSet = false;
            pcRef.current.iceQueue = [];

            pc.ontrack = (e) => {
                console.log("[LiveMirror] Received remote track:", e.streams[0]);
                if (videoRef.current && e.streams && e.streams[0]) {
                    if (videoRef.current.srcObject !== e.streams[0]) {
                        videoRef.current.srcObject = e.streams[0];
                        // Let autoPlay handle it, but fallback to play() if needed.
                        const playPromise = videoRef.current.play();
                        if (playPromise !== undefined) {
                            playPromise.catch(err => console.error("[LiveMirror] Autoplay blocked or failed:", err));
                        }
                    }
                }
            };

            pc.onconnectionstatechange = () => {
                console.log("[LiveMirror] Connection state:", pc.connectionState);
            };
            
            pc.oniceconnectionstatechange = () => {
                console.log("[LiveMirror] ICE connection state:", pc.iceConnectionState);
            };

            pc.onicecandidate = (e) => {
                if (e.candidate && ws.readyState === WebSocket.OPEN) {
                    console.log("[LiveMirror] Sending webrtc_ice_candidate");
                    ws.send(JSON.stringify({
                        action: "publish",
                        topic: `station_${station.station_id}`,
                        pub_event: "webrtc_ice_candidate",
                        data: e.candidate
                    }));
                }
            };

            await pc.setRemoteDescription(new RTCSessionDescription(data.data));
            pcRef.current.remoteDescriptionSet = true;
            for (let c of pcRef.current.iceQueue) {
                await pc.addIceCandidate(c);
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            if (ws.readyState === WebSocket.OPEN) {
                console.log("[LiveMirror] Sending webrtc_answer");
                ws.send(JSON.stringify({
                    action: "publish",
                    topic: `station_${station.station_id}`,
                    pub_event: "webrtc_answer",
                    data: answer
                }));
            }
         } else if (data.event === "webrtc_ice_candidate") {
            console.log("[LiveMirror] Received webrtc_ice_candidate");
            if (pcRef.current) {
                const candidate = new RTCIceCandidate(data.data);
                if (pcRef.current.remoteDescriptionSet) {
                    await pcRef.current.addIceCandidate(candidate);
                } else {
                    pcRef.current.iceQueue.push(candidate);
                }
            }
         }
       } catch (e) {
         console.error("[LiveMirror] WS message error:", e);
       }
    };
    
    return () => {
       if (ws && ws.readyState === WebSocket.OPEN) {
          console.log("[LiveMirror] Sending stop_record command");
          ws.send(JSON.stringify({
             action: "publish",
             topic: `station_${station.station_id}`,
             pub_event: "stop_record",
             data: {}
          }));
          ws.close();
       }
       cleanupWebRTC();
    };
  }, [station.station_id]);

  return (
    <div style={{ width: '100%', height: '600px', backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
        />
    </div>
  );
}

// ── rrweb App-Level Monitor ──────────────────────────────────────────────────
// Sends start_record over WS → station starts rrweb recording and streams
// DOM events back. No browser permission required on the target.
function RrwebMirrorMonitor({ station }) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    let ws = null;
    let events = [];

    const apiBase = import.meta.env.VITE_API_URL || '';
    let wsUrl = '';

    if (apiBase) {
      wsUrl = apiBase.replace(/^http/, 'ws') + `/ws/events?topics=station_${station.station_id}_stream`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/events?topics=station_${station.station_id}_stream`;
    }

    console.log("[RrwebMirror] Connecting to stream:", wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("[RrwebMirror] Connected! Sending start_record to:", station.station_id);
      ws.send(JSON.stringify({
        action: "publish",
        topic: `station_${station.station_id}`,
        pub_event: "start_record",
        data: {}
      }));
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.event === "rrweb_event" && data.data) {
          const rr_event = data.data;

          // Wait for the first FullSnapshot (type 2) before starting
          if (events.length === 0 && rr_event.type !== 2) {
            console.log("[RrwebMirror] Waiting for FullSnapshot...");
            return;
          }

          if (!playerRef.current) {
            events.push(rr_event);
            if (events.length > 1 && containerRef.current) {
              console.log("[RrwebMirror] Initializing rrwebPlayer with", events.length, "events");
              playerRef.current = new rrwebPlayer({
                target: containerRef.current,
                props: {
                  events: [...events],
                  liveMode: true,
                  showController: false,
                  autoPlay: true,
                  width: containerRef.current.offsetWidth || 1100,
                  height: containerRef.current.offsetHeight || 600,
                }
              });
            }
          } else {
            playerRef.current.addEvent(rr_event);
          }
        }
      } catch (e) {
        console.error("[RrwebMirror] message error:", e);
      }
    };

    return () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("[RrwebMirror] Sending stop_record");
        ws.send(JSON.stringify({
          action: "publish",
          topic: `station_${station.station_id}`,
          pub_event: "stop_record",
          data: {}
        }));
        ws.close();
      }
      if (playerRef.current) {
        try { playerRef.current.pause(); } catch (e) {}
        playerRef.current = null;
      }
    };
  }, [station.station_id]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '600px', backgroundColor: '#000' }} />
  );
}
