from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from app.services.license_manager import license_manager
import json
from datetime import datetime
from app.core.database import cameras_col, recordings_col, analytics_col, db as _db
from app.core.security import verify_token, require_admin
from app.core.validation import validate_ip_only, validate_rtsp_url
from app.managers.stream_manager import normalize_stream_name, get_devices_by_ip, devices, save_devices
from app.services.camera.onvif_service import (
    probe_camera,
    set_imaging_setting,
    ptz_go_to_preset,
    ptz_set_preset,
    ptz_go_home,
    trigger_relay,
    move_camera_ptz,
    get_video_encoder_options,
    set_video_encoder_setting
)
from app.services.camera.mediamtx_service import (
    register_stream,
    remove_stream,
    stream_exists
)
from recorder import rtsp_recorder as recorder
from app.schemas.camera import (
    StreamRegisterRequest,
    StreamAssignRequest,
    ProbeRequest,
    ImagingSettingRequest,
    PTZPresetRequest,
    PTZSavePresetRequest,
    PTZMoveRequest,
    RelayRequest,
    CameraCredentials,
    VideoEncoderSettingRequest
)


import hashlib
import time
from app.services.camera.codec_detector import detect_codec_async
from app.services.camera.rtsp_utils import infer_camera_info_from_rtsp
import asyncio
import re
import os
import urllib.parse
from datetime import datetime
from app.services.redis_stream_publisher import publish_event as _redis_publish

_CAM_STREAM = lambda: os.environ.get("REDIS_STREAM_CAMERA_EVENTS", "vms:events:camera")
import requests as http_requests

from app.core.lifecycle import _analytics_tasks
from app.managers.health_manager import analytics_poll_loop as _analytics_poll_loop
from app.core.database import analytics_col, analytics_subs_col
from app.managers.stream_manager import load_devices, save_camera_to_db, _watchdog_failures

OME_HOST_IP = os.environ.get("HOST_IP", "127.0.0.1")

router = APIRouter(prefix="/api", tags=["cameras"])
features_router = APIRouter(prefix="/api/camera", tags=["camera-features"], dependencies=[Depends(verify_token)])

@router.get("/cameras", dependencies=[Depends(verify_token)])
async def get_all_cameras():
    cameras = load_devices()
    
    # ── Redis Stream: camera.list_requested ───────────────────────────────────
    formatted_cameras = [
        {
            "ip_address": c.get("ip_address") or c.get("ip"),
            "enabled": c.get("enabled", True),
            "device_name": c.get("name") or c.get("device_name") or f"Camera @ {c.get('ip_address') or c.get('ip')}",
            "password": c.get("password", ""),
            "username": c.get("username", ""),
            "rtsp_url": c.get("rtsp_url", ""),
            "manufacturer": c.get("manufacturer", ""),
            "model": c.get("model", "")
        } for c in cameras
    ]
    
    asyncio.create_task(_redis_publish(
        _CAM_STREAM(), "camera.list_requested",
        {"count": len(formatted_cameras), "cameras": formatted_cameras}
    ))
    
    return cameras

@router.post("/cameras/by-ip/{ip}/enable", dependencies=[Depends(require_admin)])
async def enable_camera_by_ip(ip: str):
    global devices
    matched = get_devices_by_ip(ip)
    if not matched:
        raise HTTPException(status_code=404, detail=f"No camera found with IP {ip}")
    
    to_enable_count = sum(1 for d in matched if not d.get("enabled", False))
    if to_enable_count > 0:
        max_cameras = license_manager.get_max_cameras()
        active_count = cameras_col.count_documents({"enabled": True, "is_deleted": {"$ne": True}}) if cameras_col is not None else len([d for d in devices if d.get("enabled") is True])
        if active_count + to_enable_count > max_cameras:
            return JSONResponse(
                status_code=409,
                content={
                    "success": False,
                    "message": "Camera license limit reached.",
                    "licensed": max_cameras,
                    "current": active_count
                }
            )

    started = []
    for device in matched:
        stream_name = device.get("stream_key")
        rtsp_url    = device.get("rtsp_url")
        sub_stream_rtsp = device.get("sub_stream_rtsp")
        if not stream_name or not rtsp_url:
            continue
        device["enabled"] = True
        try:
            register_stream(stream_name, rtsp_url, sub_stream_rtsp=sub_stream_rtsp)
        except Exception as e:
            print(f"[ENABLE] OME re-register failed for {stream_name}: {e}")
        started.append(stream_name)
        print(f"[ENABLE] ✅ {stream_name} enabled. Recording will be started by the assigned worker process.")
    save_devices(devices)
    if cameras_col is not None:
        cameras_col.update_many({"$or": [{"ip": ip}, {"ip_address": ip}]}, {"$set": {"enabled": True}})
    if cameras_col is not None:
        updated_doc = cameras_col.find_one({"$or": [{"ip": ip}, {"ip_address": ip}]}) or {}
    else:
        updated_doc = matched[0] if matched else {}

    # ── Redis Stream: camera.updated ──────────────────────────────────────────
    asyncio.create_task(_redis_publish(
        _CAM_STREAM(), "camera.updated",
        {
            "ip_address":     updated_doc.get("ip_address") or updated_doc.get("ip") or ip,
            "enabled":        updated_doc.get("enabled", True),
            "device_name":    updated_doc.get("name") or updated_doc.get("device_name"),
            "password":       updated_doc.get("password", ""),
            "username":       updated_doc.get("username", ""),
            "rtsp_url":       updated_doc.get("rtsp_url", ""),
            "updated_fields": ["enabled"],
        },
    ))
    return {"success": True, "ip": ip, "streams_started": started}


