"""
masks_router.py — Privacy mask CRUD for Mirador VMS
Persists mask polygons in MongoDB (or JSON fallback).

Mount in main.py:
    from app.api.routers.masks_router import router as masks_router
    
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, validator
from typing import List, Optional
import os, json

router = APIRouter(prefix="/api/masks", tags=["masks"])

# ── Storage backend ──────────────────────────────────────────────
# Tries MongoDB first, falls back to JSON file

_masks_col = None
try:
    import os
    from app.core.database import mongo_client
    MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
    _mongo    = mongo_client
    _mongo.server_info()
    _db_name = os.environ.get("MONGO_DB_NAME")
    _masks_col = _mongo[_db_name]["masks"]
    print("[MASKS] ✅ MongoDB backend ready")
except Exception as e:
    print(f"[MASKS] ⚠ MongoDB unavailable ({e}) — using JSON fallback")

MASKS_FILE = os.environ.get(
    "MASKS_FILE",
    os.path.join(os.path.dirname(__file__), "..", "devices_data", "masks.json")
)


def _load_file() -> dict:
    """Load all masks from JSON file → {ip: [mask, ...]}"""
    try:
        if os.path.exists(MASKS_FILE):
            with open(MASKS_FILE) as f:
                return json.load(f)
    except Exception as e:
        print(f"[MASKS] JSON load error: {e}")
    return {}


def _save_file(data: dict):
    try:
        os.makedirs(os.path.dirname(MASKS_FILE), exist_ok=True)
        with open(MASKS_FILE, "w") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[MASKS] JSON save error: {e}")


# ── Pydantic models ──────────────────────────────────────────────

class MaskPoint(BaseModel):
    pass  # points are [[x,y], ...] — plain list


class MaskModel(BaseModel):
    id:        str
    name:      str
    points:    List[List[float]]   # [[x,y], ...]
    color_idx: int   = 0
    enabled:   bool  = True

    @validator('name')
    def validate_mask_name(cls, v):
        import re
        if not v or not v.strip():
            raise ValueError('Mask name is required')
        if not re.match(r'^[a-zA-Z0-9 _.\-]+$', v.strip()):
            raise ValueError('Mask name contains invalid characters. Only letters, numbers, spaces, hyphens, underscores, and dots are allowed.')
        return v.strip()


class SaveMaskRequest(BaseModel):
    mask: MaskModel


class SaveAllMasksRequest(BaseModel):
    masks: List[MaskModel]
    apply_to_recordings: bool = True


# ── Helpers ──────────────────────────────────────────────────────

def _get_masks_doc(ip: str) -> dict:
    """Returns the full mask document."""
    if _masks_col is not None:
        try:
            doc = _masks_col.find_one({"$or": [{"ip": ip}, {"ip_address": ip}]}, {"_id": 0})
            if doc: return doc
        except Exception as e:
            print(f"[MASKS] MongoDB get error: {e}")
    
    data = _load_file()
    # If JSON is just a list, adapt it
    if ip in data:
        if isinstance(data[ip], list):
            return {"masks": data[ip], "apply_to_recordings": True}
        return data[ip]
    return {"masks": [], "apply_to_recordings": True}


def _get_masks(ip: str) -> list:
    doc = _get_masks_doc(ip)
    return doc.get("masks", [])


def _set_masks(ip: str, masks: list, apply_to_recordings: bool = True):
    if _masks_col is not None:
        try:
            _masks_col.update_one(
                {"$or": [{"ip": ip}, {"ip_address": ip}]},
                {"$set": {"ip": ip, "ip_address": ip, "masks": masks, "apply_to_recordings": apply_to_recordings}},
                upsert=True,
            )
            print(f"[MASKS] ✅ Saved {len(masks)} mask(s) for {ip} → MongoDB")
            return
        except Exception as e:
            print(f"[MASKS] MongoDB set error: {e}")

    data = _load_file()
    data[ip] = {"masks": masks, "apply_to_recordings": apply_to_recordings}
    _save_file(data)
    print(f"[MASKS] ✅ Saved {len(masks)} mask(s) for {ip} → JSON")


# ── Routes ───────────────────────────────────────────────────────

@router.get("/{ip}")
def get_masks(ip: str):
    """Return all masks for a camera."""
    doc = _get_masks_doc(ip)
    masks = doc.get("masks", [])
    active_masks = [m for m in masks if not m.get("is_deleted")]
    return {
        "ip": ip, 
        "masks": active_masks, 
        "count": len(active_masks),
        "apply_to_recordings": doc.get("apply_to_recordings", True)
    }



@router.post("/{ip}")
def upsert_mask(ip: str, req: SaveMaskRequest):
    """Create or update a single mask by id."""
    doc = _get_masks_doc(ip)
    masks = doc.get("masks", [])
    apply_to = doc.get("apply_to_recordings", True)
    mask_dict = req.mask.dict()

    idx = next((i for i, m in enumerate(masks) if m.get("id") == req.mask.id), None)
    if idx is not None:
        masks[idx] = mask_dict
        action = "updated"
    else:
        masks.append(mask_dict)
        action = "created"

    _set_masks(ip, masks, apply_to)
    print(f"[MASKS] {action.capitalize()} mask '{req.mask.name}' for {ip}")
    return {"success": True, "action": action, "mask": mask_dict}


@router.put("/{ip}/all")
def replace_all_masks(ip: str, req: SaveAllMasksRequest):
    incoming_masks = [m.dict() for m in req.masks]
    incoming_ids = {m["id"] for m in incoming_masks}
    
    doc = _get_masks_doc(ip)
    existing_masks = doc.get("masks", [])
    
    final_masks = []
    
    # 1. Add all incoming masks
    final_masks.extend(incoming_masks)
    
    # 2. Add existing masks that were NOT in incoming, marked as deleted
    for em in existing_masks:
        if em.get("id") not in incoming_ids:
            em["is_deleted"] = True
            final_masks.append(em)
            
    _set_masks(ip, final_masks, req.apply_to_recordings)
    return {"success": True, "count": len(final_masks)}


@router.delete("/{ip}/{mask_id}")
def delete_mask(ip: str, mask_id: str):
    """Delete a single mask by id."""
    doc = _get_masks_doc(ip)
    masks = doc.get("masks", [])
    apply_to = doc.get("apply_to_recordings", True)
    found = False
    for m in masks:
        if m.get("id") == mask_id:
            m["is_deleted"] = True
            found = True

    if not found:
        raise HTTPException(status_code=404, detail=f"Mask {mask_id} not found for {ip}")

    _set_masks(ip, masks, apply_to)
    print(f"[MASKS] Deleted mask {mask_id} for {ip}")
    return {"success": True, "deleted": mask_id}


@router.delete("/{ip}")
def delete_all_masks(ip: str):
    """Delete all masks for a camera."""
    doc = _get_masks_doc(ip)
    masks = doc.get("masks", [])
    apply_to = doc.get("apply_to_recordings", True)
    for m in masks:
        m["is_deleted"] = True
    _set_masks(ip, masks, apply_to)
    print(f"[MASKS] Cleared all masks for {ip}")
    return {"success": True, "ip": ip}
