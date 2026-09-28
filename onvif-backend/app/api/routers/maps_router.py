from fastapi import APIRouter, HTTPException, Depends
from app.core.database import mongo_client
from datetime import datetime
from pydantic import BaseModel, Field, validator
from typing import List, Optional
from app.core.security import verify_token
import os

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
_client   = mongo_client
_db = _client[os.environ.get("MONGO_DB_NAME")] if _client else None
maps_col = _db["map_layouts"] if _db is not None else None

router = APIRouter(prefix="/api/maps", tags=["maps"])


# ── Pydantic models ───────────────────────────────────────────────

class Marker(BaseModel):
    camId:     str
    camName:   Optional[str] = ""
    camIp:     Optional[str] = ""
    x:         float
    y:         float
    fovAngle:  Optional[float] = 60
    direction: Optional[float] = 0


class Floor(BaseModel):
    id:           str
    name:         str
    imageDataUrl: Optional[str] = Field(None, max_length=10_485_760)
    modelDataUrl: Optional[str] = Field(None, max_length=15_728_640)   # base64 .glb/.gltf, ~15MB cap
    ppm:          Optional[float] = None
    calibration:  Optional[dict] = None
    partsReport:  Optional[dict] = None
    markers:      List[Marker]  = []

    @validator('imageDataUrl')
    def validate_image_data_url(cls, v):
        if v is not None and not v.startswith('data:image/'):
            raise ValueError('Invalid image format. Must be a base64 data URL starting with data:image/')
        return v

    @validator('modelDataUrl')
    def validate_model_data_url(cls, v):
        if v is not None and not (
            v.startswith('data:model/')
            or v.startswith('data:application/octet-stream')
            or v.startswith('http://')
            or v.startswith('https://')
        ):
            raise ValueError(
                'Invalid model format. Must be a base64 data URL for a .glb/.gltf file, '
                'or an http(s) URL to a hosted model file'
            )
        return v


class MapSaveRequest(BaseModel):
    map_id:     Optional[str]         = "default"
    floors:     Optional[List[Floor]] = None
    # legacy single-floor fields
    markers:    Optional[List[Marker]] = None
    floor_plan: Optional[str]          = Field(None, max_length=10_485_760)
    ppm:        Optional[float]        = None
    calibration: Optional[dict]        = None

    @validator('floor_plan')
    def validate_floor_plan(cls, v):
        if v is not None and not v.startswith('data:image/'):
            raise ValueError('Invalid image format. Must be a base64 data URL starting with data:image/')
        return v

# ── Zone models ───────────────────────────────────────────────────

class ZonePoint(BaseModel):
    x: float
    y: float


class Zone(BaseModel):
    id:         str
    name:       str
    color:      str
    polygon:    List[ZonePoint]
    floorIndex: Optional[int] = 0   # which floor this zone belongs to


class ZoneSaveRequest(BaseModel):
    map_id: Optional[str] = "default"
    zones:  List[Zone]    = []


# ── Legacy migration helper ───────────────────────────────────────

def _migrate_to_floors(doc: dict) -> List[dict]:
    """Convert old single-document format to floors list."""
    if doc.get("floors"):
        return doc["floors"]
    return [{
        "id":           "floor_1",
        "name":         "Floor 1",
        "imageDataUrl": doc.get("floor_plan"),
        "modelDataUrl": doc.get("modelDataUrl"),
        "ppm":          doc.get("ppm"),
        "calibration":  doc.get("calibration"),
        "markers":      doc.get("markers", []),
        "floor_index":  0,
    }]


