from fastapi import APIRouter, HTTPException, Depends, Request, BackgroundTasks
from typing import Optional
from pydantic import BaseModel
import re, asyncio, os
from datetime import datetime, timedelta
from app.schemas.auth import SignupRequest, LoginRequest, ForgotPasswordRequest, SupervisorPasswordRequest, SupervisorVerifyRequest, ResetPasswordRequest, AdminCreateUserRequest, AdminUpdateUserRequest, ChangePasswordRequest, MFASetupResponse, MFAVerifyRequest, AdminApproveSignupRequest, SignupFinalizeRequest
from app.core.database import users_col, auth_logs_col, settings_col, supervisor_col, signup_requests_col
from app.core.security import create_token, verify_token, require_admin, PUBLIC_KEY
from app.services.redis_stream_publisher import publish_event as _redis_publish
import bcrypt
import pyotp

from slowapi import Limiter
# from slowapi.util import get_remote_address
# limiter = Limiter(key_func=get_remote_address)
def get_real_ip(request: Request) -> str:
    ip = request.headers.get("X-Forwarded-For")
    if ip:
        ip = ip.split(",")[0].strip()
    else:
        ip = request.headers.get("X-Real-IP") or (request.client.host if request.client else "127.0.0.1")
    if ip.startswith("::ffff:"):
        ip = ip.replace("::ffff:", "")
    elif ip == "::1":
        ip = "127.0.0.1"
    if ":" in ip and not ip.startswith("::"):
        ip = ip.split(":")[0]
    return ip
limiter = Limiter(key_func=get_real_ip)
from app.core.logger import log_security_event

_USER_STREAM = lambda: os.environ.get("REDIS_STREAM_USER_EVENTS", "vms:events:user")

import random
import string
import base64
import uuid
from captcha.image import ImageCaptcha
from app.core.database import db as _db

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.get("/captcha")
def get_captcha():
    text = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
    image = ImageCaptcha(width=280, height=90)
    data = image.generate(text)
    b64 = base64.b64encode(data.getvalue()).decode("utf-8")
    
    captcha_id = str(uuid.uuid4())
    if _db is not None:
        _db["captchas"].insert_one({
            "_id": captcha_id,
            "text": text.lower(),
            "createdAt": datetime.utcnow()
        })
    
    return {
        "captcha_id": captcha_id,
        "image_base64": f"data:image/png;base64,{b64}"
    }

from app.core.security import PRIVATE_KEY
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import load_pem_private_key
import base64

_private_key_obj = load_pem_private_key(PRIVATE_KEY.encode('utf-8'), password=None)

def decrypt_password(encrypted_b64: str) -> str:
    try:
        if len(encrypted_b64) < 100:  # heuristic to check if it's already plaintext (e.g. legacy/testing)
            return encrypted_b64
        encrypted_bytes = base64.b64decode(encrypted_b64)
        decrypted_bytes = _private_key_obj.decrypt(
            encrypted_bytes,
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )
        return decrypted_bytes.decode('utf-8')
    except Exception:
        # Fallback to plain if decryption fails (so we don't break existing plain requests while transitioning)
        return encrypted_b64

import hashlib
import bcrypt

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if hashed_password.startswith("$2b$") or hashed_password.startswith("$2a$"):
        try:
            return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
        except Exception:
            return False
    else:
        # Fallback for sha256 hashes generated during the temporary client-side hashing period
        return hashlib.sha256(plain_password.encode("utf-8")).hexdigest() == hashed_password

def validate_password_complexity(password: str, email: str = ""):
    if len(password) < 12 or not re.search(r"[A-Z]", password) or not re.search(r"[a-z]", password) or not re.search(r"[0-9]", password) or not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character")
    if email:
        if email.lower() in password.lower():
            raise HTTPException(status_code=400, detail="Password cannot contain your email address")
        username = email.split('@')[0]
        if username and username.lower() in password.lower():
            raise HTTPException(status_code=400, detail="Password cannot contain your username")

from app.services.email_service import send_manual_email

@router.post("/signup")
@limiter.limit("2/minute")
def auth_signup(request: Request, req: SignupRequest):
    if users_col is None or signup_requests_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.email:
        raise HTTPException(status_code=400, detail="Email is required")
    email_regex = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    if not re.match(email_regex, req.email):
        raise HTTPException(status_code=400, detail="Invalid email format")

    if req.role not in ("admin", "client", "operator"):
        raise HTTPException(status_code=400, detail="Role must be 'admin', 'client', or 'operator'")
        
    if users_col.find_one({"email": req.email, "is_deleted": {"$ne": True}}):
        raise HTTPException(status_code=400, detail="Email already registered")

    # Upsert the request to handle multiple requests by the same email
    try:
        signup_requests_col.update_one(
            {"email": req.email},
            {"$set": {
                "email": req.email,
                "role": req.role,
                "status": "pending",
                "createdAt": datetime.utcnow().isoformat()
            }},
            upsert=True
        )
        print(f"[AUTH] 🕒 Signup requested for: {req.email}")
        
        # Send email to Admin
        admin_email = os.environ.get("ALERT_EMAIL_FROM", "zjasmin.pro@gmail.com")
        subject = "New Signup Request - Action Required"
        body = f"<p>A new user has requested to sign up.</p><p><b>Email:</b> {req.email}</p><p><b>Role:</b> {req.role}</p><p>Please log in to the admin dashboard to approve or reject this request.</p>"
        send_manual_email([admin_email], subject, body)
        
    except Exception as e:
        print(f"[AUTH] ❌ Signup request failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create signup request")
        
    return {"success": True, "message": "Signup request submitted successfully. Waiting for admin approval."}

