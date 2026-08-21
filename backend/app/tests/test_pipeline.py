import os
import sys
import pandas as pd
import numpy as np

# Ensure backend folder is in path for imports
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, BASE_DIR)

from app.services.rules import is_valid_email, check_country_consistency, run_contextual_validation
from app.services.confidence import calculate_confidence
from app.services.action_engine import apply_finding_fix, clean_dataset, get_default_action
from app.services.validation import compute_quality_metrics
from app.services.preprocessing import preprocess_dataframe
from app.services.detection import run_detection
from app.services.profiling import profile_dataframe

def test_rule_engine():
    # 1. Email validation checks
    assert is_valid_email("test@example.com") == True
    assert is_valid_email("invalid-email") == False
    
    # 2. Country currency consistency checks
    assert len(check_country_consistency("US", "USD", "+15551234567")) == 0
    
    mismatches = check_country_consistency("US", "CAD", "+15551234567")
    assert len(mismatches) == 1
    assert "Currency" in mismatches[0]
    
    # 3. Arithmetic consistency check
    df = pd.DataFrame([{
        "quantity": 2.0,
        "unit_price": 10.0,
        "total": 25.0
    }])
    fingerprint = {
        "mapping": {"quantity": "quantity", "unit_price": "unit_price", "total": "total"}
    }
    findings = run_contextual_validation(df, fingerprint, [])
    assert len(findings) == 1
    assert findings[0]["column"] == "total"
    assert findings[0]["issue_type"] == "rule_violation"
    print("Rule engine tests passed.")

def test_confidence_scoring():
    # Combined scoring without violation
    score = calculate_confidence(stat_score=0.5, ml_score=0.5, rule_score=0.0, rule_violation=False)
    assert abs(score - 0.3) < 0.001
    
    # Rule violation floor
    score_floor = calculate_confidence(stat_score=0.0, ml_score=0.0, rule_score=0.0, rule_violation=True)
    assert score_floor == 0.85
    
    # Boundaries
    assert calculate_confidence(0.1, 0.1, 0.1, False) < 0.40
    assert calculate_confidence(0.9, 0.9, 0.9, False) > 0.40
    print("Confidence scoring tests passed.")

def test_action_executor():
    # Impute missing values
    df = pd.DataFrame({"col": [1.0, 2.0, np.nan, 4.0]})
    finding = {"row_index": 2, "column": "col", "issue_type": "missing_value"}
    df_new, exec_info = apply_finding_fix(df, finding, "impute", {})
    assert exec_info["applied"] == True
    assert df_new.at[2, "col"] == 2.0  # Median is 2.0
    
    # Formula correction
    df_art = pd.DataFrame([{
        "qty": 2.0,
        "price": 10.0,
        "total": 30.0
    }])
    finding_art = {"row_index": 0, "column": "total", "issue_type": "rule_violation"}
    mapping = {"quantity": "qty", "unit_price": "price", "total": "total"}
    df_new, exec_info = apply_finding_fix(df_art, finding_art, "correct_formula", mapping)
    assert exec_info["applied"] == True
    assert df_new.at[0, "total"] == 20.0
    print("Action executor tests passed.")

def test_pipeline_integration():
    # Path relative to backend root
    corrupted_file = os.path.join(os.path.dirname(BASE_DIR), "sample_data", "shopify_orders_corrupted.csv")
    assert os.path.exists(corrupted_file), f"Sample file not found at {corrupted_file}"
    
    df_raw = pd.read_csv(corrupted_file)
    from app.services.fingerprint import detect_domain
    fingerprint = detect_domain(df_raw.columns.tolist())
    
    df_prep = preprocess_dataframe(df_raw, fingerprint)
    
    # Run detectors
    findings = run_detection(df_prep)
    context_findings = run_contextual_validation(df_prep, fingerprint, findings)
    findings.extend(context_findings)
    
    import uuid
    for f in findings:
        f["id"] = str(uuid.uuid4())
        f["confidence"] = calculate_confidence(
            f.get("stat_score", 0.0),
            f.get("ml_score", 0.0),
            f.get("rule_score", 0.0),
            f.get("rule_violation", False)
        )
    
    # Check expected flags
    missing_email = [f for f in findings if f["issue_type"] == "missing_value" and f["column"] == "customer_email"]
    assert len(missing_email) > 0
    assert missing_email[0]["confidence"] >= 0.85
    
    dups = [f for f in findings if f["issue_type"] == "duplicate"]
    assert len(dups) > 0
    
    decimal_error = [f for f in findings if f["issue_type"] == "rule_violation" and f["column"] == "total"]
    assert len(decimal_error) > 0
    assert decimal_error[0]["confidence"] >= 0.85

    df_clean, audit = clean_dataset(df_prep, findings, fingerprint)
    
    # Duplicates dropped
    assert len(df_clean) < len(df_prep)
    # Row 1009 decimal corrected from 180 to 18
    assert df_clean.at[1009, "total"] == 18.0
    print("Pipeline integration tests passed.")

