import os
import requests
from typing import List, Dict, Any, Optional
from app.core.database import cameras_col

MEDIAMTX_API = os.environ.get("MEDIAMTX_API_URL", "http://localhost:9997")
RTSP_BASE_URL = os.environ.get("RTSP_BASE_URL", "rtsp://127.0.0.1:8554")

class CameraLoadGenerator:
    """
    Manages isolated, cloned MediaMTX stream paths and simulated camera records.
    Guarantees:
      - Physical source streams are ingested only once.
      - Every test stream is tagged with test_run_id.
      - Cleanup is strictly scoped to the test run ID.
      - Original production cameras are never modified or deleted.
    """

    def __init__(self, api_url: str = MEDIAMTX_API):
        self.api_url = api_url.rstrip("/")

    def get_available_source_streams(self) -> List[str]:
        """Discover live, ready MediaMTX paths to use as clone source bases."""
        try:
            res = requests.get(f"{self.api_url}/v3/paths/list", timeout=3)
            if res.status_code == 200:
                data = res.json()
                items = data.get("items", [])
                ready_paths = [
                    item["name"] for item in items 
                    if item.get("ready") and not item["name"].startswith("test_")
                ]
                if ready_paths:
                    return ready_paths
        except Exception as e:
            print(f"[LOAD-GEN] Error fetching MediaMTX paths: {e}")

        # Fallback to existing cameras in MongoDB
        if cameras_col is not None:
            try:
                cams = list(cameras_col.find(
                    {"is_deleted": {"$ne": True}, "is_test_stream": {"$ne": True}}, 
                    {"stream_key": 1}
                ))
                keys = [c["stream_key"] for c in cams if c.get("stream_key")]
                if keys:
                    return keys
            except Exception:
                pass

        # Default fallback stream path
        return ["default_source"]

    def get_detected_camera_profile(self) -> Dict[str, Any]:
        """Detects codec, resolution, and fps dynamically from existing physical camera in MongoDB."""
        if cameras_col is not None:
            try:
                cam = cameras_col.find_one({"is_deleted": {"$ne": True}, "is_test_stream": {"$ne": True}})
                if cam:
                    profiles = cam.get("stream_profiles") or []
                    main_prof = next((p for p in profiles if p.get("label") == "MAIN" or p.get("token") == "0"), profiles[0] if profiles else {})
                    codec = cam.get("codec") or cam.get("live_codec") or main_prof.get("encoding") or "H.264"
                    res = main_prof.get("resolution") or cam.get("resolution") or "1080p (1920x1080)"
                    fps = main_prof.get("fps") or cam.get("fps") or 20
                    bitrate = main_prof.get("bitrate") or cam.get("bitrate") or 4096
                    return {
                        "detected": True,
                        "camera_name": cam.get("name") or cam.get("device_name", "Physical Camera"),
                        "codec": codec,
                        "resolution": res,
                        "fps": int(fps),
                        "bitrate_kbps": int(bitrate) if bitrate < 100000 else 4096
                    }
            except Exception as e:
                print(f"[LOAD-GEN] Error detecting physical camera profile: {e}")
        return {
            "detected": False,
            "camera_name": "Default Simulator",
            "codec": "H.264",
            "resolution": "1080p (1920x1080)",
            "fps": 20,
            "bitrate_kbps": 4096
        }

    def provision_test_streams(
        self,
        run_id: str,
        target_count: int,
        upstream_sources: Optional[List[str]] = None,
        profile: Optional[Dict[str, Any]] = None,
        enable_recording: bool = True
    ) -> Dict[str, Any]:
        """
        Creates target_count test paths in MediaMTX and registers them in MongoDB.
        Uses loopback RTSP sourcing so no extra requests hit physical cameras.
        Persists exact codec, resolution, and fps for each camera.
        """
        if target_count <= 0:
            return {"provisioned": 0, "paths": [], "errors": []}

        sources = upstream_sources or self.get_available_source_streams()
        num_sources = len(sources)

        prof = profile or {"codec": "H.264", "resolution": "1080p", "fps": 25, "bitrate_kbps": 4096}
        codec_name = prof.get("codec", "H.264")
        resolution_str = prof.get("resolution", "1080p")
        fps_val = prof.get("fps", 25)
        bitrate_val = prof.get("bitrate_kbps", 4096)

        created_paths: List[str] = []
        errors: List[str] = []

        for i in range(1, target_count + 1):
            stream_key = f"test_{run_id}_cam_{i}"
            chosen_source = sources[(i - 1) % num_sources]
            source_url = f"{RTSP_BASE_URL}/{chosen_source}"

            # 1. Register in MediaMTX via v3 REST API
            payload = {
                "source": source_url,
                "sourceOnDemand": False
            }
            try:
                # Add path
                res = requests.post(
                    f"{self.api_url}/v3/config/paths/add/{stream_key}",
                    json=payload,
                    timeout=5
                )
                if res.status_code not in [200, 201]:
                    # If already exists, patch source
                    patch_res = requests.patch(
                        f"{self.api_url}/v3/config/paths/patch/{stream_key}",
                        json=payload,
                        timeout=5
                    )
                    if patch_res.status_code not in [200, 201]:
                        errors.append(f"MediaMTX path error {stream_key}: {res.text}")
            except Exception as e:
                errors.append(f"MediaMTX API error {stream_key}: {str(e)}")

            # 2. Register Test Camera Document in MongoDB
            if cameras_col is not None:
                try:
                    sim_ip = f"10.254.{(i // 250) + 1}.{(i % 250) + 1}"
                    cam_doc = {
                        "stream_key": stream_key,
                        "name": f"Simulated Feed #{i} ({run_id})",
                        "device_name": f"Simulated Feed #{i}",
                        "ip": sim_ip,
                        "ip_address": sim_ip,
                        "port": 8554,
                        "rtsp_url": f"{RTSP_BASE_URL}/{stream_key}",
                        "recording_rtsp": f"{RTSP_BASE_URL}/{stream_key}" if enable_recording else None,
                        "sub_stream_rtsp": f"{RTSP_BASE_URL}/{stream_key}",
                        "enabled": True,
                        "recording_enabled": enable_recording,
                        "manufacturer": "Mirador Performance Lab",
                        "model": "Cloned Stream Simulator",
                        "test_run_id": run_id,
                        "is_test_stream": True,
                        "source_upstream_path": chosen_source,
                        "codec": codec_name,
                        "resolution": resolution_str,
                        "fps": fps_val,
                        "bitrate_kbps": bitrate_val,
                        "stream_bitrate_mbps": round(bitrate_val / 1000, 2),
                        "status": "streaming"
                    }
                    cameras_col.update_one(
                        {"stream_key": stream_key},
                        {"$set": cam_doc},
                        upsert=True
                    )
                    created_paths.append(stream_key)
                except Exception as e:
                    errors.append(f"MongoDB camera insert error {stream_key}: {str(e)}")
            else:
                created_paths.append(stream_key)

        return {
            "provisioned": len(created_paths),
            "paths": created_paths,
            "errors": errors
        }

    def cleanup_test_run(self, run_id: str) -> Dict[str, Any]:
        """
        Safely removes all test streams and database records tagged with test_run_id.
        Never modifies physical cameras or production recordings.
        """
        deleted_paths: List[str] = []
        errors: List[str] = []

        # 1. Find all test cameras for this run
        test_stream_keys = []
        if cameras_col is not None:
            try:
                cams = list(cameras_col.find(
                    {"test_run_id": run_id, "is_test_stream": True},
                    {"stream_key": 1}
                ))
                test_stream_keys = [c["stream_key"] for c in cams if c.get("stream_key")]
            except Exception as e:
                errors.append(f"Failed querying MongoDB test cameras: {e}")

        # Also check MediaMTX directly for paths matching test_{run_id}_*
        try:
            res = requests.get(f"{self.api_url}/v3/paths/list", timeout=3)
            if res.status_code == 200:
                for item in res.json().get("items", []):
                    name = item.get("name", "")
                    if name.startswith(f"test_{run_id}_") and name not in test_stream_keys:
                        test_stream_keys.append(name)
        except Exception:
            pass

        # 2. Delete paths from MediaMTX
        for key in test_stream_keys:
            try:
                del_res = requests.delete(
                    f"{self.api_url}/v3/config/paths/delete/{key}",
                    timeout=3
                )
                if del_res.status_code in [200, 201, 404]:
                    deleted_paths.append(key)
                else:
                    errors.append(f"Failed deleting path {key}: {del_res.text}")
            except Exception as e:
                errors.append(f"MediaMTX delete exception {key}: {e}")

        # 3. Clean records from MongoDB
        db_removed = 0
        if cameras_col is not None:
            try:
                res = cameras_col.delete_many({"test_run_id": run_id, "is_test_stream": True})
                db_removed = res.deleted_count
            except Exception as e:
                errors.append(f"Failed removing test cameras from DB: {e}")

        return {
            "success": len(errors) == 0,
            "deleted_paths_count": len(deleted_paths),
            "db_records_removed": db_removed,
            "errors": errors
        }

load_generator = CameraLoadGenerator()
