"""Tests for audit logging: creation, protected/denied requests, filters,
and sensitive-data exclusion."""

import unittest

from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models.audit_log import AuditLog
from app.models.user import User
from app.services import audit as audit_service
from app.services import auth as auth_service


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


def _all_logs():
    db = SessionLocal()
    try:
        return db.query(AuditLog).order_by(AuditLog.id).all()
    finally:
        db.close()


class AuditServiceTests(unittest.TestCase):
    """Direct service-level checks."""

    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)

    def test_record_creates_row(self):
        audit_service.record(
            user_id=1,
            username="alice",
            action="READ",
            method="GET",
            path="/source-records",
            status_code=200,
            resource_type="source-records",
            client_ip="127.0.0.1",
        )
        logs = _all_logs()
        self.assertTrue(len(logs) >= 1)
        last = logs[-1]
        self.assertEqual(last.username, "alice")
        self.assertEqual(last.action, "READ")
        self.assertEqual(last.method, "GET")
        self.assertEqual(last.status_code, 200)
        self.assertFalse(last.denied)
        self.assertEqual(last.resource_type, "source-records")

    def test_parse_resource(self):
        self.assertEqual(
            audit_service.parse_resource("/source-records/3/entities"),
            ("source-records", "3"),
        )
        self.assertEqual(
            audit_service.parse_resource("/analytics/pagerank"),
            ("analytics", None),
        )
        self.assertEqual(audit_service.parse_resource("/"), (None, None))


class AuditMiddlewareTests(unittest.TestCase):
    """End-to-end logging of protected requests over HTTP."""

    @classmethod
    def setUpClass(cls):
        app.dependency_overrides.pop(get_current_user, None)
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        cls.admin = _make_user("auditadm", "ADMIN")
        cls.analyst = _make_user("auditana", "ANALYST")
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        Base.metadata.drop_all(bind=engine)

    def _login(self, username):
        resp = self.client.post(
            "/auth/login",
            json={"username": username, "password": "pw-secret-123"},
        )
        return resp.json()["access_token"]

    def _hdr(self, token):
        return {"Authorization": f"Bearer {token}"}

    def test_successful_protected_request_is_logged(self):
        token = self._login("auditadm")
        before = len(_all_logs())
        self.client.get("/source-records", headers=self._hdr(token))
        logs = _all_logs()
        self.assertEqual(len(logs), before + 1)
        last = logs[-1]
        self.assertEqual(last.username, "auditadm")
        self.assertEqual(last.user_id, self.admin.id)
        self.assertEqual(last.action, "READ")
        self.assertEqual(last.path, "/source-records")
        self.assertEqual(last.status_code, 200)
        self.assertFalse(last.denied)
        self.assertEqual(last.resource_type, "source-records")



    def test_denied_request_is_logged(self):
        token = self._login("auditana")  # ANALYST cannot list source records
        before = len(_all_logs())
        resp = self.client.get("/source-records", headers=self._hdr(token))
        self.assertEqual(resp.status_code, 403)
        logs = _all_logs()
        self.assertEqual(len(logs), before + 1)
        last = logs[-1]
        self.assertEqual(last.username, "auditana")
        self.assertEqual(last.action, "READ_DENIED")
        self.assertEqual(last.status_code, 403)
        self.assertTrue(last.denied)

    def test_unauthenticated_denied_request_is_logged(self):
        before = len(_all_logs())
        resp = self.client.get("/source-records")
        self.assertEqual(resp.status_code, 401)
        logs = _all_logs()
        self.assertEqual(len(logs), before + 1)
        last = logs[-1]
        self.assertTrue(last.denied)
        self.assertIsNone(last.username)
        self.assertIsNone(last.user_id)

    def test_health_and_login_are_not_logged(self):
        before = len(_all_logs())
        self.client.get("/health")
        self.client.post(
            "/auth/login",
            json={"username": "auditadm", "password": "pw-secret-123"},
        )
        self.assertEqual(len(_all_logs()), before)


    def test_me_is_logged_but_public_paths_are_not(self):
        token = self._login("auditadm")
        before = len(_all_logs())
        self.client.get("/auth/me", headers=self._hdr(token))
        logs = _all_logs()
        self.assertEqual(len(logs), before + 1)
        self.assertEqual(logs[-1].path, "/auth/me")

    def test_no_sensitive_data_in_logs(self):
        token = self._login("auditadm")
        self.client.get("/source-records?limit=1", headers=self._hdr(token))
        db = SessionLocal()
        try:
            rows = db.query(AuditLog).all()
        finally:
            db.close()
        for row in rows:
            serialized = " ".join(
                str(getattr(row, col.name, ""))
                for col in AuditLog.__table__.columns
            )
            self.assertNotIn(token, serialized)  # no JWT logged
            self.assertNotIn("Bearer", serialized)
            self.assertNotIn("pw-secret-123", serialized)  # no passwords
            self.assertNotIn("?", serialized)  # no query strings
            self.assertNotIn("$2", serialized)  # no bcrypt hashes