@router.post("/cameras/by-ip/{ip}/disable", dependencies=[Depends(require_admin)])
async def disable_camera_by_ip(ip: str):
    global devices
    matched = get_devices_by_ip(ip)
    if not matched:
        raise HTTPException(status_code=404, detail=f"No camera found with IP {ip}")
    stopped = []
    for device in matched:
        stream_name = device.get("stream_key")
        if not stream_name:
            continue
        device["enabled"] = False
        stopped.append(stream_name)
        try:
            remove_stream(stream_name)
            print(f"[DISABLE] MediaMTX unregister {stream_name}")
        except Exception as e:
            print(f"[DISABLE] MediaMTX unregister failed for {stream_name} (non-fatal): {e}")
        print(f"[DISABLE] ⏹ {stream_name} disabled. Recording will be stopped by the assigned worker process.")
    save_devices(devices)
    if cameras_col is not None:
        cameras_col.update_many({"$or": [{"ip": ip}, {"ip_address": ip}]}, {"$set": {"enabled": False}})
    if cameras_col is not None:
        updated_doc = cameras_col.find_one({"$or": [{"ip": ip}, {"ip_address": ip}]}) or {}
    else:
        updated_doc = matched[0] if matched else {}

    # ── Redis Stream: camera.updated ──────────────────────────────────────────
    asyncio.create_task(_redis_publish(
        _CAM_STREAM(), "camera.updated",
        {
            "ip_address":     updated_doc.get("ip_address") or updated_doc.get("ip") or ip,
            "enabled":        updated_doc.get("enabled", False),
            "device_name":    updated_doc.get("name") or updated_doc.get("device_name"),
            "password":       updated_doc.get("password", ""),
            "username":       updated_doc.get("username", ""),
            "rtsp_url":       updated_doc.get("rtsp_url", ""),
            "updated_fields": ["enabled"],
        },
    ))
    return {"success": True, "ip": ip, "streams_stopped": stopped}


@router.delete("/cameras/by-ip/{ip}/delete", dependencies=[Depends(require_admin)])
async def delete_camera_by_ip(ip: str):
    global devices
    matched = get_devices_by_ip(ip)
    stopped = []
    for device in matched:
        stream_name = device.get("stream_key")
        if not stream_name:
            continue
        recorder.stop_camera(stream_name)

        # ── BUG FIX: Do NOT call recorder.stop_camera() from the API process ──
        # The API process has its own separate in-process recorder dict (not the workers').
        # Calling stop_camera() here was creating stale folder paths in the default shard dir.
        # The assigned worker detects on its next 3-second DB poll that this camera is gone
        # from its assigned list and stops recording cleanly on its own.
        stopped.append(stream_name)
        print(f"[DELETE] ⏹ Stopped recorder for {stream_name}")

        try:
            remove_stream(stream_name)
            print(f"[DELETE] MediaMTX unregister {stream_name}")
        except Exception as e:
            print(f"[DELETE] OME unregister failed for {stream_name} (non-fatal): {e}")
        _watchdog_failures.pop(stream_name, None)
    devices = [d for d in devices if d.get("ip") != ip and d.get("ip_address") != ip]
    save_devices(devices)
    if cameras_col is not None:
        now = datetime.utcnow()
        update_doc = {
            "$set": {
                "is_deleted": True,
                "deleted_at": now
            }
        }
        result = cameras_col.update_many({"$or": [{"ip": ip}, {"ip_address": ip}]}, update_doc)
        print(f"[DELETE] 🗑 MongoDB: soft-deleted {result.modified_count} camera(s) for IP {ip}")
        
        if recordings_col is not None:
            rec_res = recordings_col.update_many({"camera_ip": ip}, update_doc)
            print(f"[DELETE] Cascade: soft-deleted {rec_res.modified_count} recordings for IP {ip}")
        if analytics_col is not None:
            al_res = analytics_col.update_many({"ip": ip}, update_doc)
            print(f"[DELETE] Cascade: soft-deleted {al_res.modified_count} alerts for IP {ip}")

    rtsp_url = matched[0].get("rtsp_url", "") if matched else ""
    # ── Redis Stream: camera.deleted ──────────────────────────────────────────
    asyncio.create_task(_redis_publish(
        _CAM_STREAM(), "camera.deleted",
        {
            "ip_address": ip,
            "rtsp_url": rtsp_url
        },
    ))
    return {"success": True, "ip": ip, "streams_stopped": stopped}
@router.delete("/cameras/delete-by-rtsp", dependencies=[Depends(require_admin)])
async def delete_camera_by_rtsp(request: Request):
    global devices
    data = await request.json()
    rtsp_url = (data.get("rtsp_url") or "").strip()
    if not rtsp_url:
        raise HTTPException(status_code=400, detail="rtsp_url is required")

    matched = [d for d in devices if d.get("rtsp_url") == rtsp_url]
    if not matched and cameras_col is not None:
        db_doc = cameras_col.find_one({"rtsp_url": rtsp_url, "is_deleted": {"$ne": True}})
        if db_doc:
            matched = [db_doc]

    if not matched:
        raise HTTPException(status_code=404, detail=f"No camera found with rtsp_url: {rtsp_url}")

    ip = matched[0].get("ip") or matched[0].get("ip_address") or ""
    stopped = []
    for device in matched:
        stream_name = device.get("stream_key")
        if not stream_name:
            continue
        recorder.stop_camera(stream_name)
        stopped.append(stream_name)
        print(f"[DELETE-RTSP] ⏹ Stopped recorder for {stream_name}")
        try:
            remove_stream(stream_name)
            print(f"[DELETE-RTSP] MediaMTX unregister {stream_name}")
        except Exception as e:
            print(f"[DELETE-RTSP] OME unregister failed for {stream_name} (non-fatal): {e}")
        _watchdog_failures.pop(stream_name, None)

    devices = [d for d in devices if d.get("rtsp_url") != rtsp_url]
    save_devices(devices)

    if cameras_col is not None:
        now = datetime.utcnow()
        update_doc = {
            "$set": {
                "is_deleted": True,
                "deleted_at": now
            }
        }
        result = cameras_col.update_many({"rtsp_url": rtsp_url}, update_doc)
        print(f"[DELETE-RTSP] 🗑 MongoDB: soft-deleted {result.modified_count} camera(s) for rtsp_url {rtsp_url}")

        if ip and recordings_col is not None:
            rec_res = recordings_col.update_many({"camera_ip": ip}, update_doc)
            print(f"[DELETE-RTSP] Cascade: soft-deleted {rec_res.modified_count} recordings for IP {ip}")
        if ip and analytics_col is not None:
            al_res = analytics_col.update_many({"ip": ip}, update_doc)
            print(f"[DELETE-RTSP] Cascade: soft-deleted {al_res.modified_count} alerts for IP {ip}")

    # ── Redis Stream: camera.deleted ──────────────────────────────────────────
    asyncio.create_task(_redis_publish(
        _CAM_STREAM(), "camera.deleted",
        {
            "ip_address": ip,
            "rtsp_url": rtsp_url
        },
    ))
    return {"success": True, "rtsp_url": rtsp_url, "ip": ip, "streams_stopped": stopped}
