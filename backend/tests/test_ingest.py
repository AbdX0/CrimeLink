"""Tests for the data-ingestion foundation (TXT, PDF, unsupported files)."""

import os
import sys
import unittest
from io import BytesIO
from unittest import mock
from typing import Generator

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.main import app
from app.database import Base, get_db
from app.services.ingest import (
    SUPPORTED_EXTENSIONS,
    extract_text,
    source_type_from_filename,
)


def make_pdf(text: str) -> bytes:
    content = (b"BT /F1 11 Tf 50 700 Td 16 TL (" + text.encode("latin-1") + b") Tj ET\n")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj\n" + body + b"\nendobj\n"
    xref_pos = len(out)
    out += b"xref\n0 " + str(len(objs) + 1).encode() + b"\n"
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += ("%010d 00000 n \n" % off).encode()
    out += b"trailer\n<< /Size " + str(len(objs) + 1).encode() + b" /Root 1 0 R >>\nstartxref\n"
    out += str(xref_pos).encode() + b"\n%%EOF\n"
    return bytes(out)


class ServiceExtractionTests(unittest.TestCase):
    """Direct tests of the text-extraction service."""

    def test_txt_extraction(self):
        text = extract_text("note.txt", b"investment report line one\nline two")
        self.assertIn("investment report line one", text)
        self.assertEqual(source_type_from_filename("note.txt"), "txt")

    def test_pdf_extraction(self):
        text = extract_text("report.pdf", make_pdf("CrimeLink PDF test 123"))
        self.assertIn("CrimeLink PDF test 123", text)
        self.assertEqual(source_type_from_filename("report.pdf"), "pdf")

    def test_unsupported_extension_raises(self):
        with self.assertRaises(ValueError):
            extract_text("notes.docx", b"word")




class OcrFallbackServiceTests(unittest.TestCase):
    """OCR fallback triggered when pypdf finds too little text."""

    def test_no_fallback_when_pypdf_has_text(self):
        with mock.patch("app.services.ingest.ocr_pdf_text") as mocked:
            from app.services.ingest import extract_text_from_pdf
            text = extract_text_from_pdf(make_pdf("CrimeLink PDF test 123"))
            self.assertIn("CrimeLink PDF test", text)
            mocked.assert_not_called()

    def test_fallback_when_no_text(self):
        with mock.patch("app.services.ingest.ocr_pdf_text", return_value="OCR page one"):
            from app.services.ingest import extract_text_from_pdf
            text = extract_text_from_pdf(make_pdf(""))
            self.assertIn("OCR page one", text)

    def test_unavailable_raises_clear_error(self):
        from app.services.ingest import extract_text_from_pdf
        from app.services.ocr import OCRUnavailableError
        with mock.patch(
            "app.services.ingest.ocr_pdf_text",
            side_effect=OCRUnavailableError("Tesseract OCR engine not found on PATH."),
        ):
            with self.assertRaises(OCRUnavailableError):
                extract_text_from_pdf(make_pdf(""))
