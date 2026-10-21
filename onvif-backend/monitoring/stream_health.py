"""
stream_health.py
────────────────
Polls every camera node for live stream stats (bitrate, FPS, resolution,
codec, dropped frames, RTSP/ONVIF/recording status) and writes them back
to infrastructure_nodes so the frontend sidebar shows real data.

Add to your scheduler:
    from .stream_health import run_stream_health_loop
    asyncio.ensure_future(run_stream_health_loop())
"""

import asyncio
import socket
import time
import os
import re
from datetime import datetime, timezone

from app.core.database import mongo_client
from .websocket_manager import manager

MONGO_URI  = os.environ["MONGO_URI"]
MONGO_DB_NAME = os.environ.get("MONGO_DB_NAME")
_client    = mongo_client
_db = _client[MONGO_DB_NAME] if _client else None
nodes_col = _db["infrastructure_nodes"] if _db is not None else None

# ─── How often to poll each camera (seconds) ─────────────────────────────────
POLL_INTERVAL = 15

uptime_events_col = _db["uptime_events"] if _db is not None else None


# ─── Camera credentials (override via env or extend per-camera from DB) ───────
DEFAULT_USER = os.environ.get("CAM_USER", "admin")
DEFAULT_PASS = os.environ.get("CAM_PASS", "")


# ─────────────────────────────────────────────────────────────────────────────
#  LOW-LEVEL HELPERS
# ─────────────────────────────────────────────────────────────────────────────

