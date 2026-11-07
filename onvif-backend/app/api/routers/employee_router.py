from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from typing import Optional
from datetime import datetime
import uuid
import os
import aiohttp
from app.core.database import db

router = APIRouter(prefix="/api", tags=["employees"])

# Static storage for enrolled employee face photos
STATIC_FACES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "static", "faces")
os.makedirs(STATIC_FACES_DIR, exist_ok=True)

SYNOPSIS_SERVICE_URL = os.environ.get("SYNOPSIS_SERVICE_URL", "http://127.0.0.1:8005")


@router.get("/employees")
async def list_employees(
    search: Optional[str] = None,
    department: Optional[str] = None,
    status: Optional[str] = None
):
    """List all registered employees from MongoDB database."""
    if db is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    col = db["employees"]
    query = {}
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"department": {"$regex": search, "$options": "i"}}
        ]
    if department and department != "All":
        query["department"] = department
    if status and status != "all":
        query["status"] = status.lower()

    cursor = col.find(query).sort("created_at", -1)
    results = []
    for doc in cursor:
        results.append({
            "emp_id": doc.get("emp_id"),
            "name": doc.get("name"),
            "email": doc.get("email", ""),
            "department": doc.get("department", "General"),
            "status": (doc.get("status") or "authorised").lower(),
            "photo_url": doc.get("photo_url"),
            "has_face_embedding": bool(doc.get("face_embedding")),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at")
        })
    return results


@router.get("/employees/{emp_id}")
async def get_employee(emp_id: str):
    """Get a single employee by ID."""
    if db is None:
        raise HTTPException(status_code=500, detail="Database not connected")
    
    emp = db["employees"].find_one({"emp_id": emp_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    return {
        "emp_id": emp.get("emp_id"),
        "name": emp.get("name"),
        "email": emp.get("email", ""),
        "department": emp.get("department", "General"),
        "status": (emp.get("status") or "authorised").lower(),
        "photo_url": emp.get("photo_url"),
        "has_face_embedding": bool(emp.get("face_embedding")),
        "created_at": emp.get("created_at"),
        "updated_at": emp.get("updated_at")
    }


@router.post("/employees")
async def create_employee(
    name: str = Form(...),
    email: str = Form(""),
    department: str = Form("General"),
    status: str = Form("authorised"),
    photo: Optional[UploadFile] = File(None)
):
    """
    Enrolls a new employee into MongoDB.
    Syncs with synopsis-service on port 8005 to generate biometric face embeddings.
    """
    if db is None:
        raise HTTPException(status_code=500, detail="Database not connected")

    emp_id = f"EMP-{uuid.uuid4().hex[:8].upper()}"
    photo_url = None
    face_embedding = None

    # Handle photo upload
    if photo and photo.filename:
        photo_bytes = await photo.read()
        photo_filename = f"{emp_id}.jpg"
        save_path = os.path.join(STATIC_FACES_DIR, photo_filename)
        with open(save_path, "wb") as f:
            f.write(photo_bytes)
        photo_url = f"/api/faces/{photo_filename}"

        # Delegate vector extraction to synopsis-service if available
        try:
            async with aiohttp.ClientSession() as session:
                data = aiohttp.FormData()
                data.add_field("name", name)
                data.add_field("email", email)
                data.add_field("department", department)
                data.add_field("status", status)
                data.add_field("photo", photo_bytes, filename=photo_filename, content_type=photo.content_type or "image/jpeg")
                async with session.post(f"{SYNOPSIS_SERVICE_URL}/a1/v1/synopsis/employees", data=data, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status in (200, 201):
                        syn_data = await resp.json()
                        if syn_data.get("emp_id"):
                            return syn_data
        except Exception:
            pass

    status_val = status.lower() if status else "authorised"
    if status_val not in ("authorised", "suspended"):
        status_val = "authorised"

    now = datetime.utcnow().isoformat()
    doc = {
        "emp_id": emp_id,
        "name": name.strip(),
        "email": email.strip() if email else "",
        "department": department.strip() if department else "General",
        "status": status_val,
        "photo_url": photo_url,
        "face_embedding": face_embedding,
        "created_at": now,
        "updated_at": now
    }
    db["employees"].insert_one(doc)

    return {
        "emp_id": emp_id,
        "name": doc["name"],
        "email": doc["email"],
        "department": doc["department"],
        "status": doc["status"],
        "photo_url": doc["photo_url"],
        "has_face_embedding": bool(face_embedding),
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"]
    }


@router.put("/employees/{emp_id}")
async def update_employee(
    emp_id: str,
    name: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    department: Optional[str] = Form(None),
    status: Optional[str] = Form(None),
    photo: Optional[UploadFile] = File(None)
):
    """Updates an existing employee's details or clearance status."""
    if db is None:
        raise HTTPException(status_code=500, detail="Database not connected")

    col = db["employees"]
    emp = col.find_one({"emp_id": emp_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    update_fields = {"updated_at": datetime.utcnow().isoformat()}
    if name is not None:
        update_fields["name"] = name.strip()
    if email is not None:
        update_fields["email"] = email.strip()
    if department is not None:
        update_fields["department"] = department.strip()
    if status is not None:
        s = status.lower()
        if s in ("authorised", "suspended"):
            update_fields["status"] = s

    if photo and photo.filename:
        photo_bytes = await photo.read()
        photo_filename = f"{emp_id}.jpg"
        save_path = os.path.join(STATIC_FACES_DIR, photo_filename)
        with open(save_path, "wb") as f:
            f.write(photo_bytes)
        update_fields["photo_url"] = f"/api/faces/{photo_filename}"

    col.update_one({"emp_id": emp_id}, {"$set": update_fields})
    updated = col.find_one({"emp_id": emp_id})

    # Sync update to synopsis service
    try:
        async with aiohttp.ClientSession() as session:
            data = aiohttp.FormData()
            if name: data.add_field("name", name)
            if email: data.add_field("email", email)
            if department: data.add_field("department", department)
            if status: data.add_field("status", status)
            await session.put(f"{SYNOPSIS_SERVICE_URL}/a1/v1/synopsis/employees/{emp_id}", data=data, timeout=aiohttp.ClientTimeout(total=3))
    except Exception:
        pass

    return {
        "emp_id": updated.get("emp_id"),
        "name": updated.get("name"),
        "email": updated.get("email", ""),
        "department": updated.get("department", "General"),
        "status": (updated.get("status") or "authorised").lower(),
        "photo_url": updated.get("photo_url"),
        "has_face_embedding": bool(updated.get("face_embedding")),
        "created_at": updated.get("created_at"),
        "updated_at": updated.get("updated_at")
    }


@router.delete("/employees/{emp_id}")
async def delete_employee(emp_id: str):
    """Deletes an employee from the database."""
    if db is None:
        raise HTTPException(status_code=500, detail="Database not connected")

    col = db["employees"]
    emp = col.find_one({"emp_id": emp_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    col.delete_one({"emp_id": emp_id})
    photo_filename = f"{emp_id}.jpg"
    disk_path = os.path.join(STATIC_FACES_DIR, photo_filename)
    if os.path.exists(disk_path):
        try:
            os.remove(disk_path)
        except Exception:
            pass

    # Also delete on synopsis-service
    try:
        async with aiohttp.ClientSession() as session:
            await session.delete(f"{SYNOPSIS_SERVICE_URL}/a1/v1/synopsis/employees/{emp_id}", timeout=aiohttp.ClientTimeout(total=3))
    except Exception:
        pass

    return {"success": True, "deleted_emp_id": emp_id}
