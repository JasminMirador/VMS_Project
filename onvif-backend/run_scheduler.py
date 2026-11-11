import os
# Disable OpenCV OpenCL globally to prevent Intel igdfcl64.dll crashes
os.environ["OPENCV_OPENCL_RUNTIME"] = "disabled"
os.environ["OPENCV_OPENCL_DEVICE"] = "disabled"

import requests
# Global requests timeout patch to prevent third-party libraries from hanging indefinitely on network requests
_orig_send = requests.Session.send
def _patched_send(self, request, **kwargs):
    kwargs.setdefault('timeout', 8)
    return _orig_send(self, request, **kwargs)
requests.Session.send = _patched_send

try:
    import cv2
    cv2.ocl.setUseOpenCL(False)
except ImportError:
    pass

import os
from pathlib import Path

# Load .env file from local directory (onvif-backend/.env)
env_path = Path(__file__).parent / ".env"
if not env_path.exists():
    env_path = Path(__file__).parent.parent / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, val = line.split("=", 1)
            val = val.strip().strip("'\"")
            os.environ.setdefault(key.strip(), val)

from schedulers.main import start
if __name__ == "__main__":
    start()
