"""SourceRecord endpoints: create, list, and extract entities."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.source_entity import SourceEntity
from app.models.source_record import SourceRecord
from app.schemas.source_entity import EntityExtractionResponse, EntityItem
from app.schemas.source_record import (
    SourceRecord as SourceRecordOut,
)
from app.schemas.source_record import SourceRecordCreate
from app.services.nlp import ModelUnavailableError, extract_entities_for_record

router = APIRouter(prefix="/source-records", tags=["source-records"])


@router.post("", response_model=SourceRecordOut, status_code=201)
def create_source_record(
    payload: SourceRecordCreate, db: Session = Depends(get_db)
) -> SourceRecordOut:
    """Create a new source record and persist it in PostgreSQL."""
    record = SourceRecord(**payload.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("", response_model=list[SourceRecordOut])
def list_source_records(
    skip: int = 0, limit: int = 100, db: Session = Depends(get_db)
) -> list[SourceRecordOut]:
    """List source records with pagination."""
    return (
        db.query(SourceRecord)
        .order_by(SourceRecord.id)
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/{source_record_id}", response_model=SourceRecordOut)
def get_source_record(
    source_record_id: int, db: Session = Depends(get_db)
) -> SourceRecordOut:
    """Fetch a single source record by ID."""
    record = (
        db.query(SourceRecord)
        .filter(SourceRecord.id == source_record_id)
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Source record not found")
    return record


@router.get("/{source_record_id}/entities", response_model=EntityExtractionResponse)
def extract_source_record_entities(
    source_record_id: int, db: Session = Depends(get_db)
) -> EntityExtractionResponse:
    """Extract entities from an existing SourceRecord's text (spaCy NER + regex)."""
    record = (
        db.query(SourceRecord)
        .filter(SourceRecord.id == source_record_id)
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Source record not found")
    if not record.content:
        return EntityExtractionResponse(source_record_id=record.id, entities=[])

    try:
        entities = extract_entities_for_record(record.content, record.id)
    except ModelUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    for ent in entities:
        db.add(SourceEntity(**ent))
    db.commit()

    items = [EntityItem(**ent) for ent in entities]
    return EntityExtractionResponse(source_record_id=record.id, entities=items)


@router.delete("/{source_record_id}", status_code=204)
def delete_source_record(
    source_record_id: int, db: Session = Depends(get_db)
) -> None:
    """Permanently delete a source record and all associated investigation data.

    Dependency-aware: preserves shared graph nodes still referenced by other records.
    """
    from app.services.deletion import delete_source_record_and_dependencies

    result = delete_source_record_and_dependencies(source_record_id, db)
    if result is None:
        raise HTTPException(status_code=404, detail="Source record not found")
