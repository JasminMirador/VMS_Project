import os
# Disable OpenCV OpenCL globally to prevent Intel igdfcl64.dll crashes
os.environ["OPENCV_OPENCL_RUNTIME"] = "disabled"
os.environ["OPENCV_OPENCL_DEVICE"] = "disabled"

try:
    import cv2
    cv2.ocl.setUseOpenCL(False)
except ImportError:
    pass

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
import sys

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from app.api.routers.auth_router import limiter

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

from app.utils.terminal_logger import log_terminal

# Import lifecycle
from app.core.lifecycle import lifespan

# Import all routers
from app.api.routers.auth_router import router as auth_router
from app.api.routers.playback_router import router as playback_router
from app.api.routers.camera_router import router as camera_router, features_router
from app.api.routers.dashboard_router import router as dashboard_router
from app.api.routers.system_router import router as system_router
from app.api.routers.storage_router_ext import router as storage_router_ext
from app.api.routers.dashboard_diagnostics_router import router as dashboard_diagnostics_router
# Existing routers from other files that were already separate
from app.api.routers.recording_api import recording_router, storage_router
from app.api.routers.masks_router import router as masks_router
from recorder.segment_receiver import full_rec_router
from recorder.backup_service import backup_router
from app.api.routers.logs_router import router as logs_router
from app.api.routers.brand_control import brand_router
from monitoring.router import router as infrastructure_router
from app.api.routers.camera_analytics_router import camera_analytics_router
from app.api.routers.maps_router import router as maps_router
from app.api.routers.designer_router import router as designer_router
# from app.api.routers.forensic_api import forensic_router
from app.api.routers.viewing_stations_router import router as viewing_stations_router
from app.api.routers.monitoring_api import router as monitoring_api_router
from app.api.routers.reports_router import router as reports_router
from app.api.routers.ai_alerts_router import router as ai_alerts_router, reader_router
from app.api.routers.integrations_router import router as integrations_router
from app.api.storage.router import router as storage_management_router
from app.api.routers.events_ws_router import router as events_ws_router
import threading
import queue

class LoggerWrapper:
    _local = threading.local()
    _queue = queue.Queue()
    _worker_started = False
    _lock = threading.Lock()

    @classmethod
    def _worker(cls):
        while True:
            try:
                msg = cls._queue.get()
                if msg is None:
                    break
                log_terminal("admin@gmail.com", "admin", "system log", "backend", 0, msg)
                cls._queue.task_done()
            except Exception:
                pass

    def write(self, message):
        if getattr(self._local, "in_write", False):
            try:
                sys.__stdout__.write(message)
            except UnicodeEncodeError:
                enc = getattr(sys.__stdout__, 'encoding', 'utf-8') or 'utf-8'
                sys.__stdout__.write(message.encode(enc, errors='replace').decode(enc))
            return
        
        self._local.in_write = True
        try:
            msg = message.strip()
            if msg and ("[WATCHDOG]" in msg or "[ENCRYPT]" in msg or "[RTSP]" in msg or "ERROR" in msg or "❌" in msg):
                if not LoggerWrapper._worker_started:
                    with LoggerWrapper._lock:
                        if not LoggerWrapper._worker_started:
                            t = threading.Thread(target=LoggerWrapper._worker, daemon=True, name="bg-logger-worker")
                            t.start()
                            LoggerWrapper._worker_started = True
                LoggerWrapper._queue.put(msg)
        except Exception:
            pass
        finally:
            self._local.in_write = False

        try:
            from datetime import datetime
            if getattr(self,"_newline",True) and message.strip():
                ts=datetime.now().strftime("[%Y-%m-%d %H:%M:%S]")
                sys.__stdout__.write(ts)
            sys.__stdout__.write(message)
            self._newline=message.endswith("\n")
        except UnicodeEncodeError:
            enc = getattr(sys.__stdout__, 'encoding', 'utf-8') or 'utf-8'
            sys.__stdout__.write(message.encode(enc, errors='replace').decode(enc))

    def isatty(self):
        return getattr(sys.__stdout__, "isatty", lambda: False)()

    def fileno(self):
        return getattr(sys.__stdout__, "fileno", lambda: 1)()

    @property
    def encoding(self):
        return getattr(sys.__stdout__, "encoding", "utf-8") or "utf-8"

    @property
    def errors(self):
        return getattr(sys.__stdout__, "errors", "replace") or "replace"

    def flush(self):
        try:
            sys.__stdout__.flush()
        except Exception:
            pass

sys.stdout = LoggerWrapper()

app = FastAPI(title="MIRADOR ONVIF Backend", lifespan=lifespan)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
from app.core.logger import log_security_event