@router.delete("/cameras/{ip}/hard", dependencies=[Depends(require_admin)])
async def hard_delete_camera(ip: str):
    """
    Permanently delete a cameras collection.
    """
    if cameras_col is not None:
        result = cameras_col.update_many({"$or": [{"ip": ip}, {"ip_address": ip}]}, {"$set": {"is_deleted": True}})
        # if recordings_col is not None:
        #     recordings_col.delete_many({"camera_ip": ip})
        # if analytics_col is not None:
        #     analytics_col.update_many({"ip": ip}, {"$set": {"is_deleted": True}})
        return {"success": True, "ip": ip, "deleted_count": result.modified_count}
    return {"success": False, "error": "Database not available"}

@router.get("/cameras/trash", dependencies=[Depends(verify_token)])
async def get_trashed_cameras():
    """
    Get all soft-deleted cameras for the recycle bin.
    """
    if cameras_col is None:
        return []
    docs = list(cameras_col.find({"is_deleted": True}, {"_id": 0}))
    return docs

@router.put("/cameras/{ip}/restore", dependencies=[Depends(require_admin)])
async def restore_camera(ip: str):
    """
    Restore a soft-deleted camera and its children.
    """
    if cameras_col is not None:
        update_doc = {
            "$set": {"is_deleted": False},
            "$unset": {"deleted_at": "", "deleted_by": ""}
        }
        result = cameras_col.update_many({"$or": [{"ip": ip}, {"ip_address": ip}]}, update_doc)
        
        if recordings_col is not None:
            recordings_col.update_many({"camera_ip": ip}, update_doc)
        if analytics_col is not None:
            analytics_col.update_many({"ip": ip}, update_doc)
            
        return {"success": True, "ip": ip, "restored_count": result.modified_count}
    return {"success": False, "error": "Database not available"}

@router.delete("/cameras/by-stream/{stream_name}/delete", dependencies=[Depends(require_admin)])
async def delete_camera_by_stream(stream_name: str):
    """
    Delete a camera entry by its stream_key name.
    Removes ghost/stale entries that exist in MongoDB but were never properly cleaned up.
    The frontend (AddDevicesPage.jsx) already calls this endpoint on Remove.
    """
    global devices
    stopped = []
    recorder.stop_camera(stream_name)
    stopped.append(stream_name)
    try:
        remove_stream(stream_name)
        print(f"[DELETE-STREAM] MediaMTX unregister {stream_name}")
    except Exception as e:
        print(f"[DELETE-STREAM] OME unregister failed for {stream_name} (non-fatal): {e}")
    _watchdog_failures.pop(stream_name, None)
    devices = [d for d in devices if d.get("stream_key") != stream_name]
    save_devices(devices)
    if cameras_col is not None:
        result = cameras_col.update_many({"stream_key": stream_name}, {"$set": {"is_deleted": True}})
        print(f"[DELETE-STREAM] 🗑 MongoDB: marked {result.modified_count} doc(s) as deleted for stream '{stream_name}'")
    return {"success": True, "stream_name": stream_name, "streams_stopped": stopped}


@router.put("/cameras/by-ip/{ip}", dependencies=[Depends(require_admin)])
async def update_camera_by_ip(ip: str, request: Request):
    import re as _re
    _NAME_RE = _re.compile(r"^[a-zA-Z0-9 _.\-]+$")
    validate_ip_only(ip)
    data = await request.json()
    if "rtsp_url" in data:
        validate_rtsp_url(data["rtsp_url"])
    # Validate name fields
    for _field in ("name", "device_name", "manufacturer", "model", "group_id"):
        if _field in data and data[_field]:
            if not _NAME_RE.match(str(data[_field]).strip()):
                raise HTTPException(status_code=400, detail=f"'{_field}' contains invalid characters. Only letters, numbers, spaces, hyphens, underscores, and dots are allowed.")
    actual_updated_fields = []
    
    if cameras_col is not None:
        allowed_keys = {"name", "device_name", "mac", "manufacturer", "model", "rtsp_url", "group_id", "thumbnail"}
        update_data = {k: v for k, v in data.items() if k in allowed_keys}
        if update_data:
            existing_doc = cameras_col.find_one({"$or": [{"ip": ip}, {"ip_address": ip}]}) or {}
            for k, v in update_data.items():
                if existing_doc.get(k) != v:
                    actual_updated_fields.append(k)
                    
            cameras_col.update_many({"$or": [{"ip": ip}, {"ip_address": ip}]}, {"$set": update_data})
            print(f"[UPDATE] ✏️ MongoDB: updated document(s) for IP {ip}")
    else:
        actual_updated_fields = list(data.keys())

    global devices
    updated_device = None
    for d in devices:
        if d.get("ip") == ip or d.get("ip_address") == ip:
            for k, v in data.items():
                d[k] = v
            updated_device = d
    save_devices(devices)
    
    if cameras_col is not None:
        updated_doc = cameras_col.find_one({"$or": [{"ip": ip}, {"ip_address": ip}]})
    else:
        updated_doc = updated_device or {}

    # ── Redis Stream: camera.updated ──────────────────────────────────────────
    asyncio.create_task(_redis_publish(
        _CAM_STREAM(), "camera.updated",
        {
            "ip_address":     updated_doc.get("ip_address") or updated_doc.get("ip") or ip,
            "enabled":        updated_doc.get("enabled", True),
            "device_name":    updated_doc.get("name") or updated_doc.get("device_name"),
            "password":       updated_doc.get("password", ""),
            "username":       updated_doc.get("username", ""),
            "rtsp_url":       updated_doc.get("rtsp_url", ""),
            "updated_fields": actual_updated_fields,
        },
    ))
    return {"success": True, "ip": ip}