# ── GET /api/maps ─────────────────────────────────────────────────
@router.get("", dependencies=[Depends(verify_token)])
def get_map(map_id: str = "default"):
    # Fetch all documents for this map_id, sorted by floor_index
    all_docs = list(maps_col.find({"map_id": map_id, "is_deleted": {"$ne": True}}, {"_id": 0}).sort("floor_index", 1))

    if not all_docs:
        return {
            "map_id":     map_id,
            "floors":     [],
            "zones":      [],
            "markers":    [],
            "floor_plan": None,
        }

    # Separate floor docs from zones doc
    floor_docs = [d for d in all_docs if d.get("doc_type") == "floor"]
    zones_doc  = next((d for d in all_docs if d.get("doc_type") == "zones"), None)

    # If no typed docs exist, fall back to legacy single-document format
    if not floor_docs:
        legacy = next((d for d in all_docs if not d.get("doc_type")), None)
        if legacy:
            floors = _migrate_to_floors(legacy)
            zones  = legacy.get("zones", [])
            return {
                "map_id":     map_id,
                "floors":     floors,
                "zones":      zones,
                "markers":    legacy.get("markers", []),
                "floor_plan": legacy.get("floor_plan"),
                "ppm":        legacy.get("ppm"),
                "calibration": legacy.get("calibration"),
                "updated_at": legacy.get("updated_at"),
            }
        return {
            "map_id":     map_id,
            "floors":     [],
            "zones":      [],
            "markers":    [],
            "floor_plan": None,
        }

    # Build floors array from separate documents
    floors = []
    for doc in floor_docs:
        floors.append({
            "id":           doc.get("floor_id"),
            "name":         doc.get("name"),
            "imageDataUrl": doc.get("imageDataUrl"),
            "modelDataUrl": doc.get("modelDataUrl"),
            "ppm":          doc.get("ppm"),
            "calibration":  doc.get("calibration"),
            "partsReport":  doc.get("partsReport"),
            "markers":      doc.get("markers", []),
            "floor_index":  doc.get("floor_index", 0),
        })

    zones = [z for z in zones_doc.get("zones", []) if not z.get("is_deleted")] if zones_doc else []

    return {
        "map_id":     map_id,
        "floors":     floors,
        "zones":      zones,
        "markers":    [],
        "floor_plan": None,
        "updated_at": floor_docs[0].get("updated_at") if floor_docs else None,
    }


# ── POST /api/maps ────────────────────────────────────────────────
@router.post("", dependencies=[Depends(verify_token)])
def save_map(req: MapSaveRequest):
    if req.floors is not None:
        # Save each floor as its own separate document
        total_markers = 0
        for idx, f in enumerate(req.floors):
            floor_dict = f.dict()

            # Preserve existing imageDataUrl / modelDataUrl / ppm / calibration if client sent None
            existing_floor = maps_col.find_one(
                {"map_id": req.map_id, "doc_type": "floor", "floor_id": f.id},
                {"_id": 0}
            )
            if floor_dict["imageDataUrl"] is None and existing_floor:
                floor_dict["imageDataUrl"] = existing_floor.get("imageDataUrl")
            if floor_dict["modelDataUrl"] is None and existing_floor:
                floor_dict["modelDataUrl"] = existing_floor.get("modelDataUrl")
            if floor_dict["ppm"] is None and existing_floor:
                floor_dict["ppm"] = existing_floor.get("ppm")
            if floor_dict.get("calibration") is None and existing_floor:
                floor_dict["calibration"] = existing_floor.get("calibration")
            if floor_dict["partsReport"] is None and existing_floor:
                floor_dict["partsReport"] = existing_floor.get("partsReport")

            maps_col.update_one(
                {"map_id": req.map_id, "doc_type": "floor", "floor_id": f.id},
                {"$set": {
                    "map_id":       req.map_id,
                    "doc_type":     "floor",
                    "floor_id":     f.id,
                    "floor_index":  idx,
                    "name":         f.name,
                    "imageDataUrl": floor_dict["imageDataUrl"],
                    "modelDataUrl": floor_dict["modelDataUrl"],
                    "ppm":          floor_dict["ppm"],
                    "calibration":  floor_dict.get("calibration"),
                    "partsReport":  floor_dict["partsReport"],
                    "markers":      floor_dict["markers"],
                    "updated_at":   datetime.utcnow().isoformat(),
                }},
                upsert=True,
            )
            total_markers += len(floor_dict["markers"])

        print(
            f"[MAPS] ✅ Saved {len(req.floors)} floor(s) for map '{req.map_id}' | "
            f"{total_markers} total markers"
        )
        return {"success": True, "map_id": req.map_id, "marker_count": total_markers}

    else:
        # Legacy single-floor save (backward compat)
        existing     = maps_col.find_one({"map_id": req.map_id}, {"_id": 0})
        floor_plan   = req.floor_plan or (existing.get("floor_plan") if existing else None)
        markers_data = [m.dict() for m in (req.markers or [])]

        maps_col.update_one(
            {"map_id": req.map_id},
            {"$set": {
                "markers":    markers_data,
                "floor_plan": floor_plan,
                "ppm":        req.ppm or (existing.get("ppm") if existing else None),
                "calibration": req.calibration or (existing.get("calibration") if existing else None),
                "updated_at": datetime.utcnow().isoformat(),
            }},
            upsert=True,
        )
        print(f"[MAPS] ✅ Legacy save for map '{req.map_id}': {len(markers_data)} markers")
        return {"success": True, "map_id": req.map_id, "marker_count": len(markers_data)}