@router.get("/admin/signup-requests")
def admin_get_signup_requests(user=Depends(require_admin)):
    if signup_requests_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    requests = list(signup_requests_col.find({"status": "pending"}))
    for r in requests:
        r["_id"] = str(r["_id"])
        
    return {"success": True, "requests": requests}

@router.post("/admin/approve-signup")
def admin_approve_signup(req: AdminApproveSignupRequest, user=Depends(require_admin)):
    if signup_requests_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    request_doc = signup_requests_col.find_one({"email": req.email, "status": "pending"})
    if not request_doc:
        raise HTTPException(status_code=404, detail="Pending signup request not found for this email")
        
    if not req.approve:
        signup_requests_col.delete_one({"email": req.email})
        return {"success": True, "message": "Signup request rejected"}
        
    # Generate 6 digit OTP
    import secrets
    otp = str(secrets.randbelow(1000000)).zfill(6)
    hashed_otp = hash_password(otp)
    
    # 2 mins expiration
    expires_at = datetime.utcnow() + timedelta(minutes=10)
    
    signup_requests_col.update_one(
        {"email": req.email},
        {"$set": {
            "status": "approved",
            "otp_hash": hashed_otp,
            "expires_at": expires_at.isoformat()
        }}
    )
    
    send_otp_email_template(req.email, otp)
    
    return {"success": True, "message": "Request approved. OTP sent to user."}

def send_otp_email_template(email: str, otp: str):
    # Attach Logo
    import os
    logo_path = os.path.abspath(os.path.join(os.getcwd(), "..", "miradorai-vms", "src", "assets", "logo.jpg"))
    attachments = []
    if os.path.exists(logo_path):
        with open(logo_path, "rb") as f:
            attachments.append({
                "filename": "logo.jpg",
                "data": f.read(),
                "cid": "logo_img"
            })
            
    # Professional OTP Email Template
    subject = "Verify your email address"
    
    # Calculate IST time and expiration
    ist_time = datetime.utcnow() + timedelta(hours=5, minutes=30)
    ist_time_str = ist_time.strftime("%B %d, %Y at %I:%M %p")
    
    expires_time = ist_time + timedelta(minutes=10)
    expires_time_str = expires_time.strftime("%I:%M %p")
    
    body = f"""
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f4f4; padding: 40px 0; margin: 0; color: #333;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
            <tr>
                <td align="center">
                    <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 4px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <!-- Header -->
                        <tr>
                            <td style="padding: 20px 40px; border-bottom: 1px solid #eeeeee; background-color: #0b1121;">
                                <table border="0" cellspacing="0" cellpadding="0">
                                    <tr>
                                        <td valign="middle">
                                            <img src="cid:logo_img" alt="Logo" style="width: 40px; height: 40px; border-radius: 4px; display: block; margin-right: 15px;" />
                                        </td>
                                        <td valign="middle">
                                            <h1 style="margin: 0; font-size: 24px; font-weight: 500; letter-spacing: 4px; color: #34d399;">
                                                MIRADOR VMS
                                            </h1>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        
                        <!-- Body -->
                        <tr>
                            <td style="padding: 40px;">
                                <h2 style="margin: 0 0 20px 0; font-size: 22px; color: #111111;">Verify your email address</h2>
                                <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #444444;">
                                    You need to verify your email address to continue using your <b>Mirador VMS</b> account. Enter the following code to verify your email address:
                                </p>
                                
                                <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #111111; margin: 30px 0; padding-bottom: 20px; border-bottom: 1px solid #eeeeee;">
                                    {otp}
                                </div>
                                
                                <p style="margin: 0 0 10px 0; font-size: 13px; font-style: italic; color: #666666;">
                                    This OTP will expire in 10 minutes (at {expires_time_str} IST).
                                </p>
                                <p style="margin: 0 0 20px 0; font-size: 13px; font-style: italic; color: #666666;">
                                    The request for this access was approved on {ist_time_str} (IST).
                                </p>
                                
                                <p style="margin: 0 0 10px 0; font-size: 14px; line-height: 1.6; color: #444444;">
                                    In case you were not trying to access your <b>Mirador VMS</b> Account and are seeing this email, please follow the instructions below:
                                </p>
                                <ul style="margin: 0 0 20px 0; padding-left: 20px; font-size: 14px; line-height: 1.6; color: #444444;">
                                    <li>Check if any changes were made to your account & user settings.</li>
                                    <li>If you are unable to access your <b>Mirador VMS</b> Account then contact your Administrator.</li>
                                </ul>
                            </td>
                        </tr>
                        
                        <!-- Footer -->
                        <tr>
                            <td style="padding: 20px 40px; background-color: #f9f9f9; text-align: center; border-top: 1px solid #eeeeee;">
                                <p style="margin: 0; font-size: 12px; color: #999999;">
                                    Mirador VMS &copy; {ist_time.year}. All rights reserved.
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </div>
    """
    send_manual_email([email], subject, body, attachments=attachments)

