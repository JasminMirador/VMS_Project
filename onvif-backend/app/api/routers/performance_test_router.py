import json
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import HTMLResponse, PlainTextResponse
from typing import Optional, List, Dict, Any

from app.core.security import verify_token
from app.core.database import perf_runs_col, perf_stages_col, perf_samples_col, perf_events_col
from app.schemas.performance_test_schema import CreateRunRequest, StopRunRequest
from app.services.performance_test.test_controller import test_controller
from app.services.performance_test.load_generator import load_generator
from app.services.performance_test.hardware_collector import hardware_collector
from app.services.performance_test.report_generator import report_generator

router = APIRouter(prefix="/api/performance-test", tags=["performance_test"])

@router.get("/system-topology")
def get_system_topology(user_data: dict = Depends(verify_token)):
    """Returns detected server processor, RAM, GPU, storage and physical camera stream profile."""
    topo = hardware_collector.get_system_topology()
    topo["detected_camera_profile"] = load_generator.get_detected_camera_profile()
    return {
        "success": True,
        "topology": topo
    }

@router.get("/status")
def get_controller_status(user_data: dict = Depends(verify_token)):
    """Returns current controller state and active run identifier."""
    active_id = test_controller.active_run_id
    active_doc = None
    if active_id and perf_runs_col is not None:
        active_doc = perf_runs_col.find_one({"run_id": active_id}, {"_id": 0})
    return {
        "is_running": active_id is not None,
        "active_run_id": active_id,
        "run": active_doc
    }

@router.post("/run", status_code=status.HTTP_201_CREATED)
def create_test_run(req: CreateRunRequest, user_data: dict = Depends(verify_token)):
    """Creates a new test run record with custom configuration."""
    operator = user_data.get("sub", "admin")
    try:
        run_doc = test_controller.create_run(
            name=req.name,
            config=req.dict(),
            operator=operator
        )
        # Exclude MongoDB _id for JSON serialization
        run_doc.pop("_id", None)
        return {"success": True, "run": run_doc}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create run: {str(e)}")

@router.post("/run/{run_id}/start")
def start_test_run(run_id: str, user_data: dict = Depends(verify_token)):
    """Starts execution of a test run."""
    try:
        res = test_controller.start_run(run_id)
        return {"success": True, **res}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed starting test: {str(e)}")

@router.post("/run/{run_id}/stop")
def stop_test_run(run_id: str, req: Optional[StopRunRequest] = None, user_data: dict = Depends(verify_token)):
    """Immediately stops test run and cleans up resources."""
    reason = req.reason if req else "Operator requested stop"
    try:
        res = test_controller.stop_run(run_id, reason=reason)
        return {"success": True, **res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error stopping run: {str(e)}")

@router.get("/runs")
def list_test_runs(
    limit: int = Query(default=20, ge=1, le=100),
    user_data: dict = Depends(verify_token)
):
    """Lists past test runs with status and executive conclusions."""
    if perf_runs_col is None:
        return {"runs": [], "total": 0}
    
    total = perf_runs_col.count_documents({})
    cursor = perf_runs_col.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    runs = list(cursor)
    return {"runs": runs, "total": total}

@router.get("/run/{run_id}")
def get_test_run(run_id: str, user_data: dict = Depends(verify_token)):
    """Retrieves full specification, state, and baseline metrics for a single run."""
    if perf_runs_col is None:
        raise HTTPException(status_code=503, detail="Database offline")
    
    doc = perf_runs_col.find_one({"run_id": run_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Run not found")
    return doc

@router.get("/run/{run_id}/live")
def get_live_metrics(run_id: str, user_data: dict = Depends(verify_token)):
    """
    Returns real-time 1-second metric snapshot.
    If run is active, serves immediately from memory buffer without database overhead.
    """
    def sanitize(obj):
        if isinstance(obj, dict):
            return {k: sanitize(v) for k, v in obj.items() if k != "_id"}
        elif isinstance(obj, list):
            return [sanitize(v) for v in obj]
        elif type(obj).__name__ == "ObjectId":
            return str(obj)
        return obj

    # 1. Check if this is the active run
    if test_controller.active_run_id == run_id and test_controller.current_live_sample:
        return sanitize({
            "is_active": True,
            "sample": test_controller.current_live_sample,
            "recent_buffer": list(test_controller.live_buffer)
        })

    # 2. Fallback to latest sample in MongoDB
    if perf_samples_col is not None:
        latest = perf_samples_col.find_one({"run_id": run_id}, {"_id": 0}, sort=[("timestamp", -1)])
        return sanitize({
            "is_active": False,
            "sample": latest,
            "recent_buffer": []
        })

    return {"is_active": False, "sample": None, "recent_buffer": []}

@router.get("/run/{run_id}/stages")
def get_run_stages(run_id: str, user_data: dict = Depends(verify_token)):
    """Retrieves summaries and comparison records for each camera stage."""
    if perf_stages_col is None:
        return {"stages": []}
    stages = list(perf_stages_col.find({"run_id": run_id}, {"_id": 0}).sort("stage_index", 1))
    return {"stages": stages}

@router.get("/run/{run_id}/samples")
def get_run_samples(
    run_id: str,
    stage_index: Optional[int] = Query(default=None),
    downsample: int = Query(default=1, ge=1, le=60),
    user_data: dict = Depends(verify_token)
):
    """
    Retrieves historical time-series samples for charting.
    Supports downsample factor (e.g. downsample=5 takes every 5th sample).
    """
    if perf_samples_col is None:
        return {"samples": []}

    query = {"run_id": run_id}
    if stage_index is not None:
        query["stage_index"] = stage_index

    cursor = perf_samples_col.find(query, {"_id": 0}).sort("timestamp", 1)
    
    samples = []
    idx = 0
    for doc in cursor:
        if idx % downsample == 0:
            samples.append(doc)
        idx += 1

    return {"samples": samples, "total_returned": len(samples)}

@router.get("/run/{run_id}/events")
def get_run_events(run_id: str, user_data: dict = Depends(verify_token)):
    """Retrieves events and warnings for the run."""
    if perf_events_col is None:
        return {"events": []}
    events = list(perf_events_col.find({"run_id": run_id}, {"_id": 0}).sort("timestamp", -1).limit(200))
    return {"events": events}

@router.get("/run/{run_id}/spikes")
def get_run_spikes(run_id: str, user_data: dict = Depends(verify_token)):
    """Retrieves detected CPU spikes, subsystem attribution, and technical root-cause explanations."""
    doc = perf_runs_col.find_one({"run_id": run_id}, {"_id": 0}) if perf_runs_col is not None else None
    if doc and doc.get("summary", {}).get("spike_analysis"):
        return {"success": True, "analysis": doc["summary"]["spike_analysis"]}
    
    # Calculate dynamically from telemetry samples
    analysis = test_controller.analyze_cpu_spikes(run_id)
    return {"success": True, "analysis": analysis}

@router.get("/run/{run_id}/export/csv")
def export_csv(run_id: str, user_data: dict = Depends(verify_token)):
    """Exports raw metric samples as CSV."""
    csv_data = report_generator.generate_csv_samples(run_id)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=perf_run_{run_id}_samples.csv"}
    )

@router.get("/run/{run_id}/export/html")
def export_html(run_id: str, user_data: dict = Depends(verify_token)):
    """Returns downloadable or viewable HTML report."""
    html_data = report_generator.generate_html_report(run_id)
    return HTMLResponse(content=html_data)
