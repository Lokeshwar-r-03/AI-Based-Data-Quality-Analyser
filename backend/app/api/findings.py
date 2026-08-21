import os
import datetime
import pandas as pd
from typing import Optional
from pydantic import BaseModel
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.models.models import Analysis, Finding, AuditLog, Dataset, User
from app.schemas.schemas import FindingResponse, FindingListResponse
from app.services.action_engine import apply_finding_fix, get_default_action
from app.services.detection import run_detection
from app.services.rules import run_contextual_validation
from app.services.validation import compute_quality_metrics
from app.api.auth import get_current_user_optional
from app.api.analysis import get_cleaned_dataframe

router = APIRouter(prefix="/api", tags=["findings"])

def recompute_and_update_metrics(analysis: Analysis, db: Session):
    """
    Helper function to re-run detection on the cleaned dataset, re-calculate
    post-cleaning quality metrics, and update the Analysis entry in the database.
    """
    dataset = analysis.dataset
    ext = os.path.splitext(dataset.file_path)[1].lower()
    cleaned_path = os.path.join(os.path.dirname(dataset.file_path), f"{analysis.id}_cleaned{ext}")
    
    if not os.path.exists(cleaned_path):
        return
        
    try:
        if ext == ".csv":
            df_cleaned = pd.read_csv(cleaned_path)
        else:
            df_cleaned = pd.read_excel(cleaned_path)
            
        fingerprint = dataset.schema_fingerprint or {}
        
        # Re-run detection on the current cleaned dataset state
        after_findings = run_detection(df_cleaned)
        after_contextual = run_contextual_validation(df_cleaned, fingerprint, after_findings)
        after_findings.extend(after_contextual)
        
        # Match with DB findings to copy status fields
        db_findings = db.query(Finding).filter(Finding.analysis_id == analysis.id).all()
        db_map = {(f.row_index, f.column, f.issue_type): f.status for f in db_findings}
        for f in after_findings:
            key = (f.get("row_index"), f.get("column"), f.get("issue_type"))
            f["status"] = db_map.get(key, "pending_review")
            
        after_stats = compute_quality_metrics(df_cleaned, after_findings, is_after=True)
        analysis.after_metrics = after_stats
        db.commit()
    except Exception as e:
        import traceback
        traceback.print_exc()