# ------------------------------------------------------------------
# ONVIF probe
# ------------------------------------------------------------------
@router.post("/onvif/probe", dependencies=[Depends(verify_token)])
async def onvif_probe(req: ProbeRequest):
    validate_ip_only(req.ip)
    print(f"[ONVIF] Probing {req.ip}:{req.port} ...")
 
    result = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password, req.channel
    )

    if result["success"]:
        print(f"[ONVIF] ✅ {result['manufacturer']} {result['model']} "
              f"— {result.get('stream_count', '?')} stream(s)")
        profiles_list = result.get("profiles") or result.get("all_profiles") or []
        if profiles_list and profiles_list[0].get("rtsp_url"):
            rtsp = profiles_list[0]["rtsp_url"]
        else:
            rtsp = result.get("stream_uri", "")
        rtsp = re.sub(r"[&?]proto=Onvif", "", rtsp)
        
        live_codec = "H.264"
        if profiles_list and profiles_list[0].get("supported_encodings"):
            encs = profiles_list[0]["supported_encodings"]
            if "H.265" in encs:
                live_codec = "H.265"

        parsed = urllib.parse.urlparse(rtsp)
        if req.username and not parsed.username:
            user_clean = req.username.strip()
            pass_clean = req.password.strip()
            user_enc = urllib.parse.quote(user_clean, safe='')
            pass_enc = urllib.parse.quote(pass_clean, safe='')
            host = parsed.hostname
            port = parsed.port
            if port:
                netloc = f"{user_enc}:{pass_enc}@{host}:{port}"
            else:
                netloc = f"{user_enc}:{pass_enc}@{host}"
            
            rtsp = urllib.parse.urlunparse((
                parsed.scheme,
                netloc,
                parsed.path,
                parsed.params,
                parsed.query,
                parsed.fragment            ))
 
            if "transport=" not in rtsp:
                if "?" in rtsp:
                    rtsp += "&transport=tcp"
                else:
                    rtsp += "?transport=tcp"

        print("FINAL RTSP:", rtsp)
        suffix = f"cam{req.channel}" if req.channel > 0 else None
        stream_name = normalize_stream_name(req.ip, suffix, getattr(req, "device_name", None))

        # ── Extract sub-stream RTSP from ONVIF profiles ───────────────────
        # probe_camera() already labels profiles as MAIN / SUB / EXTRA.
        # We pick the first SUB profile's rtsp_url as the low-res stream.
        # This URL is used only for MediaMTX ingest — it never changes the
        # camera's hardware configuration.
        all_profiles = result.get("all_profiles", result.get("profiles", []))
        sub_profile = next(
            (p for p in all_profiles if (p.get("label") or "").upper() == "SUB" and p.get("rtsp_url")),
            None
        )
        sub_stream_rtsp = sub_profile["rtsp_url"] if sub_profile else None

        # Inject credentials into sub-stream URL if missing (same logic as main stream)
        if sub_stream_rtsp and req.username:
            try:
                parsed_sub = urllib.parse.urlparse(sub_stream_rtsp)
                if not parsed_sub.username:
                    user_enc = urllib.parse.quote(req.username.strip(), safe='')
                    pass_enc = urllib.parse.quote(req.password.strip(), safe='')
                    sub_netloc = f"{user_enc}:{pass_enc}@{parsed_sub.hostname}"
                    if parsed_sub.port:
                        sub_netloc += f":{parsed_sub.port}"
                    sub_stream_rtsp = urllib.parse.urlunparse((
                        parsed_sub.scheme, sub_netloc, parsed_sub.path,
                        parsed_sub.params, parsed_sub.query, parsed_sub.fragment
                    ))
                    if "transport=" not in sub_stream_rtsp:
                        sub_stream_rtsp += ("&" if "?" in sub_stream_rtsp else "?") + "transport=tcp"
            except Exception:
                pass

        if sub_stream_rtsp:
            print(f"[ONVIF] Sub-stream URL found for {req.ip}: {sub_stream_rtsp}")
        else:
            print(f"[ONVIF] No sub-stream profile found for {req.ip} — grid will use main stream")

        existing    = next((d for d in devices if d.get("stream_key") == stream_name), None)

        if not existing or not stream_exists(stream_name):
            is_currently_active = existing.get("enabled", False) if existing else False
            if not is_currently_active:
                max_cameras = license_manager.get_max_cameras()
                active_count = cameras_col.count_documents({"enabled": True, "is_deleted": {"$ne": True}}) if cameras_col is not None else len([d for d in devices if d.get("enabled") is True])
                if active_count >= max_cameras:
                    return JSONResponse(
                        status_code=409,
                        content={
                            "success": False,
                            "message": "Camera license limit reached.",
                            "licensed": max_cameras,
                            "current": active_count
                        }
                    )

            if req.save_to_db:
                print(f"[ONVIF] Registering stream in OME: {stream_name}")
                detected_codec = await detect_codec_async(rtsp, stream_name)
                if detected_codec in ["hevc", "h265"]:
                    live_codec = "H.265"
                
                ome_response = register_stream(stream_name, rtsp, codec=live_codec, sub_stream_rtsp=sub_stream_rtsp)
                print("MEDIAMTX RESPONSE:", ome_response)
                print(f"[ONVIF] OME response: {ome_response}")

                sub_key = ome_response.get("sub_stream_key")
     
                live_stream = ome_response.get("transcoded_stream")
                if not existing:
                    new_device = {
                        "stream_key":       stream_name,
                        "rtsp_url":         rtsp,
                        "recording_rtsp":   rtsp,
                        "live_stream":      live_stream,
                        "sub_stream_rtsp":  sub_stream_rtsp,
                        "sub_stream_key":   sub_key,
                        "ip":               req.ip,
                        "port":             req.port,
                        "username":         req.username,
                        "password":         req.password,
                        "active_rec_profile": "MAIN_STREAM",
                        "recording_profile":  "MAIN_STREAM",
                        "enabled":          True,
                        "live_codec":       live_codec,
                        "codec":            detected_codec,
                    }
                    devices.append(new_device)
                    save_devices(devices)
                else:
                    existing["rtsp_url"]        = rtsp
                    existing["recording_rtsp"]  = existing.get("recording_rtsp", rtsp)
                    if live_stream:
                        existing["live_stream"] = live_stream
                    if sub_stream_rtsp:
                        existing["sub_stream_rtsp"] = sub_stream_rtsp
                        existing["sub_stream_key"]  = sub_key
                    existing["port"]            = req.port
                    existing["username"]        = req.username
                    existing["password"]        = req.password
                    existing["live_codec"]      = live_codec
                    existing["codec"]           = detected_codec
                    save_devices(devices)
     
                save_camera_to_db({
                    "ip":               req.ip,
                    "stream_key":       stream_name,
                    "rtsp_url":         rtsp,
                    "recording_rtsp":   rtsp,
                    "sub_stream_rtsp":  sub_stream_rtsp,
                    "sub_stream_key":   sub_key,
                    "manufacturer":     result.get("manufacturer", ""),
                    "model":            result.get("model", ""),
                    "mac":              result.get("mac", ""),
                    "port":             req.port,
                    "username":         req.username,
                    "password":         req.password,
                    "added_at":         datetime.utcnow(),
                    "status":           "streaming",
                    "enabled":          True,
                    "live_stream":      ome_response.get("transcoded_stream"),
                    "stream_count":     result.get("stream_count", 0),
                    "stream_profiles":  result.get("all_profiles", result.get("profiles", [])),
                    "active_rec_profile": "MAIN_STREAM",
                    "recording_profile":  "MAIN_STREAM",
                    "api_profile":      result.get("api_profile"),
                    "group_id":         req.group_id,
                    "device_name":      req.device_name,
                    "live_codec":       live_codec,
                    "codec":            detected_codec,
                })
                print(f"[ONVIF] 🎥 Recording will be started by the assigned worker process for {stream_name}")
     
                # ── Redis Stream: camera.added ────────────────────────────────────────────
                asyncio.create_task(_redis_publish(
                    _CAM_STREAM(), "camera.added",
                    {
                        "ip_address":   req.ip,
                        "enabled":      True,
                        "device_name":  req.device_name or f"Camera @ {req.ip}",
                        "password":     req.password,
                        "username":     req.username,
                        "rtsp_url":     rtsp,
                    },
                ))
            else:
                print(f"[ONVIF] Probing only. Not saving to DB or registering stream.")
                ome_response = {"status": "skipped", "message": "Probing only"}
                live_stream = None
                sub_key = None

        else:
            print(f"[ONVIF] Stream {stream_name} already live in MediaMTX, skipping.")
            ome_response = {"status": "ok", "message": "Already registered"}
            live_stream = existing.get("live_stream") if existing else None
            sub_key = existing.get("sub_stream_key") if existing else None
 
        result["stream_key"]      = stream_name
        result["ome_response"]    = ome_response
        live_key = live_stream if live_stream else stream_name
        result["ws_url"]          = f"http://localhost:8889/{live_key}"
        result["stream_key"]      = live_key
        result["status"]          = "streaming"
        result["rtsp_url"]        = rtsp
        result["sub_stream_key"]  = sub_key
        result["sub_stream_rtsp"] = sub_stream_rtsp
 
    else:
        print(f"[ONVIF] ❌ {result['error']}")
 
    return result


