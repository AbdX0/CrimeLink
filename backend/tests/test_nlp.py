"""Tests for NLP entity extraction (regex + mocked spaCy NER)."""

import os
import sys
import unittest
from typing import Generator
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from app.database import Base, get_db
from app.main import app
from app.models.source_record import SourceRecord
from app.services import nlp
from app.services.nlp import ModelUnavailableError


class FakeSpan:
    """Stand-in for a spaCy Span (used so no model is downloaded)."""

    def __init__(self, label, text, start_char, end_char):
        self.label_ = label
        self.text = text
        self.start_char = start_char
        self.end_char = end_char


class FakeDoc:
    """Stand-in for a spaCy Doc with named entities."""

    def __init__(self, spans):
        self.ents = spans


class FakeNlp:
    """Stand-in for a spaCy pipeline object."""

    def __init__(self, spans):
        self._spans = spans

    def __call__(self, text):
        return FakeDoc(self._spans)


class RegexExtractionTests(unittest.TestCase):
    """Regex-based extraction does not require the spaCy model."""

    SAMPLE = (
        "Detective Sara Alvarez called 555-014-7721 about VEHICLE AZ-4487. "
        "The account 1234-5678-9012 is linked to CASE-2023-0042."
    )

    def test_extracts_phone_and_vehicle(self):
        ents = nlp.extract_entities(self.SAMPLE, use_ner=False)
        types = {e["entity_type"]: e["entity_text"] for e in ents}
        self.assertEqual(types["PHONE"], "555-014-7721")
        self.assertEqual(types["VEHICLE"], "AZ-4487")

    def test_extracts_account_and_case(self):
        ents = nlp.extract_entities(self.SAMPLE, use_ner=False)
        types = {e["entity_type"]: e["entity_text"] for e in ents}
        self.assertEqual(types["ACCOUNT"], "1234-5678-9012")
        self.assertIn("CASE-2023-0042", types["CASE"])

    def test_entities_have_spans_and_confidence(self):
        ents = nlp.extract_entities(self.SAMPLE, use_ner=False)
        for ent in ents:
            self.assertIn("start", ent)
            self.assertIn("end", ent)
            self.assertIn("confidence", ent)
            self.assertTrue(ent["end"] > ent["start"])


class NerUnavailableTests(unittest.TestCase):
    """When the spaCy model is missing, raise a clear error (no silent failure)."""

    def test_extract_entities_raises_when_model_unavailable(self):
        nlp._nlp = None
        nlp._nlp_tried = False
        with mock.patch.object(
            nlp, "get_nlp",
            side_effect=ModelUnavailableError("spaCy model 'en_core_web_sm' is unavailable."),
        ):
            with self.assertRaises(ModelUnavailableError):
                nlp.extract_entities("Sara Alvarez called 555-014-7721.")


class NerMappingTests(unittest.TestCase):
    """spaCy NER labels map to the supported CrimeLink entity types."""

    def test_ner_labels_mapped(self):
        spans = [
            FakeSpan("PERSON", "Sara Alvarez", 0, 12),
            FakeSpan("GPE", "Miami", 30, 35),
            FakeSpan("ORG", "Skyline Bank", 40, 52),
        ]
        fake_nlp = FakeNlp(spans)
        with mock.patch.object(nlp, "get_nlp", return_value=fake_nlp):
            ents = nlp.extract_entities("Sara Alvarez in Miami working at Skyline Bank.")
        types = {e["entity_text"]: e["entity_type"] for e in ents}
        self.assertEqual(types["Sara Alvarez"], "PERSON")
        self.assertEqual(types["Miami"], "LOCATION")
        self.assertEqual(types["Skyline Bank"], "ORGANIZATION")




class EntitiesEndpointTests(unittest.TestCase):
    """HTTP endpoint: GET /source-records/{id}/entities."""

    @classmethod
    def setUpClass(cls):
        import sqlalchemy
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool
        from fastapi.testclient import TestClient
        cls.engine = sqlalchemy.create_engine(
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
        nlp._nlp = None
        nlp._nlp_tried = False

    def _create_record(self, content):
        db = self.TestSession()
        rec = SourceRecord(source_type="txt", title="t", content=content)
        db.add(rec)
        db.commit()
        db.refresh(rec)
        rid = rec.id
        db.close()
        return rid

    def test_endpoint_empty_content_ok(self):
        rid = self._create_record("Sara Alvarez called 555-014-7721.")
        spans = [FakeSpan("PERSON", "Sara Alvarez", 0, 12)]
        fake_nlp = FakeNlp(spans)
        with mock.patch.object(nlp, "get_nlp", return_value=fake_nlp):
            resp = self.client.get(f"/source-records/{rid}/entities")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["source_record_id"], rid)
        types = [e["entity_type"] for e in body["entities"]]
        self.assertIn("PERSON", types)
        self.assertIn("PHONE", types)

    def test_endpoint_returns_404_for_missing_record(self):
        resp = self.client.get("/source-records/999999/entities")
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()