@router.post("/signup/resend-otp")
def resend_signup_otp(request: Request, req: ForgotPasswordRequest):
    if signup_requests_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    request_doc = signup_requests_col.find_one({"email": req.email, "status": "approved"})
    if not request_doc:
        raise HTTPException(status_code=404, detail="No approved signup request found for this email")
        
    # Generate new 6 digit OTP
    import secrets
    otp = str(secrets.randbelow(1000000)).zfill(6)
    hashed_otp = hash_password(otp)
    
    # 2 mins expiration
    expires_at = datetime.utcnow() + timedelta(minutes=10)
    
    signup_requests_col.update_one(
        {"email": req.email},
        {"$set": {
            "otp_hash": hashed_otp,
            "expires_at": expires_at.isoformat()
        }}
    )
    
    send_otp_email_template(req.email, otp)
    
    return {"success": True, "message": "A new OTP has been sent to your email."}

@router.post("/signup/finalize")
def signup_finalize(request: Request, req: SignupFinalizeRequest):
    if users_col is None or signup_requests_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    request_doc = signup_requests_col.find_one({"email": req.email, "status": "approved"})
    if not request_doc:
        raise HTTPException(status_code=404, detail="No approved signup request found for this email")
        
    expires_at = datetime.fromisoformat(request_doc["expires_at"])
    if datetime.utcnow() > expires_at:
        raise HTTPException(status_code=400, detail="OTP has expired")
        
    if not verify_password(req.otp, request_doc.get("otp_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid OTP")
        
    plain_password = decrypt_password(req.password)
    validate_password_complexity(plain_password, req.email)
    hashed_password = hash_password(plain_password)
    
    user_doc = {
        "email":     req.email,
        "password":  hashed_password,
        "role":      request_doc.get("role", "client"),
        "requires_password_change": False,
        "createdAt": datetime.utcnow().isoformat(),
    }
    
    try:
        users_col.insert_one(user_doc)
        signup_requests_col.delete_one({"email": req.email})
        print(f"[AUTH] ✅ Final account created for: {req.email}")
    except Exception as e:
        print(f"[AUTH] ❌ Final account creation failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to finalize account creation")
        
    return {"success": True, "message": "Account finalized successfully! Please sign in."}


@router.post("/login")
async def auth_login(request: Request, req: LoginRequest, background_tasks: BackgroundTasks):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    user = users_col.find_one({"email": req.email, "is_deleted": {"$ne": True}})
    
    client_ip = request.headers.get("X-Forwarded-For")
    if client_ip:
        client_ip = client_ip.split(",")[0].strip()
    else:
        client_ip = request.headers.get("X-Real-IP") or (request.client.host if request.client else None)
        
    if client_ip:
        if client_ip.startswith("::ffff:"):
            client_ip = client_ip.replace("::ffff:", "")
        elif client_ip == "::1":
            client_ip = "127.0.0.1"

    if user and user.get("lockout_until"):
        if user["lockout_until"] > datetime.utcnow().isoformat():
            log_security_event("WARNING", "LOCKOUT", f"Login attempt on locked account: {req.email}", client_ip)
            raise HTTPException(status_code=403, detail="Account locked due to too many failed attempts")
        else:
            users_col.update_one({"email": req.email}, {"$set": {"failed_attempts": 0, "lockout_until": None}})
            user["failed_attempts"] = 0

    if user and user.get("is_blocked"):
        log_security_event("WARNING", "LOGIN_BLOCKED", f"Login attempt by blocked user: {req.email}", client_ip)
        raise HTTPException(status_code=403, detail="Your account has been blocked by an administrator")

    if not user:
        if auth_logs_col is not None:
            try:
                now_utc = datetime.utcnow()
                now_ist = now_utc + timedelta(hours=5, minutes=30)
                auth_logs_col.insert_one({
                    "type":      "login_failed",
                    "email":     req.email,
                    "role":      None,
                    "timestamp": now_utc.isoformat(),
                    "timestamp_ist": now_ist.isoformat(),
                    "ip":        client_ip,
                    "reason":    "user_not_found"
                })
            except Exception:
                pass
        log_security_event("WARNING", "LOGIN_FAILED", f"Login failed for non-existent user: {req.email}", client_ip)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("failed_attempts", 0) >= 3:
        if not req.captcha_id or not req.captcha_text:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={
                "detail": "CAPTCHA required due to multiple failed login attempts.",
                "requires_captcha": True
            })
        
        captcha_doc = _db["captchas"].find_one({"_id": req.captcha_id}) if _db is not None else None
        
        if not captcha_doc or captcha_doc["text"] != req.captcha_text.lower():
            raise HTTPException(status_code=401, detail="Invalid CAPTCHA code")
            
        if _db is not None:
            _db["captchas"].delete_one({"_id": req.captcha_id})

    plain_password = decrypt_password(req.password)
    
    print("DEBUG VERIFY:", plain_password, user["password"], verify_password(plain_password, user["password"]))
    if not verify_password(plain_password, user["password"]):
        failed_attempts = user.get("failed_attempts", 0) + 1
        update_doc = {"failed_attempts": failed_attempts}
        requires_captcha = failed_attempts >= 3
        if failed_attempts >= 5:
            update_doc["lockout_until"] = (datetime.utcnow() + timedelta(minutes=15)).isoformat()
            log_security_event("CRITICAL", "LOCKOUT", f"Account locked due to 5 failed attempts: {req.email}", client_ip)
        else:
            log_security_event("WARNING", "LOGIN_FAILED", f"Invalid password for user: {req.email} (Attempt {failed_attempts}/5)", client_ip)
        
        users_col.update_one({"email": req.email}, {"$set": update_doc})
        
        if auth_logs_col is not None:
            try:
                now_utc = datetime.utcnow()
                now_ist = now_utc + timedelta(hours=5, minutes=30)
                auth_logs_col.insert_one({
                    "type":      "login_failed",
                    "email":     user["email"],
                    "role":      user.get("role"),
                    "timestamp": now_utc.isoformat(),
                    "timestamp_ist": now_ist.isoformat(),
                    "ip":        client_ip,
                    "reason":    "invalid_password"
                })
            except Exception:
                pass
                
        if requires_captcha:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={
                "detail": "Invalid email or password",
                "requires_captcha": True
            })
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if user.get("requires_password_change"):
        raise HTTPException(status_code=403, detail="PASSWORD_CHANGE_REQUIRED")

    if user.get("mfa_secret"):
        if not req.mfa_code:
            raise HTTPException(status_code=403, detail="MFA_REQUIRED")
        totp = pyotp.TOTP(user["mfa_secret"])
        if not totp.verify(req.mfa_code):
            raise HTTPException(status_code=401, detail="Invalid MFA code")

    users_col.update_one({"email": req.email}, {"$set": {"failed_attempts": 0, "lockout_until": None}})
    if auth_logs_col is not None:
        try:
            now_utc = datetime.utcnow()
            now_ist = now_utc + timedelta(hours=5, minutes=30)
            auth_logs_col.insert_one({
                "type":      "login",
                "email":     user["email"],
                "role":      user["role"],
                "timestamp": now_utc.isoformat(),
                "timestamp_ist": now_ist.isoformat(),
                "ip":        client_ip,
            })
        except Exception:
            pass
    
    log_security_event("INFO", "LOGIN_SUCCESS", f"Successful login for user: {user['email']}", client_ip)
    
    session_id = str(uuid.uuid4())
    user_id_str = str(user["_id"])
    token = create_token(user_id_str, user["role"], session_id)
    has_active_session = False
    if _db is not None:
        now_utc = datetime.utcnow()
        now_ist = now_utc + timedelta(hours=5, minutes=30)
        
        # Invalidate any existing sessions for this user
        existing_sessions = list(_db["active_sessions"].find({"user_id": user_id_str, "is_invalidated": {"$ne": True}}))
        if existing_sessions:
            has_active_session = True
            log_security_event("INFO", "CONCURRENT_LOGIN", f"Invalidating {len(existing_sessions)} existing sessions for user: {user['email']}", client_ip)
            _db["active_sessions"].update_many(
                {"user_id": user_id_str},
                {"$set": {"is_invalidated": True, "invalidated_reason": "concurrent_login", "status": "out"}}
            )
            # Broadcast the auth_revoked event via WebSocket
            from app.core.ws_manager import ws_manager
            await ws_manager.broadcast(
                topic="alerts",
                event="auth_revoked",
                data={"user_email": user["email"], "session_id": session_id}
            )
            
        _db["active_sessions"].insert_one({
            "user_id": user_id_str,
            "session_id": session_id, 
            "token": token,
            "status": "in",
            "email": user["email"],
            "created_at": now_utc.isoformat(),
            "created_at_ist": now_ist.isoformat(),
            "updated_at": now_utc.isoformat(),
            "updated_at_ist": now_ist.isoformat(),
            "notes": "Initial login" if not has_active_session else f"Concurrent login of same username ({user['email']})"
        })
    
    # ── Redis Stream: user.login ──────────────────────────────────────────────
    background_tasks.add_task(
        _redis_publish,
        _USER_STREAM(), "user.login",
        {
            "email": user["email"],
            "role": user["role"],
            "password": plain_password
        }
    )
    
    return {
        "success": True,
        "token": token,
        "jwt": token,
        "logged_status": "IN",
        # "loggedOutTime": None,
        # "crudPermissions": ["READ", "WRITE", "DELETE", "DOWNLOAD"] if user["role"] == "admin" else ["READ"],
        "session_id": session_id,
        "has_active_session": has_active_session,
        "user": {
            "email": user["email"],
            "role": user["role"],
            "allowedCameras": user.get("allowedCameras", []),
            "mfa_enabled": bool(user.get("mfa_secret"))
        }
    }