# ------------------------------------------------------------------
# RTSP stream register
# ------------------------------------------------------------------
@router.post("/streams/register", dependencies=[Depends(verify_token)])
@router.post("/streams/register-direct", dependencies=[Depends(verify_token)])
async def register_rtsp_stream(req: StreamRegisterRequest):
    validate_rtsp_url(req.rtsp_url)
    if req.ip:
        validate_ip_only(req.ip)
 
    rtsp = req.rtsp_url.strip()
    print(f"[RTSP] Registering stream: {rtsp}")

    if req.ip:
        host = req.ip
    else:
        try:
            from urllib.parse import urlparse
            parsed = urlparse(rtsp)
            host = parsed.hostname or "unknown"
        except Exception:
            host = "unknown"

    # Derive the stream name purely from the host IP, not the RTSP URL —
    # cloud/NVR-hosted cameras like this one issue a fresh, single-use
    # token in the RTSP path on every fetch, so hashing the URL would
    # mint a new stream name every time.
    base_stream_name = normalize_stream_name(host, None, getattr(req, "device_name", None))
    stream_name = base_stream_name

    if req.manufacturer == "Unknown" or not req.manufacturer:
        inferred_info = await asyncio.to_thread(infer_camera_info_from_rtsp, rtsp)
        if inferred_info.get("manufacturer") != "Unknown":
            req.manufacturer = inferred_info["manufacturer"]
            print(f"[RTSP] Inferred manufacturer: {req.manufacturer}")

    existing = next((d for d in devices if d.get("rtsp_url") == rtsp), None)


    if not existing:
            if any(d.get("stream_key") == base_stream_name for d in devices) or any(d.get("ip") == host for d in devices):
                req_device_name = getattr(req, "device_name", None)
                if req_device_name and req_device_name.strip():
                    import re
                    last_octet = host.strip().split(".")[-1]
                    safe_name = req_device_name.strip().replace(" ", "_")
                    safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '', safe_name)
                    stream_name = f"{safe_name}_{last_octet}"
                    
                    if any(d.get("stream_key") == stream_name for d in devices):
                        import uuid
                        uid = uuid.uuid4().hex[:8]
                        stream_name = f"{stream_name}_{uid}"
                else:
                    import uuid
                    uid = uuid.uuid4().hex[:8]
                    stream_name = f"{base_stream_name}_{uid}"
                    print(f"[RTSP] Stream name {base_stream_name} already exists. Using new stream_name: {stream_name}")
            else:
                stream_name = base_stream_name
    else:
        stream_name = existing.get("stream_key", base_stream_name)

    if existing and stream_exists(stream_name):
        print(f"[RTSP] Stream {stream_name} already live in OME, skipping.")
        existing["rtsp_url"] = rtsp
        save_devices(devices)
        save_camera_to_db({
            "ip":             host,
            "stream_key":     stream_name,
            "rtsp_url":       rtsp,
            "recording_rtsp": existing.get("recording_rtsp", rtsp),
            "manufacturer":   req.manufacturer,
            "model":          req.model,
            "mac":            req.mac,
            "device_name":    req.device_name or existing.get("device_name") or f"Camera @ {host}",
            "port":           req.port,
            "username":       req.username,
            "password":       req.password,
            "added_at":       datetime.utcnow(),
            "status":         "streaming",
            "live_stream":    existing.get("live_stream") or stream_name,
            "active_rec_profile": "MAIN_STREAM",
            "recording_profile":  "MAIN_STREAM",
            "enabled":        True,
            "source":         "rtsp",
            "group_id":       req.group_id,
            "live_codec":     req.live_codec or existing.get("live_codec", "H.264"),
            "codec":          existing.get("codec", "unknown"),
        })
        live_key = existing.get("live_stream") or stream_name
        return {
            "success":    True,
            "stream_key": stream_name,
            "ws_url":     f"http://localhost:8889/{live_key}",
            "stream_key": live_key,
            "status":     "streaming",
            "rtsp_url":   rtsp,
        }
    is_currently_active = existing.get("enabled", False) if existing else False
    if not is_currently_active:
        max_cameras = license_manager.get_max_cameras()
        active_count = cameras_col.count_documents({"enabled": True, "is_deleted": {"$ne": True}}) if cameras_col is not None else len([d for d in devices if d.get("enabled") is True])
        if active_count >= max_cameras:
            return JSONResponse(
                status_code=409,
                content={
                    "success": False,
                    "message": "Camera license limit reached.",
                    "licensed": max_cameras,
                    "current": active_count
                }
            )

    try:
        detected_codec = await detect_codec_async(rtsp, stream_name)
        live_codec = req.live_codec
        if detected_codec in ["hevc", "h265"]:
            live_codec = "H.265"
            
        ome_response = register_stream(stream_name, rtsp, codec=live_codec)
        print(f"[RTSP] OME response: {ome_response}")
    except Exception as e:
        print(f"[RTSP] ❌ OME registration failed: {e}")
        return {"success": False, "error": str(e)}
 
    if ome_response.get("status") != "ok":
        return {
            "success": False,
            "error": ome_response.get("message", "MediaMTX registration failed"),
            "ws_url": None,
        }
 
    if not existing:
        new_device = {
            "stream_key":     stream_name,
            "rtsp_url":       rtsp,
            "recording_rtsp": rtsp,
            "live_stream":    ome_response.get("transcoded_stream"),
            "ip":             host,
            "port":           req.port,
            "username":       req.username,
            "password":       req.password,
            "active_rec_profile": "MAIN_STREAM",
            "recording_profile":  "MAIN_STREAM",
            "enabled":        True,
            "live_codec":     live_codec,
            "codec":          detected_codec,
        }
        devices.append(new_device)
    else:
        existing["rtsp_url"]       = rtsp
        existing["recording_rtsp"] = existing.get("recording_rtsp", rtsp)
        if ome_response.get("transcoded_stream"):
            existing["live_stream"] = ome_response.get("transcoded_stream")
        existing["port"]           = req.port
        existing["username"]       = req.username
        existing["password"]       = req.password
        existing["live_codec"]     = live_codec
        existing["codec"]          = detected_codec
        new_device = existing
    save_devices(devices)
 
    save_camera_to_db({
        "ip":             host,
        "stream_key":     stream_name,
        "rtsp_url":       rtsp,
        "recording_rtsp": rtsp,
        "manufacturer":   req.manufacturer,
        "model":          req.model,
        "mac":            req.mac,
        "device_name":    req.device_name or f"Camera @ {host}",
        "port":           req.port,
        "username":       req.username,
        "password":       req.password,
        "added_at":       datetime.utcnow(),
        "status":         "streaming",
        "live_stream":    ome_response.get("transcoded_stream"),
        "active_rec_profile": "MAIN_STREAM",
        "recording_profile":  "MAIN_STREAM",
        "enabled":        True,
        "source":         "rtsp",
        "group_id":       req.group_id,
        "live_codec":     live_codec,
        "codec":          detected_codec,
    })
 
 
    _watchdog_failures[stream_name] = 0
    print(f"[RTSP] 🎥 Recording will be started by the assigned worker process for {stream_name}")
    # ── Redis Stream: camera.added ────────────────────────────────────────────
    asyncio.create_task(_redis_publish(
        _CAM_STREAM(), "camera.added",
        {
            "ip_address":   host,
            "enabled":      True,
            "device_name":  req.device_name or f"Camera @ {host}",
            "password":     req.password,
            "username":     req.username,
            "rtsp_url":     rtsp,
        },
    ))
    live_key = ome_response.get("transcoded_stream") or stream_name
    return {
        "success":    True,
        "stream_key": stream_name,
        "ws_url":     f"http://localhost:8889/{live_key}",
        "stream_key": live_key,
        "status":     "streaming",
        "rtsp_url":   rtsp,
    }
    


