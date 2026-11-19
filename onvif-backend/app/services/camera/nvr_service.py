"""
NVR Integration Service
Provides recording discovery and playback streaming for Dahua/ONVIF NVRs.
"""

import os
import re
import urllib.parse
from datetime import datetime, timedelta
import requests
from requests.auth import HTTPDigestAuth


def is_nvr_camera(cam_doc: dict) -> bool:
    """Detects if a camera document originates from an NVR."""
    if not cam_doc:
        return False
    model = (cam_doc.get("model") or "").lower()
    stream_key = (cam_doc.get("stream_key") or "").lower()
    dev_type = (cam_doc.get("device_type") or "").lower()
    
    if any(kw in model for kw in ["nvr", "dvr", "xvr", "recorder"]):
        return True
    if any(kw in dev_type for kw in ["nvr", "dvr", "xvr", "recorder"]):
        return True
    if "_cam" in stream_key:
        return True
    return False


def extract_nvr_channel(cam_doc: dict) -> int:
    """Extracts the 1-based NVR channel index from a camera doc."""
    sk = cam_doc.get("stream_key", "")
    m = re.search(r"_cam(\d+)", sk, re.IGNORECASE)
    if m:
        return int(m.group(1))
    
    url = cam_doc.get("rtsp_url", "")
    m2 = re.search(r"channel=(\d+)", url, re.IGNORECASE)
    if m2:
        return int(m2.group(1))
        
    return 1


def query_dahua_recordings(
    ip: str,
    port: int,
    username: str,
    password: str,
    channel: int,
    date_str: str,
    timeout: int = 6
) -> list[dict]:
    """
    Queries Dahua NVR hard drive recordings via mediaFileFind.cgi for a specific channel and date (YYYY-MM-DD).
    Returns list of standardized recording metadata objects.
    """
    auth = HTTPDigestAuth(username, password)
    base_url = f"http://{ip}:{port}"
    session_token = None

    try:
        # 1. Create finder session
        r1 = requests.get(f"{base_url}/cgi-bin/mediaFileFind.cgi?action=factory.create", auth=auth, timeout=timeout)
        if r1.status_code != 200:
            print(f"[NVR] factory.create failed on {ip}: {r1.status_code}")
            return []

        for line in r1.text.splitlines():
            if "result=" in line:
                session_token = line.split("result=")[1].strip()
                break

        if not session_token:
            print(f"[NVR] No session token returned from {ip}")
            return []

        # 2. Initiate search for date range 00:00:00 to 23:59:59
        # In Dahua CGI, condition.Channel can be 1-indexed in URL which maps to Channel 0 internally
        start_time = f"{date_str} 00:00:00"
        end_time = f"{date_str} 23:59:59"
        
        find_url = (
            f"{base_url}/cgi-bin/mediaFileFind.cgi?action=findFile"
            f"&object={session_token}"
            f"&condition.Channel={channel}"
            f"&condition.StartTime={urllib.parse.quote(start_time)}"
            f"&condition.EndTime={urllib.parse.quote(end_time)}"
        )
        r2 = requests.get(find_url, auth=auth, timeout=timeout)
        if r2.status_code != 200 or "OK" not in r2.text:
            print(f"[NVR] findFile failed on {ip} for ch {channel}: {r2.text}")
            return []

        # 3. Retrieve files in batches
        all_raw_items = {}
        batch_offset = 0
        for _ in range(5):  # up to 5 batches of 100 items
            r3 = requests.get(
                f"{base_url}/cgi-bin/mediaFileFind.cgi?action=findNextFile&object={session_token}&count=100",
                auth=auth,
                timeout=timeout
            )
            if r3.status_code != 200:
                break
                
            batch_count = 0
            for line in r3.text.splitlines():
                line = line.strip()
                if "found=" in line:
                    try:
                        batch_count = int(line.split("found=")[1].strip())
                    except ValueError:
                        pass
                if "=" in line and line.startswith("items["):
                    k, v = line.split("=", 1)
                    m = re.match(r"items\[(\d+)\]\.(.+)", k)
                    if m:
                        idx = batch_offset + int(m.group(1))
                        field = m.group(2)
                        if idx not in all_raw_items:
                            all_raw_items[idx] = {}
                        all_raw_items[idx][field] = v
            
            batch_offset += batch_count
            if batch_count == 0:
                break

        # 4. Standardize output
        results = []
        for i in sorted(all_raw_items.keys()):
            raw = all_raw_items[i]
            st = raw.get("StartTime", "")
            et = raw.get("EndTime", "")
            dur = 0
            try:
                t1 = datetime.strptime(st, "%Y-%m-%d %H:%M:%S")
                t2 = datetime.strptime(et, "%Y-%m-%d %H:%M:%S")
                dur = int((t2 - t1).total_seconds())
            except Exception:
                pass

            file_path = raw.get("FilePath", "")
            name = file_path.split("/")[-1] if "/" in file_path else (file_path or f"{st}.dav")
            
            st_part = st.split(" ")[1] if " " in st else st
            et_part = et.split(" ")[1] if " " in et else et

            results.append({
                "date": date_str,
                "start_time": st_part,
                "end_time": et_part,
                "duration_seconds": dur,
                "size": int(raw.get("Length") or raw.get("CutLength") or 0),
                "name": name,
                "file_path": file_path,
                "status": "COMPLETED",
                "source": "nvr",
                "channel": channel,
                "stream_type": raw.get("VideoStream", "Main")
            })

        return sorted(results, key=lambda x: x["start_time"])

    except Exception as e:
        print(f"[NVR] Error querying Dahua recordings for {ip}: {e}")
        return []

    finally:
        if session_token:
            try:
                requests.get(
                    f"{base_url}/cgi-bin/mediaFileFind.cgi?action=destroy&object={session_token}",
                    auth=auth,
                    timeout=2
                )
            except Exception:
                pass


def build_dahua_playback_rtsp(
    ip: str,
    username: str,
    password: str,
    channel: int,
    date_str: str,
    start_time_str: str,
    end_time_str: str = ""
) -> str:
    """
    Builds Dahua RTSP playback URL.
    Format: rtsp://user:pass@ip:554/cam/playback?channel=1&starttime=YYYY_MM_DD_HH_MM_SS&endtime=YYYY_MM_DD_HH_MM_SS
    """
    # Normalize date
    d_clean = date_str.replace("-", "_").strip()
    
    # Normalize start time (e.g. 15:09:33 -> 15_09_33)
    st_clean = start_time_str.replace(":", "_").replace("-", "_").strip()
    if len(st_clean.split("_")) == 2:
        st_clean += "_00"
    st_formatted = f"{d_clean}_{st_clean}"

    # Normalize end time
    if end_time_str:
        et_clean = end_time_str.replace(":", "_").replace("-", "_").strip()
        if len(et_clean.split("_")) == 2:
            et_clean += "_00"
        et_formatted = f"{d_clean}_{et_clean}"
    else:
        # Default to 30 mins after start time
        try:
            dt = datetime.strptime(f"{date_str} {start_time_str.replace('_', ':')}", "%Y-%m-%d %H:%M:%S")
            et_dt = dt + timedelta(minutes=30)
            et_formatted = et_dt.strftime("%Y_%m_%d_%H_%M_%S")
        except Exception:
            et_formatted = f"{d_clean}_23_59_59"

    user_enc = urllib.parse.quote(username, safe="")
    pass_enc = urllib.parse.quote(password, safe="")

    return (
        f"rtsp://{user_enc}:{pass_enc}@{ip}:554/cam/playback?"
        f"channel={channel}&starttime={st_formatted}&endtime={et_formatted}"
    )
