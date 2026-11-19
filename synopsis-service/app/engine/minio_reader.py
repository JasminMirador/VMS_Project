import os
import io
import tempfile
import logging
from pathlib import Path
from typing import Optional
from minio import Minio
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from app.config import settings

logger = logging.getLogger(__name__)

# AES Encryption Key Setup (loaded from video.key or env)
KEY_FILE = os.getenv("VIDEO_KEY_FILE", "devices_data/video.key")

def load_aes_key() -> bytes:
    candidate_paths = []
    if os.getenv("VIDEO_KEY_FILE"):
        candidate_paths.append(Path(os.getenv("VIDEO_KEY_FILE")))

    cur_dir = Path(__file__).resolve().parent
    # synopsis-service/devices_data/video.key
    candidate_paths.append(cur_dir.parent.parent / "devices_data" / "video.key")
    # VMS_Project/devices_data/video.key
    candidate_paths.append(cur_dir.parent.parent.parent / "devices_data" / "video.key")
    # VMS_Project/dist/recorder_service/devices_data/video.key
    candidate_paths.append(cur_dir.parent.parent.parent / "dist" / "recorder_service" / "devices_data" / "video.key")
    # VMS_Project/dist/api/devices_data/video.key
    candidate_paths.append(cur_dir.parent.parent.parent / "dist" / "api" / "devices_data" / "video.key")
    candidate_paths.append(Path("devices_data/video.key"))
    candidate_paths.append(Path("C:/app/data/video.key"))

    for p in candidate_paths:
        try:
            if p.exists() and p.is_file():
                with open(p, "rb") as f:
                    k = f.read()
                if len(k) >= 16:
                    return k[:32].ljust(32, b'\0')
        except Exception:
            pass

    return b"mirador_vms_secret_aes_key_32b!!"

def get_aes_key() -> bytes:
    return load_aes_key()

AES_KEY = load_aes_key()

class MinioEncryptedReader:
    def __init__(self):
        self.minio_client = None
        self.bucket = os.environ.get("MINIO_BUCKET", "vms-recordings")
        self._init_client()

    def _init_client(self):
        endpoint = os.environ.get("MINIO_ENDPOINT", "192.168.126.2:9000")
        access_key = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
        secret_key = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
       
        try:
            self.minio_client = Minio(
                endpoint,
                access_key=access_key,
                secret_key=secret_key,
                secure=False
            )
            logger.info(f"Initialized MinIO client connected to: {endpoint} (Bucket: {self.bucket})")
        except Exception as e:
            logger.error(f"Failed to initialize MinIO client: {e}")

    def decrypt_minio_file_to_temp(self, minio_key: str) -> str:
        """
        Fetches an encrypted file (.enc) from MinIO storage or local disk, performs AES-256 CBC/CTR decryption,
        and saves it to a temporary MP4/TS file for GPU synopsis processing.
        """
        active_key = get_aes_key()

        # Handle local disk file vs MinIO object
        is_local = minio_key.startswith("local:") or (not minio_key.startswith("minio:") and (Path(minio_key).exists() or ":\\" in minio_key or ":/" in minio_key))
        if is_local:
            local_path = minio_key.replace("local:", "").strip()
            logger.info(f"Fetching encrypted recording from local path: [{local_path}]...")
            with open(local_path, "rb") as f:
                raw_encrypted_bytes = f.read()
        else:
            if not self.minio_client:
                raise RuntimeError("MinIO client is not initialized.")

            clean_key = minio_key.replace("minio:", "").strip()
            if not clean_key.endswith(".enc"):
                clean_key = clean_key + ".enc"

            logger.info(f"Fetching encrypted recording from MinIO: [{clean_key}]...")
            try:
                response = self.minio_client.get_object(self.bucket, clean_key)
                raw_encrypted_bytes = response.read()
                response.close()
                response.release_conn()
            except Exception as e:
                logger.error(f"Error fetching MinIO file [{clean_key}]: {e}")
                raise e

        try:
            if len(raw_encrypted_bytes) < 16:
                raise ValueError(f"Encrypted object too small ({len(raw_encrypted_bytes)} bytes)")

            is_ctr = raw_encrypted_bytes.startswith(b'CTR\x00')
            if is_ctr:
                iv = raw_encrypted_bytes[4:20]
                ciphertext = raw_encrypted_bytes[20:]
                cipher = Cipher(algorithms.AES(active_key), modes.CTR(iv), backend=default_backend())
                decryptor = cipher.decryptor()
                decrypted_bytes = decryptor.update(ciphertext) + decryptor.finalize()
            else:
                iv = raw_encrypted_bytes[:16]
                ciphertext = raw_encrypted_bytes[16:]
               
                # Resilient handling for truncated files
                extra = len(ciphertext) % 16
                if extra != 0:
                    ciphertext = ciphertext[:-extra]

                cipher = Cipher(algorithms.AES(active_key), modes.CBC(iv), backend=default_backend())
                dec = cipher.decryptor()
                padded = dec.update(ciphertext) + dec.finalize()
               
                from cryptography.hazmat.primitives import padding
                try:
                    unpadder = padding.PKCS7(128).unpadder()
                    decrypted_bytes = unpadder.update(padded) + unpadder.finalize()
                except Exception as pad_err:
                    logger.warning(f"PKCS7 unpadding failed, saving padded data. Error: {pad_err}")
                    decrypted_bytes = padded

            # Detect whether decrypted content is MPEG-TS (starts with 0x47 sync byte) or MP4
            if decrypted_bytes and decrypted_bytes[0] == 0x47:
                suffix = ".ts"
            else:
                suffix = ".mp4"

            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            temp_file.write(decrypted_bytes)
            temp_file.close()

            logger.info(f"Successfully decrypted clip to temporary file: {temp_file.name} (size: {len(decrypted_bytes)} bytes)")
            return temp_file.name

        except Exception as e:
            logger.error(f"Error decrypting clip [{minio_key}]: {e}")
            raise e
