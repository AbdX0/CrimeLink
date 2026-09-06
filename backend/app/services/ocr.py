"""OCR service: fallback text extraction for scanned PDF pages.

Uses Tesseract (via ``pytesseract``) to OCR pages rendered to images with
PyMuPDF (``pymupdf``). All heavy imports are lazy so importing this module (or
starting the app) never requires Tesseract to be installed.
"""

from io import BytesIO


class OCRUnavailableError(Exception):
    """Raised when Tesseract OCR (or a required dependency) is unavailable."""


def _render_page_images(data: bytes):
    """Render each PDF page to a PIL image using PyMuPDF.

    Returns a list of PIL.Image objects.
    Raises ImportError if pymupdf is not installed.
    """
    import pymupdf  # lazy: bundled renderer, no external poppler binary

    doc = None
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
        images = []
        matrix = pymupdf.Matrix(2, 2)  # 2x scale improves OCR accuracy
        for page in doc:
            pix = page.get_pixmap(matrix=matrix)
            images.append(_pix_to_pil(pix))
        return images
    finally:
        if doc is not None:
            doc.close()


def _pix_to_pil(pix):
    """Convert a PyMuPDF pixmap to a PIL Image (as PNG bytes)."""
    from PIL import Image

    return Image.open(BytesIO(pix.tobytes("png")))


def _require_tesseract():
    """Return the pytesseract module or raise OCRUnavailableError.

    Checks that the Tesseract engine is actually installed on the system.
    """
    try:
        import pytesseract
    except ImportError as exc:
        raise OCRUnavailableError(
            "OCR dependencies (pytesseract, Pillow, pymupdf) are not installed."
        ) from exc

    try:
        pytesseract.get_tesseract_version()
    except Exception as exc:
        raise OCRUnavailableError(
            "Tesseract OCR engine is not installed or not on PATH."
        ) from exc

    return pytesseract


def ocr_pdf_text(data: bytes) -> str:
    """OCR all pages of a PDF and return the concatenated recognized text.

    Raises:
        OCRUnavailableError: if Tesseract or a required dependency is missing.
    """
    pytesseract = _require_tesseract()
    images = _render_page_images(data)
    page_texts = []
    for image in images:
        text = pytesseract.image_to_string(image).strip()
        if text:
            page_texts.append(text)
    return "\n\n".join(page_texts).strip()