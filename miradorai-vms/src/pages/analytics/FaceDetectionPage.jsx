import React, { useState, useEffect, useRef } from "react";
import Hls from "hls.js";
import "./VideoSynopsisPage.css";
import { useCameras } from "../../context/CamerasContext";
import DateTimePicker from "../../components/shared/DateTimePicker";
import { synopsisBase, resolveSynopsisMediaUrl } from "../../config/appConfig";


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

  // Helper: camera id -> display name
  const getCamName = (id) => cameras?.find(c => (c.id || c._id) === id)?.name || id;

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
  const [probeImages, setProbeImages] = useState([]);
  const [probePreviews, setProbePreviews] = useState([]);

  const handleAddPhotos = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      const newItems = files.map(f => ({
        file: f,
        url: URL.createObjectURL(f),
        id: Math.random().toString(36).substring(2, 9)
      }));
      setProbeImages(prev => [...prev, ...files]);
      setProbePreviews(prev => [...prev, ...newItems]);
    }
    e.target.value = "";
  };

  const handleRemovePhoto = (index) => {
    setProbeImages(prev => prev.filter((_, i) => i !== index));
    setProbePreviews(prev => {
      const removed = prev[index];
      if (removed?.url) URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== index);
    });
  };
  const [similarityThreshold, setSimilarityThreshold] = useState(65);
  const [previewImageModal, setPreviewImageModal] = useState(null);
  const [faceStatusFilter, setFaceStatusFilter] = useState("all");
  const [isReidentifying, setIsReidentifying] = useState(false);
  const pollTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  const SYNOPSIS_API = synopsisBase();

  const handleReidentify = async () => {
    const activeJobId = currentJobDetails?.job_id || localStorage.getItem('vms_active_face_job_id') || (jobHistory[0]?.job_id);
    if (!activeJobId) {
      setToastMessage("No active detection run to sync with employee DB.");
      return;
    }
    setIsReidentifying(true);
    try {
      const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${activeJobId}/identify`, {
        method: "POST"
      });
      if (!res.ok) throw new Error("Sync failed");
      const data = await res.json();
      if (data.faces) {
        setFaces(data.faces);
        setToastMessage(`Synced ${data.faces.length} detected faces with employee database!`);
      }
    } catch (err) {
      console.error(err);
      setToastMessage("Failed to sync with employee DB: " + err.message);
    } finally {
      setIsReidentifying(false);
    }
  };

  const pollJob = (jobId) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);

    const checkStatus = async () => {
      if (!isMountedRef.current) return;
      try {
        const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${jobId}`);
        if (!res.ok) throw new Error("Failed to poll job status");
        const data = await res.json();
        if (!isMountedRef.current) return;

        setJobProgress(data.progress || 0);
        setCurrentJobDetails(data);

        if (data.status === "completed") {
          localStorage.removeItem('vms_active_face_job_id');
          const sortedFaces = (data.faces || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
          setFaces(sortedFaces);
          setLoading(false);
          setJobProgress(100);
          setShowDetailsModal(false);
          fetchJobHistory();
        } else if (data.status === "failed") {
          localStorage.removeItem('vms_active_face_job_id');
          setLoading(false);
          setToastMessage(data.error_message || "Face detection job failed");
          fetchJobHistory();
        } else if (data.status === "cancelled") {
          localStorage.removeItem('vms_active_face_job_id');
          setLoading(false);
          setShowDetailsModal(false);
          setToastMessage("Face detection job was cancelled.");
          fetchJobHistory();
        } else {
          // Keep polling every 2.5s
          pollTimerRef.current = setTimeout(checkStatus, 2500);
        }
      } catch (pollErr) {
        if (!isMountedRef.current) return;
        console.error("Poll error:", pollErr);
        pollTimerRef.current = setTimeout(checkStatus, 3500);
      }
    };

    checkStatus();
  };

  const fetchJobHistory = async () => {
    try {
      const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs`);
      if (res.ok) {
        const data = await res.json();
        if (isMountedRef.current) {
          setJobHistory((data || []).slice(0, 50));
        }
        return data || [];
      }
    } catch (err) {
      console.error("Error fetching job history:", err);
    }
    return [];
  };

  // Initialize and check for running or recently completed jobs across page navigation
  useEffect(() => {
    isMountedRef.current = true;

    const handleGlobalUpdate = (e) => {
      if (!isMountedRef.current) return;
      const data = e.detail;
      if (data) {
        setJobProgress(data.progress || 0);
        setCurrentJobDetails(data);
        if (data.status === 'processing' || data.status === 'queued') {
          setLoading(true);
        }
      }
    };

    const handleGlobalCompleted = (e) => {
      if (!isMountedRef.current) return;
      const data = e.detail;
      if (data) {
        const sortedFaces = (data.faces || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        setFaces(sortedFaces);
        setCurrentJobDetails(data);
        setJobProgress(100);
        setLoading(false);
        fetchJobHistory();
      }
    };

    window.addEventListener('vms-face-job-update', handleGlobalUpdate);
    window.addEventListener('vms-face-job-completed', handleGlobalCompleted);

    const initializePage = async () => {
      try {
        const jobs = await fetchJobHistory();
        if (!isMountedRef.current) return;

        const storedActiveId = localStorage.getItem('vms_active_face_job_id');
        const runningJobInHistory = (jobs || []).find(j => j.status === 'processing' || j.status === 'queued');
        const activeJobId = storedActiveId || (runningJobInHistory ? runningJobInHistory.job_id : null);

        if (activeJobId) {
          // Active job is currently running on the server -> attach & resume live tracking
          const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${activeJobId}`);
          if (res.ok && isMountedRef.current) {
            const activeData = await res.json();
            if (activeData.status === 'processing' || activeData.status === 'queued') {
              setLoading(true);
              setJobProgress(activeData.progress || 0);
              setCurrentJobDetails(activeData);
              if (activeData.range_start) setRangeStart(activeData.range_start);
              if (activeData.range_end) setRangeEnd(activeData.range_end);
              if (activeData.camera_id) {
                const cids = Array.isArray(activeData.camera_id) ? activeData.camera_id : [activeData.camera_id];
                setSelectedCameras(cids);
              }
              pollJob(activeJobId);
              return;
            } else {
              localStorage.removeItem('vms_active_face_job_id');
            }
          }
        } else if (jobs && jobs.length > 0) {
          const firstJob = jobs[0];
          try {
            const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${firstJob.job_id}`);
            if (res.ok && isMountedRef.current) {
              const data = await res.json();
              const sortedFaces = (data.faces || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
              setFaces(sortedFaces);
              setCurrentJobDetails(data);
              if (data.range_start) setRangeStart(data.range_start);
              if (data.range_end) setRangeEnd(data.range_end);
              if (data.camera_id) {
                const cids = Array.isArray(data.camera_id) ? data.camera_id : [data.camera_id];
                setSelectedCameras(cids);
              }
            }
          } catch (e) {
            console.error("Auto-load first job error:", e);
          }
        }
        localStorage.removeItem('vms_last_completed_face_job_id');
      } catch (err) {
        console.error("Error initializing FaceDetectionPage:", err);
      }
    };

    initializePage();

    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      window.removeEventListener('vms-face-job-update', handleGlobalUpdate);
      window.removeEventListener('vms-face-job-completed', handleGlobalCompleted);
    };
  }, []);

  const handleRenameSubmit = async (jobId) => {
    try {
      const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${jobId}`, {
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
  const [showTargetBox, setShowTargetBox] = useState(true);
  const [boxMode, setBoxMode] = useState('face'); // 'face' or 'body'
  const overlayCanvasRef = useRef(null);
  const rawVideoRef = useRef(null);

  // Hardware-synchronised frame rendering loop (via requestVideoFrameCallback)
  useEffect(() => {
    if (!rawModal.isOpen || !rawVideoUrl || !rawVideoRef.current || !overlayCanvasRef.current) return;
    const video = rawVideoRef.current;
    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    let callbackHandle = null;
    let animHandle = null;
    let isCancelled = false;

    const resizeCanvas = () => {
      if (canvas && video) {
        if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
          canvas.width = video.clientWidth;
          canvas.height = video.clientHeight;
        }
      }
    };
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(video);

    const item = rawModal.item;
    const trajectory = item?.trajectory || [];
    const itemStatus = (item?.status || (item?.person_name && item?.person_name !== "Unknown" ? "authorised" : "unauthorised")).toLowerCase();
    const boxColor = itemStatus === 'authorised' ? '#10b981' : itemStatus === 'suspended' ? '#f59e0b' : '#ef4444';
    const personName = item?.person_name && item.person_name !== 'Unknown' ? item.person_name : (itemStatus === 'unauthorised' ? 'Unknown' : 'Enrolled Personnel');
    const labelText = itemStatus === 'authorised'
      ? `[Authorised] ${personName}${item?.match_score ? ` (${item.match_score}%)` : ''}`
      : itemStatus === 'suspended'
        ? `[Suspended] ${personName}`
        : `[Unauthorised] ${personName}${item?.match_score ? ` (${item.match_score}%)` : ''}`;

    const renderOverlay = (mediaTime) => {
      if (isCancelled || !canvas || !ctx || !video) return;
      resizeCanvas();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!showTargetBox || !item) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cw = canvas.width;
      const ch = canvas.height;
      if (!vw || !vh || !cw || !ch) return;

      let rawBox = null;

      if (trajectory && trajectory.length > 0) {
        const firstT = trajectory[0].t;
        const lastT = trajectory[trajectory.length - 1].t;

        // If person has exited the frame or not yet entered, don't draw anything!
        if (mediaTime >= firstT - 0.1 && mediaTime <= lastT + 0.15) {
          // Find adjacent points for linear interpolation
          let p1 = trajectory[0];
          let p2 = trajectory[trajectory.length - 1];

          for (let i = 0; i < trajectory.length - 1; i++) {
            if (trajectory[i].t <= mediaTime && trajectory[i + 1].t >= mediaTime) {
              p1 = trajectory[i];
              p2 = trajectory[i + 1];
              break;
            }
          }

          const dt = p2.t - p1.t;
          const alpha = dt > 0.001 ? Math.max(0, Math.min(1, (mediaTime - p1.t) / dt)) : 0;
          const b1 = boxMode === 'body' && p1.bbox ? p1.bbox : (p1.face_bbox || p1.bbox);
          const b2 = boxMode === 'body' && p2.bbox ? p2.bbox : (p2.face_bbox || p2.bbox);

          if (b1 && b2 && b1.length === 4 && b2.length === 4) {
            rawBox = [
              b1[0] + alpha * (b2[0] - b1[0]),
              b1[1] + alpha * (b2[1] - b1[1]),
              b1[2] + alpha * (b2[2] - b1[2]),
              b1[3] + alpha * (b2[3] - b1[3]),
            ];
          }
        }
      } else {
        // Fallback for legacy items without trajectory: show around detection moment
        if (mediaTime >= 1.8 && mediaTime <= 4.2) {
          rawBox = boxMode === 'body' && item.bbox ? item.bbox : (item.face_bbox || item.bbox);
        }
      }

      if (rawBox && rawBox.length === 4) {
        const [bx, by, bw, bh] = rawBox;
        // Letterbox projection
        const videoRatio = vw / vh;
        const clientRatio = cw / ch;
        let renderW, renderH, offsetX, offsetY;

        if (clientRatio > videoRatio) {
          renderH = ch;
          renderW = ch * videoRatio;
          offsetX = (cw - renderW) / 2;
          offsetY = 0;
        } else {
          renderW = cw;
          renderH = cw / videoRatio;
          offsetX = 0;
          offsetY = (ch - renderH) / 2;
        }

        const scale = renderW / vw;
        const x = offsetX + bx * scale;
        const y = offsetY + by * scale;
        const w = bw * scale;
        const h = bh * scale;

        ctx.save();
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = boxColor;
        ctx.shadowBlur = 8;
        ctx.strokeRect(x, y, w, h);

        // Tech corner brackets
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 0;
        const clen = Math.max(6, Math.min(14, Math.min(w, h) * 0.25));

        ctx.beginPath();
        ctx.moveTo(x - 2, y + clen);
        ctx.lineTo(x - 2, y - 2);
        ctx.lineTo(x + clen, y - 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x + w - clen, y - 2);
        ctx.lineTo(x + w + 2, y - 2);
        ctx.lineTo(x + w + 2, y + clen);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x - 2, y + h - clen);
        ctx.lineTo(x - 2, y + h + 2);
        ctx.lineTo(x + clen, y + h + 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x + w - clen, y + h + 2);
        ctx.lineTo(x + w + 2, y + h + 2);
        ctx.lineTo(x + w + 2, y + h - clen);
        ctx.stroke();

        // Target badge pill
        ctx.font = 'bold 12px Inter, sans-serif';
        const textMetrics = ctx.measureText(labelText);
        const pillW = textMetrics.width + 18;
        const pillH = 22;
        const pillX = x + (w - pillW) / 2;
        const pillY = Math.max(8, y - pillH - 6);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(pillX, pillY, pillW, pillH, 11);
        } else {
          ctx.rect(pillX, pillY, pillW, pillH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, pillX + 9, pillY + pillH / 2);

        ctx.restore();
      }
    };

    const onFrame = (now, metadata) => {
      if (isCancelled) return;
      const mediaTime = metadata?.mediaTime !== undefined ? metadata.mediaTime : video.currentTime;
      renderOverlay(mediaTime);

      if ('requestVideoFrameCallback' in video) {
        callbackHandle = video.requestVideoFrameCallback(onFrame);
      } else {
        animHandle = requestAnimationFrame(() => onFrame(performance.now(), { mediaTime: video.currentTime }));
      }
    };

    if ('requestVideoFrameCallback' in video) {
      callbackHandle = video.requestVideoFrameCallback(onFrame);
    } else {
      animHandle = requestAnimationFrame(() => onFrame(performance.now(), { mediaTime: video.currentTime }));
    }

    const onSeeked = () => renderOverlay(video.currentTime);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('play', onSeeked);

    return () => {
      isCancelled = true;
      ro.disconnect();
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('play', onSeeked);
      if (callbackHandle !== null && 'cancelVideoFrameCallback' in video) {
        video.cancelVideoFrameCallback(callbackHandle);
      }
      if (animHandle !== null) {
        cancelAnimationFrame(animHandle);
      }
    };
  }, [rawModal.isOpen, rawVideoUrl, showTargetBox, boxMode]);

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
        try {
          rawVideoRef.current.load();
          rawVideoRef.current.play().catch(() => {});
        } catch (e) {
          console.error(e);
        }
      }
    }
    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [rawVideoUrl, API]);

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
      // Create face job: probe search (if photo uploaded) or standard detection
      let createRes;
      if (probeImages.length > 0) {
        const formData = new FormData();
        formData.append("camera_ids", JSON.stringify(selectedCameras));
        formData.append("range_start", rangeStart);
        formData.append("range_end", rangeEnd);
        formData.append("similarity_threshold", (similarityThreshold / 100).toString());
        probeImages.forEach(img => {
          formData.append("probe_photos", img);
        });

        createRes = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-search-jobs`, {
          method: "POST",
          body: formData
        });
      } else {
        createRes = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            camera_id: selectedCameras,
            range_start: rangeStart,
            range_end: rangeEnd
          })
        });
      }


      if (!createRes.ok) {
        const errBody = await createRes.json().catch(() => ({}));
        throw new Error(errBody.detail || "Failed to start face detection job");
      }

      const jobData = await createRes.json();
      const jobId = jobData.job_id;
      setCurrentJobDetails(jobData);

      // Persist active job ID to localStorage so navigation across pages won't lose it
      localStorage.setItem('vms_active_face_job_id', jobId);
      window.dispatchEvent(new CustomEvent('vms-face-job-started', { detail: { jobId } }));

      // Start local polling
      pollJob(jobId);

    } catch (err) {
      console.error(err);
      localStorage.removeItem('vms_active_face_job_id');
      setToastMessage(err.message || "Failed to search faces.");
      setLoading(false);
    }
  };

  const handleCancelJob = async () => {
    if (!currentJobDetails?.job_id) return;
    try {
      await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${currentJobDetails.job_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled", job_name: currentJobDetails.job_name || currentJobDetails.job_id })
      });
      localStorage.removeItem('vms_active_face_job_id');
      window.dispatchEvent(new CustomEvent('vms-face-job-cancelled', { detail: { jobId: currentJobDetails.job_id } }));
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      setLoading(false);
      setToastMessage("Job cancelled");
      fetchJobHistory();
    } catch (e) {
      console.error(e);
    }
  };

  const handleJumpToOriginal = async (item) => {
    setRawModal({ isOpen: true, item });
    setRawVideoUrl(null);
    setRawVideoLoading(true);
    setRawVideoError(null);
    try {
      // Resolve camera for this face - selectedCameras is an array
      const faceCamId = item.camera_id || selectedCameras[0];
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
      setRawVideoUrl(resolveSynopsisMediaUrl(data.clipUrl));
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
        const downloadUrl = fullUrl.includes('?') ? `${fullUrl}&download=true` : `${fullUrl}?download=true`;
        const response = await fetch(downloadUrl, { headers });
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

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const probePhotoUrls = (
    currentJobDetails?.probe_photo_urls && currentJobDetails.probe_photo_urls.length > 0
      ? currentJobDetails.probe_photo_urls
      : (currentJobDetails?.probe_photo_url ? [currentJobDetails.probe_photo_url] : [])
  ).map(url => `${SYNOPSIS_API}/a1/v1/synopsis${url.startsWith('/') ? '' : '/'}${url}`);

  const probePhotoFullUrl = probePhotoUrls[0] || null;

  return (
    <div className="synopsis-page">
      <div className="synopsis-bg-blob blob-1"></div>
      <div className="synopsis-bg-blob blob-2"></div>

      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: 'var(--bg-surface)',
          color: 'var(--text-primary)',
          padding: '12px 20px',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid var(--border)',
          borderLeft: '4px solid var(--teal)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          animation: 'slideInRight 0.3s ease-out',
          minWidth: '280px',
          maxWidth: '420px',
          overflow: 'hidden'
        }}>
          <span className="material-icons-outlined" style={{ fontSize: '1.3rem', color: 'var(--teal)' }}>check_circle</span>
          <span style={{ fontWeight: 500, fontSize: '0.88rem', flex: 1, zIndex: 1, color: 'var(--text-primary)' }}>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '2px', zIndex: 1 }}
            title="Close"
          >
            <span className="material-icons-outlined" style={{ fontSize: '1.1rem' }}>close</span>
          </button>

          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: '3px',
            backgroundColor: 'var(--teal)',
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

          {/* ───────────── CONTROLS (single line) ───────────── */}
          <section className="glass-panel face-controls-card">
            <div className="face-controls-row">

              {/* CAMERA */}
              <div className="fc-item fc-camera form-group">
                <label className="fc-label">Camera</label>
                <div className="input-wrapper" ref={dropdownRef} style={{ position: 'relative' }}>
                  <span
                    className="material-icons-outlined input-icon"
                    style={{ fontSize: '1rem', left: '10px', zIndex: 2, pointerEvents: 'none', color: 'var(--text-muted)' }}
                  >videocam</span>
                  <div
                    className="fc-camera-trigger"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    title={selectedCameras.map(getCamName).join(', ')}
                  >
                    <span className="fc-camera-trigger-text">
                      {selectedCameras.length === 0
                        ? "Select Cameras"
                        : selectedCameras.length === 1
                          ? getCamName(selectedCameras[0])
                          : `${selectedCameras.length} Cameras Selected`}
                    </span>
                    <span className="material-icons-outlined" style={{ fontSize: '1.2rem', color: 'var(--text-muted)', flexShrink: 0 }}>arrow_drop_down</span>
                  </div>
                  {isDropdownOpen && (
                    <div className="fc-camera-menu">
                      {cameras && cameras.map((c) => (
                        <div
                          key={c.id || c._id}
                          className="fc-camera-option"
                          onClick={() => toggleCamera(c.id || c._id)}
                        >
                          <input type="checkbox" checked={selectedCameras.includes(c.id || c._id)} readOnly />
                          <span>{c.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* FROM */}
              <div className="fc-item fc-date form-group">
                <label className="fc-label">From Time</label>
                <DateTimePicker value={rangeStart} onChange={setRangeStart} />
              </div>

              {/* TO */}
              <div className="fc-item fc-date form-group">
                <label className="fc-label">To Time</label>
                <DateTimePicker value={rangeEnd} onChange={setRangeEnd} />
              </div>

              {/* TARGET PHOTO(S) UPLOAD (Multi-Probe Search) */}
              <div className="fc-item fc-photo">
                <span className="fc-label">Target Photo(s) (Optional)</span>
                <div className="fc-photo-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <label
                    htmlFor="photo-upload-input"
                    className="fc-upload-btn"
                    title={probeImages.length > 0 ? 'Click to add more photos' : 'Upload photos to search for persons'}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="material-icons-outlined" style={{ fontSize: '1.1rem', flexShrink: 0 }}>
                      {probeImages.length > 0 ? "add_photo_alternate" : "upload_file"}
                    </span>
                    <span className="fc-upload-name">
                      {probeImages.length === 0 ? 'Upload Photo(s)' : `Add Photo (${probeImages.length})`}
                    </span>
                  </label>
                  <input
                    id="photo-upload-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleAddPhotos}
                    style={{ display: 'none' }}
                  />

                  {probePreviews.map((p, idx) => (
                    <div key={p.id || idx} className="fc-thumb-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <img
                        className="fc-thumb"
                        src={p.url}
                        alt={`Target ${idx + 1}`}
                        onClick={() => setPreviewImageModal({ url: p.url, title: `Target Photo #${idx + 1} (${p.file.name})` })}
                        title="Click to view full photo"
                        style={{ width: '38px', height: '38px', borderRadius: '4px', objectFit: 'cover', border: '1px solid var(--teal)', cursor: 'pointer' }}
                      />
                      <button
                        type="button"
                        className="fc-thumb-remove"
                        title="Remove photo"
                        onClick={() => handleRemovePhoto(idx)}
                        style={{
                          position: 'absolute', top: -6, right: -6, background: '#ef4444',
                          border: 'none', borderRadius: '50%', color: 'white', width: '16px',
                          height: '16px', fontSize: '10px', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', cursor: 'pointer', padding: 0
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* MATCH SLIDER (only with photos) */}
              {probeImages.length > 0 && (
                <div className="fc-item fc-match">
                  <span className="fc-label">Match: {similarityThreshold}%</span>
                  <div className="fc-range-wrap">
                    <input
                      className="fc-range"
                      type="range"
                      min="50"
                      max="95"
                      step="5"
                      value={similarityThreshold}
                      onChange={(e) => setSimilarityThreshold(Number(e.target.value))}
                    />
                  </div>
                </div>
              )}

              {/* ACTIONS */}
              <div className="fc-item fc-actions">
                <span className="fc-label" style={{ visibility: 'hidden' }}>Action</span>
                <div className="fc-action-row">
                  <button
                    className={`btn-primary fc-btn-search ${loading ? 'loading' : ''}`}
                    style={{ cursor: loading ? 'not-allowed' : 'pointer' }}
                    onClick={handleSearchFaces}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span className="spinner"></span> {probeImages.length > 0 ? "Searching..." : "Detecting..."}
                      </>
                    ) : (
                      <>
                        <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>
                          {probeImages.length > 0 ? "person_search" : "search"}
                        </span>
                        {probeImages.length === 0 ? "Search Faces" : probeImages.length === 1 ? "Search Person" : `Search Target (${probeImages.length})`}
                      </>
                    )}
                  </button>
                  {loading && (
                    <button className="fc-btn-cancel" title="Cancel job" onClick={handleCancelJob}>
                      <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>clear</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {(loading || (currentJobDetails && currentJobDetails.status === 'completed' && showDetailsModal)) && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', marginTop: '4px' }}>
                <div
                  className="progress-container"
                  style={{ width: '100%', margin: 0, cursor: 'pointer', transition: 'all 0.2s' }}
                  onClick={() => setShowDetailsModal(true)}
                  title="Click to view processing details"
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div className="progress-stats" style={{ fontSize: '0.85rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={`status-badge status-${currentJobDetails?.status === 'completed' ? 'completed' : 'processing'}`} style={{ fontSize: '0.7rem', padding: '3px 8px' }}>
                      {currentJobDetails?.status === 'completed' ? 'COMPLETED' : 'PROCESSING'}
                    </span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Detection Progress</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <i className="fa-solid fa-circle-info"></i> Click for details
                    </span>
                    <span style={{ marginLeft: 'auto', color: 'var(--teal)', fontWeight: 600, fontSize: '0.95rem' }}>{jobProgress?.toFixed(0) ?? 0}%</span>
                  </div>
                  <div className="progress-bar-bg" style={{ height: '6px', background: 'var(--border)' }}>
                    <div className="progress-bar-fill pulse" style={{ width: `${jobProgress ?? 0}%`, height: '100%', borderRadius: '4px', background: 'var(--teal)' }}></div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ───────────── RESULTS + HISTORY ───────────── */}
          <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
            <section className="glass-panel synopsis-history-card fade-in" style={{ padding: '20px', margin: 0, flex: 3, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexShrink: 0 }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', color: 'var(--text-primary)', flexWrap: 'wrap' }}>
                  <span className="material-icons-outlined" style={{ fontSize: '1.2rem', color: 'var(--teal)' }}>face</span> Detected Faces
                  {currentJobDetails && (
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      color: 'var(--teal)',
                      background: 'rgba(20, 184, 166, 0.12)',
                      padding: '2px 10px',
                      borderRadius: '12px',
                      border: '1px solid rgba(20, 184, 166, 0.35)',
                      marginLeft: '6px',
                      letterSpacing: '0.3px'
                    }}>
                      Run: {currentJobDetails.job_name || currentJobDetails.job_id}
                    </span>
                  )}
                </h3>
                {!showHistory && (
                  <button
                    onClick={() => setShowHistory(true)}
                    style={{
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '6px 12px',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--teal)'; e.currentTarget.style.borderColor = 'var(--teal)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                  >
                    <i className="fa-solid fa-clock-rotate-left"></i> Previous Runs
                  </button>
                )}
              </div>

              <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '4px', minHeight: 0 }}>
                {probePhotoUrls.length > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 14px',
                    marginBottom: '14px', background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: 'var(--radius-sm)',
                    flexWrap: 'wrap'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {probePhotoUrls.map((pUrl, pIdx) => (
                        <div key={pIdx} style={{ position: 'relative' }}>
                          <img
                            src={pUrl}
                            alt={`Probe Target ${pIdx + 1}`}
                            onClick={() => setPreviewImageModal({ url: pUrl, title: `Target Search Person Photo #${pIdx + 1}` })}
                            style={{
                              width: '42px', height: '42px', borderRadius: '6px', objectFit: 'cover',
                              border: '1.5px solid var(--teal)', cursor: 'pointer', transition: 'transform 0.15s ease'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            title={`Click to view Target Photo #${pIdx + 1}`}
                          />
                          {probePhotoUrls.length > 1 && (
                            <span style={{
                              position: 'absolute', bottom: -3, right: -3,
                              background: 'var(--teal)', color: '#000', fontSize: '9px',
                              fontWeight: 800, borderRadius: '50%', width: '16px', height: '16px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
                            }}>
                              {pIdx + 1}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {probePhotoUrls.length > 1
                          ? `Search Target Person (${probePhotoUrls.length} Reference Photos)`
                          : 'Search Target Person'}
                        <span
                          onClick={() => setPreviewImageModal({ url: probePhotoUrls[0], title: "Target Search Person Photo #1" })}
                          style={{ fontSize: '0.72rem', color: 'var(--teal)', cursor: 'pointer', fontWeight: 500, textDecoration: 'underline' }}
                        >
                          View Full Photo
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Threshold: {Math.round((currentJobDetails.similarity_threshold || 0.65) * 100)}% • Found {faces.length} match{faces.length === 1 ? '' : 'es'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Clearance Status Filter Bar */}
                {faces.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setFaceStatusFilter('all')}
                      style={{
                        padding: '5px 12px', borderRadius: '16px', fontSize: '0.78rem', fontWeight: 600,
                        cursor: 'pointer', transition: 'all 0.18s ease',
                        background: faceStatusFilter === 'all' ? 'rgba(20, 184, 166, 0.2)' : 'var(--bg-elevated)',
                        borderColor: faceStatusFilter === 'all' ? 'var(--teal)' : 'var(--border)',
                        color: faceStatusFilter === 'all' ? 'var(--teal)' : 'var(--text-secondary)',
                        borderWidth: '1px', borderStyle: 'solid'
                      }}
                    >
                      All ({faces.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFaceStatusFilter('authorised')}
                      style={{
                        padding: '5px 12px', borderRadius: '16px', fontSize: '0.78rem', fontWeight: 600,
                        cursor: 'pointer', transition: 'all 0.18s ease',
                        background: faceStatusFilter === 'authorised' ? 'rgba(16, 185, 129, 0.2)' : 'var(--bg-elevated)',
                        borderColor: faceStatusFilter === 'authorised' ? '#10b981' : 'var(--border)',
                        color: faceStatusFilter === 'authorised' ? '#10b981' : 'var(--text-secondary)',
                        borderWidth: '1px', borderStyle: 'solid'
                      }}
                    >
                      ✓ Authorised ({faces.filter(f => (f.status || (f.person_name && f.person_name !== 'Unknown' ? 'authorised' : 'unauthorised')).toLowerCase() === 'authorised').length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFaceStatusFilter('unauthorised')}
                      style={{
                        padding: '5px 12px', borderRadius: '16px', fontSize: '0.78rem', fontWeight: 600,
                        cursor: 'pointer', transition: 'all 0.18s ease',
                        background: faceStatusFilter === 'unauthorised' ? 'rgba(239, 68, 68, 0.2)' : 'var(--bg-elevated)',
                        borderColor: faceStatusFilter === 'unauthorised' ? '#ef4444' : 'var(--border)',
                        color: faceStatusFilter === 'unauthorised' ? '#ef4444' : 'var(--text-secondary)',
                        borderWidth: '1px', borderStyle: 'solid'
                      }}
                    >
                      ✕ Unauthorised ({faces.filter(f => (f.status || (f.person_name && f.person_name !== 'Unknown' ? 'authorised' : 'unauthorised')).toLowerCase() === 'unauthorised').length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFaceStatusFilter('suspended')}
                      style={{
                        padding: '5px 12px', borderRadius: '16px', fontSize: '0.78rem', fontWeight: 600,
                        cursor: 'pointer', transition: 'all 0.18s ease',
                        background: faceStatusFilter === 'suspended' ? 'rgba(245, 158, 11, 0.2)' : 'var(--bg-elevated)',
                        borderColor: faceStatusFilter === 'suspended' ? '#f59e0b' : 'var(--border)',
                        color: faceStatusFilter === 'suspended' ? '#f59e0b' : 'var(--text-secondary)',
                        borderWidth: '1px', borderStyle: 'solid'
                      }}
                    >
                      ⚠ Suspended ({faces.filter(f => (f.status || (f.person_name && f.person_name !== 'Unknown' ? 'authorised' : 'unauthorised')).toLowerCase() === 'suspended').length})
                    </button>

                    <button
                      type="button"
                      onClick={handleReidentify}
                      disabled={isReidentifying}
                      title="Sync detected faces with latest Employee Clearance Database"
                      style={{
                        marginLeft: 'auto',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '5px 12px',
                        color: 'var(--teal)',
                        cursor: isReidentifying ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem',
                        fontWeight: 600,
                        transition: 'all 0.2s'
                      }}
                    >
                      <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>sync</span>
                      {isReidentifying ? 'Syncing...' : 'Sync with Employee DB'}
                    </button>
                  </div>
                )}

                {faces.length === 0 && !loading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                    <span className="material-icons-outlined" style={{ fontSize: '3rem', opacity: 0.3, marginBottom: '8px' }}>search_off</span>
                    <p style={{ margin: 0, fontSize: '0.9rem' }}>
                      {probePhotoUrls.length > 0
                        ? "No matching sightings found for this person with the current threshold."
                        : "No faces detected for the selected time range."}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '16px' }}>
                    {faces
                      .filter((face) => {
                        if (faceStatusFilter === 'all') return true;
                        const st = (face.status || (face.person_name && face.person_name !== 'Unknown' ? 'authorised' : 'unauthorised')).toLowerCase();
                        return st === faceStatusFilter;
                      })
                      .map((face, index) => {
                        const faceCamId = face.camera_id || selectedCameras[0];
                        const cam = cameras?.find(c => (c.id || c._id) === faceCamId);
                        const camName = cam ? cam.name : (faceCamId || "Unknown");
                        const faceStatus = (face.status || (face.person_name && face.person_name !== 'Unknown' ? 'authorised' : 'unauthorised')).toLowerCase();
                        const isAuth = faceStatus === 'authorised';
                        const isSuspended = faceStatus === 'suspended';
                        const isUnauth = faceStatus === 'unauthorised';
                        const personName = face.person_name && face.person_name !== 'Unknown' ? face.person_name : (isUnauth ? 'Unauthorised Person' : 'Unknown');

                        const badgeBg = isAuth ? 'rgba(16, 185, 129, 0.95)' : isSuspended ? 'rgba(245, 158, 11, 0.95)' : 'rgba(239, 68, 68, 0.95)';
                        const badgeIcon = isAuth ? 'verified' : isSuspended ? 'warning' : 'cancel';

                        return (
                          <div
                            key={face.track_id || index}
                            className="face-card"
                            onClick={() => handleJumpToOriginal(face)}
                            style={{ minHeight: '235px', position: 'relative', overflow: 'hidden' }}
                          >
                            {/* Clearance Status Badge (top-left) */}
                            <div
                              style={{
                                position: 'absolute', top: '6px', left: '6px',
                                zIndex: 3, display: 'flex', alignItems: 'center', gap: '4px',
                                background: badgeBg, padding: '2px 7px',
                                borderRadius: '4px', color: '#ffffff',
                                fontSize: '0.67rem', fontWeight: 700,
                                textTransform: 'uppercase', letterSpacing: '0.04em',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                                backdropFilter: 'blur(4px)'
                              }}
                              title={`Clearance: ${faceStatus.toUpperCase()}`}
                            >
                              <span className="material-icons-outlined" style={{ fontSize: '0.8rem' }}>{badgeIcon}</span>
                              <span>{faceStatus}</span>
                            </div>

                            {/* Match score or Probe target (top-right) */}
                            {face.match_score !== undefined && face.match_score > 0 && (
                              <span style={{
                                position: 'absolute', top: '6px', right: '6px',
                                background: 'rgba(15, 23, 42, 0.9)',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                color: '#ffffff', fontSize: '0.68rem', fontWeight: 700,
                                padding: '2px 6px', borderRadius: '4px',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                                backdropFilter: 'blur(4px)',
                                zIndex: 2
                              }}>
                                {face.match_score}%
                              </span>
                            )}

                            {(face.matched_photo_url || face.matched_probe_url) && (
                              <div
                                title={face.matched_photo_url ? `Matched Enrolled Photo (Angle #${(face.matched_angle_index ?? 0) + 1})` : `Matched Target #${(face.matched_probe_index ?? 0) + 1}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const targetUrl = face.matched_photo_url || face.matched_probe_url;
                                  const fullUrl = targetUrl.startsWith('http') ? targetUrl : targetUrl.startsWith('/api') ? targetUrl : `${SYNOPSIS_API}/a1/v1/synopsis${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;
                                  setPreviewImageModal({ url: fullUrl, title: face.person_name ? `${face.person_name} (Angle #${(face.matched_angle_index ?? 0) + 1})` : `Matched Target Photo` });
                                }}
                                style={{
                                  position: 'absolute', top: '30px', left: '6px',
                                  zIndex: 2, display: 'flex', alignItems: 'center', gap: '4px',
                                  background: 'rgba(15, 23, 42, 0.88)', padding: '2px 6px',
                                  borderRadius: '12px', border: '1px solid var(--teal)', cursor: 'pointer',
                                  backdropFilter: 'blur(4px)', boxShadow: '0 2px 4px rgba(0,0,0,0.4)'
                                }}
                              >
                                <img
                                  src={
                                    (face.matched_photo_url || face.matched_probe_url).startsWith('http')
                                      ? (face.matched_photo_url || face.matched_probe_url)
                                      : (face.matched_photo_url || face.matched_probe_url).startsWith('/api')
                                        ? (face.matched_photo_url || face.matched_probe_url)
                                        : `${SYNOPSIS_API}/a1/v1/synopsis${(face.matched_photo_url || face.matched_probe_url).startsWith('/') ? '' : '/'}${(face.matched_photo_url || face.matched_probe_url)}`
                                  }
                                  alt="Target"
                                  style={{ width: '14px', height: '14px', borderRadius: '50%', objectFit: 'cover' }}
                                />
                                <span style={{ fontSize: '0.62rem', color: 'var(--teal)', fontWeight: 700 }}>
                                  #{ ((face.matched_angle_index ?? face.matched_probe_index) ?? 0) + 1 }
                                </span>
                              </div>
                            )}

                            <img
                              src={
                                face.thumbnail_path
                                  ? `${SYNOPSIS_API}/a1/v1/synopsis/face-static/${encodeURIComponent(face.thumbnail_path.split(/[\\/]/).pop())}`
                                  : face.face_bbox && face.face_bbox.length === 4
                                    ? `${SYNOPSIS_API}/a1/v1/synopsis/face-thumbnail?camera_id=${encodeURIComponent(faceCamId)}&timestamp=${encodeURIComponent(face.timestamp)}&fx=${face.face_bbox[0]}&fy=${face.face_bbox[1]}&fw=${face.face_bbox[2]}&fh=${face.face_bbox[3]}`
                                    : `${API}/api/alerts/thumbnail?ip=${encodeURIComponent(cam?.ip || cam?.serial || faceCamId)}&time=${encodeURIComponent(face.timestamp)}&crop=1`
                              }
                              alt="Detected Face"
                              style={{ width: '100%', height: '140px', objectFit: 'cover', display: 'block' }}
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='8' r='5'/><path d='M20 21a8 8 0 0 0-16 0'/></svg>";
                              }}
                            />

                            {/* Bottom Identity & Metadata Panel */}
                            <div style={{
                              padding: '8px 10px',
                              background: 'var(--bg-surface)',
                              borderTop: '1px solid var(--border-dim)',
                              position: 'absolute', bottom: 0, left: 0, right: 0
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                                <span className="material-icons-outlined" style={{ fontSize: '0.85rem', color: isAuth ? '#10b981' : isSuspended ? '#f59e0b' : '#ef4444' }}>
                                  {isUnauth ? 'person_off' : 'person'}
                                </span>
                                <span
                                  style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                    color: isUnauth ? '#f87171' : 'var(--text-primary)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}
                                  title={personName}
                                >
                                  {personName}
                                </span>
                              </div>

                              {face.department && (
                                <span style={{
                                  fontSize: '0.67rem',
                                  color: 'var(--teal)',
                                  display: 'block',
                                  fontWeight: 500,
                                  marginBottom: '2px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis'
                                }}>
                                  {face.department}
                                </span>
                              )}

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.67rem', color: 'var(--text-secondary)' }}>
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }} title={camName}>
                                  {camName}
                                </span>
                                <span style={{ whiteSpace: 'nowrap' }}>
                                  {new Date(face.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>

                            <div className="play-overlay">
                              <span className="material-icons-outlined" style={{ color: 'white', fontSize: '2rem' }}>play_circle</span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </section>

            {/* Right Side: Previous Runs */}
            {showHistory && (
              <div className="history-panel" style={{ width: '350px', background: 'var(--bg-surface)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', color: 'var(--text-primary)' }}>
                    <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: '8px', color: 'var(--teal)' }}></i> Previous Runs
                  </h3>
                  <button
                    onClick={() => setShowHistory(false)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, display: 'flex' }}
                  >
                    <span className="material-icons-outlined">close</span>
                  </button>
                </div>

                <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '4px' }}>
                  {jobHistory.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <p>No previous detection runs.</p>
                    </div>
                  ) : (
                    jobHistory.map((job) => {
                      const isSelected = currentJobDetails?.job_id === job.job_id;
                      return (
                        <div
                          key={job.job_id}
                          className={`history-item ${isSelected ? 'active' : ''}`}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            padding: '12px 16px',
                            background: isSelected ? 'rgba(20, 184, 166, 0.14)' : 'var(--bg-elevated)',
                            borderRadius: 'var(--radius-sm)',
                            border: isSelected ? '1.5px solid var(--teal)' : '1px solid var(--border)',
                            borderLeft: isSelected ? '5px solid var(--teal)' : '5px solid transparent',
                            marginBottom: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            overflow: 'hidden',
                            boxShadow: isSelected ? '0 0 16px rgba(20, 184, 166, 0.28), inset 0 0 10px rgba(20, 184, 166, 0.08)' : 'none',
                            position: 'relative'
                          }}
                          onClick={async () => {
                            if (editingJobId === job.job_id) return;
                            setCurrentJobDetails(prev => ({ ...prev, job_id: job.job_id }));
                            try {
                              const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${job.job_id}`);
                              if (!res.ok) throw new Error("Failed to load job");
                              const data = await res.json();
                              const sortedFaces = (data.faces || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                              setFaces(sortedFaces);
                              setCurrentJobDetails(data);
                              if (data.range_start) setRangeStart(data.range_start);
                              if (data.range_end) setRangeEnd(data.range_end);
                              if (data.camera_id) {
                                const cids = Array.isArray(data.camera_id) ? data.camera_id : [data.camera_id];
                                setSelectedCameras(cids);
                              }
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
                                      color: 'var(--text-primary)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem',
                                      width: '100%'
                                    }}
                                    autoFocus
                                  />
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleRenameSubmit(job.job_id); }}
                                    style={{ background: 'var(--teal)', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer' }}
                                  >
                                    <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>check</span>
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setEditingJobId(null); }}
                                    style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer' }}
                                  >
                                    <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>close</span>
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <span style={{
                                    fontWeight: isSelected ? '700' : '600',
                                    color: isSelected ? 'var(--teal)' : 'var(--text-primary)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}>
                                    {job.job_name || job.job_id}
                                  </span>
                                  {isSelected && (
                                    <span style={{
                                      fontSize: '0.62rem',
                                      fontWeight: '800',
                                      background: 'var(--teal)',
                                      color: '#021817',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      letterSpacing: '0.5px',
                                      textTransform: 'uppercase',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px'
                                    }}>
                                      <span className="material-icons-outlined" style={{ fontSize: '0.72rem' }}>check_circle</span>
                                      ACTIVE
                                    </span>
                                  )}
                                  <span
                                    className="material-icons-outlined edit-icon"
                                    style={{ fontSize: '1rem', color: isSelected ? 'var(--teal)' : 'var(--text-muted)', cursor: 'pointer', flexShrink: 0, opacity: isSelected ? 1 : 0.7 }}
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
                                style={{ fontSize: '1.1rem', color: 'var(--teal)', cursor: 'pointer' }}
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
                              {job.status === 'completed' && <span style={{ color: 'var(--teal)', fontSize: '0.65rem', fontWeight: 'bold', border: '1px solid var(--teal)', padding: '2px 6px', borderRadius: '12px' }}>COMPLETED</span>}
                              {job.status === 'failed' && <span style={{ color: 'var(--red)', fontSize: '0.65rem', fontWeight: 'bold', border: '1px solid var(--red)', padding: '2px 6px', borderRadius: '12px' }}>FAILED</span>}
                              {job.status === 'cancelled' && <span style={{ color: 'var(--yellow)', fontSize: '0.65rem', fontWeight: 'bold', border: '1px solid var(--yellow)', padding: '2px 6px', borderRadius: '12px' }}>CANCELLED</span>}
                              {job.status === 'processing' && <span style={{ color: 'var(--teal)', fontSize: '0.65rem', fontWeight: 'bold', border: '1px solid var(--teal)', padding: '2px 6px', borderRadius: '12px' }}>{job.progress ? Math.round(job.progress) + '%' : 'PROCESSING'}</span>}
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontSize: '0.75rem', color: isSelected ? 'var(--text-secondary)' : 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {(job.range_start || '').replace('T', ' ')} to {(job.range_end || '').replace('T', ' ')}
                            </span>
                            <span style={{ fontSize: '0.85rem', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              <i className="fa-solid fa-video" style={{ marginRight: '6px', color: isSelected ? 'var(--teal)' : 'inherit' }}></i>
                              {(() => {
                                let camNames = "";
                                if (Array.isArray(job.camera_id)) {
                                  camNames = job.camera_id.map(getCamName).join(', ');
                                } else {
                                  camNames = getCamName(job.camera_id);
                                }
                                return <span title={camNames} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{camNames}</span>;
                              })()}
                              <span style={{ margin: '0 6px' }}>|</span>
                              <i className="fa-solid fa-face-smile" style={{ marginRight: '6px', color: isSelected ? 'var(--teal)' : 'inherit' }}></i> {job.faces ? `${job.faces.length} ${job.faces.length === 1 ? 'Face' : 'Faces'}` : '... Faces'}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Instant Face Playback Popup Modal */}
      {rawModal.isOpen && (
        <div
          className="raw-video-modal-backdrop"
          onClick={() => setRawModal({ isOpen: false, item: null })}
        >
          <div
            className="raw-video-modal-content"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="raw-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: 'var(--teal-subtle)', color: 'var(--teal)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <span className="material-icons-outlined" style={{ fontSize: '1.25rem' }}>play_circle</span>
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Face Playback</h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Original Recording Archive Clip</p>
                </div>
              </div>
              <button
                onClick={() => setRawModal({ isOpen: false, item: null })}
                className="close-btn"
                title="Close"
              >
                <span className="material-icons-outlined" style={{ fontSize: '1.3rem' }}>close</span>
              </button>
            </div>

            {/* Body */}
            {rawModal.item && (
              <div className="raw-modal-body">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                      fontSize: '0.8rem', fontWeight: 600, color: 'var(--teal)'
                    }}>
                      <span className="material-icons-outlined" style={{ fontSize: '0.95rem' }}>videocam</span>
                      {cameras?.find(c => (c.id || c._id) === (rawModal.item.camera_id || selectedCameras[0]))?.name || rawModal.item.camera_id || selectedCameras[0] || "Unknown"}
                    </span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                      fontSize: '0.8rem', color: 'var(--text-primary)'
                    }}>
                      <span className="material-icons-outlined" style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>schedule</span>
                      {new Date(rawModal.item.timestamp).toLocaleString()}
                    </span>

                    {/* Target Person Info Badge in Modal Toolbar */}
                    {(rawModal.item.matched_probe_url || rawModal.item.match_score !== undefined) && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        background: 'rgba(56, 189, 248, 0.1)', border: '1px solid var(--teal)',
                        padding: '3px 10px', borderRadius: 'var(--radius-sm)',
                        fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)'
                      }}>
                        {rawModal.item.matched_probe_url && (
                          <img
                            src={`${SYNOPSIS_API}/a1/v1/synopsis${rawModal.item.matched_probe_url.startsWith('/') ? '' : '/'}${rawModal.item.matched_probe_url}`}
                            alt="Target"
                            style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover' }}
                          />
                        )}
                        <span>
                          {rawModal.item.matched_probe_index !== undefined ? `Target #${rawModal.item.matched_probe_index + 1}` : 'Target'}
                        </span>
                        {rawModal.item.match_score !== undefined && (
                          <span style={{ color: (rawModal.item.match_score >= 80) ? '#10b981' : '#f59e0b' }}>
                            ({rawModal.item.match_score}% Match)
                          </span>
                        )}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {/* Bounding Box Controls */}
                    <button
                      type="button"
                      onClick={() => setShowTargetBox(!showTargetBox)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        background: showTargetBox ? 'var(--teal-subtle)' : 'var(--bg-elevated)',
                        border: `1px solid ${showTargetBox ? 'var(--teal)' : 'var(--border)'}`,
                        padding: '5px 12px', borderRadius: 'var(--radius-sm)',
                        fontSize: '0.8rem', fontWeight: 600,
                        color: showTargetBox ? 'var(--teal)' : 'var(--text-secondary)',
                        cursor: 'pointer', transition: 'all 0.15s ease'
                      }}
                      title="Toggle Target Person Bounding Box"
                    >
                      <span className="material-icons-outlined" style={{ fontSize: '1.05rem' }}>
                        {showTargetBox ? "center_focus_strong" : "filter_center_focus"}
                      </span>
                      Box: {showTargetBox ? "ON" : "OFF"}
                    </button>

                    {showTargetBox && (
                      <div style={{
                        display: 'inline-flex', background: 'var(--bg-elevated)',
                        borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                        overflow: 'hidden', padding: '2px'
                      }}>
                        <button
                          type="button"
                          onClick={() => setBoxMode('face')}
                          style={{
                            background: boxMode === 'face' ? 'var(--teal)' : 'transparent',
                            color: boxMode === 'face' ? '#000000' : 'var(--text-secondary)',
                            border: 'none', padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700,
                            borderRadius: '3px', cursor: 'pointer'
                          }}
                        >
                          Face
                        </button>
                        <button
                          type="button"
                          onClick={() => setBoxMode('body')}
                          style={{
                            background: boxMode === 'body' ? 'var(--teal)' : 'transparent',
                            color: boxMode === 'body' ? '#000000' : 'var(--text-secondary)',
                            border: 'none', padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700,
                            borderRadius: '3px', cursor: 'pointer'
                          }}
                        >
                          Body
                        </button>
                      </div>
                    )}

                    {rawVideoUrl && (
                      <button
                        onClick={handleDownloadVideo}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                          padding: '5px 12px', borderRadius: 'var(--radius-sm)',
                          fontSize: '0.8rem', fontWeight: 600, color: 'var(--teal)',
                          cursor: 'pointer', transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--teal)'; e.currentTarget.style.color = '#ffffff'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--teal)'; }}
                      >
                        <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>download</span>
                        Download Clip
                      </button>
                    )}
                  </div>
                </div>

                <div className="raw-video-player" style={{ marginTop: '8px' }}>
                  {rawVideoLoading ? (
                    <div style={{
                      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                      height: '360px', background: 'var(--bg-base)', borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)', color: 'var(--text-secondary)', gap: '12px'
                    }}>
                      <div className="spinner" style={{ width: '28px', height: '28px', borderTopColor: 'var(--teal)' }}></div>
                      <span style={{ fontSize: '0.9rem' }}>Loading video clip from archive...</span>
                    </div>
                  ) : rawVideoError ? (
                    <div style={{
                      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                      height: '360px', background: 'var(--bg-base)', borderRadius: 'var(--radius-md)',
                      border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--red)', padding: '24px', textAlign: 'center', gap: '8px'
                    }}>
                      <span className="material-icons-outlined" style={{ fontSize: '2.5rem' }}>error_outline</span>
                      <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 500 }}>{rawVideoError}</p>
                    </div>
                  ) : rawVideoUrl ? (
                    <div style={{
                      borderRadius: 'var(--radius-md)', overflow: 'hidden',
                      border: '1px solid var(--border)', background: '#000',
                      boxShadow: 'var(--shadow-md)', position: 'relative'
                    }}>
                      <video
                        ref={rawVideoRef}
                        controls
                        autoPlay
                        playsInline
                        preload="auto"
                        onError={() => setRawVideoError("Failed to play raw video archive. Browser could not decode media.")}
                        style={{ width: '100%', maxHeight: '58vh', display: 'block', background: '#000' }}
                      >
                        Your browser does not support the video tag.
                      </video>
                      <canvas
                        ref={overlayCanvasRef}
                        style={{
                          position: 'absolute', top: 0, left: 0,
                          width: '100%', height: '100%',
                          pointerEvents: 'none', zIndex: 5
                        }}
                      />
                    </div>
                  ) : (
                    <div style={{ height: '360px', background: 'var(--bg-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}></div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
            borderRadius: 'var(--radius-md)', width: '90%', maxWidth: '700px', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <i className="fa-solid fa-server" style={{ color: 'var(--teal)' }}></i> Processing Details
              </h3>
              <button onClick={() => setShowDetailsModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
                <span className="material-icons-outlined">close</span>
              </button>
            </div>

            <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>

              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, background: 'var(--bg-elevated)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Overall Status</p>
                  <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: currentJobDetails.status === 'completed' ? 'var(--teal)' : currentJobDetails.status === 'failed' ? 'var(--red)' : 'var(--teal)' }}>
                    {currentJobDetails.status.toUpperCase()}
                  </p>
                </div>
                <div style={{ flex: 1, background: 'var(--bg-elevated)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Progress</p>
                  <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                    {Math.round(currentJobDetails.progress || 0)}%
                  </p>
                </div>
                <div style={{ flex: 1, background: 'var(--bg-elevated)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Videos Processed</p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                    {(currentJobDetails.clip_details || []).filter(c => c.status === 'completed' && !c.is_system).length} / {currentJobDetails.total_clips || 0}
                  </p>
                  {currentJobDetails.total_clips_by_camera && Object.entries(currentJobDetails.total_clips_by_camera).map(([cid, total]) => {
                    const processed = (currentJobDetails.clip_details || []).filter(c => c.status === 'completed' && !c.is_system && c.camera_id === cid).length;
                    return (
                      <p key={cid} style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--teal)' }}>{getCamName(cid)}</span>: {processed} / {total}
                      </p>
                    );
                  })}
                </div>
              </div>

              <div>
                <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)', fontSize: '1.05rem' }}>Timeline</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {(currentJobDetails.clip_details || []).map((clip, idx) => {
                    const camName = getCamName(clip.camera_id);
                    return (
                      <div key={idx} style={{
                        display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--bg-elevated)',
                        padding: '12px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                        borderLeft: '4px solid var(--teal)'
                      }}>
                        <div style={{ width: '40px', display: 'flex', justifyContent: 'center' }}>
                          {clip.status === 'completed' ? (
                            <span className="material-icons-outlined" style={{ color: 'var(--teal)' }}>check_circle</span>
                          ) : (
                            <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2px', borderTopColor: 'var(--teal)' }}></div>
                          )}
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: '0 0 4px 0', fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                            {clip.is_system ? clip.task_name : `Video Time: ${clip.timestamp !== 'Unknown' ? new Date(clip.timestamp).toLocaleString() : 'Unknown'}`}
                          </p>
                          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {clip.is_system ? 'System Process' : `Camera: ${camName}`}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ margin: '0 0 4px 0', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            <i className="fa-solid fa-face-smile" style={{ color: 'var(--teal)', marginRight: '6px' }}></i>
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
                              if (clip.is_system && clip.faces_detected === '-') return '- Faces';
                              const countNum = Number(clip.faces_detected);
                              return `${clip.faces_detected} ${countNum === 1 ? 'Face' : 'Faces'}`;
                            })()}
                          </p>
                          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Time taken: {clip.time_taken_s !== null ? new Date(clip.time_taken_s * 1000).toISOString().substring(11, 19) : '...'}
                          </p>
                          {!clip.is_system && clip.video_duration_s != null && (
                            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Video duration: {new Date(clip.video_duration_s * 1000).toISOString().substring(11, 19)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {(!currentJobDetails.clip_details || currentJobDetails.clip_details.length === 0) && (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border)' }}>
                      Preparing background processes...
                    </div>
                  )}
                </div>
              </div>

              {currentJobDetails.status === 'completed' && (
                <div style={{ marginTop: '16px' }}>
                  <h4 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="material-icons-outlined" style={{ color: 'var(--teal)' }}>analytics</span> Job Summary
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>

                    <div style={{ background: 'var(--bg-elevated)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', background: 'var(--teal-subtle)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="material-icons-outlined" style={{ fontSize: '18px' }}>schedule</span>
                        </div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Search Range</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: '2px' }}>FROM</div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentJobDetails.range_start ? new Date(currentJobDetails.range_start).toLocaleString() : 'N/A'}</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: '2px' }}>TO</div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentJobDetails.range_end ? new Date(currentJobDetails.range_end).toLocaleString() : 'N/A'}</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--bg-elevated)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', background: 'var(--teal-subtle)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="material-icons-outlined" style={{ fontSize: '18px' }}>videocam</span>
                        </div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Sources & Results</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Cameras</span>
                          <span style={{ fontWeight: 500 }}>{(() => {
                            let camNames = "";
                            const cId = currentJobDetails.camera_id || currentJobDetails.camera_ids;
                            if (Array.isArray(cId)) {
                              camNames = cId.map(getCamName).join(', ');
                            } else {
                              camNames = getCamName(cId);
                            }
                            return camNames || 'Unknown';
                          })()}</span>
                        </div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Faces</span>
                          <span style={{ fontWeight: 600, color: 'var(--teal)', textAlign: 'right' }}>{(() => {
                            const finalCount = currentJobDetails.faces?.length || 0;
                            let rawCount = 0;
                            (currentJobDetails.clip_details || []).forEach(clip => {
                              if (typeof clip.faces_detected === 'number') {
                                rawCount += clip.faces_detected;
                              }
                            });
                            const duplicates = rawCount - finalCount;
                            if (duplicates > 0) {
                              return <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: '1.2' }}>{finalCount} Unique <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>({duplicates} merged)</span></span>;
                            }
                            return finalCount;
                          })()}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--bg-elevated)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', background: 'rgba(139, 92, 246, 0.1)', color: 'var(--purple)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="material-icons-outlined" style={{ fontSize: '18px' }}>bolt</span>
                        </div>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 500 }}>Performance</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Video Length</span>
                          <span style={{ fontWeight: 500 }}>{currentJobDetails.total_video_duration_s != null ? new Date(currentJobDetails.total_video_duration_s * 1000).toISOString().substring(11, 19) : 'N/A'}</span>
                        </div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)' }}>Processing</span>
                          <span style={{ fontWeight: 600, color: 'var(--purple)' }}>{(() => {
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

      {/* Target Photo Full Preview Modal */}
      {previewImageModal && (
        <div
          onClick={() => setPreviewImageModal(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(5px)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: '16px', maxWidth: '90vw', maxHeight: '90vh',
              display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
              position: 'relative'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-dim)', paddingBottom: '8px' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {previewImageModal.title || "Target Photo Preview"}
              </span>
              <button
                onClick={() => setPreviewImageModal(null)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px'
                }}
              >
                <span className="material-icons-outlined">close</span>
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
              <img
                src={previewImageModal.url}
                alt="Target Full Preview"
                style={{
                  maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain',
                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)'
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}