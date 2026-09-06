"""SourceEntity ORM model: a single named-entity extracted from a SourceRecord."""

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class SourceEntity(Base):
    """One extracted entity (person, phone, vehicle, location, etc.).

    Holds the raw span (entity_text, start, end), a confidence score, the entity
    type, and a reference back to the SourceRecord it came from.
    """

    __tablename__ = "source_entities"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_text: Mapped[str] = mapped_column(String(500), nullable=False)
    start: Mapped[int] = mapped_column(Integer, nullable=False)
    end: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)

    source_record_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("source_records.id"), nullable=False, index=True
    )