async def custom_rate_limit_handler(request: Request, exc: RateLimitExceeded):
    client_ip = request.headers.get("X-Forwarded-For")
    if client_ip:
        client_ip = client_ip.split(",")[0].strip()
    else:
        client_ip = request.headers.get("X-Real-IP") or (request.client.host if request.client else "Unknown")
    if client_ip:
        if client_ip.startswith("::ffff:"):
            client_ip = client_ip.replace("::ffff:", "")
        elif client_ip == "::1":
            client_ip = "127.0.0.1"

    log_security_event("CRITICAL", "RATE_LIMIT_EXCEEDED", f"Rate limit exceeded on {request.url.path}", client_ip)
    
    # Notify client about rate limit
    def notify_rate_limit():
        try:
            client_email = None
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header.split(" ")[1]
                try:
                    from app.core.security import PRIVATE_KEY
                    from jose import jwt, jwe
                    try:
                        decrypted_bytes = jwe.decrypt(token, PRIVATE_KEY)
                        token = decrypted_bytes.decode("utf-8")
                    except Exception:
                        pass
                    payload = jwt.get_unverified_claims(token)
                    client_email = payload.get("email")
                    if not client_email and "sub" in payload:
                        from app.core.database import users_col
                        from bson import ObjectId
                        user_id = payload["sub"]
                        try:
                            user_doc = users_col.find_one({"_id": ObjectId(user_id)})
                            if user_doc:
                                client_email = user_doc.get("email")
                        except Exception:
                            pass
                    print(f"[RATE_LIMIT_EMAIL] Extracted email: {client_email}")
                except Exception as ex:
                    print(f"[RATE_LIMIT_EMAIL] Token decode error: {ex}")
            
            target = client_email if client_email else os.environ.get("ALERT_EMAIL_FROM", "admin@vms.local")
            print(f"[RATE_LIMIT_EMAIL] Sending alert email to target: {target}")
            from app.services.email_service import send_manual_email
            subject = "Mirador VMS: Rate Limit Exceeded Alert"
            body = f"<p>Hello,</p><p>You have exceeded your API rate limit quota on path <b>{request.url.path}</b> from IP <b>{client_ip}</b>. Please wait for your quota to reset before making more requests.</p>"
            success, msg = send_manual_email([target], subject, body)
            print(f"[RATE_LIMIT_EMAIL] Email send result - Success: {success}, Message: {msg}")
        except Exception as e:
            print(f"[RATE_LIMIT_EMAIL] Error sending rate limit notification: {e}")

    try:
        import asyncio
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, notify_rate_limit)
    except Exception as e:
        print(f"Error scheduling rate limit notification: {e}")

    return _rate_limit_exceeded_handler(request, exc)

app.add_exception_handler(RateLimitExceeded, custom_rate_limit_handler)

@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    with open("crash.log", "w") as f:
        import traceback
        traceback.print_exc(file=f)
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Content-Security-Policy"] = "default-src 'self'"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response

import re as _re

_INJECTION_PATTERNS = [
    # XSS patterns
    (_re.compile(r"<script[\s\S]*?>", _re.IGNORECASE), "XSS"),
    (_re.compile(r"javascript\s*:", _re.IGNORECASE), "XSS"),
    (_re.compile(r"on\w+\s*=\s*[\"']", _re.IGNORECASE), "XSS"),
    (_re.compile(r"<\s*img[^>]+onerror", _re.IGNORECASE), "XSS"),
    (_re.compile(r"<\s*iframe", _re.IGNORECASE), "XSS"),
    # SQL Injection patterns
    (_re.compile(r"(\bor\b|\band\b)\s+\d+=\d+", _re.IGNORECASE), "SQL_INJECTION"),
    (_re.compile(r"(union\s+select|select\s+.+from|insert\s+into|drop\s+table|delete\s+from|update\s+.+set)", _re.IGNORECASE), "SQL_INJECTION"),
    (_re.compile(r"'?\s*(or|and)\s+'?1'?\s*=\s*'?1", _re.IGNORECASE), "SQL_INJECTION"),
    (_re.compile(r";\s*(drop|delete|truncate|alter)\s", _re.IGNORECASE), "SQL_INJECTION"),
    (_re.compile(r"--\s*$", _re.MULTILINE), "SQL_INJECTION"),
    # Path traversal
    (_re.compile(r"\.\./|\.\.\\", _re.IGNORECASE), "PATH_TRAVERSAL"),
]

def _get_client_ip(request: Request) -> str:
    ip = request.headers.get("X-Forwarded-For")
    if ip:
        ip = ip.split(",")[0].strip()
    else:
        ip = request.headers.get("X-Real-IP") or (request.client.host if request.client else "Unknown")
    if ip:
        if ip.startswith("::ffff:"):
            ip = ip.replace("::ffff:", "")
        elif ip == "::1":
            ip = "127.0.0.1"
    return ip or "Unknown"

