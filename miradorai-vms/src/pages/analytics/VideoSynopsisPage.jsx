import React, { useState, useEffect, useRef } from "react";
import Hls from "hls.js";
import "./VideoSynopsisPage.css";
import { useCameras } from "../../context/CamerasContext";
import DateTimePicker from "../../components/shared/DateTimePicker";

export default function VideoSynopsisPage() {
  const { cameras } = useCameras();
  const [selectedCamera, setSelectedCamera] = useState("");

  useEffect(() => {
    if (cameras && cameras.length > 0 && !selectedCamera) {
      setSelectedCamera(cameras[0].id || cameras[0]._id);
    }
  }, [cameras, selectedCamera]);

  const [rangeStart, setRangeStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [rangeEnd, setRangeEnd] = useState(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  
  const [toastMessage, setToastMessage] = useState(null);

  // Direction Drawing State
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [endPoint, setEndPoint] = useState(null);
  const [directionAngle, setDirectionAngle] = useState(null);

  const drawArrow = (ctx, fromx, fromy, tox, toy) => {
    const dx = tox - fromx;
    const dy = toy - fromy;
    
    // Control point for a gentle curve
    const ctrlX = fromx + dx * 0.5 + dy * 0.2;
    const ctrlY = fromy + dy * 0.5 - dx * 0.2;

    // Shadow for realistic 3D overlay look
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 6;

    // Draw the curved path
    ctx.beginPath();
    ctx.moveTo(fromx, fromy);
    ctx.quadraticCurveTo(ctrlX, ctrlY, tox, toy);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Calculate tangent angle at the tip for the arrowhead
    const tipAngle = Math.atan2(toy - ctrlY, tox - ctrlX);
    const headlen = 24;

    // Draw filled arrowhead
    ctx.beginPath();
    ctx.moveTo(tox, toy);
    ctx.lineTo(tox - headlen * Math.cos(tipAngle - Math.PI / 7), toy - headlen * Math.sin(tipAngle - Math.PI / 7));
    ctx.lineTo(tox - headlen * Math.cos(tipAngle + Math.PI / 7), toy - headlen * Math.sin(tipAngle + Math.PI / 7));
    ctx.closePath();
    
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    
    // Reset shadows so it doesn't affect other rendering
    ctx.shadowColor = 'transparent';
  };

  const redrawCanvas = (start, end) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (start && end) {
      drawArrow(ctx, start.x, start.y, end.x, end.y);
    }
  };

  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setStartPoint({ x, y });
    setEndPoint({ x, y });
    setIsDrawing(true);
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setEndPoint({ x, y });
    redrawCanvas(startPoint, { x, y });
  };

  const handleMouseUp = (e) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    if (startPoint && endPoint) {
      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        setDirectionAngle(angle);
      } else {
        setDirectionAngle(null);
        redrawCanvas(null, null);
      }
    }
  };
  
  const clearDirection = () => {
    setStartPoint(null);
    setEndPoint(null);
    setDirectionAngle(null);
    redrawCanvas(null, null);
  };
  
  const [loading, setLoading] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [jobHistory, setJobHistory] = useState([]);
  const [metadataItems, setMetadataItems] = useState([]);
  const [currentActiveObjects, setCurrentActiveObjects] = useState([]);
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
  const [originalVideoDimensions, setOriginalVideoDimensions] = useState({ width: 1920, height: 1080 });
  const [showHeatmap, setShowHeatmap] = useState(false);

  useEffect(() => {
    fetchJobHistory();
  }, []);

  const fetchJobHistory = async () => {
    try {
      // const res = await fetch('http://localhost:8005/a1/v1/synopsis/jobs');
      const res = await fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/jobs`);

      const data = await res.json();
      setJobHistory((data || []).slice(0, 50));
    } catch (err) {
      console.error("Error fetching job history:", err);
    }
  };

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");

  const handleEditNameClick = () => {
    setEditNameValue(activeJob.job_name || activeJob.job_id);
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    try {
      const res = await fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/jobs/${activeJob.job_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_name: editNameValue })
      });
      if (res.ok) {
        const updated = await res.json();
        setActiveJob(updated);
        setJobHistory(prev => prev.map(j => j.job_id === updated.job_id ? updated : j));
      }
    } catch (err) {
      console.error("Error saving job name:", err);
    }
    setIsEditingName(false);
  };

  // Trigger Synopsis Job Creation
  const handleGenerateSynopsis = async () => {
    setLoading(true);
    setActiveJob(null);
    setMetadataItems([]);
    setCurrentActiveObjects([]);

    try {
      const payload = {
        camera_id: selectedCamera,
        camera_name: cameras?.find(c => (c.id || c._id) === selectedCamera)?.name || selectedCamera,
        range_start: rangeStart,
        range_end: rangeEnd
      };
      
      if (startPoint && endPoint && canvasRef.current) {
        payload.direction_start = [startPoint.x / canvasRef.current.width, startPoint.y / canvasRef.current.height];
        payload.direction_end = [endPoint.x / canvasRef.current.width, endPoint.y / canvasRef.current.height];
        payload.direction_tolerance = 90.0;
        
        const dx = endPoint.x - startPoint.x;
        const dy = endPoint.y - startPoint.y;
        payload.direction_angle = Math.atan2(dy, dx) * (180 / Math.PI);
      }

      const response = await fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        setToastMessage(errData.detail || "Failed to start Video Synopsis job");
        setLoading(false);
        return;
      }

      const data = await response.json();
      setActiveJob(data);
      pollJobStatus(data.job_id);
    } catch (err) {
      console.error("Error creating synopsis job:", err);
      setToastMessage("Failed to submit Video Synopsis Job. Ensure Synopsis Microservice is running on port 8005.");
      setLoading(false);
    }
  };

  // Poll job status until complete
  const pollJobStatus = (jobId) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/jobs/${jobId}`);
        const data = await res.json();
        setActiveJob(data);

        if (data.status === "completed") {
          clearInterval(interval);
          setLoading(false);
          fetchMetadataSidecar(data.metadata_sidecar_url);
        } else if (data.status === "failed") {
          clearInterval(interval);
          setLoading(false);
        }
      } catch (err) {
        console.error("Error polling synopsis job:", err);
        clearInterval(interval);
        setLoading(false);
      }
    }, 2000);
  };

  // Fetch Metadata Sidecar JSON for interactive click-to-jump overlays
  const fetchMetadataSidecar = async (metaUrl) => {
    try {
      // const fullUrl = `http://localhost:8005${metaUrl}`;
      const fullUrl = `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${metaUrl}`;

      const res = await fetch(fullUrl);
      const data = await res.json();
      setMetadataItems(data.items || []);
    } catch (err) {
      console.error("Error loading sidecar metadata:", err);
    }
  };

  // Synchronize interactive overlays during video playback
  const handleTimeUpdate = () => {
    if (!videoRef.current || metadataItems.length === 0) return;
    const curTime = videoRef.current.currentTime;
    
    // Find active objects at current video timestamp
    const active = metadataItems.filter(
      (item) => Math.abs(item.synopsis_timestamp_s - curTime) < 0.2
    );
    
    // De-duplicate: only keep one overlay per track_id
    const uniqueActive = [];
    const seenTracks = new Set();
    for (const item of active) {
      if (!seenTracks.has(item.track_id)) {
        seenTracks.add(item.track_id);
        uniqueActive.push(item);
      }
    }
    
    setCurrentActiveObjects(uniqueActive);
  };

  const handleResize = () => {
    if (videoRef.current) {
      setVideoDimensions({
        width: videoRef.current.clientWidth,
        height: videoRef.current.clientHeight
      });
      setOriginalVideoDimensions({
        width: videoRef.current.videoWidth || 1920,
        height: videoRef.current.videoHeight || 1080
      });
    }
  };

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [rawModal, setRawModal] = useState({ isOpen: false, item: null });
  const [rawVideoUrl, setRawVideoUrl] = useState(null);
  const [rawVideoLoading, setRawVideoLoading] = useState(false);
  const [rawVideoError, setRawVideoError] = useState(null);
  const rawVideoRef = useRef(null);
  
  const API = import.meta.env.VITE_API_URL || "";

  useEffect(() => {
    let hls = null;
    if (rawVideoUrl && rawVideoRef.current) {
      const fullUrl = rawVideoUrl.startsWith('http') 
        ? rawVideoUrl 
        : `${API}${rawVideoUrl.startsWith('/') ? '' : '/'}${rawVideoUrl}`;
        
      if (rawVideoUrl.includes(".m3u8") && Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(fullUrl);
        hls.attachMedia(rawVideoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (rawVideoRef.current) {
            rawVideoRef.current.play().catch(e => console.error(e));
          }
        });
      } else {
        rawVideoRef.current.src = fullUrl;
      }
    }
    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [rawVideoUrl, API]);

  const handleJumpToOriginal = async (item) => {
    setRawModal({ isOpen: true, item });
    setRawVideoUrl(null);
    setRawVideoLoading(true);
    setRawVideoError(null);
    try {
      const cam = cameras?.find(c => (c.id || c._id) === item.camera_id);
      const playbackIp = cam?.ip || cam?.serial || item.camera_id;
      const time = item.original_timestamp; // "YYYY-MM-DD HH:MM:SS"
      const formattedTime = time.replace(" ", "T");
      
      const url = `${API}/api/event-playback?ip=${encodeURIComponent(playbackIp)}&time=${encodeURIComponent(formattedTime)}`;
      // Assuming authorization headers if available in standard flow. If none, just fetch.
      let token = localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Failed to fetch raw video: ${res.statusText}`);
      }
      const data = await res.json();
      setRawVideoUrl(data.clipUrl);
    } catch (err) {
      console.error(err);
      setRawVideoError(err.message || "Failed to load raw video clip.");
    } finally {
      setRawVideoLoading(false);
    }
  };

  // Calculate scaled bounding box for responsive video player
  const getScaledBBox = (bbox) => {
    const [x, y, w, h] = bbox;
    const scaleX = videoDimensions.width / originalVideoDimensions.width;
    const scaleY = videoDimensions.height / originalVideoDimensions.height;
    return {
      left: x * scaleX,
      top: y * scaleY,
      width: w * scaleX,
      height: h * scaleY
    };
  };

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  return (
    <div className="synopsis-page">
      {/* Dynamic Background Effect */}
      <div className="synopsis-bg-blob blob-1"></div>
      <div className="synopsis-bg-blob blob-2"></div>

      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          backgroundColor: 'rgba(239, 68, 68, 0.95)',
          backdropFilter: 'blur(10px)',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,100,100,0.3)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          animation: 'slideInRight 0.3s ease-out',
          minWidth: '300px',
          overflow: 'hidden'
        }}>
          <span className="material-icons-outlined" style={{ fontSize: '1.4rem' }}>error_outline</span>
          <span style={{ fontWeight: 500, fontSize: '0.95rem', flex: 1, zIndex: 1 }}>{toastMessage}</span>
          <button 
            onClick={() => setToastMessage(null)} 
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', display: 'flex', padding: 0, zIndex: 1 }}
            title="Close"
          >
            <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>close</span>
          </button>
          
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.5)',
            animation: 'toastProgress 5s linear forwards'
          }}></div>
        </div>
      )}

      <div className="synopsis-content-wrapper">
          <header className="synopsis-header">
            <div className="header-title-wrapper">
              {/* <span className="material-icons-outlined title-icon">view_timeline</span> */}
              <h2>Video Synopsis</h2>
            </div>
            {/* <p>Re-synthesize hours of surveillance footage into a condensed, interactive visual briefing.</p> */}
          </header>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', flex: 1, minHeight: 0, marginBottom: 0 }}>
          <section className="glass-panel synopsis-controls-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: 0, padding: '20px' }}>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', width: '100%' }}>
              <div className="form-group">
                <label style={{ fontSize: '0.8rem' }}>Camera</label>
                <div className="input-wrapper">
                  <span className="material-icons-outlined input-icon" style={{ fontSize: '1rem', left: '10px' }}>videocam</span>
                  <select value={selectedCamera} onChange={(e) => setSelectedCamera(e.target.value)} style={{ padding: '8px 12px 8px 34px', fontSize: '0.9rem' }}>
                    {cameras && cameras.map((c) => (
                      <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem' }}>From Time</label>
                <DateTimePicker 
                  value={rangeStart} 
                  onChange={setRangeStart} 
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.8rem' }}>To Time</label>
                <DateTimePicker 
                  value={rangeEnd} 
                  onChange={setRangeEnd} 
                />
              </div>
            </div>

            <div className="form-group direction-draw-group" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginTop: '0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '6px', flexShrink: 0 }}>
                <div>
                  <label style={{ fontSize: '0.8rem' }}>Filter by Direction (Optional)</label>
                  <p className="helper-text" style={{margin: '0', fontSize: '0.75rem', color: 'var(--text-muted)'}}>
                    Draw an arrow below to only include objects moving in that specific direction.
                  </p>
                </div>
                {directionAngle !== null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: '500', color: '#38bdf8' }}>
                      <span className="material-icons-outlined" style={{ fontSize: '0.9rem', verticalAlign: 'middle', marginRight: '2px' }}>explore</span>
                      {directionAngle.toFixed(1)}°
                    </span>
                    <button type="button" onClick={clearDirection} style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="material-icons-outlined" style={{ fontSize: '0.8rem' }}>clear</span> Clear
                    </button>
                  </div>
                )}
              </div>

              <div style={{ flex: 1, minHeight: 0, position: 'relative', width: '100%', backgroundColor: 'var(--bg-active)', border: directionAngle !== null ? '1px solid #38bdf8' : '1px dashed var(--border)', borderRadius: '8px', overflow: 'hidden', backgroundImage: `${(cameras?.find(c => (c.id || c._id) === selectedCamera)?.thumbnail || cameras?.find(c => (c.id || c._id) === selectedCamera)?.snapshot_url) ? `url(${cameras.find(c => (c.id || c._id) === selectedCamera).thumbnail || cameras.find(c => (c.id || c._id) === selectedCamera).snapshot_url}), ` : ''}radial-gradient(var(--border) 1px, transparent 1px)`, backgroundSize: 'cover, 20px 20px', backgroundPosition: 'center', boxShadow: directionAngle !== null ? '0 0 0 2px rgba(56, 189, 248, 0.2)' : 'none', transition: 'all 0.2s' }}>
                <canvas
                  ref={canvasRef}
                  width={1280}
                  height={720}
                  style={{ width: '100%', height: '100%', cursor: 'crosshair', display: 'block', zIndex: 10, position: 'relative' }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
                {!directionAngle && !isDrawing && (
                   <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', zIndex: 5 }}>
                     <span className="material-icons-outlined" style={{ fontSize: '1.5rem', opacity: 0.5 }}>draw</span>
                     <span style={{ fontSize: '0.8rem' }}>Drag to draw direction</span>
                   </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '12px', flexShrink: 0 }}>
              <button className={`btn-generate ${loading ? 'loading' : ''}`} style={{ width: '100%', padding: '10px 16px', fontSize: '0.95rem', height: 'auto' }} onClick={handleGenerateSynopsis} disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner"></span> Compiling Synopsis...
                  </>
                ) : (
                  <>
                    <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>auto_awesome</span> Generate Synopsis
                  </>
                )}
              </button>
            </div>
          </section>

          <section className="glass-panel synopsis-history-card fade-in" ref={containerRef} style={{ padding: '20px', margin: 0, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              
              {/* Header — always visible */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexShrink: 0 }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem' }}>
                  {/* Back arrow — shown whenever a job is active */}
                  {activeJob && (
                    <button
                      onClick={() => { setActiveJob(null); setMetadataItems([]); setCurrentActiveObjects([]); setShowHeatmap(false); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                      title="Back to list"
                    >
                      <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>arrow_back</span>
                    </button>
                  )}

                  {activeJob && activeJob.status === 'completed' ? (
                    <>
                      <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>movie</span>
                      {isEditingName ? (
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input
                            autoFocus
                            type="text"
                            value={editNameValue}
                            onChange={e => setEditNameValue(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                            style={{ background: 'var(--bg-active)', border: '1px solid #38bdf8', color: 'var(--text-primary)', padding: '2px 8px', borderRadius: '4px', outline: 'none', fontSize: '0.9rem', width: '160px' }}
                          />
                          <button onClick={handleSaveName} style={{ background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer', padding: '2px', display: 'flex' }}>
                            <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>check</span>
                          </button>
                          <button onClick={() => setIsEditingName(false)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '2px', display: 'flex' }}>
                            <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>close</span>
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '0.95rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeJob.job_name || activeJob.job_id}</span>
                          <button onClick={handleEditNameClick} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex' }} title="Rename">
                            <span className="material-icons-outlined" style={{ fontSize: '0.95rem' }}>edit</span>
                          </button>
                        </div>
                      )}
                    </>
                  ) : activeJob ? (
                    <>
                      <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>hourglass_top</span>
                      <span style={{ fontSize: '0.95rem' }}>{activeJob.job_name || activeJob.job_id}</span>
                    </>
                  ) : (
                    <>
                      <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>history</span> Previous Runs
                    </>
                  )}
                </h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {activeJob && activeJob.heatmap_url && activeJob.status === 'completed' && (
                    <button
                      className={`heatmap-toggle-btn ${showHeatmap ? 'active' : ''}`}
                      onClick={() => setShowHeatmap(!showHeatmap)}
                      style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                    >
                      <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>{showHeatmap ? 'visibility_off' : 'whatshot'}</span>
                      {showHeatmap ? 'Hide' : 'Heatmap'}
                    </button>
                  )}
                </div>
              </div>

              {/* Content area — toggles between list and player */}
              <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                {/* Video Player View */}
                {activeJob && activeJob.status === 'completed' && (
                  <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ position: 'relative', width: '100%', flexGrow: 1, minHeight: 0 }}>
                      <video
                        ref={videoRef}
                        // src={`http://localhost:8005${activeJob.output_video_url}`}
                        src={`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${activeJob.output_video_url}`}

                        controls
                        autoPlay
                        muted
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleResize}
                        className="synopsis-video-player"
                        style={{ width: '100%', height: '100%', maxHeight: '100%', borderRadius: '8px', display: 'block', objectFit: 'contain', background: '#000' }}
                      />
                      {showHeatmap && activeJob.heatmap_url && (
                        <img src={`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${activeJob.heatmap_url}`} className="heatmap-overlay" alt="Activity Heatmap" />
                      )}
                      {videoDimensions.width > 0 && currentActiveObjects.map((obj, idx) => {
                        const scaled = getScaledBBox(obj.bbox);
                        return (
                          <div
                            key={`${obj.track_id}-${idx}`}
                            className="interactive-bbox-overlay"
                            style={{ left: `${scaled.left}px`, top: `${scaled.top}px`, width: `${scaled.width}px`, height: `${scaled.height}px` }}
                            onClick={() => handleJumpToOriginal(obj)}
                            title={`Click to view ${obj.original_timestamp}`}
                          />
                        );
                      })}
                    </div>
                    <p className="helper-text" style={{ margin: '6px 0 0 0', fontSize: '0.75rem', flexShrink: 0 }}>
                      Click on any bounded subject to jump to their original recording.
                    </p>
                  </div>
                )}

                {/* Progress / Error View */}
                {activeJob && activeJob.status !== 'completed' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Status</span>
                      <span className={`status-badge status-${activeJob.status}`}>{activeJob.status.toUpperCase()}</span>
                    </div>
                    {(activeJob.status === 'processing' || activeJob.status === 'queued') && (
                      <div className="progress-container">
                        <div className="progress-stats">
                          <span>Compilation Progress</span>
                          <span>{activeJob.progress?.toFixed(0) ?? 0}%</span>
                        </div>
                        <div className="progress-bar-bg">
                          <div className="progress-bar-fill pulse" style={{ width: `${activeJob.progress ?? 0}%` }}></div>
                        </div>
                      </div>
                    )}
                    {activeJob.error_message && (
                      <div className="error-box">
                        <span className="material-icons-outlined">error_outline</span>
                        {activeJob.error_message}
                      </div>
                    )}
                  </div>
                )}

                {/* History List View */}
                {!activeJob && (
                  <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '4px', minHeight: 0 }}>
                    {jobHistory.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                        <span className="material-icons-outlined" style={{ fontSize: '3rem', opacity: 0.2, marginBottom: '8px' }}>history</span>
                        <p>No previous synopsis runs.</p>
                      </div>
                    ) : (
                      jobHistory.map((job) => (
                        <div key={job.job_id} className="history-item" style={{ 
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                          padding: '12px 16px', background: 'var(--bg-base)', borderRadius: '8px',
                          border: '1px solid var(--border)', marginBottom: '8px'
                        }}>
                          <div>
                            <strong style={{ fontSize: '0.9rem' }}>{job.job_name || job.job_id}</strong>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                              {job.range_start} - {job.range_end}
                            </span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                            <span className={`status-badge status-${job.status}`}>{job.status.toUpperCase()}</span>
                            {(job.status === 'completed' || job.status === 'processing' || job.status === 'queued') && (
                              <button 
                                onClick={() => {
                                  setActiveJob(job);
                                  if (job.status === 'processing' || job.status === 'queued') pollJobStatus(job.job_id);
                                  if (job.metadata_sidecar_url) fetchMetadataSidecar(job.metadata_sidecar_url);
                                }}
                                style={{ background: 'var(--bg-hover)', border: '1px solid #38bdf8', color: '#38bdf8', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                              >
                                <span className="material-icons-outlined" style={{ fontSize: '0.95rem' }}>{job.status === 'completed' ? 'play_circle' : 'hourglass_top'}</span>
                                {job.status === 'completed' ? 'View Video' : 'Track Progress'}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

              </div>
            </section>
        </div>

      </div>
      
      {/* Raw Video Modal */}
      {rawModal.isOpen && (
        <div className="raw-video-modal-backdrop" onClick={() => setRawModal({ isOpen: false, item: null })}>
          <div className="raw-video-modal-content" onClick={e => e.stopPropagation()}>
            <div className="raw-modal-header">
              <h3>Raw Camera Playback</h3>
              <button onClick={() => setRawModal({ isOpen: false, item: null })} className="close-btn">
                <span className="material-icons-outlined">close</span>
              </button>
            </div>
            <div className="raw-modal-body">
              <p>Requested Timestamp: <strong>{rawModal.item.original_timestamp}</strong></p>
              <p className="text-muted">
                Camera: {cameras?.find(c => (c.id || c._id) === rawModal.item.camera_id)?.name || rawModal.item.camera_id}
              </p>
              
              <div className="raw-video-player">
                {rawVideoLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', background: 'var(--bg-base)', borderRadius: '8px', marginTop: '16px', color: 'var(--text-muted)' }}>
                    <div className="spinner" style={{ marginRight: '12px' }}></div> Extracting Raw Clip from Archive...
                  </div>
                ) : rawVideoError ? (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', background: 'var(--bg-base)', borderRadius: '8px', marginTop: '16px', color: '#ef4444' }}>
                    <span className="material-icons-outlined" style={{ marginRight: '8px' }}>error_outline</span>
                    {rawVideoError}
                  </div>
                ) : rawVideoUrl ? (
                  <video ref={rawVideoRef} controls autoPlay muted style={{ width: '100%', borderRadius: '8px', marginTop: '16px', background: 'var(--bg-base)' }}>
                    Your browser does not support the video tag.
                  </video>
                ) : (
                  <div style={{ height: '300px', background: 'var(--bg-base)', borderRadius: '8px', marginTop: '16px' }}></div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

