import time
import json
import logging
from typing import List, Dict, Any, Optional
from app.core.config import settings
from google import genai
from google.genai import types

logger = logging.getLogger("app.services.gemini")

# Mock interpretations matching the Shopify worked example in Section 17
MOCK_INTERPRETATIONS = {
    "outlier": {
        "likely_cause": "Legitimate high-value transaction by a VIP customer",
        "impact": "None. High order values are expected in the tail distribution of a store",
        "priority": "low",
        "recommended_action": "keep_no_action",
        "explanation": "The value sits in the extreme upper tail of its column distribution. Statistical detectors flagged it due to distance from the mean, but the value is internally consistent with the record's other fields. It is most likely a genuine high-value single-item order rather than a data entry error.",
        "resolution_suggestion": "No correction is needed. Keep the value as-is. You may want to tag this row in a separate 'VIP orders' segment for downstream reporting, but the data itself is clean."
    },
    "rule_violation_total": {
        "likely_cause": "Decimal point typing error (e.g. 180.00 instead of 18.00)",
        "impact": "Fails quantity * price = total check; inflates calculated gross revenue",
        "priority": "high",
        "recommended_action": "correct_formula",
        "explanation": "The total field does not satisfy the expected cross-field formula (quantity × unit_price). The deviation factor of ~10x is a strong indicator of a decimal placement error during manual data entry.",
        "resolution_suggestion": "Recalculate the total column using the formula: quantity × unit_price. Replace the current value with the computed result. If the source system allows it, add a database-level CHECK constraint to prevent this class of error from being inserted."
    },
    "duplicate": {
        "likely_cause": "Double transmission or page refresh during submission",
        "impact": "Artificially inflates transaction count and revenue statistics",
        "priority": "high",
        "recommended_action": "drop",
        "explanation": "This row is an exact duplicate of another record in the dataset. It shares identical values across all key fields, which strongly suggests a network retry, double-click, or ETL pipeline re-run introduced a redundant copy.",
        "resolution_suggestion": "Drop this duplicate row. Before deleting, verify the original record exists by checking for the same order_id or transaction_id. If the source system lacks idempotency controls, recommend adding a UNIQUE constraint on the primary identifier."
    },
    "rule_violation_qty": {
        "likely_cause": "Invalid negative entry or mislabeled refund action",
        "impact": "Violates logical quantity sign constraint",
        "priority": "high",
        "recommended_action": "flag_for_review",
        "explanation": "The quantity field contains a negative value, which violates the business rule that order quantities must be positive integers. This could be a mislabeled refund, a data entry error, or a sign reversal from a system integration.",
        "resolution_suggestion": "Flag for human review before taking any action. If this is a refund or return, move it to a separate returns table with its own schema. If it is a data entry error, correct the sign to positive. Do not auto-fix without understanding the business context."
    },
    "missing_value_email": {
        "likely_cause": "Failed CRM customer creation or missing mandatory field constraint in webform",
        "impact": "Incomplete order audit profile, unable to dispatch email receipt notifications",
        "priority": "medium",
        "recommended_action": "flag_for_review",
        "explanation": "The email field is empty for this record. Email is typically a mandatory field in e-commerce order systems. Its absence suggests either a guest checkout flow that bypassed email capture, or a CRM sync failure that left the field blank.",
        "resolution_suggestion": "Attempt to look up the customer's email using their customer_id in your CRM or ERP. If no match is found, flag the row for manual outreach or mark it with a placeholder like 'unknown@missing.local' so downstream email pipelines do not silently skip it."
    }
}

def get_mock_interpretation(finding: Dict[str, Any]) -> Dict[str, Any]:
    issue = finding.get("issue_type")
    col = finding.get("column", "")
    fid = finding.get("id", "mock-id")
    
    res = {
        "finding_id": fid,
        "likely_cause": "Likely a system integration error or manual typo",
        "impact": "Data inconsistency in fields",
        "priority": "medium",
        "recommended_action": "flag_for_review",
        "explanation": f"This record was flagged as '{issue}' on the '{col}' column by the detection pipeline. The statistical and rule-based signals suggest an anomaly, but the root cause cannot be determined without additional business context.",
        "resolution_suggestion": f"Review the '{col}' value manually. Check whether this aligns with expected business logic for this column, and decide whether to correct, impute, or retain the value based on its downstream impact."
    }
    
    if issue == "outlier":
        res.update(MOCK_INTERPRETATIONS["outlier"])
    elif issue == "duplicate":
        res.update(MOCK_INTERPRETATIONS["duplicate"])
    elif issue == "missing_value" and "email" in col.lower():
        res.update(MOCK_INTERPRETATIONS["missing_value_email"])
    elif issue == "rule_violation" and "total" in col.lower():
        res.update(MOCK_INTERPRETATIONS["rule_violation_total"])
    elif issue == "rule_violation" and ("qty" in col.lower() or "quantity" in col.lower()):
        res.update(MOCK_INTERPRETATIONS["rule_violation_qty"])
        
    return res

