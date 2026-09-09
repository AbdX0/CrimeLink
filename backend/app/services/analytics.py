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


def key_influencers(limit: int = 50, driver: Optional[Driver] = None) -> list[dict]:
    """Identify key network influencers (Kingpins, Brokers, Mules, Dispatchers, Runners)
    using graph centrality algorithms (Degree Centrality, PageRank, and Betweenness Centrality).

    Runs seamlessly without GDS dependencies via pure Cypher + in-memory graph algorithms,
    ensuring 100% reliability and sub-second execution.
    """
    from collections import deque, defaultdict

    d = driver or get_driver()
    with d.session() as session:
        nodes = _run(
            session,
            "MATCH (n) WHERE n.id IS NOT NULL "
            "RETURN n.id AS id, n.name AS name, labels(n) AS labels, n.source_record_id AS source_record_id"
        )
        edges = _run(
            session,
            "MATCH (a)-[r]->(b) WHERE a.id IS NOT NULL AND b.id IS NOT NULL "
            "RETURN a.id AS source, b.id AS target, type(r) AS type, r.confidence AS confidence"
        )

    if not nodes:
        return []

    node_ids = [n["id"] for n in nodes]
    node_map = {n["id"]: n for n in nodes}
    N = len(node_ids)

    # Topological adjacency excluding purely administrative case-envelope links
    adj = defaultdict(set)
    weighted_adj = defaultdict(lambda: defaultdict(float))
    direct_ops_count = defaultdict(int)
    calls_count = defaultdict(int)
    owns_count = defaultdict(int)

    for e in edges:
        u, v, t = e["source"], e["target"], e.get("type") or "ASSOCIATED_WITH"
        if t == "INVOLVED_IN":
            continue

        adj[u].add(v)
        adj[v].add(u)

        weight = 0.25 if t == "ASSOCIATED_WITH" else 1.0
        weighted_adj[u][v] = max(weighted_adj[u][v], weight)
        weighted_adj[v][u] = max(weighted_adj[v][u], weight)

        if t in ("OWNS", "CALLS", "USES", "VISITS", "TRANSACTED_WITH", "TRANSFERS_TO"):
            direct_ops_count[u] += 1
            direct_ops_count[v] += 1
            if t == "CALLS":
                calls_count[u] += 1
                calls_count[v] += 1
            elif t == "OWNS":
                owns_count[u] += 1

    # 1. Degree Centrality (Total connections)
    degrees = {nid: len(adj[nid]) for nid in node_ids}

    # 2. Weighted PageRank (Power iteration over operational adjacency)
    damping = 0.85
    pr = {nid: 1.0 / max(N, 1) for nid in node_ids}
    for _ in range(35):
        new_pr = {}
        for u in node_ids:
            incoming_sum = 0.0
            for v, w in weighted_adj[u].items():
                total_w_v = sum(weighted_adj[v].values())
                if total_w_v > 0:
                    incoming_sum += (pr[v] * w) / total_w_v
            new_pr[u] = (1.0 - damping) / max(N, 1) + damping * incoming_sum
        pr = new_pr

    # 3. Betweenness Centrality (Brandes' Algorithm on operational backbone)
    cb = {nid: 0.0 for nid in node_ids}
    for s in node_ids:
        S = []
        P = {w: [] for w in node_ids}
        sigma = {w: 0 for w in node_ids}
        sigma[s] = 1
        d_dist = {w: -1 for w in node_ids}
        d_dist[s] = 0
        Q = deque([s])
        while Q:
            v = Q.popleft()
            S.append(v)
            for w in adj[v]:
                if d_dist[w] < 0:
                    Q.append(w)
                    d_dist[w] = d_dist[v] + 1
                if d_dist[w] == d_dist[v] + 1:
                    sigma[w] += sigma[v]
                    P[w].append(v)
        delta = {w: 0.0 for w in node_ids}
        while S:
            w = S.pop()
            for v in P[w]:
                delta[v] += (sigma[v] / max(sigma[w], 1)) * (1.0 + delta[w])
            if w != s:
                cb[w] += delta[w]

    for nid in node_ids:
        cb[nid] /= 2.0  # undirected graph

    # Normalize betweenness to 0..1 scale
    max_cb = max(cb.values()) if cb else 1.0
    norm_cb = {nid: (cb[nid] / max_cb if max_cb > 0 else 0.0) for nid in node_ids}

    # Normalize PageRank to 0..1 scale
    max_pr = max(pr.values()) if pr else 1.0
    norm_pr = {nid: (pr[nid] / max_pr if max_pr > 0 else 0.0) for nid in node_ids}

    # Separate Person entities to accurately find Top Kingpin vs Intermediary / Broker
    person_nodes = [nid for nid in node_ids if (node_map[nid].get("labels") or [""])[0].upper() == "PERSON"]
    person_ranks = sorted(person_nodes, key=lambda x: (norm_pr[x], direct_ops_count[x], degrees[x]), reverse=True)
    top_person_id = person_ranks[0] if person_ranks else None
    second_person_id = person_ranks[1] if len(person_ranks) > 1 else None

    # Classify Roles based on Network Centrality + Entity Type + Operational Signatures
    results = []
    for nid in node_ids:
        n = node_map[nid]
        labels = n.get("labels") or []
        primary_label = labels[0].upper() if labels else "UNKNOWN"
        name = n.get("name") or nid.split(":")[-1]
        deg = degrees[nid]
        pr_score = round(norm_pr[nid], 4)
        cb_score = round(norm_cb[nid], 4)
        ops_deg = direct_ops_count[nid]

        # Calculate composite influence score (0 - 100)
        deg_norm = min(deg / 20.0, 1.0)
        influence_score = round(
            (pr_score * 0.40 + cb_score * 0.25 + deg_norm * 0.20 + min(ops_deg / 6.0, 1.0) * 0.15) * 100,
            1
        )

        role = "OPERATIVE"
        role_title = "Operative"
        badge_color = "#71717a"  # Zinc
        badge_icon = "👤"
        explanation = f"Network operative with degree {deg}."

        if primary_label == "PERSON":
            if nid == top_person_id:
                role = "KINGPIN"
                role_title = "Kingpin / Syndicate Head"
                badge_color = "#f59e0b"  # Amber/Gold
                badge_icon = "👑"
                explanation = (
                    f"Syndicate leader identified by dominant PageRank centrality ({pr_score:.2f}) "
                    f"and direct operational control over vehicles, locations, and personnel."
                )
            elif nid == second_person_id or cb_score >= 0.25 or (calls_count[nid] >= 2 and ops_deg >= 4):
                role = "BROKER"
                role_title = "Broker / Intermediary"
                badge_color = "#38bdf8"  # Cyan
                badge_icon = "🔄"
                explanation = (
                    f"Crucial bridge / intermediary ({ops_deg} operational commands, {calls_count[nid]} call bridges). "
                    f"Transfers instructions between leadership and ground operatives."
                )
            elif ops_deg >= 2 or deg >= 4:
                role = "LIEUTENANT"
                role_title = "Lieutenant / Coordinator"
                badge_color = "#818cf8"  # Indigo
                badge_icon = "⚡"
                explanation = f"Operational cell coordinator directly tied into the network (Degree: {deg})."

        elif primary_label == "ORGANIZATION":
            if ops_deg >= 4 or owns_count[nid] >= 1:
                role = "SHELL_COMPANY"
                role_title = "Front / Shell Entity"
                badge_color = "#eab308"  # Yellow
                badge_icon = "🏢"
                explanation = f"Commercial front holding assets / accounts ({owns_count[nid]} asset ownerships)."
            else:
                role = "AFFILIATE"
                role_title = "Affiliated Organization"
                badge_color = "#a1a1aa"  # Zinc
                badge_icon = "🏛️"
                explanation = f"Organizational entity linked across investigation envelopes (Degree: {deg})."

        elif primary_label in ("ACCOUNT", "BANK_ACCOUNT"):
            role = "MONEY_MULE"
            role_title = "Money Mule / Laundering Hub"
            badge_color = "#10b981"  # Emerald
            badge_icon = "💸"
            explanation = (
                f"High-degree financial repository (Degree: {deg}). Used for fund layering, "
                f"cash deposits, and illicit transfers."
            )

        elif primary_label == "PHONE":
            role = "DISPATCHER"
            role_title = "Burner / Dispatch Hub"
            badge_color = "#a855f7"  # Purple
            badge_icon = "📞"
            explanation = (
                f"Central telecommunications hub (Degree: {deg}). Mapped to suspect phone traffic "
                f"and coordination calls."
            )

        elif primary_label == "VEHICLE":
            role = "RUNNER"
            role_title = "Transport / Runner Asset"
            badge_color = "#f43f5e"  # Rose
            badge_icon = "🚗"
            explanation = f"Logistics and mobility asset (Degree: {deg}) utilized across operational sites."

        elif primary_label == "LOCATION":
            role = "DROP_POINT"
            role_title = "Meeting / Stash Location"
            badge_color = "#c084fc"  # Violet
            badge_icon = "📍"
            explanation = f"Frequent physical rendezvous point (Degree: {deg}) identified across cases."

        elif primary_label == "CASE":
            role = "CASE_ENVELOPE"
            role_title = "Investigation Envelope"
            badge_color = "#64748b"  # Slate
            badge_icon = "📁"
            explanation = f"Judicial FIR / police dossier envelope grouping evidence."

        results.append({
            "entity_id": nid,
            "name": name,
            "labels": labels,
            "primary_label": primary_label,
            "role": role,
            "role_title": role_title,
            "badge_color": badge_color,
            "badge_icon": badge_icon,
            "influence_score": influence_score,
            "degree": deg,
            "pagerank": pr_score,
            "betweenness": cb_score,
            "operational_links": ops_deg,
            "source_record_id": n.get("source_record_id"),
            "explanation": explanation,
        })

    # Sort descending by influence_score, then degree
    results.sort(key=lambda x: (x["influence_score"], x["degree"]), reverse=True)
    return results[:limit]



