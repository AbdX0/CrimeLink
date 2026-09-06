"""Tests for the end-to-end investigator pipeline workflow (Step 16)."""

import os
import sys
import unittest
from unittest import mock

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from app.api.deps import get_current_user
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models.audit_log import AuditLog
from app.models.source_entity import SourceEntity
from app.models.source_record import SourceRecord
from app.models.user import User
from app.services import auth as auth_service
from app.services import pipeline as pipeline_service


class FakeResult:
    def __init__(self, created: bool):
        self._created = created

    def single(self):
        return {"created": self._created}


class FakeSession:
    def __init__(self, created: bool = True):
        self.created = created
        self.calls = []

    def run(self, query, params=None):
        self.calls.append((query, params))
        return FakeResult(self.created)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeDriver:
    def __init__(self, created: bool = True):
        self.fake_session = FakeSession(created)

    def session(self):
        return self.fake_session


def _make_user(username: str, role: str) -> User:
    db = SessionLocal()
    try:
        user = User(
            username=username,
            password_hash=auth_service.hash_password("pw-secret-123"),
            role=role,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


class PipelineServiceTests(unittest.TestCase):
    """Direct tests for the pipeline orchestration service."""

    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)

    def setUp(self):
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_process_source_record_success(self):
        record = SourceRecord(
            source_type="txt",
            title="Investigation Note 101",
            content="Suspect Sara Alvarez called 555-014-7721 regarding CASE-2023-0042 in vehicle AB-1234.",
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)

        fake_driver = FakeDriver(created=True)
        with mock.patch("app.services.graph_populate.get_driver", return_value=fake_driver):
            result = pipeline_service.process_source_record(record.id, self.db)

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["source_record_id"], record.id)
        self.assertEqual(result["source_record"]["title"], "Investigation Note 101")
        self.assertTrue(len(result["entities"]) >= 2)  # regex extracts PHONE, CASE, VEHICLE
        self.assertIn("resolution", result)
        self.assertIsNotNone(result["graph"])
        self.assertEqual(len(result["errors"]), 0)

        # Verify entities were stored in DB with source_record_id
        stored_entities = (
            self.db.query(SourceEntity)
            .filter(SourceEntity.source_record_id == record.id)
            .all()
        )
        self.assertTrue(len(stored_entities) >= 2)
        for ent in stored_entities:
            self.assertEqual(ent.source_record_id, record.id)

    def test_process_source_record_not_found(self):
        with self.assertRaises(ValueError):
            pipeline_service.process_source_record(999999, self.db)

    def test_process_source_record_partial_graph_failure(self):
        record = SourceRecord(
            source_type="txt",
            title="Graph Down Note",
            content="Phone 555-014-9999 involved in CASE-2024-0001.",
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)

        with mock.patch("app.services.graph_populate.populate_source_record", side_effect=RuntimeError("Connection refused")):
            result = pipeline_service.process_source_record(record.id, self.db)

        self.assertEqual(result["status"], "partial")
        self.assertIn("graph_population", result["errors"])
        self.assertIsNone(result["graph"])
        # Entities & resolution still succeeded
        self.assertTrue(len(result["entities"]) >= 1)

    def test_process_file_txt(self):
        fake_driver = FakeDriver(created=True)
        file_bytes = b"Subject John Doe phone 555-014-3333 linked to CASE-2023-9999."

        with mock.patch("app.services.graph_populate.get_driver", return_value=fake_driver):
            result = pipeline_service.process_file(
                "case_report.txt",
                file_bytes,
                title="Case Report Ingested",
                db=self.db,
            )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["source_record"]["title"], "Case Report Ingested")
        self.assertEqual(result["source_record"]["source_type"], "txt")
        self.assertTrue(len(result["entities"]) >= 2)


