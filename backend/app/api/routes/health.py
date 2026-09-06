"""Health check endpoints.

Simple payloads used to verify the backend is running, including a Neo4j probe.
"""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict:
    """Return a basic health status."""
    return {"status": "ok"}


@router.get("/health/neo4j")
def neo4j_health() -> dict:
    """Return the Neo4j connectivity health status."""
    from app.neo4j import check_neo4j  # lazy: no Neo4j dependency at import time
    return check_neo4j()
