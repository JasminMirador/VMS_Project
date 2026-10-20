"""
rtsp_recorder.py
----------------
Records every registered RTSP camera into 5-minute MP4 chunks.
Saves files as:  <RECORDINGS_DIR>/<camera_id>/<YYYY-MM-DD>/<YYYY-MM-DD_HH-MM-SS>.mp4
Supports vf_filter for privacy masking burned into stream and recordings.

RECORDING PATH:
  Priority order for the recording directory:
    1. Runtime override set via set_recordings_dir() (called by /api/storage/apply)
    2. RECORDINGS_DIR environment variable
    3. Default: /recording
"""

import os
import subprocess
import threading
import time
import signal
from datetime import datetime
from app.core.database import mongo_client
from app.services.ai import mask_service

from app.services.camera.onvif_service import get_camera_system_time

# ── Default recordings directory (can be overridden at runtime) ──
_DEFAULT_RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/recording")
_recordings_dir_lock    = threading.Lock()
_recordings_dir_override: str | None = None   # set by set_recordings_dir()

CHUNK_SECONDS = int(os.environ.get("CHUNK_SECONDS", "300"))
FFMPEG_BIN    = os.environ.get("FFMPEG_BIN", "ffmpeg")

_recorders:  dict[str, threading.Thread] = {}
_stop_flags: dict[str, threading.Event]  = {}
_vf_filters: dict[str, str]              = {}
_camera_data: dict[str, dict]             = {}
_motion_events: dict[str, threading.Event] = {}
_actively_recording_streams = set()

_latest_face_urls: dict[str, str] = {}
_last_trigger_log_times: dict[str, float] = {}
_last_motion_trigger_times: dict[str, float] = {}
_recording_durations: dict[str, dict[str, float]] = {}

# ── MongoDB (shared client for all recorder operations) ─────────────
MONGO_URI    = os.environ["MONGO_URI"]
_mongo       = mongo_client
_db = _mongo[os.environ.get("MONGO_DB_NAME")] if _mongo else None
_schedules = _db["schedules"] if _db is not None else None

def trigger_motion(stream_name: str, face_url: str | None = None):
    """Trigger a motion recording chunk for the given stream_name."""
    # 1. Save log to ui_logs collection so it appears on the Logs page ALWAYS
    if _db is not None:
        try:
            from datetime import timedelta
            ui_logs_col = _db["ui_logs"]
            
            now = time.time()
            last_log_time = _last_trigger_log_times.get(stream_name, 0)
            local_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            # If face_url is present, check if we logged a trigger in the last 15 seconds without a face_url, and update it
            if face_url:
                recent_log = ui_logs_col.find_one(
                    {
                        "category": "recording",
                        "details.camera_id": stream_name,
                        "details.event": "motion_trigger",
                        "details.face_url": None,
                        "timestamp": {"$gte": (datetime.utcnow() - timedelta(seconds=15)).isoformat() + "Z"}
                    },
                    sort=[("timestamp", -1)]
                )
                if recent_log:
                    ui_logs_col.update_one(
                        {"_id": recent_log["_id"]},
                        {"$set": {"details.face_url": face_url}}
                    )
                    print(f"[RECORDER] Attached face_url {face_url} to recent motion log.")
                    # Also update cameras collection so the worker gets the face_url
                    _db["cameras"].update_one(
                        {"stream_key": stream_name},
                        {"$set": {"last_face_url": face_url}}
                    )
                    return
            
            # Debounce writing new logs: 15 seconds per camera
            if now - last_log_time >= 15:
                _last_trigger_log_times[stream_name] = now
                ui_logs_col.insert_one({
                    "user_email": "system",
                    "user_role": "system",
                    "action": f"[RECORDER] [{local_time_str}] 💥 Motion trigger received for {stream_name} (Motion is detected).",
                    "category": "recording",
                    "details": {
                        "camera_id": stream_name, 
                        "event": "motion_trigger",
                        "face_url": face_url
                    },
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                })
        except Exception as e:
            print(f"[RECORDER] Failed to log motion trigger to DB: {e}")

    # 2. Check if motion_only is set
    motion_only = False
    if _db is not None:
        try:
            cam = _db["cameras"].find_one({"stream_key": stream_name})
            if cam:
                motion_only = cam.get("motion_only", False)
        except Exception as e:
            print(f"[RECORDER] DB lookup error in trigger_motion: {e}")

    meta = _camera_data.get(stream_name, {})
    if not motion_only and not meta.get("motion_only", False):
        return

    # Update database trigger timestamp so the worker process sees it
    if _db is not None:
        try:
            _db["cameras"].update_one(
                {"stream_key": stream_name},
                {"$set": {
                    "last_motion_trigger": time.time(),
                    "last_face_url": face_url
                }}
            )
        except Exception as e:
            print(f"[RECORDER] Failed to update last_motion_trigger in DB: {e}")

    _last_motion_trigger_times[stream_name] = time.time()

    if stream_name not in _motion_events:
        _motion_events[stream_name] = threading.Event()
    _motion_events[stream_name].set()
    
    local_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[RECORDER] [{local_time}] 💥 Motion trigger processed for {stream_name} (face_url: {face_url})")
    
    if face_url:
        _latest_face_urls[stream_name] = face_url
    else:
        _latest_face_urls.pop(stream_name, None)

