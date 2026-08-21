from app.core.config import settings

def calculate_confidence(stat_score: float, ml_score: float, rule_score: float, rule_violation: bool) -> float:
    w_stat = settings.CONFIDENCE_WEIGHT_STAT
    w_ml = settings.CONFIDENCE_WEIGHT_ML
    w_rule = settings.CONFIDENCE_WEIGHT_RULE
    
    # Calculate weighted confidence
    confidence = (w_stat * stat_score) + (w_ml * ml_score) + (w_rule * rule_score)
    
    # Hard rule violation forces confidence to at least the auto-apply threshold (default 0.85)
    if rule_violation:
        confidence = max(confidence, settings.CONFIDENCE_THRESHOLD_AUTO)
        
    return float(round(min(1.0, max(0.0, confidence)), 4))
