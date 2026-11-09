from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from typing import Optional, List
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
        p_urls = doc.get("photo_urls") or ([doc.get("photo_url")] if doc.get("photo_url") else [])
        results.append({
            "emp_id": doc.get("emp_id"),
            "name": doc.get("name"),
            "email": doc.get("email", ""),
            "department": doc.get("department", "General"),
            "status": (doc.get("status") or "authorised").lower(),
            "photo_url": doc.get("photo_url") or (p_urls[0] if p_urls else None),
            "photo_urls": p_urls,
            "photos_count": len(p_urls),
            "has_face_embedding": bool(doc.get("face_embeddings") or doc.get("face_embedding")),
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
    
    p_urls = emp.get("photo_urls") or ([emp.get("photo_url")] if emp.get("photo_url") else [])
    return {
        "emp_id": emp.get("emp_id"),
        "name": emp.get("name"),
        "email": emp.get("email", ""),
        "department": emp.get("department", "General"),
        "status": (emp.get("status") or "authorised").lower(),
        "photo_url": emp.get("photo_url") or (p_urls[0] if p_urls else None),
        "photo_urls": p_urls,
        "photos_count": len(p_urls),
        "has_face_embedding": bool(emp.get("face_embeddings") or emp.get("face_embedding")),
        "created_at": emp.get("created_at"),
        "updated_at": emp.get("updated_at")
    }


@router.post("/employees")
async def create_employee(
    name: str = Form(...),
    email: str = Form(""),
    department: str = Form("General"),
    status: str = Form("authorised"),
    photo: Optional[UploadFile] = File(None),
    photos: Optional[List[UploadFile]] = File(None)
):
    """
    Enrolls a new employee into MongoDB with up to 5 multi-angle photos.
    Syncs with synopsis-service on port 8005 to generate biometric face embeddings.
    """
    if db is None:
        raise HTTPException(status_code=500, detail="Database not connected")

    emp_id = f"EMP-{uuid.uuid4().hex[:8].upper()}"

    # Collect up to 5 uploaded photos
    upload_items = []
    if photos:
        upload_items.extend([p for p in photos if p and getattr(p, 'filename', None)])
    if photo and getattr(photo, 'filename', None) and photo not in upload_items:
        upload_items.insert(0, photo)

    upload_items = upload_items[:5]

    # Try delegating to synopsis service first for OpenCV YuNet & SFace extraction
    if upload_items:
        try:
            async with aiohttp.ClientSession() as session:
                data = aiohttp.FormData()
                data.add_field("name", name)
                data.add_field("email", email)
                data.add_field("department", department)
                data.add_field("status", status)
                for item in upload_items:
                    content = await item.read()
                    data.add_field("photos", content, filename=item.filename, content_type=item.content_type or "image/jpeg")
                    await item.seek(0)
                async with session.post(f"{SYNOPSIS_SERVICE_URL}/a1/v1/synopsis/employees", data=data, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status in (200, 201):
                        return await resp.json()
        except Exception:
            pass

    # Fallback local save in onvif-backend
    photo_urls = []
    for idx, item in enumerate(upload_items):
        try:
            photo_bytes = await item.read()
            photo_filename = f"{emp_id}_{idx}.jpg"
            save_path = os.path.join(STATIC_FACES_DIR, photo_filename)
            with open(save_path, "wb") as f:
                f.write(photo_bytes)
            photo_urls.append(f"/api/faces/{photo_filename}")
        except Exception:
            pass

    status_val = status.lower() if status else "authorised"
    if status_val not in ("authorised", "suspended"):
        status_val = "authorised"

    now = datetime.utcnow().isoformat()
    primary_url = photo_urls[0] if photo_urls else None

    doc = {
        "emp_id": emp_id,
        "name": name.strip(),
        "email": email.strip() if email else "",
        "department": department.strip() if department else "General",
        "status": status_val,
        "photo_url": primary_url,
        "photo_urls": photo_urls,
        "photos_count": len(photo_urls),
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
        "photo_urls": doc["photo_urls"],
        "photos_count": len(photo_urls),
        "has_face_embedding": False,
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
    photo: Optional[UploadFile] = File(None),
    photos: Optional[List[UploadFile]] = File(None)
):
    """Updates an existing employee's details, photos, or clearance status."""
    if db is None:
        raise HTTPException(status_code=500, detail="Database not connected")

    col = db["employees"]
    emp = col.find_one({"emp_id": emp_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    upload_items = []
    if photos:
        upload_items.extend([p for p in photos if p and getattr(p, 'filename', None)])
    if photo and getattr(photo, 'filename', None) and photo not in upload_items:
        upload_items.insert(0, photo)

    upload_items = upload_items[:5]

    # Forward to synopsis service if available
    try:
        async with aiohttp.ClientSession() as session:
            data = aiohttp.FormData()
            if name: data.add_field("name", name)
            if email: data.add_field("email", email)
            if department: data.add_field("department", department)
            if status: data.add_field("status", status)
            for item in upload_items:
                content = await item.read()
                data.add_field("photos", content, filename=item.filename, content_type=item.content_type or "image/jpeg")
                await item.seek(0)
            async with session.put(f"{SYNOPSIS_SERVICE_URL}/a1/v1/synopsis/employees/{emp_id}", data=data, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                if resp.status in (200, 201):
                    return await resp.json()
    except Exception:
        pass

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

    if upload_items:
        photo_urls = []
        for idx, item in enumerate(upload_items):
            try:
                photo_bytes = await item.read()
                photo_filename = f"{emp_id}_{idx}.jpg"
                save_path = os.path.join(STATIC_FACES_DIR, photo_filename)
                with open(save_path, "wb") as f:
                    f.write(photo_bytes)
                photo_urls.append(f"/api/faces/{photo_filename}")
            except Exception:
                pass
        if photo_urls:
            update_fields["photo_urls"] = photo_urls
            update_fields["photo_url"] = photo_urls[0]
            update_fields["photos_count"] = len(photo_urls)

    col.update_one({"emp_id": emp_id}, {"$set": update_fields})
    updated = col.find_one({"emp_id": emp_id})
    p_urls = updated.get("photo_urls") or ([updated.get("photo_url")] if updated.get("photo_url") else [])

    return {
        "emp_id": updated.get("emp_id"),
        "name": updated.get("name"),
        "email": updated.get("email", ""),
        "department": updated.get("department", "General"),
        "status": (updated.get("status") or "authorised").lower(),
        "photo_url": updated.get("photo_url") or (p_urls[0] if p_urls else None),
        "photo_urls": p_urls,
        "photos_count": len(p_urls),
        "has_face_embedding": bool(updated.get("face_embeddings") or updated.get("face_embedding")),
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
    import glob
    for fpath in glob.glob(os.path.join(STATIC_FACES_DIR, f"{emp_id}*.jpg")):
        try:
            os.remove(fpath)
        except Exception:
            pass

    # Also delete on synopsis-service
    try:
        async with aiohttp.ClientSession() as session:
            await session.delete(f"{SYNOPSIS_SERVICE_URL}/a1/v1/synopsis/employees/{emp_id}", timeout=aiohttp.ClientTimeout(total=3))
    except Exception:
        pass

    return {"success": True, "deleted_emp_id": emp_id}
