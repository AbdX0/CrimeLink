"""Entity-resolution endpoints: resolve potential duplicate entities."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.source_entity import SourceEntity
from app.schemas.source_entity import ResolutionResult
from app.services import resolution

router = APIRouter(prefix="/resolution", tags=["resolution"])


def _entity_to_dict(ent: SourceEntity) -> dict:
    return {
        "id": ent.id,
        "entity_type": ent.entity_type,
        "entity_text": ent.entity_text,
        "source_record_id": ent.source_record_id,
    }


@router.get("/entity/{entity_id}", response_model=ResolutionResult)
def resolve_entity_endpoint(
    entity_id: int,
    match_threshold: Optional[float] = Query(default=None),
    candidate_threshold: Optional[float] = Query(default=None),
    db: Session = Depends(get_db),
) -> ResolutionResult:
    """Resolve a single entity against all other entities in the corpus."""
    target = db.query(SourceEntity).filter(SourceEntity.id == entity_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="Entity not found")

    all_entities = db.query(SourceEntity).all()
    candidates = [_entity_to_dict(e) for e in all_entities if e.id != entity_id]

    target_dict = _entity_to_dict(target)
    result = resolution.resolve_entity(
        entity_id,
        target_dict["entity_type"],
        target_dict["entity_text"],
        candidates,
        match_threshold=match_threshold,
        candidate_threshold=candidate_threshold,
    )
    return ResolutionResult(**result)


@router.get("/source-record/{source_record_id}", response_model=list[ResolutionResult])
def resolve_source_record_endpoint(
    source_record_id: int,
    match_threshold: Optional[float] = Query(default=None),
    candidate_threshold: Optional[float] = Query(default=None),
    db: Session = Depends(get_db),
) -> list[ResolutionResult]:
    """Resolve every entity belonging to a source record against the corpus."""
    scope = (
        db.query(SourceEntity)
        .filter(SourceEntity.source_record_id == source_record_id)
        .all()
    )
    if not scope:
        raise HTTPException(
            status_code=404, detail="No entities found for source record"
        )

    all_entities = db.query(SourceEntity).all()
    scope_list = [_entity_to_dict(e) for e in scope]
    corpus_list = [_entity_to_dict(e) for e in all_entities]
    results = resolution.resolve_entities_for_scope(
        scope_list,
        corpus_list,
        match_threshold=match_threshold,
        candidate_threshold=candidate_threshold,
    )
    return [ResolutionResult(**r) for r in results]