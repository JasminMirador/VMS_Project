import React, { useState, useEffect, useRef, useMemo } from "react";
import Hls from "hls.js";
import "./VideoSynopsisPage.css";
import { useCameras } from "../../context/CamerasContext";
import DateTimePicker from "../../components/shared/DateTimePicker";


const VideoThumbnail = ({ src }) => {
  const [isVisible, setIsVisible] = React.useState(false);
  const ref = React.useRef();
  React.useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      {isVisible ? <video src={src} disablePictureInPicture preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{width:'100%',height:'100%',background:'var(--bg-active)'}}></div>}
    </div>
  );
};

// VideoFrameAt — shows the exact paused frame of a video at a given timestamp.
// Unlike VideoThumbnail (which just shows frame 0), this actually seeks the video
// to `timeSeconds` after metadata loads, so each detection tile shows its own frame.
const VideoFrameAt = ({ src, timeSeconds }) => {
  const [isVisible, setIsVisible] = React.useState(false);
  const containerRef = React.useRef();
  const videoRef = React.useRef();

  React.useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleLoadedMetadata = () => {
    if (videoRef.current && timeSeconds != null) {
      videoRef.current.currentTime = timeSeconds;
    }
  };

  React.useEffect(() => {
    if (videoRef.current && isVisible && timeSeconds != null) {
      videoRef.current.currentTime = timeSeconds;
    }
  }, [timeSeconds, isVisible]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      {isVisible ? (
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          disablePictureInPicture
          muted
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', background: '#111' }} />
      )}
    </div>
  );
};

// VideoFrameCrop — crops the bbox region using pure CSS positioning (no canvas, no CORS needed).
// Gets actual container size from IntersectionObserver, actual video dims from loadedmetadata,
// then sizes and positions the <video> so the bbox fills the container exactly.
const VideoFrameCrop = ({ src, timeSeconds, bbox }) => {
  const [isVisible, setIsVisible] = React.useState(false);
  const [videoDims, setVideoDims] = React.useState(null);   // { vw, vh }
  const [containerDims, setContainerDims] = React.useState(null); // { w, h }
  const containerRef = React.useRef();
  const videoRef = React.useRef();

  React.useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        const r = entry.boundingClientRect;
        setContainerDims({ w: r.width || 130, h: r.height || 173 });
        observer.disconnect();
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = timeSeconds || 0.1;
    setVideoDims({ vw: videoRef.current.videoWidth, vh: videoRef.current.videoHeight });
  };

  // Re-seek when timestamp changes (e.g. component reused)
  React.useEffect(() => {
    if (videoRef.current && isVisible && timeSeconds != null) {
      videoRef.current.currentTime = timeSeconds;
    }
  }, [timeSeconds, isVisible]);

  // Compute absolute position/size so the bbox fills the container
  const getVideoStyle = () => {
    const fallback = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' };
    if (!videoDims || !containerDims || !bbox || bbox.length < 4) return fallback;

    const { vw, vh } = videoDims;
    const { w: cw, h: ch } = containerDims;
    const [bx, by, bw, bh] = bbox;
    if (!bw || !bh || !vw || !vh) return fallback;

    // Scale so the bbox region covers the container (cover behaviour)
    const scale = Math.max(cw / bw, ch / bh);
    // Displayed video pixel dimensions at this scale
    const dispW = vw * scale;
    const dispH = vh * scale;
    // Position so bbox center aligns with container center
    const left = cw / 2 - (bx + bw / 2) * scale;
    const top  = ch / 2 - (by + bh / 2) * scale;

    return {
      position: 'absolute',
      width: `${dispW}px`,
      height: `${dispH}px`,
      left: `${left}px`,
      top: `${top}px`,
      objectFit: 'fill',
    };
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {!isVisible ? (
        <div style={{ width: '100%', height: '100%', background: '#111' }} />
      ) : (
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          disablePictureInPicture
          muted
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          style={getVideoStyle()}
        />
      )}
    </div>
  );
};


