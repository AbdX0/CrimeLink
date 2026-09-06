"""Tests for persistent case/file deletion:
- Deleting an existing source record
- Associated PostgreSQL entities are removed
- Associated Neo4j relationships and exclusive nodes are removed
- Shared entities are preserved when referenced elsewhere
- Deleted case does not reappear in queries or listing
- Unauthorized deletion is rejected (ANALYST -> 403, unauthenticated -> 401)
- Audit log entry is recorded
"""

import os
import sys
import unittest
from typing import Generator
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models.audit_log import AuditLog
from app.models.source_entity import SourceEntity
from app.models.source_record import SourceRecord
from app.models.user import User
from app.services import auth as auth_service
from app.services.deletion import delete_source_record_and_dependencies


class FakeResult:
    def __init__(self, count: int = 1):
        self._count = count

    def single(self):
        return {"deleted_count": self._count, "c": self._count}


class FakeSession:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def run(self, query, params=None):
        self.calls.append((query, params or {}))
        return FakeResult(1)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeDriver:
    def __init__(self):
        self.fake_session = FakeSession()

    def session(self):
        return self.fake_session


class DeletionServiceUnitTests(unittest.TestCase):
    """Direct tests of delete_source_record_and_dependencies with dependency tracking."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestSession = sessionmaker(bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)

    def setUp(self):
        self.db = self.TestSession()
        self.db.query(SourceEntity).delete()
        self.db.query(SourceRecord).delete()
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_delete_record_and_exclusive_dependencies(self):
        """When a record is deleted with no shared entities, exclusive nodes & rels are deleted."""
        # Create record 1
        rec1 = SourceRecord(source_type="TXT", title="Case 1", content="Alice and Bob met.")
        self.db.add(rec1)
        self.db.commit()
        self.db.refresh(rec1)

        ent1 = SourceEntity(entity_type="PERSON", entity_text="Alice", start=0, end=5, source_record_id=rec1.id)
        ent2 = SourceEntity(entity_type="PERSON", entity_text="Bob", start=10, end=13, source_record_id=rec1.id)
        self.db.add_all([ent1, ent2])
        self.db.commit()

        fake_driver = FakeDriver()
        result = delete_source_record_and_dependencies(rec1.id, self.db, driver=fake_driver)

        self.assertIsNotNone(result)
        self.assertEqual(result["source_record_id"], rec1.id)
        self.assertEqual(result["deleted_entities_count"], 2)
        self.assertEqual(result["shared_nodes_preserved"], 0)

        # Verify DB is empty
        self.assertIsNone(self.db.query(SourceRecord).filter_by(id=rec1.id).first())
        self.assertEqual(self.db.query(SourceEntity).filter_by(source_record_id=rec1.id).count(), 0)

        # Verify Neo4j calls deleted relationships and exclusive nodes
        rel_delete_calls = [c for c in fake_driver.fake_session.calls if "WHERE r.evidence_source_id = $rec_id" in c[0]]
        self.assertTrue(len(rel_delete_calls) > 0)
        self.assertEqual(rel_delete_calls[0][1]["rec_id"], rec1.id)

        node_delete_calls = [c for c in fake_driver.fake_session.calls if "WHERE n.id IN $node_ids" in c[0]]
        self.assertTrue(len(node_delete_calls) > 0)
        deleted_ids = node_delete_calls[0][1]["node_ids"]
        self.assertIn("PERSON:alice", deleted_ids)
        self.assertIn("PERSON:bob", deleted_ids)

    def test_delete_record_preserves_shared_entities(self):
        """When an entity is shared with another remaining record, the node MUST be preserved."""
        # Record 1: Alice (exclusive) + Bob (shared)
        rec1 = SourceRecord(source_type="TXT", title="Case 1", content="Alice and Bob.")
        self.db.add(rec1)
        self.db.commit()
        self.db.refresh(rec1)

        # Record 2: Bob (shared) + Charlie (exclusive to 2)
        rec2 = SourceRecord(source_type="TXT", title="Case 2", content="Bob and Charlie.")
        self.db.add(rec2)
        self.db.commit()
        self.db.refresh(rec2)

        e1_alice = SourceEntity(entity_type="PERSON", entity_text="Alice", start=0, end=5, source_record_id=rec1.id)
        e1_bob = SourceEntity(entity_type="PERSON", entity_text="Bob", start=10, end=13, source_record_id=rec1.id)
        e2_bob = SourceEntity(entity_type="PERSON", entity_text="Bob", start=0, end=3, source_record_id=rec2.id)
        e2_charlie = SourceEntity(entity_type="PERSON", entity_text="Charlie", start=8, end=15, source_record_id=rec2.id)
        self.db.add_all([e1_alice, e1_bob, e2_bob, e2_charlie])
        self.db.commit()

        fake_driver = FakeDriver()
        result = delete_source_record_and_dependencies(rec1.id, self.db, driver=fake_driver)

        self.assertIsNotNone(result)
        self.assertEqual(result["shared_nodes_preserved"], 1)

        # Only Alice should be deleted from Neo4j; Bob MUST NOT be deleted
        node_delete_calls = [c for c in fake_driver.fake_session.calls if "WHERE n.id IN $node_ids" in c[0]]
        self.assertTrue(len(node_delete_calls) > 0)
        deleted_ids = node_delete_calls[0][1]["node_ids"]
        self.assertIn("PERSON:alice", deleted_ids)
        self.assertNotIn("PERSON:bob", deleted_ids)

        # Record 2 and its entities remain completely intact in DB
        self.assertIsNotNone(self.db.query(SourceRecord).filter_by(id=rec2.id).first())
        self.assertEqual(self.db.query(SourceEntity).filter_by(source_record_id=rec2.id).count(), 2)

    def test_delete_nonexistent_record_returns_none(self):
        fake_driver = FakeDriver()
        result = delete_source_record_and_dependencies(99999, self.db, driver=fake_driver)
        self.assertIsNone(result)


class DeletionHttpEndpointTests(unittest.TestCase):
    """HTTP-level endpoint tests covering RBAC, deletion persistence, and audit logging."""

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
        app.dependency_overrides.pop(get_current_user, None)

        cls.client = TestClient(app)

        # Create test users
        db = cls.TestSession()
        try:
            cls.admin_user = User(
                username="deladmin",
                password_hash=auth_service.hash_password("adminpass123"),
                role="ADMIN",
                is_active=True,
            )
            cls.investigator_user = User(
                username="delinves",
                password_hash=auth_service.hash_password("invespass123"),
                role="INVESTIGATOR",
                is_active=True,
            )
            cls.analyst_user = User(
                username="delanaly",
                password_hash=auth_service.hash_password("analypass123"),
                role="ANALYST",
                is_active=True,
            )
            db.add_all([cls.admin_user, cls.investigator_user, cls.analyst_user])
            db.commit()
            db.refresh(cls.admin_user)
            db.refresh(cls.investigator_user)
            db.refresh(cls.analyst_user)
        finally:
            db.close()

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def _login(self, username, password):
        resp = self.client.post("/auth/login", json={"username": username, "password": password})
        self.assertEqual(resp.status_code, 200)
        return resp.json()["access_token"]

    def _auth_header(self, token):
        return {"Authorization": f"Bearer {token}"}

    def _create_record(self, token, title="Test Case"):
        resp = self.client.post(
            "/source-records",
            headers=self._auth_header(token),
            json={"source_type": "TXT", "title": title, "content": "Test case content for deletion."},
        )
        self.assertEqual(resp.status_code, 201)
        return resp.json()["id"]

    def test_unauthenticated_deletion_returns_401(self):
        resp = self.client.delete("/source-records/1")
        self.assertEqual(resp.status_code, 401)

    def test_analyst_deletion_returns_403(self):
        token = self._login("delanaly", "analypass123")
        resp = self.client.delete("/source-records/1", headers=self._auth_header(token))
        self.assertEqual(resp.status_code, 403)

    def test_investigator_delete_existing_record_succeeds_and_does_not_reappear(self):
        token = self._login("delinves", "invespass123")
        rec_id = self._create_record(token, "Investigator Case to Delete")

        # Verify it exists in GET
        resp_get = self.client.get(f"/source-records/{rec_id}", headers=self._auth_header(token))
        self.assertEqual(resp_get.status_code, 200)

        # Delete it with investigator
        with mock.patch("app.services.deletion.get_driver", return_value=FakeDriver()):
            resp_del = self.client.delete(f"/source-records/{rec_id}", headers=self._auth_header(token))
        self.assertEqual(resp_del.status_code, 204)

        # Verify it no longer exists (404) and does not reappear
        resp_after = self.client.get(f"/source-records/{rec_id}", headers=self._auth_header(token))
        self.assertEqual(resp_after.status_code, 404)

        # Verify not in list
        resp_list = self.client.get("/source-records", headers=self._auth_header(token))
        record_ids = [r["id"] for r in resp_list.json()]
        self.assertNotIn(rec_id, record_ids)

    def test_delete_nonexistent_record_returns_404(self):
        token = self._login("delinves", "invespass123")
        with mock.patch("app.services.deletion.get_driver", return_value=FakeDriver()):
            resp_del = self.client.delete("/source-records/999999", headers=self._auth_header(token))
        self.assertEqual(resp_del.status_code, 404)

    def test_deletion_creates_audit_log_entry(self):
        token = self._login("deladmin", "adminpass123")
        rec_id = self._create_record(token, "Audit Log Test Case")

        db = self.TestSession()
        initial_logs = db.query(AuditLog).count()
        db.close()

        with mock.patch("app.services.deletion.get_driver", return_value=FakeDriver()), \
             mock.patch("app.database.SessionLocal", self.TestSession):
            resp_del = self.client.delete(f"/source-records/{rec_id}", headers=self._auth_header(token))
        self.assertEqual(resp_del.status_code, 204)

        db = self.TestSession()
        try:
            logs = db.query(AuditLog).order_by(AuditLog.id.desc()).all()
            self.assertTrue(len(logs) > initial_logs)
            latest_del_log = next((l for l in logs if l.method == "DELETE" and f"/source-records/{rec_id}" in l.path), None)
            self.assertIsNotNone(latest_del_log)
            self.assertEqual(latest_del_log.username, "deladmin")
            self.assertEqual(latest_del_log.status_code, 204)
            self.assertEqual(latest_del_log.action, "DELETE")
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