@router.get("/analyses/{analysis_id}/findings", response_model=FindingListResponse)
def get_analysis_findings(
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
        
    findings = db.query(Finding).filter(Finding.analysis_id == analysis_id).all()
    return {"findings": findings}

@router.post("/analyses/{analysis_id}/findings/{finding_id}/apply")
def apply_finding(
    analysis_id: str, 
    finding_id: str, 
    action_payload: dict = Body(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    finding = db.query(Finding).filter(Finding.id == finding_id, Finding.analysis_id == analysis_id).first()
    
    if not analysis or not finding:
        raise HTTPException(status_code=404, detail="Analysis or Finding not found")
        
    if analysis.user_id is not None:
        if not current_user or analysis.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this analysis")
        
    # Determine the action to apply (custom or recommended)
    action = None
    custom_value = None
    if action_payload and "action" in action_payload:
        action = action_payload["action"]
        custom_value = action_payload.get("value")
    else:
        action = finding.ai_recommended_action or get_default_action(finding.issue_type, finding.column)
        
    if not action or action == "keep_no_action":
        # Keep as is, set status to reviewed_no_action
        finding.status = "reviewed_no_action"
        finding.action_taken = "keep_no_action"
        db.commit()
        return {
            "finding_id": finding.id,
            "status": finding.status,
            "action_taken": finding.action_taken,
            "applied_at": datetime.datetime.utcnow().isoformat()
        }

    # Execute deterministic fix on cleaned file
    dataset = analysis.dataset
    ext = os.path.splitext(dataset.file_path)[1].lower()
    cleaned_path = os.path.join(os.path.dirname(dataset.file_path), f"{analysis_id}_cleaned{ext}")
    
    if not os.path.exists(cleaned_path):
        raise HTTPException(status_code=404, detail="Cleaned dataset file not found")
        
    try:
        df_cleaned = get_cleaned_dataframe(analysis, db)
            
        fingerprint = dataset.schema_fingerprint or {}
        
        # Validation: Check and validate dtype of custom_value before manual edits
        if action == "MANUAL_EDIT" and custom_value is not None:
            if finding.column != "ALL_COLUMNS" and finding.column in df_cleaned.columns:
                col_dtype = df_cleaned[finding.column].dtype
                if pd.api.types.is_numeric_dtype(col_dtype):
                    try:
                        val_str = str(custom_value).strip()
                        if val_str != "":
                            pd.to_numeric(val_str)
                    except ValueError:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Validation Error: Column '{finding.column}' is numeric, but the value '{custom_value}' cannot be converted to a number."
                        )
                elif pd.api.types.is_datetime64_any_dtype(col_dtype):
                    try:
                        val_str = str(custom_value).strip()
                        if val_str != "":
                            pd.to_datetime(val_str)
                    except Exception:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Validation Error: Column '{finding.column}' expects a date/time format, but the value '{custom_value}' cannot be parsed as a date."
                        )
        
        # Check manual override
        is_override = finding.status == "auto_applied"
        override_prev_val = finding.after_value if is_override else None
        
        # Apply the fix
        df_cleaned, execution = apply_finding_fix(df_cleaned, {
            "row_index": finding.row_index,
            "column": finding.column,
            "issue_type": finding.issue_type,
            "custom_value": custom_value
        }, action, fingerprint.get("mapping", {}))
        
        if not execution.get("applied", False):
            raise HTTPException(status_code=400, detail=f"Failed to apply action '{action}': {execution.get('reason', 'Unknown error')}")
            
        # Overwrite cleaned file with modified version
        if ext == ".csv":
            df_cleaned.to_csv(cleaned_path, index=False)
        else:
            df_cleaned.to_excel(cleaned_path, index=False)
            
        # Update finding details
        finding.status = "reviewed_no_action" if action == "leave_blank" else "auto_applied"
        finding.action_taken = action
        finding.before_value = execution.get("before_value", finding.before_value)
        finding.after_value = execution.get("after_value")
        if action == "MANUAL_EDIT":
            finding.reasoning = "User manually supplied the missing value."
        else:
            finding.reasoning = f"Approved and applied by user: {execution.get('reasoning')}"
        
        # Map action to method for audit logging
        if is_override:
            audit_action = "manual_override"
        elif action == "MANUAL_EDIT":
            audit_action = "manual"
        elif action == "impute_mean":
            audit_action = "mean"
        elif action == "impute_median":
            audit_action = "median"
        elif action == "impute_mode":
            audit_action = "mode"
        else:
            audit_action = action
            
        # Write to audit trail
        audit = AuditLog(
            finding_id=finding.id,
            action_taken=audit_action,
            reasoning=finding.reasoning,
            changed_by="human",
            before_value=str(override_prev_val) if is_override else str(finding.before_value),
            after_value=str(finding.after_value)
        )
        db.add(audit)

        # If the action is drop, automatically resolve/approve all other pending findings on the same row
        if action == "drop":
            other_findings = db.query(Finding).filter(
                Finding.analysis_id == analysis_id,
                Finding.row_index == finding.row_index,
                Finding.id != finding.id,
                Finding.status == "pending_review"
            ).all()
            for other_f in other_findings:
                other_f.status = "auto_applied"
                other_f.action_taken = "drop"
                other_f.after_value = "None"
                other_f.reasoning = f"Row {finding.row_index} was dropped. This issue is resolved."
                
                other_audit = AuditLog(
                    finding_id=other_f.id,
                    action_taken="drop",
                    reasoning=other_f.reasoning,
                    changed_by="human",
                    before_value=str(other_f.before_value),
                    after_value="None"
                )
                db.add(other_audit)

        db.commit()
        
        # Re-calculate post-cleaning quality metrics
        recompute_and_update_metrics(analysis, db)
        
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"Error executing fix: {str(e)}")
        
    return {
        "finding_id": finding.id,
        "status": finding.status,
        "action_taken": finding.action_taken,
        "applied_at": datetime.datetime.utcnow().isoformat()
    }

