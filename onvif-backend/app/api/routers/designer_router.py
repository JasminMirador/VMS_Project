from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from app.core.database import mongo_client
from datetime import datetime
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Any, Dict
from app.core.security import verify_token
import os

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
_client   = mongo_client
_db = _client[os.environ.get("MONGO_DB_NAME")] if _client else None
designer_col = _db["designer_layouts"] if _db is not None else None

router = APIRouter(prefix="/api/designer", tags=["designer"])


# ── Pydantic models ───────────────────────────────────────────────

class PlacedCamera(BaseModel):
    id:        str
    x:         float
    y:         float
    direction: float
    camera:    Dict[str, Any]


class ZonePoint(BaseModel):
    x: float
    y: float


from app.core.validation import validate_name

class Zone(BaseModel):
    id:      str
    name:    str
    color:   str
    polygon: List[ZonePoint]
    
    @validator("name", pre=True)
    def val_name(cls, v):
        return validate_name(v)


class DesignerSaveRequest(BaseModel):
    map_id:      Optional[str]              = "default"
    floor_id:    Optional[str]              = "floor_1"
    placed:      Optional[List[PlacedCamera]] = []
    zones:       Optional[List[Zone]]         = []
    floor_plan:  Optional[str]              = Field(None, max_length=5_242_880)
    ppm:         Optional[float]            = 22.0
    slides:      Optional[List[Any]]        = None
    active_slide_id: Optional[str]          = None

    @validator('floor_plan')
    def validate_floor_plan(cls, v):
        if v is not None and not v.startswith('data:image/'):
            raise ValueError('Invalid image format. Must be a base64 data URL starting with data:image/')
        return v


class FloorPlanRequest(BaseModel):
    map_id:     Optional[str] = "default"
    floor_id:   Optional[str] = "floor_1"
    floor_plan: str = Field(..., max_length=5_242_880)

    @validator('floor_plan')
    def validate_floor_plan(cls, v):
        if v is not None and not v.startswith('data:image/'):
            raise ValueError('Invalid image format. Must be a base64 data URL starting with data:image/')
        return v


class ZoneDetectRequest(BaseModel):
    map_id:     Optional[str] = "default"
    floor_id:   Optional[str] = "floor_1"
    source:     Optional[str] = "designer"
    floor_plan: Optional[str] = Field(None, max_length=5_242_880)



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
def save_zones(
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
def delete_zone(zone_id: str, map_id: str = "default", floor_id: str = "floor_1"):
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
def save_floor_plan(req: FloorPlanRequest):
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
def delete_floor_plan(map_id: str = "default", floor_id: str = "floor_1"):
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
    return {"success": True, "map_id": map_id, "deleted_count": result.deleted_count}


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
async def upload_datasheet(file: UploadFile = File(...), overwrite: bool = Form(False)):
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