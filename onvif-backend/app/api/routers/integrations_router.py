import socket
import subprocess
import platform
import time
import uuid
from bson.objectid import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from app.core.database import db
from app.core.security import verify_token

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

@router.post("/ping", dependencies=[Depends(verify_token)])
async def ping_integration(request: Request):
    data = await request.json()
    ip = data.get("serverIp")
    if not ip:
        return JSONResponse({"status": "failed", "message": "No IP provided"}, status_code=400)
    
    port_to_check = None
    if ":" in ip:
        parts = ip.split(":")
        ip = parts[0]
        try:
            port_to_check = int(parts[1])
        except ValueError:
            pass
            
    is_reachable = False
    ports = [port_to_check] if port_to_check else [80, 443, 3000, 8000, 8006, 9000, 22]
    
    for port in ports:
        try:
            with socket.create_connection((ip, port), timeout=0.5):
                is_reachable = True
                break
        except (socket.timeout, socket.error):
            continue
    
    if not is_reachable and not port_to_check:
        param = '-n' if platform.system().lower() == 'windows' else '-c'
        command = ['ping', param, '1', ip]
        try:
            result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=2)
            is_reachable = (result.returncode == 0)
        except Exception:
            pass

    if is_reachable:
        return {"status": "success", "message": "Connection successful"}
    else:
        return JSONResponse({"status": "failed", "message": "Could not reach IP"}, status_code=400)


@router.get("", dependencies=[Depends(verify_token)])
async def get_integrations():
    if db is None:
        return JSONResponse({"error": "Database not connected"}, status_code=500)
    
    col = db["integration"]
    cursor = col.find({"is_deleted": {"$ne": True}})
    
    items = []
    for doc in cursor:
        doc["_id"] = str(doc["_id"])
        if "id" not in doc:
            doc["id"] = doc["_id"]
        items.append(doc)
        
    return items


@router.post("", dependencies=[Depends(verify_token)])
async def create_integration(request: Request):
    if db is None:
        return JSONResponse({"error": "Database not connected"}, status_code=500)
        
    data = await request.json()

    # Validate name fields against safe-name pattern
    import re as _re
    _NAME_RE = _re.compile(r'^[a-zA-Z0-9 _.\-]*$')
    for _nf in ("serverName", "appName"):
        _val = data.get(_nf, "")
        if _val and not _NAME_RE.match(str(_val).strip()):
            raise HTTPException(status_code=400, detail=f"'{_nf}' contains invalid characters. Only letters, numbers, spaces, hyphens, underscores, and dots are allowed.")
    
    doc_id = str(data.get("id") or uuid.uuid4())
    doc = {
        "id": doc_id,
        "type": data.get("type", ""),
        "isActive": data.get("isActive", True),
        "serverName": data.get("serverName", ""),
        "serverIp": data.get("serverIp", ""),
        "isConnected": data.get("isConnected", False),
        "host": data.get("host", ""),
        "port": data.get("port", ""),
        "username": data.get("username", ""),
        "password": data.get("password", ""),
        "appName": data.get("appName", ""),
        "accessToken": data.get("accessToken", ""),
        "streams": data.get("streams", []),
        "created_at": time.time(),
        "is_deleted": False
    }
    
    col = db["integration"]
    # If a document with this id already exists, update it instead of duplicate insert
    existing = col.find_one({"id": doc_id})
    if existing:
        col.update_one({"id": doc_id}, {"$set": doc})
        doc["_id"] = str(existing["_id"])
    else:
        res = col.insert_one(doc)
        doc["_id"] = str(res.inserted_id)
        
    return {"message": "Integration created successfully", "data": doc}


@router.put("/{integration_id}", dependencies=[Depends(verify_token)])
async def update_integration(integration_id: str, request: Request):
    if db is None:
        return JSONResponse({"error": "Database not connected"}, status_code=500)
        
    data = await request.json()
    
    # Validate name fields against safe-name pattern
    import re as _re
    _NAME_RE = _re.compile(r'^[a-zA-Z0-9 _.\-]*$')
    for _nf in ("serverName", "appName"):
        _val = data.get(_nf)
        if _val and not _NAME_RE.match(str(_val).strip()):
            raise HTTPException(status_code=400, detail=f"'{_nf}' contains invalid characters. Only letters, numbers, spaces, hyphens, underscores, and dots are allowed.")

    update_data = {
        "type": data.get("type"),
        "isActive": data.get("isActive"),
        "serverName": data.get("serverName"),
        "serverIp": data.get("serverIp"),
        "isConnected": data.get("isConnected"),
        "host": data.get("host"),
        "port": data.get("port"),
        "username": data.get("username"),
        "password": data.get("password"),
        "appName": data.get("appName"),
        "accessToken": data.get("accessToken"),
        "streams": data.get("streams"),
        "updated_at": time.time()
    }
    
    # Remove None values
    update_data = {k: v for k, v in update_data.items() if v is not None}
    
    col = db["integration"]
    result = col.update_one({"id": integration_id}, {"$set": update_data})
    
    if result.matched_count == 0:
        try:
            result = col.update_one({"_id": ObjectId(integration_id)}, {"$set": update_data})
        except Exception:
            pass
            
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Integration not found")
        
    return {"message": "Integration updated successfully"}


@router.delete("/{integration_id}", dependencies=[Depends(verify_token)])
async def delete_integration(integration_id: str):
    if db is None:
        return JSONResponse({"error": "Database not connected"}, status_code=500)
        
    col = db["integration"]
    # Soft delete
    result = col.update_one(
        {"id": integration_id}, 
        {"$set": {"is_deleted": True, "deleted_at": time.time()}}
    )
    
    if result.matched_count == 0:
        try:
            result = col.update_one(
                {"_id": ObjectId(integration_id)}, 
                {"$set": {"is_deleted": True, "deleted_at": time.time()}}
            )
        except Exception:
            pass
            
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Integration not found")
        
    return {"message": "Integration deleted successfully"}
