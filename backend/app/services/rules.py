import re
import pandas as pd
import numpy as np
from typing import List, Dict, Any

# Email Validation Fallback
try:
    from email_validator import validate_email, EmailNotValidError
    EMAIL_VALIDATOR_AVAILABLE = True
except ImportError:
    EMAIL_VALIDATOR_AVAILABLE = False
    validate_email = None

def is_valid_email(email: str) -> bool:
    if not email or pd.isna(email):
        return True  # Handled by missing value checks
    email_str = str(email).strip()
    if EMAIL_VALIDATOR_AVAILABLE:
        try:
            validate_email(email_str, check_deliverability=False)
            return True
        except Exception:
            return False
    else:
        # Regex fallback
        email_regex = r"^[\w\.-]+@[\w\.-]+\.\w+$"
        return bool(re.match(email_regex, email_str))

# Country - Currency - Phone Prefix mapping
COUNTRY_MAPPING = {
    "US": {"currency": "USD", "phone_prefix": "1", "names": ["us", "usa", "united states"]},
    "CA": {"currency": "CAD", "phone_prefix": "1", "names": ["ca", "canada"]},
    "GB": {"currency": "GBP", "phone_prefix": "44", "names": ["gb", "gbr", "uk", "united kingdom", "britain"]},
    "IN": {"currency": "INR", "phone_prefix": "91", "names": ["in", "india"]},
    "AU": {"currency": "AUD", "phone_prefix": "61", "names": ["au", "australia"]}
}

def check_country_consistency(country_val: Any, currency_val: Any, phone_val: Any) -> List[str]:
    mismatches = []
    if pd.isna(country_val):
        return mismatches

    country_str = str(country_val).strip().lower()
    
    # Identify the matching country profile
    matched_country = None
    for code, info in COUNTRY_MAPPING.items():
        if country_str == code.lower() or country_str in info["names"]:
            matched_country = info
            break
            
    if not matched_country:
        return mismatches  # Unknown country, skip cross-field checks

    # Validate Currency
    if pd.notna(currency_val):
        curr_str = str(currency_val).strip().upper()
        if curr_str != matched_country["currency"]:
            mismatches.append(f"Currency {curr_str} does not match expected {matched_country['currency']} for country {country_val}")
            
    # Validate Phone
    if pd.notna(phone_val):
        phone_str = re.sub(r"\D", "", str(phone_val))  # Keep digits only
        prefix = matched_country["phone_prefix"]
        # Check if phone starts with the country phone prefix
        if len(phone_str) > 0 and not phone_str.startswith(prefix):
            mismatches.append(f"Phone number does not match prefix {prefix} for country {country_val}")
            
    return mismatches

def run_contextual_validation(df: pd.DataFrame, fingerprint: Dict[str, Any], existing_findings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rule_findings = []
    mapping = fingerprint.get("mapping", {})
    
    # Find mapped columns
    order_id_col = mapping.get("order_id")
    email_col = mapping.get("customer_email") or mapping.get("email")
    qty_col = mapping.get("quantity")
    price_col = mapping.get("unit_price")
    total_col = mapping.get("total")
    country_col = mapping.get("country")
    currency_col = mapping.get("currency")
    phone_col = mapping.get("phone")
    created_at_col = mapping.get("created_at") or mapping.get("order_date")
    
    # Check date range columns (if we have a start/end date rule)
    start_date_col = mapping.get("start_date")
    end_date_col = mapping.get("end_date")

    # Run checks row by row
    for idx, row in df.iterrows():
        ml_score = 0.0
        
        # Get existing ML score for this row if available (for consistency)
        row_findings = [f for f in existing_findings if f["row_index"] == idx]
        if row_findings:
            ml_score = row_findings[0]["ml_score"]

        # 1. Arithmetic Consistency (quantity * unit_price = total)
        if qty_col and price_col and total_col:
            qty_val = row[qty_col]
            price_val = row[price_col]
            total_val = row[total_col]
            
            if pd.notna(qty_val) and pd.notna(price_val) and pd.notna(total_val):
                expected_total = qty_val * price_val
                # Check for arithmetic consistency with tolerance
                if abs(expected_total - total_val) > 0.01:
                    rule_findings.append({
                        "row_index": int(idx),
                        "column": str(total_col),
                        "issue_type": "rule_violation",
                        "stat_score": 0.0,
                        "ml_score": ml_score,
                        "rule_score": 1.0,
                        "rule_violation": True,
                        "before_value": f"{total_val} (qty: {qty_val}, price: {price_val})"
                    })

        # 2. Date Relationship (end_date > start_date)
        if start_date_col and end_date_col:
            start_val = row[start_date_col]
            end_val = row[end_date_col]
            
            if pd.notna(start_val) and pd.notna(end_val):
                try:
                    start_dt = pd.to_datetime(start_val)
                    end_dt = pd.to_datetime(end_val)
                    if end_dt <= start_dt:
                        rule_findings.append({
                            "row_index": int(idx),
                            "column": str(end_date_col),
                            "issue_type": "rule_violation",
                            "stat_score": 0.0,
                            "ml_score": ml_score,
                            "rule_score": 1.0,
                            "rule_violation": True,
                            "before_value": f"end_date: {end_val} <= start_date: {start_val}"
                        })
                except Exception:
                    pass

        # 3. Format Validation (Emails)
        if email_col:
            email_val = row[email_col]
            if pd.notna(email_val) and str(email_val).strip() != "":
                if not is_valid_email(email_val):
                    rule_findings.append({
                        "row_index": int(idx),
                        "column": str(email_col),
                        "issue_type": "invalid_format",
                        "stat_score": 0.0,
                        "ml_score": ml_score,
                        "rule_score": 1.0,
                        "rule_violation": True,
                        "before_value": str(email_val)
                    })

        # 4. Quantity Sign Check (Must be >= 0)
        if qty_col:
            qty_val = row[qty_col]
            if pd.notna(qty_val) and qty_val < 0:
                rule_findings.append({
                    "row_index": int(idx),
                    "column": str(qty_col),
                    "issue_type": "rule_violation",
                    "stat_score": 0.0,
                    "ml_score": ml_score,
                    "rule_score": 1.0,
                    "rule_violation": True,
                    "before_value": str(qty_val)
                })

        # 5. Cross-field Consistency (Country ↔ Currency ↔ Phone)
        country_val = row[country_col] if country_col else None
        currency_val = row[currency_col] if currency_col else None
        phone_val = row[phone_col] if phone_col else None
        
        if country_val and (currency_val or phone_val):
            mismatches = check_country_consistency(country_val, currency_val, phone_val)
            for mismatch_msg in mismatches:
                # Determine which column is more likely the problem (flag country or the field)
                flagged_col = country_col
                if "Currency" in mismatch_msg:
                    flagged_col = currency_col
                elif "Phone" in mismatch_msg:
                    flagged_col = phone_col
                    
                rule_findings.append({
                    "row_index": int(idx),
                    "column": str(flagged_col),
                    "issue_type": "cross_field_mismatch",
                    "stat_score": 0.0,
                    "ml_score": ml_score,
                    "rule_score": 1.0,
                    "rule_violation": True,
                    "before_value": f"{row[flagged_col]} ({mismatch_msg})"
                })

    return rule_findings
