import React, { useState, useEffect, useRef } from "react";
import Hls from "hls.js";
import "./VideoSynopsisPage.css";
import { useCameras } from "../../context/CamerasContext";
import DateTimePicker from "../../components/shared/DateTimePicker";

export default function FaceDetectionPage() {
  const { cameras } = useCameras();
  const [selectedCameras, setSelectedCameras] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (cameras && cameras.length > 0 && selectedCameras.length === 0) {
      setSelectedCameras([cameras[0].id || cameras[0]._id]);
    }
  }, [cameras, selectedCameras]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleCamera = (id) => {
    setSelectedCameras(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  };

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
  const [showHistory, setShowHistory] = useState(false);
  const [currentJobDetails, setCurrentJobDetails] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  
  useEffect(() => {
    fetchJobHistory();
  }, []);

  const fetchJobHistory = async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_SYNOPSIS_API_URL || `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005`}/a1/v1/synopsis/face-jobs`);
      const data = await res.json();
      setJobHistory((data || []).slice(0, 50));
    } catch (err) {
      console.error("Error fetching job history:", err);
    }
  };

  const handleRenameSubmit = async (jobId) => {
    try {
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

  const SYNOPSIS_API = `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005`;

  const handleSearchFaces = async () => {
    const now = new Date();
    if (new Date(rangeStart) > now || new Date(rangeEnd) > now) {
      setToastMessage("Future date and time cannot be selected.");
      return;
    }

    setLoading(true);
    setFaces([]);
    setJobProgress(0);
    setCurrentJobDetails(null);
    setShowDetailsModal(false);
    setShowHistory(false);
    
    try {
      // Create a face detection job on the synopsis-service
      const createRes = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: selectedCameras, // passing array of camera IDs
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
      setCurrentJobDetails(jobData);

      // Poll until job is completed or failed
      const pollJob = async () => {
        try {
          const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${jobId}`);
          if (!res.ok) throw new Error("Failed to poll job status");
          const data = await res.json();
          setJobProgress(data.progress || 0);
          setCurrentJobDetails(data);

          if (data.status === "completed") {
            const finalRes = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${jobId}`);
            const finalData = await finalRes.json();
            const sortedFaces = (finalData.faces || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            setFaces(sortedFaces);
            setLoading(false);
            setJobProgress(100);
            setShowDetailsModal(false);
            fetchJobHistory();
          } else if (data.status === "failed") {
            throw new Error(data.error_message || "Face detection job failed");
          } else if (data.status === "cancelled") {
            setLoading(false);
            setShowDetailsModal(false);
            setToastMessage("Face detection job was cancelled.");
            fetchJobHistory();
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
      // Resolve IP from cameras list â€” selectedCameras is an array
      const faceCamId = item.camera_id || selectedCameras[0];
      const cam = cameras?.find(c => (c.id || c._id) === faceCamId);
      const playbackIp = cam?.ip || cam?.serial || faceCamId;
      const time = item.timestamp;
      const formattedTime = time.replace(" ", "T");
      
      const url = `${SYNOPSIS_API}/a1/v1/synopsis/event-playback?camera_id=${encodeURIComponent(faceCamId)}&timestamp=${encodeURIComponent(formattedTime)}`;
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

  const handleDownloadVideo = async () => {
    if (!rawVideoUrl || !rawModal.item) return;
    try {
      setToastMessage("Preparing download...");
      const fullUrl = rawVideoUrl.startsWith('http') ? rawVideoUrl : `${API}${rawVideoUrl.startsWith('/') ? '' : '/'}${rawVideoUrl}`;
      const isHls = fullUrl.includes(".m3u8");
      const safeTime = new Date(rawModal.item.timestamp).getTime();
      const token = localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      if (isHls) {
        const playlistRes = await fetch(fullUrl, { headers });
        if (!playlistRes.ok) throw new Error(`Server returned ${playlistRes.status}`);
        const playlistText = await playlistRes.text();

        const segmentNames = playlistText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));

        if (segmentNames.length === 0) throw new Error("Playlist has no video segments");

        const baseUrl = fullUrl.substring(0, fullUrl.lastIndexOf("/") + 1);
        const segmentBuffers = [];
        for (const name of segmentNames) {
          const segUrl = /^https?:\/\//.test(name) ? name : baseUrl + name;
          const segRes = await fetch(segUrl, { headers });
          if (!segRes.ok) throw new Error(`Failed to fetch segment ${name}`);
          segmentBuffers.push(await segRes.arrayBuffer());
        }

        const blob = new Blob(segmentBuffers, { type: "video/mp2t" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `Face_Playback_${safeTime}.ts`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        setToastMessage("Download started!");
      } else {
        const response = await fetch(fullUrl, { headers });
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `Face_Playback_${safeTime}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        setToastMessage("Download started!");
      }
    } catch (err) {
      console.error("Download error:", err);
      setToastMessage("Download failed: " + err.message);
    }
  };

  // Resolve camera IP for event-playback (needs IP, not MongoDB _id)
  // Default to first selected camera for fallback IP usage
  const selectedCam = cameras?.find(c => (c.id || c._id) === selectedCameras[0]);
  const camIp = selectedCam?.ip || selectedCam?.serial || selectedCameras[0];

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
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', width: '100%', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ width: '220px', flexShrink: 0, marginBottom: 0 }}>
                  <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '6px' }}>Camera</label>
                <div className="input-wrapper" ref={dropdownRef} style={{ position: 'relative' }}>
                  <span className="material-icons-outlined input-icon" style={{ fontSize: '1rem', left: '10px', zIndex: 2, pointerEvents: 'none' }}>videocam</span>
                  <div 
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    style={{ padding: '8px 12px 8px 34px', fontSize: '0.9rem', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--bg-base)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%', minHeight: '38px', color: '#f8fafc' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedCameras.length === 0 ? "Select Cameras" : 
                       selectedCameras.length === 1 ? (cameras?.find(c => (c.id || c._id) === selectedCameras[0])?.name || selectedCameras[0]) : 
                       `${selectedCameras.length} Cameras Selected`}
                    </span>
                    <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>arrow_drop_down</span>
                  </div>
                  {isDropdownOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '4px', marginTop: '4px', maxHeight: '250px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
                      {cameras && cameras.map((c) => (
                        <div key={c.id || c._id} 
                          onClick={() => toggleCamera(c.id || c._id)}
                          style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <input type="checkbox" checked={selectedCameras.includes(c.id || c._id)} readOnly style={{ cursor: 'pointer', margin: 0, accentColor: '#38bdf8', width: '16px', height: '16px' }} />
                          <span style={{ fontSize: '0.9rem', color: '#f8fafc' }}>{c.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Display Camera Names next to the dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', height: '38px', paddingLeft: '8px', maxWidth: '300px' }}>
                {selectedCameras.length > 1 && (
                  <span style={{ fontSize: '0.85rem', color: '#38bdf8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <i className="fa-solid fa-video" style={{ marginRight: '6px' }}></i>
                    {selectedCameras.map(cid => cameras?.find(c => (c.id || c._id) === cid)?.name || cid).join(', ')}
                  </span>
                )}
              </div>

              <div className="form-group" style={{ flex: 1, minWidth: '220px', marginBottom: 0 }}>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '6px' }}>From Time</label>
                <DateTimePicker 
                  value={rangeStart} 
                  onChange={setRangeStart} 
                />
              </div>

              <div className="form-group" style={{ flex: 1, minWidth: '220px', marginBottom: 0 }}>
                <label style={{ fontSize: '0.8rem', display: 'block', marginBottom: '6px' }}>To Time</label>
                <DateTimePicker 
                  value={rangeEnd} 
                  onChange={setRangeEnd} 
                />
              </div>

              <div style={{ flexShrink: 0, display: 'flex', gap: '8px' }}>
                <button className={`btn-generate ${loading ? 'loading' : ''}`} style={{ width: '160px', padding: '10px 16px', fontSize: '0.95rem', height: '38px', transition: 'width 0.3s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', margin: 0 }} onClick={handleSearchFaces} disabled={loading}>
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
                {loading && (
                  <button 
                    onClick={async () => {
                      if (currentJobDetails?.job_id) {
                        try {
                          await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${currentJobDetails.job_id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ status: "cancelled", job_name: currentJobDetails.job_name || currentJobDetails.job_id })
                          });
                          setToastMessage("Job cancelled");
                        } catch (e) {
                          console.error(e);
                        }
                      }
                    }}
                    style={{ 
                      width: '100px', padding: '10px 16px', fontSize: '0.95rem', height: '38px',
                      background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid #ef4444',
                      borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                    }}
                  >
                    <span className="material-icons-outlined" style={{ fontSize: '1.1rem' }}>clear</span> Clear
                  </button>
                )}
              </div>
            </div>

            {(loading || (currentJobDetails && currentJobDetails.status === 'completed' && showDetailsModal)) && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', marginTop: '4px' }}>
                <div 
                  className="progress-container" 
                  style={{ width: '100%', margin: 0, cursor: 'pointer', transition: 'all 0.2s' }}
                  onClick={() => setShowDetailsModal(true)}
                  title="Click to view processing details"
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div className="progress-stats" style={{ fontSize: '0.85rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={`status-badge status-${currentJobDetails?.status === 'completed' ? 'completed' : 'processing'}`} style={{ fontSize: '0.7rem', padding: '3px 8px' }}>
                      {currentJobDetails?.status === 'completed' ? 'COMPLETED' : 'PROCESSING'}
                    </span>
                    <span style={{ color: '#f8fafc', fontWeight: 500 }}>Detection Progress</span>
                    <span style={{ fontSize: '0.75rem', color: '#ffffff', marginLeft: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <i className="fa-solid fa-circle-info"></i> Click for details
                    </span>
                    <span style={{ marginLeft: 'auto', color: '#38bdf8', fontWeight: 600, fontSize: '0.95rem' }}>{jobProgress?.toFixed(0) ?? 0}%</span>
                  </div>
                  <div className="progress-bar-bg" style={{ height: '6px', background: 'rgba(255,255,255,0.1)' }}>
                    <div className="progress-bar-fill pulse" style={{ width: `${jobProgress ?? 0}%`, height: '100%', borderRadius: '4px' }}></div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
            <section className="glass-panel synopsis-history-card fade-in" style={{ padding: '20px', margin: 0, flex: 3, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexShrink: 0 }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem' }}>
                  <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>face</span> Detected Faces
                </h3>
                {!showHistory && (
                  <button 
                    onClick={() => setShowHistory(true)}
                    style={{ 
                      background: 'transparent', 
                      border: '1px solid var(--border)', 
                      borderRadius: '6px', 
                      padding: '6px 12px', 
                      color: '#ffffff', 
                      cursor: 'pointer', 
                      display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#38bdf8'; e.currentTarget.style.borderColor = '#38bdf8'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    <i className="fa-solid fa-clock-rotate-left"></i> Previous Runs
                  </button>
                )}
              </div>

            <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '4px', minHeight: 0 }}>
              {faces.length === 0 && !loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ffffff' }}>
                  <span className="material-icons-outlined" style={{ fontSize: '3rem', opacity: 0.2, marginBottom: '8px' }}>search_off</span>
                  <p>No faces detected for the selected time range.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '16px' }}>
                  {faces.map((face, index) => {
                      const faceCamId = face.camera_id || selectedCameras[0];
                      const cam = cameras?.find(c => (c.id || c._id) === faceCamId);
                      const camName = cam ? cam.name : (faceCamId || "Unknown");
                      return (
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
                              ? `${SYNOPSIS_API}/a1/v1/synopsis/face-static/${encodeURIComponent(face.thumbnail_path.split(/[\/]/).pop())}`
                              : face.face_bbox && face.face_bbox.length === 4
                                ? `${SYNOPSIS_API}/a1/v1/synopsis/face-thumbnail?camera_id=${encodeURIComponent(faceCamId)}&timestamp=${encodeURIComponent(face.timestamp)}&fx=${face.face_bbox[0]}&fy=${face.face_bbox[1]}&fw=${face.face_bbox[2]}&fh=${face.face_bbox[3]}`
                                : `${API}/api/alerts/thumbnail?ip=${encodeURIComponent(cam?.ip || cam?.serial || faceCamId)}&time=${encodeURIComponent(face.timestamp)}&crop=1`
                          } 
                          alt="Detected Face" 
                          style={{ width: '100%', height: '150px', objectFit: 'cover', display: 'block' }}
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150' viewBox='0 0 24 24' fill='none' stroke='%23475569' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='8' r='5'/><path d='M20 21a8 8 0 0 0-16 0'/></svg>";
                          }}
                        />
                        <div style={{ padding: '6px 8px', background: 'rgba(15, 23, 42, 0.9)', position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                          <span style={{ fontSize: '0.70rem', color: '#38bdf8', display: 'block', fontWeight: 'bold', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {camName}
                          </span>
                          <span style={{ fontSize: '0.70rem', color: '#e2e8f0', display: 'block' }}>
                            {new Date(face.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <div className="play-overlay" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.5)', borderRadius: '50%', padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }}>
                          <span className="material-icons-outlined" style={{ color: 'white', fontSize: '2rem' }}>play_circle</span>
                        </div>
                      </div>
                    )})}
                  </div>
                )}
              </div>
            </section>

            {/* Right Side: Previous Runs */}
            {showHistory && (
            <div className="history-panel" style={{ width: '350px', background: 'var(--bg-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', color: '#f8fafc' }}>
                  <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: '8px', color: '#38bdf8' }}></i> Previous Runs
                </h3>
                <button 
                  onClick={() => setShowHistory(false)}
                  style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer', padding: 0 }}
                >
                  <span className="material-icons-outlined">close</span>
                </button>
              </div>
              
              <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '4px' }}>
                {jobHistory.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#ffffff' }}>
                    <p>No previous detection runs.</p>
                  </div>
                ) : (
                  jobHistory.map((job) => (
                    <div key={job.job_id} className="history-item" style={{ 
                      display: 'flex', flexDirection: 'column', gap: '8px',
                      padding: '12px 16px', background: 'var(--bg-base)', borderRadius: '8px',
                      border: '1px solid var(--border)', marginBottom: '8px', cursor: 'pointer',
                      transition: 'all 0.2s', overflow: 'hidden'
                    }}
                    onClick={async () => {
                      if (editingJobId === job.job_id) return;
                      try {
                        const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${job.job_id}`);
                        if (!res.ok) throw new Error("Failed to load job");
                        const data = await res.json();
                        const sortedFaces = (data.faces || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                        setFaces(sortedFaces);
                        setRangeStart(data.range_start);
                        setRangeEnd(data.range_end);
                        setSelectedCameras(Array.isArray(data.camera_ids || data.camera_id) ? (data.camera_ids || data.camera_id) : [data.camera_id]);
                      } catch (err) {
                        console.error("Failed to load past job:", err);
                      }
                    }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                          {editingJobId === job.job_id ? (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <input 
                                type="text" 
                                value={editNameValue} 
                                onChange={e => setEditNameValue(e.target.value)}
                                onClick={e => e.stopPropagation()}
                                style={{ 
                                  background: 'var(--bg-surface)', border: '1px solid var(--border)', 
                                  color: '#f8fafc', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem',
                                  width: '100%'
                                }}
                                autoFocus
                              />
                              <button 
                                onClick={(e) => { e.stopPropagation(); handleRenameSubmit(job.job_id); }}
                                style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer' }}
                              >
                                <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>check</span>
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); setEditingJobId(null); }}
                                style={{ background: 'var(--bg-base)', color: '#f8fafc', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer' }}
                              >
                                <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>close</span>
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontWeight: '600', color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.job_name || job.job_id}</span>
                              <span 
                                className="material-icons-outlined edit-icon" 
                                style={{ fontSize: '1rem', color: '#ffffff', cursor: 'pointer', flexShrink: 0 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingJobId(job.job_id);
                                  setEditNameValue(job.job_name || job.job_id);
                                }}
                              >edit</span>
                            </div>
                          )}
                        </div>
                        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span 
                            className="material-icons-outlined"
                            style={{ fontSize: '1.1rem', color: '#38bdf8', cursor: 'pointer' }}
                            title="View Processing Details"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${job.job_id}`);
                                if (!res.ok) throw new Error("Failed to load job");
                                const data = await res.json();
                                setCurrentJobDetails(data);
                                setShowDetailsModal(true);
                              } catch (err) {
                                console.error("Failed to load past job details:", err);
                              }
                            }}
                          >info</span>
                          {job.status === 'completed' && <span style={{ color: '#10b981', fontSize: '0.65rem', fontWeight: 'bold', border: '1px solid #10b981', padding: '2px 6px', borderRadius: '12px' }}>COMPLETED</span>}
                          {job.status === 'failed' && <span style={{ color: '#ef4444', fontSize: '0.65rem', fontWeight: 'bold', border: '1px solid #ef4444', padding: '2px 6px', borderRadius: '12px' }}>FAILED</span>}
                          {job.status === 'cancelled' && <span style={{ color: '#fb923c', fontSize: '0.65rem', fontWeight: 'bold', border: '1px solid #fb923c', padding: '2px 6px', borderRadius: '12px' }}>CANCELLED</span>}
                          {job.status === 'processing' && <span style={{ color: '#38bdf8', fontSize: '0.65rem', fontWeight: 'bold', border: '1px solid #38bdf8', padding: '2px 6px', borderRadius: '12px' }}>{job.progress ? Math.round(job.progress) + '%' : 'PROCESSING'}</span>}
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '0.75rem', color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {(job.range_start || '').replace('T', ' ')} to {(job.range_end || '').replace('T', ' ')}
                        </span>
                        <span style={{ fontSize: '0.85rem', color: '#ffffff', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <i className="fa-solid fa-video" style={{ marginRight: '6px' }}></i>
                          {(() => {
                             let camNames = "";
                             if (Array.isArray(job.camera_id)) {
                               const names = job.camera_id.map(cid => cameras?.find(c => (c.id || c._id) === cid)?.name || cid);
                               camNames = names.join(', ');
                             } else {
                               camNames = cameras?.find(c => (c.id || c._id) === job.camera_id)?.name || job.camera_id;
                             }
                             return <span title={camNames} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{camNames}</span>;
                          })()}
                          <span style={{ margin: '0 6px' }}>|</span>
                          <i className="fa-solid fa-face-smile" style={{ marginRight: '6px' }}></i> {job.faces ? job.faces.length : '...'} Faces
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Right Side Video Player Panel */}
      <div 
        style={{
          position: 'fixed',
          top: 0,
          right: rawModal.isOpen ? 0 : '-500px',
          width: '450px',
          height: '100vh',
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.7)',
          transition: 'right 0.3s ease',
          zIndex: 99999999, // Extremely high to stay above navbars
          display: 'flex',
          flexDirection: 'column',
          padding: '24px',
          paddingTop: '80px' // Ensure it's not hidden by top navbars even if z-index fails
        }}
      >
        <button 
          onClick={() => setRawModal({ isOpen: false, item: null })} 
          style={{ 
            position: 'absolute', 
            top: '24px', 
            right: '24px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#f8fafc', 
            cursor: 'pointer',
            transition: 'all 0.2s',
            zIndex: 10
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.color = '#ffffff'; e.currentTarget.style.borderColor = '#ef4444'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#f8fafc'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
        >
          <span className="material-icons-outlined">close</span>
        </button>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-icons-outlined" style={{ color: '#38bdf8' }}>play_circle</span>
            Face Playback
          </h3>
        </div>

        {rawModal.item && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flexGrow: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ margin: 0, fontSize: '0.95rem', color: '#ffffff', marginBottom: '4px' }}>
                  Camera: <strong style={{ color: '#38bdf8' }}>{cameras?.find(c => (c.id || c._id) === (rawModal.item.camera_id || selectedCameras[0]))?.name || rawModal.item.camera_id || selectedCameras[0] || "Unknown"}</strong>
                </p>
                <p style={{ margin: 0, fontSize: '0.95rem', color: '#ffffff' }}>
                  Detected: <strong style={{ color: '#e2e8f0' }}>{new Date(rawModal.item.timestamp).toLocaleString()}</strong>
                </p>
              </div>
              {rawVideoUrl && (
                <button 
                  onClick={handleDownloadVideo}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 12px', background: 'var(--bg-base)', border: '1px solid var(--border)',
                    color: '#38bdf8', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 500,
                    cursor: 'pointer', transition: 'all 0.2s', outline: 'none'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#38bdf8'; e.currentTarget.style.color = '#0f172a'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-base)'; e.currentTarget.style.color = '#38bdf8'; }}
                >
                  <span className="material-icons-outlined" style={{ fontSize: '1.1rem' }}>download</span>
                  Download
                </button>
              )}
            </div>
            
            <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
              {rawVideoLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', background: 'var(--bg-base)', borderRadius: '12px', color: '#ffffff', border: '1px solid var(--border)' }}>
                  <div className="spinner" style={{ marginRight: '12px', border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#38bdf8', borderRadius: '50%', width: '20px', height: '20px', animation: 'spin 1s linear infinite' }}></div> Preparing alert clip...
                </div>
              ) : rawVideoError ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', background: 'var(--bg-base)', borderRadius: '12px', color: '#ef4444', textAlign: 'center', padding: '20px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                  <div>
                    <span className="material-icons-outlined" style={{ fontSize: '3rem', marginBottom: '12px', opacity: 0.8 }}>error_outline</span>
                    <p style={{ margin: 0 }}>{rawVideoError}</p>
                  </div>
                </div>
              ) : rawVideoUrl ? (
                <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
                  <video ref={rawVideoRef} controls autoPlay style={{ width: '100%', display: 'block', background: 'black' }}>
                    Your browser does not support the video tag.
                  </video>
                </div>
              ) : (
                <div style={{ height: '300px', background: 'var(--bg-base)', borderRadius: '12px', border: '1px solid var(--border)' }}></div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {showDetailsModal && currentJobDetails && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999999
        }}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: '12px', width: '90%', maxWidth: '700px', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <i className="fa-solid fa-server" style={{ color: '#38bdf8' }}></i> Processing Details
              </h3>
              <button onClick={() => setShowDetailsModal(false)} style={{ background: 'none', border: 'none', color: '#ffffff', cursor: 'pointer', display: 'flex' }}>
                <span className="material-icons-outlined">close</span>
              </button>
            </div>
            
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, background: 'var(--bg-base)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#ffffff' }}>Overall Status</p>
                  <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: currentJobDetails.status === 'completed' ? '#10b981' : currentJobDetails.status === 'failed' ? '#ef4444' : '#38bdf8' }}>
                    {currentJobDetails.status.toUpperCase()}
                  </p>
                </div>
                <div style={{ flex: 1, background: 'var(--bg-base)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#ffffff' }}>Progress</p>
                  <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: '#f8fafc' }}>
                    {Math.round(currentJobDetails.progress || 0)}%
                  </p>
                </div>
                <div style={{ flex: 1, background: 'var(--bg-base)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#ffffff' }}>Videos Processed</p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 'bold', color: '#f8fafc' }}>
                    {(currentJobDetails.clip_details || []).filter(c => c.status === 'completed' && !c.is_system).length} / {currentJobDetails.total_clips || 0}
                  </p>
                  {currentJobDetails.total_clips_by_camera && Object.entries(currentJobDetails.total_clips_by_camera).map(([cid, total]) => {
                    const camName = cameras?.find(c => (c.id || c._id) === cid)?.name || cid;
                    const processed = (currentJobDetails.clip_details || []).filter(c => c.status === 'completed' && !c.is_system && c.camera_id === cid).length;
                    return (
                      <p key={cid} style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#ffffff' }}>
                        <span style={{ color: '#38bdf8' }}>{camName}</span>: {processed} / {total}
                      </p>
                    );
                  })}
                </div>
              </div>

              <div>
                <h4 style={{ margin: '0 0 12px 0', color: '#e2e8f0', fontSize: '1.05rem' }}>Timeline</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {(currentJobDetails.clip_details || []).map((clip, idx) => {
                    const camName = cameras?.find(c => (c.id || c._id) === clip.camera_id)?.name || clip.camera_id;
                    return (
                      <div key={idx} style={{ 
                        display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--bg-base)', 
                        padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border)',
                        borderLeft: `4px solid ${clip.status === 'completed' ? '#10b981' : '#38bdf8'}`
                      }}>
                        <div style={{ width: '40px', display: 'flex', justifyContent: 'center' }}>
                          {clip.status === 'completed' ? (
                            <span className="material-icons-outlined" style={{ color: '#10b981' }}>check_circle</span>
                          ) : (
                            <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2px', borderTopColor: '#38bdf8' }}></div>
                          )}
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: '0 0 4px 0', fontSize: '0.9rem', color: '#f8fafc', fontWeight: 500 }}>
                            {clip.is_system ? clip.task_name : `Video Time: ${clip.timestamp !== 'Unknown' ? new Date(clip.timestamp).toLocaleString() : 'Unknown'}`}
                          </p>
                          <p style={{ margin: 0, fontSize: '0.8rem', color: '#ffffff' }}>
                            {clip.is_system ? 'System Process' : `Camera: ${camName}`}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ margin: '0 0 4px 0', fontSize: '0.9rem', color: '#f8fafc' }}>
                            <i className="fa-solid fa-face-smile" style={{ color: '#38bdf8', marginRight: '6px' }}></i>
                            {(() => {
                              if (clip.is_system && clip.task_name === 'Deduplication & Finalizing' && clip.status === 'completed') {
                                const finalCount = currentJobDetails.faces?.length || 0;
                                let rawCount = 0;
                                (currentJobDetails.clip_details || []).forEach(c => {
                                  if (typeof c.faces_detected === 'number') {
                                    rawCount += c.faces_detected;
                                  }
                                });
                                const duplicates = rawCount - finalCount;
                                return duplicates > 0 ? `-${duplicates} Merged` : '0 Merged';
                              }
                              return clip.is_system && clip.faces_detected === '-' ? '- Faces' : `${clip.faces_detected} Faces`;
                            })()}
                          </p>
                          <p style={{ margin: 0, fontSize: '0.8rem', color: '#ffffff' }}>
                            Time taken: {clip.time_taken_s !== null ? new Date(clip.time_taken_s * 1000).toISOString().substring(11, 19) : '...'}
                          </p>
                          {!clip.is_system && clip.video_duration_s != null && (
                            <p style={{ margin: 0, fontSize: '0.8rem', color: '#ffffff' }}>
                              Video duration: {new Date(clip.video_duration_s * 1000).toISOString().substring(11, 19)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {(!currentJobDetails.clip_details || currentJobDetails.clip_details.length === 0) && (
                    <div style={{ textAlign: 'center', padding: '20px', color: '#ffffff', background: 'var(--bg-base)', borderRadius: '8px', border: '1px dashed var(--border)' }}>
                      Preparing background processes...
                    </div>
                  )}
                </div>
              </div>

              {currentJobDetails.status === 'completed' && (
                <div style={{ marginTop: '16px' }}>
                  <h4 style={{ margin: '0 0 16px 0', color: '#f8fafc', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons-outlined" style={{ color: '#38bdf8' }}>analytics</span> Job Summary
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                    
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="material-icons-outlined" style={{ fontSize: '18px' }}>schedule</span>
                        </div>
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 }}>Search Range</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div>
                          <div style={{ color: '#64748b', fontSize: '0.7rem', marginBottom: '2px' }}>FROM</div>
                          <div style={{ fontSize: '0.85rem', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentJobDetails.range_start ? new Date(currentJobDetails.range_start).toLocaleString() : 'N/A'}</div>
                        </div>
                        <div>
                          <div style={{ color: '#64748b', fontSize: '0.7rem', marginBottom: '2px' }}>TO</div>
                          <div style={{ fontSize: '0.85rem', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentJobDetails.range_end ? new Date(currentJobDetails.range_end).toLocaleString() : 'N/A'}</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="material-icons-outlined" style={{ fontSize: '18px' }}>videocam</span>
                        </div>
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 }}>Sources & Results</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '0.9rem', color: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>Cameras</span>
                          <span style={{ fontWeight: 500 }}>{(() => {
                            let camNames = "";
                            const cId = currentJobDetails.camera_id || currentJobDetails.camera_ids;
                            if (Array.isArray(cId)) {
                              const names = cId.map(cid => cameras?.find(c => (c.id || c._id) === cid)?.name || cid);
                              camNames = names.join(', ');
                            } else {
                              camNames = cameras?.find(c => (c.id || c._id) === cId)?.name || cId;
                            }
                            return camNames || 'Unknown';
                          })()}</span>
                        </div>
                        <div style={{ fontSize: '0.9rem', color: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: '#64748b' }}>Faces</span>
                          <span style={{ fontWeight: 600, color: '#10b981', textAlign: 'right' }}>{(() => {
                            const finalCount = currentJobDetails.faces?.length || 0;
                            let rawCount = 0;
                            (currentJobDetails.clip_details || []).forEach(clip => {
                              if (typeof clip.faces_detected === 'number') {
                                rawCount += clip.faces_detected;
                              }
                            });
                            const duplicates = rawCount - finalCount;
                            if (duplicates > 0) {
                              return <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: '1.2' }}>{finalCount} Unique <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 400 }}>({duplicates} merged)</span></span>;
                            }
                            return finalCount;
                          })()}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="material-icons-outlined" style={{ fontSize: '18px' }}>bolt</span>
                        </div>
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 }}>Performance</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '0.9rem', color: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>Video Length</span>
                          <span style={{ fontWeight: 500 }}>{currentJobDetails.total_video_duration_s != null ? new Date(currentJobDetails.total_video_duration_s * 1000).toISOString().substring(11, 19) : 'N/A'}</span>
                        </div>
                        <div style={{ fontSize: '0.9rem', color: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#64748b' }}>Processing</span>
                          <span style={{ fontWeight: 600, color: '#8b5cf6' }}>{(() => {
                            if (!currentJobDetails.created_at || !currentJobDetails.completed_at) return 'N/A';
                            const t = Math.max(0, (new Date(currentJobDetails.completed_at) - new Date(currentJobDetails.created_at)) / 1000);
                            return new Date(t * 1000).toISOString().substring(11, 19);
                          })()}</span>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              )}
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
