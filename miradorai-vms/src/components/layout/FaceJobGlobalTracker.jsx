import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export default function FaceJobGlobalTracker() {
  const location = useLocation();
  const navigate = useNavigate();
  const [completionBanner, setCompletionBanner] = useState(null);
  const pollTimerRef = useRef(null);

  const SYNOPSIS_API = `http://${import.meta.env.VITE_API_HOST || 'localhost'}:8005`;

  const startPolling = (jobId) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);

    const checkJob = async () => {
      try {
        const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs/${jobId}`);
        if (!res.ok) {
          localStorage.removeItem('vms_active_face_job_id');
          return;
        }
        const data = await res.json();

        // Broadcast real-time update event to any active component
        window.dispatchEvent(new CustomEvent('vms-face-job-update', { detail: data }));

        if (data.status === "completed") {
          localStorage.removeItem('vms_active_face_job_id');
          localStorage.setItem('vms_last_completed_face_job_id', jobId);
          window.dispatchEvent(new CustomEvent('vms-face-job-completed', { detail: data }));

          // Show floating completion banner if user is currently on any other page
          const currentPath = (location?.pathname || '').replace(/^\/|\/$/g, '').toLowerCase();
          if (currentPath !== 'face-detection') {
            const faceCount = (data.faces || []).length;
            setCompletionBanner({
              jobId: data.job_id,
              jobName: data.job_name || "Face Detection Job",
              faceCount
            });
          }
        } else if (data.status === "failed" || data.status === "cancelled") {
          localStorage.removeItem('vms_active_face_job_id');
          window.dispatchEvent(new CustomEvent('vms-face-job-ended', { detail: data }));
        } else {
          // Job still queued or processing -> continue polling every 2.5s
          pollTimerRef.current = setTimeout(checkJob, 2500);
        }
      } catch (err) {
        // Network retry
        pollTimerRef.current = setTimeout(checkJob, 3500);
      }
    };

    checkJob();
  };

  useEffect(() => {
    const handleJobStarted = (e) => {
      const jobId = e.detail?.jobId || localStorage.getItem('vms_active_face_job_id');
      if (jobId) {
        startPolling(jobId);
      }
    };

    const handleJobCancelled = () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      localStorage.removeItem('vms_active_face_job_id');
    };

    window.addEventListener('vms-face-job-started', handleJobStarted);
    window.addEventListener('vms-face-job-cancelled', handleJobCancelled);

    // Initial check on mount
    const initialJobId = localStorage.getItem('vms_active_face_job_id');
    if (initialJobId) {
      startPolling(initialJobId);
    } else {
      // Check if server already has a job currently processing
      (async () => {
        try {
          const res = await fetch(`${SYNOPSIS_API}/a1/v1/synopsis/face-jobs`);
          if (res.ok) {
            const jobs = await res.json();
            const running = (jobs || []).find(j => j.status === 'processing' || j.status === 'queued');
            if (running) {
              localStorage.setItem('vms_active_face_job_id', running.job_id);
              startPolling(running.job_id);
            }
          }
        } catch (_) {}
      })();
    }

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      window.removeEventListener('vms-face-job-started', handleJobStarted);
      window.removeEventListener('vms-face-job-cancelled', handleJobCancelled);
    };
  }, []);

  // Auto-hide completion banner after 10 seconds
  useEffect(() => {
    if (completionBanner) {
      const timer = setTimeout(() => setCompletionBanner(null), 10000);
      return () => clearTimeout(timer);
    }
  }, [completionBanner]);

  if (!completionBanner) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      background: 'var(--bg-surface)',
      color: 'var(--text-primary)',
      padding: '14px 20px',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-lg)',
      border: '1px solid var(--border)',
      borderLeft: '4px solid var(--teal)',
      zIndex: 99999999,
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      animation: 'slideInRight 0.3s ease-out',
      minWidth: '320px',
      maxWidth: '460px'
    }}>
      <div style={{
        width: '38px', height: '38px', borderRadius: '50%',
        background: 'var(--teal-subtle)', color: 'var(--teal)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
      }}>
        <span className="material-icons-outlined" style={{ fontSize: '20px' }}>face</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
          Face Detection Completed
        </p>
        <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Found <strong style={{ color: 'var(--teal)' }}>{completionBanner.faceCount}</strong> detected {completionBanner.faceCount === 1 ? 'face' : 'faces'}
        </p>
      </div>
      <button
        onClick={() => {
          setCompletionBanner(null);
          navigate('/face-detection');
        }}
        style={{
          background: 'var(--teal)',
          color: '#ffffff',
          border: 'none',
          padding: '6px 14px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.82rem',
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'background 0.2s'
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--teal-dim)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--teal)'}
      >
        View Faces
      </button>
      <button
        onClick={() => setCompletionBanner(null)}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex' }}
        title="Dismiss"
      >
        <span className="material-icons-outlined" style={{ fontSize: '18px' }}>close</span>
      </button>
    </div>
  );
}
