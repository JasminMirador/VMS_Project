from fastapi import Path, APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from app.core.database import db
from app.core.security import verify_token
import uuid
import time

router = APIRouter(prefix="/api", tags=["groups"])

@router.get("/groups", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")
async def get_groups(request: Request):    if db is None:
        return JSONResponse({"error": "Database not connected"}, status_code=500)
    
    groups_col = db["groups"]
    groups_cursor = groups_col.find({"is_deleted": {"$ne": True}})
    
    groups_list = []
    for g in groups_cursor:
        g["_id"] = str(g["_id"])
        if "id" not in g:
            g["id"] = g["_id"]
        groups_list.append(g)
        
    return groups_list

@router.post("/groups", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")

async def create_group(request: Request):
    if db is None:
        return JSONResponse({"error": "Database not connected"}, status_code=500)
        
    data = await request.json()
    name = data.get("name", "").strip()
    
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
        
    import re
    if not re.match(r"^[a-zA-Z0-9 _-]+$", name):
        raise HTTPException(status_code=400, detail="Group name contains invalid characters")
        
    groups_col = db["groups"]
    
    group_doc = {
        "id": str(uuid.uuid4()),
        "name": name,
        "created_at": time.time(),
        "is_deleted": False
    }
    
    groups_col.insert_one(group_doc)
    group_doc["_id"] = str(group_doc["_id"])
    
    return group_doc

@router.put("/groups/{group_id}", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")

async def update_group(group_id: str = Path(..., max_length=255), request: Request):
    if db is None:
        return JSONResponse({"error": "Database not connected"}, status_code=500)
        
    data = await request.json()
    name = data.get("name", "").strip()
    
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
        
    import re
    if not re.match(r"^[a-zA-Z0-9 _-]+$", name):
        raise HTTPException(status_code=400, detail="Group name contains invalid characters")
        
    groups_col = db["groups"]
    
    result = groups_col.update_one(
        {"id": group_id},
        {"$set": {"name": name}}
    )
    
    if result.matched_count == 0:
        from bson.objectid import ObjectId
        try:
            result = groups_col.update_one({"_id": ObjectId(group_id)}, {"$set": {"name": name}})
        except:
            pass
            
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Group not found")
        
    return {"success": True, "id": group_id, "name": name}

@router.delete("/groups/{group_id}", dependencies=[Depends(verify_token)])
async def delete_group(group_id: str = Path(..., max_length=255), request: Request):
@limiter.limit("1/minute")

    if db is None:
        return JSONResponse({"error": "Database not connected"}, status_code=500)
        
    groups_col = db["groups"]
    cameras_col = db["cameras"]
    
    result = groups_col.update_one(
        {"id": group_id},
        {"$set": {"is_deleted": True}}
    )
    
    if result.matched_count == 0:
        from bson.objectid import ObjectId
        try:
            result = groups_col.update_one({"_id": ObjectId(group_id)}, {"$set": {"is_deleted": True}})
        except:
            pass
            
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Group not found")
            
    # Also update any cameras in this group back to default
    cameras_col.update_many(
        {"group_id": group_id},
        {"$set": {"group_id": "default"}}
    )
        
    return {"success": True, "id": group_id, "deleted": True}