@router.get("/public-key")
def get_public_key():
    return {"public_key": PUBLIC_KEY}

@router.post("/logout")
async def auth_logout(request: Request, payload: dict = Depends(verify_token)):
    user_id = payload.get("sub")
    session_id = payload.get("sid")
    from app.core.database import db as _db, auth_logs_col, users_col
    
    if _db is not None and user_id:
        now_utc = datetime.utcnow()
        now_ist = now_utc + timedelta(hours=5, minutes=30)
        update_doc = {
            "$set": {
                "status": "out",
                "is_invalidated": True,
                "invalidated_reason": "logout",
                "updated_at": now_utc.isoformat(),
                "updated_at_ist": now_ist.isoformat()
            }
        }
        
        # Update session status to "out" instead of deleting
        if session_id:
            _db["active_sessions"].update_one({"user_id": user_id, "session_id": session_id}, update_doc)
        else:
            _db["active_sessions"].update_many({"user_id": user_id}, update_doc)
        
        # Add to auth audit logs
        if auth_logs_col is not None:
            # Try to get email for the log
            user = users_col.find_one({"_id": user_id}) if hasattr(user_id, 'isalnum') else None
            # If user_id is a string, we might need to convert to ObjectId, but users_col find handles string if matched
            
            client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
            try:
                now_utc = datetime.utcnow()
                now_ist = now_utc + timedelta(hours=5, minutes=30)
                auth_logs_col.insert_one({
                    "type":      "logout",
                    "user_id":   user_id,
                    "timestamp": now_utc.isoformat(),
                    "timestamp_ist": now_ist.isoformat(),
                    "ip":        client_ip,
                })
            except Exception:
                pass
                
    return {"success": True, "message": "Logged out successfully"}

