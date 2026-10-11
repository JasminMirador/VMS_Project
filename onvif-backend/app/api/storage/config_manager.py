import os
import json
import re
from dotenv import set_key, load_dotenv

class StorageConfig:
    def __init__(self):
        # file is at onvif-backend/app/api/storage/config_manager.py -> go up 4 levels to VMS_Project root
        self.root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
        self.config_path = os.path.join(self.root_dir, "config", "config.json")
        self.env_path = os.path.join(self.root_dir, ".env")
        self.mtx_path = os.path.join(self.root_dir, "mediamtx.yml")
        
        # Ensure config.json exists
        if not os.path.exists(self.config_path):
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            self._write_config({
                "storage": {"recording_path": "E:\\REC", "filesystem": "NTFS", "allocation_unit": 65536},
                "mediamtx": {"record_path": "E:\\REC\\MediaMTX"},
                "minio": {"bucket": "recordings"},
                "services": {"mediamtx": "MediaMTX", "stream_manager": "mirador-failover-watchdog", "minio": "MinIO"}
            })

    def _read_config(self) -> dict:
        with open(self.config_path, "r") as f:
            return json.load(f)

    def _write_config(self, data: dict):
        with open(self.config_path, "w") as f:
            json.dump(data, f, indent=2)

    def get_recording_path(self) -> str:
        data = self._read_config()
        return data.get("storage", {}).get("recording_path", "E:\\REC")

    def set_recording_path(self, new_path: str):
        # 1. Update config.json
        data = self._read_config()
        if "storage" not in data:
            data["storage"] = {}
        data["storage"]["recording_path"] = new_path
        
        if "mediamtx" not in data:
            data["mediamtx"] = {}
        data["mediamtx"]["record_path"] = f"{new_path}\\MediaMTX"

        if "minio" in data:
            data["minio"]["data_dir"] = new_path

        self._write_config(data)
        
        # 2. Sync to .env (legacy support)
        if os.path.exists(self.env_path):
            set_key(self.env_path, "RECORDINGS_DIR", new_path)
            
        # 3. Sync to mediamtx.yml
        if os.path.exists(self.mtx_path):
            with open(self.mtx_path, "r") as f:
                content = f.read()
            content = re.sub(r'(?m)^\s*recordPath:\s*.*$', f"  recordPath: {new_path}\\mediamtx\\%path\\%Y-%m-%d_%H-%M-%S-%f", content)
            with open(self.mtx_path, "w") as f:
                f.write(content)

    def get_retention_days(self) -> int:
        load_dotenv(self.env_path)
        try:
            return int(os.environ.get("RETENTION_DAYS", "30"))
        except ValueError:
            return 30

    def set_retention_days(self, days: int):
        if os.path.exists(self.env_path):
            set_key(self.env_path, "RETENTION_DAYS", str(days))