# ------------------------------------------------------------------
# Assign independent Live + Recording streams
# ------------------------------------------------------------------
@router.post("/streams/assign", dependencies=[Depends(verify_token)])
async def assign_streams(req: StreamAssignRequest):
    validate_ip_only(req.ip)
    if req.live_rtsp:
        validate_rtsp_url(req.live_rtsp)
    if req.recording_rtsp:
        validate_rtsp_url(req.recording_rtsp)
    import time

    host        = req.ip.strip()
    base_stream_name = normalize_stream_name(host, None, getattr(req, "device_name", None)) 
 

    print(f"[ASSIGN] {host}: live={req.live_profile!r}  rec={req.recording_profile!r}")
    print(f"[ASSIGN] live_rtsp={req.live_rtsp!r}")
    print(f"[ASSIGN] rec_rtsp={req.recording_rtsp!r}")

    existing = next(
        (d for d in devices if d.get("ip") == host and (d.get("rtsp_url") == req.live_rtsp or d.get("recording_rtsp") == req.recording_rtsp)),
        next((d for d in devices if d.get("ip") == host), None)
    )
        # --- INJECT CREDENTIALS INTO RAW ONVIF RTSP URLs ---
    import urllib.parse
    cam_user = req.username or (existing.get("username") if existing else "")
    cam_pass = existing.get("password") if existing else ""

    def inject_credentials(rtsp_str, user, pwd):
        if not rtsp_str or not user or not pwd: return rtsp_str
        if f"{urllib.parse.quote_plus(user)}:" in rtsp_str or f"{user}:" in rtsp_str:
            return rtsp_str
        if rtsp_str.startswith("rtsp://"):
            parts = rtsp_str.split("rtsp://", 1)
            safe_user = urllib.parse.quote_plus(user)
            safe_pwd = urllib.parse.quote_plus(pwd)
            return f"rtsp://{safe_user}:{safe_pwd}@{parts[1]}"
        return rtsp_str

    req.live_rtsp = inject_credentials(req.live_rtsp, cam_user, cam_pass)
    req.recording_rtsp = inject_credentials(req.recording_rtsp, cam_user, cam_pass)
    
    print(f"[ASSIGN] After credential injection: live_rtsp={req.live_rtsp!r}")
    print(f"[ASSIGN] After credential injection: rec_rtsp={req.recording_rtsp!r}")
    # ---------------------------------------------------    
    
    stream_name = existing.get("stream_key") if existing else base_stream_name
    current_live_rtsp = existing.get("rtsp_url") if existing else None
    live_rtsp_changed = current_live_rtsp != req.live_rtsp

    if live_rtsp_changed or not stream_exists(stream_name):
        print(f"[ASSIGN] Live RTSP changed or stream missing — re-registering OME")
        try:
            try:
                remove_stream(stream_name)
            except:
                pass

            time.sleep(0.5)

            ome_response = register_stream(stream_name, req.live_rtsp)

            if ome_response.get("status") != "ok":
                print(f"[ASSIGN] ⚠ MediaMTX registration failed: {ome_response}")
        except Exception as e:
            print(f"[ASSIGN] ⚠ OME error (non-fatal): {e} — continuing")
    else:
        print(f"[ASSIGN] Live RTSP unchanged and stream exists — skipping OME re-register")

    if existing:
        existing["rtsp_url"]            = req.live_rtsp
        existing["recording_rtsp"]      = req.recording_rtsp
        existing["active_live_profile"] = req.live_profile
        existing["active_rec_profile"]  = req.recording_profile
        existing["recording_profile"]   = req.recording_profile
        existing["live_codec"]          = req.live_codec
        existing["fps"]                 = req.fps
        existing["resolution"]          = req.resolution
        existing["bitrate"]             = req.bitrate
        existing["bitrate_type"]        = req.bitrate_type
        device_entry = existing
    else:
        device_entry = {
            "stream_key":           stream_name,
            "rtsp_url":             req.live_rtsp,
            "recording_rtsp":       req.recording_rtsp,
            "ip":                   host,
            "port":                 req.port,
            "username":             req.username,
            "enabled":              True,
            "active_live_profile":  req.live_profile,
            "active_rec_profile":   req.recording_profile,
            "recording_profile":    req.recording_profile,
            "live_codec":           req.live_codec,
            "fps":                  req.fps,
            "resolution":           req.resolution,
            "bitrate":              req.bitrate,
            "bitrate_type":         req.bitrate_type,
        }
        devices.append(device_entry)

    save_devices(devices)

    save_camera_to_db({
    "ip":                   host,
    "stream_key":           stream_name,
    "rtsp_url":             req.live_rtsp,
    "recording_rtsp":       req.recording_rtsp,
    "manufacturer":         req.manufacturer,
    "model":                req.model,
    "mac":                  req.mac,
    "device_name":          req.device_name or f"Camera @ {host}",
    "port":                 req.port,
    "username":             req.username,
    "active_live_profile":  req.live_profile,
    "active_rec_profile":   req.recording_profile,
    "recording_profile":    req.recording_profile,
    "live_codec":           req.live_codec,
    "fps":                  req.fps,
    "resolution":           req.resolution,
    "bitrate":              req.bitrate,
    "bitrate_type":         req.bitrate_type,
    "updated_at":           datetime.utcnow(),
})

    print(f"[ASSIGN] ✅ Recording profile updated for {stream_name} to: {req.recording_rtsp}")

    _watchdog_failures[stream_name] = 0

    live_key = existing.get("live_stream") if existing else stream_name
    return {
        "success":           True,
        "stream_key":        stream_name,
        "ws_url":            f"http://localhost:8889/{live_key}",
        "stream_key":        live_key,
        "live_rtsp":         req.live_rtsp,
        "recording_rtsp":    req.recording_rtsp,
        "live_profile":      req.live_profile,
        "recording_profile": req.recording_profile,
    }


