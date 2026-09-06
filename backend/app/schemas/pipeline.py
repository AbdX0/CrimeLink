"""Pydantic schemas for end-to-end pipeline processing."""

from typing import Optional
from pydantic import BaseModel, Field

from app.schemas.source_entity import EntityItem, ResolutionResult


class PipelineRecordSummary(BaseModel):
    id: int
    title: Optional[str] = None
    source_type: str
    content_length: int
    created_at: Optional[str] = None


class PipelineResolutionSummary(BaseModel):
    entities_resolved: int
    matches: int
    candidates: int
    results: list[ResolutionResult] = Field(default_factory=list)


class PipelineGraphSummary(BaseModel):
    nodes_created: int = 0
    nodes_merged: int = 0
    relationships_created: int = 0
    relationships_merged: int = 0


class PipelineProcessResponse(BaseModel):
    status: str
    source_record_id: int
    source_record: PipelineRecordSummary
    entities: list[EntityItem] = Field(default_factory=list)
    resolution: PipelineResolutionSummary
    graph: Optional[PipelineGraphSummary] = None
    errors: dict[str, str] = Field(default_factory=dict)