@router.post("/analyses/{analysis_id}/findings/{finding_id}/reject")
def reject_finding(
    analysis_id: str,
    finding_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    finding = db.query(Finding).filter(Finding.id == finding_id, Finding.analysis_id == analysis_id).first()
    
    if not analysis or not finding:
        raise HTTPException(status_code=404, detail="Analysis or Finding not found")
        
    if analysis.user_id is not None:
        if not current_user or analysis.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this analysis")
        
    finding.status = "reviewed_no_action"
    finding.action_taken = "keep_no_action"
    finding.after_value = finding.before_value
    finding.reasoning = "Rejected by user. Kept original value."
    
    # Audit log
    audit = AuditLog(
        finding_id=finding.id,
        action_taken="keep_no_action",
        reasoning=finding.reasoning,
        changed_by="human",
        before_value=finding.before_value,
        after_value=finding.before_value
    )
    db.add(audit)
    db.commit()
    
    # Re-save cleaned file on disk using get_cleaned_dataframe
    dataset = analysis.dataset
    ext = os.path.splitext(dataset.file_path)[1].lower()
    cleaned_path = os.path.join(os.path.dirname(dataset.file_path), f"{analysis_id}_cleaned{ext}")
    
    try:
        df_cleaned = get_cleaned_dataframe(analysis, db)
        if ext == ".csv":
            df_cleaned.to_csv(cleaned_path, index=False)
        else:
            df_cleaned.to_excel(cleaned_path, index=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reverting fix failed: {str(e)}")
        
    # Re-calculate post-cleaning quality metrics
    recompute_and_update_metrics(analysis, db)
    
    return {
        "finding_id": finding.id,
        "status": finding.status
    }

@router.post("/findings/{finding_id}/explain")
def explain_finding_on_demand(
    finding_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    finding = db.query(Finding).filter(Finding.id == finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")
        
    analysis = finding.analysis
    if analysis and analysis.user_id is not None:
        if not current_user or analysis.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this analysis")

    if not finding.ai_explanation:
        from app.services.gemini_service import interpret_findings
        f_dict = {
            "id": finding.id,
            "column": finding.column,
            "issue_type": finding.issue_type,
            "stat_score": finding.stat_score,
            "ml_score": finding.ml_score,
            "rule_score": finding.rule_score,
            "rule_violation": finding.rule_violation,
            "confidence": finding.confidence,
            "before_value": finding.before_value,
            "row_index": finding.row_index
        }
        results = interpret_findings([f_dict], use_mock=False)
        if results:
            res = results[0]
            finding.ai_explanation = res.get("explanation")
            finding.ai_resolution = res.get("resolution_suggestion")
            if not finding.ai_recommended_action:
                finding.ai_recommended_action = res.get("recommended_action")
            db.commit()
            
    return {
        "finding_id": finding.id,
        "ai_explanation": finding.ai_explanation,
        "ai_recommended_action": finding.ai_recommended_action,
        "ai_resolution": finding.ai_resolution
    }

class ImputeColumnPayload(BaseModel):
    column: str
    method: str
    value: Optional[str] = None

@router.post("/analyses/{analysis_id}/impute-column")
def impute_column_batch(
    analysis_id: str,
    payload: ImputeColumnPayload,
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
        raise HTTPException(status_code=404, detail="Cleaned dataset file not found")
        
    try:
        df_cleaned = get_cleaned_dataframe(analysis, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read dataset: {str(e)}")
        
    findings = db.query(Finding).filter(
        Finding.analysis_id == analysis_id,
        Finding.column == payload.column,
        Finding.issue_type == "missing_value",
        Finding.status == "pending_review"
    ).all()
    
    if not findings:
        return {"message": "No unresolved missing values found in this column", "count": 0}
        
    fingerprint = dataset.schema_fingerprint or {}
    mapping = fingerprint.get("mapping", {})
    
    # Check datatype validation for custom manual value
    if payload.method == "MANUAL_EDIT" and payload.value is not None:
        col_dtype = df_cleaned[payload.column].dtype
        if pd.api.types.is_numeric_dtype(col_dtype):
            try:
                val_str = str(payload.value).strip()
                if val_str != "":
                    pd.to_numeric(val_str)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Validation Error: Column '{payload.column}' is numeric, but the value '{payload.value}' cannot be converted to a number."
                )
        elif pd.api.types.is_datetime64_any_dtype(col_dtype):
            try:
                val_str = str(payload.value).strip()
                if val_str != "":
                    pd.to_datetime(val_str)
            except Exception:
                raise HTTPException(
                    status_code=400,
                    detail=f"Validation Error: Column '{payload.column}' expects a date/time format, but the value '{payload.value}' cannot be parsed as a date."
                )
                
    count = 0
    for finding in findings:
        df_cleaned, execution = apply_finding_fix(df_cleaned, {
            "row_index": finding.row_index,
            "column": finding.column,
            "issue_type": finding.issue_type,
            "custom_value": payload.value
        }, payload.method, mapping)
        
        if execution.get("applied", False):
            finding.status = "reviewed_no_action" if payload.method == "leave_blank" else "auto_applied"
            finding.action_taken = payload.method
            finding.before_value = execution.get("before_value", finding.before_value)
            finding.after_value = execution.get("after_value")
            
            if payload.method == "MANUAL_EDIT":
                audit_action = "manual"
            elif payload.method == "impute_mean":
                audit_action = "mean"
            elif payload.method == "impute_median":
                audit_action = "median"
            elif payload.method == "impute_mode":
                audit_action = "mode"
            else:
                audit_action = payload.method
                
            finding.reasoning = f"Imputed via batch action: {execution.get('reasoning')}"
            
            db.add(AuditLog(
                finding_id=finding.id,
                action_taken=audit_action,
                reasoning=finding.reasoning,
                changed_by="human",
                before_value=str(finding.before_value),
                after_value=str(finding.after_value)
            ))
            count += 1
            
    try:
        if ext == ".csv":
            df_cleaned.to_csv(cleaned_path, index=False)
        else:
            df_cleaned.to_excel(cleaned_path, index=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save imputed dataset: {str(e)}")
        
    db.commit()
    recompute_and_update_metrics(analysis, db)
    
    return {"message": f"Successfully imputed {count} values", "count": count}


@router.post("/analyses/{analysis_id}/findings/{finding_id}/revert")
def revert_finding(
    analysis_id: str,
    finding_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
    finding = db.query(Finding).filter(Finding.id == finding_id, Finding.analysis_id == analysis_id).first()
    
    if not analysis or not finding:
        raise HTTPException(status_code=404, detail="Analysis or Finding not found")
        
    if analysis.user_id is not None:
        if not current_user or analysis.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this analysis")
            
    # Capture the value before revert (the current after_value)
    old_value = finding.after_value
    
    # Restore to original pre-preprocessing value (finding.before_value)
    finding.status = "pending_review"
    finding.action_taken = "flag_for_review"
    finding.after_value = finding.before_value
    finding.reasoning = "Reverted to original value by user."
    
    # Write to audit trail
    audit = AuditLog(
        finding_id=finding.id,
        action_taken="revert",
        reasoning=finding.reasoning,
        changed_by="human",
        before_value=str(old_value) if old_value is not None else "",
        after_value=str(finding.before_value) if finding.before_value is not None else ""
    )
    db.add(audit)
    db.commit()
    
    # Re-save cleaned file on disk using get_cleaned_dataframe
    dataset = analysis.dataset
    ext = os.path.splitext(dataset.file_path)[1].lower()
    cleaned_path = os.path.join(os.path.dirname(dataset.file_path), f"{analysis_id}_cleaned{ext}")
    
    try:
        df_cleaned = get_cleaned_dataframe(analysis, db)
        if ext == ".csv":
            df_cleaned.to_csv(cleaned_path, index=False)
        else:
            df_cleaned.to_excel(cleaned_path, index=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reverting fix failed: {str(e)}")
        
    # Re-calculate post-cleaning quality metrics
    recompute_and_update_metrics(analysis, db)
    
    return {
        "finding_id": finding.id,
        "status": finding.status
    }

