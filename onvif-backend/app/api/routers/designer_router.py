from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from app.core.database import mongo_client
from datetime import datetime
from pydantic import BaseModel, Field, validator, field_validator
from typing import List, Optional, Any, Dict
from app.core.security import verify_token
from app.api.routers.auth_router import limiter
from fastapi import Request
from app.core.ws_manager import ws_manager
import os
import io
import base64
import shutil
import asyncio
import tempfile
import subprocess
import json
from pathlib import Path
from fastapi.responses import StreamingResponse

MONGO_URI = os.environ["MONGO_URI"]
_client   = mongo_client
_db = _client[os.environ.get("MONGO_DB_NAME")] if _client else None
designer_col = _db["designer_layouts"] if _db is not None else None

router = APIRouter(prefix="/api/designer", tags=["designer"])


# ── Pydantic models ───────────────────────────────────────────────

class PlacedCamera(BaseModel):
    id: str = Field(..., max_length=255)
    x:         float
    y:         float
    direction: float
    camera:    Dict[str, Any]

    class Config:
        extra = "allow"


class ZonePoint(BaseModel):
    x: float
    y: float

    class Config:
        extra = "allow"


from app.core.validation import validate_name

class Zone(BaseModel):
    id: str = Field(..., max_length=255)
    name: str = Field(..., max_length=255)
    color: str = Field(..., max_length=255)
    polygon:       List[ZonePoint]
    isShape:       Optional[bool] = False
    isBoomBarrier: Optional[bool] = False

    class Config:
        extra = "allow"

    @field_validator("name", mode="before")
    @classmethod
    def val_name(cls, v):
        return validate_name(v)


class DesignerSaveRequest(BaseModel):
    map_id:      Optional[str]              = "default"
    floor_id:    Optional[str]              = "floor_1"
    placed:      Optional[List[PlacedCamera]] = []
    zones:       Optional[List[Zone]]         = []
    floor_plan:  Optional[str]              = Field(None, max_length=100_000_000)
    ppm:         Optional[float]            = 22.0
    slides:      Optional[List[Any]]        = None
    active_slide_id: Optional[str]          = None

    class Config:
        extra = "allow"

    @field_validator('floor_plan')
    @classmethod
    def validate_floor_plan(cls, v):
        if v is not None and not (
            v.startswith('data:image/')
            or v.startswith('http://')
            or v.startswith('https://')
            or v.startswith('/')
            or v.startswith('blob:')
        ):
            raise ValueError('Invalid image format.')
        return v


class FloorPlanRequest(BaseModel):
    map_id:     Optional[str] = "default"
    floor_id:   Optional[str] = "floor_1"
    floor_plan: str = Field(..., max_length=100_000_000)

    class Config:
        extra = "allow"

    @field_validator('floor_plan')
    @classmethod
    def validate_floor_plan(cls, v):
        if v is not None and not (
            v.startswith('data:image/')
            or v.startswith('http://')
            or v.startswith('https://')
            or v.startswith('/')
            or v.startswith('blob:')
        ):
            raise ValueError('Invalid image format.')
        return v


class ZoneDetectRequest(BaseModel):
    map_id:     Optional[str] = "default"
    floor_id:   Optional[str] = "floor_1"
    source:     Optional[str] = "designer"
    floor_plan: Optional[str] = Field(None, max_length=100_000_000)



# ── GET /api/designer/camera-models ──────────────────────────────
@router.get("/camera-models", dependencies=[Depends(verify_token)])
async def get_camera_models(brand: str = None, type: str = None, search: str = None):
    if _db is None:
        return {"cameras": [], "brands": []}
    try:
        query = {}
        if brand:
            query["brand"] = brand
        if type:
            query["type"] = type
        if search:
            query["$or"] = [
                {"brand":  {"$regex": search, "$options": "i"}},
                {"model":  {"$regex": search, "$options": "i"}},
                {"series": {"$regex": search, "$options": "i"}},
                {"notes":  {"$regex": search, "$options": "i"}},
            ]
        col = _db["camera_models"]
        cameras = list(col.find(query, {"_id": 0}))
        brands  = col.distinct("brand")
        return {"cameras": cameras, "brands": sorted(brands)}
    except Exception as e:
        print(f"[CAMERA-MODELS] ❌ {e}")
        return {"cameras": [], "brands": []}