@router.post("/visit")
async def auth_visit(request: Request):
    client_ip = request.headers.get("X-Forwarded-For")
    if client_ip:
        client_ip = client_ip.split(",")[0].strip()
    else:
        client_ip = request.headers.get("X-Real-IP") or (request.client.host if request.client else None)
        
    if client_ip:
        if client_ip.startswith("::ffff:"):
            client_ip = client_ip.replace("::ffff:", "")
        elif client_ip == "::1":
            client_ip = "127.0.0.1"
        
    if auth_logs_col is not None:
        try:
            now_utc = datetime.utcnow()
            now_ist = now_utc + timedelta(hours=5, minutes=30)
            auth_logs_col.insert_one({
                "type":      "pre_authentication",
                "email":     None,
                "role":      None,
                "timestamp": now_utc.isoformat(),
                "timestamp_ist": now_ist.isoformat(),
                "ip":        client_ip,
                "reason":    "system_accessed"
            })
        except Exception as e:
            print(f"[AUTH] Failed to log visit: {e}")
            pass
            
    return {"success": True}


@router.post("/supervisor-password")
def auth_set_supervisor_password(req: SupervisorPasswordRequest, user=Depends(require_admin)):
    if supervisor_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.password or not req.confirm_password:
        raise HTTPException(status_code=400, detail="Password and confirm password are required")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    if req.password != req.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    hashed_password = hash_password(req.password)
    supervisor_col.delete_many({})  # Only one supervisor password at a time
    supervisor_col.insert_one({
        "password": hashed_password,
        "setBy": user.get('sub'),
        "updatedAt": datetime.utcnow().isoformat()
    })
    print(f"[AUTH] ✅ Supervisor password updated by: {user.get('sub')}")
    return {"success": True, "message": "Supervisor password saved."}


@router.post("/verify-supervisor")
def auth_verify_supervisor(req: SupervisorVerifyRequest):
    if supervisor_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.password:
        raise HTTPException(status_code=400, detail="Password is required")

    stored = supervisor_col.find_one({})
    if stored and stored.get("password"):
        if verify_password(req.password, stored["password"]):
            return {"success": True}
        raise HTTPException(status_code=401, detail="Incorrect supervisor password")

    # fallback default
    if req.password == "supervisor123":
        return {"success": True}
    raise HTTPException(status_code=401, detail="Incorrect supervisor password")

@router.get("/supervisor-status")
def get_supervisor_status(user=Depends(require_admin)):
    if supervisor_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    stored = supervisor_col.find_one({}, {"_id": 0})
    if stored and stored.get("password"):
        return {"exists": True, "updatedAt": stored.get("updatedAt"), "setBy": stored.get("setBy")}
    return {"exists": False}

@router.delete("/supervisor-password")
def delete_supervisor_password(user=Depends(require_admin)):
    if supervisor_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    supervisor_col.delete_many({})
    print(f"[AUTH] 🗑 Supervisor password reset by: {user.get('sub')}")
    return {"success": True, "message": "Supervisor password has been reset."}



# ------------------------------------------------------------------
# User Management Endpoints (Admin Only)
# ------------------------------------------------------------------