export default function VideoSynopsisPage() {
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
  
  const [toastMessage, setToastMessage] = useState(null);

  // Build snapshot map instantly from camera thumbnails (already stored in DB as base64 data URIs).
  // This avoids slow live HTTP calls to cameras and shows a preview immediately.
  const liveSnapshots = useMemo(() => {
    if (!cameras) return {};
    const map = {};
    selectedCameras.forEach(camId => {
      const cam = cameras.find(c => (c.id || c._id) === camId);
      if (cam && cam.thumbnail) {
        map[camId] = cam.thumbnail;
      }
    });
    return map;
  }, [selectedCameras, cameras]);

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
  const [activeJobs, setActiveJobs] = useState([]);
  const [activeViewIndex, setActiveViewIndex] = useState(0);
  const [jobHistory, setJobHistory] = useState([]);
  const [metadataItems, setMetadataItems] = useState([]);
  const [currentActiveObjects, setCurrentActiveObjects] = useState([]);
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
  const [originalVideoDimensions, setOriginalVideoDimensions] = useState({ width: 1920, height: 1080 });
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [currentJobDetails, setCurrentJobDetails] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [activeProcessingTab, setActiveProcessingTab] = useState('overall');
  const [viewMode, setViewMode] = useState('cases');
  const [viewModeDetail, setViewModeDetail] = useState('grid');
  const [filterSource, setFilterSource] = useState([]);
  const [filterDateRange, setFilterDateRange] = useState({ start: '', end: '' });
  const [filterDwell, setFilterDwell] = useState([0, 60]);
  const [selectedObjects, setSelectedObjects] = useState([]);
  const [gridSortBy, setGridSortBy] = useState('Oldest');
  const [editingJobId, setEditingJobId] = useState(null);
  const [editJobName, setEditJobName] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createIncidentDate, setCreateIncidentDate] = useState('');
  const [createIncidentTime, setCreateIncidentTime] = useState('');
  const [showAddVideoModal, setShowAddVideoModal] = useState(false);
  const [shareModalGroup, setShareModalGroup] = useState(null);
  const [addVideoStep, setAddVideoStep] = useState(1); // 1=Time Range, 2=Camera Selection
  const [addVideoJob, setAddVideoJob] = useState(null);
  const [addVideoSourceTab, setAddVideoSourceTab] = useState('CAMERAS');
  const [addVideoFromDate, setAddVideoFromDate] = useState('');
  const [addVideoToDate, setAddVideoToDate] = useState('');
  const [addVideoFromTime, setAddVideoFromTime] = useState('');
  const [addVideoToTime, setAddVideoToTime] = useState('');
  const [addVideoCameraSearch, setAddVideoCameraSearch] = useState('');
  const [addVideoSelectedCams, setAddVideoSelectedCams] = useState([]);
  
  // New state for BriefCam-style multicam view
  const [multicamGroup, setMulticamGroup] = useState([]);
  const [activeCamVideoId, setActiveCamVideoId] = useState(null);
  const [allMulticamMetadata, setAllMulticamMetadata] = useState([]); // merged detections from all cameras

  // Right-hand filter panel (BriefCam-style). Source + Time Range work off data the
  // sidecar already has; the rest are UI-only until the backend emits those fields.
  const [expandedFilter, setExpandedFilter] = useState(null);
  const [filterCams, setFilterCams] = useState(null);      // null = all cameras
  const [filterTimeFrom, setFilterTimeFrom] = useState(''); // "HH:MM" (IST)
  const [filterTimeTo, setFilterTimeTo] = useState('');



  // Live preview behind the Step 3 (Direction) drawing canvas in the Add
  // Video modal — same idea as `liveSnapshots`, scoped to whichever cameras
  // are currently checked in that modal's Step 2.
  const addVideoLiveSnapshots = useMemo(() => {
    if (!cameras) return {};
    const map = {};
    addVideoSelectedCams.forEach(camId => {
      const cam = cameras.find(c => (c.id || c._id) === camId);
      if (cam && cam.thumbnail) {
        map[camId] = cam.thumbnail;
      }
    });
    return map;
  }, [addVideoSelectedCams, cameras]);

  // Opens the Add Video modal pre-filled for a given job/case, always
  // starting on Step 1 and with a clean direction-filter (so a leftover
  // arrow from a previous run never gets silently attached to this job).
  const openAddVideoModal = (job) => {
    const now = new Date();
    setAddVideoFromDate(now.toLocaleDateString('en-CA'));
    setAddVideoToDate(now.toLocaleDateString('en-CA'));
    setAddVideoFromTime('00:00');
    setAddVideoToTime(now.toTimeString().slice(0, 5));
    setAddVideoSelectedCams(selectedCameras.length ? [...selectedCameras] : []);
    setAddVideoCameraSearch('');
    setAddVideoSourceTab('CAMERAS');
    setAddVideoStep(1);
    setAddVideoJob(job);
    clearDirection();
    setShowAddVideoModal(true);
  };

  useEffect(() => {
    fetchJobHistory();
  }, []);

  // When a camera is selected in multicam view, fetch its metadata sidecar
  // so bounding-box overlays and click-to-jump work exactly like single-cam view
  useEffect(() => {
    if (!activeCamVideoId || multicamGroup.length === 0) return;
    const job = multicamGroup.find(j => {
      const cId = Array.isArray(j.camera_id) ? j.camera_id[0] : j.camera_id;
      return cId === activeCamVideoId;
    });
    setMetadataItems([]);
    setCurrentActiveObjects([]);
    if (job?.metadata_sidecar_url) {
      fetchMetadataSidecar(job.metadata_sidecar_url);
    }
  }, [activeCamVideoId, multicamGroup]);

  // Fetch ALL camera sidecars in parallel when multicamGroup is set.
  // Merges every detection item (with camera info) into allMulticamMetadata
  // so the center grid can show individual detected-object thumbnails.
  useEffect(() => {
    if (multicamGroup.length === 0) { setAllMulticamMetadata([]); return; }
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const results = await Promise.all(
          multicamGroup.map(async (job) => {
            if (!job.metadata_sidecar_url) return [];
            try {
              const res = await fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${job.metadata_sidecar_url}`);
              const data = await res.json();
              const cId = Array.isArray(job.camera_id) ? job.camera_id[0] : job.camera_id;
              const camInfo = cameras?.find(c => (c.id || c._id) === cId);
              // Tag each item with camera info and the output video URL for thumbnail
              return (data.items || []).map(item => ({
                ...item,
                camera_id: item.camera_id || cId,
                _camName: camInfo?.name || cId,
                _outputVideoUrl: job.output_video_url,
              }));
            } catch { return []; }
          })
        );
        if (!cancelled) {
          const merged = results.flat();

          // De-duplicate by track_id — keep ONE representative frame per unique person/object.
          // Pick the frame with the largest bbox area (= person closest to camera = best thumbnail).
          const trackMap = new Map();
          const trackDurationMap = new Map();
          merged.forEach(item => {
            const key = item.track_id || `${item.camera_id}_${item.original_timestamp}`;
            
            if (!trackDurationMap.has(key)) {
              trackDurationMap.set(key, 1);
            } else {
              trackDurationMap.set(key, trackDurationMap.get(key) + 1);
            }

            if (!trackMap.has(key)) {
              trackMap.set(key, item);
            } else {
              const existing = trackMap.get(key);
              const existingArea = (existing.bbox?.[2] || 0) * (existing.bbox?.[3] || 0);
              const newArea = (item.bbox?.[2] || 0) * (item.bbox?.[3] || 0);
              if (newArea > existingArea) trackMap.set(key, item);
            }
          });

          const deduped = Array.from(trackMap.values()).map(item => {
            const key = item.track_id || `${item.camera_id}_${item.original_timestamp}`;
            item._dwellTimeSec = trackDurationMap.get(key) / 25.0; // Assuming 25 FPS
            return item;
          });
          // Sort chronologically by original_timestamp
          deduped.sort((a, b) => {
            const ta = a.original_timestamp ? new Date(a.original_timestamp.replace(' ', 'T') + '+05:30').getTime() : 0;
            const tb = b.original_timestamp ? new Date(b.original_timestamp.replace(' ', 'T') + '+05:30').getTime() : 0;
            return ta - tb;
          });
          setAllMulticamMetadata(deduped);
        }

      } catch (e) { console.error('Failed to fetch multicam sidecars', e); }
    };
    fetchAll();
    return () => { cancelled = true; };
  }, [multicamGroup, cameras]);


  const fetchJobHistory = async () => {
    try {
      const res = await fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/jobs?_t=${Date.now()}`);
      const data = await res.json();
      setJobHistory(prev => {
        const prevStatusMap = new Map(prev.map(j => [j.job_id, j.status]));
        return (data || []).slice(0, 100).map(job => {
          if (prevStatusMap.get(job.job_id) === 'cancelled' && (job.status === 'processing' || job.status === 'queued')) {
            return { ...job, status: 'cancelled' };
          }
          return job;
        });
      });
    } catch (err) {
      console.error("Error fetching job history:", err);
    }
  };

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");

  const handleEditNameClick = () => {
    if (activeJobs[activeViewIndex]) {
      setEditNameValue(activeJobs[activeViewIndex].job_name || activeJobs[activeViewIndex].job_id);
      setIsEditingName(true);
    }
  };

  // Merge sibling per-camera jobs created from the same "Generate Synopsis"
  // request (they share a group_id) into one combined details object — e.g.
  // so Videos Processed shows "ENTRY: 0/1, EXIT: 0/2" together instead of
  // only whichever single job happened to be fetched.
  const aggregateJobDetails = (jobsData) => {
    if (jobsData.length === 1) return jobsData[0];
    return {
      job_id: jobsData.map(j => j.job_id).join(','),
      status: jobsData.some(j => ['queued', 'processing'].includes(j.status)) ? 'processing' : (jobsData.every(j => j.status === 'completed') ? 'completed' : 'failed'),
      progress: jobsData.reduce((acc, j) => acc + (j.progress || 0), 0) / jobsData.length,
      clip_details: jobsData.flatMap(j => (j.clip_details || []).map(c => {
        let cId = Array.isArray(c.camera_id) ? c.camera_id[0] : c.camera_id;
        if (c.is_system || !cId) {
            cId = Array.isArray(j.camera_id) ? j.camera_id[0] : j.camera_id;
        }
        return { ...c, camera_id: cId };
      })),
      status_by_camera: jobsData.reduce((acc, j) => {
        const cId = Array.isArray(j.camera_id) ? j.camera_id[0] : j.camera_id;
        return { ...acc, [cId]: j.status };
      }, {}),
      progress_by_camera: jobsData.reduce((acc, j) => {
        const cId = Array.isArray(j.camera_id) ? j.camera_id[0] : j.camera_id;
        return { ...acc, [cId]: j.progress };
      }, {}),
      total_clips: jobsData.reduce((acc, j) => acc + (j.total_clips || 0), 0),
      total_clips_by_camera: jobsData.reduce((acc, j) => ({ ...acc, ...j.total_clips_by_camera }), {}),
      camera_ids: jobsData.map(j => Array.isArray(j.camera_id) ? j.camera_id[0] : j.camera_id),
      range_start: jobsData[0].range_start,
      range_end: jobsData[0].range_end,
      created_at: jobsData[0].created_at,
      completed_at: jobsData.every(j => j.completed_at) ? jobsData.map(j => j.completed_at).sort().pop() : null,
      objects: jobsData.flatMap(j => j.objects || []),
      total_video_duration_s: jobsData.reduce((acc, j) => acc + (j.metrics?.original_duration_s || j.total_video_duration_s || 0), 0),
      metrics_by_camera: jobsData.reduce((acc, j) => {
        const cId = Array.isArray(j.camera_id) ? j.camera_id[0] : j.camera_id;
        return {
          ...acc,
          [cId]: {
            total_video_duration_s: j.metrics?.original_duration_s || j.total_video_duration_s || 0,
            created_at: j.created_at,
            completed_at: j.completed_at
          }
        };
      }, {}),
      error_message: jobsData.map(j => j.error_message).filter(Boolean).join(' | ')
    };
  };

  // Fetches Processing Details for a job from the SUMMARIES grid. If the
  // job has a group_id (i.e. it was generated alongside sibling cameras in
  // the same request), pulls every job in that group and merges them so
  // the breakdown shows all cameras, not just this one.
  const fetchGroupedJobDetails = async (job) => {
    const base = `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis`;
    if (job.group_id) {
      const res = await fetch(`${base}/jobs?group_id=${encodeURIComponent(job.group_id)}`);
      if (!res.ok) throw new Error("Failed to load job group");
      const siblings = await res.json();
      if (siblings.length > 0) return aggregateJobDetails(siblings);
    }
    const res = await fetch(`${base}/jobs/${job.job_id}`);
    if (!res.ok) throw new Error("Failed to load job");
    return await res.json();
  };

  const handleSaveName = async () => {
    const job = activeJobs[activeViewIndex];
    if (!job) return;
    try {
      const res = await fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/jobs/${job.job_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_name: editNameValue })
      });
      if (res.ok) {
        const updated = await res.json();
        setActiveJobs(prev => prev.map((j, idx) => idx === activeViewIndex ? updated : j));
        setJobHistory(prev => prev.map(j => j.job_id === updated.job_id ? updated : j));
      }
    } catch (err) {
      console.error("Error saving job name:", err);
    }
    setIsEditingName(false);
  };

  // Trigger Synopsis Job Creation
  const handleGenerateSynopsis = async (jobName = '', extraMeta = {}) => {
    const now = new Date();
    if (new Date(rangeStart) > now || new Date(rangeEnd) > now) {
      setToastMessage("Future date and time cannot be selected.");
      return;
    }

    // Close the modal immediately
    setShowCreateModal(false);
    setCreateTitle('');
    setCreateDescription('');
    setCreateIncidentDate('');
    setCreateIncidentTime('');

    setLoading(true);
    setMetadataItems([]);
    setCurrentActiveObjects([]);

    // Pre-insert a placeholder card so it appears instantly in the list
    const placeholderId = `pending-${Date.now()}`;
    const placeholder = {
      job_id: placeholderId,
      job_name: jobName || null,
      description: extraMeta.description || null,
      incident_time: extraMeta.incidentTime || null,
      status: 'queued',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      camera_id: selectedCameras[0] || null,
      range_start: rangeStart,
      range_end: rangeEnd,
      _placeholder: true,
    };
    setJobHistory(prev => [placeholder, ...prev]);

    try {
      const payload = {
        camera_id: selectedCameras,
        range_start: rangeStart,
        range_end: rangeEnd,
        ...(jobName ? { job_name: jobName } : {}),
        ...(extraMeta.description ? { description: extraMeta.description } : {}),
        ...(extraMeta.incidentTime ? { incident_time: extraMeta.incidentTime } : {})
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
        setJobHistory(prev => prev.filter(j => j.job_id !== placeholderId));
        return;
      }

      const data = await response.json();
      const jobsArr = Array.isArray(data) ? data : [data];

      // Replace placeholder with real job data
      setJobHistory(prev => {
        const withoutPlaceholder = prev.filter(j => j.job_id !== placeholderId);
        const existingIds = new Set(withoutPlaceholder.map(j => j.job_id));
        const newJobs = jobsArr.filter(j => !existingIds.has(j.job_id));
        return [...newJobs, ...withoutPlaceholder];
      });

      setActiveJobs(jobsArr);
      pollJobStatus(jobsArr.map(j => j.job_id));
    } catch (err) {
      console.error("Error creating synopsis job:", err);
      setToastMessage("Failed to submit Video Synopsis Job. Ensure Synopsis Microservice is running on port 8005.");
      setLoading(false);
      setJobHistory(prev => prev.filter(j => j.job_id !== placeholderId));
    }
  };

  const pollIntervalRef = useRef(null);

  // Poll job status until complete
  const pollJobStatus = (jobIds) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const updatedJobs = await Promise.all(jobIds.map(async (id) => {
          const res = await fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/jobs/${id}`);
          return await res.json();
        }));

        setActiveJobs(updatedJobs);

        const allDone = updatedJobs.every(j => ["completed", "failed", "cancelled"].includes(j.status));
        if (allDone) {
          clearInterval(pollIntervalRef.current);
          setLoading(false);
          const firstSuccess = updatedJobs.find(j => j.status === "completed");
          if (firstSuccess) {
            setActiveViewIndex(updatedJobs.indexOf(firstSuccess));
            fetchMetadataSidecar(firstSuccess.metadata_sidecar_url);
          }
          fetchJobHistory();
        }
      } catch (err) {
        console.error("Error polling synopsis jobs:", err);
      }
    }, 2500);
  };


  // Fetch Metadata Sidecar JSON for interactive click-to-jump overlays
  const fetchMetadataSidecar = async (metaUrl) => {
    try {
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
      
      const url = `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/event-playback?camera_id=${encodeURIComponent(item.camera_id)}&timestamp=${encodeURIComponent(formattedTime)}`;
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

  // Live update Processing Details popup if open and processing
  useEffect(() => {
    let interval;
    if (showDetailsModal && currentJobDetails && (currentJobDetails.status === 'processing' || currentJobDetails.status === 'queued')) {
      interval = setInterval(async () => {
        try {
          const data = await fetchGroupedJobDetails(currentJobDetails);
          setCurrentJobDetails(data);
        } catch (e) {
          console.error(e);
        }
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [showDetailsModal, currentJobDetails?.status, currentJobDetails?.job_id, currentJobDetails?.group_id]);

  // Groups jobHistory (flat, one entry per camera per generate request)
  // into one array per "case": every job sharing a group_id together, and
  // any job without one (e.g. local no_video cards, or older jobs created
  // before group_id existed) in its own group of 1. The SUMMARIES grid
  // renders one card per group instead of one card per camera-job.
  const groupedJobHistory = useMemo(() => {
    const map = new Map();
    const order = [];
    jobHistory.forEach(job => {
      const key = job.group_id || job.job_id;
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key).push(job);
    });
    return order.map(key => map.get(key));
  }, [jobHistory]);

  // Applies the right-panel filters (Source, Time Range) to the merged detections.
  const filteredMulticamMetadata = useMemo(() => {
    const toMinutesIST = (ts) => {
      if (!ts) return null;
      const n = ts.replace(' ', 'T');
      const hasZone = n.includes('Z') || n.includes('+') || n.includes('-', 10);
      const d = new Date(hasZone ? n : n + '+05:30');
      const parts = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).split(':');
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    };
    const toMin = (hhmm) => { if (!hhmm) return null; const [h, m] = hhmm.split(':'); return parseInt(h, 10) * 60 + parseInt(m, 10); };
    const from = toMin(filterTimeFrom);
    const to = toMin(filterTimeTo);
    const filtered = allMulticamMetadata.filter(item => {
      if (filterCams && !filterCams.includes(item.camera_id)) return false;
      if (from !== null || to !== null) {
        const t = toMinutesIST(item.original_timestamp);
        if (t === null) return false;
        if (from !== null && t < from) return false;
        if (to !== null && t > to) return false;
      }
      if (item._dwellTimeSec < filterDwell[0] || item._dwellTimeSec > filterDwell[1]) return false;
      return true;
    });

    filtered.sort((a, b) => {
       const tsA = a.original_timestamp ? new Date(a.original_timestamp.replace(' ', 'T') + (a.original_timestamp.includes('Z') || a.original_timestamp.includes('+') ? '' : '+05:30')).getTime() : 0;
       const tsB = b.original_timestamp ? new Date(b.original_timestamp.replace(' ', 'T') + (b.original_timestamp.includes('Z') || b.original_timestamp.includes('+') ? '' : '+05:30')).getTime() : 0;
       return gridSortBy === 'Newest' ? tsB - tsA : tsA - tsB;
    });

    return filtered;
  }, [allMulticamMetadata, filterCams, filterTimeFrom, filterTimeTo, gridSortBy, filterDwell]);

  const activeFilterCount = (filterCams ? 1 : 0) + ((filterTimeFrom || filterTimeTo) ? 1 : 0) + ((filterDwell[0] > 0 || filterDwell[1] < 60) ? 1 : 0);

  // status: 'live' = works today; 'soon' = needs new fields from the backend sidecar.
  const FILTER_CATALOGUE = [
    { key: 'source', label: 'Source', icon: 'videocam', status: 'live' },
    { key: 'time_range', label: 'Time Range', icon: 'schedule', status: 'live' },
    { key: 'class', label: 'Class', icon: 'category', status: 'soon', note: 'Needs the detector class (person / vehicle / bicycle) saved per track in the sidecar.' },
    { key: 'person_attributes', label: 'Person Attributes', icon: 'person', status: 'soon', note: 'Needs an attribute model (age, gender, etc.) run on each track.' },
    { key: 'color', label: 'Color', icon: 'palette', status: 'soon', note: 'Needs dominant clothing/vehicle colour extracted per track.' },
    { key: 'size', label: 'Size', icon: 'straighten', status: 'soon', note: 'Can be derived from bbox area — not wired up yet.' },
    { key: 'speed', label: 'Speed', icon: 'speed', status: 'soon', note: 'Can be derived from bbox movement over time — needs all frames per track, not one.' },
    { key: 'dwell', label: 'Dwell', icon: 'hourglass_empty', status: 'live' },
    { key: 'direction', label: 'Direction', icon: 'explore', status: 'soon', note: 'Direction is currently set when creating the summary (Add Video step 3), not as a viewer filter.' },
    { key: 'appearance', label: 'Appearance Similarity', icon: 'image_search', status: 'soon', note: 'Needs re-ID embeddings per track.' },
    { key: 'face', label: 'Face Recognition', icon: 'face', status: 'soon', note: 'Face boxes are extracted, but there is no recognition / known-person database yet.' },
  ];

  return (
    <div className="synopsis-page">
      {/* Dynamic Background Effect */}
      <div className="synopsis-bg-blob blob-1"></div>
      <div className="synopsis-bg-blob blob-2"></div>

      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          zIndex: 99999999,
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
        {viewMode === 'cases' && (
          <div style={{ padding: '0px', flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {/* Top Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '16px 20px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.05em' }}>SUMMARIES</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', gap: '16px' }}>
                  <span className="material-icons-outlined" style={{ cursor: 'pointer', fontSize: '1.2rem' }}>search</span>
                  <span>Sort by : <span style={{ color: 'var(--text-primary)', cursor: 'pointer' }}>Last Created</span> | <span style={{ cursor: 'pointer' }}>Last Modified</span></span>
                </div>
                <button 
                  onClick={() => setShowCreateModal(true)}
                  style={{ 
                    background: '#0284c7', color: 'white', border: 'none', 
                    padding: '8px 16px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 600, 
                    display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', transition: 'background 0.2s'
                  }}>
                  <span className="material-icons-outlined" style={{ fontSize: '1.1rem' }}>add_circle</span> CREATE SUMMARY
                </button>
              </div>
            </div>

            {/* Grid Wrapper */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px 20px 20px' }}>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
                gap: '20px',
                gridAutoRows: 'max-content',
                alignContent: 'start'
              }}>
              {groupedJobHistory.map(group => {
                const job = group[0]; // representative job for single-group fields
                const isGrouped = group.length > 1;

                // Combined status across every camera in this group.
                const groupStatus = (() => {
                  if (group.every(j => j._local && j.status === 'no_video')) return 'no_video';
                  if (group.some(j => j._placeholder || j.status === 'queued' || j.status === 'processing')) return 'processing';
                  if (group.every(j => j.status === 'completed')) return 'completed';
                  if (group.some(j => j.status === 'failed')) return 'failed';
                  return job.status;
                })();
                const completedJob = group.find(j => j.status === 'completed') || job;
                const avgProgress = group.reduce((acc, j) => acc + (j.progress || 0), 0) / group.length;

                // "ENTRY + EXIT" for a multi-camera case, otherwise the job's own name.
                const groupTitle = job.job_name || (isGrouped
                  ? group.map(j => cameras?.find(c => (c.id || c._id) === j.camera_id)?.name || j.camera_id).join(' + ')
                  : job.job_id);

                const firstCreated = group.reduce((earliest, j) => {
                  const dt = j.started_at || j.created_at;
                  return (!earliest || (dt && dt < earliest)) ? dt : earliest;
                }, null);
                const lastModified = group.reduce((latest, j) => (
                  !latest || (j.updated_at && j.updated_at > latest) ? j.updated_at : latest
                ), null);

                const groupKey = job.group_id || job.job_id;

                return (
                <div 
                  key={groupKey} 
                  style={{ 
                    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px', 
                    display: 'flex', flexDirection: 'column', overflow: 'hidden', cursor: 'pointer',
                    color: 'var(--text-primary)', transition: 'border 0.2s, box-shadow 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#38bdf8'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                  onClick={() => {
                    if (groupStatus === 'no_video' || groupStatus === 'processing') {
                      // no_video / still-processing case -> open ADD VIDEO
                      openAddVideoModal(job);
                      return;
                    }
                    if (groupStatus === 'completed') {
                      setMulticamGroup(group);
                      setActiveJobs(group);
                      setActiveViewIndex(0);
                      setActiveCamVideoId(null);
                      setViewMode('multicam');
                    } else {
                      setActiveJobs(group);
                      setActiveViewIndex(0);
                      setViewMode('view');
                      if (job.metadata_sidecar_url) fetchMetadataSidecar(job.metadata_sidecar_url);
                    }
                  }}
                >
                  {/* Image Placeholder */}
                  <div style={{ height: '160px', background: 'var(--bg-base)', position: 'relative' }}>
                    {groupStatus === 'no_video' ? (
                      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', background: 'var(--bg-base)' }}>
                        <div style={{ border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '4px', padding: '16px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>This case does not contain videos</span>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              openAddVideoModal(job);
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: '#f8fafc', cursor: 'pointer', padding: '5px 12px', fontSize: '0.8rem', fontWeight: 600 }}
                          >
                            <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>add</span>
                            ADD VIDEO
                          </button>
                        </div>
                      </div>
                    ) : groupStatus === 'processing' && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(10,14,20,0.82)', zIndex: 2, gap: '10px', padding: '0 24px' }}>
                        <svg width="36" height="36" viewBox="0 0 36 36" style={{ animation: 'spin 1.2s linear infinite' }}>
                          <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3"/>
                          <path d="M18 3 A15 15 0 0 1 33 18" fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round"/>
                        </svg>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                          {isGrouped ? `Processing (${group.filter(j => j.status === 'completed').length}/${group.length} cameras)` : 'Processing'}
                        </span>
                        <div style={{ width: '100%', maxWidth: '180px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ height: '4px', width: '100%', background: 'rgba(255,255,255,0.15)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${avgProgress}%`, background: '#38bdf8', borderRadius: '2px', transition: 'width 0.4s ease' }} />
                          </div>
                          <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontWeight: 600, textAlign: 'center' }}>{avgProgress.toFixed(0)}%</span>
                        </div>
                      </div>
                    )}
                    {groupStatus === 'completed' ? (
                      <img 
                        src={`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/static/synopsis/backgrounds/${completedJob.camera_id}_${(() => { const hr = new Date(completedJob.range_start || completedJob.created_at).getHours(); if(hr >= 5 && hr < 12) return 'morning'; if(hr >= 12 && hr < 17) return 'afternoon'; if(hr >= 17 && hr < 20) return 'evening'; return 'night'; })()}_bg.png`} 
                        onError={(e) => { e.target.onerror = null; e.target.src = `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${completedJob.heatmap_url}`; }}
                        alt="cover" 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                      />
                    ) : (groupStatus === 'failed') && (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', opacity: 0.5 }}>
                        <span className="material-icons-outlined" style={{ fontSize: '3rem' }}>videocam</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Sub-thumbnails (lazy-loaded frames) */}
                  <div style={{ display: 'flex', padding: '8px', gap: '8px', background: 'var(--bg-base)', borderBottom: '1px solid var(--border)' }}>
                     {[0.2, 0.5, 0.8].map((pct, idx) => {
                       const duration = completedJob.metrics?.synopsis_duration_s || 10;
                       const t = Math.max(0.1, duration * pct);
                       return (
                         <div key={idx} style={{ width: '40px', height: '24px', background: 'var(--bg-active)', borderRadius: '2px', overflow: 'hidden' }}>
                           {completedJob.output_video_url && groupStatus === 'completed' && (
                             <VideoThumbnail src={`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${completedJob.output_video_url}#t=${t}`} />
                           )}
                         </div>
                       );
                     })}
                     <span className="material-icons-outlined" style={{ color: 'var(--text-muted)', fontSize: '1rem', marginLeft: 'auto' }}>more_horiz</span>
                  </div>

                  {/* Info */}
                  <div style={{ padding: '16px', flex: 1 }}>
                    {editingJobId === job.job_id ? (
                      <input 
                        autoFocus
                        value={editJobName}
                        onChange={(e) => setEditJobName(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            try {
                              setJobHistory(prev => prev.map(j => {
                                if (group.some(g => g.job_id === j.job_id)) {
                                  return { ...j, job_name: editJobName.trim(), updated_at: new Date().toISOString() };
                                }
                                return j;
                              }));
                              await Promise.all(group.map(j => fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/jobs/${j.job_id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ job_name: editJobName.trim() })
                              })));
                              setEditingJobId(null);
                              fetchJobHistory();
                              setToastMessage("Job name updated.");
                            } catch(err) { console.error(err); setToastMessage("Failed to update job name."); }
                          } else if (e.key === 'Escape') {
                            setEditingJobId(null);
                          }
                        }}
                        onBlur={() => setEditingJobId(null)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ margin: '0 0 8px 0', fontSize: '1rem', fontWeight: 500, width: '100%', background: 'var(--bg-active)', color: 'var(--text-primary)', border: '1px solid #38bdf8', borderRadius: '4px', padding: '2px 6px', outline: 'none' }}
                      />
                    ) : (
                      <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{groupTitle}</h3>
                    )}
                    {job.description && (
                      <p style={{ margin: '0 0 4px 0', fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.description}</p>
                    )}
                    {job.incident_time && (
                      <p style={{ margin: '0 0 4px 0', fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span className="material-icons-outlined" style={{ fontSize: '0.85rem' }}>schedule</span>
                        {job.incident_time}
                      </p>
                    )}
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Created: {(() => {
                        const dt = firstCreated;
                        if (!dt) return '-';
                        const dtStr = (dt.includes('Z') || dt.includes('+')) ? dt : dt + 'Z';
                        return new Date(dtStr).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
                      })()}
                    </p>
                  </div>

                  {/* Bottom Bar */}
                  <div style={{ 
                    padding: '12px 16px', borderTop: '1px solid var(--border)', 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'var(--bg-base)'
                  }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Last Modified: {(() => {
                        const dt = lastModified;
                        if (!dt) return '-';
                        const dtStr = (dt.includes('Z') || dt.includes('+')) ? dt : dt + 'Z';
                        return new Date(dtStr).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
                      })()}
                    </span>
                    <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)' }}>
                      <span 
                        className="material-icons-outlined" 
                        style={{ fontSize: '1rem', cursor: 'pointer' }} 
                        title="View Processing Details"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            const data = await fetchGroupedJobDetails(job);
                            setCurrentJobDetails(data);
                            setShowDetailsModal(true);
                            setActiveProcessingTab('overall');
                          } catch (err) {
                            console.error("Failed to load past job details:", err);
                            setToastMessage("Failed to load details.");
                          }
                        }}
                      >info</span>
                      <span className="material-icons-outlined" style={{ fontSize: '1rem', cursor: 'pointer' }} onClick={(e) => { 
                        e.stopPropagation(); 
                        setEditJobName(groupTitle);
                        setEditingJobId(job.job_id);
                      }} title="Rename">edit</span>
                      <span className="material-icons-outlined" style={{ fontSize: '1rem', cursor: 'pointer' }} title={isGrouped ? "Delete all cameras in this case" : "Delete"} onClick={async (e) => { 
                          e.stopPropagation(); 
                          const idsToDelete = group.map(j => j.job_id);
                          try {
                            setJobHistory(prev => prev.filter(j => !idsToDelete.includes(j.job_id)));
                            await Promise.all(idsToDelete.map(id =>
                              fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/jobs/${id}`, { method: 'DELETE' }).catch(e => console.error(e))
                            ));
                            fetchJobHistory();
                            setToastMessage(isGrouped ? "Summary deleted." : "Job deleted.");
                          }catch(err){console.error(err); setToastMessage("Failed to delete job.");}
                      }}>delete</span>
                      <span className="material-icons-outlined" style={{ fontSize: '1rem', cursor: 'pointer' }} onClick={(e) => { 
                        e.stopPropagation(); 
                        if (isGrouped) {
                          setShareModalGroup(group);
                        } else {
                          if (completedJob.output_video_url) {
                            const url = `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${completedJob.output_video_url}`;
                            navigator.clipboard.writeText(url).then(() => setToastMessage("Video URL copied to clipboard!")).catch(() => setToastMessage("Failed to copy URL"));
                          } else {
                            setToastMessage("Video not available yet.");
                          }
                        }
                      }}>share</span>
                    </div>
                  </div>
                </div>
                );
              })}
              {jobHistory.length === 0 && (
                <div style={{ color: 'var(--text-muted)', gridColumn: '1 / -1', padding: '40px', textAlign: 'center' }}>
                  No summaries available. Click "CREATE SUMMARY" to start.
                </div>
              )}
            </div>
          </div>
          </div>
        )}

        {viewMode === 'multicam' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {/* Top Navigation Bar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <button
                  onClick={() => {
                    setViewMode('cases');
                    setActiveJobs([]);
                    setMulticamGroup([]);
                    setActiveCamVideoId(null);
                  }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 500 }}
                >
                  <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>arrow_back</span>
                  Back to Summaries
                </button>
                <div style={{ width: '1px', height: '20px', background: 'var(--border)' }}></div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {multicamGroup[0]?.job_name || "Multi-Camera Summary"}
                </h3>
              </div>
              <button onClick={() => setShowCreateModal(true)} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>add</span>
                ADD VIDEO
              </button>
            </div>

            {/* Main Layout Area */}
            <div style={{ display: 'flex', flex: 1, minHeight: 0, background: '#0a0a0a' }}>
              
              {/* Left Camera Strip */}
              <div style={{ width: '180px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: '#111', flexShrink: 0, minHeight: 0 }}>
                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {multicamGroup.map(job => {
                  const cId = Array.isArray(job.camera_id) ? job.camera_id[0] : job.camera_id;
                  const camInfo = cameras?.find(c => (c.id || c._id) === cId);
                  const isActive = activeCamVideoId === cId;
                  
                  // Calculate object count from clip details
                  const objectCount = (job.clip_details || []).reduce((acc, clip) => {
                    if (clip.is_system) return acc;
                    return acc + (clip.objects_detected !== undefined ? clip.objects_detected : (clip.faces_detected || 0));
                  }, 0);
                  
                  return (
                    <div 
                      key={cId}
                      onClick={() => setActiveCamVideoId(isActive ? null : cId)}
                      style={{ 
                        padding: '12px', borderBottom: '1px solid #222', cursor: 'pointer',
                        borderLeft: isActive ? '4px solid #38bdf8' : '4px solid transparent',
                        background: isActive ? '#1a1a1a' : 'transparent', transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ width: '100%', aspectRatio: '16/9', background: '#000', marginBottom: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                        {job.output_video_url ? (
                          <VideoThumbnail src={`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${job.output_video_url}#t=0.5`} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="material-icons-outlined" style={{ color: '#555', fontSize: '2rem' }}>videocam</span>
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {camInfo?.name || cId}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        {/* Area | Path tags — visual placeholders until area/path filtering exists in the backend */}
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#64748b' }} title="Area / Path filters are not available yet">
                          <span className="material-icons-outlined" style={{ fontSize: '0.85rem' }}>layers</span>
                          <span>Area</span>
                          <span style={{ opacity: 0.4 }}>|</span>
                          <span className="material-icons-outlined" style={{ fontSize: '0.85rem' }}>timeline</span>
                          <span>Path</span>
                        </span>
                        <span style={{ color: '#10b981', fontWeight: 600 }}>{objectCount}</span>
                      </div>
                    </div>
                  );
                })}
                </div>


              </div>

              {/* Center Content Area */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
                
                {activeCamVideoId === null ? (
                  <>
                  {/* Grid Top Control Bar */}
                  <div style={{ display: 'flex', flexDirection: 'column', background: '#111827', borderBottom: '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', background: '#1f2937' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Sort by:</span>
                        <div style={{ display: 'flex', gap: '8px', fontSize: '0.85rem' }}>
                          <button onClick={() => setGridSortBy('Oldest')} style={{ background: 'none', border: 'none', color: gridSortBy === 'Oldest' ? '#f8fafc' : '#64748b', fontWeight: gridSortBy === 'Oldest' ? 600 : 400, cursor: 'pointer', padding: 0 }}>Oldest</button>
                          <span style={{ color: '#475569' }}>|</span>
                          <button onClick={() => setGridSortBy('Newest')} style={{ background: 'none', border: 'none', color: gridSortBy === 'Newest' ? '#f8fafc' : '#64748b', fontWeight: gridSortBy === 'Newest' ? 600 : 400, cursor: 'pointer', padding: 0 }}>Newest</button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: '#cbd5e1', cursor: 'pointer' }}>
                          <input type="checkbox" checked={selectedObjects.length > 0 && selectedObjects.length === filteredMulticamMetadata.length} onChange={(e) => setSelectedObjects(e.target.checked ? filteredMulticamMetadata.map(m => m.track_id) : [])} style={{ accentColor: '#38bdf8' }} />
                          Select all
                        </label>
                        <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                          {multicamGroup[0]?.range_start && new Date(multicamGroup[0].range_start.includes('+') ? multicamGroup[0].range_start : multicamGroup[0].range_start + '+05:30').toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })}
                          {' - '}
                          {multicamGroup[0]?.range_end && new Date(multicamGroup[0].range_end.includes('+') ? multicamGroup[0].range_end : multicamGroup[0].range_end + '+05:30').toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Detection Object Grid - one tile per detected person/vehicle, sorted chronologically */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: '#0d1117' }}>
                    {allMulticamMetadata.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: '#555' }}>
                        <span className="material-icons-outlined" style={{ fontSize: '3rem' }}>hourglass_empty</span>
                        <span style={{ fontSize: '0.9rem' }}>Loading detections...</span>
                      </div>
                    ) : filteredMulticamMetadata.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: '#555' }}>
                        <span className="material-icons-outlined" style={{ fontSize: '3rem' }}>filter_alt_off</span>
                        <span style={{ fontSize: '0.9rem' }}>No detections match the current filters.</span>
                        <button
                          onClick={() => { setFilterCams(null); setFilterTimeFrom(''); setFilterTimeTo(''); setFilterDwell([0, 60]); }}
                          style={{ background: 'transparent', border: '1px solid #333', color: '#94a3b8', borderRadius: '4px', padding: '4px 12px', cursor: 'pointer', fontSize: '0.8rem' }}
                        >Reset filters</button>
                      </div>
                    ) : (
                      (() => {
                        // Group by date for date-header rows like BriefCam
                        const grouped = {};
                        filteredMulticamMetadata.forEach(item => {
                          const rawTs = item.original_timestamp || '';
                          // Backend stores timestamps in IST — append +05:30 if no timezone info present
                          const toISTDate = (ts) => {
                            if (!ts) return null;
                            const normalized = ts.replace(' ', 'T');
                            const hasZone = normalized.includes('Z') || normalized.includes('+') || normalized.includes('-', 10);
                            return new Date(hasZone ? normalized : normalized + '+05:30');
                          };
                          const dateKey = rawTs
                            ? toISTDate(rawTs).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' })
                            : 'Unknown Date';
                          if (!grouped[dateKey]) grouped[dateKey] = [];
                          grouped[dateKey].push(item);
                        });

                        return Object.entries(grouped).map(([dateKey, items]) => (
                          <div key={dateKey} style={{ marginBottom: '28px' }}>
                            {/* Date header */}
                            <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600, marginBottom: '12px', paddingBottom: '6px', borderBottom: '1px solid #1e293b', letterSpacing: '0.05em' }}>
                              {dateKey}
                            </div>
                            {/* Detection tiles grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px' }}>
                              {items.map((item, idx) => {
                                // Clean URL without #t= — VideoFrameAt seeks via currentTime, which is reliable
                                const baseVideoUrl = item._outputVideoUrl
                                  ? `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${item._outputVideoUrl}`
                                  : null;
                                const frameTime = item.synopsis_timestamp_s ?? 1;
                                // Show time in IST — backend stores as IST, so treat bare timestamps as +05:30
                                const toISTDate = (ts) => {
                                  if (!ts) return null;
                                  const normalized = ts.replace(' ', 'T');
                                  const hasZone = normalized.includes('Z') || normalized.includes('+') || normalized.includes('-', 10);
                                  return new Date(hasZone ? normalized : normalized + '+05:30');
                                };
                                const timeLabel = item.original_timestamp
                                  ? toISTDate(item.original_timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                                  : '—';


                                return (
                                  <div
                                    key={`${item.track_id}-${item.camera_id}-${idx}`}
                                    onClick={() => handleJumpToOriginal(item)}
                                    title={`Click to view raw recording — ${item._camName} @ ${item.original_timestamp}`}
                                    style={{
                                      background: '#111827', borderRadius: '4px', overflow: 'hidden',
                                      cursor: 'pointer', border: '1px solid #1e293b',
                                      transition: 'border-color 0.15s, transform 0.1s',
                                      display: 'flex', flexDirection: 'column'
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#38bdf8'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.transform = 'scale(1)'; }}
                                  >
                                    {/* Thumbnail — exact cropped person/object region via canvas + bbox */}
                                    <div style={{ width: '100%', aspectRatio: '3/4', background: '#000', position: 'relative', overflow: 'hidden' }}>
                                      {baseVideoUrl ? (
                                        <VideoFrameCrop src={baseVideoUrl} timeSeconds={frameTime} bbox={item.bbox} />
                                      ) : (
                                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <span className="material-icons-outlined" style={{ color: '#444', fontSize: '1.8rem' }}>person</span>
                                        </div>
                                      )}
                                      {/* Camera badge */}
                                      <div style={{ position: 'absolute', top: '4px', left: '4px', background: 'rgba(0,0,0,0.75)', padding: '2px 5px', borderRadius: '3px', fontSize: '0.6rem', color: '#38bdf8', fontWeight: 700, maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {item._camName}
                                      </div>
                                      {/* Play icon hint */}
                                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.15s' }}
                                        onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                        onMouseLeave={e => e.currentTarget.style.opacity = '0'}
                                      >
                                        <div style={{ background: 'rgba(0,0,0,0.6)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <span className="material-icons-outlined" style={{ color: '#fff', fontSize: '1.2rem' }}>play_circle</span>
                                        </div>
                                      </div>
                                    </div>
                                    {/* Timestamp */}
                                    <div style={{ padding: '5px 6px', fontSize: '0.68rem', color: '#94a3b8', textAlign: 'center', background: '#0d1117', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {timeLabel}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ));
                      })()
                    )}
                  </div>
                  </>
                ) : (
                  /* Single Camera Full Video — with bounding boxes + click-to-jump, identical to single-cam view */
                  (() => {
                    const activeJob = multicamGroup.find(j => {
                      const cId = Array.isArray(j.camera_id) ? j.camera_id[0] : j.camera_id;
                      return cId === activeCamVideoId;
                    });
                    const camInfo = cameras?.find(c => (c.id || c._id) === activeCamVideoId);
                    const videoSrc = activeJob?.output_video_url
                      ? `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${activeJob.output_video_url}`
                      : null;

                    return (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000', overflow: 'hidden', minHeight: 0 }}>
                        {/* Header bar */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: '#000', borderBottom: '1px solid #222', flexShrink: 0 }}>
                          {/* Left: Camera Name */}
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e2e8f0' }}>{camInfo?.name || activeCamVideoId}</span>
                          </div>

                          {/* Center: Time Range */}
                          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', whiteSpace: 'nowrap' }}>
                            {activeJob?.range_start && activeJob?.range_end && (
                              <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                                {new Date(activeJob.range_start.includes('Z') || activeJob.range_start.includes('+') ? activeJob.range_start : activeJob.range_start + '+05:30').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: '2-digit', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })}
                                {' - '}
                                {new Date(activeJob.range_end.includes('Z') || activeJob.range_end.includes('+') ? activeJob.range_end : activeJob.range_end + '+05:30').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: '2-digit', day: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })}
                              </span>
                            )}
                          </div>

                          {/* Right: Controls & Close */}
                          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px' }}>
                            {activeJob?.heatmap_url && (
                              <button
                                className={`heatmap-toggle-btn ${showHeatmap ? 'active' : ''}`}
                                onClick={() => setShowHeatmap(!showHeatmap)}
                                style={{ padding: '2px 8px', fontSize: '0.75rem', background: 'transparent', border: '1px solid #333', color: '#ccc', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                              >
                                <span className="material-icons-outlined" style={{ fontSize: '0.9rem' }}>{showHeatmap ? 'visibility_off' : 'whatshot'}</span>
                                {showHeatmap ? 'Hide' : 'Heatmap'}
                              </button>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e2e8f0' }}>
                              <span style={{ fontSize: '0.85rem' }}>Video Synopsis</span>
                              <button
                                onClick={() => { setActiveCamVideoId(null); setMetadataItems([]); setCurrentActiveObjects([]); setShowHeatmap(false); }}
                                style={{ background: 'none', border: 'none', color: '#e2e8f0', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
                                title="Close Video Synopsis"
                              >
                                <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>close</span>
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Video player + overlays */}
                        {videoSrc ? (
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#000' }}>
                            <div style={{ position: 'relative', width: '100%', flexGrow: 1, minHeight: 0 }}>
                              <video
                                key={activeCamVideoId}
                                ref={videoRef}
                                src={videoSrc}
                                autoPlay
                                muted
                                disablePictureInPicture
                                onTimeUpdate={(e) => {
                                  handleTimeUpdate(e);
                                  const timeEl = document.getElementById('custom-time-display');
                                  if (timeEl && e.target) {
                                    const pad = (n) => n.toString().padStart(2, '0');
                                    const format = (s) => {
                                      if (!s || isNaN(s)) return '00:00';
                                      const m = Math.floor(s / 60);
                                      const sec = Math.floor(s % 60);
                                      return `${pad(m)}:${pad(sec)}`;
                                    };
                                    timeEl.textContent = `${format(e.target.currentTime)}/${format(e.target.duration)}`;
                                    // Mirror into the left-strip global player bar
                                    const stripTime = document.getElementById('strip-time-display');
                                    if (stripTime) stripTime.textContent = `${format(e.target.currentTime)} / ${format(e.target.duration)}`;
                                  }
                                  const progressEl = document.getElementById('custom-progress-bar');
                                  if (progressEl && e.target && e.target.duration) {
                                    progressEl.style.width = `${(e.target.currentTime / e.target.duration) * 100}%`;
                                  }
                                  const stripProgress = document.getElementById('strip-progress-bar');
                                  if (stripProgress && e.target && e.target.duration) {
                                    stripProgress.style.width = `${(e.target.currentTime / e.target.duration) * 100}%`;
                                  }
                                }}
                                onPlay={() => { const el = document.getElementById('strip-play-icon'); if (el) el.textContent = 'pause'; }}
                                onPause={() => { const el = document.getElementById('strip-play-icon'); if (el) el.textContent = 'play_arrow'; }}
                                onLoadedMetadata={handleResize}
                                className="synopsis-video-player"
                                style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block', objectFit: 'contain', background: '#000' }}
                              />
                              {/* Heatmap overlay */}
                              {showHeatmap && activeJob?.heatmap_url && (
                                <img src={`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${activeJob.heatmap_url}`} className="heatmap-overlay" alt="Activity Heatmap" />
                              )}
                              {/* Bounding box overlays — click to jump to raw recording */}
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
                            
                            {/* Custom BriefCam-style Control Bar */}
                            <div style={{ display: 'flex', alignItems: 'center', background: '#000', padding: '10px 16px', gap: '20px', borderTop: '1px solid #1a1a1a', color: '#94a3b8', flexShrink: 0 }}>
                              <span className="material-icons-outlined" style={{ fontSize: '1.2rem', cursor: 'pointer' }}>more_vert</span>
                              
                              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <span className="material-icons-outlined" style={{ fontSize: '1.3rem', cursor: 'pointer', color: '#cbd5e1' }}>arrow_left</span>
                                <span className="material-icons-outlined" style={{ fontSize: '1.5rem', cursor: 'pointer', color: '#cbd5e1' }} onClick={() => videoRef.current?.paused ? videoRef.current.play() : videoRef.current?.pause()}>pause</span>
                                <span className="material-icons-outlined" style={{ fontSize: '1.3rem', cursor: 'pointer', color: '#cbd5e1' }}>arrow_right</span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <span className="material-icons-outlined" style={{ fontSize: '1.2rem', cursor: 'pointer' }}>skip_previous</span>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>1/2</span>
                                <span className="material-icons-outlined" style={{ fontSize: '1.2rem', cursor: 'pointer' }}>skip_next</span>
                              </div>

                              <div id="custom-time-display" style={{ fontSize: '0.8rem', fontFamily: 'monospace', minWidth: '95px', letterSpacing: '0.05em' }}>00:00/00:00</div>
                              
                              <div style={{ flex: 1, height: '4px', background: '#333', borderRadius: '2px', position: 'relative', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={(e) => {
                                if (videoRef.current) {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const pos = (e.clientX - rect.left) / rect.width;
                                  videoRef.current.currentTime = pos * videoRef.current.duration;
                                }
                              }}>
                                <div id="custom-progress-bar" style={{ position: 'absolute', left: 0, height: '100%', background: '#3b82f6', width: '0%', borderRadius: '2px' }}>
                                  <div style={{ position: 'absolute', right: '-5px', top: '50%', transform: 'translateY(-50%)', width: '10px', height: '10px', background: '#fff', borderRadius: '50%', boxShadow: '0 0 4px rgba(0,0,0,0.5)' }}></div>
                                </div>
                              </div>
                              
                              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', color: '#cbd5e1' }}>1X</span>
                                <span className="material-icons-outlined" style={{ fontSize: '1.3rem', cursor: 'pointer' }}>zoom_in</span>
                                <span className="material-icons-outlined" style={{ fontSize: '1.2rem', cursor: 'pointer' }}>branding_watermark</span>
                                <span className="material-icons-outlined" style={{ fontSize: '1.4rem', cursor: 'pointer', color: '#cbd5e1' }} onClick={() => videoRef.current?.requestFullscreen()}>fullscreen</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#555', gap: '8px' }}>
                            <span className="material-icons-outlined" style={{ fontSize: '3rem' }}>videocam_off</span>
                            <span style={{ fontSize: '0.85rem' }}>Video not available</span>
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}


                
              </div>

              {/* Right Filters Panel */}
              <div style={{ width: '230px', flexShrink: 0, borderLeft: '1px solid var(--border)', background: '#111', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em' }}>
                    FILTERS{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                  </span>
                  <span
                    onClick={() => { setFilterCams(null); setFilterTimeFrom(''); setFilterTimeTo(''); setFilterDwell([0, 60]); }}
                    style={{ fontSize: '0.7rem', color: activeFilterCount > 0 ? '#38bdf8' : '#475569', cursor: activeFilterCount > 0 ? 'pointer' : 'default' }}
                  >Reset</span>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  {FILTER_CATALOGUE.map(f => {
                    const isOpen = expandedFilter === f.key;
                    const isLive = f.status === 'live';
                    const isApplied = (f.key === 'source' && filterCams) || (f.key === 'time_range' && (filterTimeFrom || filterTimeTo)) || (f.key === 'dwell' && (filterDwell[0] > 0 || filterDwell[1] < 60));
                    return (
                      <div key={f.key} style={{ borderBottom: '1px solid #1e293b' }}>
                        <div
                          onClick={() => setExpandedFilter(isOpen ? null : f.key)}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', cursor: 'pointer', background: isOpen ? '#161b22' : 'transparent' }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: isLive ? '#e2e8f0' : '#94a3b8' }}>
                            <span className="material-icons-outlined" style={{ fontSize: '1rem', color: isApplied ? '#38bdf8' : '#64748b' }}>{f.icon}</span>
                            {f.label}
                            {isApplied && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#38bdf8' }} />}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {!isLive && <span style={{ fontSize: '0.58rem', color: '#64748b', border: '1px solid #2a3340', borderRadius: '3px', padding: '1px 4px', letterSpacing: '0.04em' }}>SOON</span>}
                            <span className="material-icons-outlined" style={{ fontSize: '1rem', color: '#475569', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>expand_more</span>
                          </span>
                        </div>

                        {isOpen && f.key === 'source' && (
                          <div style={{ padding: '4px 16px 12px' }}>
                            {multicamGroup.map(job => {
                              const cId = Array.isArray(job.camera_id) ? job.camera_id[0] : job.camera_id;
                              const name = cameras?.find(c => (c.id || c._id) === cId)?.name || cId;
                              const allIds = multicamGroup.map(j => Array.isArray(j.camera_id) ? j.camera_id[0] : j.camera_id);
                              const checked = !filterCams || filterCams.includes(cId);
                              return (
                                <label key={cId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '0.8rem', color: checked ? '#e2e8f0' : '#64748b', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    style={{ accentColor: '#38bdf8' }}
                                    onChange={() => {
                                      const current = filterCams || allIds;
                                      const next = current.includes(cId) ? current.filter(x => x !== cId) : [...current, cId];
                                      setFilterCams(next.length === allIds.length ? null : next);
                                    }}
                                  />
                                  {name}
                                </label>
                              );
                            })}
                          </div>
                        )}

                        {isOpen && f.key === 'time_range' && (
                          <div style={{ padding: '4px 16px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontSize: '0.68rem', color: '#64748b', letterSpacing: '0.06em' }}>FROM
                              <input type="time" value={filterTimeFrom} onChange={e => setFilterTimeFrom(e.target.value)}
                                style={{ display: 'block', width: '100%', marginTop: '3px', background: 'transparent', border: 'none', borderBottom: '1px solid #2a3340', color: '#e2e8f0', fontSize: '0.85rem', outline: 'none', colorScheme: 'dark' }} />
                            </label>
                            <label style={{ fontSize: '0.68rem', color: '#64748b', letterSpacing: '0.06em' }}>TO
                              <input type="time" value={filterTimeTo} onChange={e => setFilterTimeTo(e.target.value)}
                                style={{ display: 'block', width: '100%', marginTop: '3px', background: 'transparent', border: 'none', borderBottom: '1px solid #2a3340', color: '#e2e8f0', fontSize: '0.85rem', outline: 'none', colorScheme: 'dark' }} />
                            </label>
                          </div>
                        )}

                        {isOpen && f.key === 'dwell' && (
                          <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.75rem' }}>
                              <span>Min: {filterDwell[0]}s</span>
                              <span>Max: {filterDwell[1]}s</span>
                            </div>
                            <input 
                              type="range" 
                              min="0" max="60" step="1"
                              value={filterDwell[0]} 
                              onChange={e => setFilterDwell([Number(e.target.value), Math.max(Number(e.target.value), filterDwell[1])])}
                              style={{ width: '100%', accentColor: '#38bdf8' }}
                            />
                            <input 
                              type="range" 
                              min="0" max="60" step="1"
                              value={filterDwell[1]} 
                              onChange={e => setFilterDwell([Math.min(Number(e.target.value), filterDwell[0]), Number(e.target.value)])}
                              style={{ width: '100%', accentColor: '#38bdf8' }}
                            />
                          </div>
                        )}

                        {isOpen && !isLive && (
                          <div style={{ padding: '2px 16px 12px', fontSize: '0.72rem', color: '#64748b', lineHeight: 1.45 }}>
                            {f.note}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {(viewMode === 'create' || viewMode === 'view') && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '0 20px', minHeight: 0 }}>
            {/* Navigation back to cases */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', flexShrink: 0, padding: '12px 0' }}>
              <button
                onClick={() => {
                  setViewMode('cases');
                  setActiveJobs([]); 
                  setMetadataItems([]); 
                  setCurrentActiveObjects([]); 
                  setShowHeatmap(false);
                }}
                style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 500 }}
              >
                <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>arrow_back</span>
                Back to Summaries
              </button>
            </div>

          {/* OLD ARCHITECTURE — Left-panel controls (Camera, Time Range, Direction, Generate Synopsis button) */}
          {/* Replaced by the new "CREATE SUMMARY" modal flow (top-right button → local card → Add Video modal) */}
          {/* Keeping code commented for reference:
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', flex: 1, minHeight: 0, marginBottom: 20 }}>
          <section className="glass-panel synopsis-controls-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: 0, padding: '20px' }}>
            ...Camera selector, DateTimePicker, Direction canvas, Generate Synopsis button...
          </section>
          END OLD ARCHITECTURE */}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', flex: 1, minHeight: 0, marginBottom: 20 }}>

          <section className="glass-panel synopsis-history-card fade-in" ref={containerRef} style={{ padding: '20px', margin: 0, height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              
              {/* Header — always visible */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexShrink: 0 }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem' }}>
                  {/* Back arrow — shown whenever a job is active */}
                  {activeJobs.length > 0 && (
                    <button
                      onClick={() => { setActiveJobs([]); setMetadataItems([]); setCurrentActiveObjects([]); setShowHeatmap(false); }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                      title="Back to list"
                    >
                      <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>arrow_back</span>
                    </button>
                  )}

                  {activeJobs.length > 0 && activeJobs[activeViewIndex]?.status === 'completed' ? (
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
                          <span style={{ fontSize: '0.95rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeJobs[activeViewIndex].job_name || activeJobs[activeViewIndex].job_id}</span>
                          <button onClick={handleEditNameClick} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex' }} title="Rename">
                            <span className="material-icons-outlined" style={{ fontSize: '0.95rem' }}>edit</span>
                          </button>
                        </div>
                      )}
                    </>
                  ) : activeJobs.length > 0 ? (
                    <>
                      <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>hourglass_top</span>
                      <span style={{ fontSize: '0.95rem' }}>{activeJobs[activeViewIndex]?.job_name || activeJobs[activeViewIndex]?.job_id}</span>
                    </>
                  ) : (
                    <>
                      {/* <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>history</span> Previous Runs */}
                      <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>preview</span> Synopsis Output
                    </>
                  )}
                </h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {activeJobs.length > 0 && (
                    <span 
                      className="material-icons-outlined"
                      style={{ fontSize: '1.2rem', color: '#38bdf8', cursor: 'pointer' }}
                      title="View Processing Details"
                      onClick={async () => {
                        try {
                          const jobsData = await Promise.all(activeJobs.map(async j => {
                            const res = await fetch(`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005/a1/v1/synopsis/jobs/${j.job_id}`);
                            return res.json();
                          }));
                          setCurrentJobDetails(aggregateJobDetails(jobsData));
                          setShowDetailsModal(true);
                          setActiveProcessingTab('overall');
                        } catch (err) {
                          console.error("Failed to load active job details:", err);
                        }
                      }}
                    >info</span>
                  )}
                  {activeJobs.length > 0 && activeJobs[activeViewIndex]?.heatmap_url && activeJobs[activeViewIndex]?.status === 'completed' && (
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

                {activeJobs.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '8px', overflowX: 'auto' }}>
                    {activeJobs.map((job, idx) => (
                      <button
                        key={job.job_id}
                        onClick={() => {
                          setActiveViewIndex(idx);
                          if (job.status === 'completed') fetchMetadataSidecar(job.metadata_sidecar_url);
                        }}
                        style={{
                          padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                          background: activeViewIndex === idx ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                          color: activeViewIndex === idx ? '#38bdf8' : 'var(--text-muted)'
                        }}
                      >
                        {cameras?.find(c => (c.id || c._id) === job.camera_id)?.name || `Camera ${idx + 1}`}
                        {['processing', 'queued'].includes(job.status) && ' (Processing)'}
                      </button>
                    ))}
                  </div>
                )}

                {/* Video Player View */}
                {activeJobs.length > 0 && activeJobs[activeViewIndex]?.status === 'completed' && (
                  <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ position: 'relative', width: '100%', flexGrow: 1, minHeight: 0 }}>
                      <video
                        ref={videoRef}
                        src={`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${activeJobs[activeViewIndex].output_video_url}`}
                        controls
                        autoPlay
                        muted
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleResize}
                        className="synopsis-video-player"
                        style={{ width: '100%', height: '100%', maxHeight: '100%', borderRadius: '8px', display: 'block', objectFit: 'contain', background: '#000' }}
                      />
                      {showHeatmap && activeJobs[activeViewIndex]?.heatmap_url && (
                        <img src={`http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${activeJobs[activeViewIndex].heatmap_url}`} className="heatmap-overlay" alt="Activity Heatmap" />
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
                {activeJobs.length > 0 && activeJobs[activeViewIndex]?.status !== 'completed' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Status</span>
                      <span className={`status-badge status-${activeJobs[activeViewIndex].status}`}>{activeJobs[activeViewIndex].status.toUpperCase()}</span>
                    </div>
                    {['processing', 'queued'].includes(activeJobs[activeViewIndex].status) && (
                      <div className="progress-container">
                        <div className="progress-stats">
                          <span>Compilation Progress</span>
                          <span>{activeJobs[activeViewIndex].progress?.toFixed(0) ?? 0}%</span>
                        </div>
                        <div className="progress-bar-bg">
                          <div className="progress-bar-fill pulse" style={{ width: `${activeJobs[activeViewIndex].progress ?? 0}%` }}></div>
                        </div>
                      </div>
                    )}
                    {activeJobs[activeViewIndex].error_message && (
                      <div className="error-box">
                        <span className="material-icons-outlined">error_outline</span>
                        {activeJobs[activeViewIndex].error_message.split('| TB:')[0].trim()}
                      </div>
                    )}
                  </div>
                )}

                {/* History List View */}
                {activeJobs.length === 0 && (
                  <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '4px', minHeight: 0 }}>
                    {/* 
                      [OLD PREVIOUS RUNS UI COMMENTED OUT]
                      We now use the SUMMARIES grid view on the main screen for this.
                    */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                      <span className="material-icons-outlined" style={{ fontSize: '3rem', opacity: 0.2, marginBottom: '8px' }}>video_settings</span>
                      <p>Select cameras and time range to generate a synopsis.</p>
                    </div>
                  </div>
                )}

              </div>
            </section>
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
            
            {(() => {
              const rawCIds = Array.isArray(currentJobDetails.camera_ids) ? currentJobDetails.camera_ids : [currentJobDetails.camera_id || currentJobDetails.camera_ids];
              const cIds = rawCIds.map(id => Array.isArray(id) ? id[0] : id);
              if (cIds.filter(Boolean).length <= 1) return null;
              return (
                <div style={{ padding: '0 24px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '20px', overflowX: 'auto' }}>
                  {[
                    ...cIds.filter(Boolean).map(id => ({ id, name: cameras?.find(c => (c.id || c._id) === id)?.name || id })),
                    { id: 'overall', name: 'Overall Summary' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveProcessingTab(tab.id)}
                      style={{
                        background: 'none', border: 'none', borderBottom: activeProcessingTab === tab.id ? '2px solid #38bdf8' : '2px solid transparent',
                        color: activeProcessingTab === tab.id ? '#38bdf8' : '#94a3b8',
                        padding: '16px 0', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s'
                      }}
                    >
                      {tab.name}
                    </button>
                  ))}
                </div>
              );
            })()}
            
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {(() => {
                const rawCIds = Array.isArray(currentJobDetails.camera_ids) ? currentJobDetails.camera_ids : [currentJobDetails.camera_id || currentJobDetails.camera_ids];
                const cIds = rawCIds.map(id => Array.isArray(id) ? id[0] : id);
                const isMultiCam = cIds.filter(Boolean).length > 1;
                const showOverall = !isMultiCam || activeProcessingTab === 'overall';
                const showCameraTimeline = isMultiCam && activeProcessingTab !== 'overall';
                return (
                  <>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                      {(() => {
                        const dispStatus = (activeProcessingTab !== 'overall' && currentJobDetails.status_by_camera?.[activeProcessingTab]) 
                          ? currentJobDetails.status_by_camera[activeProcessingTab] 
                          : currentJobDetails.status;
                        const dispProgress = (activeProcessingTab !== 'overall' && currentJobDetails.progress_by_camera?.[activeProcessingTab] !== undefined)
                          ? currentJobDetails.progress_by_camera[activeProcessingTab]
                          : currentJobDetails.progress;
                        
                        let dispProcessed, dispTotal;
                        if (activeProcessingTab !== 'overall') {
                          dispProcessed = (currentJobDetails.clip_details || []).filter(c => {
                            const cId = Array.isArray(c.camera_id) ? c.camera_id[0] : c.camera_id;
                            return c.status === 'completed' && !c.is_system && cId === activeProcessingTab;
                          }).length;
                          dispTotal = currentJobDetails.total_clips_by_camera?.[activeProcessingTab] || 0;
                        } else {
                          dispProcessed = (currentJobDetails.clip_details || []).filter(c => c.status === 'completed' && !c.is_system).length;
                          dispTotal = currentJobDetails.total_clips || 0;
                        }

                        return (
                          <>
                            <div style={{ flex: 1, background: 'var(--bg-base)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                              <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#ffffff' }}>{activeProcessingTab === 'overall' ? 'Overall Status' : 'Status'}</p>
                              <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: dispStatus === 'completed' ? '#10b981' : dispStatus === 'failed' ? '#ef4444' : '#38bdf8' }}>
                                {(dispStatus || 'unknown').toUpperCase()}
                              </p>
                              {dispStatus === 'failed' && (currentJobDetails.error_message || currentJobDetails.reason) && (
                                <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: '#ef4444', wordBreak: 'break-word', display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
                                  <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>info</span>
                                  <span>
                                    {(currentJobDetails.error_message || currentJobDetails.reason).split('| TB:')[0].trim()}
                                  </span>
                                </p>
                              )}
                            </div>
                            <div style={{ flex: 1, background: 'var(--bg-base)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                              <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#ffffff' }}>Progress</p>
                              <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: '#f8fafc' }}>
                                {Math.round(dispProgress || 0)}%
                              </p>
                            </div>
                            <div style={{ flex: 1, background: 'var(--bg-base)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                              <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: '#ffffff' }}>Videos Processed</p>
                              <p style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 'bold', color: '#f8fafc' }}>
                                {dispProcessed} / {dispTotal}
                              </p>
                              {activeProcessingTab === 'overall' && currentJobDetails.total_clips_by_camera && Object.entries(currentJobDetails.total_clips_by_camera).map(([cid, total]) => {
                                const camName = cameras?.find(c => (c.id || c._id) === cid)?.name || cid;
                                const processed = (currentJobDetails.clip_details || []).filter(c => {
                                  const cId = Array.isArray(c.camera_id) ? c.camera_id[0] : c.camera_id;
                                  return c.status === 'completed' && !c.is_system && cId === cid;
                                }).length;
                                return (
                                  <p key={cid} style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#ffffff' }}>
                                    <span style={{ color: '#38bdf8' }}>{camName}</span>: {processed} / {total}
                                  </p>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    {(!isMultiCam || showCameraTimeline) && (
                      <div>
                        <h4 style={{ margin: '0 0 12px 0', color: '#e2e8f0', fontSize: '1.05rem' }}>Timeline</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {(currentJobDetails.clip_details || []).filter(clip => {
                            const clipCId = Array.isArray(clip.camera_id) ? clip.camera_id[0] : clip.camera_id;
                            return !isMultiCam || clipCId === activeProcessingTab;
                          }).map((clip, idx) => {
                            const clipCId = Array.isArray(clip.camera_id) ? clip.camera_id[0] : clip.camera_id;
                            const camName = cameras?.find(c => (c.id || c._id) === clipCId)?.name || clipCId;
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
                                    {clip.is_system ? clip.task_name : `Video Time: ${clip.timestamp !== 'Unknown' ? new Date(clip.timestamp).toLocaleString(undefined, { hour12: false }) : 'Unknown'}`}
                                  </p>
                                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#ffffff' }}>
                                    {clip.is_system ? 'System Process' : `Camera: ${camName}`}
                                  </p>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <p style={{ margin: '0 0 4px 0', fontSize: '0.9rem', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                                    <span className="material-icons-outlined" style={{ color: '#38bdf8', fontSize: '1rem' }}>directions_run</span>
                                    {(() => {
                                      if (clip.is_system && clip.task_name === 'Deduplication & Finalizing' && clip.status === 'completed') {
                                        const finalCount = currentJobDetails.objects?.length || 0;
                                        let rawCount = 0;
                                        (currentJobDetails.clip_details || []).forEach(c => {
                                          if (typeof c.objects_detected === 'number') {
                                            rawCount += c.objects_detected;
                                          } else if (typeof c.faces_detected === 'number') {
                                            rawCount += c.faces_detected;
                                          }
                                        });
                                        const duplicates = rawCount - finalCount;
                                        return duplicates > 0 ? `-${duplicates} Merged` : '0 Merged';
                                      }
                                      const count = clip.objects_detected !== undefined ? clip.objects_detected : clip.faces_detected;
                                      return clip.is_system && count === '-' ? '- Objects' : `${count !== undefined ? count : 0} Objects`;
                                    })()}
                                  </p>
                                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#ffffff' }}>
                                    Time taken: {clip.time_taken_s !== null && clip.time_taken_s !== undefined ? new Date(clip.time_taken_s * 1000).toISOString().substring(11, 19) : '...'}
                                  </p>
                                  {!clip.is_system && clip.video_duration_s != null && (
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#ffffff' }}>
                                      Video duration: {new Date(clip.video_duration_s * 1000).toISOString().substring(11, 19)}
                                    </p>
                                  )}
                                  {!clip.is_system && clip.processed_duration_str && (
                                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#38bdf8' }}>
                                      Processed: {clip.processed_duration_str}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {(currentJobDetails.clip_details || []).filter(clip => {
                            const clipCId = Array.isArray(clip.camera_id) ? clip.camera_id[0] : clip.camera_id;
                            return !isMultiCam || clipCId === activeProcessingTab;
                          }).length === 0 && (
                            <div style={{ textAlign: 'center', padding: '20px', color: '#ffffff', background: 'var(--bg-base)', borderRadius: '8px', border: '1px dashed var(--border)' }}>
                              Preparing background processes...
                            </div>
                          )}
                        </div>
                      </div>
                    )}

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
                                <div style={{ fontSize: '0.85rem', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentJobDetails.range_start ? new Date(currentJobDetails.range_start.includes('Z') || currentJobDetails.range_start.includes('+') ? currentJobDetails.range_start : currentJobDetails.range_start + '+05:30').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A'}</div>
                              </div>
                              <div>
                                <div style={{ color: '#64748b', fontSize: '0.7rem', marginBottom: '2px' }}>TO</div>
                                <div style={{ fontSize: '0.85rem', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentJobDetails.range_end ? new Date(currentJobDetails.range_end.includes('Z') || currentJobDetails.range_end.includes('+') ? currentJobDetails.range_end : currentJobDetails.range_end + '+05:30').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A'}</div>
                              </div>
                            </div>
                          </div>

                          <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span className="material-icons-outlined" style={{ fontSize: '18px' }}>videocam</span>
                              </div>
                              <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 }}>Sources</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div style={{ fontSize: '0.9rem', color: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#64748b' }}>Camera</span>
                                <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100px' }} title={(() => {
                                  if (activeProcessingTab !== 'overall') return cameras?.find(c => (c.id || c._id) === activeProcessingTab)?.name || activeProcessingTab;
                                  if (Array.isArray(currentJobDetails.camera_ids)) return currentJobDetails.camera_ids.map(id => cameras?.find(c => (c.id || c._id) === id)?.name || id).join(', ');
                                  const cId = currentJobDetails.camera_id || currentJobDetails.camera_ids;
                                  return cameras?.find(c => (c.id || c._id) === cId)?.name || cId || 'Unknown';
                                })()}>{(() => {
                                  if (activeProcessingTab !== 'overall') return cameras?.find(c => (c.id || c._id) === activeProcessingTab)?.name || activeProcessingTab;
                                  if (Array.isArray(currentJobDetails.camera_ids)) return currentJobDetails.camera_ids.map(id => cameras?.find(c => (c.id || c._id) === id)?.name || id).join(', ');
                                  const cId = currentJobDetails.camera_id || currentJobDetails.camera_ids;
                                  return cameras?.find(c => (c.id || c._id) === cId)?.name || cId || 'Unknown';
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
                                <span style={{ color: '#64748b' }}>Total Video Length</span>
                                <span style={{ fontWeight: 500 }}>{(() => {
                                  let lenS;
                                  if (activeProcessingTab !== 'overall' && currentJobDetails.metrics_by_camera) {
                                      lenS = currentJobDetails.metrics_by_camera[activeProcessingTab]?.total_video_duration_s;
                                  } else {
                                      lenS = currentJobDetails.metrics?.original_duration_s || currentJobDetails.total_video_duration_s;
                                  }
                                  if (!lenS) return 'N/A';
                                  return new Date(lenS * 1000).toISOString().substring(11, 19);
                                })()}</span>
                              </div>
                              <div style={{ fontSize: '0.9rem', color: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#64748b' }}>Processed Video Length</span>
                                <span style={{ fontWeight: 500, color: '#38bdf8' }}>{(() => {
                                  const clipsToSum = (activeProcessingTab === 'overall')
                                    ? (currentJobDetails.clip_details || [])
                                    : (currentJobDetails.clip_details || []).filter(c => {
                                        const cId = Array.isArray(c.camera_id) ? c.camera_id[0] : c.camera_id;
                                        return cId === activeProcessingTab;
                                      });
                                  const processedSeconds = clipsToSum.reduce((acc, clip) => {
                                    if (clip.processed_duration_s !== undefined) {
                                      return acc + clip.processed_duration_s;
                                    }
                                    if (clip.processed_duration_str) {
                                      const match = clip.processed_duration_str.match(/^(\d+)\s+seconds/);
                                      if (match) return acc + parseInt(match[1], 10);
                                    }
                                    return acc;
                                  }, 0);
                                  if (!processedSeconds) return 'N/A';
                                  return new Date(processedSeconds * 1000).toISOString().substring(11, 19);
                                })()}</span>
                              </div>
                              <div style={{ fontSize: '0.9rem', color: '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#64748b' }}>Processing Time</span>
                                <span style={{ fontWeight: 600, color: '#8b5cf6' }}>{(() => {
                                  if (activeProcessingTab !== 'overall') {
                                      const clipsToSum = (currentJobDetails.clip_details || []).filter(c => {
                                          const cId = Array.isArray(c.camera_id) ? c.camera_id[0] : c.camera_id;
                                          return cId === activeProcessingTab;
                                      });
                                      const totalSeconds = clipsToSum.reduce((acc, clip) => acc + (clip.time_taken_s || 0), 0);
                                      return new Date(totalSeconds * 1000).toISOString().substring(11, 19);
                                  } else {
                                      const cTime = currentJobDetails.created_at;
                                      const fTime = currentJobDetails.completed_at;
                                      if (!cTime || !fTime) return 'N/A';
                                      const t = Math.max(0, (new Date(fTime) - new Date(cTime)) / 1000);
                                      return new Date(t * 1000).toISOString().substring(11, 19);
                                  }
                                })()}</span>
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
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

      {/* ── Create New Summary Modal ── */}
      {/* ── Add Video Multi-Step Modal ── */}
      {/* Share Multicam URLs Modal */}
      {shareModalGroup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999999 }} onClick={() => setShareModalGroup(null)}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', width: '400px', maxWidth: '90%', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Share Camera Videos</h3>
              <button onClick={() => setShareModalGroup(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
                <span className="material-icons-outlined">close</span>
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto' }}>
              {shareModalGroup.map(j => {
                const cId = Array.isArray(j.camera_id) ? j.camera_id[0] : j.camera_id;
                const camInfo = cameras?.find(c => (c.id || c._id) === cId);
                const camName = camInfo?.name || cId;
                const url = j.output_video_url ? `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005${j.output_video_url}` : null;
                return (
                  <div key={j.job_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg-base)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{camName}</span>
                    <button
                      onClick={() => {
                        if (url) {
                          navigator.clipboard.writeText(url).then(() => setToastMessage("Copied " + camName + " URL")).catch(() => setToastMessage("Failed to copy"));
                        } else {
                          setToastMessage("Video not available for " + camName);
                        }
                      }}
                      style={{ background: 'var(--bg-active)', border: '1px solid var(--border)', color: url ? 'var(--text-primary)' : 'var(--text-muted)', padding: '6px 12px', borderRadius: '4px', cursor: url ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
                    >
                      <span className="material-icons-outlined" style={{ fontSize: '1rem' }}>content_copy</span>
                      Copy
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showAddVideoModal && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999998
          }}
          onClick={() => setShowAddVideoModal(false)}
        >
          <div
            style={{
              background: '#111418', border: '1px solid var(--border)',
              borderRadius: '4px', width: '740px', maxWidth: '96vw',
              maxHeight: '90vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 30px 70px rgba(0,0,0,0.7)'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '0.04em' }}>ADD VIDEO</h3>
                <p style={{ margin: '3px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {addVideoStep === 1 ? 'Time Range' : addVideoStep === 2 ? 'Camera Selection' : 'Direction (Optional)'}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {[{ n: 1, label: 'Time\nRange' }, { n: 2, label: 'Camera\nSelection' }, { n: 3, label: 'Direction\n(Optional)' }].map(s => (
                  <div key={s.n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', cursor: 'pointer', opacity: addVideoStep === s.n ? 1 : 0.5 }}
                    onClick={() => { if (s.n < addVideoStep) setAddVideoStep(s.n); }}>
                    <div style={{
                      width: '26px', height: '26px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700,
                      background: addVideoStep >= s.n ? '#0284c7' : 'rgba(255,255,255,0.1)',
                      color: addVideoStep >= s.n ? '#fff' : 'var(--text-muted)',
                      border: addVideoStep === s.n ? '2px solid #38bdf8' : '2px solid transparent'
                    }}>{s.n}</div>
                    <span style={{ fontSize: '0.6rem', color: addVideoStep === s.n ? '#38bdf8' : 'var(--text-muted)', textAlign: 'center', whiteSpace: 'pre-line', lineHeight: '1.2' }}>{s.label}</span>
                  </div>
                ))}
                <button onClick={() => setShowAddVideoModal(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', marginLeft: '8px' }}>
                  <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>close</span>
                </button>
              </div>
            </div>

            {/* Source tabs */}
            <div style={{ borderBottom: '1px solid var(--border)', display: 'flex' }}>
              {['CAMERAS', 'FILES', 'NETWORK'].map(tab => (
                <button key={tab} onClick={() => setAddVideoSourceTab(tab)}
                  style={{
                    background: 'none', border: 'none', padding: '10px 24px',
                    fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.04em',
                    color: addVideoSourceTab === tab ? '#38bdf8' : 'var(--text-muted)',
                    borderBottom: addVideoSourceTab === tab ? '2px solid #38bdf8' : '2px solid transparent',
                    marginBottom: '-1px'
                  }}>{tab}</button>
              ))}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflow: 'auto', minHeight: '260px' }}>

              {/* Step 1: Time Range */}
              {addVideoStep === 1 && (
                <div style={{ padding: '36px 40px', display: 'flex', alignItems: 'flex-start', gap: '48px' }}>
                  <div>
                    <p style={{ margin: '0 0 10px', fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>FROM</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <input type="date" value={addVideoFromDate} onChange={e => setAddVideoFromDate(e.target.value)}
                        style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: '#f8fafc', fontSize: '0.9rem', outline: 'none', padding: '2px 0', colorScheme: 'dark', minWidth: '120px' }} />
                      <input type="time" value={addVideoFromTime} onChange={e => setAddVideoFromTime(e.target.value)}
                        style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: '#f8fafc', fontSize: '0.9rem', outline: 'none', padding: '2px 0', colorScheme: 'dark', width: '80px' }} />
                    </div>
                  </div>
                  <div>
                    <p style={{ margin: '0 0 10px', fontSize: '0.7rem', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>TO</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <input type="date" value={addVideoToDate} onChange={e => setAddVideoToDate(e.target.value)}
                        style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: '#f8fafc', fontSize: '0.9rem', outline: 'none', padding: '2px 0', colorScheme: 'dark', minWidth: '120px' }} />
                      <input type="time" value={addVideoToTime} onChange={e => setAddVideoToTime(e.target.value)}
                        style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: '#f8fafc', fontSize: '0.9rem', outline: 'none', padding: '2px 0', colorScheme: 'dark', width: '80px' }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Camera Selection */}
              {addVideoStep === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '340px' }}>
                  <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="text" placeholder="Search..." value={addVideoCameraSearch} onChange={e => setAddVideoCameraSearch(e.target.value)}
                      style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#f8fafc', fontSize: '0.88rem', padding: '4px 0' }} />
                    <span className="material-icons-outlined" style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>search</span>
                  </div>
                  <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                    <div style={{ width: '130px', borderRight: '1px solid var(--border)', padding: '12px 0', flexShrink: 0 }}>
                      <p style={{ margin: '0 0 8px 12px', fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>DIRECTORY</p>
                      <div style={{ padding: '6px 12px', fontSize: '0.82rem', color: '#38bdf8', background: 'rgba(56,189,248,0.08)' }}>127.0.0.1</div>
                    </div>
                    <div style={{ flex: 1, overflow: 'auto', padding: '12px 0' }}>
                      <p style={{ margin: '0 0 8px 16px', fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>CAMERAS</p>
                      {(cameras || [])
                        .filter(c => !addVideoCameraSearch || (c.name || '').toLowerCase().includes(addVideoCameraSearch.toLowerCase()))
                        .map(c => {
                          const cid = c.id || c._id;
                          const checked = addVideoSelectedCams.includes(cid);
                          return (
                            <div key={cid}
                              onClick={() => setAddVideoSelectedCams(prev => checked ? prev.filter(x => x !== cid) : [...prev, cid])}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 16px',
                                cursor: 'pointer', background: checked ? 'rgba(56,189,248,0.1)' : 'transparent',
                                borderBottom: '1px solid rgba(255,255,255,0.03)',
                                color: checked ? '#f8fafc' : 'var(--text-muted)', fontSize: '0.84rem'
                              }}>
                              <input type="checkbox" checked={checked} readOnly style={{ accentColor: '#38bdf8', cursor: 'pointer', flexShrink: 0 }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || cid}</span>
                            </div>
                          );
                        })}
                      {(cameras || []).filter(c => !addVideoCameraSearch || (c.name || '').toLowerCase().includes(addVideoCameraSearch.toLowerCase())).length === 0 && (
                        <div style={{ padding: '20px 16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No cameras found.</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Direction (optional) */}
              {addVideoStep === 3 && (
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '10px', height: '340px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div>
                      <p style={{ margin: '0 0 4px', fontSize: '0.8rem', color: '#f8fafc', fontWeight: 600 }}>Filter by Direction (Optional)</p>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Draw an arrow below to only include objects moving in that direction, or skip and submit.
                      </p>
                    </div>
                    {directionAngle !== null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#38bdf8' }}>
                          <span className="material-icons-outlined" style={{ fontSize: '0.9rem', verticalAlign: 'middle', marginRight: '2px' }}>explore</span>
                          {directionAngle.toFixed(1)}°
                        </span>
                        <button type="button" onClick={clearDirection} style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span className="material-icons-outlined" style={{ fontSize: '0.8rem' }}>clear</span> Clear
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, minHeight: 0, position: 'relative', width: '100%', backgroundColor: 'var(--bg-active)', border: directionAngle !== null ? '1px solid #38bdf8' : '1px dashed var(--border)', borderRadius: '8px', overflow: 'hidden', boxShadow: directionAngle !== null ? '0 0 0 2px rgba(56, 189, 248, 0.2)' : 'none', transition: 'all 0.2s' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1, display: 'grid', gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(addVideoSelectedCams.length || 1))}, 1fr)`, gap: '2px', background: '#000' }}>
                      {addVideoSelectedCams.map(camId => (
                        addVideoLiveSnapshots[camId] && <img key={camId} src={addVideoLiveSnapshots[camId]} alt="cam" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(4px) brightness(0.45)', transform: 'scale(1.06)' }} />
                      ))}
                    </div>
                    {addVideoSelectedCams.some(id => addVideoLiveSnapshots[id]) && (
                      <div style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'rgba(0,0,0,0.35)', pointerEvents: 'none' }} />
                    )}
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
              )}
            </div>

            {/* Footer */}
            <div style={{ borderTop: '1px solid var(--border)' }}>
              <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ height: '100%', width: `${(addVideoStep / 3) * 100}%`, background: '#ef4444', transition: 'width 0.3s' }} />
              </div>
              <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => addVideoStep === 1 ? setShowAddVideoModal(false) : setAddVideoStep(addVideoStep - 1)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, letterSpacing: '0.06em' }}>
                  {addVideoStep === 1 ? 'CANCEL' : 'PREV'}
                </button>
                {addVideoStep === 1 && (
                  <button onClick={() => setAddVideoStep(2)}
                    style={{ background: '#0284c7', color: 'white', border: 'none', padding: '7px 20px', borderRadius: '4px', fontSize: '0.82rem', fontWeight: 600, letterSpacing: '0.06em', cursor: 'pointer' }}>
                    NEXT
                  </button>
                )}
                {addVideoStep === 2 && (
                  <button
                    onClick={() => {
                      if (addVideoSelectedCams.length === 0) { setToastMessage('Select at least one camera.'); return; }
                      setAddVideoStep(3);
                    }}
                    disabled={addVideoSelectedCams.length === 0}
                    style={{
                      background: addVideoSelectedCams.length === 0 ? 'rgba(2,132,199,0.3)' : '#0284c7',
                      color: 'white', border: 'none', padding: '7px 20px',
                      borderRadius: '4px', fontSize: '0.82rem', fontWeight: 600, letterSpacing: '0.06em',
                      cursor: addVideoSelectedCams.length === 0 ? 'not-allowed' : 'pointer'
                    }}>NEXT</button>
                )}
                {addVideoStep === 3 && (
                  <button
                    onClick={async () => {
                      if (addVideoSelectedCams.length === 0) { setToastMessage('Select at least one camera.'); return; }
                      const fromISO = `${addVideoFromDate}T${addVideoFromTime || '00:00'}`;
                      const toISO = `${addVideoToDate}T${addVideoToTime || '23:59'}`;
                      setSelectedCameras(addVideoSelectedCams);
                      setRangeStart(fromISO);
                      setRangeEnd(toISO);
                      setShowAddVideoModal(false);
                      // Direction is optional: startPoint/endPoint (if the user drew
                      // an arrow on Step 3) are already picked up inside
                      // handleGenerateSynopsis, no extra wiring needed here.
                      setTimeout(() => handleGenerateSynopsis(addVideoJob?.job_name || '', { description: addVideoJob?.description || '', incidentTime: addVideoJob?.incident_time || '' }), 80);
                      // Remove the local no_video card if it exists
                      if (addVideoJob?._local) {
                        setJobHistory(prev => prev.filter(j => j.job_id !== addVideoJob.job_id));
                      }
                    }}
                    disabled={addVideoSelectedCams.length === 0}
                    style={{
                      background: addVideoSelectedCams.length === 0 ? 'rgba(2,132,199,0.3)' : '#0284c7',
                      color: 'white', border: 'none', padding: '7px 20px',
                      borderRadius: '4px', fontSize: '0.82rem', fontWeight: 600, letterSpacing: '0.06em',
                      cursor: addVideoSelectedCams.length === 0 ? 'not-allowed' : 'pointer'
                    }}>SUBMIT</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999999
          }}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            style={{
              background: '#0d1117', border: '1px solid var(--border)',
              borderRadius: '4px', width: '480px', maxWidth: '95vw',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 25px 60px rgba(0,0,0,0.7)'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '0.04em' }}>
                  CREATE A NEW SUMMARY
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Please fill in the fields below
                </p>
              </div>
              <button onClick={() => setShowCreateModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', marginTop: '2px', padding: '2px' }}>
                <span className="material-icons-outlined" style={{ fontSize: '1.2rem' }}>close</span>
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: '0' }}>

              {/* Title */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Title</label>
                <div style={{ borderBottom: '2px solid #0284c7' }}>
                  <input
                    autoFocus
                    type="text"
                    value={createTitle}
                    onChange={e => setCreateTitle(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createTitle.trim() && (() => {
                      const id = `local-${Date.now()}`;
                      setJobHistory(prev => [{ job_id: id, job_name: createTitle.trim(), description: createDescription.trim(), incident_time: createIncidentDate && createIncidentTime ? (createIncidentDate + ' ' + createIncidentTime) : (createIncidentDate || ''), status: 'no_video', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _local: true }, ...prev]);
                      setShowCreateModal(false); setCreateTitle(''); setCreateDescription(''); setCreateIncidentDate(''); setCreateIncidentTime('');
                    })()}
                    style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: '#f8fafc', fontSize: '0.9rem', padding: '4px 0', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Description */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={createDescription}
                    onChange={e => setCreateDescription(e.target.value)}
                    style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: '#f8fafc', fontSize: '0.9rem', padding: '4px 0', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Incident Time */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: '148px' }}>
                  Incident Time (optional)
                </span>
                <input type="date" value={createIncidentDate} onChange={e => setCreateIncidentDate(e.target.value)}
                  style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)', fontSize: '0.85rem', outline: 'none', padding: '2px 0', colorScheme: 'dark', flex: 1 }} />
                <input type="time" value={createIncidentTime} onChange={e => setCreateIncidentTime(e.target.value)}
                  style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-muted)', fontSize: '0.85rem', outline: 'none', padding: '2px 0', colorScheme: 'dark', width: '80px' }} />
              </div>

            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.3)' }}>
              <button onClick={() => setShowCreateModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, letterSpacing: '0.06em' }}>
                CANCEL
              </button>
              <button
                onClick={() => {
                  const id = `local-${Date.now()}`;
                  setJobHistory(prev => [{ job_id: id, job_name: createTitle.trim() || 'Untitled Summary', description: createDescription.trim(), incident_time: createIncidentDate && createIncidentTime ? (createIncidentDate + ' ' + createIncidentTime) : (createIncidentDate || ''), status: 'no_video', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _local: true }, ...prev]);
                  setShowCreateModal(false);
                  setCreateTitle(''); setCreateDescription(''); setCreateIncidentDate(''); setCreateIncidentTime('');
                }}
                style={{ background: '#0284c7', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '4px', fontSize: '0.82rem', fontWeight: 600, letterSpacing: '0.06em', cursor: 'pointer' }}
              >
                CREATE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}