def trigger_motion_local(stream_name: str, face_url: str | None = None):
    """Trigger a motion recording chunk locally on the worker."""
    meta = _camera_data.get(stream_name, {})
    if not meta.get("motion_only", False):
        return

    _last_motion_trigger_times[stream_name] = time.time()

    if stream_name not in _motion_events:
        _motion_events[stream_name] = threading.Event()
    _motion_events[stream_name].set()
    
    if face_url:
        _latest_face_urls[stream_name] = face_url
    else:
        _latest_face_urls.pop(stream_name, None)


def is_schedule_on(schedule_id: str | int | None, now: datetime) -> bool:
    """
    Check if the current time is 'on' according to the assigned schedule.
    If no schedule is assigned, it defaults to 'Always ON'.
    """
    if not schedule_id or str(schedule_id).lower() == "always":
        return True
    
    if str(schedule_id).lower() == "never":
        return False
    
    # Try to find by ID (handling both string and numeric versions for legacy data)
    try:
        numeric_id = int(schedule_id)
        sch = _schedules.find_one({"id": {"$in": [str(schedule_id), numeric_id]}})
    except (ValueError, TypeError):
        sch = _schedules.find_one({"id": str(schedule_id)})
    
    if not sch:
        return True # Default to ON if schedule not found
    
    # 1. Check Exceptions (date-based override)
    date_iso = now.date().isoformat() # "YYYY-MM-DD"
    exceptions = sch.get("exceptions", [])
    # Check if any exception starts with our date string
    for exc in exceptions:
        if str(exc).startswith(date_iso):
            return False # Exceptions are 'Off' days
    
    # 2. Check Exact Time Ranges (if available)
    day_name = now.strftime("%A")
    ranges_data = sch.get("ranges", {})
    day_ranges = ranges_data.get(day_name)
    if day_ranges and day_ranges != "Always Off":
        # Example format: "07:20 - 07:45, 14:00 - 15:00"
        current_time_str = now.strftime("%H:%M")
        for r in day_ranges.split(", "):
            try:
                start_str, end_str = r.split(" - ")
                if start_str <= current_time_str < end_str:
                    return True
            except: continue
        return False # Within a day with ranges, but not in any active range

    # 3. Fallback to Week Schedule (5-min bitmask)
    week_data = sch.get("week", {})
    day_mask = week_data.get(day_name)
    
    if not day_mask or not isinstance(day_mask, list):
        return True # Default to ON if data missing
    
    # Calculate current 5-min slot index (0 to 287)
    minute_of_day = now.hour * 60 + now.minute
    slot_index = minute_of_day // 5
    
    if 0 <= slot_index < len(day_mask):
        status = day_mask[slot_index]
        return status
    
    return True


