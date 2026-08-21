import datetime
import uuid
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base

def generate_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    google_sub = Column(String(255), unique=True, nullable=True, index=True)
    email = Column(String(255), nullable=False, unique=True)
    name = Column(String(255), nullable=False)
    auth_provider = Column(String(50), default="google", nullable=False) # "google" or "password"
    password_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    auto_threshold = Column(Float, nullable=True)    # Per-user auto-fix confidence threshold (default: global 0.85)
    review_threshold = Column(Float, nullable=True)  # Per-user review queue confidence threshold (default: global 0.40)

    datasets = relationship("Dataset", back_populates="user")
    analyses = relationship("Analysis", back_populates="user")

class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    token_hash = Column(String(255), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User")

class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    filename = Column(String(255), nullable=False)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)
    row_count = Column(Integer, nullable=False)
    column_count = Column(Integer, nullable=False)
    schema_fingerprint = Column(JSON, nullable=True)  # { "domain": "e-commerce order", "confidence": 0.95, "columns": [...] }
    file_path = Column(String(500), nullable=False)   # Path to saved raw file

    user = relationship("User", back_populates="datasets")
    analyses = relationship("Analysis", back_populates="dataset", cascade="all, delete-orphan")

class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    dataset_id = Column(String(36), ForeignKey("datasets.id"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    status = Column(String(50), default="queued")  # queued, running, completed, failed
    started_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    before_metrics = Column(JSON, nullable=True)   # { "missing_pct": float, "duplicates": int, "outliers": int, "rule_violations": int }
    after_metrics = Column(JSON, nullable=True)    # Side-by-side post-cleaning metrics

    # Metadata columns for historical restore
    filename = Column(String(255), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)
    rows = Column(Integer, nullable=True)
    columns = Column(Integer, nullable=True)
    health_index_before = Column(Float, nullable=True)
    health_index_after = Column(Float, nullable=True)
    issue_count = Column(Integer, nullable=True)
    processing_time_seconds = Column(Float, nullable=True)
    result_json = Column(JSON, nullable=True)

    user = relationship("User", back_populates="analyses")
    dataset = relationship("Dataset", back_populates="analyses")
    findings = relationship("Finding", back_populates="analysis", cascade="all, delete-orphan")

class Finding(Base):
    __tablename__ = "findings"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    analysis_id = Column(String(36), ForeignKey("analyses.id"), nullable=False)
    row_index = Column(Integer, nullable=False)
    column = Column(String(255), nullable=False)
    issue_type = Column(String(100), nullable=False)  # missing_value, duplicate, outlier, invalid_format, rule_violation, cross_field_mismatch
    stat_score = Column(Float, default=0.0)
    ml_score = Column(Float, default=0.0)
    rule_score = Column(Float, default=0.0)
    rule_violation = Column(Boolean, default=False)
    confidence = Column(Float, default=0.0)
    status = Column(String(50), default="pending_review")  # auto_applied, pending_review, reviewed_no_action
    
    # AI fields
    ai_explanation = Column(String(1000), nullable=True)
    ai_recommended_action = Column(String(100), nullable=True)  # impute, drop, cap, correct_formula, normalize_format, flag_for_review, keep_no_action
    ai_resolution = Column(String(1000), nullable=True)  # plain-English resolution suggestion from AI
    
    # Execution trace fields
    action_taken = Column(String(100), nullable=True)
    reasoning = Column(String(1000), nullable=True)
    before_value = Column(String(1000), nullable=True)
    after_value = Column(String(1000), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    analysis = relationship("Analysis", back_populates="findings")
    audit_logs = relationship("AuditLog", back_populates="finding", cascade="all, delete-orphan")

class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    finding_id = Column(String(36), ForeignKey("findings.id"), nullable=False)
    action_taken = Column(String(100), nullable=False)
    reasoning = Column(String(1000), nullable=True)
    changed_by = Column(String(50), nullable=False)  # system, human
    before_value = Column(String(1000), nullable=True)
    after_value = Column(String(1000), nullable=True)
    applied_at = Column(DateTime, default=datetime.datetime.utcnow)

    finding = relationship("Finding", back_populates="audit_logs")
