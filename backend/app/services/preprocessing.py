import pandas as pd
import numpy as np
from typing import Dict, Any

def preprocess_dataframe(df: pd.DataFrame, schema_fingerprint: Dict[str, Any]) -> pd.DataFrame:
    df_clean = df.copy()
    
    mapping = schema_fingerprint.get("mapping", {})
    
    # 1. Normalization of string values
    for col in df_clean.columns:
        # Check if column is object/string type
        if df_clean[col].dtype == "object":
            # Apply strip, but keep nan objects intact
            df_clean[col] = df_clean[col].apply(lambda x: str(x).strip() if pd.notna(x) else x)
            # Replace common empty value strings with np.nan
            null_strings = ["", "nan", "NAN", "NaN", "null", "NULL", "none", "None", "n/a", "N/A", "undefined"]
            df_clean[col] = df_clean[col].replace(null_strings, np.nan)
            
    # 2. Type casting based on identified columns in the schema mapping
    # NOTE: customer_id and order_id are intentionally excluded — these are often
    # alphanumeric identifiers (e.g. ORD1000) and must NOT be coerced to numeric.
    numeric_logical_keys = ["quantity", "unit_price", "total", "price", "items", "cost", "amount"]
    date_logical_keys = ["created_at", "order_date", "date", "timestamp", "shipped_at", "end_date", "start_date"]

    for key, col_name in mapping.items():
        if col_name not in df_clean.columns:
            continue
            
        # If mapped to a numeric field, coerce values to numeric
        if any(k in key for k in numeric_logical_keys):
            # Clean symbols like currency ($) or commas if it is an object column
            if df_clean[col_name].dtype == "object":
                df_clean[col_name] = df_clean[col_name].astype(str).str.replace(r"[^\d.-]", "", regex=True)
            df_clean[col_name] = pd.to_numeric(df_clean[col_name], errors="coerce")
            
        # If mapped to a datetime field, coerce to datetime
        elif any(k in key for k in date_logical_keys):
            df_clean[col_name] = pd.to_datetime(df_clean[col_name], errors="coerce")

    # 3. Clean unmapped columns if they look numeric
    for col in df_clean.columns:
        if col in mapping.values():
            continue
        if df_clean[col].dtype == "object":
            # Check if majority of non-null values can be converted to numbers
            non_null_mask = df_clean[col].notna()
            if non_null_mask.sum() > 0:
                conv = pd.to_numeric(df_clean[col], errors="coerce")
                if conv.notna().sum() / non_null_mask.sum() > 0.8:
                    df_clean[col] = conv

    return df_clean
