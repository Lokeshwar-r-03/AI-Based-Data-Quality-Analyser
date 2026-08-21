from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
from datetime import datetime

# Dataset Schemas
class DatasetResponse(BaseModel):
    dataset_id: str
    filename: str
    row_count: int
    column_count: int
    schema_fingerprint: Optional[Dict[str, Any]] = None
    row_cap_exceeded: Optional[bool] = False

    class Config:
        from_attributes = True

class DatasetPreviewResponse(BaseModel):
    columns: List[str]
    rows: List[List[Any]]

# Profiling Schemas
class ColumnProfile(BaseModel):
    name: str
    dtype: str
    missing_pct: float
    unique_count: int
    sample_values: List[Any]

class ProfileResponse(BaseModel):
    columns: List[ColumnProfile]

# Analysis Schemas
class AnalysisStartResponse(BaseModel):
    analysis_id: str
    status: str

class AnalysisStatusResponse(BaseModel):
    status: str
    current_stage: str

# Finding Schemas (mirrors Section 11.1)
class FindingResponse(BaseModel):
    id: str
    row_index: int
    column: str
    issue_type: str  # missing_value | duplicate | outlier | invalid_format | rule_violation | cross_field_mismatch
    stat_score: float
    ml_score: float
    rule_score: float
    rule_violation: bool
    confidence: float
    status: str  # auto_applied | pending_review | reviewed_no_action
    ai_explanation: Optional[str] = None
    ai_recommended_action: Optional[str] = None  # impute | drop | cap | correct_formula | normalize_format | flag_for_review | keep_no_action | null
    ai_resolution: Optional[str] = None  # plain-English resolution suggestion
    action_taken: Optional[str] = None
    reasoning: Optional[str] = None
    before_value: Optional[str] = None
    after_value: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class FindingListResponse(BaseModel):
    findings: List[FindingResponse]

# Audit Log Response
class AuditLogResponse(BaseModel):
    id: str
    finding_id: str
    action_taken: str
    reasoning: Optional[str] = None
    changed_by: str  # system | human
    before_value: Optional[str] = None
    after_value: Optional[str] = None
    applied_at: datetime

    class Config:
        from_attributes = True

# Before-After Metrics Schemas
class QualityMetrics(BaseModel):
    missing_pct: float
    duplicate_rows: int
    outliers_flagged: int
    rule_violations: int
    quality_score: float
    total_rows: int
    total_cols: int
    missing_count: int
    duplicate_rows_to_remove: int

class BeforeAfterResponse(BaseModel):
    before: QualityMetrics
    after: QualityMetrics

# Report Response
class ReportResponse(BaseModel):
    analysis_id: str
    dataset_id: str
    filename: str
    quality_score_before: float
    quality_score_after: float
    before_metrics: QualityMetrics
    after_metrics: QualityMetrics
    audit_log: List[AuditLogResponse]

# Health Schema
class HealthResponse(BaseModel):
    status: str
    ai_available: bool

# Auth request schemas
class SignupRequest(BaseModel):
    email: str
    password: str
    name: str

class LoginRequest(BaseModel):
    email: str
    password: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
