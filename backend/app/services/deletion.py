"""Service for persistent, dependency-aware deletion of investigation cases and source records.

Removes:
- The PostgreSQL SourceRecord
- Extracted SourceEntity records
- Neo4j evidence relationships originating from this record (evidence_source_id)
- Neo4j nodes exclusive to this record

Preserves:
- Shared Neo4j nodes and relationships legitimately referenced by remaining source records
"""

import logging
from typing import Optional

from neo4j import Driver
from sqlalchemy.orm import Session

from app.models.source_entity import SourceEntity
from app.models.source_record import SourceRecord
from app.neo4j import get_driver
from app.services.graph_populate import node_id_for

logger = logging.getLogger(__name__)


def delete_source_record_and_dependencies(
    source_record_id: int,
    db: Session,
    driver: Optional[Driver] = None,
) -> Optional[dict]:
    """Permanently delete a source record and all its associated investigation data.

    Dependency-aware:
    - Nodes that are also referenced by other remaining source records are PRESERVED.
    - Nodes exclusive to this record are DETACH DELETEd from Neo4j.
    - Relationships created with evidence_source_id == source_record_id are DELETEd.
    - SourceEntity rows and SourceRecord row in PostgreSQL are DELETEd.

    Returns summary dict if found and deleted, or None if record does not exist.
    """
    record = (
        db.query(SourceRecord)
        .filter(SourceRecord.id == source_record_id)
        .first()
    )
    if record is None:
        return None

    # 1. Identify all entities extracted from this record
    target_entities = (
        db.query(SourceEntity)
        .filter(SourceEntity.source_record_id == source_record_id)
        .all()
    )
    candidate_node_ids = {
        node_id_for(e.entity_type, e.entity_text) for e in target_entities
    }

    # 2. Identify all entities belonging to OTHER remaining records
    remaining_entities = (
        db.query(SourceEntity)
        .filter(SourceEntity.source_record_id != source_record_id)
        .all()
    )
    remaining_node_ids = {
        node_id_for(e.entity_type, e.entity_text) for e in remaining_entities
    }

    # 3. Partition into exclusive vs shared nodes
    shared_node_ids = candidate_node_ids.intersection(remaining_node_ids)
    exclusive_node_ids = candidate_node_ids - remaining_node_ids

    # 4. Neo4j Cleanup
    nodes_deleted = 0
    relationships_deleted = 0

    d = driver
    if d is None:
        try:
            d = get_driver()
        except Exception as exc:
            logger.warning("Could not obtain Neo4j driver during deletion: %s", exc)

    if d is not None:
        try:
            with d.session() as session:
                # Remove evidence relationships originating from this record
                rel_res = session.run(
                    """
                    MATCH ()-[r]->()
                    WHERE r.evidence_source_id = $rec_id
                    DELETE r
                    RETURN count(r) AS deleted_count
                    """,
                    {"rec_id": source_record_id},
                ).single()
                if rel_res:
                    relationships_deleted = rel_res["deleted_count"]

                # Remove exclusive nodes (no other record references them)
                if exclusive_node_ids:
                    node_res = session.run(
                        """
                        MATCH (n)
                        WHERE n.id IN $node_ids
                        DETACH DELETE n
                        RETURN count(n) AS deleted_count
                        """,
                        {"node_ids": list(exclusive_node_ids)},
                    ).single()
                    if node_res:
                        nodes_deleted = node_res["deleted_count"]

                # For shared nodes, if their source_record_id points to the deleted record,
                # remove or update it so it no longer references the deleted record.
                if shared_node_ids:
                    session.run(
                        """
                        MATCH (n)
                        WHERE n.id IN $shared_ids AND n.source_record_id = $rec_id
                        REMOVE n.source_record_id
                        """,
                        {
                            "shared_ids": list(shared_node_ids),
                            "rec_id": source_record_id,
                        },
                    )
        except Exception as exc:
            logger.error("Error executing Neo4j cleanup during deletion: %s", exc)

    # 5. PostgreSQL Cleanup
    deleted_entities_count = (
        db.query(SourceEntity)
        .filter(SourceEntity.source_record_id == source_record_id)
        .delete(synchronize_session=False)
    )

    db.delete(record)
    db.commit()

    return {
        "source_record_id": source_record_id,
        "deleted_entities_count": deleted_entities_count,
        "exclusive_nodes_deleted": nodes_deleted,
        "relationships_deleted": relationships_deleted,
        "shared_nodes_preserved": len(shared_node_ids),
    }