class PipelineEndpointTests(unittest.TestCase):
    """End-to-end HTTP pipeline tests with RBAC and Audit Logging."""

    @classmethod
    def setUpClass(cls):
        app.dependency_overrides.pop(get_current_user, None)
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        cls.admin = _make_user("pipeadm", "ADMIN")
        cls.inv = _make_user("pipeinv", "INVESTIGATOR")
        cls.ana = _make_user("pipeana", "ANALYST")
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        Base.metadata.drop_all(bind=engine)

    def _login(self, username: str) -> str:
        resp = self.client.post(
            "/auth/login",
            json={"username": username, "password": "pw-secret-123"},
        )
        return resp.json()["access_token"]

    def _hdr(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}"}

    def test_unauthenticated_request_rejected(self):
        resp = self.client.post("/pipeline/process/source-record/1")
        self.assertEqual(resp.status_code, 401)

    def test_analyst_role_forbidden(self):
        token = self._login("pipeana")
        resp = self.client.post(
            "/pipeline/process/source-record/1",
            headers=self._hdr(token),
        )
        self.assertEqual(resp.status_code, 403)

    def test_investigator_process_source_record(self):
        token = self._login("pipeinv")

        # Create a record first
        create_resp = self.client.post(
            "/source-records",
            json={
                "source_type": "txt",
                "title": "Pipeline Test Record",
                "content": "Contact 555-014-4444 and vehicle XY-9876 in CASE-2023-8888.",
            },
            headers=self._hdr(token),
        )
        self.assertEqual(create_resp.status_code, 201)
        record_id = create_resp.json()["id"]

        fake_driver = FakeDriver(created=True)
        with mock.patch("app.services.graph_populate.get_driver", return_value=fake_driver):
            resp = self.client.post(
                f"/pipeline/process/source-record/{record_id}",
                headers=self._hdr(token),
            )

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["source_record_id"], record_id)
        self.assertTrue(len(body["entities"]) >= 2)
        self.assertIn("resolution", body)
        self.assertIn("graph", body)

        # Verify audit log was created for this request
        db = SessionLocal()
        try:
            audit_row = (
                db.query(AuditLog)
                .filter(
                    AuditLog.username == "pipeinv",
                    AuditLog.path == f"/pipeline/process/source-record/{record_id}",
                )
                .order_by(AuditLog.id.desc())
                .first()
            )
            self.assertIsNotNone(audit_row)
            self.assertEqual(audit_row.action, "CREATE")
            self.assertEqual(audit_row.status_code, 200)
            self.assertFalse(audit_row.denied)
        finally:
            db.close()

    def test_process_file_upload_endpoint(self):
        token = self._login("pipeinv")
        fake_driver = FakeDriver(created=True)

        file_content = b"Case file details: suspect phone 555-014-5555 vehicle CD-5678."

        with mock.patch("app.services.graph_populate.get_driver", return_value=fake_driver):
            resp = self.client.post(
                "/pipeline/process/file",
                files={"file": ("evidence_upload.txt", file_content, "text/plain")},
                data={"title": "Uploaded Evidence File"},
                headers=self._hdr(token),
            )

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["source_record"]["title"], "Uploaded Evidence File")
        self.assertTrue(len(body["entities"]) >= 2)

    def test_get_single_source_record_endpoint(self):
        token = self._login("pipeinv")
        create_resp = self.client.post(
            "/source-records",
            json={
                "source_type": "txt",
                "title": "Single Record Test",
                "content": "Sample content for single record test.",
            },
            headers=self._hdr(token),
        )
        self.assertEqual(create_resp.status_code, 201)
        rec_id = create_resp.json()["id"]

        get_resp = self.client.get(
            f"/source-records/{rec_id}",
            headers=self._hdr(token),
        )
        self.assertEqual(get_resp.status_code, 200)
        self.assertEqual(get_resp.json()["title"], "Single Record Test")

        not_found_resp = self.client.get(
            "/source-records/999999",
            headers=self._hdr(token),
        )
        self.assertEqual(not_found_resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
