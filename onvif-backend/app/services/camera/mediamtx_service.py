import requests
import os

MEDIAMTX_API = os.environ.get(
    "MEDIAMTX_API_URL",
    os.environ["MEDIAMTX_API_URL"]
)

def register_stream(stream_name, rtsp_url, codec=None, sub_stream_rtsp=None):
    """
    Register a camera's main stream in MediaMTX.

    If sub_stream_rtsp is provided, also registers {stream_name}_sub as a
    separate MediaMTX path pointing at the camera's sub stream RTSP URL.
    This is the primary mechanism for real bandwidth control:
      - Grid viewers play {stream_name}_sub  → 1–2 Mbps (low res)
      - Fullscreen viewers play {stream_name} → 8–12 Mbps (full res)
    Recording always uses the main stream RTSP directly.
    """
    payload = {
        "source": rtsp_url,
        "sourceOnDemand": False
    }

    try:
        res = requests.post(
            f"{MEDIAMTX_API}/v3/config/paths/add/{stream_name}",
            json=payload,
            timeout=10
        )
        print("MEDIAMTX STATUS:", res.status_code)
        print("MEDIAMTX RESPONSE:", res.text)

        # NOTE: We no longer register the "_h264" fallback path via the
        # MediaMTX API here. MediaMTX's own config (mediamtx.yml) owns
        # that path through a regex rule (~^(.+)_h264$) using runOnDemand,
        # which auto-transcodes ANY H265 camera the moment a client
        # requests "<camera>_h264" — no per-camera registration needed.
        needs_h264_path = False
        if codec:
            codec_upper = codec.upper()
            if codec_upper in ["H.265", "H265", "HEVC"]:
                needs_h264_path = True
        else:
            needs_h264_path = True

        h264_stream_name = f"{stream_name}_h264"

        if res.status_code not in [200, 201]:
            # If path already exists, try patching the existing path source
            patch_res = requests.patch(
                f"{MEDIAMTX_API}/v3/config/paths/patch/{stream_name}",
                json=payload,
                timeout=10
            )
            print("MEDIAMTX PATCH STATUS:", patch_res.status_code)
            print("MEDIAMTX PATCH RESPONSE:", patch_res.text)
            if patch_res.status_code not in [200, 201]:
                return {
                    "status": "error",
                    "message": f"Base: {res.text} (Patch: {patch_res.text})",
                    "statusCode": res.status_code
                }
            res = patch_res

        # ── Register sub stream if available ──────────────────────────────
        # This gives MediaMTX a second, independent path for the low-res
        # sub stream. Grid viewers will request this path. The camera's
        # hardware multiplexes both streams simultaneously at no extra CPU
        # cost on the VMS server.
        sub_key = f"{stream_name}_sub"
        if sub_stream_rtsp:
            try:
                sub_res = requests.post(
                    f"{MEDIAMTX_API}/v3/config/paths/add/{sub_key}",
                    json={"source": sub_stream_rtsp, "sourceOnDemand": False},
                    timeout=10
                )
                print(f"MEDIAMTX SUB STREAM [{sub_key}] STATUS:", sub_res.status_code)
                print(f"MEDIAMTX SUB STREAM RESPONSE:", sub_res.text)
                if sub_res.status_code not in [200, 201]:
                    requests.patch(
                        f"{MEDIAMTX_API}/v3/config/paths/patch/{sub_key}",
                        json={"source": sub_stream_rtsp, "sourceOnDemand": False},
                        timeout=10
                    )
            except Exception as sub_err:
                print(f"MEDIAMTX SUB STREAM REGISTER ERROR ({sub_key}): {sub_err}")

        transcoded_stream = h264_stream_name if needs_h264_path else None
        return {
            "status": "ok",
            "transcoded_stream": transcoded_stream,
            "sub_stream_key": sub_key if sub_stream_rtsp else None,
            "statusCode": res.status_code
        }

    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "statusCode": 0
        }


def get_stream_info(stream_name):
    """Get runtime information about a stream including active readers."""
    try:
        res = requests.get(
            f"{MEDIAMTX_API}/v3/paths/get/{stream_name}",
            timeout=5
        )
        if res.status_code == 200:
            return res.json()
        return None
    except Exception as e:
        print(f"MEDIAMTX GET INFO ERROR: {str(e)}")
        return None


def remove_stream(stream_name):
    """
    Remove a stream path from MediaMTX.
    Also removes the corresponding sub-stream path ({stream_name}_sub) if it exists.
    """
    try:
        res = requests.delete(
            f"{MEDIAMTX_API}/v3/config/paths/delete/{stream_name}",
            timeout=10
        )
        print("MEDIAMTX DELETE STATUS:", res.status_code)
        print("MEDIAMTX DELETE RESPONSE:", res.text)

        # Always try to remove sub stream path — it's a no-op if it doesn't exist.
        sub_key = f"{stream_name}_sub"
        try:
            sub_del = requests.delete(
                f"{MEDIAMTX_API}/v3/config/paths/delete/{sub_key}",
                timeout=5
            )
            if sub_del.status_code in [200, 204]:
                print(f"MEDIAMTX SUB STREAM REMOVED: {sub_key}")
        except Exception:
            pass  # Sub stream didn't exist — that's fine.

        return res.status_code in [200, 204]

    except Exception as e:
        print("MEDIAMTX DELETE ERROR:", str(e))
        return False


def stream_exists(stream_name):
    try:
        res = requests.get(
            f"{MEDIAMTX_API}/v3/config/paths/get/{stream_name}",
            timeout=5
        )
        return res.status_code == 200
    except Exception:
        return False