def update_camera_data(stream_name: str, new_data: dict):
    """Update metadata for an active camera (e.g. its assigned schedule)."""
    if stream_name not in _camera_data:
        _camera_data[stream_name] = {}
        
    old_motion_only = _camera_data[stream_name].get("motion_only")
    old_schedule = _camera_data[stream_name].get("assigned_schedule_id")
    
    _camera_data[stream_name].update(new_data)
    print(f"[RECORDER] 🔄 Metadata updated for {stream_name}: {new_data}")
    
    # If the camera is active and settings changed, force restart it to apply in real-time
    if stream_name in _recorders:
        new_motion_only = _camera_data[stream_name].get("motion_only")
        new_schedule = _camera_data[stream_name].get("assigned_schedule_id")
        
        # Check if they actually changed
        if (old_motion_only is not None and old_motion_only != new_motion_only) or \
           (old_schedule is not None and old_schedule != new_schedule):
            rtsp_url = _camera_data[stream_name].get("rtsp_url")
            if rtsp_url:
                print(f"[RECORDER] 🔄 Settings changed for active camera {stream_name}. Force restarting...")
                # We start a new thread to avoid blocking the API request during join
                def restart_target():
                    start_camera(stream_name, rtsp_url, _camera_data[stream_name], vf_filter=_vf_filters.get(stream_name, ""))
                threading.Thread(target=restart_target, daemon=True, name=f"restart-{stream_name}").start()


def get_recordings_dir() -> str:
    """Return the current effective recordings directory."""
    with _recordings_dir_lock:
        return _recordings_dir_override or _DEFAULT_RECORDINGS_DIR


def set_recordings_dir(path: str):
    """
    Override the recordings directory at runtime.
    Called by POST /api/storage/apply when the user changes the path in the UI.
    New recording chunks will immediately start writing to the new path.
    In-progress ffmpeg processes finish their current chunk at the old path,
    then the next chunk uses the new path.
    """
    global _recordings_dir_override
    path = path.strip()
    if not path:
        return
    with _recordings_dir_lock:
        _recordings_dir_override = path
    # Create the directory now so ffmpeg never fails on a missing path
    try:
        os.makedirs(path, exist_ok=True)
        print(f"[RECORDER] 📁 Recording path updated to: {path}")
    except Exception as e:
        print(f"[RECORDER] ⚠ Could not create recording directory '{path}': {e}")


