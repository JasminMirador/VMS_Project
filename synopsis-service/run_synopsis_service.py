import os
import sys

# Permanently remove any system-level blocks on the GPU
os.environ.pop("CUDA_VISIBLE_DEVICES", None)

# Fix for Windows asyncio ConnectionResetError (WinError 10054) on browser disconnect during video streaming
if sys.platform == "win32":
    try:
        from asyncio.proactor_events import _ProactorBasePipeTransport
        _orig_call_connection_lost = _ProactorBasePipeTransport._call_connection_lost
        def _silenced_call_connection_lost(self, exc):
            try:
                _orig_call_connection_lost(self, exc)
            except (ConnectionResetError, ConnectionAbortedError):
                pass
            except OSError as e:
                if getattr(e, 'winerror', None) in (10054, 10053):
                    pass
                else:
                    raise
        _ProactorBasePipeTransport._call_connection_lost = _silenced_call_connection_lost
    except Exception:
        pass

import uvicorn
import logging
from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("synopsis-service")

if __name__ == "__main__":
    logger.info(f"Starting {settings.PROJECT_NAME} on port {settings.PORT}...")
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False
    )

