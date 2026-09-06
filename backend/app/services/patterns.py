"""Suspicious-pattern detection (rule-based, read-only) over the Neo4j graph.

Detects explainable, deterministic patterns from existing graph data:

- ``HIGH_ACTIVITY`` — relationship degree is unusually high compared with the
  network (mean + z * std of all entity degrees).
- ``HUB`` — highly connected entity (degree >= an absolute threshold).
- ``RELATIONSHIP_CONCENTRATION`` — one relationship type dominates an
  entity's relationships (share >= a configured fraction).
- ``MULTI_HOP_REACH`` — entity can reach an unusually large number of other
  entities within ``max_hops`` hops (default 2).

Every alert carries: ``entity_id``, ``pattern_type``, ``risk_score`` (0-100,
deterministic rule-based — no ML), ``explanation`` and
``evidence_source_ids`` (collected from relationship ``evidence_source_id``
properties). All queries are read-only; nothing is modified or deleted.
"""

from statistics import mean, pstdev
from typing import Optional

from neo4j import Driver

from app.neo4j import get_driver

# Configurable thresholds (overridable per request).
DEFAULT_ZSCORE_THRESHOLD = 2.0      # HIGH_ACTIVITY: z-score of degree
DEFAULT_HUB_DEGREE = 5              # HUB: absolute minimum degree
DEFAULT_CONCENTRATION = 0.8         # RELATIONSHIP_CONCENTRATION: share
DEFAULT_MULTIHOP_REACH = 10         # MULTI_HOP_REACH: distinct entities
DEFAULT_MAX_HOPS = 2

PATTERN_TYPES = (
    "HIGH_ACTIVITY",
    "HUB",
    "RELATIONSHIP_CONCENTRATION",
    "MULTI_HOP_REACH",
)


class _EntityActivity:
    """Aggregated per-entity activity used by the detection rules."""

    __slots__ = ("entity_id", "name", "labels", "rel_types", "evidence_ids")

    def __init__(self, entity_id, name, labels):
        self.entity_id = entity_id
        self.name = name
        self.labels = labels
        self.rel_types: dict[str, int] = {}
        self.evidence_ids: set = set()

    @property
    def degree(self) -> int:
        return sum(self.rel_types.values())


def _fetch_activity(session, entity_type: Optional[str] = None) -> list:
    """Read-only fetch of every entity's relationship breakdown."""
    label = f":{entity_type}" if entity_type else ""
    rows = session.run(
        f"MATCH (n{label}) WHERE n.id IS NOT NULL "
        "OPTIONAL MATCH (n)-[r]-() "
        "RETURN n.id AS entity_id, n.name AS name, labels(n) AS labels, "
        "type(r) AS rel_type, r.evidence_source_id AS evidence "
        "ORDER BY n.id",
        {},
    ).data()
    entities: dict = {}
    for row in rows:
        ent = entities.setdefault(
            row["entity_id"],
            _EntityActivity(row["entity_id"], row.get("name"),
                            row.get("labels", [])),
        )
        if row.get("rel_type"):
            ent.rel_types[row["rel_type"]] = (
                ent.rel_types.get(row["rel_type"], 0) + 1)
            if row.get("evidence") is not None:
                ent.evidence_ids.add(row["evidence"])
    return list(entities.values())


def _reachable_count(session, entity_id: str, max_hops: int) -> int:
    """Count distinct other entities reachable within ``max_hops`` hops."""
    rows = session.run(
        "MATCH (n {id: $eid})-[*1.." + str(int(max_hops)) + "]-(m) "
        "WHERE m.id IS NOT NULL AND m.id <> $eid "
        "RETURN count(DISTINCT m) AS c",
        {"eid": entity_id},
    ).data()
    return int(rows[0]["c"]) if rows else 0


def _alert(entity, pattern_type, risk_score, explanation) -> dict:
    return {
        "entity_id": entity.entity_id,
        "pattern_type": pattern_type,
        "risk_score": int(min(100, max(0, round(risk_score)))),
        "explanation": explanation,
        "evidence_source_ids": sorted(entity.evidence_ids),
        "entity_name": entity.name,
        "entity_labels": entity.labels,
    }


def detect_suspicious_patterns(
    entity_type: Optional[str] = None,
    zscore_threshold: float = DEFAULT_ZSCORE_THRESHOLD,
    hub_degree: int = DEFAULT_HUB_DEGREE,
    concentration_threshold: float = DEFAULT_CONCENTRATION,
    multihop_reach_threshold: int = DEFAULT_MULTIHOP_REACH,
    max_hops: int = DEFAULT_MAX_HOPS,
    driver: Optional[Driver] = None,
) -> list[dict]:
    """Run all rule-based detectors and return alerts ranked by risk_score."""
    d = driver or get_driver()
    alerts: list[dict] = []
    with d.session() as session:
        entities = _fetch_activity(session, entity_type)
        degrees = [e.degree for e in entities]
        mu = mean(degrees) if degrees else 0.0
        sigma = pstdev(degrees) if len(degrees) > 1 else 0.0

        for ent in entities:
            # Rule 1 — unusually high activity vs network mean.
            if sigma > 0 and ent.degree > mu:
                z = (ent.degree - mu) / sigma
                if z >= zscore_threshold:
                    alerts.append(_alert(
                        ent, "HIGH_ACTIVITY",
                        40 + 20 * z,
                        f"Degree {ent.degree} is {z:.1f} standard deviations "
                        f"above the network mean ({mu:.1f}).",
                    ))
            # Rule 2 — highly connected entity (absolute threshold).
            if ent.degree >= hub_degree:
                alerts.append(_alert(
                    ent, "HUB",
                    40 + 60 * min(1.0, ent.degree / (hub_degree * 2)),
                    f"Entity has {ent.degree} relationships "
                    f"(threshold {hub_degree}).",
                ))
            # Rule 3 — unusual relationship-type concentration.
            total = ent.degree
            if total > 0:
                dom_type, dom_count = max(
                    ent.rel_types.items(), key=lambda kv: kv[1])
                share = dom_count / total
                if share >= concentration_threshold and total >= 2:
                    alerts.append(_alert(
                        ent, "RELATIONSHIP_CONCENTRATION",
                        100 * share,
                        f"{int(share * 100)}% of relationships are "
                        f"{dom_type} ({dom_count}/{total}).",
                    ))
            # Rule 4 — suspicious multi-hop reach.
            reach = _reachable_count(session, ent.entity_id, max_hops)
            if reach >= multihop_reach_threshold:
                alerts.append(_alert(
                    ent, "MULTI_HOP_REACH",
                    40 + 60 * min(1.0, reach / (multihop_reach_threshold * 2)),
                    f"Reaches {reach} entities within {max_hops} hops "
                    f"(threshold {multihop_reach_threshold}).",
                ))

    alerts.sort(key=lambda a: (-a["risk_score"], a["entity_id"]))
    return alerts