def test_profiling():
    df = pd.DataFrame({
        "col_int": [1, 2, 3, 4, 5],
        "col_float_nan": [1.1, np.nan, 3.3, 4.4, np.nan],
        "col_str": ["a", "b", "a", "c", "b"],
    })
    profiles = profile_dataframe(df)
    
    p_int = [p for p in profiles if p["name"] == "col_int"][0]
    p_float = [p for p in profiles if p["name"] == "col_float_nan"][0]
    p_str = [p for p in profiles if p["name"] == "col_str"][0]
    
    assert "int" in p_int["dtype"]
    assert p_int["missing_pct"] == 0.0
    assert p_int["unique_count"] == 5
    
    assert "float" in p_float["dtype"]
    assert abs(p_float["missing_pct"] - 0.4) < 0.001
    assert p_float["unique_count"] == 3
    
    assert p_str["dtype"] in ["object", "str"]
    assert p_str["missing_pct"] == 0.0
    assert p_str["unique_count"] == 3
    print("Profiling checks passed.")

def test_date_bounds():
    # Inverted date pair
    df = pd.DataFrame([{
        "start_date": "2026-08-18",
        "end_date": "2026-08-17"
    }])
    fingerprint = {
        "mapping": {"start_date": "start_date", "end_date": "end_date"}
    }
    findings = run_contextual_validation(df, fingerprint, [])
    assert len(findings) == 1
    assert findings[0]["column"] == "end_date"
    assert findings[0]["issue_type"] == "rule_violation"
    print("Date bounds rules passed.")

def test_cross_field_phone():
    # US country code but non-US phone format (prefix CA or UK)
    df = pd.DataFrame([{
        "country": "US",
        "currency": "USD",
        "phone": "+4412345678"  # UK prefix
    }])
    fingerprint = {
        "mapping": {"country": "country", "currency": "currency", "phone": "phone"}
    }
    findings = run_contextual_validation(df, fingerprint, [])
    assert len(findings) == 1
    assert findings[0]["column"] == "phone"
    assert findings[0]["issue_type"] == "cross_field_mismatch"
    print("Cross-field phone validation rules passed.")

def test_rules_auto_suggested():
    # Renamed but equivalent columns (order_total instead of total, qty instead of quantity)
    df = pd.DataFrame([{
        "order_id": "1001",
        "qty": 2.0,
        "price": 10.0,
        "order_total": 30.0
    }])
    from app.services.fingerprint import detect_domain
    fingerprint = detect_domain(df.columns.tolist())
    assert fingerprint["mapping"].get("total") == "order_total"
    assert fingerprint["mapping"].get("quantity") == "qty"
    
    findings = run_contextual_validation(df, fingerprint, [])
    assert len(findings) == 1
    assert findings[0]["column"] == "order_total"
    assert findings[0]["issue_type"] == "rule_violation"
    print("Auto-suggested mapping validation rules passed.")