class CameraRecorder:
    def __init__(self, stream_name: str, rtsp_url: str, camera_data: dict | None = None, vf_filter: str = ""):
        self.stream_name = stream_name
        self.rtsp_url = rtsp_url
        self.camera_data = camera_data or {}
        self.vf_filter = vf_filter
        
        self.state = "IDLE"  # IDLE, RECORDING, TERMINATING
        self.proc = None
        self.chunk_start = 0
        self.time_str = ""
        self.out_dir = ""
        self.filename = ""
        self.out_file = ""
        self.terminate_start = 0
        
        self.stop_event = threading.Event()

    def is_alive(self) -> bool:
        return self.state in ("RECORDING", "TERMINATING")

    def tick(self):
        if self.stop_event.is_set():
            if self.state == "RECORDING":
                self._stop_ffmpeg()
            elif self.state == "TERMINATING":
                self._check_termination()
            return

        if self.state == "IDLE":
            # ── Check Schedule ──────────────────────────────────────────
            now = datetime.now()
            meta = _camera_data.get(self.stream_name, self.camera_data)
            schedule_id = meta.get("assigned_schedule_id")
            if not is_schedule_on(schedule_id, now):
                return

            # ── Check Motion-Only Mode ──────────────────────────────────
            motion_only = meta.get("motion_only", False)
            if motion_only:
                if self.stream_name not in _motion_events:
                    _motion_events[self.stream_name] = threading.Event()
                if not _motion_events[self.stream_name].is_set():
                    return
                _motion_events[self.stream_name].clear()
                now = datetime.now()

            self._start_ffmpeg(now, motion_only)

        elif self.state == "RECORDING":
            poll_code = self.proc.poll()
            if poll_code is not None:
                self._finalize_chunk(poll_code)
                return

            meta = _camera_data.get(self.stream_name, self.camera_data)
            schedule_id = meta.get("assigned_schedule_id")
            
            # If schedule changes to inactive (e.g. Never) while recording, stop immediately
            if not is_schedule_on(schedule_id, datetime.now()):
                local_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                print(f"[RECORDER] [{local_time}] ⏹ Schedule became inactive. Stopping recording early for {self.stream_name}.")
                self._stop_ffmpeg()
                return

            motion_only = meta.get("motion_only", False)
            now_time = time.time()
            elapsed_total = now_time - self.chunk_start

            if motion_only:
                elapsed_since_motion = now_time - _last_motion_trigger_times.get(self.stream_name, self.chunk_start)
                if elapsed_since_motion > 30.0:
                    local_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    print(f"[RECORDER] [{local_time}] ⏹ No motion detected for 30s buffer. Stopping recording early for {self.stream_name}.")
                    self._stop_ffmpeg()
                    return
                if elapsed_total >= getattr(self, "current_chunk_duration", CHUNK_SECONDS):
                    local_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    print(f"[RECORDER] [{local_time}] ⏹ Reached chunk limit. Stopping recording for {self.stream_name}.")
                    self._stop_ffmpeg()
                    return
            else:
                if elapsed_total >= getattr(self, "current_chunk_duration", CHUNK_SECONDS):
                    self._stop_ffmpeg()
                    return

        elif self.state == "TERMINATING":
            self._check_termination()

    def _start_ffmpeg(self, now, motion_only):
        if motion_only:
            date_str = now.strftime("%Y-%m-%d")
            self.time_str = now.strftime("%H-%M-%S")
            timestamp = f"{date_str}_{self.time_str}"
            self.current_chunk_duration = 3600
            segment_start = 0
            self.filename = f"{timestamp}_motion_based.mp4"
        else:
            # Align chunks to exactly 5-minute intervals (e.g. 00, 05, 10...)
            minute = (now.minute // 5) * 5
            rounded_now = now.replace(minute=minute, second=0, microsecond=0)
            
            date_str  = rounded_now.strftime("%Y-%m-%d")
            self.time_str  = rounded_now.strftime("%H-%M-%S")
            timestamp = f"{date_str}_{self.time_str}"
            
            # Adjust chunk duration so it stops exactly at the next 5-minute mark
            elapsed_in_slot = (now - rounded_now).total_seconds()
            self.current_chunk_duration = max(10, int(CHUNK_SECONDS - elapsed_in_slot))
            segment_start = int(elapsed_in_slot // 10)
            self.filename = f"{timestamp}.mp4"

        recordings_dir = get_recordings_dir()
        self.out_dir  = os.path.join(recordings_dir, self.stream_name, date_str)
        os.makedirs(self.out_dir, exist_ok=True)
        self.out_file = os.path.join(self.out_dir, self.filename)

        local_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if motion_only:
            face_url = _latest_face_urls.pop(self.stream_name, None)
            print(f"[RECORDER] [{local_time_str}] 🏃 Motion triggered for {self.stream_name}! Started recording (File: {self.filename}, Face: {face_url})...")
            
            try:
                if _db is not None:
                    _db["ui_logs"].insert_one({
                        "user_email": "system",
                        "user_role": "system",
                        "action": f"Started Recording",
                        "category": "recording",
                        "details": {
                            "camera_id": self.stream_name, 
                            "event": "recording_started", 
                            "duration": self.current_chunk_duration,
                            "file_name": self.filename,
                            "face_url": face_url
                        },
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    })
            except Exception as e:
                print(f"[RECORDER] Failed to log motion trigger to DB: {e}")

        current_vf = self.vf_filter
        meta = _camera_data.get(self.stream_name, self.camera_data)
        if meta and meta.get("ip"):
            fresh_vf = mask_service.build_ffmpeg_vf(meta["ip"]) or ""
            if fresh_vf != current_vf:
                if fresh_vf:
                    print(f"[RECORDER] 🎭 Mask filter updated for {self.stream_name}: {fresh_vf}")
                else:
                    print(f"[RECORDER] 🎭 Mask filter cleared for {self.stream_name}")
                current_vf = fresh_vf
                self.vf_filter = fresh_vf

        if current_vf:
            cmd = [
                FFMPEG_BIN,
                "-loglevel",       "error",
                "-rtsp_transport", "tcp",
                "-i",              self.rtsp_url,
                "-t",              str(CHUNK_SECONDS),
                "-vf",             current_vf,
                "-c:v",            "libx264",
                "-preset",         "ultrafast",
                "-crf",            "23",
                "-c:a",            "aac",
                "-map",            "0:v",
                "-map",            "0:a?",
                "-f",              "segment",
                "-segment_time",   "10",
                "-segment_format", "mpegts",
                "-movflags", "+faststart",
                "-avoid_negative_ts", "make_zero",
                "-y",
                os.path.join(self.out_dir, f"{self.time_str}_%03d.ts")
            ]
        else:
            cmd = [
                FFMPEG_BIN,
                "-loglevel",       "error",
                "-rtsp_transport", "tcp",
                "-i",              self.rtsp_url,
                "-t",              str(CHUNK_SECONDS),
                "-c:v",            "copy",
                "-c:a",            "aac",
                "-map",            "0:v",
                "-map",            "0:a?",
                "-f",              "segment",
                "-segment_time",   "10",
                "-segment_format", "mpegts",
                "-movflags", "+faststart",
                "-avoid_negative_ts", "make_zero",
                "-y",
                os.path.join(self.out_dir, f"{self.time_str}_%03d.ts")
            ]

        _actively_recording_streams.add(self.stream_name)
        try:
            self.proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            from app.utils.ffmpeg_utils import register_process
            register_process(self.proc)
            
            self.chunk_start = time.time()
            if motion_only and self.stream_name not in _last_motion_trigger_times:
                _last_motion_trigger_times[self.stream_name] = self.chunk_start
            
            self.state = "RECORDING"
        except FileNotFoundError:
            print(f"[RECORDER] ❌ ffmpeg not found. Install ffmpeg and ensure it is on PATH.")
            self.state = "IDLE"
        except Exception as exc:
            print(f"[RECORDER] ❌ Unexpected error for {self.stream_name}: {exc}")
            self.state = "IDLE"

    def _stop_ffmpeg(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.send_signal(signal.SIGTERM)
            except Exception:
                pass
            self.state = "TERMINATING"
            self.terminate_start = time.time()
        else:
            self.state = "IDLE"

    def _check_termination(self):
        poll_code = self.proc.poll()
        if poll_code is not None:
            self._finalize_chunk(poll_code)
            return
        
        if time.time() - self.terminate_start > 5.0:
            print(f"[RECORDER] ⚠️ ffmpeg for {self.stream_name} did not exit on SIGTERM. Killing...")
            try:
                self.proc.kill()
            except Exception:
                pass
            poll_code = self.proc.wait()
            self._finalize_chunk(poll_code)

    def _finalize_chunk(self, poll_code):
        final_duration = time.time() - self.chunk_start
        _recording_durations.setdefault(self.stream_name, {})[self.time_str] = final_duration

        from app.utils.ffmpeg_utils import unregister_process
        if self.proc:
            unregister_process(self.proc)

        returncode = poll_code or 0
        if returncode not in (0, -15):
            try:
                stderr_out = self.proc.stderr.read().decode(errors="replace").strip()
                print(f"[RECORDER] ⚠ ffmpeg exited {returncode} for {self.stream_name}: {stderr_out[-200:]}")
            except Exception:
                pass
        else:
            meta = _camera_data.get(self.stream_name, self.camera_data)
            motion_only = meta.get("motion_only", False)
            if motion_only:
                print(f"[RECORDER] [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ Chunk saved: {self.out_file}")

        _actively_recording_streams.discard(self.stream_name)
        self.proc = None
        self.state = "IDLE"


def start_camera(
    stream_name: str,
    rtsp_url: str,
    camera_data: dict | None = None,
    vf_filter: str = "",
):
    if stream_name in _recorders:
        print(f"[RECORDER] 🔄 Force restarting {stream_name}")
        stop_camera(stream_name)

    if not vf_filter and camera_data and camera_data.get("ip"):
        ip = camera_data.get("ip", "")
        vf_filter = mask_service.build_ffmpeg_vf(ip) or ""
        if vf_filter:
            print(f"[RECORDER] 🎭 Mask filter loaded for {stream_name}: {vf_filter}")

    _vf_filters[stream_name] = vf_filter
    _camera_data[stream_name] = camera_data or {}
    
    recorder_obj = CameraRecorder(stream_name, rtsp_url, camera_data, vf_filter)
    _recorders[stream_name] = recorder_obj
    recorder_obj.tick()
    print(f"[RECORDER] 🎥 Started threadless: {stream_name} → {get_recordings_dir()}")


def stop_camera(stream_name: str):
    """Stop recording a single camera."""
    if stream_name in _recorders:
        rec = _recorders[stream_name]
        rec.stop_event.set()
        
        # Synchronously stop the process and wait for it
        if rec.state == "RECORDING":
            rec._stop_ffmpeg()
            t0 = time.time()
            while rec.state == "TERMINATING" and time.time() - t0 < 3.0:
                rec._check_termination()
                time.sleep(0.1)
            if rec.state == "TERMINATING":
                try:
                    rec.proc.kill()
                except Exception:
                    pass
                rec.proc.wait()
                rec._finalize_chunk(rec.proc.returncode)

        _recorders.pop(stream_name, None)
        _stop_flags.pop(stream_name, None)
        _vf_filters.pop(stream_name, None)
        _camera_data.pop(stream_name, None)
        print(f"[RECORDER] ⏹ Stopped: {stream_name}")
    else:
        print(f"[RECORDER] ℹ No active recorder found for: {stream_name}")


def start_recording_all(devices: list):
    """
    Start recording all ENABLED devices that have stream_key + rtsp_url.
    Cameras with enabled=False are skipped entirely.
    """
    for device in devices:
        if device.get("enabled") is False:
            stream_name = device.get("stream_key", device.get("ip", "unknown"))
            print(f"[RECORDER] ⏭ Skipping disabled camera: {stream_name}")
            continue

        stream_name = device.get("stream_key")
        rtsp_url    = device.get("rtsp_url")

        if stream_name and rtsp_url:
            ip = device.get("ip", "")
            vf = mask_service.build_ffmpeg_vf(ip) or "" if ip else _vf_filters.get(stream_name, "")
            start_camera(stream_name, rtsp_url, device, vf_filter=vf)


def stop_all():
    """Stop all active recorders."""
    for name in list(_recorders.keys()):
        stop_camera(name)


def tick_all():
    """Tick all active threadless recorders."""
    for rec in list(_recorders.values()):
        try:
            rec.tick()
        except Exception as e:
            print(f"[RECORDER] Error ticking recorder for {rec.stream_name}: {e}")


if __name__ == "__main__":
    import json

    DEVICES_FILE = os.environ.get("DEVICES_FILE", "/app/data/devices.json")

    try:
        with open(DEVICES_FILE) as f:
            devices = json.load(f)
    except Exception as e:
        print(f"[RECORDER] Could not load devices file: {e}")
        devices = []

    if not devices:
        print("[RECORDER] No devices found. Add cameras via the API first.")
    else:
        start_recording_all(devices)
        enabled_count = sum(1 for d in devices if d.get("enabled") is not False)
        print(f"[RECORDER] Running — recording {enabled_count}/{len(devices)} enabled camera(s). Ctrl+C to stop.")
        try:
            while True:
                tick_all()
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[RECORDER] Shutting down...")
            stop_all()
