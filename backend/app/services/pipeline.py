"""Pipeline orchestration service: end-to-end investigator workflow.

Chains the existing services:
ingest -> NLP entity extraction -> entity resolution -> Neo4j graph population.

Each stage integrates cleanly with existing domain models and services:
- SourceRecord / SourceEntity in PostgreSQL
- RapidFuzz entity resolution
- Neo4j deterministic MERGE population with evidence provenance
- Error reporting for partial failures
"""

import logging
import os
from typing import Optional

from sqlalchemy.orm import Session

from app.models.source_entity import SourceEntity
from app.models.source_record import SourceRecord
from app.services import graph_populate, ingest, resolution
from app.services.nlp import ModelUnavailableError, extract_entities_for_record
from app.services.ocr import OCRUnavailableError

logger = logging.getLogger(__name__)


def _entity_to_dict(ent: SourceEntity) -> dict:
    return {
        "id": ent.id,
        "entity_type": ent.entity_type,
        "entity_text": ent.entity_text,
        "start": ent.start,
        "end": ent.end,
        "confidence": ent.confidence,
        "source_record_id": ent.source_record_id,
    }


def process_source_record(
    source_record_id: int,
    db: Session,
    *,
    match_threshold: Optional[float] = None,
    candidate_threshold: Optional[float] = None,
) -> dict:
    """Orchestrate the end-to-end processing of a single SourceRecord.

    Steps:
    1. Verify SourceRecord exists in PostgreSQL.
    2. Extract and persist entities via NLP service (if not already extracted).
    3. Run entity resolution against the corpus.
    4. Populate the Neo4j knowledge graph with evidence linking.

    Returns a complete workflow summary dictionary.
    """
    record = (
        db.query(SourceRecord)
        .filter(SourceRecord.id == source_record_id)
        .first()
    )
    if record is None:
        raise ValueError(f"Source record {source_record_id} not found")

    errors: dict[str, str] = {}

    # 1. NLP Entity Extraction
    entities = (
        db.query(SourceEntity)
        .filter(SourceEntity.source_record_id == source_record_id)
        .order_by(SourceEntity.start)
        .all()
    )

    if not entities and record.content:
        try:
            extracted_dicts = extract_entities_for_record(
                record.content, source_record_id, use_ner=True
            )
        except ModelUnavailableError:
            logger.info(
                "spaCy model unavailable for record %s; falling back to regex extraction",
                source_record_id,
            )
            extracted_dicts = extract_entities_for_record(
                record.content, source_record_id, use_ner=False
            )
        except Exception as exc:
            logger.exception(
                "Entity extraction failed for record %s: %s", source_record_id, exc
            )
            errors["entity_extraction"] = str(exc)
            extracted_dicts = []

        for ent_data in extracted_dicts:
            db.add(SourceEntity(**ent_data))
        if extracted_dicts:
            db.commit()
        entities = (
            db.query(SourceEntity)
            .filter(SourceEntity.source_record_id == source_record_id)
            .order_by(SourceEntity.start)
            .all()
        )

    entity_items = [_entity_to_dict(e) for e in entities]

    # 2. Entity Resolution
    resolution_data = {
        "entities_resolved": 0,
        "matches": 0,
        "candidates": 0,
        "results": [],
    }
    if entities:
        try:
            scope_list = [
                {
                    "id": e.id,
                    "entity_type": e.entity_type,
                    "entity_text": e.entity_text,
                    "source_record_id": e.source_record_id,
                }
                for e in entities
            ]
            all_entities = db.query(SourceEntity).all()
            corpus_list = [
                {
                    "id": e.id,
                    "entity_type": e.entity_type,
                    "entity_text": e.entity_text,
                    "source_record_id": e.source_record_id,
                }
                for e in all_entities
            ]
            results = resolution.resolve_entities_for_scope(
                scope_list,
                corpus_list,
                match_threshold=match_threshold,
                candidate_threshold=candidate_threshold,
            )
            matches_count = sum(
                1 for r in results if r.get("resolution_status") == "match"
            )
            candidates_count = sum(
                1 for r in results if r.get("resolution_status") == "candidate"
            )
            resolution_data = {
                "entities_resolved": len(results),
                "matches": matches_count,
                "candidates": candidates_count,
                "results": results,
            }
        except Exception as exc:
            logger.exception(
                "Entity resolution failed for record %s: %s", source_record_id, exc
            )
            errors["resolution"] = str(exc)

    # 3. Neo4j Graph Population
    graph_data: Optional[dict] = None
    if entities:
        try:
            entity_graph_dicts = [
                {
                    "entity_type": e.entity_type,
                    "entity_text": e.entity_text,
                    "confidence": e.confidence,
                }
                for e in entities
            ]
            record_timestamp = (
                record.created_at.isoformat() if record.created_at else None
            )
            graph_data = graph_populate.populate_source_record(
                entity_graph_dicts,
                source_record_id,
                record_timestamp=record_timestamp,
                source_text=record.content,
            )
        except Exception as exc:
            logger.warning(
                "Graph population failed for record %s: %s", source_record_id, exc
            )
            errors["graph_population"] = f"Neo4j unavailable: {exc}"

    status = "completed" if not errors else "partial"

    return {
        "status": status,
        "source_record_id": record.id,
        "source_record": {
            "id": record.id,
            "title": record.title,
            "source_type": record.source_type,
            "content_length": len(record.content) if record.content else 0,
            "created_at": record.created_at.isoformat() if record.created_at else None,
        },
        "entities": entity_items,
        "resolution": resolution_data,
        "graph": graph_data,
        "errors": errors,
    }


def process_file(
    filename: str,
    data: bytes,
    title: Optional[str],
    db: Session,
    *,
    match_threshold: Optional[float] = None,
    candidate_threshold: Optional[float] = None,
) -> dict:
    """Ingest a file (TXT or PDF), store as SourceRecord, and run full pipeline."""
    if not filename:
        raise ValueError("Missing source filename.")

    extension = os.path.splitext(filename)[1].lower()
    if extension not in ingest.SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type '{extension}'. Supported types: txt, pdf"
        )

    content = ingest.extract_text(filename, data)
    record_title = title or filename
    record = SourceRecord(
        source_type=ingest.source_type_from_filename(filename),
        title=record_title,
        content=content,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return process_source_record(
        record.id,
        db,
        match_threshold=match_threshold,
        candidate_threshold=candidate_threshold,
    )
