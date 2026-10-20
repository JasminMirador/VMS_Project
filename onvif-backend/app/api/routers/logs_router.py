from fastapi import APIRouter, Depends, Query
from app.core.security import verify_token
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from app.core.database import mongo_client
import os

# Connect to Mongo
MONGO_URI = os.environ["MONGO_URI"]
try:
    mongo_client = mongo_client
    db = mongo_client[os.environ.get("MONGO_DB_NAME")]
    ui_logs_col = db["ui_logs"]
    terminal_logs_col = db["terminal_logs"]
    print(f"[MONGO] Logs router connected to DB")
except Exception as e:
    print(f"[MONGO] Logs router failed to connect: {e}")
    ui_logs_col = None
    terminal_logs_col = None

router = APIRouter(prefix="/api/logs", tags=["logs"], dependencies=[Depends(verify_token)])

class UILogEntry(BaseModel):
    user_email: str = Field(pattern=r"^([\w\.-]+@[\w\.-]+\.\w+|Unknown|System|unknown)$", max_length=150)
    user_role: str = Field(pattern=r"^[A-Za-z0-9_ -]*$", max_length=50)
    action: str = Field(max_length=500)
    category: str = Field(max_length=100)
    details: Optional[Dict[str, Any]] = {}
    session_id: Optional[str] = None
    timestamp: Optional[str] = None

class TerminalLogEntry(BaseModel):
    user_email: str = Field(pattern=r"^([\w\.-]+@[\w\.-]+\.\w+|Unknown|System|unknown)$", max_length=150)
    user_role: str = Field(pattern=r"^[A-Za-z0-9_ -]*$", max_length=50)
    command: str = Field(max_length=2000)
    project_folder: str = Field(max_length=500)
    exit_code: int = 0
    output_snippet: str = Field(default="", max_length=5000)
    session_id: Optional[str] = None
    timestamp: Optional[str] = None

from app.core.ws_manager import ws_manager

@router.post("/ui")
async def add_ui_log(log: UILogEntry):
    if ui_logs_col is None:
        return {"success": False, "error": "Database not connected"}
    
    doc = log.dict()
    if not doc.get("timestamp"):
      doc["timestamp"] = datetime.now(timezone.utc).isoformat()        
    try:
        ui_logs_col.insert_one(doc)
        
        # Strip _id for WS serialization
        ws_doc = doc.copy()
        if "_id" in ws_doc:
            del ws_doc["_id"]
            
        await ws_manager.broadcast("system_logs", "new_ui_log", ws_doc)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/ui")
def get_ui_logs(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user_email: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 0
):
    if ui_logs_col is None:
        return {"success": False, "error": "Database not connected", "logs": []}
        
    query = {}
    
    if from_date or to_date:
        query["timestamp"] = {}
        if from_date:
            query["timestamp"]["$gte"] = from_date
        if to_date:
            query["timestamp"]["$lte"] = to_date if "T" in to_date else to_date + "T23:59:59.999Z"
            
    if user_email:
        query["user_email"] = user_email
        
    if category:
        query["category"] = category
        
    try:
        cursor = ui_logs_col.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit)
        logs = list(cursor)
        
        # Also fetch from auth_logs if category is not restrictive or is exactly 'auth'
        if category is None or category == "auth":
            auth_logs_col = db.get_collection("auth_logs") if db is not None else None
            if auth_logs_col is not None:
                auth_query = {}
                if "timestamp" in query:
                    auth_query["timestamp"] = query["timestamp"]
                if "user_email" in query:
                    auth_query["user_email"] = query["user_email"]
                
                auth_cursor = auth_logs_col.find(auth_query, {"_id": 0}).sort("timestamp", -1).limit(limit)
                for alog in auth_cursor:
                    email = alog.get("email") or alog.get("user_email") or "Unknown"
                    action_type = (alog.get("type") or alog.get("action", "unknown")).lower()
                    
                    if action_type == "login":
                        action_text = "User logged in successfully"
                    elif action_type == "logout":
                        action_text = "User logged out successfully"
                    elif action_type == "login_failed":
                        reason = alog.get("reason", "unknown error")
                        action_text = f"User login failed ({reason})"
                    else:
                        action_text = f"User action ({action_type})"
                    
                    logs.append({
                        "timestamp": alog.get("timestamp"),
                        "user_email": email,
                        "user_role": alog.get("role") or alog.get("user_role") or "ADMIN",
                        "action": action_text,
                        "category": "auth",
                        "details": {
                            "ip_address": alog.get("ip") or alog.get("ip_address"),
                            "user_agent": alog.get("user_agent")
                        }
                    })
        
        # Sort combined logs and apply limit
        logs.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
        if limit > 0:
            logs = logs[:limit]
            
        return {"success": True, "logs": logs}
    except Exception as e:
        return {"success": False, "error": str(e), "logs": []}

@router.post("/terminal")
async def add_terminal_log(log: TerminalLogEntry):
    if terminal_logs_col is None:
        return {"success": False, "error": "Database not connected"}
        
    doc = log.dict()
    if not doc.get("timestamp"):
        doc["timestamp"] = datetime.utcnow().isoformat()
        
    try:
        terminal_logs_col.insert_one(doc)
        
        ws_doc = doc.copy()
        if "_id" in ws_doc:
            del ws_doc["_id"]
            
        await ws_manager.broadcast("system_logs", "new_terminal_log", ws_doc)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/terminal")
def get_terminal_logs(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user_email: Optional[str] = None,
    limit: int = 0
):
    if terminal_logs_col is None:
        return {"success": False, "error": "Database not connected", "logs": []}
        
    query = {}
    
    if from_date or to_date:
        query["timestamp"] = {}
        if from_date:
            query["timestamp"]["$gte"] = from_date
        if to_date:
            query["timestamp"]["$lte"] = to_date if "T" in to_date else to_date + "T23:59:59.999Z"
            
    if user_email:
        query["user_email"] = user_email
        
    try:
        cursor = terminal_logs_col.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit)
        logs = list(cursor)
        return {"success": True, "logs": logs}
    except Exception as e:
        return {"success": False, "error": str(e), "logs": []}