import os
import sys
import tempfile
import pandas as pd
import pytest
from fastapi.testclient import TestClient

# Ensure backend folder is in path for imports
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, BASE_DIR)

from app.main import app
from app.core.database import SessionLocal, Base, engine
from app.models.models import Dataset, Analysis, Finding, AuditLog, User

client = TestClient(app)

def test_cleaning_endpoints_flow():
    db = SessionLocal()
    
    # 1. Create a dummy dataset file
    df_raw = pd.DataFrame({
        "quantity": [1, 2, None, 4, 5],
        "category": ["A", "B", "A", None, "B"]
    })
    
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        raw_path = tmp.name
    
    df_raw.to_csv(raw_path, index=False)
    
    dataset_id = "test-cleaning-dataset"
    analysis_id = "test-cleaning-analysis"
    
    # Clean old entries
    db.query(AuditLog).filter(AuditLog.finding_id.in_(
        db.query(Finding.id).filter(Finding.analysis_id == analysis_id)
    )).delete(synchronize_session=False)
    db.query(Finding).filter(Finding.analysis_id == analysis_id).delete()
    db.query(Analysis).filter(Analysis.id == analysis_id).delete()
    db.query(Dataset).filter(Dataset.id == dataset_id).delete()
    db.commit()
    
    # Insert dataset & analysis
    db_dataset = Dataset(
        id=dataset_id,
        filename="test_clean.csv",
        row_count=5,
        column_count=2,
        file_path=raw_path,
        schema_fingerprint={"mapping": {"quantity": "quantity", "category": "category"}}
    )
    db.add(db_dataset)
    
    # Create the cleaned file
    cleaned_path = os.path.join(os.path.dirname(raw_path), f"{analysis_id}_cleaned.csv")
    df_raw.to_csv(cleaned_path, index=False)
    
    db_analysis = Analysis(
        id=analysis_id,
        dataset_id=dataset_id,
        status="completed",
        before_metrics={"quality_score": 80.0},
        after_metrics={"quality_score": 80.0}
    )
    db.add(db_analysis)
    db.commit()
    
    # Add a missing value finding in column 'quantity', row 2
    finding_qty = Finding(
        id="finding-qty-missing",
        analysis_id=analysis_id,
        row_index=2,
        column="quantity",
        issue_type="missing_value",
        confidence=0.5,
        status="pending_review",
        before_value=""
    )
    # Add a missing value finding in column 'category', row 3
    finding_cat = Finding(
        id="finding-cat-missing",
        analysis_id=analysis_id,
        row_index=3,
        column="category",
        issue_type="missing_value",
        confidence=0.5,
        status="pending_review",
        before_value=""
    )
    db.add(finding_qty)
    db.add(finding_cat)
    db.commit()
    
    try:
        # A. Verify imputation-previews
        response = client.get(f"/api/analyses/{analysis_id}/imputation-previews")
        assert response.status_code == 200
        previews = response.json()
        assert "quantity" in previews
        assert "category" in previews
        # quantity previews should contain mean/median/mode
        assert previews["quantity"]["mean"] == 3.0
        assert previews["quantity"]["median"] == 3.0
        assert previews["quantity"]["mode"] == 1.0 # 1, 2, 4, 5 mode
        # category previews should contain mode but not mean/median
        assert previews["category"]["mode"] == "A" # A and B are equal, first mode series element
        assert "mean" not in previews["category"]
        
        # B. Verify preview endpoint
        response = client.get(f"/api/analyses/{analysis_id}/preview")
        assert response.status_code == 200
        preview = response.json()
        assert preview["columns"] == ["quantity", "category"]
        assert len(preview["rows"]) == 5
        
        # C. Verify datatype validation (manual edit with string on numeric column)
        response = client.post(
            f"/api/analyses/{analysis_id}/findings/finding-qty-missing/apply",
            json={"action": "MANUAL_EDIT", "value": "non-numeric-string"}
        )
        assert response.status_code == 400
        assert "Validation Error" in response.json()["detail"]
        
        # D. Verify valid manual edit
        response = client.post(
            f"/api/analyses/{analysis_id}/findings/finding-qty-missing/apply",
            json={"action": "MANUAL_EDIT", "value": "10"}
        )
        assert response.status_code == 200
        db.refresh(finding_qty)
        assert finding_qty.status == "auto_applied"
        assert finding_qty.after_value == "10.0"
        
        # E. Verify manual override logic and audit log entry
        response = client.post(
            f"/api/analyses/{analysis_id}/findings/finding-qty-missing/apply",
            json={"action": "MANUAL_EDIT", "value": "20"}
        )
        assert response.status_code == 200
        db.refresh(finding_qty)
        assert finding_qty.after_value == "20.0"
        
        # Check audit log contains manual_override entry
        override_audit = db.query(AuditLog).filter(
            AuditLog.finding_id == "finding-qty-missing",
            AuditLog.action_taken == "manual_override"
        ).first()
        assert override_audit is not None
        assert override_audit.before_value == "10.0"
        assert override_audit.after_value == "20.0"
        
        # F. Verify batch column imputation
        response = client.post(
            f"/api/analyses/{analysis_id}/impute-column",
            json={"column": "category", "method": "impute_mode"}
        )
        assert response.status_code == 200
        assert response.json()["count"] == 1
        db.refresh(finding_cat)
        assert finding_cat.status == "auto_applied"
        assert finding_cat.after_value == "A"
        
        # Check audit log contains mode entry
        batch_audit = db.query(AuditLog).filter(
            AuditLog.finding_id == "finding-cat-missing",
            AuditLog.action_taken == "mode"
        ).first()
        assert batch_audit is not None
        assert batch_audit.after_value == "A"

    finally:
        # Clean up database
        db.query(AuditLog).filter(AuditLog.finding_id.in_(
            db.query(Finding.id).filter(Finding.analysis_id == analysis_id)
        )).delete(synchronize_session=False)
        db.query(Finding).filter(Finding.analysis_id == analysis_id).delete()
        db.query(Analysis).filter(Analysis.id == analysis_id).delete()
        db.query(Dataset).filter(Dataset.id == dataset_id).delete()
        db.commit()
        db.close()
        
        # Clean up files
        if os.path.exists(raw_path):
            os.remove(raw_path)
        if os.path.exists(cleaned_path):
            os.remove(cleaned_path)
