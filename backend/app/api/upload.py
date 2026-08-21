import os
import uuid
import pandas as pd
from typing import Optional
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.models.models import Dataset, User
from app.schemas.schemas import DatasetResponse, DatasetPreviewResponse
from app.services.fingerprint import detect_domain
from app.api.auth import get_current_user_optional

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

# Configure relative uploads path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("", response_model=DatasetResponse)
async def upload_dataset(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    filename = file.filename
    ext = os.path.splitext(filename)[1].lower()
    
    # 1. File Type Validation
    allowed_exts = [e.strip() for e in settings.ALLOWED_EXTENSIONS.split(",") if e.strip()]
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Allowed: {settings.ALLOWED_EXTENSIONS}"
        )
        
    dataset_id = str(uuid.uuid4())
    save_path = os.path.join(UPLOAD_DIR, f"{dataset_id}{ext}")
    
    # 2. Upload size verification
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    total_bytes = 0
    
    try:
        with open(save_path, "wb") as buffer:
            while chunk := await file.read(1024 * 64):
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds maximum allowed upload size of {settings.MAX_UPLOAD_MB}MB"
                    )
                buffer.write(chunk)
    except Exception as e:
        if os.path.exists(save_path):
            os.remove(save_path)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {str(e)}")
        
    # 3. Read dataset metadata using pandas
    try:
        if ext == ".csv":
            df = pd.read_csv(save_path)
        else:
            df = pd.read_excel(save_path)
    except Exception as e:
        if os.path.exists(save_path):
            os.remove(save_path)
        raise HTTPException(status_code=400, detail=f"Invalid file format: {str(e)}")

    row_count = len(df)
    column_count = len(df.columns)
    row_cap_exceeded = row_count > settings.MAX_ROWS
    
    # 5. Schema fingerprinting
    fingerprint = detect_domain(df.columns.tolist())
    
    # 6. Database record persistence
    db_dataset = Dataset(
        id=dataset_id,
        user_id=current_user.id if current_user else None,
        filename=filename,
        row_count=row_count,
        column_count=column_count,
        schema_fingerprint=fingerprint,
        file_path=save_path
    )
    db.add(db_dataset)
    db.commit()
    db.refresh(db_dataset)
    
    return {
        "dataset_id": db_dataset.id,
        "filename": db_dataset.filename,
        "row_count": db_dataset.row_count,
        "column_count": db_dataset.column_count,
        "schema_fingerprint": db_dataset.schema_fingerprint,
        "row_cap_exceeded": row_cap_exceeded
    }

@router.post("/sample", response_model=DatasetResponse)
def load_sample_dataset(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    sample_filename = "shopify_orders_corrupted.csv"
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sample_path = os.path.join(base_dir, "sample_data", sample_filename)
    
    if not os.path.exists(sample_path):
        # Try one level up (parent of backend folder)
        sample_path = os.path.join(os.path.dirname(base_dir), "sample_data", sample_filename)
        
    if not os.path.exists(sample_path):
        raise HTTPException(status_code=404, detail=f"Sample dataset file not found at {sample_path}")
        
    dataset_id = str(uuid.uuid4())
    ext = ".csv"
    save_path = os.path.join(UPLOAD_DIR, f"{dataset_id}{ext}")
    
    try:
        import shutil
        shutil.copyfile(sample_path, save_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to copy sample dataset: {str(e)}")
        
    try:
        df = pd.read_csv(save_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read sample dataset: {str(e)}")
        
    row_count = len(df)
    column_count = len(df.columns)
    row_cap_exceeded = row_count > settings.MAX_ROWS
        
    fingerprint = detect_domain(df.columns.tolist())
    
    db_dataset = Dataset(
        id=dataset_id,
        user_id=current_user.id if current_user else None,
        filename=sample_filename,
        row_count=row_count,
        column_count=column_count,
        schema_fingerprint=fingerprint,
        file_path=save_path
    )
    db.add(db_dataset)
    db.commit()
    db.refresh(db_dataset)
    
    return {
        "dataset_id": db_dataset.id,
        "filename": db_dataset.filename,
        "row_count": db_dataset.row_count,
        "column_count": db_dataset.column_count,
        "schema_fingerprint": db_dataset.schema_fingerprint,
        "row_cap_exceeded": row_cap_exceeded
    }

@router.get("/{dataset_id}/preview", response_model=DatasetPreviewResponse)
def get_dataset_preview(
    dataset_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    db_dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not db_dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
        
    if db_dataset.user_id is not None:
        if not current_user or db_dataset.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this dataset")

    if not os.path.exists(db_dataset.file_path):
        raise HTTPException(status_code=404, detail="Dataset file not found")
        
    ext = os.path.splitext(db_dataset.file_path)[1].lower()
    try:
        if ext == ".csv":
            df = pd.read_csv(db_dataset.file_path, nrows=5)
        else:
            df = pd.read_excel(db_dataset.file_path, nrows=5)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read dataset preview: {str(e)}")
        
    cols = df.columns.tolist()[:6]
    df_limited = df[cols].fillna("")
    
    preview_rows = df_limited.values.tolist()
    
    return {
        "columns": cols,
        "rows": preview_rows
    }
