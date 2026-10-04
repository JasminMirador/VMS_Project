import os
# Permanently remove any system-level blocks on the GPU
os.environ.pop("CUDA_VISIBLE_DEVICES", None)

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
