"""Pydantic schemas for SourceRecord requests and responses."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SourceRecordBase(BaseModel):
    """Shared fields for creating and returning a source record."""

    source_type: str = Field(..., min_length=1, max_length=50)
    title: str | None = Field(default=None, max_length=255)
    url: str | None = Field(default=None, max_length=500)
    content: str | None = None


class SourceRecordCreate(SourceRecordBase):
    """Payload accepted by POST /source-records."""


class SourceRecord(SourceRecordBase):
    """Full source record as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime