import os
import io
import glob
import time
import subprocess
import threading
import redis
from queue import Queue
from datetime import datetime, timedelta
from minio import Minio
import pymongo

os.environ.setdefault('MONGO_DB_NAME', 'vms_db')
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from recorder.encrypt_service import MASTER_KEY

import logging
logging.getLogger('urllib3').setLevel(logging.ERROR)

# Configuration
default_minio = f"{os.environ.get('HOST_IP')}:{os.environ.get('MINIO_PORT')}"
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", default_minio).replace("http://", "").replace("https://", "")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "your_access_key")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "your_secret_key")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "vms-rec")

default_mongo = f"mongodb://{os.environ.get('HOST_IP')}:{os.environ.get('MONGO_PORT')}/"
MONGO_URI = os.environ.get("MONGO_URI", default_mongo)
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME", "vms_db")

RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "C:\\recording" if os.name == "nt" else "/recording")
FFMPEG_BIN = "ffmpeg"

UPLOAD_QUEUE_SIZE = 500
MIN_UPLOAD_WORKERS = 4
MAX_UPLOAD_WORKERS = 32

upload_queue = Queue(maxsize=UPLOAD_QUEUE_SIZE)
queued_files = set()
queued_lock = threading.Lock()
physically_recording = set()

# Initialize MinIO
minio_client = Minio(

    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=False
)

# Connect to Dedicated VMS Redis Server
try:
    redis_client = redis.Redis(
        host=os.environ.get("REDIS_HOST", "127.0.0.1"),
        port=int(os.environ.get("RECORDER_REDIS_PORT") or os.environ.get("REDIS_PORT")),
        db=1,
        socket_timeout=15,
        socket_connect_timeout=5,
        health_check_interval=30
    )
except Exception as e:
    print(f"[ERROR] Could not connect to Redis: {e}")

if not minio_client.bucket_exists(MINIO_BUCKET):
    minio_client.make_bucket(MINIO_BUCKET)

# Initialize MongoDB with connection pooling
mongo_client = pymongo.MongoClient(
    MONGO_URI,
    maxPoolSize=50,
    minPoolSize=5,
    serverSelectionTimeoutMS=5000
)
db = mongo_client[MONGO_DB_NAME]
recordings_col = db["recordings"]
cameras_col = db["cameras"]

class EncryptedFileStream(io.RawIOBase):
    def __init__(self, file_path, base_iv, encryptor):
        self._header = b'CTR\x00' + base_iv
        self._header_sent = False
        self._f = open(file_path, "rb")
        self._done = False
        self._encryptor = encryptor
        self.CHUNK_SIZE = 1 * 1024 * 1024

    def read(self, size=-1):
        if self._done: return b""
        if not self._header_sent:
            self._header_sent = True
            return self._header
        chunk = self._f.read(self.CHUNK_SIZE if size < 0 else size)
        if not chunk:
            self._done = True
            self.close()
            remaining = self._encryptor.finalize()
            return remaining if remaining else b""
        return self._encryptor.update(chunk)

    def close(self):
        if not self._f.closed: self._f.close()
        super().close()

    def readable(self): return True


def inject_credentials(rtsp_str, user, pwd):
    if not rtsp_str or not user or not pwd:
        return rtsp_str
    import urllib.parse
    if f"{urllib.parse.quote_plus(user)}:" in rtsp_str or f"{user}:" in rtsp_str:
        return rtsp_str
    if rtsp_str.startswith("rtsp://"):
        parts = rtsp_str.split("rtsp://", 1)
        safe_user = urllib.parse.quote_plus(user)
        safe_pwd = urllib.parse.quote_plus(pwd)
        return f"rtsp://{safe_user}:{safe_pwd}@{parts[1]}"
    return rtsp_str


def calculate_workers(camera_count):
    workers = max(MIN_UPLOAD_WORKERS, (camera_count + 24) // 25)
    return min(workers, MAX_UPLOAD_WORKERS)


def record_camera(camera_id, rtsp_url, stop_event):
    """Run FFmpeg in a loop until stop_event is set."""
    camera_dir = os.path.join(RECORDINGS_DIR, camera_id).replace("\\", "/")
    os.makedirs(camera_dir, exist_ok=True)
    out_pattern = os.path.join(camera_dir, "%Y-%m-%d_%H-%M-%S.mp4").replace("\\", "/")
    
    logs_dir = os.path.join(RECORDINGS_DIR, "logs").replace("\\", "/")
    os.makedirs(logs_dir, exist_ok=True)
    log_file = os.path.join(logs_dir, f"{camera_id}.log").replace("\\", "/")
    
    cmd = [
        FFMPEG_BIN, 
        "-loglevel", "warning",
        "-rtsp_transport", "tcp",
        
        "-i", rtsp_url,
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c:v", "copy",
        "-c:a", "aac",
        "-f", "segment", 
        "-segment_time", "300",
        "-segment_format", "mp4", 
        "-reset_timestamps", "1",
        "-strftime", "1", 
        out_pattern
    ]
    
    print(f"[SIMPLE-RECORDER] Starting ffmpeg for {camera_id}...")
    while not stop_event.is_set():
        try:
            with open(log_file, "a") as f_log:
                proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=f_log)
                physically_recording.add(camera_id)
                
                # Wait for process to exit or stop_event to be set
                while proc.poll() is None:
                    if stop_event.is_set():
                        proc.terminate()
                        proc.wait()
                        physically_recording.discard(camera_id)
                        print(f"[SIMPLE-RECORDER] Stopped ffmpeg for {camera_id} (Camera Disabled).")
                        return
                    time.sleep(1)
                
                physically_recording.discard(camera_id)
                    
            if not stop_event.is_set():
                print(f"[SIMPLE-RECORDER] ffmpeg exited for {camera_id}. Check {log_file} for errors. Restarting in 5s...")
                for _ in range(5):
                    if stop_event.is_set(): return
                    time.sleep(1)
        except Exception as e:
            physically_recording.discard(camera_id)
            print(f"[SIMPLE-RECORDER] FFmpeg error for {camera_id}: {e}")
            time.sleep(5)


