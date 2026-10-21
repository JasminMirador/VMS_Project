from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status, BackgroundTasks
from typing import List, Dict, Any
from app.core.security import verify_token
from app.core.database import db, cad_files_col, cad_parsed_data_col, map_scale_calibration_col, cad_layer_mappings_col
from app.schemas.cad import CADFileCreate, MapScaleCalibration, CADLayerMapping
import uuid
from datetime import datetime
import os
from minio import Minio

router = APIRouter()

# Minio setup (replace with actual app config where available)
MINIO_URL = os.environ["MINIO_ENDPOINT"]
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
minio_client = Minio(MINIO_URL, access_key=MINIO_ACCESS_KEY, secret_key=MINIO_SECRET_KEY, secure=False)
CAD_BUCKET = "cad-uploads"

# Ensure bucket exists
try:
    if not minio_client.bucket_exists(CAD_BUCKET):
        minio_client.make_bucket(CAD_BUCKET)
except Exception:
    pass

# We will need the ARQ Redis pool. For simplicity in this mock, we assume it's attached to app.state
# In a real app, you'd inject the Redis pool or use ARQ's create_pool


@router.post("/{map_id}/cad-upload")
async def upload_cad_file(map_id: str, background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    try:
        file_ext = file.filename.split('.')[-1].lower()
        if file_ext not in ['dxf', 'dwg']:
            raise HTTPException(status_code=400, detail="Invalid file type. Only DXF and DWG allowed.")

        file_size = 0
        contents = await file.read()
        file_size = len(contents)
        if file_size > 70 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large. Limit is 70MB.")
        
        cad_file_id = str(uuid.uuid4())
        object_name = f"{map_id}/{cad_file_id}/original.{file_ext}"
    
        # Upload to MinIO
        import io
        try:
            minio_client.put_object(CAD_BUCKET, object_name, io.BytesIO(contents), file_size)
        except Exception as e:
            print(f"[CAD Upload] Minio upload failed: {e}")
    
        # Optional: Save locally for worker if worker is on same machine
        # But ideally worker downloads from Minio. We will write a temp file for the worker.
        import tempfile; temp_path = os.path.join(tempfile.gettempdir(), f"{cad_file_id}.{file_ext}")
        with open(temp_path, "wb") as f:
            f.write(contents)

        # Invalidate previous mappings/calibration
        map_scale_calibration_col.delete_many({"map_id": map_id})
        cad_layer_mappings_col.delete_many({"map_id": map_id})

        # Update Maps active cad
        db["map_layouts"].update_one({"map_id": map_id}, {"$set": {"source_type": "cad", "active_cad_file_id": cad_file_id}})

        # Insert CADFile doc
        doc = {
            "id": cad_file_id,
            "map_id": map_id,
            "original_filename": file.filename,
            "file_type": file_ext,
            "storage_url": f"minio://{CAD_BUCKET}/{object_name}",
            "conversion_status": "pending",
            "conversion_error": None,
            "uploaded_by": "admin",
            "created_at": datetime.utcnow()
        }
        cad_files_col.insert_one(doc)

        # Enqueue job via BackgroundTasks
        import asyncio
        from worker import process_cad_file_pass1
    
        # process_cad_file signature: async def process_cad_file(ctx, cad_file_id, file_path, map_id, file_type)
        # We pass None for ctx since we're calling it directly
        background_tasks.add_task(process_cad_file_pass1, None, cad_file_id, temp_path, map_id, file_ext)

        return {"status": "pending", "cad_file_id": cad_file_id}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f'Internal Server Error: {str(e)}')

@router.get("/{map_id}/cad-upload/{cad_file_id}")
async def get_upload_status(map_id: str, cad_file_id: str, user = {}):
    doc = cad_files_col.find_one({"id": cad_file_id, "map_id": map_id})
    if not doc:
        raise HTTPException(status_code=404, detail="File not found")
    
    res = {"status": doc.get("conversion_status"), "error": doc.get("conversion_error")}
    
    if doc.get("conversion_status") == "awaiting_layer_selection":
        parsed = cad_parsed_data_col.find_one({"cad_file_id": cad_file_id})
        if parsed and "layer_scan_result" in parsed:
            res["layer_scan_result"] = parsed["layer_scan_result"]
            
    return res

@router.get("/{map_id}/cad-data")
async def get_cad_data(map_id: str, user = {}):
    map_doc = db["map_layouts"].find_one({"map_id": map_id})
    if not map_doc or map_doc.get("source_type") != "cad":
        raise HTTPException(status_code=400, detail="Map is not using CAD")
    active_cad_id = map_doc.get("active_cad_file_id")
    if not active_cad_id:
        raise HTTPException(status_code=404, detail="No active CAD file")

    data = cad_parsed_data_col.find_one({"cad_file_id": active_cad_id})
    if not data:
        raise HTTPException(status_code=404, detail="Parsed data not ready")
        
    return {
        "units": data.get("units_detected"),
        "bounds": {
            "minX": data.get("bounds_min_x"),
            "minY": data.get("bounds_min_y"),
            "maxX": data.get("bounds_max_x"),
            "maxY": data.get("bounds_max_y"),
        },
        "layers": data.get("parsed_json")
    }

