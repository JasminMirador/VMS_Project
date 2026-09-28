import React, { useState, useEffect, useRef } from "react";
import Hls from "hls.js";
import "./VideoSynopsisPage.css";
import { useCameras } from "../../context/CamerasContext";
import DateTimePicker from "../../components/shared/DateTimePicker";

export default function FaceDetectionPage() {
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

  const [loading, setLoading] = useState(false);
  const [jobProgress, setJobProgress] = useState(0);
  const [faces, setFaces] = useState([]);
  const [jobHistory, setJobHistory] = useState([]);
  const [editingJobId, setEditingJobId] = useState(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [toastMessage, setToastMessage] = useState(null);
  
  useEffect(() => {
    fetchJobHistory();
  }, []);

  const fetchJobHistory = async () => {
    try {
      // const res = await fetch(`${import.meta.env.VITE_SYNOPSIS_API_URL || "http://localhost:8005"}/a1/v1/synopsis/face-jobs`);
      const res = await fetch(`${import.meta.env.VITE_SYNOPSIS_API_URL || `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005`}/a1/v1/synopsis/face-jobs`);
      const data = await res.json();
      setJobHistory((data || []).slice(0, 50));
    } catch (err) {
      console.error("Error fetching job history:", err);
    }
  };

  const handleRenameSubmit = async (jobId) => {
    try {
      // const res = await fetch(`${import.meta.env.VITE_SYNOPSIS_API_URL || "http://localhost:8005"}/a1/v1/synopsis/face-jobs/${jobId}`, {
      const res = await fetch(`${import.meta.env.VITE_SYNOPSIS_API_URL || `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005`}/a1/v1/synopsis/face-jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_name: editNameValue })
      });
      if (res.ok) {
        setJobHistory(prev => prev.map(j => j.job_id === jobId ? { ...j, job_name: editNameValue } : j));
      }
    } catch (err) {
      console.error("Failed to rename job", err);
    }
    setEditingJobId(null);
  };
  
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

  // const SYNOPSIS_API = "http://localhost:8005";
  const SYNOPSIS_API = `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005`;

  const handleSearchFaces = async () => {
    setLoading(true);
    setFaces([]);
    setJobProgress(0);
    
    try {
      // Create a face detection job on the synopsis-service
      const createRes = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: selectedCamera,
          camera_name: cameras?.find(c => (c.id || c._id) === selectedCamera)?.name || selectedCamera,
          range_start: rangeStart,
          range_end: rangeEnd
        })
      });

      if (!createRes.ok) {
        const errBody = await createRes.json().catch(() => ({}));
        throw new Error(errBody.detail || "Failed to start face detection job");
      }
      
      const jobData = await createRes.json();
      const jobId = jobData.job_id;

      // Poll until job is completed or failed
      const pollJob = async () => {
        try {
          const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${jobId}`);
          if (!res.ok) throw new Error("Failed to poll job status");
          const data = await res.json();
          setJobProgress(data.progress || 0);

          if (data.status === "completed") {
            setFaces(data.faces || []);
            setLoading(false);
            setJobProgress(100);
            fetchJobHistory();
          } else if (data.status === "failed") {
            throw new Error(data.error_message || "Face detection job failed");
          } else {
            setTimeout(pollJob, 2500);
          }
        } catch(pollErr) {
          console.error(pollErr);
          setToastMessage(pollErr.message || "Face detection failed.");
          setLoading(false);
        }
      };

      pollJob();

    } catch (err) {
      console.error(err);
      setToastMessage(err.message || "Failed to search faces.");
      setLoading(false);
    }
  };

  const handleJumpToOriginal = async (item) => {
    setRawModal({ isOpen: true, item });
    setRawVideoUrl(null);
    setRawVideoLoading(true);
    setRawVideoError(null);
    try {
      // Resolve IP from cameras list — selectedCamera is a MongoDB _id
      const cam = cameras?.find(c => (c.id || c._id) === selectedCamera);
      const playbackIp = cam?.ip || cam?.serial || selectedCamera;
      const time = item.timestamp;
      const formattedTime = time.replace(" ", "T");
      
      const url = `${API}/api/event-playback?ip=${encodeURIComponent(playbackIp)}&time=${encodeURIComponent(formattedTime)}`;
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

  // Resolve camera IP for event-playback (needs IP, not MongoDB _id)
  const selectedCam = cameras?.find(c => (c.id || c._id) === selectedCamera);
  const camIp = selectedCam?.ip || selectedCam?.serial || selectedCamera;

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  return (
    <div className="synopsis-page">
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
            <h2>Face Detection</h2>
          </div>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, minHeight: 0, marginBottom: 0 }}>
          <section className="glass-panel synopsis-controls-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: 0, padding: '20px', flexShrink: 0 }}>
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

            <div style={{ marginTop: 'auto', paddingTop: '16px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '32px' }}>
              
              {loading ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div className="progress-container" style={{ width: '100%', margin: 0 }}>
                    <div className="progress-stats" style={{ fontSize: '0.85rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span className={`status-badge status-processing`} style={{ fontSize: '0.7rem', padding: '3px 8px' }}>PROCESSING</span>
                      <span style={{ color: '#f8fafc', fontWeight: 500 }}>Detection Progress</span>
                      <span style={{ marginLeft: 'auto', color: '#38bdf8', fontWeight: 600, fontSize: '0.95rem' }}>{jobProgress?.toFixed(0) ?? 0}%</span>
                    </div>
                    <div className="progress-bar-bg" style={{ height: '6px', background: 'rgba(255,255,255,0.1)' }}>
                      <div className="progress-bar-fill pulse" style={{ width: `${jobProgress ?? 0}%`, height: '100%', borderRadius: '4px' }}></div>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'none' }}></div>
              )}

              <button className={`btn-generate ${loading ? 'loading' : ''}`} style={{ width: loading ? '180px' : '100%', padding: '12px 16px', fontSize: '0.95rem', height: 'fit-content', transition: 'width 0.3s ease' }} onClick={handleSearchFaces} disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner"></span> Detecting...
                  </>
                ) : (
                  <>
                    <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>search</span> Search Faces
                  </>
                )}
              </button>
            </div>
          </section>

          <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
            <section className="glass-panel synopsis-history-card fade-in" style={{ padding: '20px', margin: 0, flex: 3, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexShrink: 0 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem' }}>
                <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>face</span> Detected Faces
              </h3>
            </div>

            <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '4px', minHeight: 0 }}>
              {faces.length === 0 && !loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                  <span className="material-icons-outlined" style={{ fontSize: '3rem', opacity: 0.2, marginBottom: '8px' }}>search_off</span>
                  <p>No faces detected for the selected time range.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '16px' }}>
                  {faces.map((face, index) => (
                    <div key={face.track_id || index} style={{ 
                      background: 'var(--bg-base)', borderRadius: '8px', border: '1px solid var(--border)', 
                      overflow: 'hidden', cursor: 'pointer', transition: 'all 0.2s ease', position: 'relative' 
                    }}
                    onClick={() => handleJumpToOriginal(face)}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#38bdf8'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                    >
                      <img 
                        src={
                          face.thumbnail_path
                            // Pre-saved static JPEG (correct frame, saved during detection)
                            ? `${SYNOPSIS_API}/a1/v1/synopsis/face-static/${encodeURIComponent(face.thumbnail_path.split(/[\\/]/).pop())}`
                            // Fallback: seek-based endpoint (may be inaccurate on .ts files)
                            : face.face_bbox && face.face_bbox.length === 4
                              ? `${SYNOPSIS_API}/a1/v1/synopsis/face-thumbnail?camera_id=${encodeURIComponent(selectedCamera)}&timestamp=${encodeURIComponent(face.timestamp)}&fx=${face.face_bbox[0]}&fy=${face.face_bbox[1]}&fw=${face.face_bbox[2]}&fh=${face.face_bbox[3]}`
                              : `${API}/api/alerts/thumbnail?ip=${encodeURIComponent(camIp)}&time=${encodeURIComponent(face.timestamp)}&crop=1`
                        } 
                        alt="Detected Face" 
                        style={{ width: '100%', height: '150px', objectFit: 'cover', display: 'block' }}
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150' viewBox='0 0 24 24' fill='none' stroke='%23475569' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='8' r='5'/><path d='M20 21a8 8 0 0 0-16 0'/></svg>";
                        }}
                      />
                      <div style={{ padding: '8px', background: 'rgba(15, 23, 42, 0.9)', position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                        <span style={{ fontSize: '0.75rem', color: '#e2e8f0', display: 'block' }}>
                          {new Date(face.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="play-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.5)', borderRadius: '50%', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }}>
                        <span className="material-icons-outlined" style={{ color: 'white', fontSize: '2rem' }}>play_circle</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
          
          <section className="glass-panel synopsis-history-card fade-in" style={{ padding: '20px', margin: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <h3 style={{ margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', flexShrink: 0 }}>
              <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>history</span> Previous Runs
            </h3>
            
            <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '4px', minHeight: 0 }}>
              {jobHistory.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                  <span className="material-icons-outlined" style={{ fontSize: '3rem', opacity: 0.2, marginBottom: '8px' }}>history</span>
                  <p>No previous detection runs.</p>
                </div>
              ) : (
                jobHistory.map((job) => (
                  <div key={job.job_id} className="history-item" style={{ 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                    padding: '12px 16px', background: 'var(--bg-base)', borderRadius: '8px',
                    border: '1px solid var(--border)', marginBottom: '8px', cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onClick={async () => {
                    if (editingJobId === job.job_id) return;
                    try {
                      const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${job.job_id}`);
                      if (!res.ok) throw new Error("Failed to load job");
                      const data = await res.json();
                      setFaces(data.faces || []);
                      setRangeStart(data.range_start);
                      setRangeEnd(data.range_end);
                      setSelectedCamera(data.camera_id);
                    } catch (err) {
                      console.error("Failed to load past job:", err);
                    }
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#38bdf8'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    <div style={{ flex: 1, minWidth: 0, marginRight: '12px' }}>
                      {editingJobId === job.job_id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <input
                            type="text"
                            value={editNameValue}
                            onChange={(e) => setEditNameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(job.job_id); else if (e.key === 'Escape') setEditingJobId(null); }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ padding: '2px 6px', fontSize: '0.9rem', width: '100%', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid #38bdf8', borderRadius: '4px' }}
                            autoFocus
                          />
                          <button onClick={(e) => { e.stopPropagation(); handleRenameSubmit(job.job_id); }} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', display: 'flex' }}>
                            <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>check</span>
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                          <strong style={{ fontSize: '0.9rem', fontWeight: 500, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {job.job_name || job.job_id}
                          </strong>
                          <button onClick={(e) => { e.stopPropagation(); setEditingJobId(job.job_id); setEditNameValue(job.job_name || job.job_id); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex' }} title="Rename">
                            <span className="material-icons-outlined" style={{ fontSize: '0.95rem' }}>edit</span>
                          </button>
                        </div>
                      )}
                      
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                        {job.range_start} to {job.range_end}
                      </div>
                      
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span className="material-icons-outlined" style={{ fontSize: '0.9rem' }}>videocam</span>
                        {cameras?.find(c => (c.id || c._id) === job.camera_id)?.name || job.camera_id}
                        
                        <span style={{ margin: '0 4px', opacity: 0.5 }}>|</span>
                        <span className="material-icons-outlined" style={{ fontSize: '0.9rem' }}>face</span>
                        {job.status === 'completed' ? (job.faces ? job.faces.length : 0) : '...'} Faces
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span className={`status-badge status-${job.status}`} style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
                        {job.status.toUpperCase()}
                      </span>
                      <span className="material-icons-outlined" style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>chevron_right</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
          </div>
        </div>
      </div>

      {rawModal.isOpen && (
        <div className="raw-video-modal-backdrop" onClick={() => setRawModal({ isOpen: false, item: null })}>
          <div className="raw-video-modal-content" onClick={e => e.stopPropagation()}>
            <div className="raw-modal-header">
              <h3>Face Playback Alert (20s clip)</h3>
              <button onClick={() => setRawModal({ isOpen: false, item: null })} className="close-btn">
                <span className="material-icons-outlined">close</span>
              </button>
            </div>
            <div className="raw-modal-body">
              <p>Timestamp: <strong>{rawModal.item.timestamp}</strong></p>
              
              <div className="raw-video-player">
                {rawVideoLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', background: 'var(--bg-base)', borderRadius: '8px', marginTop: '16px', color: 'var(--text-muted)' }}>
                    <div className="spinner" style={{ marginRight: '12px' }}></div> Preparing alert clip...
                  </div>
                ) : rawVideoError ? (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', background: 'var(--bg-base)', borderRadius: '8px', marginTop: '16px', color: '#ef4444' }}>
                    <span className="material-icons-outlined" style={{ marginRight: '8px' }}>error_outline</span>
                    {rawVideoError}
                  </div>
                ) : rawVideoUrl ? (
                  <video ref={rawVideoRef} controls autoPlay style={{ width: '100%', borderRadius: '8px', marginTop: '16px', background: 'var(--bg-base)' }}>
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
      <style>{`
        .synopsis-page .play-overlay {
          pointer-events: none;
        }
        .synopsis-page > div > div > section > div > div > div:hover .play-overlay {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}