def scanner_worker():
    """Scans for completed mp4s and queues them FAST."""
    print("[SCANNER] Fast scanner worker started.")
    while True:
        try:
            all_cams = list(cameras_col.find({"enabled": {"$ne": False}}))
            active_cams = [c.get("stream_key") or c.get("id") for c in all_cams if not c.get("motion_only")]
            
            if os.path.exists(RECORDINGS_DIR):
                for cam_id in os.listdir(RECORDINGS_DIR):
                    if cam_id not in active_cams: continue
                    cam_dir = os.path.join(RECORDINGS_DIR, cam_id).replace("\\", "/")
                    if not os.path.isdir(cam_dir): continue
                    
                    for file in os.listdir(cam_dir):
                        if not file.endswith(".mp4"): continue
                        file_path = os.path.join(cam_dir, file).replace("\\", "/")
                        
                        with queued_lock:
                            if file_path in queued_files:
                                continue
                        
                        try:
                            if time.time() - os.path.getmtime(file_path) < 20: continue
                            if os.path.getsize(file_path) == 0:
                                os.remove(file_path)
                                continue
                        except Exception:
                            continue

                        with queued_lock:
                            queued_files.add(file_path)
                        
                        redis_client.rpush("vms_upload_queue", file_path)
        except Exception as e:
            print(f"[SCANNER] Error in scanner loop: {e}")
        
        time.sleep(5)


def upload_worker_thread(worker_id):
    """Pulls from upload_queue, encrypts, uploads, updates DB, deletes."""
    print(f"[WORKER-{worker_id}] Upload worker started.")
    while True:
        try:
            queue_item = redis_client.blpop("vms_upload_queue", timeout=5)
        except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError):
            continue
        except Exception as e:
            print(f"[WORKER-{worker_id}] Redis error: {e}")
            time.sleep(2)
            continue

        if not queue_item:
            continue
        file_path = queue_item[1].decode('utf-8')
        
        try:
            file_size = os.path.getsize(file_path)
            parts = file_path.split("/")
            filename, camera_id = parts[-1], parts[-2]
            
            # --- PARALLEL FFPROBE & INTEGRITY CHECK ---
            is_valid_mp4 = True            
            try:
                cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file_path]
                out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=5)
                true_duration = float(out.strip())
                if true_duration <= 0: raise ValueError("Invalid duration")
            except Exception as probe_err:
                # If ffprobe errors with moov atom not found, file was cut mid-stream during restart
                err_str = str(probe_err).lower()
                if "moov" in err_str or "invalid data" in err_str:
                    print(f"[WORKER-{worker_id}] Discarding corrupt/incomplete chunk {filename}: {probe_err}")
                    is_valid_mp4 = False
                else:
                    true_duration = 300.0 # Standard fallback for temporary probe timeout
            if not is_valid_mp4:
                # Corrupted chunk from mid-stream restart; discard and delete locally
                try:
                    os.remove(file_path)
                except Exception:
                    pass
                with queued_lock:
                    queued_files.discard(file_path)
                continue
            # ------------------------------------------

            
            try:
                date_str, time_str = os.path.splitext(filename)[0].split("_", 1)
            except ValueError:
                continue
            
            start_time_formatted = time_str.replace("-", ":")
            from app.utils.minio_client import build_recording_path
            dest_object = build_recording_path("", camera_id, date_str, f"{os.path.splitext(filename)[0]}.enc").replace('//', '/')
            
            start_dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H-%M-%S")
            end_time_formatted = (start_dt + timedelta(seconds=true_duration)).strftime("%H:%M:%S")

            print(f"[WORKER-{worker_id}] Encrypting & Uploading {filename} for {camera_id}...")
            
            base_iv = os.urandom(16)
            cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(base_iv), backend=default_backend())
            encryptor = cipher.encryptor()
            enc_size = 4 + 16 + file_size
            enc_stream = EncryptedFileStream(file_path, base_iv, encryptor)
            
            upload_ok = False
            try:
                minio_client.put_object(MINIO_BUCKET, dest_object, enc_stream, length=enc_size)
                upload_ok = True
            except Exception as e:
                print(f"[WORKER-{worker_id}] Upload failed for {filename}: {e}")
            finally:
                enc_stream.close()

            if upload_ok:
                try:
                    recordings_col.update_one(
                        {"camera_id": camera_id, "date": date_str, "start_time": start_time_formatted},
                        {"$set": {
                            "status": "COMPLETE", "file_path": f"minio:{dest_object}",
                            "duration_seconds": true_duration, "end_time": end_time_formatted,
                            "file_size": enc_size, "last_updated": datetime.now(), 
                            "type": "motion_based" if filename.endswith("_motion.mp4") else "continuous",
                            "created_at": start_dt
                        }}, upsert=True)
                    
                    print(f"[WORKER-{worker_id}] Successfully processed {filename} in DB.")
                except Exception as e:
                    print(f"[WORKER-{worker_id}] Mongo update failed for {filename}: {e}")
                    upload_ok = False # Keep file, retry DB update later

                if upload_ok:
                    # Separate file deletion from DB transaction so Windows WinError 32 lock won't trigger re-upload loops
                    for _ in range(3):
                        try:
                            if os.path.exists(file_path):
                                os.remove(file_path)
                            break
                        except Exception as del_err:
                            time.sleep(1)
        except Exception as e:
            print(f"[WORKER-{worker_id}] Unhandled error processing {file_path}: {e}")
            upload_ok = False
            
        finally:
            if upload_ok:
                with queued_lock:
                    queued_files.discard(file_path)
            else:
                # If it failed, wait before releasing so scanner can re-queue it later
                threading.Timer(30.0, lambda fp=file_path: queued_files.discard(fp)).start()
                
            # upload_queue.task_done() handled by Redis implicitly