@router.post("/{map_id}/cad-calibration")
async def set_calibration(map_id: str, payload: dict, user = {}):
    # payload: {method, scale_factor, calibration_point_a, calibration_point_b, real_world_distance_m}
    payload["map_id"] = map_id
    payload["calibrated_by"] = "admin"
    payload["id"] = str(uuid.uuid4())
    payload["created_at"] = datetime.utcnow()

    map_scale_calibration_col.delete_many({"map_id": map_id}) # Upsert
    map_scale_calibration_col.insert_one(payload)
    return {"status": "ok"}

@router.get("/{map_id}/cad-calibration")
async def get_calibration(map_id: str, user = {}):
    cal = map_scale_calibration_col.find_one({"map_id": map_id}, {"_id": 0})
    return cal or {}

@router.post("/{map_id}/cad-layers")
async def set_layer_mappings(map_id: str, payload: List[dict], user = {}):
    cad_layer_mappings_col.delete_many({"map_id": map_id})
    if payload:
        for p in payload:
            p["map_id"] = map_id
            p["id"] = str(uuid.uuid4())
            p["created_at"] = datetime.utcnow()
        cad_layer_mappings_col.insert_many(payload)
    return {"status": "ok"}

@router.get("/{map_id}/cad-layers")
async def get_layer_mappings(map_id: str, user = {}):
    mappings = list(cad_layer_mappings_col.find({"map_id": map_id}, {"_id": 0}))
    return mappings

@router.post("/{map_id}/cad-layers/generate-zones")
async def generate_zones(map_id: str, user = {}):
    # 1. Delete existing cad_derived zones
    db["zones"].delete_many({"map_id": map_id, "source": "cad_derived"})

    # 2. Find layers mapped as wall_obstacle
    mappings = cad_layer_mappings_col.find({"map_id": map_id, "role": "wall_obstacle"})
    wall_layers = [m["layer_name"] for m in mappings]

    if not wall_layers:
        return {"status": "ok", "generated": 0}

    # 3. Get parsed geometry
    map_doc = db["map_layouts"].find_one({"map_id": map_id})
    active_cad_id = map_doc.get("active_cad_file_id") if map_doc else None
    data = cad_parsed_data_col.find_one({"cad_file_id": active_cad_id})
    
    if not data:
        raise HTTPException(status_code=400, detail="Parsed data not found")

    generated = 0
    layers_geom = data.get("parsed_json", {})
    for lname in wall_layers:
        layer_data = layers_geom.get(lname, {})
        for ent in layer_data.get("entities", []):
            if ent.get("type") == "polyline" and ent.get("closed"):
                points = [{"x": p[0], "y": p[1]} for p in ent.get("points", [])]
                zone_doc = {
                    "id": str(uuid.uuid4()),
                    "map_id": map_id,
                    "name": f"CAD Generated {lname}",
                    "source": "cad_derived",
                    "polygon": points,
                    "isBoomBarrier": True,  # Using it as obstacle
                    "created_at": datetime.utcnow()
                }
                db["zones"].insert_one(zone_doc)
                generated += 1

    return {"status": "ok", "generated": generated}

from pydantic import BaseModel
class CADLayerSelectRequest(BaseModel):
    cad_file_id: str
    included_layers: list

@router.post("/{map_id}/cad-layers/select")
async def select_cad_layers(map_id: str, req: CADLayerSelectRequest, background_tasks: BackgroundTasks, user: dict = Depends(verify_token)):
    doc = cad_files_col.find_one({"id": req.cad_file_id, "map_id": map_id})
    if not doc:
        raise HTTPException(status_code=404, detail="File not found")
        
    if doc.get("conversion_status") not in ["awaiting_layer_selection", "failed"]:
        raise HTTPException(status_code=400, detail="File not awaiting layer selection")

    # Temp file should exist if we are on the same machine, otherwise in a real system we'd download from Minio again.
    import tempfile
    file_ext = doc.get("file_type")
    temp_path = os.path.join(tempfile.gettempdir(), f"{req.cad_file_id}.{file_ext}")
    
    if not os.path.exists(temp_path) and not os.path.exists(temp_path.replace('.dwg', '.dxf')):
        # In a robust system, download from storage_url
        raise HTTPException(status_code=500, detail="Temporary file missing for pass 2")
        
    from worker import process_cad_file_pass2
    background_tasks.add_task(process_cad_file_pass2, None, req.cad_file_id, temp_path, map_id, file_ext, req.included_layers)
    
    # Update status to indicate parsing is starting
    cad_files_col.update_one({"id": req.cad_file_id}, {"$set": {"conversion_status": "parsing", "conversion_error": None}})
    return {"status": "parsing", "cad_file_id": req.cad_file_id}
d