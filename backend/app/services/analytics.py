"""Network-analytics service (read-only) over the Neo4j knowledge graph.

Algorithms:

- **Degree centrality** — pure Cypher (count of relationships per entity), no
  plugin required.
- **Shortest path** — pure Cypher ``shortestPath`` between two entity ids.
- **PageRank** — Neo4j Graph Data Science (``gds.pageRank.stream``).
- **Community detection** — Neo4j Graph Data Science (``gds.louvain.stream``).

GDS-based algorithms run on a temporary, in-memory graph projection which is
dropped after use; stored graph data is never modified or deleted. If the GDS
plugin is not installed, a ``GdsUnavailableError`` is raised with a clear
message (surfaced as HTTP 503) instead of failing silently.
"""

from typing import Optional

from neo4j import Driver

from app.neo4j import get_driver
from app.services import graph

# Temporary in-memory projection used by GDS algorithms.
PROJECTION_NAME = "crimelink_analytics"

# Cap on shortest-path search depth (relationships traversed).
DEFAULT_MAX_DEPTH = 15


class GdsUnavailableError(Exception):
    """Raised when the Neo4j Graph Data Science plugin is not available."""


class EntityNotFoundError(Exception):
    """Raised when a referenced entity does not exist in the graph."""


def _run(session, query: str, params: Optional[dict] = None) -> list[dict]:
    """Run a query and materialize results as a list of dicts."""
    return session.run(query, params or {}).data()


def _check_gds(session) -> str:
    """Return the GDS plugin version or raise GdsUnavailableError."""
    try:
        rows = _run(session, "CALL gds.version() YIELD version RETURN version")
    except Exception as exc:
        raise GdsUnavailableError(
            f"Neo4j Graph Data Science is unavailable: {exc}"
        ) from exc
    if not rows:
        raise GdsUnavailableError(
            "Neo4j Graph Data Science is unavailable on this server."
        )
    return rows[0]["version"]


def _project(session) -> None:
    """Create the temporary in-memory projection (drops any stale one first).

    Only creates an ephemeral read-model; stored graph data is untouched.
    """
    try:
        _run(
            session,
            "CALL gds.graph.drop($name) YIELD graphName",
            {"name": PROJECTION_NAME},
        )
    except Exception:
        pass  # no stale projection — fine
    _run(
        session,
        "CALL gds.graph.project($name, $labels, $relTypes)",
        {
            "name": PROJECTION_NAME,
            "labels": sorted(graph.ENTITY_TYPES),
            "relTypes": sorted(graph.RELATIONSHIP_TYPES),
        },
    )


def _drop_projection(session) -> None:
    """Drop the temporary in-memory projection (best effort)."""
    try:
        _run(
            session,
            "CALL gds.graph.drop($name) YIELD graphName",
            {"name": PROJECTION_NAME},
        )
    except Exception:
        pass


def degree_centrality(entity_type: Optional[str] = None, limit: int = 20,
                      driver: Optional[Driver] = None) -> list[dict]:
    """Undirected degree centrality per entity (pure Cypher, no GDS).

    Returns a list of {entity_id, name, labels, degree} sorted by degree.
    """
    d = driver or get_driver()
    label = graph._validate_entity_type(entity_type) if entity_type else None
    where = f":{label}" if label else ""
    query = (
        f"MATCH (n{where}) WHERE n.id IS NOT NULL "
        "OPTIONAL MATCH (n)-[r]-() "
        "RETURN n.id AS entity_id, n.name AS name, labels(n) AS labels, "
        "count(r) AS degree "
        "ORDER BY degree DESC LIMIT $limit"
    )
    with d.session() as session:
        rows = _run(session, query, {"limit": limit})
    return [
        {
            "entity_id": r["entity_id"],
            "name": r.get("name"),
            "labels": r.get("labels", []),
            "degree": int(r["degree"]),
        }
        for r in rows
    ]


def shortest_path(from_id: str, to_id: str, max_depth: int = DEFAULT_MAX_DEPTH,
                  driver: Optional[Driver] = None) -> dict:
    """Shortest path between two entity ids (pure Cypher, no GDS).

    Raises EntityNotFoundError if either entity does not exist. Returns
    {from_id, to_id, found, path, length}; found is False when the entities
    exist but are not connected.
    """
    d = driver or get_driver()
    depth = max(1, int(max_depth))
    with d.session() as session:
        rows = _run(
            session,
            "MATCH (a) WHERE a.id IN [$from_id, $to_id] "
            "RETURN count(DISTINCT a) AS c",
            {"from_id": from_id, "to_id": to_id},
        )
        existing = rows[0]["c"] if rows else 0
        if existing < 2:
            raise EntityNotFoundError(
                "One or both entities not found in the graph: "
                f"{from_id!r}, {to_id!r}"
            )
        rows = _run(
            session,
            f"MATCH (a {{id: $from_id}}), (b {{id: $to_id}}) "
            f"MATCH p = shortestPath((a)-[*..{depth}]-(b)) "
            "RETURN [x IN nodes(p) | x.id] AS path, length(p) AS length",
            {"from_id": from_id, "to_id": to_id},
        )
    if not rows:
        return {
            "from_id": from_id, "to_id": to_id,
            "found": False, "path": [], "length": None,
        }
    return {
        "from_id": from_id, "to_id": to_id, "found": True,
        "path": rows[0]["path"], "length": int(rows[0]["length"]),
    }


def pagerank(limit: int = 20, damping_factor: float = 0.85,
             driver: Optional[Driver] = None) -> list[dict]:
    """PageRank scores via GDS (requires the Graph Data Science plugin).

    Returns {entity_id, name, labels, score} sorted by score descending.
    """
    d = driver or get_driver()
    with d.session() as session:
        _check_gds(session)
        _project(session)
        try:
            rows = _run(
                session,
                "CALL gds.pageRank.stream($name, {dampingFactor: $damping}) "
                "YIELD nodeId, score "
                "WITH gds.util.asNode(nodeId) AS n, score "
                "WHERE n.id IS NOT NULL "
                "RETURN n.id AS entity_id, n.name AS name, "
                "labels(n) AS labels, score "
                "ORDER BY score DESC LIMIT $limit",
                {"name": PROJECTION_NAME, "damping": float(damping_factor),
                 "limit": limit},
            )
        finally:
            _drop_projection(session)
    return [
        {
            "entity_id": r["entity_id"],
            "name": r.get("name"),
            "labels": r.get("labels", []),
            "score": float(r["score"]),
        }
        for r in rows
    ]


def communities(driver: Optional[Driver] = None) -> list[dict]:
    """Community detection (Louvain) via GDS.

    Returns {entity_id, name, labels, community_id} per entity.
    """
    d = driver or get_driver()
    with d.session() as session:
        _check_gds(session)
        _project(session)
        try:
            rows = _run(
                session,
                "CALL gds.louvain.stream($name) "
                "YIELD nodeId, communityId "
                "WITH gds.util.asNode(nodeId) AS n, communityId "
                "WHERE n.id IS NOT NULL "
                "RETURN n.id AS entity_id, n.name AS name, "
                "labels(n) AS labels, communityId AS community_id "
                "ORDER BY community_id, entity_id",
                {"name": PROJECTION_NAME},
            )
        finally:
            _drop_projection(session)
    return [
        {
            "entity_id": r["entity_id"],
            "name": r.get("name"),
            "labels": r.get("labels", []),
            "community_id": r["community_id"],
        }
        for r in rows
    ]

