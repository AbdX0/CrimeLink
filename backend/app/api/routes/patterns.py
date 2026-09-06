"""Read-only suspicious-pattern detection endpoints."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.services import patterns

router = APIRouter(prefix="/patterns", tags=["patterns"])


@router.get("/suspicious")
def suspicious(
    entity_type: Optional[str] = Query(default=None),
    zscore_threshold: float = Query(
        default=patterns.DEFAULT_ZSCORE_THRESHOLD, gt=0.0),
    hub_degree: int = Query(default=patterns.DEFAULT_HUB_DEGREE, ge=1),
    concentration_threshold: float = Query(
        default=patterns.DEFAULT_CONCENTRATION, gt=0.0, le=1.0),
    multihop_reach_threshold: int = Query(
        default=patterns.DEFAULT_MULTIHOP_REACH, ge=1),
    max_hops: int = Query(default=patterns.DEFAULT_MAX_HOPS, ge=1, le=5),
) -> dict:
    """Ranked rule-based suspicious-entity alerts (read-only)."""
    try:
        alerts = patterns.detect_suspicious_patterns(
            entity_type=entity_type,
            zscore_threshold=zscore_threshold,
            hub_degree=hub_degree,
            concentration_threshold=concentration_threshold,
            multihop_reach_threshold=multihop_reach_threshold,
            max_hops=max_hops,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Neo4j unavailable: {exc}")
    return {
        "count": len(alerts),
        "thresholds": {
            "zscore_threshold": zscore_threshold,
            "hub_degree": hub_degree,
            "concentration_threshold": concentration_threshold,
            "multihop_reach_threshold": multihop_reach_threshold,
            "max_hops": max_hops,
        },
        "alerts": alerts,
    }
