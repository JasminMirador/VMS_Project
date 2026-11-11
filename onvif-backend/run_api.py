import os
import sys
from pathlib import Path

# ── Force UTF-8 output encoding on Windows ────────────────────────────────────
# Windows defaults to cp1252 which cannot encode emoji characters used in logs.
# This must be done before any other imports that may write to stdout/stderr.
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

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

import traceback
import threading
from datetime import datetime, timezone

def _handle_exception(exc_type, exc_value, exc_traceback):
    msg = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
    sys.stderr.write(f"\n[UNHANDLED EXCEPTION]\n{msg}\n")
    try:
        crash_log = Path(__file__).parent / "logs" / "backend_crash.log"
        crash_log.parent.mkdir(parents=True, exist_ok=True)
        with open(crash_log, "a", encoding="utf-8", errors="replace") as f:
            f.write(f"\n=== UNHANDLED EXCEPTION {datetime.now(timezone.utc).isoformat()} ===\n{msg}\n")
    except Exception:
        pass

sys.excepthook = _handle_exception
if hasattr(threading, "excepthook"):
    threading.excepthook = lambda args: _handle_exception(args.exc_type, args.exc_value, args.exc_traceback)

import uvicorn
if __name__ == "__main__":
    port = int(os.environ.get("BACKEND_PORT"))
    host = os.environ.get("BACKEND_HOST", "0.0.0.0")
    workers = int(os.environ.get("UVICORN_WORKERS", 4))
    print(f"[BACKEND] Launching Uvicorn on 0.0.0.0:{port} with {workers} workers...")
    try:
        uvicorn.run("app.main:app", host="0.0.0.0", port=port, workers=workers, reload=False)
    except Exception as e:
        msg = traceback.format_exc()
        sys.stderr.write(f"\n[UVICORN CRASH]\n{msg}\n")
        crash_log = Path(__file__).parent / "logs" / "backend_crash.log"
        crash_log.parent.mkdir(parents=True, exist_ok=True)
        with open(crash_log, "a", encoding="utf-8", errors="replace") as f:
            f.write(f"\n=== UVICORN CRASH {datetime.now(timezone.utc).isoformat()} ===\n{msg}\n")
        raise
