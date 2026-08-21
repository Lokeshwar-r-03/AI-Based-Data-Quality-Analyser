import os
import sys
from fastapi.testclient import TestClient

# Ensure backend folder is in path for imports
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, BASE_DIR)

# Force mock client ID in settings before import
os.environ["GOOGLE_CLIENT_ID"] = "mock_client_id_dataset_iq_auth"
os.environ["GOOGLE_CLIENT_SECRET"] = "mock_client_secret_dataset_iq_auth"
os.environ["GOOGLE_REDIRECT_URI"] = "http://localhost:8000/api/auth/google/callback"
os.environ["JWT_SECRET"] = "jwt_secret_dev_32_characters_long_key_dataSetIQ_session_token"

from app.main import app
from app.core.database import SessionLocal, Base, engine
from app.models.models import User, Analysis, Dataset

client = TestClient(app)

def setup_module(module):
    # Ensure tables are created
    Base.metadata.create_all(bind=engine)

def test_auth_isolation():
    # 1. Create two test users in the database
    db = SessionLocal()
    
    # Clean up old test data if any
    db.query(Analysis).filter(Analysis.id.like("test-analysis-%")).delete(synchronize_session=False)
    db.query(Dataset).filter(Dataset.id.like("test-dataset-%")).delete(synchronize_session=False)
    db.query(User).filter(User.google_sub.in_(["sub-a", "sub-b"])).delete(synchronize_session=False)
    db.commit()

    user_a = User(id="user-a", google_sub="sub-a", email="user_a@example.com", name="User A")
    user_b = User(id="user-b", google_sub="sub-b", email="user_b@example.com", name="User B")
    
    db.add(user_a)
    db.add(user_b)
    db.commit()

    # Create a dataset for User A
    dataset_a = Dataset(
        id="test-dataset-a",
        user_id="user-a",
        filename="test_a.csv",
        row_count=100,
        column_count=5,
        file_path="uploads/test_a.csv"
    )
    db.add(dataset_a)
    db.commit()

    # Create an analysis for User A
    metrics_before = {
        "missing_pct": 1.5,
        "duplicate_rows": 2,
        "outliers_flagged": 1,
        "rule_violations": 0,
        "quality_score": 80.0,
        "total_rows": 100,
        "total_cols": 5,
        "missing_count": 7,
        "duplicate_rows_to_remove": 2
    }
    metrics_after = {
        "missing_pct": 0.5,
        "duplicate_rows": 0,
        "outliers_flagged": 0,
        "rule_violations": 0,
        "quality_score": 95.0,
        "total_rows": 98,
        "total_cols": 5,
        "missing_count": 2,
        "duplicate_rows_to_remove": 0
    }

    analysis_a = Analysis(
        id="test-analysis-a",
        dataset_id="test-dataset-a",
        user_id="user-a",
        status="completed",
        before_metrics=metrics_before,
        after_metrics=metrics_after
    )
    db.add(analysis_a)
    db.commit()
    db.close()

    # Generate JWT tokens manually for test users
    from app.api.auth import create_jwt_token
    token_a = create_jwt_token("user-a")
    token_b = create_jwt_token("user-b")

    # Set up client cookies for User A
    client.cookies.clear()
    client.cookies.set("session_token", token_a)

    # User A fetching their own analysis details
    res_a = client.get("/api/analyses/test-analysis-a")
    assert res_a.status_code == 200
    assert res_a.json()["status"] == "completed"

    # User A fetching their before-after metrics
    res_ba_a = client.get("/api/analyses/test-analysis-a/before-after")
    assert res_ba_a.status_code == 200

    # Now, change session to User B
    client.cookies.clear()
    client.cookies.set("session_token", token_b)

    # User B attempting to fetch User A's analysis -> must return 403 Forbidden
    res_b = client.get("/api/analyses/test-analysis-a")
    assert res_b.status_code == 403

    res_ba_b = client.get("/api/analyses/test-analysis-a/before-after")
    assert res_ba_b.status_code == 403

    # Now, test unauthenticated access (no session cookie)
    client.cookies.clear()
    
    res_unauth = client.get("/api/analyses/test-analysis-unclaimed")  # Check before claim
    assert res_unauth.status_code == 404  # Not created yet

    # Test claiming:
    db = SessionLocal()
    # Clean up old claim test data if any
    db.query(Analysis).filter(Analysis.id == "test-analysis-unclaimed").delete(synchronize_session=False)
    db.query(Dataset).filter(Dataset.id == "test-dataset-unclaimed").delete(synchronize_session=False)
    db.commit()

    unclaimed_dataset = Dataset(
        id="test-dataset-unclaimed",
        user_id=None,
        filename="unclaimed.csv",
        row_count=50,
        column_count=2,
        file_path="uploads/unclaimed.csv"
    )
    unclaimed_analysis = Analysis(
        id="test-analysis-unclaimed",
        dataset_id="test-dataset-unclaimed",
        user_id=None,
        status="completed"
    )
    db.add(unclaimed_dataset)
    db.add(unclaimed_analysis)
    db.commit()
    db.close()

    # User A claims the unclaimed analysis
    client.cookies.clear()
    client.cookies.set("session_token", token_a)
    res_claim = client.post("/api/analyses/test-analysis-unclaimed/claim")
    assert res_claim.status_code == 200
    assert res_claim.json()["message"] == "Analysis claimed successfully"

    # User B attempts to claim User A's claimed analysis -> must return 403 Forbidden
    client.cookies.clear()
    client.cookies.set("session_token", token_b)
    res_claim_b = client.post("/api/analyses/test-analysis-unclaimed/claim")
    assert res_claim_b.status_code == 403

    # Reset cookie-less assert
    client.cookies.clear()
    res_unauth_after = client.get("/api/analyses/test-analysis-a")
    assert res_unauth_after.status_code == 403

    print("Authentication and authorization isolation tests passed successfully!")

if __name__ == "__main__":
    test_auth_isolation()