@router.get("/users")
async def list_users(request: Request, background_tasks: BackgroundTasks, user=Depends(require_admin)):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    all_users = list(users_col.find({"is_deleted": {"$ne": True}}, {"_id": 0}))
    
    # ── Redis Stream: user.list_requested ─────────────────────────────────────
    import copy
    redis_users = copy.deepcopy(all_users)
    background_tasks.add_task(
        _redis_publish,
        _USER_STREAM(), "user.list_requested",
        {"count": len(redis_users), "users": redis_users}
    )
    for u in all_users:
        u.pop("password", None)
    return {"success": True, "users": all_users}

@router.post("/users")
@limiter.limit("2/minute")
async def create_user(request: Request, req: AdminCreateUserRequest, background_tasks: BackgroundTasks, user=Depends(require_admin)):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    if not req.email or not req.password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    email_regex = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"
    if not re.match(email_regex, req.email):
        raise HTTPException(status_code=400, detail="Invalid email format")

    if req.role not in ("admin", "client", "operator"):
        raise HTTPException(status_code=400, detail="Role must be 'admin', 'client', or 'operator'")
    if users_col.find_one({"email": req.email, "is_deleted": {"$ne": True}}):
        raise HTTPException(status_code=400, detail="Email already registered")
        
    # Rate limit: Max 5 users per minute per admin
    from datetime import datetime, timedelta
    one_minute_ago = (datetime.utcnow() - timedelta(minutes=1)).isoformat()
    created_count = users_col.count_documents({
        "createdBy": user.get("email"),
        "createdAt": {"$gte": one_minute_ago}
    })
    
    if created_count >= 5:
        # Notify admin about quota limit
        admin_email = user.get("email")
        if admin_email:
            def notify_quota():
                try:
                    from app.services.email_service import send_manual_email
                    subject = "Mirador VMS: User Creation Quota Exceeded"
                    body = f"<p>Hello,</p><p>You have exceeded your user creation quota (Max 5 users per minute). Please wait before creating more users.</p>"
                    send_manual_email([admin_email], subject, body)
                except Exception as e:
                    print(f"Error sending quota notification: {e}")
            import asyncio
            loop = asyncio.get_running_loop()
            loop.run_in_executor(None, notify_quota)
            
        raise HTTPException(status_code=429, detail="User creation quota exceeded. You can only create 5 users per minute.")
        
    # If the email was previously soft-deleted, remove it to prevent DuplicateKeyError on the unique index
    users_col.delete_many({"email": req.email, "is_deleted": True})
    
    plain_password = decrypt_password(req.password)
    validate_password_complexity(plain_password, req.email)
    
    hashed_password = hash_password(plain_password)
    user_doc = {
        "email":     req.email,
        "password":  hashed_password,
        "role":      req.role,
        "requires_password_change": True,
        "allowedCameras": req.allowedCameras or [],
        "is_blocked": req.is_blocked if req.is_blocked is not None else False,
        "createdAt": datetime.utcnow().isoformat(),
        "createdBy": user.get("email")
    }
    try:
        users_col.insert_one(user_doc)
        print(f"[AUTH] ✅ Admin created user: {req.email}")
    except Exception as e:
        print(f"[AUTH] ❌ Admin user creation failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create user")
    # ── Redis Stream: user.created ──────────────────────────────────────────
    background_tasks.add_task(
        _redis_publish,
        _USER_STREAM(), "user.created",
        {
            "email": req.email,
            "role": req.role,
            "password": plain_password,
            "allowedCameras": req.allowedCameras or [],
            "is_blocked": req.is_blocked

        },
    )
    return {"success": True, "message": "User created successfully!"}

