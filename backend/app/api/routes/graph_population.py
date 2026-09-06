"""Graph-population endpoint: project a SourceRecord's entities into Neo4j."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.source_entity import SourceEntity
from app.models.source_record import SourceRecord
from app.services import graph_populate

router = APIRouter(prefix="/graph", tags=["graph-population"])


@router.post("/populate/source-record/{source_record_id}")
def populate_source_record_endpoint(
    source_record_id: int,
    db: Session = Depends(get_db),
) -> dict:
    """Populate the Neo4j graph from one SourceRecord's extracted entities.

    Idempotent: repeated calls MERGE onto the same deterministic nodes and
    evidence relationships. Returns created/merged counts.
    """
    record = (
        db.query(SourceRecord)
        .filter(SourceRecord.id == source_record_id)
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Source record not found")

    entities = (
        db.query(SourceEntity)
        .filter(SourceEntity.source_record_id == source_record_id)
        .order_by(SourceEntity.start)
        .all()
    )
    if not entities:
        raise HTTPException(
            status_code=404,
            detail="No entities extracted for this source record; "
                   "call GET /source-records/{id}/entities first",
        )

    entity_dicts = [
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
    try:
        counts = graph_populate.populate_source_record(
            entity_dicts,
            source_record_id,
            record_timestamp=record_timestamp,
            source_text=record.content,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Neo4j unavailable: {exc}",
        )

    return {"source_record_id": source_record_id, **counts}
