import pandas as pd
import numpy as np
from typing import List, Dict, Any

def profile_dataframe(df: pd.DataFrame) -> List[Dict[str, Any]]:
    profiles = []
    for col in df.columns:
        # Get missing count and total rows
        missing_count = int(df[col].isna().sum())
        total_count = len(df)
        missing_pct = float(missing_count / total_count) if total_count > 0 else 0.0

        # Unique values
        unique_count = int(df[col].nunique())

        # Sample values - make sure they are JSON serializable
        sample_series = df[col].dropna().unique()[:5]
        sample_values = []
        for val in sample_series:
            if isinstance(val, (np.integer, np.int64)):
                sample_values.append(int(val))
            elif isinstance(val, (np.floating, np.float64)):
                if np.isnan(val) or np.isinf(val):
                    sample_values.append(None)
                else:
                    sample_values.append(float(val))
            elif isinstance(val, (pd.Timestamp, np.datetime64)):
                sample_values.append(str(val))
            elif isinstance(val, bool):
                sample_values.append(val)
            else:
                sample_values.append(str(val))

        profiles.append({
            "name": str(col),
            "dtype": str(df[col].dtype),
            "missing_pct": missing_pct,
            "unique_count": unique_count,
            "sample_values": sample_values
        })
    return profiles
