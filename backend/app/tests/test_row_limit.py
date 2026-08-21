import os
import sys
import tempfile
import pandas as pd
import pytest
from fastapi.testclient import TestClient

# Ensure backend folder is in path for imports
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, BASE_DIR)

# Force environment variables for configuration
os.environ["GOOGLE_CLIENT_ID"] = "mock_client_id_dataset_iq_auth"
os.environ["GOOGLE_CLIENT_SECRET"] = "mock_client_secret_dataset_iq_auth"
os.environ["GOOGLE_REDIRECT_URI"] = "http://localhost:8000/api/auth/google/callback"
os.environ["JWT_SECRET"] = "jwt_secret_dev_32_characters_long_key_dataSetIQ_session_token"

from app.main import app
from app.core.database import SessionLocal, Base, engine
from app.models.models import Dataset, User
from app.core.config import settings

client = TestClient(app)

def setup_module(module):
    Base.metadata.create_all(bind=engine)

def test_full_file_reading():
    # Generate a temporary CSV with 55,000 rows
    row_count = 55000
    df_generate = pd.DataFrame({
        "col1": range(row_count),
        "col2": ["val"] * row_count
    })
    
    with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as tmp:
        tmp_path = tmp.name
        
    try:
        df_generate.to_csv(tmp_path, index=False)
        
        # Verify pandas reads it in full (exactly 55,000 rows)
        df_read = pd.read_csv(tmp_path)
        assert len(df_read) == 55000, f"Expected 55000 rows, but got {len(df_read)}"
        assert len(df_read.columns) == 2
        
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

def test_analyze_endpoint_rejection():
    db = SessionLocal()
    
    # 1. Create a dummy user
    test_user = db.query(User).filter(User.id == "row-limit-user").first()
    if not test_user:
        test_user = User(id="row-limit-user", google_sub="limit-sub", email="limit@example.com", name="Limit User")
        db.add(test_user)
        db.commit()

    # 2. Insert dataset with row_count = 55,000
    dataset_id = "test-dataset-55k"
    # Clean up old database entry if any
    db.query(Dataset).filter(Dataset.id == dataset_id).delete()
    db.commit()
    
    db_dataset = Dataset(
        id=dataset_id,
        user_id=test_user.id,
        filename="55k_rows.csv",
        row_count=55000,
        column_count=2,
        file_path="dummy_path.csv"
    )
    db.add(db_dataset)
    db.commit()
    
    try:
        # 3. Call start analysis endpoint directly
        # Since authentication uses get_current_user_optional, we can pass a test header or bypass it.
        # But wait, start_analysis checks ownership if dataset.user_id is not None.
        # Let's mock or perform sign in or just make dataset.user_id = None so anyone can analyze it.
        db_dataset.user_id = None
        db.commit()
        
        response = client.post(f"/api/datasets/{dataset_id}/analyses")
        assert response.status_code == 400
        assert "ROW_LIMIT_EXCEEDED" in response.json()["detail"]
        
    finally:
        db.query(Dataset).filter(Dataset.id == dataset_id).delete()
        db.commit()
        db.close()