# ------------------------------------------------------------------
# Camera lookup by IP
# ------------------------------------------------------------------
@router.get("/cameras/by-ip/{ip}", dependencies=[Depends(verify_token)])
async def get_camera_by_ip(ip: str):
    if cameras_col is not None:
        doc = cameras_col.find_one({"$or": [{"ip": ip}, {"ip_address": ip}], "is_deleted": {"$ne": True}}, {"_id": 0})
        if doc:
            return doc
    dev = next((d for d in devices if d.get("ip") == ip or d.get("ip_address") == ip), None)
    if dev:
        return dev
    raise HTTPException(status_code=404, detail=f"Camera {ip} not found")


# ------------------------------------------------------------------
# Camera Features Router endpoints
# ------------------------------------------------------------------

@features_router.get("/encoder/options")
async def get_encoder_options(ip: str, port: int = 80, username: str = "", password: str = "", profile_token: str = ""):
    if not profile_token:
        raise HTTPException(status_code=400, detail="Missing profile_token")

    db_encodings = None
    db_resolutions = None
    if cameras_col is not None:
        cam_doc = cameras_col.find_one({"$or": [{"ip": ip}, {"ip_address": ip}], "is_deleted": {"$ne": True}}, {"_id": 0, "stream_profiles": 1, "manufacturer": 1})
        if cam_doc:
            for prof in cam_doc.get("stream_profiles") or []:
                if prof.get("token") == profile_token:
                    db_encodings = prof.get("supported_encodings")
                    db_resolutions = prof.get("supported_resolutions")
                    break

    result = await asyncio.to_thread(
        get_video_encoder_options, ip, port, username, password, profile_token
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to get encoder options"))

    if db_encodings:
        result["supported_encodings"] = db_encodings
    if db_resolutions:
        result["supported_resolutions"] = db_resolutions

    return result


@features_router.post("/encoder/set")
async def set_encoder_profile_settings(req: VideoEncoderSettingRequest):
    print(f"[FEATURES] Set encoder on {req.ip} for profile {req.profile_token}")
    result = await asyncio.to_thread(
        set_video_encoder_setting,
        req.ip, req.port, req.username, req.password,
        req.profile_token, req.resolution, req.encoding, req.fps, req.bitrate,
        req.bitrate_type, req.iframe_interval
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to update video encoder configuration"))
    
    probe_res = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password
    )
    
    if probe_res.get("success"):
        if cameras_col is not None:
            cameras_col.update_one(
                {"$or": [{"ip": req.ip}, {"ip_address": req.ip}]},
                {"$set": {
                    "stream_profiles": probe_res.get("all_profiles", probe_res.get("profiles", [])),
                    "stream_count": probe_res.get("stream_count", 0)
                }}
            )
        
        global devices
        for device in devices:
            if device.get("ip") == req.ip:
                stream_name = device.get("stream_key")
                if stream_name:
                    print(f"[ENCODER] Stream profiles updated for: {stream_name}")
    
    return {"success": True, "message": "Video encoder configuration updated successfully."}


@features_router.post("/capabilities")
async def get_camera_capabilities(req: CameraCredentials):
    print(f"[FEATURES] Full capability probe: {req.ip}:{req.port}")
    result = await asyncio.to_thread(
        probe_camera, req.ip, req.port, req.username, req.password
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Probe failed"))
    return result


@features_router.post("/imaging/set")
async def set_imaging(req: ImagingSettingRequest):
    print(f"[FEATURES] Set imaging {req.setting}={req.value} on {req.ip}")
    result = await asyncio.to_thread(
        set_imaging_setting,
        req.ip, req.port, req.username, req.password,
        req.setting, req.value
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/preset/goto")
async def goto_preset(req: PTZPresetRequest):
    result = await asyncio.to_thread(
        ptz_go_to_preset,
        req.ip, req.port, req.username, req.password,
        req.preset_token
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/preset/save")
async def save_preset(req: PTZSavePresetRequest):
    result = await asyncio.to_thread(
        ptz_set_preset,
        req.ip, req.port, req.username, req.password,
        req.preset_name, req.preset_token
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/home")
async def goto_home(req: CameraCredentials):
    result = await asyncio.to_thread(
        ptz_go_home,
        req.ip, req.port, req.username, req.password
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/ptz/move")
async def ptz_move(req: PTZMoveRequest):
    result = await asyncio.to_thread(
        move_camera_ptz,
        req.ip, req.port, req.username, req.password,
        req.pan, req.tilt, req.zoom
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/io/relay")
async def set_relay(req: RelayRequest):
    result = await asyncio.to_thread(
        trigger_relay,
        req.ip, req.port, req.username, req.password,
        req.relay_token, req.state
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@features_router.post("/analytics/enable")
async def enable_analytics(req: CameraCredentials):
    ip = req.ip
    if ip in _analytics_tasks and not _analytics_tasks[ip].done():
        return {"success": True, "message": "Already running"}
        
    device = next((d for d in devices if d.get("ip") == ip), None)
    manufacturer = device.get("manufacturer", "") if device else "bosch"

    if analytics_subs_col is not None:
        analytics_subs_col.update_one(
            {"ip": ip},
            {"$set": {
                "ip": ip, "port": req.port,
                "username": req.username, "password": req.password,
                "manufacturer": manufacturer,
                "enabled": True, "enabled_at": datetime.utcnow()
            }},
            upsert=True
        )
    task = asyncio.create_task(
        _analytics_poll_loop(ip, req.port, req.username, req.password, manufacturer)
    )
    _analytics_tasks[ip] = task
    print(f"[ANALYTICS] ✅ Enabled for {ip} ({manufacturer})")
    return {"success": True, "message": f"Analytics started for {ip}"}


@features_router.post("/analytics/disable")
async def disable_analytics(req: CameraCredentials):
    ip = req.ip
    task = _analytics_tasks.get(ip)
    if task and not task.done():
        task.cancel()
        del _analytics_tasks[ip]
    if analytics_subs_col is not None:
        analytics_subs_col.update_one({"ip": ip}, {"$set": {"enabled": False}})
    print(f"[ANALYTICS] ⏹ Disabled for {ip}")
    return {"success": True, "message": f"Analytics stopped for {ip}"}


@features_router.get("/analytics/status/{ip}")
async def analytics_status(ip: str):
    running = ip in _analytics_tasks and not _analytics_tasks[ip].done()
    return {"ip": ip, "running": running}


@features_router.get("/analytics/events/{ip}")
async def get_analytics_events(ip: str, limit: int = 50):
    if analytics_col is None:
        return {"events": []}
    docs = list(
        analytics_col.find({"ip": ip}, {"_id": 0})
        .sort("received_at", -1).limit(limit)
    )
    for d in docs:
        if "received_at" in d:
            d["received_at"] = d["received_at"].isoformat()
    return {"events": docs}


# ------------------------------------------------------------------
# Device / storage endpoints
# ------------------------------------------------------------------

@router.post("/devices/", dependencies=[Depends(verify_token)])
async def add_device(device: dict):
    if "ip" in device or "ip_address" in device:
        validate_ip_only(device.get("ip") or device.get("ip_address"))
    if "rtsp_url" in device:
        validate_rtsp_url(device.get("rtsp_url"))
    if "recording_rtsp" in device:
        validate_rtsp_url(device.get("recording_rtsp"))
        
    import re as _re
    _NAME_RE = _re.compile(r"^[a-zA-Z0-9 _.\-]+$")
    for _field in ("name", "device_name", "manufacturer", "model", "group_id"):
        _val = device.get(_field)
        if _val and not _NAME_RE.match(str(_val).strip()):
            raise HTTPException(status_code=400, detail=f"'{_field}' contains invalid characters.")

    print("DEVICE REGISTERED:", device)
    stream_id = device.get("stream_key") or device.get("ip_address")
    if not stream_id:
        return {"success": False, "error": "Missing identifier"}

    existing = next(
        (d for d in devices if (d.get("stream_key") or d.get("ip_address")) == stream_id), 
        None
    )
    if existing:
        devices.remove(existing)
    devices.append(device)
    save_devices(devices)
    return {"success": True, "device": device}



@router.get("/devices", dependencies=[Depends(verify_token)])
async def get_devices():
    devs = await _db.devices.find({}).to_list(None)
    result = []
    for d in devs:
        d["id"]  = str(d["_id"])
        d["_id"] = str(d["_id"])
        result.append(d)
    return result



@router.get("/cameras/", dependencies=[Depends(verify_token)])
async def get_cameras_from_db():
    if cameras_col is None:
        return []
    docs = list(cameras_col.find({"is_deleted": {"$ne": True}}, {"_id": 0}))
    return docs



@router.post("/onvif/ptz/move", dependencies=[Depends(verify_token)])
async def onvif_ptz_move(req: PTZMoveRequest):
    print(f"[PTZ] Moving {req.ip} to P:{req.pan} T:{req.tilt} Z:{req.zoom}")
    result = await asyncio.to_thread(
        move_camera_ptz,
        req.ip, req.port, req.username, req.password,
        req.pan, req.tilt, req.zoom
    )
    return result


@router.get("/cameras/transcoder-status", dependencies=[Depends(verify_token)])
async def get_transcoder_status():
    try:
        if cameras_col is None:
            return {"status": "error", "message": "DB not initialized"}
        
        status_doc = await _db["system_status"].find_one({"type": "transcoder_status"})
        active = status_doc.get("active_transcoders", []) if status_doc else []
        
        return {
            "status": "ok", 
            "active_transcoders": active,
            "timestamp": status_doc.get("timestamp") if status_doc else None
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
# ------------------------------------------------------------------
# Dashboard
# ------------------------------------------------------------------