class IngestRouteTests(unittest.TestCase):
    """HTTP-level tests of POST /ingest/file."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestSession = sessionmaker(bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)

        def override_get_db() -> Generator:
            db = cls.TestSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        from tests._helpers import use_fake_admin

        use_fake_admin()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def test_ingest_txt(self):
        resp = self.client.post(
            "/ingest/file",
            files={"file": ("note.txt", b"hello crime data", "text/plain")},
            data={"title": "My note"},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["id"] > 0)
        self.assertEqual(body["source_type"], "txt")
        self.assertEqual(body["title"], "My note")
        self.assertEqual(body["filename"], "note.txt")
        self.assertTrue(body["content_length"] > 0)

    def test_ingest_pdf(self):
        pdf_bytes = make_pdf("CrimeLink PDF test 123")
        resp = self.client.post(
            "/ingest/file",
            files={"file": ("report.pdf", pdf_bytes, "application/pdf")},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["id"] > 0)
        self.assertEqual(body["source_type"], "pdf")
        self.assertEqual(body["content_length"], len("CrimeLink PDF test 123"))

    def test_ingest_unsupported_rejected(self):
        resp = self.client.post(
            "/ingest/file",
            files={"file": ("notes.docx", b"word content", "application/octet-stream")},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Unsupported", resp.json()["detail"])


    def test_ingest_scanned_pdf_ocr_fallback(self):
        with mock.patch("app.services.ingest.ocr_pdf_text", return_value="OCR scanned body"):
            resp = self.client.post(
                "/ingest/file",
                files={"file": ("scan.pdf", make_pdf(""), "application/pdf")},
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.json()["content_length"], len("OCR scanned body"))

    def test_ingest_scanned_pdf_ocr_unavailable_503(self):
        from app.services.ocr import OCRUnavailableError
        with mock.patch(
            "app.services.ingest.ocr_pdf_text",
            side_effect=OCRUnavailableError("Tesseract OCR engine not found on PATH."),
        ):
            resp = self.client.post(
                "/ingest/file",
                files={"file": ("scan.pdf", make_pdf(""), "application/pdf")},
            )
            self.assertEqual(resp.status_code, 503)

class PdfEncryptionServiceTests(unittest.TestCase):
    """Tests for PDF encryption handling in extract_text_from_pdf."""

    def test_normal_unencrypted_pdf(self):
        """Normal unencrypted PDFs must work without any decrypt call."""
        text = extract_text("report.pdf", make_pdf("Normal PDF content here"))
        self.assertIn("Normal PDF content here", text)

    def test_encrypted_empty_password_pdf(self):
        """PDFs with empty owner-password should be auto-decrypted."""
        from app.services.ingest import extract_text_from_pdf
        from pypdf import PdfReader
        from io import BytesIO

        with mock.patch("app.services.ingest.PdfReader") as MockReader:
            mock_reader = mock.MagicMock()
            mock_reader.is_encrypted = True
            mock_reader.decrypt.return_value = 1  # success
            mock_page = mock.MagicMock()
            mock_page.extract_text.return_value = "Decrypted content from PDF"
            mock_reader.pages = [mock_page]
            MockReader.return_value = mock_reader

            text = extract_text_from_pdf(b"fake-pdf-data")
            self.assertIn("Decrypted content from PDF", text)
            mock_reader.decrypt.assert_called_once_with("")

    def test_password_protected_pdf_raises_clear_error(self):
        """Truly password-protected PDFs should raise ValueError, not crash."""
        from app.services.ingest import extract_text_from_pdf

        with mock.patch("app.services.ingest.PdfReader") as MockReader:
            mock_reader = mock.MagicMock()
            mock_reader.is_encrypted = True
            mock_reader.decrypt.return_value = 0  # failed - wrong password
            MockReader.return_value = mock_reader

            with self.assertRaises(ValueError) as ctx:
                extract_text_from_pdf(b"fake-pdf-data")
            self.assertIn("password-protected", str(ctx.exception))


class PdfEncryptionRouteTests(unittest.TestCase):
    """HTTP-level tests for encrypted PDF upload."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestSession = sessionmaker(bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)

        def override_get_db() -> Generator:
            db = cls.TestSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        from tests._helpers import use_fake_admin

        use_fake_admin()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def test_password_protected_pdf_returns_400(self):
        """Upload of a truly encrypted PDF must return 400 with clear message."""
        with mock.patch("app.services.ingest.PdfReader") as MockReader:
            mock_reader = mock.MagicMock()
            mock_reader.is_encrypted = True
            mock_reader.decrypt.return_value = 0
            MockReader.return_value = mock_reader

            resp = self.client.post(
                "/ingest/file",
                files={"file": ("secret.pdf", b"fake-pdf", "application/pdf")},
            )
            self.assertEqual(resp.status_code, 400)
            self.assertIn("password-protected", resp.json()["detail"])

if __name__ == "__main__":
    unittest.main()
