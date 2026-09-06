"""Graph-population service: project SourceEntity data into Neo4j.

Takes the entities extracted from a ``SourceRecord`` (PostgreSQL) and creates or
merges the corresponding nodes and evidence relationships in the Neo4j
knowledge graph.

Idempotency / determinism:

- Node ids are deterministic: ``"{TYPE}:{normalized entity text}"`` (normalized
  with the same ``normalize_entity_text`` used by entity resolution), so
  repeated imports MERGE onto the same nodes instead of creating duplicates.
- Nodes: ``MERGE (n:TYPE {id})`` — first-seen properties are kept, repeated
  population does not duplicate or overwrite them.
- Relationships: ``MERGE (a)-[r:TYPE {evidence_source_id: ...}]->(b)`` — each
  source record contributes its own evidence relationship, and re-populating
  the same record is a no-op.

Only the whitelisted entity/relationship types from ``app.services.graph`` are
used. Existing Neo4j data is never deleted.
"""

from typing import Optional

from neo4j import Driver

from app.neo4j import get_driver
from app.services import graph
from app.services.relationship_rules import classify_semantic_relationship
from app.services.resolution import normalize_entity_text

# Relationship kinds this population service may create (whitelisted
# in app.services.graph.RELATIONSHIP_TYPES).
COOCCURRENCE_REL = "ASSOCIATED_WITH"   # entities co-occurring in one record
CASE_REL = "INVOLVED_IN"               # entity -> CASE it appears with


def node_id_for(entity_type: str, entity_text: str) -> str:
    """Deterministic, stable node id: ``TYPE:normalized entity text``."""
    return f"{entity_type}:{normalize_entity_text(entity_text)}"


def _merge_node(session, entity_type: str, node_id: str, props: dict) -> bool:
    """MERGE one node; return True if it was created, False if it existed."""
    graph._validate_entity_type(entity_type)
    query = (
        f"MERGE (n:{entity_type} {{id: $id}}) "
        f"ON CREATE SET n += $props, n._created = true "
        f"WITH n, coalesce(n._created, false) AS created "
        f"REMOVE n._created "
        f"RETURN created"
    )
    row = session.run(query, {"id": node_id, "props": props}).single()
    return bool(row["created"]) if row is not None else False


def _merge_relationship(
    session,
    rel_type: str,
    from_type: str, from_id: str,
    to_type: str, to_id: str,
    *,
    evidence_source_id,
    confidence=None,
    timestamp=None,
) -> bool:
    """MERGE one evidence relationship; return True if it was created."""
    graph._validate_relationship_type(rel_type)
    graph._validate_entity_type(from_type)
    graph._validate_entity_type(to_type)
    props: dict = {"evidence_source_id": evidence_source_id}
    if timestamp is not None:
        props["timestamp"] = timestamp
    if confidence is not None:
        props["confidence"] = confidence
    # Merge on the evidence source so re-importing the same record is a no-op
    # while different records each keep their own evidence relationship.
    if evidence_source_id is None:
        rel_pattern = f"[r:{rel_type}]"
        params = {"from_id": from_id, "to_id": to_id, "props": props}
    else:
        rel_pattern = f"[r:{rel_type} {{evidence_source_id: $eid}}]"
        params = {
            "from_id": from_id, "to_id": to_id,
            "eid": evidence_source_id, "props": props,
        }
    query = (
        f"MATCH (a:{from_type} {{id: $from_id}}), (b:{to_type} {{id: $to_id}}) "
        f"MERGE (a)-{rel_pattern}->(b) "
        f"ON CREATE SET r += $props, r._created = true "
        f"WITH r, coalesce(r._created, false) AS created "
        f"REMOVE r._created "
        f"RETURN created"
    )
    row = session.run(query, params).single()
    return bool(row["created"]) if row is not None else False


def _combined_confidence(conf_a, conf_b):
    """Conservative confidence for a co-occurrence: the minimum available."""
    values = [c for c in (conf_a, conf_b) if c is not None]
    return min(values) if values else None


