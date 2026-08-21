import os
import uuid
import datetime
import pandas as pd
from typing import Optional, List
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db, SessionLocal
from app.models.models import Dataset, Analysis, Finding, AuditLog, User
from app.schemas.schemas import ProfileResponse, AnalysisStartResponse, AnalysisStatusResponse, BeforeAfterResponse, QualityMetrics
from app.services.profiling import profile_dataframe
from app.services.preprocessing import preprocess_dataframe
from app.services.detection import run_detection
from app.services.rules import run_contextual_validation  # still used in initial rules pass (Stage 3)
from app.services.confidence import calculate_confidence
from app.services.gemini_service import interpret_findings
from app.services.action_engine import clean_dataset
from app.services.validation import compute_quality_metrics
from app.api.auth import get_current_user, get_current_user_optional

router = APIRouter(prefix="/api", tags=["analysis"])

@router.get("/datasets/{dataset_id}/profile", response_model=ProfileResponse)
def get_dataset_profile(
    dataset_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
        
    if dataset.user_id is not None:
        if not current_user or dataset.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this dataset")
        
    ext = os.path.splitext(dataset.file_path)[1].lower()
    try:
        if ext == ".csv":
            df = pd.read_csv(dataset.file_path)
        else:
            df = pd.read_excel(dataset.file_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read dataset file: {str(e)}")
        
    profiles = profile_dataframe(df)
    return {"columns": profiles}

# Background Pipeline Task
def run_analysis_pipeline(analysis_id: str, dataset_id: str):
    db = SessionLocal()
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    
    if not analysis or not dataset:
        db.close()
        return
        
    try:
        # Load raw data
        ext = os.path.splitext(dataset.file_path)[1].lower()
        if ext == ".csv":
            df = pd.read_csv(dataset.file_path)
        else:
            df = pd.read_excel(dataset.file_path)
            
        fingerprint = dataset.schema_fingerprint or {}
        
        # Stage 1: Preprocessing
        analysis.status = "running"
        analysis.before_metrics = {"current_stage": "preprocessing"}
        db.commit()
        df_preprocessed = preprocess_dataframe(df, fingerprint)
        
        # Stage 2: Detection
        analysis.before_metrics = {"current_stage": "detecting"}
        db.commit()
        findings_raw = run_detection(df_preprocessed)
        
        # Stage 3: Contextual Rules
        analysis.before_metrics = {"current_stage": "rules"}
        db.commit()
        contextual_findings = run_contextual_validation(df_preprocessed, fingerprint, findings_raw)
        findings_raw.extend(contextual_findings)
        
        # Instantiating Finding object instances with temporary UUIDs
        findings = []
        for f in findings_raw:
            f["id"] = str(uuid.uuid4())
            findings.append(f)
            
        # Stage 4: Confidence Scoring
        analysis.before_metrics = {"current_stage": "scoring"}
        db.commit()
        for f in findings:
            f["confidence"] = calculate_confidence(
                stat_score=f.get("stat_score", 0.0),
                ml_score=f.get("ml_score", 0.0),
                rule_score=f.get("rule_score", 0.0),
                rule_violation=f.get("rule_violation", False)
            )
            
        # Stage 5: AI Interpretation (Gemini)
        analysis.before_metrics = {"current_stage": "interpreting"}
        db.commit()
        
        # Call AI interpreter (it has built-in mocks if credentials are empty or 'mock')
        ai_results = interpret_findings(findings, use_mock=False)
        ai_map = {res["finding_id"]: res for res in ai_results if "finding_id" in res}
        
        for f in findings:
            fid = f["id"]
            if fid in ai_map:
                f["ai_explanation"] = ai_map[fid].get("explanation")
                f["ai_recommended_action"] = ai_map[fid].get("recommended_action")
                f["ai_resolution"] = ai_map[fid].get("resolution_suggestion")
            else:
                f["ai_explanation"] = None
                f["ai_recommended_action"] = None
                f["ai_resolution"] = None

        # Stage 6: Cleaning/Fix execution
        analysis.before_metrics = {"current_stage": "cleaning"}
        db.commit()

        # Load per-user thresholds if the analysis belongs to a signed-in user
        user_auto_threshold = None
        user_review_threshold = None
        if analysis.user_id:
            owner = db.query(User).filter(User.id == analysis.user_id).first()
            if owner:
                user_auto_threshold = owner.auto_threshold
                user_review_threshold = owner.review_threshold

        df_cleaned, audit_logs_raw = clean_dataset(
            df_preprocessed, findings, fingerprint,
            auto_threshold=user_auto_threshold,
            review_threshold=user_review_threshold
        )
        
        # Save cleaned file
        cleaned_filename = f"{analysis_id}_cleaned{ext}"
        cleaned_dir = os.path.dirname(dataset.file_path)
        cleaned_path = os.path.join(cleaned_dir, cleaned_filename)
        
        if ext == ".csv":
            df_cleaned.to_csv(cleaned_path, index=False)
        else:
            df_cleaned.to_excel(cleaned_path, index=False)

        # Stage 7: Validation (Before/After analysis)
        analysis.before_metrics = {"current_stage": "validating"}
        db.commit()
        
        # Derive "after" metrics without re-running the expensive full ML detection pass.
        # Auto-applied fixes have already been committed to df_cleaned; findings that were
        # not auto-applied (pending_review / reviewed_no_action) still exist in the dataset.
        # We pass only the non-auto-applied findings so the quality scorer reflects what
        # remains unresolved in the cleaned file.
        after_findings_for_metrics = [
            f for f in findings if f.get("status") != "auto_applied"
        ]
        
        before_stats = compute_quality_metrics(df_preprocessed, findings, is_after=False)
        after_stats = compute_quality_metrics(df_cleaned, after_findings_for_metrics, is_after=True)
        
        # Write Findings and Audit Logs — add all to session then flush+commit once.
        # bulk_save_objects triggers lazy-load of ORM relationships which fails in
        # background threads (MissingGreenlet). A single-commit add-loop is safe and fast.
        for f in findings:
            db.add(Finding(
                id=f["id"],
                analysis_id=analysis_id,
                row_index=f["row_index"],
                column=f["column"],
                issue_type=f["issue_type"],
                stat_score=f.get("stat_score", 0.0),
                ml_score=f.get("ml_score", 0.0),
                rule_score=f.get("rule_score", 0.0),
                rule_violation=f.get("rule_violation", False),
                confidence=f.get("confidence", 0.0),
                status=f.get("status", "pending_review"),
                ai_explanation=f.get("ai_explanation"),
                ai_recommended_action=f.get("ai_recommended_action"),
                ai_resolution=f.get("ai_resolution"),
                action_taken=f.get("action_taken"),
                reasoning=f.get("reasoning"),
                before_value=str(f.get("before_value", "")) if f.get("before_value") is not None else "",
                after_value=str(f.get("after_value", "")) if f.get("after_value") is not None else ""
            ))
            db.add(AuditLog(
                finding_id=f["id"],
                action_taken=f.get("action_taken", "keep_no_action"),
                reasoning=f.get("reasoning", ""),
                changed_by="system",
                before_value=str(f.get("before_value", "")) if f.get("before_value") is not None else "",
                after_value=str(f.get("after_value", "")) if f.get("after_value") is not None else ""
            ))

        # Flush all pending inserts in one batch, then mark analysis complete
        db.flush()

        completed_time = datetime.datetime.utcnow()
        analysis.filename = dataset.filename
        analysis.uploaded_at = dataset.uploaded_at
        analysis.rows = dataset.row_count
        analysis.columns = dataset.column_count
        analysis.health_index_before = before_stats.get("quality_score", 0.0)
        analysis.health_index_after = after_stats.get("quality_score", 0.0)
        analysis.issue_count = len(findings)
        analysis.processing_time_seconds = (completed_time - analysis.started_at).total_seconds()

        # Only mark completed AFTER all data is written — one atomic final commit
        analysis.before_metrics = before_stats
        analysis.after_metrics = after_stats
        analysis.status = "completed"
        analysis.completed_at = completed_time
        db.commit()
        
    except Exception as e:
        db.rollback()
        try:
            analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
            if analysis:
                analysis.status = "failed"
                analysis.before_metrics = {"error": str(e), "current_stage": "failed"}
                db.commit()
        except Exception as rollback_err:
            import logging
            logger = logging.getLogger("app.api.analysis")
            logger.error(f"Failed to commit error status to database: {rollback_err}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

@router.post("/datasets/{dataset_id}/analyses", response_model=AnalysisStartResponse)
def start_analysis(
    dataset_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
        
    if dataset.user_id is not None:
        if not current_user or dataset.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this dataset")
        
    if dataset.row_count > settings.MAX_ROWS:
        raise HTTPException(
            status_code=400,
            detail="ROW_LIMIT_EXCEEDED"
        )
        
    analysis_id = str(uuid.uuid4())
    
    # Initialize analysis run record
    analysis = Analysis(
        id=analysis_id,
        dataset_id=dataset_id,
        user_id=current_user.id if current_user else None,
        status="queued",
        before_metrics={"current_stage": "queued"}
    )
    db.add(analysis)
    db.commit()
    
    # Queue execution
    background_tasks.add_task(run_analysis_pipeline, analysis_id, dataset_id)
    
    return {"analysis_id": analysis_id, "status": "queued"}

@router.get("/analyses/{analysis_id}", response_model=AnalysisStatusResponse)
def get_analysis_status(
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
        
    stage = "unknown"
    if analysis.status == "queued":
        stage = "queued"
    elif analysis.status == "running":
        stage = analysis.before_metrics.get("current_stage", "running") if isinstance(analysis.before_metrics, dict) else "running"
    elif analysis.status == "completed":
        stage = "complete"
    elif analysis.status == "failed":
        stage = "failed"
        
    return {"status": analysis.status, "current_stage": stage}

@router.get("/analyses/{analysis_id}/before-after", response_model=BeforeAfterResponse)
def get_before_after_metrics(
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
        
    return {
        "before": analysis.before_metrics,
        "after": analysis.after_metrics
    }

@router.get("/analyses")
def list_analyses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    analyses = db.query(Analysis).filter(
        Analysis.user_id == current_user.id
    ).order_by(Analysis.started_at.desc()).all()
    
    result = []
    for a in analyses:
        result.append({
            "id": a.id,
            "filename": a.filename or (a.dataset.filename if a.dataset else "Unknown"),
            "uploaded_at": a.uploaded_at.isoformat() if a.uploaded_at else a.started_at.isoformat(),
            "rows": a.rows or (a.dataset.row_count if a.dataset else 0),
            "columns": a.columns or (a.dataset.column_count if a.dataset else 0),
            "health_index_before": a.health_index_before or 0.0,
            "health_index_after": a.health_index_after or 0.0,
            "issue_count": a.issue_count or 0,
            "processing_time_seconds": a.processing_time_seconds or 0.0,
            "status": a.status
        })
    return result

@router.delete("/analyses/{analysis_id}")
def delete_analysis(
    analysis_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    
    if analysis.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this analysis")
        
    db.delete(analysis)
    db.commit()
    return {"message": "Analysis deleted successfully"}

@router.post("/analyses/{analysis_id}/claim")
def claim_analysis(
    analysis_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
        
    if analysis.user_id is not None:
        if analysis.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: This analysis already belongs to another user")
        return {"message": "Analysis already claimed", "analysis_id": analysis_id}
        
    analysis.user_id = current_user.id
    if analysis.dataset:
        analysis.dataset.user_id = current_user.id
        
    db.commit()
    return {"message": "Analysis claimed successfully", "analysis_id": analysis_id}

def get_cleaned_dataframe(analysis: Analysis, db: Session) -> pd.DataFrame:
    dataset = analysis.dataset
    ext = os.path.splitext(dataset.file_path)[1].lower()
    
    try:
        if ext == ".csv":
            df = pd.read_csv(dataset.file_path)
        else:
            df = pd.read_excel(dataset.file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read raw dataset: {str(e)}")
        
    applied_findings = db.query(Finding).filter(
        Finding.analysis_id == analysis.id,
        Finding.status == "auto_applied"
    ).all()
    
    # Apply drops last
    applied_findings_sorted = sorted(
        applied_findings,
        key=lambda f: 1 if f.action_taken == "drop" else 0
    )
    
    for f in applied_findings_sorted:
        if f.row_index not in df.index:
            continue
        if f.action_taken == "drop":
            df = df.drop(index=f.row_index)
        elif f.column != "ALL_COLUMNS":
            val = f.after_value
            col_dtype = df[f.column].dtype
            if val == "" or val is None or val == "None" or pd.isna(val):
                df.at[f.row_index, f.column] = np.nan
            else:
                if pd.api.types.is_numeric_dtype(col_dtype):
                    try:
                        if "." in str(val):
                            val = float(val)
                        else:
                            val = int(val)
                    except ValueError:
                        pass
                df.at[f.row_index, f.column] = val
                
    return df

@router.get("/analyses/{analysis_id}/preview")
def get_analysis_preview(
    analysis_id: str,
    page: int = 1,
    limit: int = 25,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
        
    if analysis.user_id is not None:
        if not current_user or analysis.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this analysis")

    df = get_cleaned_dataframe(analysis, db)
    columns = df.columns.tolist()
    
    # Get dropped row indices
    dropped_findings = db.query(Finding).filter(
        Finding.analysis_id == analysis_id,
        Finding.status == "auto_applied",
        Finding.action_taken == "drop"
    ).all()
    dropped_indices = {f.row_index for f in dropped_findings}
    
    original_row_count = analysis.dataset.row_count
    remaining_indices = [i for i in range(original_row_count) if i not in dropped_indices]
    
    # Map original row index to changes
    findings = db.query(Finding).filter(
        Finding.analysis_id == analysis_id,
        Finding.status == "auto_applied"
    ).all()
    changes_by_orig_row = {}
    for f in findings:
        if f.before_value != f.after_value and f.action_taken != "keep_no_action" and f.action_taken != "drop":
            if f.row_index not in changes_by_orig_row:
                changes_by_orig_row[f.row_index] = {}
            changes_by_orig_row[f.row_index][f.column] = {
                "old_value": f.before_value,
                "new_value": f.after_value,
                "method": f.action_taken,
                "issue_type": f.issue_type,
                "confidence": f.confidence
            }
            
    total_rows = len(df)
    start_pos = (page - 1) * limit
    end_pos = page * limit
    df_page = df.iloc[start_pos:end_pos]
    
    # Replace NaN/NaT/None with empty string or None for JSON serialization
    df_clean = df_page.replace({np.nan: None, pd.NaT: None})
    
    preview_rows = []
    for k, row_values in enumerate(df_clean.values):
        global_pos = start_pos + k
        orig_idx = remaining_indices[global_pos] if global_pos < len(remaining_indices) else global_pos
        row_changes = changes_by_orig_row.get(orig_idx, {})
        row_cells = []
        for col_name, val in zip(columns, row_values):
            if isinstance(val, float) and np.isnan(val):
                val = None
            cell_change = row_changes.get(col_name)
            cell_data = {
                "value": val,
                "changed": cell_change is not None
            }
            if cell_change:
                cell_data.update(cell_change)
            row_cells.append(cell_data)
        preview_rows.append({
            "row_index": orig_idx,
            "cells": row_cells
        })
        
    return {
        "columns": columns,
        "rows": preview_rows,
        "total_rows": total_rows,
        "page": page,
        "limit": limit
    }

@router.get("/analyses/{analysis_id}/imputation-previews")
def get_imputation_previews(
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

    dataset = analysis.dataset
    ext = os.path.splitext(dataset.file_path)[1].lower()
    cleaned_path = os.path.join(os.path.dirname(dataset.file_path), f"{analysis_id}_cleaned{ext}")
    
    if not os.path.exists(cleaned_path):
        # Fall back to original file if cleaned does not exist yet
        cleaned_path = dataset.file_path
        
    try:
        if ext == ".csv":
            df = pd.read_csv(cleaned_path)
        else:
            df = pd.read_excel(cleaned_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {str(e)}")
        
    previews = {}
    for col in df.columns:
        col_previews = {}
        non_null = df[col].dropna()
        if non_null.empty:
            previews[col] = {"mode": None}
            if pd.api.types.is_numeric_dtype(df[col]):
                previews[col].update({"mean": None, "median": None})
            continue
            
        # Mode
        mode_series = non_null.mode()
        if not mode_series.empty:
            mode_val = mode_series.iloc[0]
            if isinstance(mode_val, (pd.Timestamp, np.datetime64)):
                mode_val = str(mode_val)
            elif isinstance(mode_val, float) and np.isnan(mode_val):
                mode_val = None
            col_previews["mode"] = mode_val
        else:
            col_previews["mode"] = None
            
        # Mean/Median only for numeric
        if pd.api.types.is_numeric_dtype(df[col]):
            col_previews["mean"] = float(round(non_null.mean(), 4))
            col_previews["median"] = float(round(non_null.median(), 4))
            
        previews[col] = col_previews
        
    return previews
