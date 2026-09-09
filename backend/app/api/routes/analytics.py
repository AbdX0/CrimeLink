"""Network-analytics endpoints (read-only) over the Neo4j knowledge graph."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.services import analytics

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _503(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=str(exc))


@router.get("/degree-centrality")
def degree_centrality(
    entity_type: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=500),
) -> dict:
    """Degree centrality per entity (most-connected first)."""
    try:
        results = analytics.degree_centrality(
            entity_type=entity_type, limit=limit)
    except analytics.GdsUnavailableError as exc:  # pragma: no cover
        raise _503(exc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise _503(f"Neo4j unavailable: {exc}")
    return {"algorithm": "degree_centrality", "results": results}


@router.get("/pagerank")
def pagerank(
    limit: int = Query(default=20, ge=1, le=500),
    damping_factor: float = Query(default=0.85, gt=0.0, lt=1.0),
) -> dict:
    """PageRank scores per entity (requires Neo4j Graph Data Science)."""
    try:
        results = analytics.pagerank(
            limit=limit, damping_factor=damping_factor)
    except analytics.GdsUnavailableError as exc:
        raise _503(exc)
    except Exception as exc:
        raise _503(f"Neo4j unavailable: {exc}")
    return {"algorithm": "pagerank", "results": results}


@router.get("/communities")
def communities() -> dict:
    """Community detection (Louvain) — requires Neo4j Graph Data Science."""
    try:
        results = analytics.communities()
    except analytics.GdsUnavailableError as exc:
        raise _503(exc)
    except Exception as exc:
        raise _503(f"Neo4j unavailable: {exc}")
    return {"algorithm": "louvain", "results": results}


@router.get("/shortest-path")
def shortest_path(
    from_id: str = Query(..., min_length=1),
    to_id: str = Query(..., min_length=1),
    max_depth: int = Query(default=15, ge=1, le=50),
) -> dict:
    """Shortest path between two entities (by deterministic node id)."""
    try:
        result = analytics.shortest_path(
            from_id, to_id, max_depth=max_depth)
    except analytics.EntityNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise _503(f"Neo4j unavailable: {exc}")
    return {"algorithm": "shortest_path", **result}


@router.get("/key-influencers")
def key_influencers(
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    """Identify key network influencers (Kingpins, Brokers, Mules, Dispatchers)
    using graph centrality algorithms (Degree Centrality, PageRank, and Betweenness Centrality).
    """
    try:
        results = analytics.key_influencers(limit=limit)
    except Exception as exc:
        raise _503(f"Analytics computation failed: {exc}")
    return {
        "algorithm": "key_influencer_centrality",
        "metrics_used": ["PageRank", "Betweenness Centrality", "Degree Centrality"],
        "count": len(results),
        "results": results,
    }

