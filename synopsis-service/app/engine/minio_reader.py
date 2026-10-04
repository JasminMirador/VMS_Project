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
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            key = f.read()
        padded = key[:32].ljust(32, b'\0')
        return padded
    # Default 32-byte AES fallback key matching onvif-backend
    return b"mirador_vms_secret_aes_key_32b!!"

AES_KEY = load_aes_key()

class MinioEncryptedReader:
    def __init__(self):
        self.minio_client = None
        self.bucket = os.getenv("MINIO_BUCKET", "vms-recordings")
        self._init_client()

    def _init_client(self):
        endpoint = os.getenv("MINIO_ENDPOINT", "localhost:9000")
        access_key = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
        secret_key = os.getenv("MINIO_SECRET_KEY", "minioadmin")
        
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
        Fetches an encrypted file (.enc) from MinIO storage, performs AES-256 CBC/CTR decryption,
        and saves it to a temporary MP4 file for GPU synopsis processing.
        """
        if not self.minio_client:
            raise RuntimeError("MinIO client is not initialized.")

        # Clean minio: prefix if present
        clean_key = minio_key.replace("minio:", "")
        if not clean_key.endswith(".enc"):
            clean_key = clean_key + ".enc"

        logger.info(f"Fetching encrypted recording from MinIO: [{clean_key}]...")

        try:
            response = self.minio_client.get_object(self.bucket, clean_key)
            raw_encrypted_bytes = response.read()
            response.close()
            response.release_conn()

            if len(raw_encrypted_bytes) < 16:
                raise ValueError(f"Encrypted object too small ({len(raw_encrypted_bytes)} bytes)")

            is_ctr = raw_encrypted_bytes.startswith(b'CTR\x00')
            if is_ctr:
                iv = raw_encrypted_bytes[4:20]
                ciphertext = raw_encrypted_bytes[20:]
                cipher = Cipher(algorithms.AES(AES_KEY), modes.CTR(iv), backend=default_backend())
                decryptor = cipher.decryptor()
                decrypted_bytes = decryptor.update(ciphertext) + decryptor.finalize()
            else:
                iv = raw_encrypted_bytes[:16]
                ciphertext = raw_encrypted_bytes[16:]
                
                # Resilient handling for truncated files
                extra = len(ciphertext) % 16
                if extra != 0:
                    ciphertext = ciphertext[:-extra]

                cipher = Cipher(algorithms.AES(AES_KEY), modes.CBC(iv), backend=default_backend())
                dec = cipher.decryptor()
                padded = dec.update(ciphertext) + dec.finalize()
                
                from cryptography.hazmat.primitives import padding
                try:
                    unpadder = padding.PKCS7(128).unpadder()
                    decrypted_bytes = unpadder.update(padded) + unpadder.finalize()
                except Exception as pad_err:
                    logger.warning(f"PKCS7 unpadding failed, saving padded data. Error: {pad_err}")
                    decrypted_bytes = padded

            # Create temporary TS file for synopsis engine since onvif-backend uses MPEG-TS
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".ts")
            temp_file.write(decrypted_bytes)
            temp_file.close()

            logger.info(f"Successfully decrypted MinIO clip to temporary file: {temp_file.name}")
            return temp_file.name

        except Exception as e:
            logger.error(f"Error fetching/decrypting MinIO file [{clean_key}]: {e}")
            raise e