def test_single_issue_isolation():
    # 1. Missing value only
    df_missing = pd.DataFrame({"col": [1.0, 2.0, np.nan, 4.0]})
    f_missing = run_detection(df_missing)
    assert len(f_missing) == 1
    assert f_missing[0]["issue_type"] == "missing_value"
    
    # 2. Duplicate only
    df_dup = pd.DataFrame({"col": [1.0, 2.0, 1.0, 2.0]})
    f_dup = run_detection(df_dup)
    assert len(f_dup) == 2
    assert all(f["issue_type"] == "duplicate" for f in f_dup)
    
    # 3. Outlier only
    df_outlier = pd.DataFrame({"col": [1.0, 2.0, 1.5, 3.0, 100.0]})
    f_outlier = run_detection(df_outlier)
    assert len(f_outlier) == 1
    assert f_outlier[0]["issue_type"] == "outlier"
    print("Detector isolation tests passed.")

def test_confidence_boundary_0_85():
    # Verify exact inclusive boundary auto-apply rule
    assert calculate_confidence(0.5, 0.5, 0.5, True) >= 0.85
    assert calculate_confidence(0.0, 0.0, 0.0, True) == 0.85
    print("Confidence boundary 0.85 tests passed.")

def test_quality_score_weight_calculation():
    # Verify the normalized weighted quality score formula:
    # 0.2*missing + 0.2*duplicate + 0.2*outlier + 0.4*rule
    df = pd.DataFrame({"col": [1.0, 2.0, np.nan, 4.0]})
    # 1 cell missing out of 4 total cells -> missing_pct = 0.25 (missing_score = 75.0)
    # duplicate = 0.0 (duplicate_score = 100.0)
    # outliers = 0.0 (outlier_score = 100.0)
    # rule violations = 0.0 (rule_score = 100.0)
    # quality_score = 0.2*75 + 0.2*100 + 0.2*100 + 0.4*100 = 15 + 20 + 20 + 40 = 95.0
    stats = compute_quality_metrics(df, [])
    assert stats["quality_score"] == 95.0
    print("Quality score weights validation passed.")

def test_missing_ratio_calculation():
    # 11-row x 7-column dataset with exactly 1 missing cell
    data = {f"col_{i}": [float(j) for j in range(11)] for i in range(7)}
    # Introduce exactly 1 missing cell
    data["col_0"][0] = np.nan
    df = pd.DataFrame(data)
    
    # Assert dimensions
    assert df.shape == (11, 7)
    
    stats = compute_quality_metrics(df, [])
    # 1 / 77 = 1.2987% -> rounds to 1.3%
    assert stats["missing_pct"] == 1.3
    print("Missing ratio 11x7 unit test passed.")

def test_denominator_change_invariant():
    # Before cleanup: 11 rows x 7 cols = 77 cells, 1 missing -> 1.3%
    # After cleanup: 9 rows x 7 cols = 63 cells, 1 missing -> 1.6%
    before_df = pd.DataFrame({f"col_{i}": [float(j) for j in range(11)] for i in range(7)})
    before_df.iloc[0, 0] = np.nan
    
    before_stats = compute_quality_metrics(before_df, [])
    
    # Simulate dropping 2 rows (duplicate/invalid rows removed)
    after_df = before_df.drop(index=[1, 2])
    after_stats = compute_quality_metrics(after_df, [])
    
    # Assert counts are correct
    assert before_stats["missing_count"] == 1
    assert after_stats["missing_count"] == 1
    assert before_stats["total_rows"] == 11
    assert after_stats["total_rows"] == 9
    assert before_stats["missing_pct"] == 1.3
    # 1 / 63 = 1.587% -> rounds to 1.59%
    assert after_stats["missing_pct"] == 1.59
    
    # Assert invariant: missing ratio went up specifically because of denominator change (fewer rows)
    # rather than more missing values
    ratio_increased = after_stats["missing_pct"] > before_stats["missing_pct"]
    missing_count_unchanged = after_stats["missing_count"] <= before_stats["missing_count"]
    rows_dropped = after_stats["total_rows"] < before_stats["total_rows"]
    
    assert ratio_increased and missing_count_unchanged and rows_dropped
    print("Denominator change UI logic invariant validation passed.")

