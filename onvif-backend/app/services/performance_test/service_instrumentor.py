import os
import requests
import time
from typing import Dict, Any, List, Optional
from app.core.database import db, recordings_col
from app.utils.minio_client import minio_client, MINIO_BUCKET

MEDIAMTX_API = os.environ.get("MEDIAMTX_API_URL", "http://localhost:9997")

class ServiceInstrumentor:
    """
    Instruments active VMS subsystems:
      - MediaMTX active publishers, readers, throughput, and packet health.
      - Recording segment completion rates and failures.
      - Encryption queue and throughput.
      - MinIO replication and backlog.
    """

    def __init__(self, mediamtx_url: str = MEDIAMTX_API):
        self.mediamtx_url = mediamtx_url.rstrip("/")

    def sample_mediamtx(self, run_id: Optional[str] = None) -> Dict[str, Any]:
        """Queries MediaMTX v3 API for live stream health."""
        telemetry = {
            "online": False,
            "total_paths": 0,
            "ready_paths": 0,
            "test_paths_active": 0,
            "active_readers": 0,
            "bytes_received": 0,
            "bytes_sent": 0,
            "packets_lost": 0,
            "frames_discarded": 0
        }
        try:
            # 1. Query Paths with itemsPerPage=1000 and multi-page collection
            res = requests.get(f"{self.mediamtx_url}/v3/paths/list?itemsPerPage=1000", timeout=5)
            if res.status_code == 200:
                data = res.json()
                items = data.get("items", [])
                page_count = data.get("pageCount", 1)
                if page_count > 1:
                    for p in range(1, page_count):
                        try:
                            p_res = requests.get(f"{self.mediamtx_url}/v3/paths/list?page={p}&itemsPerPage=1000", timeout=5)
                            if p_res.status_code == 200:
                                items.extend(p_res.json().get("items", []))
                        except Exception:
                            pass

                telemetry["online"] = True
                telemetry["total_paths"] = len(items)
                
                ready_count = 0
                test_ready = 0
                rx_bytes = 0

                for item in items:
                    is_ready = bool(item.get("ready") or item.get("sourceReady"))
                    if is_ready:
                        ready_count += 1
                    rx_bytes += item.get("bytesReceived", 0)
                    name = item.get("name", "")
                    if run_id and name.startswith(f"test_{run_id}_") and is_ready:
                        test_ready += 1

                telemetry["ready_paths"] = ready_count
                telemetry["test_paths_active"] = test_ready
                telemetry["bytes_received"] = rx_bytes

            # 2. Query WebRTC & RTSP sessions for reader counts and packet drops
            res_webrtc = requests.get(f"{self.mediamtx_url}/v3/webrtcsessions/list", timeout=2)
            if res_webrtc.status_code == 200:
                sessions = res_webrtc.json().get("items", [])
                telemetry["active_readers"] += len(sessions)
                for s in sessions:
                    telemetry["bytes_sent"] += s.get("bytesSent", 0)
                    telemetry["packets_lost"] += s.get("rtpPacketsLost", 0)
                    telemetry["frames_discarded"] += s.get("outboundFramesDiscarded", 0)

            res_rtsp = requests.get(f"{self.mediamtx_url}/v3/rtspsessions/list", timeout=2)
            if res_rtsp.status_code == 200:
                rtsp_sessions = res_rtsp.json().get("items", [])
                telemetry["active_readers"] += len(rtsp_sessions)
                for s in rtsp_sessions:
                    telemetry["bytes_sent"] += s.get("bytesSent", 0)

        except Exception as e:
            telemetry["online"] = False

        return telemetry

    def sample_recording(self, run_id: Optional[str] = None) -> Dict[str, Any]:
        """Queries recording pipeline activity from MongoDB."""
        res = {
            "active_recorders": 0,
            "segments_completed": 0,
            "segments_failed": 0,
            "write_throughput_mb_s": 0.0
        }
        if recordings_col is not None:
            try:
                # Segments created in the current run or last 5 minutes
                query = {}
                if run_id:
                    query["test_run_id"] = run_id
                else:
                    five_mins_ago = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 300))
                    query["created_at"] = {"$gte": five_mins_ago}

                total_recs = recordings_col.count_documents(query)
                completed = recordings_col.count_documents({**query, "status": {"$in": ["COMPLETED", "SAVED", "ENCRYPTED"]}})
                active = recordings_col.count_documents({**query, "status": "RECORDING"})

                res["active_recorders"] = active
                res["segments_completed"] = completed
                res["segments_failed"] = max(0, total_recs - (completed + active))
            except Exception:
                pass
        return res

    def sample_encryption(self, run_id: Optional[str] = None) -> Dict[str, Any]:
        """Queries encryption pipeline status."""
        res = {
            "status": "Active",
            "files_encrypted": 0,
            "failures": 0,
            "queue_depth": 0
        }
        if recordings_col is not None:
            try:
                query = {}
                if run_id:
                    query["test_run_id"] = run_id
                encrypted = recordings_col.count_documents({**query, "status": "ENCRYPTED"})
                res["files_encrypted"] = encrypted
            except Exception:
                pass
        return res

    def sample_minio(self) -> Dict[str, Any]:
        """Queries MinIO connectivity and upload backlog."""
        online = False
        queue_count = 0
        try:
            if minio_client is not None:
                online = minio_client.bucket_exists(MINIO_BUCKET)
        except Exception:
            online = False

        if recordings_col is not None:
            try:
                # Backlog: recordings marked completed but not yet replicated
                queue_count = recordings_col.count_documents({"status": "SAVED", "replicated": {"$ne": True}})
            except Exception:
                pass

        return {
            "online": online,
            "upload_backlog": queue_count,
            "bucket": MINIO_BUCKET
        }

    def sample_all_services(self, run_id: Optional[str] = None) -> Dict[str, Any]:
        """Aggregates telemetry from all subsystems."""
        return {
            "mediamtx": self.sample_mediamtx(run_id=run_id),
            "recording": self.sample_recording(run_id=run_id),
            "encryption": self.sample_encryption(run_id=run_id),
            "minio": self.sample_minio()
        }

service_instrumentor = ServiceInstrumentor()
