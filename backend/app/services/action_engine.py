import re
import pandas as pd
import numpy as np
import logging
from typing import List, Dict, Any, Tuple
from app.core.config import settings

logger = logging.getLogger("app.services.action_engine")

def get_default_action(issue_type: str, column: str) -> str:
    """
    Determines a deterministic fallback action if Gemini recommended action is unavailable.
    """
    issue = str(issue_type).lower()
    col = str(column).lower()
    
    if issue == "missing_value":
        if "email" in col or "phone" in col or "contact" in col or "id" in col:
            return "flag_for_review"  # Cannot safely impute unique customer info
        return "impute"
    elif issue == "duplicate":
        return "drop"
    elif issue == "outlier":
        return "cap"
    elif issue == "invalid_format":
        return "normalize_format"
    elif issue == "rule_violation":
        if "total" in col or "amount" in col:
            return "correct_formula"
        return "flag_for_review"
    elif issue == "cross_field_mismatch":
        return "flag_for_review"
    return "keep_no_action"

def apply_finding_fix(df: pd.DataFrame, finding: Dict[str, Any], action: str, mapping: Dict[str, str]) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Applies a clean fix on the dataframe for a single finding.
    Returns the updated dataframe and a dictionary of execution logs.
    """
    row_idx = finding.get("row_index")
    col = finding.get("column")
    issue_type = finding.get("issue_type")
    
    if row_idx not in df.index:
        return df, {"applied": False, "reason": "Row index no longer exists (was likely dropped by a prior action)"}
        
    before_val = df.at[row_idx, col] if col != "ALL_COLUMNS" else "Row"
    after_val = before_val
    applied = False
    reasoning = ""

    # Enforce safe casting of row index
    row_idx_cast = df.index[df.index == row_idx][0]

    if action == "drop":
        if issue_type == "duplicate":
            # Check if there is another row in df with the same values
            row_series = df.loc[row_idx_cast]
            other_rows = df.drop(index=row_idx_cast)
            has_other_copy = False
            for _, other_row in other_rows.iterrows():
                if other_row.equals(row_series):
                    has_other_copy = True
                    break
            
            if not has_other_copy:
                # Last remaining copy, do not drop!
                return df, {
                    "applied": False,
                    "before_value": str(before_val) if before_val is not None else "",
                    "after_value": str(before_val) if before_val is not None else "",
                    "reasoning": "Kept this copy of the duplicate row to preserve at least one record.",
                    "action_taken": "keep_no_action"
                }

        df = df.drop(index=row_idx_cast)
        applied = True
        after_val = None
        reasoning = f"Dropped duplicate/corrupted row at index {row_idx}"
        
    elif action == "impute" and col != "ALL_COLUMNS":
        # Impute missing values
        if df[col].dtype == "object":
            # Impute string with mode or default placeholder
            mode_series = df[col].dropna().mode()
            mode_val = mode_series.iloc[0] if not mode_series.empty else "Unknown"
            df.at[row_idx_cast, col] = mode_val
            after_val = mode_val
            reasoning = f"Imputed missing categorical value with column mode: '{mode_val}'"
            applied = True
        elif pd.api.types.is_datetime64_any_dtype(df[col]):
            # Impute datetime with mode
            mode_series = df[col].dropna().mode()
            mode_val = mode_series.iloc[0] if not mode_series.empty else pd.Timestamp.now()
            df.at[row_idx_cast, col] = mode_val
            after_val = str(pd.to_datetime(mode_val).strftime("%Y-%m-%d"))
            reasoning = f"Imputed missing date value with column mode: {after_val}"
            applied = True
        else:
            # Impute numeric with median
            median_val = df[col].dropna().median()
            if pd.isna(median_val):
                median_val = 0.0
            df.at[row_idx_cast, col] = median_val
            if isinstance(median_val, (pd.Timestamp, np.datetime64)):
                after_val = str(pd.to_datetime(median_val).strftime("%Y-%m-%d"))
            else:
                after_val = float(median_val)
            reasoning = f"Imputed missing numeric value with column median: {median_val}"
            applied = True

    elif action == "impute_mean" and col != "ALL_COLUMNS":
        mean_val = df[col].dropna().mean()
        if pd.isna(mean_val):
            mean_val = 0.0
        df.at[row_idx_cast, col] = mean_val
        after_val = float(mean_val)
        reasoning = f"Imputed missing numeric value with column mean: {mean_val:.2f}"
        applied = True

    elif action == "impute_median" and col != "ALL_COLUMNS":
        median_val = df[col].dropna().median()
        if pd.isna(median_val):
            median_val = 0.0
        df.at[row_idx_cast, col] = median_val
        after_val = float(median_val)
        reasoning = f"Imputed missing numeric value with column median: {median_val}"
        applied = True

    elif action == "impute_zero" and col != "ALL_COLUMNS":
        df.at[row_idx_cast, col] = 0.0
        after_val = 0.0
        reasoning = "Imputed missing numeric value with zero (0.0)"
        applied = True

    elif action == "impute_mode" and col != "ALL_COLUMNS":
        mode_series = df[col].dropna().mode()
        mode_val = mode_series.iloc[0] if not mode_series.empty else "Unknown"
        df.at[row_idx_cast, col] = mode_val
        after_val = mode_val
        reasoning = f"Imputed missing categorical value with column mode: '{mode_val}'"
        applied = True

    elif (action == "set_value" or action == "MANUAL_EDIT") and col != "ALL_COLUMNS":
        custom_val = finding.get("custom_value")
        if pd.api.types.is_numeric_dtype(df[col]):
            try:
                if str(custom_val).strip() == "":
                    df.at[row_idx_cast, col] = np.nan
                    after_val = ""
                else:
                    casted_val = pd.to_numeric(custom_val)
                    df.at[row_idx_cast, col] = casted_val
                    after_val = float(casted_val)
            except Exception:
                df.at[row_idx_cast, col] = custom_val
                after_val = custom_val
        else:
            df.at[row_idx_cast, col] = custom_val
            after_val = custom_val
        applied = True
        reasoning = f"Manually edited value to: '{custom_val}'"
            
    elif action == "cap" and col != "ALL_COLUMNS":
        # Cap outliers using IQR boundaries
        if np.issubdtype(df[col].dtype, np.number):
            q1 = df[col].quantile(0.25)
            q3 = df[col].quantile(0.75)
            iqr = q3 - q1
            upper_bound = q3 + 1.5 * iqr
            lower_bound = q1 - 1.5 * iqr
            
            # Cast bounds to integer if column is integer to prevent pandas assignment TypeError
            if np.issubdtype(df[col].dtype, np.integer):
                upper_bound = int(round(upper_bound))
                lower_bound = int(round(lower_bound))
            
            val = df.at[row_idx_cast, col]
            if pd.notna(val):
                if val > upper_bound:
                    df.at[row_idx_cast, col] = upper_bound
                    after_val = float(upper_bound)
                    reasoning = f"Capped outlier value {val} to upper IQR boundary {upper_bound}"
                    applied = True
                elif val < lower_bound:
                    df.at[row_idx_cast, col] = lower_bound
                    after_val = float(lower_bound)
                    reasoning = f"Capped outlier value {val} to lower IQR boundary {lower_bound}"
                    applied = True
                else:
                    reasoning = f"Value {val} is within IQR range [{lower_bound}, {upper_bound}]. No capping applied."
            else:
                reasoning = "Cannot cap missing value"
                
    elif action == "correct_formula":
        # Arithmetic correction total = quantity * unit_price
        qty_col = mapping.get("quantity")
        price_col = mapping.get("unit_price")
        total_col = mapping.get("total")
        
        if qty_col and price_col and total_col:
            qty_val = df.at[row_idx_cast, qty_col]
            price_val = df.at[row_idx_cast, price_col]
            
            if pd.notna(qty_val) and pd.notna(price_val):
                corrected_total = float(qty_val * price_val)
                df.at[row_idx_cast, total_col] = corrected_total
                after_val = corrected_total
                reasoning = f"Recalculated field '{total_col}' ({corrected_total}) to align with: {qty_col} ({qty_val}) * {price_col} ({price_val})"
                applied = True
            else:
                reasoning = "Failed to apply formula correction: dependent columns contain null values"
                
    elif action == "normalize_format" and col != "ALL_COLUMNS":
        val_str = str(before_val).strip()
        
        if "email" in col.lower() or "mail" in col.lower():
            normalized = val_str.lower()
            df.at[row_idx_cast, col] = normalized
            after_val = normalized
            reasoning = f"Normalized email string case to lowercase"
            applied = True
            
        elif any(k in col.lower() for k in ["date", "created", "timestamp", "time"]):
            try:
                dt = pd.to_datetime(val_str)
                normalized = dt.strftime("%Y-%m-%d")
                df.at[row_idx_cast, col] = normalized
                after_val = normalized
                reasoning = f"Parsed and formatted datetime string to ISO 8601 (YYYY-MM-DD)"
                applied = True
            except Exception:
                reasoning = f"Failed to normalize date format: '{val_str}' is unparseable"
                
        elif "phone" in col.lower() or "tel" in col.lower() or "contact" in col.lower():
            digits = re.sub(r"[^\d+]", "", val_str)
            df.at[row_idx_cast, col] = digits
            after_val = digits
            reasoning = f"Cleaned formatting characters. Extracted telephone digits: {digits}"
            applied = True
            
    elif action == "flag_for_review":
        reasoning = "Flagged for manual user follow-up; record value left unmodified."
        
    elif action == "keep_no_action":
        reasoning = "Kept original value without correction based on quality analysis."

    elif action == "leave_blank":
        reasoning = "Intentionally left blank by user opt-in."
        applied = True

    elif action == "drop":
        if row_idx_cast in df.index:
            df = df.drop(index=row_idx_cast)
            applied = True
            reasoning = f"Dropped entire row {row_idx_cast} due to invalid or violating values."
            after_val = "None"
        else:
            reasoning = f"Row {row_idx_cast} was already dropped or does not exist."
            applied = True
            after_val = "None"

    return df, {
        "applied": applied,
        "before_value": str(before_val) if before_val is not None and not pd.isna(before_val) else "",
        "after_value": str(after_val) if after_val is not None and not pd.isna(after_val) else "",
        "reasoning": reasoning
    }

def clean_dataset(df: pd.DataFrame, findings: List[Dict[str, Any]], fingerprint: Dict[str, Any], auto_threshold: float = None, review_threshold: float = None) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
    """
    Sequentially processes all findings to clean the dataset.
    Only auto-applies actions for findings with confidence >= threshold (default 0.85).
    Accepts optional per-user thresholds; falls back to global config when None.
    """
    threshold_auto = auto_threshold if auto_threshold is not None else settings.CONFIDENCE_THRESHOLD_AUTO
    threshold_review = review_threshold if review_threshold is not None else settings.CONFIDENCE_THRESHOLD_REVIEW

    df_cleaned = df.copy()
    audit_logs = []
    mapping = fingerprint.get("mapping", {})
    
    # Identify rows with rule violations (including email formats and cross field mismatches)
    rule_violating_rows = {
        f.get("row_index") for f in findings
        if f.get("rule_violation", False) or f.get("issue_type") in ["rule_violation", "invalid_format", "cross_field_mismatch"]
    }
    
    # Process findings: apply row drops first (sorted by drop actions) to avoid index mismatch
    # If we drop a row, subsequent cell edits on that row will be ignored.
    # So we sort findings: high confidence first, and 'drop' actions first.
    def get_sort_key(f):
        conf = f.get("confidence", 0.0)
        action = f.get("ai_recommended_action") or get_default_action(f.get("issue_type"), f.get("column"))
        action_priority = 0 if action == "drop" else 1
        return (-conf, action_priority)

    sorted_findings = sorted(findings, key=get_sort_key)
    dropped_row_indices = set()

    for f in sorted_findings:
        row_idx = f.get("row_index")
        if row_idx in dropped_row_indices:
            f["status"] = "auto_applied"
            f["action_taken"] = "drop"
            f["before_value"] = f.get("before_value", "")
            f["after_value"] = "None"
            f["reasoning"] = "Row was dropped due to duplicate or invalid data."
            audit_logs.append({
                "finding_id": f.get("id"),
                "action_taken": "drop",
                "reasoning": f["reasoning"],
                "changed_by": "system",
                "before_value": f["before_value"],
                "after_value": f["after_value"]
            })
            continue

        conf = f.get("confidence", 0.0)
        issue = f.get("issue_type")
        col = f.get("column")
        
        # Override action for genuine outliers (no rule violations on the row)
        if issue == "outlier" and f.get("row_index") not in rule_violating_rows:
            f["ai_recommended_action"] = "keep_no_action"
            
        action = f.get("ai_recommended_action") or get_default_action(issue, col)
        
        # Attempt auto-apply ONLY if confidence >= threshold_auto AND it is not a genuine outlier
        is_genuine_outlier = (issue == "outlier" and f.get("row_index") not in rule_violating_rows)
        
        applied_successfully = False
        
        if conf >= threshold_auto and not is_genuine_outlier:
            # Try applying fix
            df_temp, execution_info = apply_finding_fix(df_cleaned.copy(), f, action, mapping)
            
            # Check if a concrete fix was actually applied
            is_concrete_fix = action in [
                "drop", "impute", "impute_mean", "impute_median", "impute_mode",
                "impute_zero", "cap", "correct_formula", "normalize_format"
            ]
            
            if execution_info.get("applied", False) and is_concrete_fix:
                df_cleaned = df_temp # Accept the new dataframe state
                actual_action = execution_info.get("action_taken", action)
                if actual_action == "drop":
                    dropped_row_indices.add(row_idx)
                
                f["status"] = "auto_applied"
                f["action_taken"] = actual_action
                f["before_value"] = execution_info.get("before_value", f.get("before_value", ""))
                f["after_value"] = execution_info.get("after_value", "")
                f["reasoning"] = execution_info.get("reasoning", "")
                
                # Log system audit entry
                audit_logs.append({
                    "finding_id": f.get("id"),
                    "action_taken": actual_action,
                    "reasoning": f["reasoning"],
                    "changed_by": "system",
                    "before_value": f["before_value"],
                    "after_value": f["after_value"]
                })
                applied_successfully = True

        if not applied_successfully:
            # Resolve Queue / Human Review Needed
            if conf >= threshold_review or conf >= threshold_auto:
                f["status"] = "pending_review"
                proposed_action = action if action not in ["flag_for_review", "keep_no_action"] else get_default_action(issue, col)
                _, execution_info = apply_finding_fix(df_cleaned.copy(), f, proposed_action, mapping)
                
                f["action_taken"] = "flag_for_review"
                f["after_value"] = "Flagged for manual review — awaiting user input"
                f["reasoning"] = f.get("ai_explanation") or "No deterministic auto-fix available. Surfaced for user review."
            else:
                # Low confidence anomaly, kept as-is
                f["status"] = "reviewed_no_action"
                f["action_taken"] = "keep_no_action"
                f["after_value"] = f.get("before_value", "")
                f["reasoning"] = "Low confidence anomaly kept as-is."
                
                # Log system audit entry for reviewed_no_action
                audit_logs.append({
                    "finding_id": f.get("id"),
                    "action_taken": "keep_no_action",
                    "reasoning": f["reasoning"],
                    "changed_by": "system",
                    "before_value": f.get("before_value", ""),
                    "after_value": f["after_value"]
                })

    return df_cleaned, audit_logs