# ── GET /api/designer ─────────────────────────────────────────────
@router.get("", dependencies=[Depends(verify_token)])
def get_designer_layout(map_id: str = "default", floor_id: str = "floor_1"):
    """
    Returns the saved designer state for a given map + floor:
      - placed cameras (with full camera objects)
      - zones (polygons)
      - floor plan image data URL
      - ppm (pixels-per-metre)
      - slides (array of layout slide states)
      - active_slide_id
    """
    doc = designer_col.find_one(
        {"map_id": map_id, "floor_id": floor_id, "is_deleted": {"$ne": True}},
        {"_id": 0}
    )

    if not doc:
        return {
            "map_id":     map_id,
            "floor_id":   floor_id,
            "placed":     [],
            "zones":      [],
            "floor_plan": None,
            "ppm":        22.0,
            "slides":     None,
            "active_slide_id": None,
            "updated_at": None,
        }

    return {
        "map_id":     doc.get("map_id"),
        "floor_id":   doc.get("floor_id"),
        "placed":     [c for c in doc.get("placed", []) if not c.get("is_deleted")],
        "zones":      [z for z in doc.get("zones", []) if not z.get("is_deleted")],
        "floor_plan": doc.get("floor_plan"),
        "ppm":        doc.get("ppm", 22.0),
        "slides":     doc.get("slides"),
        "active_slide_id": doc.get("active_slide_id"),
        "updated_at": doc.get("updated_at"),
    }


# ── GET /api/designer/floors ──────────────────────────────────────
@router.get("/floors", dependencies=[Depends(verify_token)])
def list_designer_floors(map_id: str = "default"):
    """
    Lists all floor IDs that have a saved designer layout for a map.
    """
    docs = list(designer_col.find(
        {"map_id": map_id, "is_deleted": {"$ne": True}},
        {"_id": 0, "floor_id": 1, "updated_at": 1,
         "placed": 1, "zones": 1}
    ))

    return {
        "map_id": map_id,
        "floors": [
            {
                "floor_id":      d.get("floor_id"),
                "camera_count":  len([c for c in d.get("placed", []) if not c.get("is_deleted")]),
                "zone_count":    len([z for z in d.get("zones", []) if not z.get("is_deleted")]),
                "updated_at":    d.get("updated_at"),
            }
            for d in docs
        ]
    }


# ── POST /api/designer ────────────────────────────────────────────
@router.post("", dependencies=[Depends(verify_token)])
def save_designer_layout(req: DesignerSaveRequest):
    """
    Full save of designer state for a map + floor.

    If floor_plan is None in the request, the existing floor plan is preserved
    in the DB (so cameras/zones can be saved without re-uploading the image).
    """
    placed_data = [p.dict() for p in (req.placed or [])]
    zones_data  = [z.dict() for z in (req.zones  or [])]

    # Preserve existing floor_plan if client didn't send one
    existing = designer_col.find_one(
        {"map_id": req.map_id, "floor_id": req.floor_id},
        {"_id": 0, "floor_plan": 1}
    )
    floor_plan = req.floor_plan
    if floor_plan is None and existing:
        floor_plan = existing.get("floor_plan")

    update_doc = {
        "map_id":     req.map_id,
        "floor_id":   req.floor_id,
        "placed":     placed_data,
        "zones":      zones_data,
        "floor_plan": floor_plan,
        "ppm":        req.ppm,
        "updated_at": datetime.utcnow().isoformat(),
    }

    print(f"DEBUG: Received slides? {req.slides is not None}")
    if req.slides is not None:
        print(f"DEBUG: Number of slides: {len(req.slides)}")
        update_doc["slides"] = req.slides
    if req.active_slide_id is not None:
        update_doc["active_slide_id"] = req.active_slide_id

    designer_col.update_one(
        {"map_id": req.map_id, "floor_id": req.floor_id},
        {"$set": update_doc},
        upsert=True,
    )

    ws_manager.publish_sync(
        "designer",
        "designer_updated",
        {
            "map_id": req.map_id,
            "floor_id": req.floor_id,
            "client_id": (req.model_extra or {}).get("client_id"),
            "updated_at": update_doc["updated_at"],
        }
    )

    print(
        f"[DESIGNER] ✅ Saved layout for map='{req.map_id}' floor='{req.floor_id}' | "
        f"{len(placed_data)} camera(s) | {len(zones_data)} zone(s)"
    )
    return {
        "success":      True,
        "map_id":       req.map_id,
        "floor_id":     req.floor_id,
        "camera_count": len(placed_data),
        "zone_count":   len(zones_data),
    }


