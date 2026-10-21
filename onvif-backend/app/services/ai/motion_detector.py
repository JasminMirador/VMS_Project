import os
os.environ["OPENCV_OPENCL_RUNTIME"] = ""
os.environ["OPENCV_OPENCL_DEVICE"] = "disabled"
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;2000000"

import threading
import time
import cv2
cv2.ocl.setUseOpenCL(False)
import numpy as np
from app.core.database import mongo_client

# We will import recorder inside methods to avoid circular import issues
# if recorder imports motion_detector

MONGO_URI = os.environ["MONGO_URI"]

# Shared MongoDB client — reused across all motion detector threads
_shared_mongo = mongo_client
_db_name = os.environ.get("MONGO_DB_NAME")
_shared_db = _shared_mongo[_db_name]

class CameraMotionDetector(threading.Thread):
    def __init__(self, stream_name: str, rtsp_url: str, camera_data: dict):
        super().__init__(daemon=True, name=f"motion-detector-{stream_name}")
        self.stream_name = stream_name
        self.rtsp_url = rtsp_url
        self.camera_data = camera_data
        self.stop_event = threading.Event()
        self.motion_active = False
        self.motion_start_time = None
        self.current_motion_doc_id = None
        self.no_motion_count = 0
        
    def get_sub_stream_url(self) -> str:
        profiles = self.camera_data.get("stream_profiles", [])
        if not profiles:
            return self.rtsp_url
            
        def sort_key(p):
            w = p.get("width") or 0
            h = p.get("height") or 0
            res = w * h
            br = p.get("bitrate") or 0
            return (res, br)
            
        sorted_profiles = sorted(profiles, key=sort_key)
        sub_profile = sorted_profiles[0]
        
        rtsp_url = sub_profile.get("rtsp_url")
        if not rtsp_url:
            return self.rtsp_url
            
        user = self.camera_data.get("username")
        password = self.camera_data.get("password")
        
        # Fallback: extract credentials from main rtsp_url if fields are empty
        if (not user or not password) and self.rtsp_url.startswith("rtsp://"):
            try:
                import urllib.parse
                url_part = self.rtsp_url[7:]
                if "@" in url_part:
                    creds = url_part.split("@", 1)[0]
                    if ":" in creds:
                        u, p = creds.split(":", 1)
                        if not user:
                            user = urllib.parse.unquote(u)
                        if not password:
                            password = urllib.parse.unquote(p)
                    else:
                        if not user:
                            user = urllib.parse.unquote(creds)
            except Exception as e:
                print(f"[MOTION DETECT] Error parsing credentials from main URL: {e}")
        
        if user and rtsp_url.startswith("rtsp://"):
            import urllib.parse
            url_part = rtsp_url[7:]
            if "@" in url_part:
                url_part = url_part.split("@", 1)[1]
            encoded_user = urllib.parse.quote(user)
            encoded_pass = urllib.parse.quote(password or "")
            return f"rtsp://{encoded_user}:{encoded_pass}@{url_part}"
            
        return rtsp_url

    def run(self):
        from recorder import rtsp_recorder as recorder
        sub_rtsp = self.get_sub_stream_url()
        print(f"[MOTION DETECT] ▶ Starting motion detector for {self.stream_name} on sub-stream: {sub_rtsp}")
        
        cap = cv2.VideoCapture(sub_rtsp, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            print(f"[MOTION DETECT] ⚠ Failed to open {self.stream_name} with TCP. Trying UDP...")
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;udp|stimeout;2000000"
            cap = cv2.VideoCapture(sub_rtsp, cv2.CAP_FFMPEG)
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;2000000" # reset for others
            
        if cap.isOpened():
            print(f"[MOTION DETECT] ✅ Successfully connected to {self.stream_name}")
            
        # Use MOG2 background subtractor — sensitive settings for indoor cameras
        fgbg = cv2.createBackgroundSubtractorMOG2(history=200, varThreshold=10, detectShadows=False)
        morph_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        
        last_process_time = 0
        consecutive_failures = 0
        first_motion_logged = False
        
        while not self.stop_event.is_set():
            ret = cap.grab()
            if not ret:
                consecutive_failures += 1
                if consecutive_failures >= 30:
                    print(f"[MOTION DETECT] ⚠ {self.stream_name} stream grab failed 30 times, reconnecting...")
                    cap.release()
                    time.sleep(5)
                    cap = cv2.VideoCapture(sub_rtsp, cv2.CAP_FFMPEG)
                    consecutive_failures = 0
                else:
                    time.sleep(0.1)
                continue
            
            consecutive_failures = 0
            now = time.time()
            if now - last_process_time >= 0.25: # 4 FPS for accurate temporal resolution
                last_process_time = now
                ret, frame = cap.retrieve()
                if ret and frame is not None:
                    from app.services.license_manager import license_manager

                    # Check if MotionDetection is licensed
                    if not license_manager.is_analytics_enabled("MotionDetection"):
                        time.sleep(1)
                        continue

                    # Check active analytics limit
                    max_analytics = license_manager.get_max_analytics()
                    active_detectors_count = len([t for t in threading.enumerate() if t.name.startswith("motion-detector-")])
                    if active_detectors_count > max_analytics:
                        time.sleep(1)
                        continue

                    try:
                        # Resize to 240x180 for better spatial accuracy
                        small_frame = cv2.resize(frame, (240, 180))
                        # Gray scale
                        gray = cv2.cvtColor(small_frame, cv2.COLOR_BGR2GRAY)
                        # Light blur to remove sensor noise while preserving motion edges
                        gray = cv2.GaussianBlur(gray, (3, 3), 0)
                        
                        fgmask = fgbg.apply(gray)
                        # Morphological dilation to connect nearby motion regions and fill gaps
                        fgmask = cv2.dilate(fgmask, morph_kernel, iterations=2)
                        
                        # Find contours to filter out scattered noise
                        contours, _ = cv2.findContours(fgmask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                        
                        max_area = 0
                        for cnt in contours:
                            area = cv2.contourArea(cnt)
                            if area > max_area:
                                max_area = area
                        
                        # Count non-zero pixels for logging
                        non_zero = np.count_nonzero(fgmask)
                        total_pixels = gray.shape[0] * gray.shape[1]
                        motion_ratio = non_zero / total_pixels
                        
                        # Trigger if the single largest moving object is > 200 pixels
                        # This ignores swaying balloons, shadows, and camera noise.
                        if max_area > 200:
                            if not first_motion_logged:
                                print(f"[MOTION DETECT] 🏃 Motion triggered for {self.stream_name} (max_area={max_area})!")
                                first_motion_logged = True

                            self.no_motion_count = 0

                            # Trigger motion for the recorder (keeps recording alive across chunks)
                            recorder.trigger_motion(self.stream_name, None)
                            
                            if not self.motion_active:
                                # ── MOTION STARTED ──
                                self.motion_active = True
                                try:
                                    from datetime import datetime
                                    self.motion_start_time = datetime.now()
                                    ip = self.camera_data.get("ip", "")
                                    alert_doc = {
                                        "ip": ip,
                                        "serial": ip.replace(".", "_"),
                                        "type": "Motion",
                                        "scenario": f"Software motion detected for {self.stream_name}",
                                        "status": "Active",
                                        "source": "software_motion",
                                        "topic": "motion_detected",
                                        "raw": {"motion_ratio": motion_ratio},
                                        "time": self.motion_start_time.isoformat(),
                                        "motion_start": self.motion_start_time.isoformat(),
                                        "received_at": datetime.utcnow().isoformat() + "Z"
                                    }
                                    result = _shared_db["mqtt_logs"].insert_one(alert_doc)
                                    self.current_motion_doc_id = result.inserted_id
                                    print(f"[MOTION DETECT] 🚨 Motion STARTED for {self.stream_name}")
                                except Exception as e:
                                    print(f"[MOTION DETECT] Error logging motion start: {e}")
                        else:
                            self.no_motion_count += 1
                            if self.motion_active and self.no_motion_count >= 10:
                                # ── MOTION ENDED (after 2.5s of no motion at 4 FPS) ──
                                self.motion_active = False
                                try:
                                    from datetime import datetime
                                    motion_end_time = datetime.now()
                                    if self.current_motion_doc_id:
                                        _shared_db["mqtt_logs"].update_one(
                                            {"_id": self.current_motion_doc_id},
                                            {"$set": {
                                                "motion_end": motion_end_time.isoformat(),
                                                "status": "Ended"
                                            }}
                                        )
                                    self.current_motion_doc_id = None
                                    self.motion_start_time = None
                                except Exception as e:
                                    print(f"[MOTION DETECT] Error updating motion end: {e}")
                    except Exception as e:
                        print(f"[MOTION DETECT] ❌ Error processing frame for {self.stream_name}: {e}")
                        
        cap.release()
        print(f"[MOTION DETECT] ⏹ Stopped motion detector for {self.stream_name}")

class MotionDetectorManager:
    def __init__(self):
        self.detectors = {}
        self.lock = threading.Lock()
        self.running = False
        self.thread = None
        self.stop_event = threading.Event()
        
    def start(self):
        with self.lock:
            if self.running:
                return
            self.running = True
            self.stop_event.clear()
            self.thread = threading.Thread(target=self._sync_loop, daemon=True, name="motion-manager")
            self.thread.start()
            
            print("[MOTION DETECT] Manager started.")
            
    def stop(self):
        with self.lock:
            self.running = False
            self.stop_event.set()
            for detector in self.detectors.values():
                detector.stop_event.set()
            for detector in self.detectors.values():
                detector.join(timeout=2)
            self.detectors.clear()
            print("[MOTION DETECT] Manager stopped.")

    def trigger_sync(self):
        if self.running:
            threading.Thread(target=self._sync_now, daemon=True, name="motion-manager-instant-sync").start()

    def _sync_now(self):
        try:
            docs = list(_shared_db["cameras"].find({"enabled": {"$ne": False}, "motion_only": True}))
            active_streams = []
            
            for doc in docs:
                stream_name = doc.get("stream_key")
                rtsp_url = doc.get("rtsp_url")
                if not stream_name or not rtsp_url:
                    continue
                    
                active_streams.append(stream_name)
                
                with self.lock:
                    if stream_name not in self.detectors:
                        detector = CameraMotionDetector(stream_name, rtsp_url, doc)
                        self.detectors[stream_name] = detector
                        detector.start()
                    else:
                        # Update camera data just in case
                        self.detectors[stream_name].camera_data = doc
                        
            # Stop detectors for cameras that are no longer motion_only or disabled
            with self.lock:
                to_remove = []
                for stream_name, detector in self.detectors.items():
                    if stream_name not in active_streams:
                        detector.stop_event.set()
                        to_remove.append(stream_name)
                        
                for stream_name in to_remove:
                    self.detectors[stream_name].join(timeout=2)
                    del self.detectors[stream_name]
        except Exception as e:
            print(f"[MOTION DETECT] Instant sync error: {e}")

    def _sync_loop(self):
        while not self.stop_event.is_set():
            self._sync_now()
            self.stop_event.wait(2) # check database every 2 seconds

# Global manager instance
manager = MotionDetectorManager()
