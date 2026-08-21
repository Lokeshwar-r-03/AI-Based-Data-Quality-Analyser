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

def test_delete_user():
    db = SessionLocal()
    
    # Clean up old test data if any
    db.query(Analysis).filter(Analysis.id == "test-analysis-delete").delete(synchronize_session=False)
    db.query(Dataset).filter(Dataset.id == "test-dataset-delete").delete(synchronize_session=False)
    db.query(User).filter(User.id == "user-delete").delete(synchronize_session=False)
    db.commit()

    user = User(id="user-delete", google_sub="sub-delete", email="user_delete@example.com", name="User Delete")
    db.add(user)
    db.commit()

    # Create dataset
    dataset = Dataset(
        id="test-dataset-delete",
        user_id="user-delete",
        filename="delete_me.csv",
        row_count=10,
        column_count=2,
        file_path="uploads/delete_me.csv"
    )
    db.add(dataset)
    db.commit()

    # Create analysis
    analysis = Analysis(
        id="test-analysis-delete",
        dataset_id="test-dataset-delete",
        user_id="user-delete",
        status="completed"
    )
    db.add(analysis)
    db.commit()
    db.close()

    # Generate JWT token
    from app.api.auth import create_jwt_token
    token = create_jwt_token("user-delete")

    # Set session cookie
    client.cookies.clear()
    client.cookies.set("session_token", token)

    # 1. Fetch user analyses first - should return 200
    res_list = client.get("/api/analyses")
    assert res_list.status_code == 200
    
    # 2. Call DELETE /api/users/me
    res_delete = client.delete("/api/users/me")
    assert res_delete.status_code == 200
    assert "permanently deleted" in res_delete.json()["message"]

    # 3. Attempt to access analyses list again. Since user is deleted from the DB, get_current_user will raise 401.
    res_list_after = client.get("/api/analyses")
    assert res_list_after.status_code == 401

    # 4. Double check database records are cleaned up
    db = SessionLocal()
    db_user = db.query(User).filter(User.id == "user-delete").first()
    db_dataset = db.query(Dataset).filter(Dataset.id == "test-dataset-delete").first()
    db_analysis = db.query(Analysis).filter(Analysis.id == "test-analysis-delete").first()
    
    assert db_user is None
    assert db_dataset is None
    assert db_analysis is None
    db.close()

    print("User deletion integration test passed successfully!")

if __name__ == "__main__":
    test_delete_user()
