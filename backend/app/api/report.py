import os
import pandas as pd
import tempfile
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.models import Analysis, Finding, AuditLog, User
from app.schemas.schemas import ReportResponse
from app.services.action_engine import apply_finding_fix, get_default_action
from app.api.auth import get_current_user_optional

router = APIRouter(prefix="/api/analyses", tags=["report"])

@router.get("/{analysis_id}/report", response_model=ReportResponse)
def get_analysis_report(
    analysis_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
        
    if analysis.user_id is not None:
        if not current_user or analysis.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this analysis")

    if analysis.status != "completed":
        raise HTTPException(status_code=400, detail="Analysis is not completed yet")
        
    dataset = analysis.dataset
    
    # Fetch findings to get audit logs
    findings = db.query(Finding).filter(Finding.analysis_id == analysis_id).all()
    finding_ids = [f.id for f in findings]
    
    # Fetch chronological logs of fixes
    audit_logs = []
    if finding_ids:
        audit_logs = db.query(AuditLog).filter(
            AuditLog.finding_id.in_(finding_ids)
        ).order_by(AuditLog.applied_at.asc()).all()
    
    return {
        "analysis_id": analysis.id,
        "dataset_id": dataset.id,
        "filename": dataset.filename,
        "quality_score_before": analysis.before_metrics.get("quality_score", 0.0) if isinstance(analysis.before_metrics, dict) else 0.0,
        "quality_score_after": analysis.after_metrics.get("quality_score", 0.0) if isinstance(analysis.after_metrics, dict) else 0.0,
        "before_metrics": analysis.before_metrics,
        "after_metrics": analysis.after_metrics,
        "audit_log": audit_logs
    }

@router.get("/{analysis_id}/download")
def download_cleaned_dataset(
    analysis_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
        
    if analysis.user_id is not None:
        if not current_user or analysis.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this analysis")
        
    if analysis.status != "completed":
        raise HTTPException(status_code=400, detail="Analysis is not completed yet")
        
    # Check for unresolved missing values
    unresolved_missing = db.query(Finding).filter(
        Finding.analysis_id == analysis_id,
        Finding.issue_type == "missing_value",
        Finding.status == "pending_review"
    ).count()
    if unresolved_missing > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"{unresolved_missing} missing values are still unresolved before you can export."
        )
        
    dataset = analysis.dataset
    ext = os.path.splitext(dataset.file_path)[1].lower()
    cleaned_path = os.path.join(os.path.dirname(dataset.file_path), f"{analysis_id}_cleaned{ext}")
    
    # Reconstruct live cleaned dataframe at the moment of download
    try:
        from app.api.analysis import get_cleaned_dataframe
        df_cleaned = get_cleaned_dataframe(analysis, db)
        if ext == ".csv":
            df_cleaned.to_csv(cleaned_path, index=False)
        else:
            df_cleaned.to_excel(cleaned_path, index=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate cleaned dataset: {str(e)}")
        
    cleaned_filename = f"cleaned_{dataset.filename}"
    media_type = "text/csv" if ext == ".csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    
    return FileResponse(
        path=cleaned_path,
        filename=cleaned_filename,
        media_type=media_type
    )

@router.get("/{analysis_id}/dataset")
def download_cleaned_dataset_auto_applied(
    analysis_id: str, 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
        
    if analysis.user_id is not None:
        if not current_user or analysis.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this analysis")

    if analysis.status != "completed":
        raise HTTPException(status_code=400, detail="Analysis is not completed yet")
        
    dataset = analysis.dataset
    ext = os.path.splitext(dataset.file_path)[1].lower()
    
    try:
        from app.api.analysis import get_cleaned_dataframe
        df_cleaned = get_cleaned_dataframe(analysis, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate cleaned dataset: {str(e)}")
        
    # Write to a temporary file
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    temp_path = temp_file.name
    temp_file.close()
    
    if ext == ".csv":
        df_cleaned.to_csv(temp_path, index=False)
    else:
        df_cleaned.to_excel(temp_path, index=False)
        
    cleaned_filename = f"auto_cleaned_{dataset.filename}"
    media_type = "text/csv" if ext == ".csv" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    
    # Delete temp file after the request is finished
    background_tasks.add_task(os.unlink, temp_path)
    
    return FileResponse(
        path=temp_path,
        filename=cleaned_filename,
        media_type=media_type
    )

@router.get("/{analysis_id}/export")
def export_cleaned_dataset(
    analysis_id: str,
    format: str = "csv",
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = None,
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
        
    if analysis.user_id is not None:
        if not current_user or analysis.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this analysis")

    if analysis.status != "completed":
        raise HTTPException(status_code=400, detail="Analysis is not completed yet")
        
    # Check for unresolved missing values
    unresolved_missing = db.query(Finding).filter(
        Finding.analysis_id == analysis_id,
        Finding.issue_type == "missing_value",
        Finding.status == "pending_review"
    ).count()
    if unresolved_missing > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"{unresolved_missing} missing values are still unresolved before you can export."
        )
        
    dataset = analysis.dataset
    ext = os.path.splitext(dataset.file_path)[1].lower()
    cleaned_path = os.path.join(os.path.dirname(dataset.file_path), f"{analysis_id}_cleaned{ext}")
    
    if not os.path.exists(cleaned_path):
        raise HTTPException(status_code=404, detail="Cleaned dataset file does not exist")
        
    try:
        if ext == ".csv":
            df = pd.read_csv(cleaned_path)
        else:
            df = pd.read_excel(cleaned_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read cleaned dataset: {str(e)}")
        
    fmt = format.lower().strip()
    
    # Create a temporary file
    if fmt == "excel":
        suffix = ".xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif fmt == "json":
        suffix = ".json"
        media_type = "application/json"
    else:
        suffix = ".csv"
        media_type = "text/csv"
        
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temp_path = temp_file.name
    temp_file.close()
    
    try:
        if fmt == "excel":
            df.to_excel(temp_path, index=False)
            filename = f"cleaned_{os.path.splitext(dataset.filename)[0]}.xlsx"
        elif fmt == "json":
            df.to_json(temp_path, orient="records", indent=2)
            filename = f"cleaned_{os.path.splitext(dataset.filename)[0]}.json"
        else:
            df.to_csv(temp_path, index=False)
            filename = f"cleaned_{os.path.splitext(dataset.filename)[0]}.csv"
    except Exception as e:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise HTTPException(status_code=500, detail=f"Failed to generate export file: {str(e)}")
        
    if background_tasks:
        background_tasks.add_task(os.unlink, temp_path)
        
    return FileResponse(
        path=temp_path,
        filename=filename,
        media_type=media_type
    )
