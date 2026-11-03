from datetime import datetime, timezone
from app.core.database import mongo_client
import os
import asyncio

MONGO_URI = os.environ.get("MONGO_URI")
mongo_client = mongo_client
db = mongo_client[os.environ.get("MONGO_DB_NAME")] if mongo_client else None
terminal_logs_col = db["terminal_logs"] if db is not None else None

def log_terminal(user_email, user_role, command, project_folder, exit_code=0, output=""):
    try:
        doc = {
            "user_email": user_email,
            "user_role": user_role,
            "command": command,
            "project_folder": project_folder,
            "exit_code": exit_code,
            "output_snippet": output[:500],
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        if terminal_logs_col is not None:
            terminal_logs_col.insert_one(doc)

    except Exception as e:
        import sys
        sys.__stdout__.write(f"Terminal log failed: {e}\n")