async def _tcp_open(ip: str, port: int, timeout: float = 1.5) -> bool:
    """Async TCP port check."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=timeout
        )
        writer.close()
        await writer.wait_closed()
        return True
    except Exception:
        return False


async def _probe_rtsp(ip: str, port: int = 554, timeout: float = 3.0):
    """
    Send a minimal RTSP OPTIONS request and parse the response.
    Returns dict with keys: connected, bitrate_mbps, fps, resolution,
    codec, status, dropped_frames.
    All numeric fields are None if unavailable.
    """
    result = {
        "connected": False,
        "bitrate_mbps": None,
        "fps": None,
        "resolution": None,
        "codec": None,
        "status": None,
        "dropped_frames": None,
    }

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=timeout
        )
    except Exception:
        result["status"] = "dead"
        return result

    try:
        # Send RTSP OPTIONS — works even without auth
        request = (
            f"OPTIONS rtsp://{ip}:{port}/ RTSP/1.0\r\n"
            f"CSeq: 1\r\n"
            f"User-Agent: MiradorVMS/1.0\r\n\r\n"
        )
        writer.write(request.encode())
        await writer.drain()

        raw = await asyncio.wait_for(reader.read(2048), timeout=timeout)
        response = raw.decode("utf-8", errors="ignore")

        if "RTSP/1.0 200" in response or "RTSP/1.1 200" in response:
            result["connected"] = True
            result["status"]    = "healthy"
        elif "401" in response:
            # Auth required but port/service alive — still "connected"
            result["connected"] = True
            result["status"]    = "auth_required"
        else:
            result["status"] = "degraded"

        # Try to extract codec from Public: header (Dahua/Hikvision include it)
        pub_match = re.search(r"Public:([^\r\n]+)", response, re.IGNORECASE)
        if pub_match:
            pub = pub_match.group(1)
            for codec in ("H.265", "H.264", "HEVC", "H265", "H264", "MJPEG"):
                if codec.upper() in pub.upper():
                    result["codec"] = codec.replace("HEVC", "H.265").replace("H265", "H.265").replace("H264", "H.264")
                    break

    except Exception:
        result["status"] = result["status"] or "degraded"
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

    return result


async def _probe_onvif_stream(ip: str, port: int = 80,
                               user: str = DEFAULT_USER,
                               password: str = DEFAULT_PASS):
    """
    Try ONVIF GetStreamUri + GetVideoEncoderConfigurations to get
    resolution, fps, codec, bitrate.
    Returns a dict of stream fields, all None if ONVIF unavailable.
    """
    fields = {
        "fps": None, "resolution": None,
        "codec": None, "bitrate_mbps": None,
    }

    # Check port reachable first (fast path — avoids long zeep timeout)
    if not await _tcp_open(ip, port, timeout=1.5):
        return fields

    try:
        # onvif-zeep is optional — if not installed, skip silently
        from onvif import ONVIFCamera  # type: ignore
        import zeep                    # type: ignore

        def _blocking_onvif():
            cam = ONVIFCamera(ip, port, user, password, no_cache=True)
            media = cam.create_media_service()

            profiles = media.GetProfiles()
            if not profiles:
                return {}

            # Use the first profile
            profile = profiles[0]
            token   = profile.token

            # Video encoder config
            enc = None
            try:
                configs = media.GetVideoEncoderConfigurations()
                enc = configs[0] if configs else None
            except Exception:
                pass

            out = {}
            if enc:
                enc_type = getattr(enc, "Encoding", None)
                if enc_type:
                    out["codec"] = str(enc_type)

                res = getattr(enc, "Resolution", None)
                if res:
                    w = getattr(res, "Width",  None)
                    h = getattr(res, "Height", None)
                    if w and h:
                        out["resolution"] = f"{w}x{h}"

                rate = getattr(enc, "RateControl", None)
                if rate:
                    fps = getattr(rate, "FrameRateLimit", None)
                    bps = getattr(rate, "BitrateLimit",   None)  # kbps
                    if fps: out["fps"]          = float(fps)
                    if bps: out["bitrate_mbps"] = round(float(bps) / 1024, 2)

            return out

        # Run blocking zeep calls in thread pool to avoid blocking event loop
        loop   = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(None, _blocking_onvif),
            timeout=8.0
        )
        fields.update(result)

    except ImportError:
        pass  # onvif-zeep not installed — skip
    except Exception as e:
        pass  # auth fail, timeout, etc. — not fatal

    return fields


async def _probe_hikvision_stream(ip: str,
                                   user: str = DEFAULT_USER,
                                   password: str = DEFAULT_PASS):
    """
    Dahua/Hikvision HTTP API fallback for stream stats.
    GET /ISAPI/Streaming/channels/101/capabilities  (Hikvision)
    GET /cgi-bin/magicBox.cgi?action=getSystemInfo  (Dahua)
    Returns partial stream dict or empty dict.
    """
    import aiohttp  # type: ignore
    fields = {}
    auth   = aiohttp.BasicAuth(user, password)

    endpoints = [
        # Hikvision ISAPI
        (f"http://{ip}/ISAPI/Streaming/channels/101/capabilities", "hik"),
        # Dahua
        (f"http://{ip}/cgi-bin/magicBox.cgi?action=getSystemInfo", "dahua"),
    ]

    try:
        async with aiohttp.ClientSession(auth=auth) as session:
            for url, brand in endpoints:
                try:
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=3)) as resp:
                        if resp.status == 200:
                            text = await resp.text()
                            if brand == "hik":
                                # Extract codec from XML
                                m = re.search(r"<videoCodecType>([^<]+)</videoCodecType>", text)
                                if m: fields["codec"] = m.group(1).strip()
                                m = re.search(r"<maxFrameRate>(\d+)</maxFrameRate>", text)
                                if m: fields["fps"] = float(m.group(1)) / 100  # Hik uses 100x
                                m = re.search(r"<maxBitrate>(\d+)</maxBitrate>", text)
                                if m: fields["bitrate_mbps"] = round(int(m.group(1)) / 1024, 2)
                                m = re.search(r"<videoResolutionWidth>(\d+).*?<videoResolutionHeight>(\d+)", text, re.DOTALL)
                                if m: fields["resolution"] = f"{m.group(1)}x{m.group(2)}"
                            break
                except Exception:
                    continue
    except ImportError:
        pass  # aiohttp not installed
    except Exception:
        pass

    return fields


# ─────────────────────────────────────────────────────────────────────────────
#  PER-CAMERA PROBE
# ─────────────────────────────────────────────────────────────────────────────

async def probe_camera_stream(node: dict) -> dict:
    """
    Full stream probe for one camera node.
    Returns a dict of fields ready to $set into infrastructure_nodes.
    """
    ip       = node.get("ip", "")
    user     = node.get("username") or node.get("user") or DEFAULT_USER
    password = node.get("password") or node.get("pass") or DEFAULT_PASS

    # 1. TCP port checks (fast)
    rtsp_open, onvif_open, http_open = await asyncio.gather(
        _tcp_open(ip, 554),
        _tcp_open(ip, 8080, timeout=1.0),
        _tcp_open(ip, 80,   timeout=1.0),
    )

    # 2. RTSP probe (gives status + codec hint)
    rtsp_data = await _probe_rtsp(ip, 554) if rtsp_open else {
        "connected": False, "status": "dead",
        "bitrate_mbps": None, "fps": None,
        "resolution": None, "codec": None, "dropped_frames": None,
    }

    # 3. ONVIF probe (gives resolution/fps/bitrate/codec more reliably)
    onvif_port = 8080 if onvif_open else (80 if http_open else None)
    onvif_data = {}
    if onvif_port:
        onvif_data = await _probe_onvif_stream(ip, onvif_port, user, password)

    # 4. HTTP API fallback (Hikvision/Dahua)
    http_data = {}
    if http_open and not onvif_data.get("codec"):
        http_data = await _probe_hikvision_stream(ip, user, password)

    # ── Merge: ONVIF > HTTP API > RTSP (in that priority order) ────────────
    merged_codec      = onvif_data.get("codec")      or http_data.get("codec")      or rtsp_data.get("codec")
    merged_fps        = onvif_data.get("fps")        or http_data.get("fps")
    merged_resolution = onvif_data.get("resolution") or http_data.get("resolution")

    # ── Real bitrate + resolution from MediaMTX ──────────────────────────────
    # The camera DB record tells us which MediaMTX path is active for this node.
    # We ask MediaMTX for the actual bytes received and compute real Mbps.
    # For grid view  → use sub_stream_key path (lower res/bitrate)
    # For fullscreen → use main stream path (full res/bitrate)
    MEDIAMTX_API = os.environ["MEDIAMTX_API_URL"]
    stream_key    = node.get("stream_key") or ip.replace(".", "_")
    sub_key       = node.get("sub_stream_key")
    view_mode     = node.get("view_mode", "grid")

    # Choose which MediaMTX path to inspect based on view mode
    active_path = (sub_key if sub_key and view_mode != "fullscreen" else stream_key)

    merged_bitrate = None
    real_resolution = None

    try:
        import urllib.request as _req
        import json as _json
        # Fetch real-time path stats from MediaMTX
        url = f"{MEDIAMTX_API}/v3/paths/get/{active_path}"
        with _req.urlopen(url, timeout=2) as resp:
            path_data = _json.loads(resp.read().decode())

        # Compute bitrate from bytesReceived delta stored in path_data
        bytes_recv = path_data.get("bytesReceived") or path_data.get("inboundBytes") or 0
        # MediaMTX reports cumulative bytes — we use the last-polled snapshot
        # stored on the node to compute a delta.
        last_bytes = node.get("_last_bytes_recv", 0) or 0
        last_ts    = node.get("_last_bytes_ts",   0) or 0
        now_ts     = time.time()
        dt         = now_ts - last_ts
        if last_ts > 0 and dt > 0 and bytes_recv >= last_bytes:
            merged_bitrate = round((bytes_recv - last_bytes) * 8 / dt / 1_000_000, 2)  # Mbps

        # Persist snapshot for next poll (we write it back to MongoDB below in run_stream_health_loop)
        node["_last_bytes_recv"] = bytes_recv
        node["_last_bytes_ts"]   = now_ts

        # Real resolution from MediaMTX codec properties
        tracks = path_data.get("tracks2") or []
        for track in tracks:
            props = track.get("codecProps") or {}
            w = props.get("width")
            h = props.get("height")
            if w and h:
                real_resolution = f"{w}x{h}"
                break

    except Exception:
        pass  # MediaMTX unreachable — fall back to ONVIF resolution

    # Resolution: prefer what MediaMTX actually delivers (real resolution
    # of the active stream path), then fall back to ONVIF config value.
    final_resolution = real_resolution or merged_resolution



    # Determine stream_status
    if rtsp_data["connected"]:
        stream_status = "healthy"
    elif rtsp_open:
        stream_status = "degraded"
    else:
        stream_status = "dead"

    # "recording" = RTSP open AND stream healthy/auth_required
    recording = rtsp_data["connected"] or (rtsp_open and onvif_data.get("fps") is not None)

    return {
        # Stream health fields the frontend CameraStreamPanel reads
        "stream_bitrate_mbps": merged_bitrate,        # real Mbps from MediaMTX bytes delta
        "stream_fps":          merged_fps,
        "stream_resolution":   final_resolution,       # real resolution from active MediaMTX path
        "stream_status":       stream_status,
        "codec":               merged_codec,
        "dropped_frames":      rtsp_data.get("dropped_frames", 0) or 0,

        # Connection flags the frontend flag pills read
        "rtsp_connected":  rtsp_data["connected"],
        "onvif_connected": onvif_open,
        "recording":       recording,

        # Bytes snapshot for delta bitrate calculation on next poll
        "_last_bytes_recv": node.get("_last_bytes_recv", 0),
        "_last_bytes_ts":   node.get("_last_bytes_ts",   0),

        # Metadata
        "stream_last_polled": datetime.now(timezone.utc).isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
#  BACKGROUND LOOP
# ─────────────────────────────────────────────────────────────────────────────

async def run_stream_health_loop():
    """
    Runs forever. Every POLL_INTERVAL seconds, probes all camera nodes
    and writes results back to MongoDB + broadcasts NODE_UPDATE so the
    frontend sidebar refreshes automatically without a page reload.
    """
    print(f"[STREAM_HEALTH] Starting stream poller (interval={POLL_INTERVAL}s)…")

    # ── Wait until seed_topology_from_cameras() has populated camera nodes ──
    # The seeder runs in a background thread and may take 10-30 s.
    # We poll every 5 s up to 60 s, then fall through and keep retrying normally.
    print("[STREAM_HEALTH] Waiting for camera nodes to be seeded into infrastructure_nodes…")
    for _wait in range(12):  # up to 60 s
        cam_count = nodes_col.count_documents({"type": "camera"})
        if cam_count > 0:
            print(f"[STREAM_HEALTH] Found {cam_count} camera node(s) — starting poll loop.")
            break
        await asyncio.sleep(5)
    else:
        print("[STREAM_HEALTH] ⚠ No camera nodes found after 60 s — will keep retrying in the poll loop.")

    while True:
        try:
            # Sync infrastructure_nodes with cameras collection dynamically
            from app.core.database import cameras_col as c_col
            if c_col is not None:
                all_cams = list(c_col.find({}))
                configured_ips = {c.get("ip") for c in all_cams if c.get("ip")}
                
                # Insert new camera nodes
                for cam in all_cams:
                    ip = cam.get("ip")
                    if not ip:
                        continue
                    node_id = f"node-{ip.replace('.', '-')}"
                    existing = nodes_col.find_one({"id": node_id})
                    if not existing:
                        nodes_col.insert_one({
                            "id": node_id,
                            "ip": ip,
                            "type": "camera",
                            "manufacturer": cam.get("manufacturer", "Unknown"),
                            "model": cam.get("model", "Unknown"),
                            "status": "online",
                            "latency": 5.0,
                            "last_seen": datetime.now(timezone.utc),
                            "inferred": False,
                            "username": cam.get("username", "") or cam.get("user", ""),
                            "password": cam.get("password", "") or cam.get("pass", ""),
                            "position": None,
                            "stream_status": "healthy"
                        })
                        print(f"[STREAM_HEALTH] Synced new camera node to topology: {node_id}")
                    else:
                        nodes_col.update_one(
                            {"id": node_id},
                            {"$set": {
                                "username": cam.get("username", "") or cam.get("user", ""),
                                "password": cam.get("password", "") or cam.get("pass", "")
                            }}
                        )
                
                # Delete removed camera nodes
                existing_cam_nodes = list(nodes_col.find({"type": "camera"}))
                for node in existing_cam_nodes:
                    node_ip = node.get("ip")
                    if node_ip and node_ip not in configured_ips:
                        nodes_col.delete_one({"id": node.get("id")})
                        print(f"[STREAM_HEALTH] Removed deleted camera node from topology: {node.get('id')}")
        except Exception as e:
            print(f"[STREAM_HEALTH] dynamic topology sync error: {e}")

        try:
            cameras = list(nodes_col.find(
                {"type": "camera"},
                {"_id": 0, "id": 1, "ip": 1, "username": 1, "password": 1,
                 "user": 1, "pass": 1, "stream_key": 1, "sub_stream_key": 1,
                 "_last_bytes_recv": 1, "_last_bytes_ts": 1, "view_mode": 1}
            ))

            # Enrich with stream_key/sub_stream_key from cameras collection
            # (infrastructure_nodes may not have them yet)
            from app.core.database import cameras_col as c_col2
            if c_col2 is not None:
                cam_by_ip = {}
                for c in c_col2.find({}, {"_id": 0, "ip": 1, "stream_key": 1, "sub_stream_key": 1}):
                    if c.get("ip"):
                        cam_by_ip[c["ip"]] = c
                for cam in cameras:
                    enrichment = cam_by_ip.get(cam.get("ip"), {})
                    if not cam.get("stream_key"):
                        cam["stream_key"] = enrichment.get("stream_key")
                    if not cam.get("sub_stream_key"):
                        cam["sub_stream_key"] = enrichment.get("sub_stream_key")

            if not cameras:
                print("[STREAM_HEALTH] No camera nodes found in infrastructure_nodes — retrying in next cycle.")
            else:
                # Probe all cameras concurrently (capped to avoid flooding)
                semaphore = asyncio.Semaphore(10)

                async def probe_one(node):
                    async with semaphore:
                        try:
                            fields = await probe_camera_stream(node)
                            node_id = node["id"]

                            # Check transcoder status if it's H.265
                            codec = fields.get("codec")
                            if codec and codec.lower() in ["hevc", "h.265", "h265"]:
                                status_doc = _db["system_status"].find_one({"type": "transcoder_status"}) if _db is not None else None
                                active_transcoders = status_doc.get("active_transcoders", []) if status_doc else []
                                
                                # try to get stream_key
                                cam_doc = _db["cameras"].find_one({"ip": node.get("ip")}) if _db is not None else None
                                stream_name = cam_doc.get("stream_key") if cam_doc else None
                                
                                if stream_name and stream_name in active_transcoders:
                                    fields["transcoder_status"] = "running"
                                else:
                                    fields["transcoder_status"] = "stopped"

                            # Write to MongoDB
                            nodes_col.update_one(
                                {"id": node_id},
                                {"$set": fields}
                            )
                            # --- Track Events for History ---
                            now_utc = datetime.now(timezone.utc)
                            prev_status = node.get("stream_status")
                            curr_status = fields.get("stream_status")
                            
                            # Camera Event: Healthy/Degraded = UP, Dead = DOWN
                            is_curr_up = curr_status in ["healthy", "degraded", "auth_required"]
                            is_prev_up = prev_status in ["healthy", "degraded", "auth_required"]
                            if prev_status is not None and is_curr_up != is_prev_up:
                                state_str = "up" if is_curr_up else "down"
                                if uptime_events_col is not None:
                                    uptime_events_col.insert_one({
                                        "node_id": node_id,
                                        "ip": node.get("ip"),
                                        "event_type": "camera",
                                        "state": state_str,
                                        "timestamp": now_utc
                                    })
                            
                            # Recording Event: True = UP, False = DOWN
                            prev_rec = bool(node.get("recording"))
                            curr_rec = bool(fields.get("recording"))
                            if "recording" in node and curr_rec != prev_rec:
                                rec_state_str = "up" if curr_rec else "down"
                                if uptime_events_col is not None:
                                    uptime_events_col.insert_one({
                                        "node_id": node_id,
                                        "ip": node.get("ip"),
                                        "event_type": "recording",
                                        "state": rec_state_str,
                                        "timestamp": now_utc
                                    })
                            # --------------------------------
                            # Broadcast to all open WebSocket clients so the
                            # sidebar refreshes live without a manual refresh
                            await manager.broadcast({
                                "type": "NODE_UPDATE",
                                "id":   node_id,
                                "data": fields,
                            })

                            print(
                                f"[STREAM_HEALTH] {node.get('ip')} → "
                                f"status={fields['stream_status']} "
                                f"fps={fields['stream_fps']} "
                                f"res={fields['stream_resolution']} "
                                f"codec={fields['codec']} "
                                f"bitrate={fields['stream_bitrate_mbps']}"
                            )
                        except Exception as e:
                            print(f"[STREAM_HEALTH] Error probing {node.get('ip')}: {e}")

                await asyncio.gather(*[probe_one(c) for c in cameras])

        except Exception as e:
            print(f"[STREAM_HEALTH] Loop error: {e}")

        await asyncio.sleep(POLL_INTERVAL)
