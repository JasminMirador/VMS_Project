from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from app.config import settings
from app.db.mongo import connect_to_mongo, close_mongo_connection
from app.api.routes import router as synopsis_router

@asynccontextmanager
async def lifespan(app: FastAPI):
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