def check_ai_connectivity() -> bool:
    if not settings.AI_API_KEY or settings.AI_API_KEY.lower() == "mock":
        return False
    try:
        client = genai.Client(api_key=settings.AI_API_KEY)
        # Check connectivity by listing models
        client.models.list()
        return True
    except Exception:
        return False

def interpret_findings(findings: List[Dict[str, Any]], use_mock: bool = False) -> List[Dict[str, Any]]:
    if not findings:
        return []

    # Sort findings by confidence and severity (prioritize rule violations)
    sorted_findings = sorted(
        findings,
        key=lambda x: (x.get("rule_violation", False), x.get("confidence", 0.0)),
        reverse=True
    )
    
    # Cap at top 100
    top_findings = sorted_findings[:100]
    results = []

    # Check if API key is not present or is set to mock
    api_key = settings.AI_API_KEY
    if use_mock or not api_key or api_key.lower() == "mock":
        logger.info("Using mock AI interpretations")
        for f in top_findings:
            mock_res = get_mock_interpretation(f)
            mock_res["finding_id"] = f.get("id")
            results.append(mock_res)
        return results

    # Prepare batch data, stripping PII values
    batch_payload = []
    for f in top_findings:
        col = f.get("column", "")
        val = f.get("before_value", "")
        # Mask PII
        if any(pii in col.lower() for pii in ["email", "phone", "name", "customer_email"]):
            val = "[REDACTED PII]"
            
        batch_payload.append({
            "finding_id": f.get("id"),
            "column": col,
            "issue_type": f.get("issue_type"),
            "stat_score": f.get("stat_score"),
            "ml_score": f.get("ml_score"),
            "rule_score": f.get("rule_score"),
            "confidence": f.get("confidence"),
            "value": str(val)
        })

    prompt = f"""
You are a senior data-quality analyst reviewing a batch of flagged data anomalies from a business dataset.
For EACH finding in the JSON array below, produce a detailed, record-specific analysis. Be concrete — reference the actual column name, value, and detection scores.

For each finding output:
1. "explanation" — 2-4 sentences describing WHY this specific value was flagged, what the detection scores imply, and what the most likely real-world cause is. Do NOT use generic phrases like "flagged as outlier". Be specific.
2. "resolution_suggestion" — 2-4 sentences explaining in plain English exactly what a data engineer should DO to fix or handle this record, naming the specific method and why it is appropriate for this column and issue type. Include any caveats.
3. "recommended_action" — exactly one value from: ["impute", "drop", "cap", "correct_formula", "normalize_format", "flag_for_review", "keep_no_action"]
4. "likely_cause" — one short sentence naming the probable root cause.
5. "impact" — one short sentence describing downstream business impact if left unresolved.
6. "priority" — one of: ["low", "medium", "high"]

Rules:
- Never assert certainty — describe likelihood and reference the confidence score.
- Never fabricate values or reference columns not in the input.
- For PII columns the value is [REDACTED PII] — do not guess the value.
- Your "explanation" and "resolution_suggestion" must be written in natural English prose, not bullet points.

Input Findings Batch:
{json.dumps(batch_payload, indent=2)}
"""

    retries = 1
    delay = 2.0
    
    for attempt in range(retries + 1):
        try:
            client = genai.Client(api_key=api_key)
            
            # Request structured output via types.Type.ARRAY and Schema matching §9.2
            response = client.models.generate_content(
                model=settings.AI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=types.Schema(
                        type=types.Type.ARRAY,
                        items=types.Schema(
                            type=types.Type.OBJECT,
                            properties={
                                "finding_id": types.Schema(type=types.Type.STRING),
                                "likely_cause": types.Schema(type=types.Type.STRING),
                                "impact": types.Schema(type=types.Type.STRING),
                                "priority": types.Schema(
                                    type=types.Type.STRING,
                                    enum=["low", "medium", "high"]
                                ),
                                "recommended_action": types.Schema(
                                    type=types.Type.STRING,
                                    enum=["impute", "drop", "cap", "correct_formula", "normalize_format", "flag_for_review", "keep_no_action"]
                                ),
                                "explanation": types.Schema(type=types.Type.STRING),
                                "resolution_suggestion": types.Schema(type=types.Type.STRING)
                            },
                            required=["finding_id", "likely_cause", "recommended_action", "explanation", "resolution_suggestion"]
                        )
                    ),
                    system_instruction="You are a senior data-quality analyst. For each finding produce a specific, concrete analysis referencing the actual column name and value. Output a JSON array.",
                    http_options={"timeout": 30.0}
                )
            )
            
            parsed = json.loads(response.text)
            if isinstance(parsed, list):
                return parsed
            else:
                logger.warning(f"Unexpected response structure: {response.text}")
                
        except Exception as e:
            logger.warning(f"AI API attempt {attempt + 1} failed: {str(e)}")
            if attempt < retries:
                time.sleep(delay)
                delay *= 2
            else:
                logger.error("AI API call failed after retries. Falling back to mock interpretations.")
                fallback_results = []
                for f in top_findings:
                    mock_res = get_mock_interpretation(f)
                    mock_res["finding_id"] = f.get("id")
                    fallback_results.append(mock_res)
                return fallback_results

    return []
