from fastapi import APIRouter, Depends, HTTPException, Response, Request
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.api.auth import get_current_user
from app.models.models import User, Analysis, Dataset, Finding, AuditLog

router = APIRouter(prefix="/api/users", tags=["users"])


# --- Settings Schemas ---

class UserSettingsResponse(BaseModel):
    name: str
    email: str
    created_at: str
    auto_threshold: float
    review_threshold: float

class UserSettingsUpdate(BaseModel):
    auto_threshold: Optional[float] = Field(None, ge=0.50, le=1.00)
    review_threshold: Optional[float] = Field(None, ge=0.10, le=0.90)


# --- Settings Endpoints ---

@router.get("/me/settings")
def get_my_settings(
    user: User = Depends(get_current_user)
):
    return {
        "name": user.name,
        "email": user.email,
        "created_at": user.created_at.isoformat() if user.created_at else "",
        "auto_threshold": user.auto_threshold if user.auto_threshold is not None else settings.CONFIDENCE_THRESHOLD_AUTO,
        "review_threshold": user.review_threshold if user.review_threshold is not None else settings.CONFIDENCE_THRESHOLD_REVIEW,
    }


@router.put("/me/settings")
def update_my_settings(
    payload: UserSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    if payload.auto_threshold is not None and payload.review_threshold is not None:
        if payload.review_threshold >= payload.auto_threshold:
            raise HTTPException(
                status_code=422,
                detail="Review threshold must be lower than auto-fix threshold."
            )

    if payload.auto_threshold is not None:
        user.auto_threshold = payload.auto_threshold
    if payload.review_threshold is not None:
        user.review_threshold = payload.review_threshold

    db.commit()
    db.refresh(user)

    return {
        "message": "Settings updated successfully.",
        "auto_threshold": user.auto_threshold if user.auto_threshold is not None else settings.CONFIDENCE_THRESHOLD_AUTO,
        "review_threshold": user.review_threshold if user.review_threshold is not None else settings.CONFIDENCE_THRESHOLD_REVIEW,
    }


# --- Account Deletion ---

@router.delete("/me")
def delete_my_account(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    try:
        # Get user analysis ids
        analysis_ids = [a.id for a in db.query(Analysis).filter(Analysis.user_id == user.id).all()]
        finding_ids = []
        if analysis_ids:
            finding_ids = [f.id for f in db.query(Finding).filter(Finding.analysis_id.in_(analysis_ids)).all()]
            
        # Delete audit logs
        if finding_ids:
            db.query(AuditLog).filter(AuditLog.finding_id.in_(finding_ids)).delete(synchronize_session=False)
            
        # Delete findings
        if analysis_ids:
            db.query(Finding).filter(Finding.analysis_id.in_(analysis_ids)).delete(synchronize_session=False)
            
        # Delete analyses
        db.query(Analysis).filter(Analysis.user_id == user.id).delete(synchronize_session=False)
        
        # Delete datasets
        db.query(Dataset).filter(Dataset.user_id == user.id).delete(synchronize_session=False)
        
        # Delete user
        db.delete(user)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error deleting account: {str(e)}")

    # Clear session cookie after successful deletion
    response.delete_cookie("session_token")
    return {"message": "Your account and data have been permanently deleted."}
