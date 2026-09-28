import os
from datetime import datetime, timedelta
from jose import JWTError, jwt, jwe
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import uuid

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend

KEYS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "keys")
os.makedirs(KEYS_DIR, exist_ok=True)

PRIVATE_KEY_PATH = os.path.join(KEYS_DIR, "private.pem")
PUBLIC_KEY_PATH = os.path.join(KEYS_DIR, "public.pem")

def get_or_create_keys():
    if os.path.exists(PRIVATE_KEY_PATH) and os.path.exists(PUBLIC_KEY_PATH):
        with open(PRIVATE_KEY_PATH, "r") as f:
            private_key = f.read()
        with open(PUBLIC_KEY_PATH, "r") as f:
            public_key = f.read()
        return private_key, public_key
    
    # Generate new RSA key pair
    private_key_obj = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend()
    )
    private_key = private_key_obj.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    
    public_key_obj = private_key_obj.public_key()
    public_key = public_key_obj.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    
    with open(PRIVATE_KEY_PATH, "wb") as f:
        f.write(private_key)
    with open(PUBLIC_KEY_PATH, "wb") as f:
        f.write(public_key)
        
    return private_key.decode("utf-8"), public_key.decode("utf-8")

PRIVATE_KEY, PUBLIC_KEY = get_or_create_keys()
ALGORITHM = "RS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 365 * 24 * 60 # 365 days

security_scheme = HTTPBearer(auto_error=False)

def create_token(user_id: str, role: str, session_id: str = None):
    to_encode = {"sub": user_id, "role": role}
    if session_id:
        to_encode["sid"] = session_id
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    
    # 1. Sign the payload (JWS)
    signed_jwt = jwt.encode(to_encode, PRIVATE_KEY, algorithm=ALGORITHM)
    
    # 2. Encrypt the signed token (JWE)
    encrypted_jwt = jwe.encrypt(signed_jwt.encode("utf-8"), PUBLIC_KEY, algorithm="RSA-OAEP", encryption="A256GCM")
    
    return encrypted_jwt.decode("utf-8")

def verify_token(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security_scheme)):
    token = None
    if credentials:
        token = credentials.credentials
    elif "token" in request.query_params:
        token = request.query_params["token"]
        
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    try:
        # Try to decrypt JWE first
        try:
            decrypted_bytes = jwe.decrypt(token, PRIVATE_KEY)
            token_to_verify = decrypted_bytes.decode("utf-8")
        except Exception:
            # Fallback for backward compatibility with unencrypted JWS tokens
            token_to_verify = token

        payload = jwt.decode(token_to_verify, PUBLIC_KEY, algorithms=[ALGORITHM])
        
        # Concurrent session check
        from app.core.database import db as _db
        if _db is not None:
            active_sessions = _db["active_sessions"]
            session_id = payload.get("sid")
            user_id = payload.get("sub")
            if session_id and user_id:
                session_doc = active_sessions.find_one({"user_id": user_id, "session_id": session_id})
                if not session_doc:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Session expired or invalid",
                        headers={"WWW-Authenticate": "Bearer"},
                    )
                if session_doc.get("is_invalidated"):
                    reason = session_doc.get("invalidated_reason", "unknown")
                    if reason == "concurrent_login":
                        raise HTTPException(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Session expired: Another session has been initiated under this account.",
                            headers={"WWW-Authenticate": "Bearer"},
                        )
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Session expired or invalid",
                        headers={"WWW-Authenticate": "Bearer"},
                    )
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

def require_admin(payload: dict = Depends(verify_token)):
    role = payload.get("role", "user")
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    return payload
