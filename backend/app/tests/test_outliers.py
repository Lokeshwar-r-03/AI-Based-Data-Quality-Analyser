import os
import sys
import pandas as pd
import pytest

# Ensure backend folder is in path for imports
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, BASE_DIR)

from app.services.detection import run_detection
from app.services.confidence import calculate_confidence

def test_clean_no_errors_outliers():
    # 1. Load clean_no_errors.csv
    file_path = "D:/Mini Project/AI-Based-Data-Quality-Analyzer/backend/uploads/1ea0d63e-926f-49e2-95d8-8e2e8053a0b1.csv"
    assert os.path.exists(file_path), f"File not found: {file_path}"
    
    df = pd.read_csv(file_path)
    
    # 2. Run outlier detection
    findings = run_detection(df)
    
    # 3. Filter for outliers
    outliers = [f for f in findings if f["issue_type"] == "outlier"]
    
    # 4. Assert exactly 0 outliers are flagged
    assert len(outliers) == 0, f"Expected 0 outliers in clean_no_errors.csv, but got {len(outliers)}: {outliers}"

def test_heavy_errors_outliers():
    # 1. Load heavy_errors.csv
    file_path = "C:/Users/Lokesh/Downloads/heavy_errors.csv"
    assert os.path.exists(file_path), f"File not found: {file_path}"
    
    df = pd.read_csv(file_path)
    
    # 2. Run outlier detection
    findings = run_detection(df)
    
    # 3. Compute confidence scores for the findings to filter out low-confidence ones
    for f in findings:
        f["confidence"] = calculate_confidence(
            f.get("stat_score", 0.0),
            f.get("ml_score", 0.0),
            f.get("rule_score", 0.0),
            f.get("rule_violation", False)
        )
    
    # 4. Filter for valid outliers with confidence >= 0.40
    outliers = [f for f in findings if f["issue_type"] == "outlier" and f["confidence"] >= 0.40]
    
    # 5. Extract flagged row indices
    flagged_indices = set(f["row_index"] for f in outliers)
    
    print("Flagged indices in heavy_errors.csv:", sorted(list(flagged_indices)))
    
    # 6. Assert genuine outliers at indices 50, 52, 55 are flagged
    assert 50 in flagged_indices, "Expected index 50 to be flagged as an outlier"
    assert 52 in flagged_indices, "Expected index 52 to be flagged as an outlier"
    assert 55 in flagged_indices, "Expected index 55 to be flagged as an outlier"
