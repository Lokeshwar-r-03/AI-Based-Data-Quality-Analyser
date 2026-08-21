import re
from typing import Dict, Any, List

DOMAIN_SIGNATURES = {
    "e-commerce order": {
        "patterns": {
            "order_id": [r"^order[-_]?id$", r"^id$", r"^transaction[-_]?id$"],
            "created_at": [r"^created[-_]?at$", r"^order[-_]?date$", r"^date$", r"^timestamp$"],
            "customer_email": [r"^customer[-_]?email$", r"^email$", r"^buyer[-_]?email$", r"^mail$"],
            "quantity": [r"^quantity$", r"^qty$", r"^items$"],
            "unit_price": [r"^unit[-_]?price$", r"^price$", r"^item[-_]?price$", r"^cost$"],
            "total": [r"^total$", r"^amount$", r"^order[-_]?total$", r"^revenue$"],
            "country": [r"^country$", r"^nation$", r"^shipping[-_]?country$"],
            "currency": [r"^currency$", r"^coin$"],
            "phone": [r"^phone$", r"^telephone$", r"^mobile$", r"^contact[-_]?number$"]
        },
        "required_keys": ["order_id", "quantity", "unit_price", "total"]
    },
    "customer crm": {
        "patterns": {
            "customer_id": [r"^customer[-_]?id$", r"^user[-_]?id$", r"^id$"],
            "first_name": [r"^first[-_]?name$", r"^fname$", r"^name$"],
            "last_name": [r"^last[-_]?name$", r"^lname$"],
            "email": [r"^email$", r"^mail$", r"^customer[-_]?email$"],
            "phone": [r"^phone$", r"^telephone$", r"^mobile$"],
            "country": [r"^country$", r"^nation$", r"^city$"],
            "created_at": [r"^created[-_]?at$", r"^date$", r"^joined$"]
        },
        "required_keys": ["customer_id", "email"]
    }
}

def detect_domain(columns: List[str]) -> Dict[str, Any]:
    matched_domain = "generic"
    max_confidence = 0.0
    matched_columns_mapping = {}

    for domain_name, sig in DOMAIN_SIGNATURES.items():
        patterns = sig["patterns"]
        matches = {}
        matched_count = 0
        
        # Iterate over logical keys and try to find matching columns in df
        for key, pattern_list in patterns.items():
            for col_name in columns:
                col_lower = str(col_name).lower().strip()
                for pat in pattern_list:
                    if re.search(pat, col_lower):
                        matches[key] = col_name
                        matched_count += 1
                        break
                if key in matches:
                    break
        
        confidence = matched_count / len(patterns) if len(patterns) > 0 else 0.0
        
        # Verify required keys are present
        required_matched = all(req in matches for req in sig["required_keys"])
        if required_matched and confidence > max_confidence:
            max_confidence = confidence
            matched_domain = domain_name
            matched_columns_mapping = matches

    if max_confidence < 0.35:
        matched_domain = "generic"
        max_confidence = 0.0
        matched_columns_mapping = {}

    return {
        "domain": matched_domain,
        "confidence": float(round(max_confidence, 2)),
        "mapping": matched_columns_mapping
    }
