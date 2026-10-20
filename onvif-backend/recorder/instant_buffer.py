import os
import glob
import time
import subprocess
import threading
from datetime import datetime, timedelta
import pymongo

os.environ.setdefault('MONGO_DB_NAME', 'vms_db')
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from recorder.encrypt_service import MASTER_KEY

# Configuration
MONGO_URI = os.environ["MONGO_URI"]
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME", "vms_db")
MEDIAMTX_HOST = os.environ.get("MEDIAMTX_HOST", "127.0.0.1:8554")
BUFFER_DIR = os.environ.get("BUFFER_DIR", "C:\\recording\\instant_buffer" if os.name == "nt" else "/recording/instant_buffer")
FFMPEG_BIN = "ffmpeg"

# Initialize MongoDB
mongo_client = pymongo.MongoClient(MONGO_URI)
db = mongo_client[MONGO_DB_NAME]
recordings_col = db["recordings"]
cameras_col = db["cameras"]

def run_buffer_ffmpeg(camera_id, stream_key, stop_event):
    """Runs FFmpeg to generate 10-second TS segments from MediaMTX."""
    camera_dir = os.path.join(BUFFER_DIR, camera_id, "ts_chunks").replace("\\", "/")
    os.makedirs(camera_dir, exist_ok=True)
    out_pattern = os.path.join(camera_dir, "%Y-%m-%d_%H-%M-%S.ts").replace("\\", "/")
    
    rtsp_url = f"rtsp://{MEDIAMTX_HOST}/{stream_key}"
    
    cmd = [
        FFMPEG_BIN, "-loglevel", "warning", "-rtsp_transport", "tcp",
        "-i", rtsp_url, "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "copy", "-c:a", "aac", "-f", "segment", "-segment_time", "2",
        "-segment_format", "mpegts", 
        "-strftime", "1", out_pattern
    ]
    
    print(f"[BUFFER-FFMPEG] Starting TS segmentation for {camera_id} via MediaMTX...")
    while not stop_event.is_set():
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            while proc.poll() is None:
                if stop_event.is_set():
                    proc.terminate()
                    proc.wait()
                    return
                time.sleep(1)
            time.sleep(3)
        except Exception as e:
            print(f"[BUFFER-FFMPEG] Error for {camera_id}: {e}")
            time.sleep(3)


def append_worker(camera_id, stop_event):
    """Monitors TS chunks, encrypts them, and appends to a 5-minute .enc file."""
    camera_dir = os.path.join(BUFFER_DIR, camera_id).replace("\\", "/")
    ts_dir = os.path.join(camera_dir, "ts_chunks").replace("\\", "/")
    os.makedirs(ts_dir, exist_ok=True)
    
    current_enc_file = None
    current_encryptor = None
    current_enc_path = None
    chunk_start_time = time.time()
    
    processed_ts_files = set()
    
    while not stop_event.is_set():
        try:
            ts_files = sorted(glob.glob(os.path.join(ts_dir, "*.ts")))
            
            for ts_file in ts_files:
                if ts_file in processed_ts_files:
                    continue
                
                # Only process if it's older than 5 seconds (meaning FFmpeg finished it)
                if time.time() - os.path.getmtime(ts_file) < 3:
                    continue
                
                # Start new 5-minute block if needed
                if not current_enc_file or (time.time() - chunk_start_time > 300):
                    if current_enc_file:
                        current_enc_file.close()
                    
                    chunk_start_time = time.time()
                    now = datetime.now()
                    date_str = now.strftime("%Y-%m-%d")
                    time_str = now.strftime("%H:%M:%S")
                    safe_time = now.strftime("%H-%M-%S")
                    
                    current_enc_path = os.path.join(camera_dir, f"{date_str}_{safe_time}.enc").replace("\\", "/")
                    
                    base_iv = os.urandom(16)
                    cipher = Cipher(algorithms.AES(MASTER_KEY), modes.CTR(base_iv), backend=default_backend())
                    current_encryptor = cipher.encryptor()
                    
                    current_enc_file = open(current_enc_path, "wb")
                    current_enc_file.write(b'CTR\x00' + base_iv)
                    
                    # Register in MongoDB so UI can find it
                    recordings_col.insert_one({
                        "camera_id": camera_id,
                        "date": date_str,
                        "start_time": time_str,
                        "status": "RECORDING",
                        "file_path": f"local:{current_enc_path}",
                        "duration_seconds": 300, "type": "instant_buffer",
                        "created_at": datetime.now()
                    })
                    print(f"[BUFFER-APPEND] Started new buffer chunk: {current_enc_path}")
                
                # Append TS file to ENC file
                with open(ts_file, "rb") as f:
                    ts_data = f.read()
                    
                if ts_data:
                    enc_data = current_encryptor.update(ts_data)
                    current_enc_file.write(enc_data)
                    current_enc_file.flush()
                
                processed_ts_files.add(ts_file)
                # Delete the TS file safely since we appended it
                try:
                    os.remove(ts_file)
                    print(f'[BUFFER-APPEND] Appended and deleted {ts_file}')
                except: pass
                
            # Cleanup old .enc files and DB rows (older than 10 minutes)
            # 10 minutes ensures overlap so UI doesn't lose video while MinIO upload finishes
            cleanup_time = datetime.now() - timedelta(minutes=10)
            old_docs = recordings_col.find({
                "camera_id": camera_id, 
                "status": "RECORDING", 
                "duration_seconds": 300, "type": "instant_buffer",
                "created_at": {"$lt": cleanup_time}
            })
            
            for doc in old_docs:
                old_path = doc.get("file_path", "").replace("local:", "")
                try:
                    if os.path.exists(old_path):
                        os.remove(old_path)
                except: pass
                recordings_col.delete_one({"_id": doc["_id"]})
                
        except Exception as e:
            print(f"[BUFFER-APPEND] Error for {camera_id}: {e}")
            
        time.sleep(2)

def main():
    print("[INSTANT-BUFFER] Starting Parallel Instant Playback Buffer...")
    active_threads = {}
    
    while True:
        try:
            all_cameras = list(cameras_col.find())
            enabled_cams = {cam.get("stream_key") or cam.get("id"): cam for cam in all_cameras if cam.get("enabled") is not False}
            
            # Start new cameras
            for cam_id, cam_data in enabled_cams.items():
                stream_key = cam_data.get("stream_key") or cam_id
                if cam_id not in active_threads:
                    stop_event = threading.Event()
                    
                    t_ffmpeg = threading.Thread(target=run_buffer_ffmpeg, args=(cam_id, stream_key, stop_event), daemon=True)
                    t_append = threading.Thread(target=append_worker, args=(cam_id, stop_event), daemon=True)
                    
                    t_ffmpeg.start()
                    t_append.start()
                    
                    active_threads[cam_id] = {"t_ffmpeg": t_ffmpeg, "t_append": t_append, "stop_event": stop_event}
                    
            # Stop disabled cameras
            for cam_id in list(active_threads.keys()):
                if cam_id not in enabled_cams:
                    print(f"[INSTANT-BUFFER] Camera {cam_id} was disabled. Stopping buffer...")
                    active_threads[cam_id]["stop_event"].set()
                    del active_threads[cam_id]
                    
        except Exception as e:
            print(f"[INSTANT-BUFFER] Database error: {e}")
            
        try:
            msg = pubsub.get_message(timeout=10.0)
            if msg and msg['type'] == 'message':
                print('[BUFFER] Instant config update received!')
        except Exception:
            time.sleep(10)

if __name__ == '__main__':
    main()