def plan_population(entities: list[dict], source_record_id: int,
                    record_timestamp=None,
                    source_text: Optional[str] = None) -> dict:
    """Build the node/relationship plan for one record's entities (no I/O).

    entities: dicts with entity_type, entity_text, confidence (text order).
    Returns {"nodes": [...], "relationships": [...]} where nodes carry
    {node_id, entity_type, entity_text, confidence} and relationships carry
    {rel_type, from_id, to_id, from_type, to_type, confidence}.
    """
    # Unique nodes in text order (deterministic ids deduplicate repeats).
    nodes: dict[str, dict] = {}
    for ent in entities:
        entity_type = graph._validate_entity_type(ent["entity_type"])
        nid = node_id_for(entity_type, ent["entity_text"])
        if nid not in nodes:
            nodes[nid] = {
                "node_id": nid,
                "entity_type": entity_type,
                "entity_text": ent["entity_text"],
                "confidence": ent.get("confidence"),
            }
    ordered = list(nodes.values())

    case_ids = [n["node_id"] for n in ordered if n["entity_type"] == "CASE"]
    non_case = [n for n in ordered if n["entity_type"] != "CASE"]

    relationships: list[dict] = []

    # Every non-CASE entity INVOLVED_IN each CASE it co-occurs with.
    for case in case_ids:
        for ent in non_case:
            relationships.append({
                "rel_type": CASE_REL,
                "from_id": ent["node_id"], "from_type": ent["entity_type"],
                "to_id": case, "to_type": "CASE",
                "confidence": _combined_confidence(
                    ent["confidence"], nodes[case]["confidence"]),
            })

    # Co-occurring non-CASE entities are classified using semantic relationship rules
    # against source document text if provided, falling back to ASSOCIATED_WITH.
    for i, a in enumerate(non_case):
        for b in non_case[i + 1:]:
            rel_type, from_id, from_type, to_id, to_type = classify_semantic_relationship(
                a, b, source_text=source_text
            )
            relationships.append({
                "rel_type": rel_type,
                "from_id": from_id, "from_type": from_type,
                "to_id": to_id, "to_type": to_type,
                "confidence": _combined_confidence(
                    a["confidence"], b["confidence"]),
            })

    return {"nodes": ordered, "relationships": relationships}




def populate_source_record(entities: list[dict], source_record_id: int,
                           record_timestamp=None,
                           driver: Optional[Driver] = None,
                           source_text: Optional[str] = None) -> dict:
    """MERGE one record's entity graph into Neo4j and return counts.

    entities: dicts with entity_type, entity_text, confidence (text order).
    record_timestamp: optional timestamp (e.g. record created_at ISO string)
        stored on created relationships.
    source_text: optional raw document text for semantic relationship extraction.
    Returns counts: nodes_created, nodes_merged, relationships_created,
    relationships_merged.
    """
    plan = plan_population(entities, source_record_id,
                           record_timestamp=record_timestamp,
                           source_text=source_text)
    counts = {
        "nodes_created": 0,
        "nodes_merged": 0,
        "relationships_created": 0,
        "relationships_merged": 0,
    }
    d = driver or get_driver()
    with d.session() as session:
        for node in plan["nodes"]:
            created = _merge_node(
                session,
                node["entity_type"],
                node["node_id"],
                {
                    "name": node["entity_text"],
                    "confidence": node["confidence"],
                    "source_record_id": source_record_id,
                },
            )
            counts["nodes_created" if created else "nodes_merged"] += 1
        for rel in plan["relationships"]:
            created = _merge_relationship(
                session,
                rel["rel_type"],
                rel["from_type"], rel["from_id"],
                rel["to_type"], rel["to_id"],
                evidence_source_id=source_record_id,
                confidence=rel["confidence"],
                timestamp=record_timestamp,
            )
            counts[
                "relationships_created" if created else "relationships_merged"
            ] += 1
    return counts