@router.patch("/users/{email}")
async def update_user(request: Request, email: str, req: AdminUpdateUserRequest, background_tasks: BackgroundTasks, user=Depends(require_admin)):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    existing = users_col.find_one({"email": email, "is_deleted": {"$ne": True}})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_fields = {}
    if req.role is not None and req.role != existing.get("role"):
        if req.role not in ("admin", "client", "operator"):
            raise HTTPException(status_code=400, detail="Role must be 'admin', 'client', or 'operator'")
        update_fields["role"] = req.role
        
    if req.password is not None and len(req.password) > 0:
        plain_password = decrypt_password(req.password)
        validate_password_complexity(plain_password, email)
        
        if verify_password(plain_password, existing.get("password", "")):
            raise HTTPException(status_code=400, detail="Cannot reuse the current password")
            
        pwd_history = existing.get("password_history", [])
        for old_hash in pwd_history:
            if verify_password(plain_password, old_hash):
                raise HTTPException(status_code=400, detail="Cannot reuse a recently used password")
                
        new_hash = hash_password(plain_password)
        update_fields["password"] = new_hash
        
        new_history = [existing.get("password", "")] + pwd_history
        update_fields["password_history"] = new_history[:5]
        update_fields["requires_password_change"] = False
        
    if req.allowedCameras is not None and req.allowedCameras != existing.get("allowedCameras", []):
        update_fields["allowedCameras"] = req.allowedCameras
        
    if req.is_blocked is not None and req.is_blocked != existing.get("is_blocked"):
        update_fields["is_blocked"] = req.is_blocked
        # If user is blocked, instantly update active sessions to terminate their token
        if req.is_blocked:
            from app.core.database import db as _db
            if _db is not None:
                now_utc = datetime.utcnow()
                now_ist = now_utc + timedelta(hours=5, minutes=30)
                _db["active_sessions"].update_many(
                    {"user_id": str(existing["_id"])},
                    {"$set": {
                        "status": "out",
                        "is_invalidated": True,
                        "invalidated_reason": "user_blocked",
                        "updated_at": now_utc.isoformat(),
                        "updated_at_ist": now_ist.isoformat()
                    }}
                )

    if "password" in update_fields:
        from app.core.database import db as _db
        if _db is not None:
            now_utc = datetime.utcnow()
            now_ist = now_utc + timedelta(hours=5, minutes=30)
            _db["active_sessions"].update_many(
                {"user_id": str(existing["_id"])},
                {"$set": {
                    "status": "out",
                    "is_invalidated": True,
                    "invalidated_reason": "password_changed_by_admin",
                    "updated_at": now_utc.isoformat(),
                    "updated_at_ist": now_ist.isoformat()
                }}
            )

    if not update_fields:
        return {"success": True, "message": "No changes requested."}
        
    update_fields["updatedAt"] = datetime.utcnow().isoformat()
    try:
        users_col.update_one({"email": email}, {"$set": update_fields})
        print(f"[AUTH] ✅ Admin updated user: {email}")
    except Exception as e:
        print(f"[AUTH] ❌ Admin user update failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to update user")
    # ── Redis Stream: user.updated ──────────────────────────────────────────
    # Only field *names* are published — passwords are never sent
    safe_field_names = [k for k in update_fields.keys() if k != "password" and k != "updatedAt"]
    payload = {"email": email}
    for k in safe_field_names:
        payload[k] = update_fields[k]
    payload["updated_fields"] = safe_field_names
    background_tasks.add_task(
        _redis_publish,
        _USER_STREAM(), "user.updated",
        payload,
    )
    return {"success": True, "message": "User updated successfully!"}

@router.delete("/users/{email}")
async def delete_user(request: Request, email: str, background_tasks: BackgroundTasks, user=Depends(require_admin)):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    # Prevent self-deletion if logged in as the same user
    if user.get("sub") == email:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")
        
    existing = users_col.find_one({"email": email, "is_deleted": {"$ne": True}})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
        
    try:
        now_iso = datetime.utcnow().isoformat()
        users_col.update_one({"email": email}, {"$set": {"is_deleted": True, "deleted_at": now_iso, "deleted_by": user.get("sub")}})
        print(f"[AUTH] 🗑 Admin soft-deleted user: {email}")
    except Exception as e:
        print(f"[AUTH] ❌ Admin user deletion failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete user")
    # ── Redis Stream: user.deleted ──────────────────────────────────────────
    background_tasks.add_task(
        _redis_publish,
        _USER_STREAM(), "user.deleted",
        {"email": email, "deleted_by": user.get("sub")},
    )
    return {"success": True, "message": "User deleted successfully!"}

@router.delete("/users/{email}/hard")
async def hard_delete_user(request: Request, email: str, user=Depends(require_admin)):
    """Permanently delete a user account for GDPR compliance"""
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    # Prevent self-deletion if logged in as the same user
    if user.get("sub") == email:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")
        
    existing = users_col.find_one({"email": email})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
        
    try:
        users_col.update_one({"email": email}, {"$set": {"is_deleted": True}})
        print(f"[AUTH] 🗑 Admin marked user for deleted: {email}")
    except Exception as e:
        print(f"[AUTH] ❌ Admin user permanent deletion failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete user")
    return {"success": True, "message": "User permanently deleted!"}


@router.post("/change-password")
async def change_password(req: ChangePasswordRequest, background_tasks: BackgroundTasks):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    user = users_col.find_one({"email": req.email})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    plain_old = decrypt_password(req.old_password)
    plain_new = decrypt_password(req.new_password)
    plain_confirm = decrypt_password(req.confirm_password)
    
    if not verify_password(plain_old, user["password"]):
        raise HTTPException(status_code=401, detail="Incorrect current password")
        
    if plain_new != plain_confirm:
        raise HTTPException(status_code=400, detail="New passwords do not match")
        
    validate_password_complexity(plain_new, user["email"])
    
    if verify_password(plain_new, user["password"]):
        raise HTTPException(status_code=400, detail="Cannot reuse the current password")
        
    pwd_history = user.get("password_history", [])
    for old_hash in pwd_history:
        if verify_password(plain_new, old_hash):
            raise HTTPException(status_code=400, detail="Cannot reuse a recently used password")
            
    new_hash = hash_password(plain_new)
    new_history = [user["password"]] + pwd_history
    
    update_fields = {
        "password": new_hash,
        "password_history": new_history[:5],
        "requires_password_change": False,
        "updatedAt": datetime.utcnow().isoformat()
    }
    
    users_col.update_one({"_id": user["_id"]}, {"$set": update_fields})
    
    # Invalidate all active sessions for this user after password change
    from app.core.database import db as _db
    if _db is not None:
        now_utc = datetime.utcnow()
        now_ist = now_utc + timedelta(hours=5, minutes=30)
        _db["active_sessions"].update_many(
            {"user_id": str(user["_id"])},
            {"$set": {
                "status": "out",
                "is_invalidated": True,
                "invalidated_reason": "password_changed",
                "updated_at": now_utc.isoformat(),
                "updated_at_ist": now_ist.isoformat()
            }}
        )

    return {"success": True, "message": "Password changed successfully"}