def main():
    active_threads = {}
    scanner_started = False
    worker_pool_started = False
    
    pubsub = redis_client.pubsub()
    try:
        pubsub.subscribe("vms_config_updates")
        print("[MAIN] Subscribed to Redis config updates!")
    except Exception as e:
        print(f"[MAIN] Redis pubsub error: {e}")
    
    while True:
        try:
            all_cameras = list(cameras_col.find())
            enabled_cams = {cam.get("stream_key") or cam.get("id"): cam for cam in all_cameras if cam.get("enabled") is not False}
            
            # Start Uploader Architecture
            if not scanner_started and enabled_cams:
                threading.Thread(target=scanner_worker, daemon=True).start()
                scanner_started = True
            
            if not worker_pool_started and enabled_cams:
                num_workers = calculate_workers(len(enabled_cams))
                print(f"[MAIN] Initializing pool with {num_workers} upload workers.")
                for i in range(num_workers):
                    threading.Thread(target=upload_worker_thread, args=(i+1,), daemon=True).start()
                worker_pool_started = True
            
            # Start new cameras or handle profile changes
            for cam_id, cam_data in enabled_cams.items():
                # Prefer recording_rtsp (which handles Main/Sub stream routing), fallback to rtsp_url
                desired_url = cam_data.get("recording_rtsp") or cam_data.get("rtsp_url")
                cam_user = cam_data.get("username")
                cam_pass = cam_data.get("password")
                if desired_url and cam_user and cam_pass:
                    desired_url = inject_credentials(desired_url, cam_user, cam_pass)
                
                # If camera is running but URL changed (e.g. user clicked Sub Stream in UI)
                if cam_id in active_threads and active_threads[cam_id].get("url") != desired_url:
                    print(f"[MAIN] Profile changed for {cam_id}! Restarting recording thread...")
                    active_threads[cam_id]["stop_event"].set()
                    del active_threads[cam_id]
                
                if cam_id not in active_threads and desired_url:
                    stop_event = threading.Event()
                    t = threading.Thread(target=record_camera, args=(cam_id, desired_url, stop_event), daemon=True)
                    t.start()
                    active_threads[cam_id] = {"thread": t, "stop_event": stop_event, "url": desired_url}
                    
            # Stop disabled cameras
            for cam_id in list(active_threads.keys()):
                if cam_id not in enabled_cams:
                    print(f"[MAIN] Camera {cam_id} was disabled in DB. Stopping recording...")
                    active_threads[cam_id]["stop_event"].set()
                    del active_threads[cam_id]
                    
        except Exception as e:
            print(f"[MAIN] Error checking database: {e}")

        try:
            db["system_status"].update_one(
                {"type": "recorder_status"},
                {"$set": {
                    "timestamp": time.time(),
                    "active_recorders": list(physically_recording)
                }},
                upsert=True
            )
        except Exception as status_e:
            pass
        try:
            msg = pubsub.get_message(timeout=10.0)
            if msg and msg['type'] == 'message':
                print('[MAIN] Instant config update received via Redis!')
        except Exception:
            time.sleep(10)

if __name__ == '__main__':
    main()
