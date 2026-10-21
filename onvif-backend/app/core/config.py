from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# config.py is at VMS_Project/onvif-backend/app/core/, so parents[3] is VMS_Project
_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    MONGO_URI: str
    MINIO_ENDPOINT: str
    MINIO_ACCESS_KEY: str = ""
    MINIO_SECRET_KEY: str = ""
    MEDIAMTX_API: str = Field(validation_alias="MEDIAMTX_API_URL")
    JWT_SECRET: str = ""
    RECAPTCHA_SECRET_KEY: str = ""


settings = Settings()