def test_shopify_outliers_calculation():
    # Recreate the exact 11-row x 7-column shopify sample dataset slice
    # to assert that outliers count is low (exactly 1: order ORD2005 / row index 6)
    data = [
        {"order_id": "ORD2000", "created_at": "2026-08-11 11:00:00", "customer_email": "customer_1000@example.com", "quantity": 2, "unit_price": 25.0, "total": 50.0, "country": "US"},
        {"order_id": "ORD2001", "created_at": "2026-08-11 11:15:00", "customer_email": "customer_1001@example.com", "quantity": 1, "unit_price": 18.0, "total": 18.0, "country": "US"},
        {"order_id": "ORD2002", "created_at": "2026-08-11 11:30:00", "customer_email": "customer_1002@example.com", "quantity": 3, "unit_price": 20.0, "total": 60.0, "country": "US"},
        {"order_id": "ORD2003", "created_at": "2026-08-11 11:45:00", "customer_email": "", "quantity": 1, "unit_price": 15.0, "total": 15.0, "country": "US"}, # missing email
        {"order_id": "ORD2004", "created_at": "2026-08-11 12:00:00", "customer_email": "customer_1004@example.com", "quantity": -1, "unit_price": 15.0, "total": -15.0, "country": "US"}, # duplicate 1
        {"order_id": "ORD2004", "created_at": "2026-08-11 12:00:00", "customer_email": "customer_1004@example.com", "quantity": -1, "unit_price": 15.0, "total": -15.0, "country": "US"}, # duplicate 2
        {"order_id": "ORD2005", "created_at": "2026-08-11 12:15:00", "customer_email": "vip_buyer@gmail.com", "quantity": 1, "unit_price": 999.0, "total": 999.0, "country": "US"}, # legitimate outlier
        {"order_id": "ORD2006", "created_at": "2026-08-11 12:30:00", "customer_email": "customer_1006@example.com", "quantity": 2, "unit_price": 30.0, "total": 60.0, "country": "US"},
        {"order_id": "ORD2007", "created_at": "2026-08-11 12:45:00", "customer_email": "customer_1007@example.com", "quantity": 1, "unit_price": 25.0, "total": 25.0, "country": "US"},
        {"order_id": "ORD2008", "created_at": "2026-08-11 13:00:00", "customer_email": "customer_1008@example.com", "quantity": 1, "unit_price": 18.0, "total": 180.0, "country": "US"}, # decimal entry error
        {"order_id": "ORD2009", "created_at": "2026-08-11 13:15:00", "customer_email": "customer_1009@example.com", "quantity": 2, "unit_price": 20.0, "total": 40.0, "country": "US"}
    ]
    df = pd.DataFrame(data)
    
    # Preprocess & Run detection
    from app.services.preprocessing import preprocess_dataframe
    from app.services.detection import run_detection
    
    mapping = {
        "order_id": "order_id",
        "created_at": "created_at",
        "customer_email": "customer_email",
        "quantity": "quantity",
        "unit_price": "unit_price",
        "total": "total"
    }
    df_prep = preprocess_dataframe(df, {"mapping": mapping})
    findings = run_detection(df_prep)
    
    # Calculate stats
    stats = compute_quality_metrics(df_prep, findings)
    
    # Get unique outlier rows
    outliers = [f for f in findings if f["issue_type"] == "outlier"]
    outliers_rows = set(f["row_index"] for f in outliers)
    
    # Assert row ORD2005 (row index 6) is flagged as outlier
    assert 6 in outliers_rows
    # Assert outlier count is low (specifically, only ORD2005 is flagged!)
    assert len(outliers_rows) == 1
    assert stats["outliers_flagged"] == 1
    print("Shopify sample outliers calculation test passed.")

if __name__ == "__main__":
    test_rule_engine()
    test_confidence_scoring()
    test_action_executor()
    test_pipeline_integration()
    test_profiling()
    test_date_bounds()
    test_cross_field_phone()
    test_rules_auto_suggested()
    test_single_issue_isolation()
    test_confidence_boundary_0_85()
    test_quality_score_weight_calculation()
    test_missing_ratio_calculation()
    test_denominator_change_invariant()
    test_shopify_outliers_calculation()
    print("All tests passed successfully!")