# ── POST /api/maps/zones ──────────────────────────────────────────
@router.post("/zones", dependencies=[Depends(verify_token)])
def save_zones(req: ZoneSaveRequest):
    """
    Saves all zone definitions for a map in a single dedicated document.
    Each zone has a floorIndex field so zones are floor-specific on the frontend.
    """
    zones_data = [z.dict() for z in req.zones]

    maps_col.update_one(
        {"map_id": req.map_id, "doc_type": "zones"},
        {"$set": {
            "map_id":     req.map_id,
            "doc_type":   "zones",
            "zones":      zones_data,
            "updated_at": datetime.utcnow().isoformat(),
        }},
        upsert=True,
    )
    print(f"[MAPS] 🗺  Saved {len(zones_data)} zone(s) for map '{req.map_id}'")
    return {"success": True, "map_id": req.map_id, "zone_count": len(zones_data)}


# ── DELETE /api/maps/zones/{zone_id} ─────────────────────────────
@router.delete("/zones/{zone_id}", dependencies=[Depends(verify_token)])
def delete_zone(zone_id: str, map_id: str = "default"):
    """Remove a single zone by ID from the zones document."""
    result = maps_col.update_one(
        {"map_id": map_id, "doc_type": "zones", "zones.id": zone_id},
        {"$set": {"zones.$.is_deleted": True}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found")

    print(f"[MAPS] 🗑  Deleted zone '{zone_id}' from map '{map_id}'")
    return {"success": True, "map_id": map_id, "deleted_zone_id": zone_id}


# ── DELETE /api/maps/floor ────────────────────────────────────────
@router.delete("/floor", dependencies=[Depends(verify_token)])
def delete_floor(floor_id: str, map_id: str = "default"):
    """Delete a floor's own document from MongoDB and re-index remaining floors."""
    result = maps_col.update_one(
        {"map_id": map_id, "doc_type": "floor", "floor_id": floor_id},
        {"$set": {"is_deleted": True}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail=f"Floor '{floor_id}' not found")

    # Re-index remaining floors so floor_index stays sequential (0, 1, 2 ...)
    remaining = list(
        maps_col.find({"map_id": map_id, "doc_type": "floor", "is_deleted": {"$ne": True}}, {"_id": 0})
               .sort("floor_index", 1)
    )
    for new_idx, doc in enumerate(remaining):
        maps_col.update_one(
            {"map_id": map_id, "doc_type": "floor", "floor_id": doc["floor_id"]},
            {"$set": {"floor_index": new_idx}}
        )

    print(f"[MAPS] 🗑  Deleted floor '{floor_id}' from map '{map_id}', re-indexed {len(remaining)} remaining floors")
    return {"success": True, "map_id": map_id, "deleted_floor_id": floor_id}


# ── DELETE /api/maps ──────────────────────────────────────────────
@router.delete("", dependencies=[Depends(verify_token)])
def delete_map(map_id: str = "default"):
    """Delete ALL documents for a map (all floors + zones)."""
    result = maps_col.update_many({"map_id": map_id}, {"$set": {"is_deleted": True}})
    print(f"[MAPS] 🗑  Marked all {result.modified_count} document(s) as deleted for map '{map_id}'")
    return {"success": True, "map_id": map_id}


# ── POST /api/maps/floor-plan ─────────────────────────────────────
# Legacy endpoint — updates imageDataUrl for a specific floor document
@router.post("/floor-plan", dependencies=[Depends(verify_token)])
def save_floor_plan(payload: dict):
    map_id     = payload.get("map_id", "default")
    floor_plan = payload.get("floor_plan")
    floor_id   = payload.get("floor_id", "floor_1")

    if not floor_plan:
        raise HTTPException(status_code=400, detail="floor_plan required")
    if len(floor_plan) > 10_485_760:
        raise HTTPException(status_code=400, detail="floor_plan image too large (max 10MB)")
        
    if not floor_plan.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Invalid image format. Must be a base64 image data URL starting with data:image/")

    # Try new per-floor document first
    result = maps_col.update_one(
        {"map_id": map_id, "doc_type": "floor", "floor_id": floor_id},
        {"$set": {
            "imageDataUrl": floor_plan,
            "updated_at":   datetime.utcnow().isoformat(),
        }},
    )

    # Fall back to legacy single-document format
    if result.matched_count == 0:
        maps_col.update_one(
            {"map_id": map_id},
            {"$set": {
                "floor_plan": floor_plan,
                "updated_at": datetime.utcnow().isoformat(),
            }},
            upsert=True,
        )

    print(f"[MAPS] ✅ Floor plan saved for map '{map_id}' floor '{floor_id}'")
    return {"success": True, "map_id": map_id, "floor_id": floor_id}