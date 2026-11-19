"""
Storage Audit Worker
====================
Periodically scans MongoDB `recordings` and `event_clips` collections
and soft-deletes documents whose backing files have been deleted from
MinIO or from the local filesystem.

Only audits recordings on or after AUDIT_FROM_DATE.
You can adjust AUDIT_FROM_DATE to any date you want to start monitoring from.

Soft-deleted records use the same pattern as cameras:
  - is_deleted: True
  - deleted_at: <timestamp>
  - deleted_by: "storage_audit"

This allows users to restore recordings from the recycle bin if needed.
"""

import asyncio
import os
import time
from datetime import datetime, timezone, timedelta

from app.core.database import db as _db

# ─────────────────────────────────────────────
# CONFIGURATION — adjust these as needed
# ─────────────────────────────────────────────

AUDIT_INTERVAL_SECONDS = 5  # Run every 36000===1 hour (change to 60 for testing)

# Only audit recordings on or after this date (YYYY-MM-DD).
# "yesterday" means the date 1 day before today in UTC.
# You can also hardcode a specific date like: AUDIT_FROM_DATE = "2026-07-26"
AUDIT_FROM_DATE = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")

# ─────────────────────────────────────────────


def _file_exists(file_path: str) -> bool:
    """
    Check whether a recording file still exists.
    Handles both MinIO (`minio:some/key.enc`) and local paths.
    Returns True on any error (fail-safe — never delete blindly).
    """
    if not file_path:
        return False

    if file_path.startswith("minio:"):
        minio_key = file_path.replace("minio:", "", 1)
        try:
            from app.utils.minio_client import object_exists
            return object_exists(minio_key)
        except Exception as e:
            print(f"[STORAGE-AUDIT]  MinIO check failed for {minio_key}: {e}")
            return True  # Assume exists on error — don't delete blindly

    # Local filesystem
    return os.path.exists(file_path)


def _audit_collection(col_name: str, path_field: str = "file_path") -> int:
    """
    Scan a single MongoDB collection and soft-delete docs whose file is missing.
    Only processes recordings whose `date` field >= AUDIT_FROM_DATE.
    Returns count of soft-deleted documents.
    """
    col = _db[col_name]
    if col is None:
        print(f"[STORAGE-AUDIT]  Collection '{col_name}' not available — skipping.")
        return 0

    cleaned = 0
    skip = 0

    while True:
        docs = list(
            col.find(
                {
                    path_field: {"$exists": True},
                    "is_deleted": {"$ne": True},
                    # Only look at recordings from AUDIT_FROM_DATE onwards
                    "date": {"$gte": AUDIT_FROM_DATE},
                },
                {"_id": 1, path_field: 1, "camera_id": 1, "date": 1},
            )
            .skip(skip)
            .limit(500)
        )

        if not docs:
            break

        for doc in docs:
            fp = doc.get(path_field, "")
            if not fp:
                continue

            if not _file_exists(fp):
                cam  = doc.get("camera_id", "?")
                date = doc.get("date", "?")
                try:
                    now = datetime.now(timezone.utc)
                    col.update_one(
                        {"_id": doc["_id"]},
                        {"$set": {
                            "is_deleted": True,
                            "deleted_at": now,
                            "deleted_by": "storage_audit",
                        }}
                    )
                    cleaned += 1
                    print(f"[STORAGE-AUDIT] 🗑 Soft-deleted from '{col_name}': cam={cam} date={date} | {fp}")
                except Exception as e:
                    print(f"[STORAGE-AUDIT]  Failed to soft-delete doc {doc['_id']}: {e}")

        skip += 500

    return cleaned


async def start_storage_audit():
    """Long-running async loop that audits storage every AUDIT_INTERVAL_SECONDS."""
    print(f"[STORAGE-AUDIT] ✅ Storage Audit Worker started (interval={AUDIT_INTERVAL_SECONDS}s)")
    print(f"[STORAGE-AUDIT] 📅 Monitoring recordings from date: {AUDIT_FROM_DATE} onwards")

    # Wait 30s on startup so other services can initialize
    await asyncio.sleep(30)

    while True:
        try:
            t0 = time.time()
            print(f"[STORAGE-AUDIT] 🔍 Starting audit at {datetime.now(timezone.utc).isoformat()}")

            total_cleaned = 0
            total_cleaned += _audit_collection("recordings", "file_path")
            total_cleaned += _audit_collection("event_clips", "file_path")

            elapsed = round(time.time() - t0, 1)
            print(f"[STORAGE-AUDIT] ✅ Audit complete in {elapsed}s — soft-deleted {total_cleaned} ghost record(s).")

        except Exception as e:
            print(f"[STORAGE-AUDIT] ❌ Audit error: {e}")

        await asyncio.sleep(AUDIT_INTERVAL_SECONDS)
