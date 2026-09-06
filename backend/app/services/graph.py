"""Minimal Neo4j graph service: create/query nodes and relationships."""
from contextlib import contextmanager
from typing import Optional

from neo4j import Driver

from app.neo4j import get_driver

ENTITY_TYPES = frozenset((
    "PERSON", "PHONE", "VEHICLE", "ACCOUNT",
    "LOCATION", "ORGANIZATION", "CASE", "EVENT",
))

RELATIONSHIP_TYPES = frozenset((
    "CALLS", "USES", "OWNS", "TRANSFERS",
    "VISITS", "ASSOCIATED_WITH", "INVOLVED_IN",
))

RELATIONSHIP_METADATA = ("timestamp", "confidence", "evidence_source_id")


@contextmanager
def _session(driver: Optional[Driver] = None):
    d = driver or get_driver()
    with d.session() as session:
        yield session


def _validate_entity_type(entity_type: str) -> str:
    if entity_type not in ENTITY_TYPES:
        raise ValueError(f"unsupported entity type: {entity_type!r}")
    return entity_type


def _validate_relationship_type(rel_type: str) -> str:
    if rel_type not in RELATIONSHIP_TYPES:
        raise ValueError(f"unsupported relationship type: {rel_type!r}")
    return rel_type


def _serialize_list_value(value):
    if isinstance(value, dict):
        return {k: _serialize_list_value(v) for k, v in value.items()}
    native = getattr(value, "to_native", None)
    if callable(native):
        value = native()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _node_dict(node):
    return {
        "id": node.get("id"),
        "labels": list(node.labels),
        "properties": {k: _serialize_list_value(v) for k, v in node.items()},
    }


def _rel_dict(rel, source_id, target_id):
    return {
        "type": rel.type,
        "source": _serialize_list_value(source_id),
        "target": _serialize_list_value(target_id),
        "properties": {k: _serialize_list_value(v) for k, v in rel.items()},
    }


def create_node(entity_type: str, node_id: str, properties=None, driver=None):
    _validate_entity_type(entity_type)
    props = dict(properties if properties else {})
    props["id"] = node_id
    query = f"MERGE (n:{entity_type} {{id: $id}}) SET n += $props RETURN n"
    params = {"id": node_id, "props": props}
    with _session(driver) as session:
        rows = list(session.run(query, params))
        return _node_dict(rows[0][0]) if rows else None


def create_relationship(
    rel_type: str,
    from_entity_type: str, from_id: str,
    to_entity_type: str, to_id: str,
    *,
    timestamp=None,
    confidence=None,
    evidence_source_id=None,
    properties=None,
    driver=None,
):
    _validate_relationship_type(rel_type)
    _validate_entity_type(from_entity_type)
    _validate_entity_type(to_entity_type)
    rel_props = dict(properties if properties else {})
    if timestamp is not None:
        rel_props["timestamp"] = timestamp
    if confidence is not None:
        rel_props["confidence"] = confidence
    if evidence_source_id is not None:
        rel_props["evidence_source_id"] = evidence_source_id
    query = (
        f"MATCH (a:{from_entity_type} {{id: $from_id}}), "
        f"(b:{to_entity_type} {{id: $to_id}}) "
        f"MERGE (a)-[r:{rel_type}]->(b) "
        f"SET r += $props RETURN r, a.id, b.id"
    )
    params = {"from_id": from_id, "to_id": to_id, "props": rel_props}
    with _session(driver) as session:
        rows = list(session.run(query, params))
        if not rows:
            return None
        return _rel_dict(rows[0][0], rows[0][1], rows[0][2])


def query_nodes(entity_type=None, limit=100, driver=None):
    where = f":{_validate_entity_type(entity_type)}" if entity_type else ""
    query = f"MATCH (n{where}) RETURN n LIMIT $limit"
    params = {"limit": limit}
    with _session(driver) as session:
        rows = list(session.run(query, params))
        return [_node_dict(row[0]) for row in rows]


def query_relationships(rel_type=None, limit=100, driver=None):
    where = f":{_validate_relationship_type(rel_type)}" if rel_type else ""
    query = f"MATCH (a)-[r{where}]->(b) RETURN r, a.id, b.id LIMIT $limit"
    params = {"limit": limit}
    with _session(driver) as session:
        rows = list(session.run(query, params))
        return [_rel_dict(row[0], row[1], row[2]) for row in rows]
