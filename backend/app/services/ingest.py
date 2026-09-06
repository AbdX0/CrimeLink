"""Data-ingestion service: text extraction from supported source files.

Supports TXT (direct text) and PDF. PDF text is first extracted with ``pypdf``;
if a PDF contains insufficient/no extractable text, OCR (Tesseract) is used as
a fallback for scanned pages.
"""

import io
import os

from pypdf import PdfReader

from app.services.ocr import OCRUnavailableError, ocr_pdf_text

SUPPORTED_EXTENSIONS = {".txt", ".pdf"}

# Minimum significant characters for pypdf text to be considered "enough".
# Below this threshold a PDF is treated as scanned and OCR is attempted.
MIN_PDF_TEXT_CHARS = 20


def extract_text_from_txt(data: bytes) -> str:
    """Decode raw TXT bytes to text (utf-8, falling back to latin-1)."""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def extract_text_from_pdf(
    data: bytes, min_text_chars: int = MIN_PDF_TEXT_CHARS
) -> str:
    """Extract text from PDF bytes, using OCR when pypdf finds too little text.

    Args:
        data: raw PDF bytes.
        min_text_chars: threshold below which pypdf text is considered
            insufficient and OCR fallback is triggered.

    Returns:
        The extracted text as a string.

    Raises:
        ValueError: if the PDF is encrypted with a non-empty password that
            cannot be removed automatically.
        OCRUnavailableError: if the PDF has no extractable text and Tesseract
            OCR cannot be used.
    """
    reader = PdfReader(io.BytesIO(data))

    # Handle PDF encryption transparently.  Many "normal" PDFs carry an empty
    # owner-password that pypdf still flags as encrypted.  Attempt to unlock
    # with an empty password first; only raise if that fails.
    if reader.is_encrypted:
        try:
            decrypt_result = reader.decrypt("")
            if decrypt_result == 0:
                raise ValueError(
                    "This PDF is password-protected. "
                    "Please upload an unencrypted version or provide the password."
                )
        except NotImplementedError as exc:
            raise ValueError(
                f"This PDF uses an unsupported encryption algorithm: {exc}"
            ) from exc

    pages = [str(page.extract_text() or "").strip() for page in reader.pages]
    text = "\n\n".join(page for page in pages if page)
    if len(text.strip()) >= min_text_chars:
        return text
    # Insufficient/no extractable text -> OCR fallback for scanned pages.
    return ocr_pdf_text(data)


def extract_text(filename: str, data: bytes) -> str:
    """Extract text from source file bytes based on the file extension."""
    extension = os.path.splitext(filename)[1].lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {extension!r}. Supported: txt, pdf")
    if extension == ".pdf":
        return extract_text_from_pdf(data)
    return extract_text_from_txt(data)


def source_type_from_filename(filename: str) -> str:
    """Return a SourceRecord source_type derived from the file extension."""
    extension = os.path.splitext(filename)[1].lower()
    return extension.lstrip(".") or "file"