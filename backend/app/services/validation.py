import pandas as pd
import logging
from typing import Dict, Any, List

logger = logging.getLogger("app.services.validation")

def clamp_percentage(value: float, name: str) -> float:
    """
    Clamps a percentage-based metric to [0.0, 100.0] and logs a warning if the raw value was outside this range.
    """
    if not (0.0 <= value <= 100.0):
        logger.warning(f"Invariant Violated: Percentage-based metric '{name}' value {value} falls outside [0, 100] range. Clamping.")
        return max(0.0, min(100.0, value))
    return value

def compute_quality_metrics(df: pd.DataFrame, findings: List[Dict[str, Any]], is_after: bool = False) -> Dict[str, Any]:
    """
    Calculates summary quality statistics: Missing%, Duplicate count, Outliers, Rule violations, and Quality Score.
    """
    total_rows = len(df)
    total_cols = len(df.columns)
    total_cells = total_rows * total_cols
    
    if total_cells == 0:
        return {
            "missing_pct": 0.0,
            "duplicate_rows": 0,
            "outliers_flagged": 0,
            "rule_violations": 0,
            "quality_score": 0.0,
            "total_rows": 0,
            "total_cols": 0,
            "missing_count": 0,
            "duplicate_rows_to_remove": 0,
            "duplicate_rows_pct": 0.0,
            "outliers_pct": 0.0,
            "rule_violations_pct": 0.0,
            "weights": {
                "missing": 0.20,
                "duplicate": 0.20,
                "outlier": 0.20,
                "rule_violation": 0.40
            },
            "formula": "100 - (0.20 × 0.00% + 0.20 × 0.00% + 0.20 × 0.00% + 0.40 × 0.00%)"
        }
        
    # Option B: Anomaly findings that are explicitly approved (fixed) or rejected (kept as-is)
    # by the user are resolved and do not deduct from the score in the after-metrics calculation.
    # Filter findings to count active/unresolved defects.
    active_findings = []
    for f in findings:
        if f.get("confidence") is not None and f.get("confidence") < 0.40:
            continue
        if is_after:
            # Only count pending_review items as active defects
            if f.get("status") == "pending_review":
                active_findings.append(f)
        else:
            # For before metrics, count everything (except reviewed_no_action, which doesn't exist yet)
            if f.get("status") != "reviewed_no_action":
                active_findings.append(f)

    # Calculate missing values count
    if is_after:
        missing_count = sum(1 for f in active_findings if f.get("issue_type") == "missing_value")
    else:
        missing_count = int(df.isna().sum().sum())
    missing_pct = float(missing_count / total_cells) if total_cells > 0 else 0.0
    
    # Calculate duplicate rate
    if is_after:
        duplicate_rows_to_remove = sum(1 for f in active_findings if f.get("issue_type") == "duplicate")
    else:
        duplicate_rows_to_remove = int(df.duplicated().sum())
    duplicate_rows = duplicate_rows_to_remove * 2
    duplicate_rate = float(duplicate_rows_to_remove / total_rows) if total_rows > 0 else 0.0
    
    # Calculate outliers and rule violations based on findings (deduplicated by row_index)
    outliers_flagged_rows = set()
    rule_violations_rows = set()
    
    for f in active_findings:
        issue = f.get("issue_type")
        row_idx = f.get("row_index")
        if issue == "outlier":
            outliers_flagged_rows.add(row_idx)
        elif issue in ["rule_violation", "cross_field_mismatch"]:
            rule_violations_rows.add(row_idx)
            
    outliers_flagged = len(outliers_flagged_rows)
    rule_violations = len(rule_violations_rows)

    # Calculate exact issue percentages (ratios * 100)
    missing_pct_val = float(round(missing_pct * 100, 2))
    duplicate_pct_val = float(round(duplicate_rate * 100, 2))
    outlier_pct_val = float(round((outliers_flagged / total_rows * 100), 2)) if total_rows > 0 else 0.0
    rule_pct_val = float(round((rule_violations / total_rows * 100), 2)) if total_rows > 0 else 0.0

    # Weights configuration: missing 0.20, duplicate 0.20, outlier 0.20, rule 0.40
    # Equation: 100 - (0.2 * missing_pct_val + 0.2 * duplicate_pct_val + 0.2 * outlier_pct_val + 0.4 * rule_pct_val)
    weighted_deduction = (
        0.20 * missing_pct_val +
        0.20 * duplicate_pct_val +
        0.20 * outlier_pct_val +
        0.40 * rule_pct_val
    )
    quality_score = max(0.0, float(round(100.0 - weighted_deduction, 2)))
    
    clamped_missing_pct = clamp_percentage(missing_pct_val, "missing_pct")
    clamped_quality_score = clamp_percentage(quality_score, "quality_score")
    
    formula_str = f"100 - (0.20 × {clamped_missing_pct:.2f}% + 0.20 × {duplicate_pct_val:.2f}% + 0.20 × {outlier_pct_val:.2f}% + 0.40 × {rule_pct_val:.2f}%)"
    
    return {
        "missing_pct": clamped_missing_pct,
        "duplicate_rows": duplicate_rows,
        "outliers_flagged": outliers_flagged,
        "rule_violations": rule_violations,
        "quality_score": clamped_quality_score,
        "total_rows": total_rows,
        "total_cols": total_cols,
        "missing_count": missing_count,
        "duplicate_rows_to_remove": duplicate_rows_to_remove,
        
        # New transparency fields:
        "duplicate_rows_pct": duplicate_pct_val,
        "outliers_pct": outlier_pct_val,
        "rule_violations_pct": rule_pct_val,
        "weights": {
            "missing": 0.20,
            "duplicate": 0.20,
            "outlier": 0.20,
            "rule_violation": 0.40
        },
        "formula": formula_str
    }
