from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from app.config import settings
from app.db.mongo import connect_to_mongo, close_mongo_connection
from app.api.routes import router as synopsis_router

import sys
import asyncio
from fastapi.responses import FileResponse, Response

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Silence WinError 10054 on Windows event loop for streaming sockets
    if sys.platform == "win32":
        try:
            loop = asyncio.get_running_loop()
            orig_handler = loop.get_exception_handler()
            def _silence_winerror_10054(loop, context):
                exc = context.get("exception")
                if isinstance(exc, (ConnectionResetError, ConnectionAbortedError)):
                    return
                if "10054" in str(context.get("message", "")) or "10054" in str(exc or ""):
                    return
                if orig_handler:
                    orig_handler(loop, context)
                else:
                    loop.default_exception_handler(context)
            loop.set_exception_handler(_silence_winerror_10054)
        except Exception:
            pass

    await connect_to_mongo()
    yield
    await close_mongo_connection()

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Microservice providing BriefCam-style tube packing and video synopsis rendering.",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Smart background image route: serves exact plate or falls back to any available plate for the camera
@app.get("/static/synopsis/backgrounds/{filename}")
async def get_background_image(filename: str):
    file_path = settings.BACKGROUND_DIR / filename
    if file_path.exists():
        return FileResponse(file_path, media_type="image/png")
    
    # Fallback 1: Look for any available background image for this camera
    camera_id = filename.split("_")[0] if "_" in filename else ""
    if camera_id:
        for candidate in settings.BACKGROUND_DIR.glob(f"{camera_id}_*.png"):
            if candidate.exists():
                return FileResponse(candidate, media_type="image/png")
    
    # Fallback 2: Any background image available
    for any_bg in settings.BACKGROUND_DIR.glob("*.png"):
        if any_bg.exists():
            return FileResponse(any_bg, media_type="image/png")
        
    return Response(status_code=404)

# Serve generated output synopses as static files
app.mount("/static/synopsis", StaticFiles(directory=str(settings.STORAGE_DIR)), name="synopsis_static")

# Include API Router
app.include_router(synopsis_router)

@app.get("/")
async def root():
    return {
        "service": settings.PROJECT_NAME,
        "status": "running",
        "device": settings.DEVICE,
        "port": settings.PORT
    }
