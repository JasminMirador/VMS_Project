import os
import urllib.parse
from pathlib import Path

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

# Script lives in onvif-backend/, so parent.parent is VMS_Project (where .env is)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

def backfill():
    client = MongoClient(os.environ["MONGO_URI"])
    db = client[os.environ["MONGO_DB_NAME"]]
    cameras = list(db.cameras.find({}))
    updated = 0
    for cam in cameras:
        if "sub_stream_key" in cam and cam["sub_stream_key"]:
            continue
        
        # Look for SUB profile
        profiles = cam.get("stream_profiles", [])
        sub_profile = next(
            (p for p in profiles if (p.get("label") or "").upper() == "SUB" and p.get("rtsp_url")),
            None
        )
        if sub_profile:
            sub_stream_rtsp = sub_profile["rtsp_url"]
            # Inject credentials if needed
            username = cam.get("username")
            password = cam.get("password")
            if username:
                try:
                    parsed_sub = urllib.parse.urlparse(sub_stream_rtsp)
                    if not parsed_sub.username:
                        user_enc = urllib.parse.quote(username.strip(), safe='')
                        pass_enc = urllib.parse.quote(password.strip(), safe='')
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
            
            sub_key = f"{cam.get('stream_key')}_sub"
            
            print(f"Updating {cam['ip']} with sub_stream_rtsp: {sub_stream_rtsp}")
            
            db.cameras.update_one(
                {"_id": cam["_id"]},
                {"$set": {
                    "sub_stream_rtsp": sub_stream_rtsp,
                    "sub_stream_key": sub_key
                }}
            )
            updated += 1
            
            # Also register the sub stream in MediaMTX right now so we don't have to wait for a restart
            payload = {
                "source": sub_stream_rtsp,
                "sourceOnDemand": False
            }
            try:
                sub_res = requests.post(
                    f"{os.environ['MEDIAMTX_API_URL']}/v3/config/paths/add/{sub_key}",
                    json=payload,
                    timeout=5
                )
                print(f"MediaMTX registration for {sub_key}: {sub_res.status_code}")
            except Exception as e:
                print(f"Error registering MediaMTX path: {e}")

    print(f"Backfilled {updated} cameras.")

if __name__ == "__main__":
    backfill()
