from fastapi import APIRouter, Depends, HTTPException, Request, Path
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import time
import os
import json

from app.core.database import db
from app.core.security import verify_token

router = APIRouter(prefix="/api", tags=["sequences"])

# Optional JSON fallback file in case Mongo is temporarily down
FALLBACK_FILE = os.path.join(
    os.path.dirname(__file__), "..", "..", "devices_data", "camera_sequences.json"
)

def _load_fallback() -> list:
    try:
        if os.path.exists(FALLBACK_FILE):
            with open(FALLBACK_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        print(f"[SEQUENCES] Fallback load error: {e}")
    return []

def _save_fallback(data: list):
    try:
        os.makedirs(os.path.dirname(FALLBACK_FILE), exist_ok=True)
        with open(FALLBACK_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[SEQUENCES] Fallback save error: {e}")

def _serialize_sequence(doc: dict) -> dict:
    return {
        "id": str(doc.get("id") or doc.get("_id")),
        "name": doc.get("name", "").strip(),
        "dwellTime": int(doc.get("dwellTime") or doc.get("dwell_time") or 10),
        "cameraIds": [str(c) for c in (doc.get("cameraIds") or doc.get("camera_ids") or [])],
        "created_at": doc.get("created_at", time.time()),
        "updated_at": doc.get("updated_at", time.time()),
    }


class SequenceCreatePayload(BaseModel):
    id: Optional[str] = None
    name: str
    dwellTime: Optional[int] = Field(default=10, alias="dwell_time")
    cameraIds: Optional[List[str]] = Field(default=[], alias="camera_ids")

    class Config:
        populate_by_name = True


class SequenceUpdatePayload(BaseModel):
    name: Optional[str] = None
    dwellTime: Optional[int] = Field(default=None, alias="dwell_time")
    cameraIds: Optional[List[str]] = Field(default=None, alias="camera_ids")

    class Config:
        populate_by_name = True


@router.get("/sequences", dependencies=[Depends(verify_token)])
async def get_sequences():
    """Retrieve all active camera sequences from DB."""
    if db is not None:
        try:
            sequences_col = db["sequences"]
            cursor = sequences_col.find({"is_deleted": {"$ne": True}}).sort("created_at", 1)
            return [_serialize_sequence(s) for s in cursor]
        except Exception as e:
            print(f"[SEQUENCES] DB fetch error: {e}")

    # Fallback to local storage file if DB is temporarily unreachable
    fallback_data = _load_fallback()
    return [_serialize_sequence(s) for s in fallback_data if not s.get("is_deleted")]


@router.post("/sequences", dependencies=[Depends(verify_token)])
async def create_sequence(payload: SequenceCreatePayload):
    """Create a new camera sequence and persist in DB."""
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Sequence name is required")

    dwell_time = max(3, payload.dwellTime if payload.dwellTime is not None else 10)
    camera_ids = [str(c) for c in (payload.cameraIds or [])]
    if not camera_ids:
        raise HTTPException(status_code=400, detail="At least one camera must be selected for the sequence")

    seq_id = payload.id or f"seq-{uuid.uuid4().hex[:8]}"
    now = time.time()

    doc = {
        "id": seq_id,
        "name": name,
        "dwellTime": dwell_time,
        "cameraIds": camera_ids,
        "created_at": now,
        "updated_at": now,
        "is_deleted": False,
    }

    if db is not None:
        try:
            sequences_col = db["sequences"]
            # Upsert by id in case ID was supplied
            sequences_col.update_one({"id": seq_id}, {"$set": doc}, upsert=True)
            return _serialize_sequence(doc)
        except Exception as e:
            print(f"[SEQUENCES] DB insert error: {e}")
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    # Fallback file
    fallback = _load_fallback()
    fallback = [s for s in fallback if s.get("id") != seq_id]
    fallback.append(doc)
    _save_fallback(fallback)
    return _serialize_sequence(doc)


@router.put("/sequences/{sequence_id}", dependencies=[Depends(verify_token)])
async def update_sequence(sequence_id: str = Path(..., max_length=255), payload: SequenceUpdatePayload = None):
    """Update an existing camera sequence."""
    if not payload:
        raise HTTPException(status_code=400, detail="Invalid payload")

    updates = {"updated_at": time.time()}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Sequence name cannot be empty")
        updates["name"] = name

    if payload.dwellTime is not None:
        updates["dwellTime"] = max(3, payload.dwellTime)

    if payload.cameraIds is not None:
        cids = [str(c) for c in payload.cameraIds]
        if not cids:
            raise HTTPException(status_code=400, detail="At least one camera must be selected")
        updates["cameraIds"] = cids

    if db is not None:
        try:
            sequences_col = db["sequences"]
            res = sequences_col.update_one(
                {"id": sequence_id, "is_deleted": {"$ne": True}},
                {"$set": updates}
            )
            if res.matched_count == 0:
                # Try finding by MongoDB _id
                from bson.objectid import ObjectId
                try:
                    res = sequences_col.update_one(
                        {"_id": ObjectId(sequence_id), "is_deleted": {"$ne": True}},
                        {"$set": updates}
                    )
                except Exception:
                    pass

            if res.matched_count == 0:
                raise HTTPException(status_code=404, detail="Sequence not found")

            doc = sequences_col.find_one({"id": sequence_id})
            return _serialize_sequence(doc)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    # Fallback
    fallback = _load_fallback()
    found = False
    for s in fallback:
        if s.get("id") == sequence_id:
            s.update(updates)
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Sequence not found")
    _save_fallback(fallback)
    return next(_serialize_sequence(s) for s in fallback if s.get("id") == sequence_id)


@router.delete("/sequences/{sequence_id}", dependencies=[Depends(verify_token)])
async def delete_sequence(sequence_id: str = Path(..., max_length=255)):
    """Soft delete a camera sequence."""
    now = time.time()
    if db is not None:
        try:
            sequences_col = db["sequences"]
            res = sequences_col.update_one(
                {"id": sequence_id},
                {"$set": {"is_deleted": True, "updated_at": now}}
            )
            if res.matched_count == 0:
                from bson.objectid import ObjectId
                try:
                    res = sequences_col.update_one(
                        {"_id": ObjectId(sequence_id)},
                        {"$set": {"is_deleted": True, "updated_at": now}}
                    )
                except Exception:
                    pass

            if res.matched_count == 0:
                raise HTTPException(status_code=404, detail="Sequence not found")

            return {"success": True, "id": sequence_id}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    # Fallback
    fallback = _load_fallback()
    found = False
    for s in fallback:
        if s.get("id") == sequence_id:
            s["is_deleted"] = True
            s["updated_at"] = now
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Sequence not found")
    _save_fallback(fallback)
    return {"success": True, "id": sequence_id}


@router.post("/sequences/bulk-sync", dependencies=[Depends(verify_token)])
async def bulk_sync_sequences(request: Request):
    """Sync multiple sequences (e.g. migrate localStorage sequences into DB)."""
    data = await request.json()
    items = data.get("sequences", [])
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="Invalid sequences array")

    synced_count = 0
    now = time.time()
    for item in items:
        name = (item.get("name") or "").strip()
        cids = [str(c) for c in (item.get("cameraIds") or item.get("camera_ids") or [])]
        if not name or not cids:
            continue

        seq_id = str(item.get("id") or f"seq-{uuid.uuid4().hex[:8]}")
        dwell_time = max(3, int(item.get("dwellTime") or item.get("dwell_time") or 10))

        doc = {
            "id": seq_id,
            "name": name,
            "dwellTime": dwell_time,
            "cameraIds": cids,
            "created_at": item.get("created_at") or now,
            "updated_at": now,
            "is_deleted": False,
        }

        if db is not None:
            db["sequences"].update_one(
                {"id": seq_id},
                {"$setOnInsert": doc},
                upsert=True
            )
            synced_count += 1

    return {"synced": synced_count}
