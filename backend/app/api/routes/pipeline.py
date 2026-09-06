"""Pipeline orchestration endpoints: process source records through the full workflow."""

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.pipeline import PipelineProcessResponse
from app.services import pipeline as pipeline_service
from app.services.ocr import OCRUnavailableError

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


@router.post(
    "/process/source-record/{source_record_id}",
    response_model=PipelineProcessResponse,
)
def process_record_endpoint(
    source_record_id: int,
    match_threshold: Optional[float] = Query(default=None),
    candidate_threshold: Optional[float] = Query(default=None),
    db: Session = Depends(get_db),
) -> PipelineProcessResponse:
    """Run full NLP extraction, resolution, and graph population for a SourceRecord."""
    try:
        result = pipeline_service.process_source_record(
            source_record_id,
            db,
            match_threshold=match_threshold,
            candidate_threshold=candidate_threshold,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Pipeline error: {exc}"
        ) from exc

    return PipelineProcessResponse(**result)


@router.post("/process/file", response_model=PipelineProcessResponse)
async def process_file_endpoint(
    file: UploadFile = File(..., description="Source file (TXT or PDF)"),
    title: Optional[str] = Form(default=None),
    match_threshold: Optional[float] = Form(default=None),
    candidate_threshold: Optional[float] = Form(default=None),
    db: Session = Depends(get_db),
) -> PipelineProcessResponse:
    """Ingest a file, store it, extract entities, resolve them, and populate Neo4j."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing source filename.")

    data = await file.read()
    try:
        result = pipeline_service.process_file(
            file.filename,
            data,
            title=title,
            db=db,
            match_threshold=match_threshold,
            candidate_threshold=candidate_threshold,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OCRUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Pipeline error: {exc}"
        ) from exc

    return PipelineProcessResponse(**result)
