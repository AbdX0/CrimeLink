"""Pydantic schemas for extracted entities and entity resolution."""

from pydantic import BaseModel, Field


class EntityItem(BaseModel):
    """A single extracted entity span."""

    entity_type: str = Field(..., max_length=50)
    entity_text: str = Field(..., max_length=500)
    start: int
    end: int
    confidence: float | None = None
    source_record_id: int


class EntityExtractionResponse(BaseModel):
    """Response payload: the source record id and its extracted entities."""

    source_record_id: int
    entities: list[EntityItem]


class ResolutionItem(BaseModel):
    """A single candidate entity match for resolution."""

    entity_id: int
    entity_type: str = Field(..., max_length=50)
    entity_text: str = Field(..., max_length=500)
    normalized_value: str
    similarity: float
    resolution_status: str


class ResolutionResult(BaseModel):
    """The full resolution result for a selected entity."""

    entity_id: int
    entity_type: str = Field(..., max_length=50)
    entity_text: str
    normalized_value: str
    resolved_with: list[ResolutionItem]
    resolution_status: str