def _scan_for_injections(value: str, source: str, path: str, ip: str):
    print(f"[SECURITY DEBUG] Checking {source}: {value[:200]}")
    for pattern, attack_type in _INJECTION_PATTERNS:
        if pattern.search(value):
            log_security_event(
                "CRITICAL",
                f"INJECTION_ATTEMPT_{attack_type}",
                f"Possible {attack_type} detected in {source} at {path} | Payload: {value[:200]}",
                ip
            )
            break  # one alert per field is enough

@app.middleware("http")
async def detect_injection_attacks(request: Request, call_next):
    ip = _get_client_ip(request)
    path = request.url.path
    print(f"[SECURITY] Scanning request: {request.method} {path}")

    # Scan query parameters
    for key, value in request.query_params.items():
        _scan_for_injections(value, f"query_param[{key}]", path, ip)

    # Scan request body (only for JSON endpoints, skip streaming like video/ws)
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            body_bytes = await request.body()
            if body_bytes:
                body_str = body_bytes.decode("utf-8", errors="ignore")
                _scan_for_injections(body_str, "request_body", path, ip)
             # Rebuild the receive channel so downstream handlers can read the body
            async def _replay_receive():
                return {"type": "http.request", "body": body_bytes, "more_body": False}

            request._receive = _replay_receive
            # Also cache on _body for any code that calls request.body() directly
            request._body = body_bytes
        except Exception:
            pass

    response = await call_next(request)
    return response

@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
    # Enforce maximum request size dynamically based on content type
    # - application/json: Strictly limited to 5MB (Fixes the Designer View Map Upload vulnerability)
    # - multipart/form-data: Allowed up to 2GB to support 150MB+ encrypted video playback/decryption uploads
    content_length = request.headers.get("content-length")
    if content_length:
        length = int(content_length)
        content_type = request.headers.get("content-type", "")
        
        if "application/json" in content_type:
            if length > 5_242_880:  # 5MB
                from fastapi.responses import JSONResponse
                return JSONResponse(status_code=413, content={"detail": "Payload Too Large: JSON requests exceed 5MB limit"})
        elif "multipart/form-data" in content_type or "application/octet-stream" in content_type or "/_rec_full" in request.url.path:
            if length > 2_147_483_648:  # 2GB limit for binary/recording uploads
                from fastapi.responses import JSONResponse
                return JSONResponse(status_code=413, content={"detail": "Payload Too Large: File upload exceeds 2GB limit"})
        else:
            if length > 52_428_800:  # 50MB for other types
                from fastapi.responses import JSONResponse
                return JSONResponse(status_code=413, content={"detail": "Payload Too Large"})

    return await call_next(request)

import asyncio
import concurrent.futures

@app.on_event("startup")
async def _startup_segment_recovery():
    print("[STARTUP] Running segment receiver recovery...")
    loop = asyncio.get_running_loop()
    loop.set_default_executor(concurrent.futures.ThreadPoolExecutor(max_workers=100))
    print("[STARTUP] Set default ThreadPoolExecutor max_workers to 100")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+|14\.99\.8\.170)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

faces_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "faces")
os.makedirs(faces_dir, exist_ok=True)
app.mount("/api/faces", StaticFiles(directory=faces_dir), name="faces")

# Persistent snapshots dir (snapshots captured at alert time)
snapshots_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "snapshots")
os.makedirs(snapshots_dir, exist_ok=True)
app.mount("/api/snapshots", StaticFiles(directory=snapshots_dir), name="snapshots")


# Register all routers
from app.api.routers.groups_router import router as groups_router
from app.api.routers.integrations_router import router as integrations_router
app.include_router(events_ws_router)
app.include_router(auth_router)
app.include_router(playback_router)
app.include_router(camera_router)
app.include_router(features_router)
app.include_router(dashboard_router)
app.include_router(system_router)
app.include_router(storage_router_ext)
app.include_router(dashboard_diagnostics_router)
app.include_router(groups_router)
app.include_router(integrations_router)

app.include_router(full_rec_router)  # NEW: continuous 5-min recording endpoint
app.include_router(recording_router)
app.include_router(storage_router)
app.include_router(masks_router)
app.include_router(backup_router)
app.include_router(brand_router)
app.include_router(logs_router)
app.include_router(camera_analytics_router)
app.include_router(maps_router)
app.include_router(designer_router)
app.include_router(infrastructure_router)
# app.include_router(forensic_router)
app.include_router(viewing_stations_router)
app.include_router(monitoring_api_router)
app.include_router(reports_router)
app.include_router(ai_alerts_router)
app.include_router(reader_router)
app.include_router(integrations_router)
app.include_router(storage_management_router)