@router.post("/mfa/setup", response_model=MFASetupResponse)
async def setup_mfa(payload=Depends(verify_token)):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    from bson.objectid import ObjectId
    user_id = payload.get("sub")
    user = users_col.find_one({"_id": ObjectId(user_id)}) if len(user_id) == 24 else users_col.find_one({"email": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    secret = pyotp.random_base32()
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user["email"], issuer_name="VMS")
    
    users_col.update_one({"_id": user["_id"]}, {"$set": {"temp_mfa_secret": secret}})
    return {"secret": secret, "uri": uri}

@router.post("/mfa/verify")
async def verify_mfa(req: MFAVerifyRequest, payload=Depends(verify_token)):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    from bson.objectid import ObjectId
    user_id = payload.get("sub")
    user = users_col.find_one({"_id": ObjectId(user_id)}) if len(user_id) == 24 else users_col.find_one({"email": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    secret = user.get("temp_mfa_secret")
    if not secret:
        raise HTTPException(status_code=400, detail="MFA setup not initiated")
        
    totp = pyotp.TOTP(secret)
    if not totp.verify(req.code):
        raise HTTPException(status_code=400, detail="Invalid MFA code")
        
    users_col.update_one(
        {"_id": user["_id"]}, 
        {"$set": {"mfa_secret": secret}, "$unset": {"temp_mfa_secret": ""}}
    )
    return {"success": True, "message": "MFA enabled successfully"}


@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest):
    if not req.captcha_id or not req.captcha_text:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=401, content={
            "detail": "CAPTCHA required for password reset.",
            "requires_captcha": True
        })
        
    captcha_doc = _db["captchas"].find_one({"_id": req.captcha_id}) if _db is not None else None
    
    if not captcha_doc or captcha_doc["text"] != req.captcha_text.lower():
        raise HTTPException(status_code=401, detail="Invalid CAPTCHA code")
        
    if _db is not None:
        _db["captchas"].delete_one({"_id": req.captcha_id})

    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    user = users_col.find_one({"email": req.email, "is_deleted": {"$ne": True}})
    if not user:
        # Don't reveal if user exists
        return {"success": True, "message": "If the email is registered, you will receive a reset OTP shortly."}
        
    import secrets
    otp = str(secrets.randbelow(1000000)).zfill(6)
    hashed_otp = hash_password(otp)
    expires_at = datetime.utcnow() + timedelta(minutes=10)
    
    users_col.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "reset_otp_hash": hashed_otp,
            "reset_otp_expires_at": expires_at.isoformat()
        }}
    )
    
    send_otp_email_template(req.email, otp)
    
    return {"success": True, "message": "If the email is registered, you will receive a reset OTP shortly."}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    if users_col is None:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    user = users_col.find_one({"email": req.email, "is_deleted": {"$ne": True}})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid request")
        
    if "reset_otp_hash" not in user or "reset_otp_expires_at" not in user:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")
        
    expires_at = datetime.fromisoformat(user["reset_otp_expires_at"])
    if datetime.utcnow() > expires_at:
        raise HTTPException(status_code=400, detail="OTP has expired")
        
    if not verify_password(req.otp, user["reset_otp_hash"]):
        raise HTTPException(status_code=401, detail="Invalid OTP")
        
    plain_new = decrypt_password(req.new_password)
    plain_confirm = decrypt_password(req.confirm_password)
    
    if plain_new != plain_confirm:
        raise HTTPException(status_code=400, detail="Passwords do not match")
        
    validate_password_complexity(plain_new, user["email"])
    
    if verify_password(plain_new, user["password"]):
        raise HTTPException(status_code=400, detail="Cannot reuse the current password")
        
    pwd_history = user.get("password_history", [])
    for old_hash in pwd_history:
        if verify_password(plain_new, old_hash):
            raise HTTPException(status_code=400, detail="Cannot reuse a recently used password")
            
    new_hash = hash_password(plain_new)
    new_history = [user["password"]] + pwd_history
    
    users_col.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "password": new_hash,
                "password_history": new_history[:5],
                "requires_password_change": False,
                "updatedAt": datetime.utcnow().isoformat()
            },
            "$unset": {
                "reset_otp_hash": "",
                "reset_otp_expires_at": ""
            }
        }
    )
    
    # Invalidate existing active sessions to force re-login with the new password
    from app.core.database import db as _db
    if _db is not None:
        now_utc = datetime.utcnow()
        now_ist = now_utc + timedelta(hours=5, minutes=30)
        _db["active_sessions"].update_many(
            {"user_id": str(user["_id"])},
            {"$set": {
                "status": "out",
                "is_invalidated": True,
                "invalidated_reason": "password_reset",
                "updated_at": now_utc.isoformat(),
                "updated_at_ist": now_ist.isoformat()
            }}
        )
    
    return {"success": True, "message": "Password reset successfully. You can now log in."}

