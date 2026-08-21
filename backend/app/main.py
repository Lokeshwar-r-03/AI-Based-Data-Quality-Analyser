import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import Base, engine
from app.api import upload, analysis, findings, report, auth, users
from app.services.gemini_service import check_ai_connectivity

# Generate SQLite Database schemas on launch
def upgrade_db_schema():
    from sqlalchemy import text
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE datasets ADD COLUMN user_id VARCHAR(36)"))
        except Exception:
            pass  # Column already exists
        
        columns_to_add = [
            ("user_id", "VARCHAR(36)"),
            ("filename", "VARCHAR(255)"),
            ("uploaded_at", "DATETIME"),
            ("rows", "INTEGER"),
            ("columns", "INTEGER"),
            ("health_index_before", "FLOAT"),
            ("health_index_after", "FLOAT"),
            ("issue_count", "INTEGER"),
            ("processing_time_seconds", "FLOAT"),
            ("result_json", "JSON"),
        ]
        for col_name, col_type in columns_to_add:
            try:
                conn.execute(text(f"ALTER TABLE analyses ADD COLUMN {col_name} {col_type}"))
            except Exception:
                pass  # Column already exists

        # Alter findings table to add AI columns
        findings_cols = [
            ("ai_explanation", "VARCHAR(1000)"),
            ("ai_recommended_action", "VARCHAR(100)"),
            ("ai_resolution", "VARCHAR(1000)"),
        ]
        for col_name, col_type in findings_cols:
            try:
                conn.execute(text(f"ALTER TABLE findings ADD COLUMN {col_name} {col_type}"))
            except Exception:
                pass  # Column already exists

        # Alter users table to add per-user threshold columns and email/password credentials
        user_cols = [
            ("auto_threshold", "FLOAT"),
            ("review_threshold", "FLOAT"),
            ("auth_provider", "VARCHAR(50) DEFAULT 'google'"),
            ("password_hash", "VARCHAR(255)"),
        ]
        for col_name, col_type in user_cols:
            try:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"))
            except Exception:
                pass  # Column already exists

upgrade_db_schema()
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="DataSetIQ API",
    description="AI-Assisted, Context-Aware Data Quality Analysis Platform Backend",
    version="1.0.0"
)

# Configure CORS Middleware using settings origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=['https://ai-based-data-quality-analyser-e8wvyetcx.vercel.app/'],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(upload.router)
app.include_router(analysis.router)
app.include_router(findings.router)
app.include_router(report.router)
app.include_router(users.router)

@app.get("/")
def root():
    return {"message": "AI-Based Data Quality Analyser API", "docs": "/docs"}

@app.get("/api/health")
def health_check():
    # Verify AI connectivity status
    ai_ok = check_ai_connectivity()
    return {
        "status": "ok",
        "ai_available": ai_ok
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
