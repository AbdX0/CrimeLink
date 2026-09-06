"""Data-ingestion endpoints: accept authorized source files (TXT, PDF)."""

import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.source_record import SourceRecord
from app.services.ingest import (
    SUPPORTED_EXTENSIONS,
    extract_text,
    source_type_from_filename,
)
from app.services.ocr import OCRUnavailableError

router = APIRouter(prefix="/ingest", tags=["ingest"])


@router.post("/file")
async def ingest_file(
    file: UploadFile = File(..., description="Source file (TXT or PDF)"),
    title: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> dict:
    """Accept a source file, extract its text, and store it as a SourceRecord."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing source filename.")
    extension = os.path.splitext(file.filename)[1].lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{extension}'. Supported types: txt, pdf",
        )
    data = await file.read()
    try:
        content = extract_text(file.filename, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OCRUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    record_title = title or file.filename
    record = SourceRecord(
        source_type=source_type_from_filename(file.filename),
        title=record_title,
        content=content,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {
        "id": record.id,
        "source_type": record.source_type,
        "title": record.title,
        "filename": file.filename,
        "content_length": len(content),
        "created_at": record.created_at.isoformat(),
    }
