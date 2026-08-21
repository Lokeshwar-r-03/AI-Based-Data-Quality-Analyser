import os
from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.6-flash"
    AI_API_KEY: str = ""
    AI_MODEL: str = ""
    MAX_UPLOAD_MB: int = 25
    MAX_ROWS: int = 50000
    ALLOWED_EXTENSIONS: str = ".csv,.xlsx"
    DATABASE_URL: str = "sqlite:///./DataSetIQ.db"
    CORS_ORIGINS: str = "http://localhost:5173"
    LOG_LEVEL: str = "info"

    def model_post_init(self, __context):
        if not self.AI_API_KEY and self.GEMINI_API_KEY:
            self.AI_API_KEY = self.GEMINI_API_KEY
        if not self.AI_MODEL:
            self.AI_MODEL = self.GEMINI_MODEL or "gemini-2.5-flash"
    
    # Google OAuth & JWT
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = ""
    JWT_SECRET: str = ""
    FRONTEND_URL: str = "http://localhost:5173"
    
    # SMTP configuration for Password Reset
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    RESET_LINK_BASE_URL: str = "http://localhost:5173/reset-password"
    
    # Weights and thresholds
    CONFIDENCE_WEIGHT_STAT: float = 0.3
    CONFIDENCE_WEIGHT_ML: float = 0.3
    CONFIDENCE_WEIGHT_RULE: float = 0.4
    CONFIDENCE_THRESHOLD_AUTO: float = 0.85
    CONFIDENCE_THRESHOLD_REVIEW: float = 0.40

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()

# Startup validation to enforce presence of OAuth/JWT env vars
if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET or not settings.GOOGLE_REDIRECT_URI or not settings.JWT_SECRET:
    import sys
    sys.stderr.write("CRITICAL CONFIGURATION ERROR: Missing Google OAuth/JWT configuration environment variables in .env!\n")
    sys.exit(1)
