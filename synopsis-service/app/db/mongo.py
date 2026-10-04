from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings
import logging

logger = logging.getLogger(__name__)

class MongoManager:
    client: AsyncIOMotorClient = None

db_manager = MongoManager()

async def connect_to_mongo():
    logger.info(f"Connecting to MongoDB at: {settings.MONGO_URI}")
    db_manager.client = AsyncIOMotorClient(settings.MONGO_URI)
    logger.info("Connected to MongoDB successfully.")

async def close_mongo_connection():
    if db_manager.client:
        db_manager.client.close()
        logger.info("MongoDB connection closed.")

def get_database():
    return db_manager.client[settings.DB_NAME]
