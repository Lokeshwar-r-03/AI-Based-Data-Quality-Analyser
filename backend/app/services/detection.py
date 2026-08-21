import pandas as pd
import numpy as np
from typing import List, Dict, Any
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

def run_detection(df_preprocessed: pd.DataFrame) -> List[Dict[str, Any]]:
    findings = []
    n_rows = len(df_preprocessed)
    if n_rows == 0:
        return findings

    # --- 1. Statistical Outlier Detection (Cell-level) ---
    stat_scores = {}  # (row, col) -> score
    raw_numeric_cols = df_preprocessed.select_dtypes(include=[np.number]).columns.tolist()
    numeric_cols = [c for c in raw_numeric_cols if not (c.lower() == "id" or c.lower().endswith("_id") or "id_" in c.lower())]

    for col in numeric_cols:
        series = df_preprocessed[col].dropna()
        if len(series) < 5:
            continue
        
        # Z-Score parameters
        mean = series.mean()
        std = series.std()
        
        # IQR parameters
        q1 = series.quantile(0.25)
        q3 = series.quantile(0.75)
        iqr = q3 - q1
        median = series.median()

        # Adjust thresholds for small datasets under 30 rows
        is_small_dataset = len(series) < 30
        z_thresh = 3.5 if is_small_dataset else 3.0
        iqr_thresh = 4.0 if is_small_dataset else 3.0

        for idx, val in df_preprocessed[col].items():
            if pd.isna(val):
                continue
            
            z_val = abs(val - mean) / std if std > 0 else 0.0
            iqr_dist = abs(val - median) / iqr if iqr > 0 else 0.0
            
            # Compute statistical anomaly intensity (0 to 1)
            z_score_stat = min(1.0, z_val / 6.0) if z_val > z_thresh else 0.0
            iqr_stat = min(1.0, iqr_dist / 4.0) if iqr_dist > iqr_thresh else 0.0
            
            score = max(z_score_stat, iqr_stat)
            if score > 0.25:
                stat_scores[(int(idx), str(col))] = float(score)

    # --- 2. ML Anomaly Detection (Row-level) ---
    ml_row_scores = np.zeros(n_rows)
    if len(numeric_cols) >= 1:
        X = df_preprocessed[numeric_cols].copy()
        for col in numeric_cols:
            median_val = X[col].median()
            if pd.isna(median_val):
                median_val = 0.0
            X[col] = X[col].fillna(median_val)
        
        try:
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)
            
            iso = IsolationForest(contamination='auto', random_state=42)
            iso.fit(X_scaled)
            raw_scores = iso.score_samples(X_scaled)
            
            min_s = raw_scores.min()
            max_s = raw_scores.max()
            if max_s > min_s:
                # Invert so that 1.0 is most anomalous, 0.0 is normal
                ml_row_scores = 1.0 - (raw_scores - min_s) / (max_s - min_s)
            else:
                ml_row_scores = np.zeros(n_rows)
        except Exception:
            ml_row_scores = np.zeros(n_rows)

    # --- 3. Rule-based Basic Checks (Missing & Duplicates) ---
    # Missing values
    for col in df_preprocessed.columns:
        for idx, val in df_preprocessed[col].items():
            if pd.isna(val):
                pos = df_preprocessed.index.get_loc(idx)
                findings.append({
                    "row_index": int(idx),
                    "column": str(col),
                    "issue_type": "missing_value",
                    "stat_score": 0.0,
                    "ml_score": float(ml_row_scores[pos]),
                    "rule_score": 1.0,
                    "rule_violation": True,
                    "before_value": ""
                })

    # Duplicate rows
    duplicates = df_preprocessed.duplicated(keep="first")
    for idx, is_dup in duplicates.items():
        if is_dup:
            pos = df_preprocessed.index.get_loc(idx)
            findings.append({
                "row_index": int(idx),
                "column": "ALL_COLUMNS",
                "issue_type": "duplicate",
                "stat_score": 0.0,
                "ml_score": float(ml_row_scores[pos]),
                "rule_score": 1.0,
                "rule_violation": True,
                "before_value": "Duplicate Row"
            })

    # Add statistical outliers
    for (idx, col), stat_score in stat_scores.items():
        # Avoid creating duplicate findings for the same row
        row_has_outlier = any(f["row_index"] == idx and f["issue_type"] == "outlier" for f in findings)
        if not row_has_outlier:
            val = df_preprocessed.at[idx, col]
            pos = df_preprocessed.index.get_loc(idx)
            findings.append({
                "row_index": idx,
                "column": col,
                "issue_type": "outlier",
                "stat_score": stat_score,
                "ml_score": float(ml_row_scores[pos]),
                "rule_score": 0.0,
                "rule_violation": False,
                "before_value": str(val)
            })

    return findings