# ── POST /api/designer/cameras ────────────────────────────────────
@router.post("/cameras", dependencies=[Depends(verify_token)])
def save_placed_cameras(
    map_id:   str = "default",
    floor_id: str = "floor_1",
    placed:   List[PlacedCamera] = [],
):
    """Saves only the placed cameras list for a map + floor."""
    placed_data = [p.dict() for p in placed]

    designer_col.update_one(
        {"map_id": map_id, "floor_id": floor_id, "is_deleted": {"$ne": True}},
        {"$set": {
            "map_id":     map_id,
            "floor_id":   floor_id,
            "placed":     placed_data,
            "updated_at": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )

    print(f"[DESIGNER] 📷 Saved {len(placed_data)} camera(s) for map='{map_id}' floor='{floor_id}'")
    return {"success": True, "map_id": map_id, "floor_id": floor_id, "camera_count": len(placed_data)}


# ── POST /api/designer/zones ──────────────────────────────────────
@router.post("/zones", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")
def save_zones(
    request: Request,
    map_id:   str = "default",
    floor_id: str = "floor_1",
    zones:    List[Zone] = [],
):
    """Saves only the zones list for a map + floor."""
    zones_data = [z.dict() for z in zones]

    designer_col.update_one(
        {"map_id": map_id, "floor_id": floor_id, "is_deleted": {"$ne": True}},
        {"$set": {
            "map_id":     map_id,
            "floor_id":   floor_id,
            "zones":      zones_data,
            "updated_at": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )

    print(f"[DESIGNER] 🗺  Saved {len(zones_data)} zone(s) for map='{map_id}' floor='{floor_id}'")
    return {"success": True, "map_id": map_id, "floor_id": floor_id, "zone_count": len(zones_data)}


# ── DELETE /api/designer/zones/{zone_id} ─────────────────────────
@router.delete("/zones/{zone_id}", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")
def delete_zone(request: Request, zone_id: str, map_id: str = "default", floor_id: str = "floor_1"):
    """Remove a single zone by ID from the designer document."""
    result = designer_col.update_one(
        {"map_id": map_id, "floor_id": floor_id, "is_deleted": {"$ne": True}},
        {"$pull": {"zones": {"id": zone_id}}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")

    print(f"[DESIGNER] 🗑  Deleted zone '{zone_id}' from map='{map_id}' floor='{floor_id}'")
    return {"success": True, "deleted_zone_id": zone_id}


# ── DELETE /api/designer/cameras/{camera_id} ─────────────────────
@router.delete("/cameras/{camera_id}", dependencies=[Depends(verify_token)])
def delete_placed_camera(camera_id: str, map_id: str = "default", floor_id: str = "floor_1"):
    """Remove a single placed camera by its placed ID."""
    result = designer_col.update_one(
        {"map_id": map_id, "floor_id": floor_id, "is_deleted": {"$ne": True}},
        {"$pull": {"placed": {"id": camera_id}}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")

    print(f"[DESIGNER] 🗑  Deleted camera '{camera_id}' from map='{map_id}' floor='{floor_id}'")
    return {"success": True, "deleted_camera_id": camera_id}


# ── POST /api/designer/floor-plan ────────────────────────────────
@router.post("/floor-plan", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")
def save_floor_plan(request: Request, req: FloorPlanRequest):
    """Saves only the floor plan image (base64 data URL) for a map + floor."""
    if not req.floor_plan:
        raise HTTPException(status_code=400, detail="floor_plan is required")

    designer_col.update_one(
        {"map_id": req.map_id, "floor_id": req.floor_id},
        {"$set": {
            "map_id":     req.map_id,
            "floor_id":   req.floor_id,
            "floor_plan": req.floor_plan,
            "updated_at": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )

    print(f"[DESIGNER] 🖼  Floor plan saved for map='{req.map_id}' floor='{req.floor_id}'")
    return {"success": True, "map_id": req.map_id, "floor_id": req.floor_id}


# ── DELETE /api/designer/floor-plan ──────────────────────────────
# FIX 2: New endpoint — removes only the floor plan image, preserving
# cameras and zones. Called when user clicks ✕ on Floor 1 in sidebar.
@router.delete("/floor-plan", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")
def delete_floor_plan(request: Request, map_id: str = "default", floor_id: str = "floor_1"):
    """
    Removes only the floor plan image for a map + floor.
    Placed cameras and zones are preserved.
    """
    result = designer_col.update_one(
        {"map_id": map_id, "floor_id": floor_id, "is_deleted": {"$ne": True}},
        {"$set": {
            "floor_plan": None,
            "updated_at": datetime.utcnow().isoformat(),
        }}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=f"No designer layout found for floor '{floor_id}'")

    print(f"[DESIGNER] 🗑  Floor plan removed for map='{map_id}' floor='{floor_id}'")
    return {"success": True, "map_id": map_id, "floor_id": floor_id}


# ── DELETE /api/designer ──────────────────────────────────────────
@router.delete("", dependencies=[Depends(verify_token)])
def delete_designer_layout(map_id: str = "default", floor_id: str = "floor_1"):
    """Soft delete the entire designer document for a map + floor."""
    result = designer_col.update_one({"map_id": map_id, "floor_id": floor_id}, {"$set": {"is_deleted": True}})
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=f"No designer layout found for floor '{floor_id}'")

    print(f"[DESIGNER] 🗑  Deleted designer layout for map='{map_id}' floor='{floor_id}'")
    return {"success": True, "map_id": map_id, "floor_id": floor_id}


# ── DELETE /api/designer/all ──────────────────────────────────────
@router.delete("/all", dependencies=[Depends(verify_token)])
def delete_all_designer_layouts(map_id: str = "default"):
    """Soft delete ALL designer documents for a map (all floors)."""
    result = designer_col.update_many({"map_id": map_id}, {"$set": {"is_deleted": True}})
    print(f"[DESIGNER] 🗑  Soft deleted {result.modified_count} designer document(s) for map='{map_id}'")
    # UpdateResult has no 'deleted_count' (that is DeleteResult) -> use modified_count
    return {"success": True, "map_id": map_id, "deleted_count": result.modified_count}


# ── POST /api/designer/detect-zones ──────────────────────────────
@router.post("/detect-zones", dependencies=[Depends(verify_token)])
def detect_zones(req: ZoneDetectRequest):
    """
    Retrieves the saved floor plan for the given map + floor,
    detects room zones using OpenCV, and returns the list of proposed zones.
    """
    floor_plan = req.floor_plan

    if not floor_plan:
        if req.source == "designer":
            doc = designer_col.find_one(
                {"map_id": req.map_id, "floor_id": req.floor_id},
                {"_id": 0, "floor_plan": 1}
            )
            if doc and doc.get("floor_plan"):
                floor_plan = doc.get("floor_plan")

            if not floor_plan:
                maps_col = _db["map_layouts"]
                floor_doc = maps_col.find_one(
                    {"map_id": req.map_id, "doc_type": "floor", "floor_id": req.floor_id},
                    {"_id": 0, "imageDataUrl": 1}
                )
                if floor_doc and floor_doc.get("imageDataUrl"):
                    floor_plan = floor_doc.get("imageDataUrl")
                elif req.floor_id == "floor_1":
                    legacy_doc = maps_col.find_one(
                        {"map_id": req.map_id},
                        {"_id": 0, "floor_plan": 1}
                    )
                    if legacy_doc and legacy_doc.get("floor_plan"):
                        floor_plan = legacy_doc.get("floor_plan")
        else:
            maps_col = _db["map_layouts"]
            floor_doc = maps_col.find_one(
                {"map_id": req.map_id, "doc_type": "floor", "floor_id": req.floor_id},
                {"_id": 0, "imageDataUrl": 1}
            )
            if floor_doc and floor_doc.get("imageDataUrl"):
                floor_plan = floor_doc.get("imageDataUrl")
            elif req.floor_id == "floor_1":
                legacy_doc = maps_col.find_one(
                    {"map_id": req.map_id},
                    {"_id": 0, "floor_plan": 1}
                )
                if legacy_doc and legacy_doc.get("floor_plan"):
                    floor_plan = legacy_doc.get("floor_plan")

            if not floor_plan:
                doc = designer_col.find_one(
                    {"map_id": req.map_id, "floor_id": req.floor_id},
                    {"_id": 0, "floor_plan": 1}
                )
                if doc and doc.get("floor_plan"):
                    floor_plan = doc.get("floor_plan")

    if not floor_plan:
        raise HTTPException(status_code=400, detail="No floor plan uploaded for this map and floor")

    try:
        from app.utils.zone_detection import detect_zones_from_base64
        detected = detect_zones_from_base64(floor_plan)
        return {"success": True, "zones": detected}
    except Exception as e:
        print(f"[ZONE-DETECTION] ❌ Failed to detect zones: {e}")
        raise HTTPException(status_code=500, detail=f"Zone detection error: {str(e)}")


# ── POST /api/designer/upload-datasheet ──────────────────────────────
@router.post("/upload-datasheet", dependencies=[Depends(verify_token)])
@limiter.limit("1/minute")
async def upload_datasheet(request: Request, file: UploadFile = File(...), overwrite: bool = Form(False)):
    """
    Parses a camera datasheet PDF and extracts specs to insert a new camera_model.
    Skips if a camera with the same brand and model already exists.
    """
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        import pdfplumber
        from app.utils.datasheet_parser import DatasheetParser
        import io

        # Read the file in memory
        content = await file.read()

        # Extract text using pdfplumber
        text = ""
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"

        if not text.strip():
            raise HTTPException(status_code=400, detail="Could not extract text from the PDF. It may be an image-only PDF.")

        # Parse text using the heuristic parser
        parser = DatasheetParser(text)
        extracted_data = parser.parse()

        if not extracted_data:
            raise HTTPException(status_code=500, detail="Failed to parse data from the PDF.")

        # Check if exists (Skip strategy as per user request)
        cam_col = _db["camera_models"]
        existing = cam_col.find_one({"id": extracted_data["id"]})
        if not existing:
            # Maybe check by brand and model too just in case id generation differs
            existing = cam_col.find_one({
                "brand": {"$regex": f"^{extracted_data['brand']}$", "$options": "i"},
                "model": {"$regex": f"^{extracted_data['model']}$", "$options": "i"}
            })

        if existing:
            if overwrite:
                cam_col.update_one({"_id": existing["_id"]}, {"$set": extracted_data})
                return {
                    "success": True,
                    "skipped": False,
                    "message": f"Camera model {extracted_data['brand']} {extracted_data['model']} was successfully overwritten.",
                    "camera": {k: v for k, v in extracted_data.items() if k != '_id'}
                }
            else:
                return {
                    "success": True,
                    "skipped": True,
                    "message": f"Camera model {extracted_data['brand']} {extracted_data['model']} already exists. (Skipped)",
                    "camera": {k: v for k, v in existing.items() if k != '_id'}
                }
        # Insert new camera model
        cam_col.insert_one(extracted_data)

        return {
            "success": True,
            "skipped": False,
            "message": "Datasheet processed and camera model added successfully.",
            "camera": {k: v for k, v in extracted_data.items() if k != '_id'}
        }

    except Exception as e:
        print(f"[DATASHEET-UPLOAD] ❌ Failed to process datasheet: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process datasheet: {str(e)}")

    

# ── POST /api/designer/convert-ppt ───────────────────────────────
def _soffice_path():
    env = os.environ.get("SOFFICE_PATH")
    if env and os.path.exists(env):
        return env
    found = shutil.which("soffice") or shutil.which("soffice.exe")
    if found:
        return found
    for p in (
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ):
        if os.path.exists(p):
            return p
    return None


def _fix_pptx_text(src_path):
    """Stop tiny badge text from wrapping: wrap=none, zero insets."""
    import zipfile, re
    tmp = src_path + ".fixed"
    with zipfile.ZipFile(src_path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if re.match(r"ppt/slides/slide\d+\.xml$", item.filename):
                xml = data.decode("utf-8")
                xml = re.sub(
                    r"<a:bodyPr([^>]*?)(/?)>",
                    lambda m: "<a:bodyPr"
                        + re.sub(r'\s(wrap|lIns|rIns|tIns|bIns)="[^"]*"', "", m.group(1))
                        + ' wrap="none" lIns="0" rIns="0" tIns="0" bIns="0"'
                        + m.group(2) + ">",
                    xml)
                data = xml.encode("utf-8")
            zout.writestr(item, data)
    os.replace(tmp, src_path)


def _run_soffice(soffice, src, d, timeout=300):
    profile_uri = Path(d, "profile").as_uri()
    env = os.environ.copy()
    env["SAL_DISABLEGL"] = "1"          # avoid GPU/OpenGL crashes
    env["SAL_DISABLE_OPENCL"] = "1"
    proc = subprocess.run(
        [soffice, f"-env:UserInstallation={profile_uri}",
         "--headless", "--norestore", "--nolockcheck", "--nodefault", "--nologo",
         "--convert-to", "pdf:impress_pdf_Export",
         "--outdir", d, src],
        timeout=timeout, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
    )
    pdf_path = os.path.join(d, Path(src).stem + ".pdf")
    if proc.returncode != 0 or not os.path.exists(pdf_path):
        raise RuntimeError(
            f"soffice rc={proc.returncode} stderr={proc.stderr.decode(errors='ignore')[:500]} "
            f"stdout={proc.stdout.decode(errors='ignore')[:300]}"
        )
    return pdf_path


def _convert_ppt_sync(data: bytes, filename: str):
    import fitz  # PyMuPDF
    import traceback

    soffice = _soffice_path()
    if not soffice:
        raise RuntimeError("LibreOffice (soffice) not found. Install it or set SOFFICE_PATH.")

    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in (".ppt", ".pptx"):
        ext = ".pptx"

    with tempfile.TemporaryDirectory() as d:
        pdf_path = None
        attempts = [True, False] if ext == ".pptx" else [False]
        last_err = None

        for use_fix in attempts:
            sub = os.path.join(d, "fix" if use_fix else "plain")
            os.makedirs(sub, exist_ok=True)
            src = os.path.join(sub, "input" + ext)
            with open(src, "wb") as f:
                f.write(data)
            try:
                if use_fix:
                    _fix_pptx_text(src)
                pdf_path = _run_soffice(soffice, src, sub)
                break
            except Exception as e:
                last_err = e
                print(f"[PPT-CONVERT] attempt (fix={use_fix}) failed: {e}")
                traceback.print_exc()

        if not pdf_path:
            raise RuntimeError(str(last_err))

        slides = []
        doc = fitz.open(pdf_path)
        for i, page in enumerate(doc):
            pix = page.get_pixmap(dpi=150)
            b64 = base64.b64encode(pix.tobytes("png")).decode()
            slides.append({
                "slideIndex": i + 1,
                "name": f"Slide {i + 1}",
                "dataUrl": "data:image/png;base64," + b64,
            })
        doc.close()
        return slides

@router.post("/convert-ppt", dependencies=[Depends(verify_token)])
async def convert_ppt(file: UploadFile = File(...)):
    """Converts .ppt/.pptx to one PNG per slide using LibreOffice + PyMuPDF."""
    data = await file.read()
    if len(data) > 30 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 30MB).")
    try:
        slides = await asyncio.to_thread(_convert_ppt_sync, data, file.filename)
        return {"slides": slides}
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[PPT-CONVERT] ❌ {e}")
        raise HTTPException(status_code=500, detail=f"PPT conversion failed: {str(e)}")

# ── POST /api/designer/convert-ppt-stream ────────────────────────
def _ndjson(obj):
    return (json.dumps(obj) + "\n").encode("utf-8")


def _ppt_to_pdf(data: bytes, filename: str, d: str):
    """Same logic as the first half of _convert_ppt_sync, but works in dir `d`."""
    import traceback
    soffice = _soffice_path()
    if not soffice:
        raise RuntimeError("LibreOffice (soffice) not found. Install it or set SOFFICE_PATH.")

    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in (".ppt", ".pptx"):
        ext = ".pptx"

    attempts = [True, False] if ext == ".pptx" else [False]
    last_err = None
    for use_fix in attempts:
        sub = os.path.join(d, "fix" if use_fix else "plain")
        os.makedirs(sub, exist_ok=True)
        src = os.path.join(sub, "input" + ext)
        with open(src, "wb") as f:
            f.write(data)
        try:
            if use_fix:
                _fix_pptx_text(src)
            return _run_soffice(soffice, src, sub)
        except Exception as e:
            last_err = e
            print(f"[PPT-CONVERT] attempt (fix={use_fix}) failed: {e}")
            traceback.print_exc()
    raise RuntimeError(str(last_err))


def _render_pdf_page(doc, i):
    page = doc[i]
    pix = page.get_pixmap(dpi=150)
    b64 = base64.b64encode(pix.tobytes("png")).decode()
    return {
        "slideIndex": i + 1,
        "name": f"Slide {i + 1}",
        "dataUrl": "data:image/png;base64," + b64,
    }


@router.post("/convert-ppt-stream", dependencies=[Depends(verify_token)])
async def convert_ppt_stream(file: UploadFile = File(...)):
    """Streams NDJSON: progress events, one 'slide' event per page, then 'done'."""
    data = await file.read()
    if len(data) > 30 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 30MB).")
    filename = file.filename

    async def gen():
        import fitz
        d = tempfile.mkdtemp()
        try:
            yield _ndjson({"type": "progress", "percent": 35, "stage": "Converting presentation…"})

            task = asyncio.create_task(asyncio.to_thread(_ppt_to_pdf, data, filename, d))
            pct = 35.0
            while not task.done():
                await asyncio.sleep(0.7)
                pct = min(64.0, pct + (64.0 - pct) * 0.08)   # estimated creep 35 → 64
                yield _ndjson({"type": "progress", "percent": round(pct, 1),
                               "stage": "Converting presentation…"})
            pdf_path = await task

            doc = fitz.open(pdf_path)
            total = len(doc)
            yield _ndjson({"type": "progress", "percent": 65,
                           "stage": f"Rendering {total} page(s)…"})
            for i in range(total):
                slide = await asyncio.to_thread(_render_pdf_page, doc, i)
                yield _ndjson({
                    "type": "slide",
                    "slide": slide,
                    "percent": 65 + round(35 * (i + 1) / total, 1),
                    "stage": f"Rendering page {i + 1} of {total}…",
                })
            doc.close()
            yield _ndjson({"type": "done", "percent": 100})
        except Exception as e:
            print(f"[PPT-CONVERT] ❌ {e}")
            yield _ndjson({"type": "error", "detail": str(e)})
        finally:
            shutil.rmtree(d, ignore_errors=True)

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )