"""Tests for authentication, JWTs and role-based authorization."""

import unittest
from unittest.mock import patch

import jwt as jwt_exceptions
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.core.config import settings
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models.user import User
from app.services import auth as auth_service


def _make_user(username: str, role: str, active: bool = True) -> User:
    db = SessionLocal()
    try:
        user = User(
            username=username,
            password_hash=auth_service.hash_password("pw-secret-123"),
            role=role,
            is_active=active,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


class AuthLogicTests(unittest.TestCase):
    """Password hashing and token creation/validation."""

    def test_password_hash_is_not_plaintext(self):
        h = auth_service.hash_password("hunter2")
        self.assertNotIn("hunter2", h)
        self.assertTrue(h.startswith("$2"))

    def test_hash_is_salted(self):
        self.assertNotEqual(
            auth_service.hash_password("x"), auth_service.hash_password("x")
        )

    def test_verify_password_roundtrip(self):
        h = auth_service.hash_password("hunter2")
        self.assertTrue(auth_service.verify_password("hunter2", h))
        self.assertFalse(auth_service.verify_password("wrong", h))

    def test_token_contains_claims_and_role_validation(self):
        token = auth_service.create_access_token(7, "alice", "ANALYST")
        payload = auth_service.decode_token(token)
        self.assertEqual(payload["sub"], "7")
        self.assertEqual(payload["username"], "alice")
        self.assertEqual(payload["role"], "ANALYST")
        with self.assertRaises(ValueError):
            auth_service.create_access_token(1, "x", "SUPERGOD")

    def test_expired_token_rejected(self):
        token = auth_service.create_access_token(
            1, "bob", "ADMIN", expires_minutes=-1
        )
        with self.assertRaises(jwt_exceptions.ExpiredSignatureError):
            auth_service.decode_token(token)

    def test_tampered_token_rejected(self):
        token = auth_service.create_access_token(1, "bob", "ADMIN")
        with self.assertRaises(jwt_exceptions.InvalidTokenError):
            auth_service.decode_token(token + "x")



class AuthEndpointTests(unittest.TestCase):
    """Login, /me, inactive users and role authorization over HTTP."""

    @classmethod
    def setUpClass(cls):
        # Remove any get_current_user override leaked by other test modules
        # (they install a fake ADMIN to bypass auth; we test real auth here).
        app.dependency_overrides.pop(get_current_user, None)
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        cls.admin = _make_user("adm", "ADMIN")
        cls.inv = _make_user("inv", "INVESTIGATOR")
        cls.ana = _make_user("ana", "ANALYST")
        cls.off = _make_user("off", "INVESTIGATOR", active=False)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        Base.metadata.drop_all(bind=engine)

    def _login(self, username, password="pw-secret-123"):
        return self.client.post(
            "/auth/login", json={"username": username, "password": password}
        )

    def test_login_success_returns_token(self):
        resp = self._login("inv")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["token_type"], "bearer")
        self.assertEqual(body["role"], "INVESTIGATOR")
        self.assertTrue(len(body["access_token"]) > 20)

    def test_login_wrong_password_401(self):
        self.assertEqual(self._login("inv", "nope").status_code, 401)

    def test_login_unknown_user_401(self):
        self.assertEqual(self._login("ghost").status_code, 401)

    def test_login_inactive_user_401(self):
        self.assertEqual(self._login("off").status_code, 401)

    def test_me_requires_token(self):
        self.assertEqual(self.client.get("/auth/me").status_code, 401)

    def test_me_returns_profile_without_hash(self):
        token = self._login("ana").json()["access_token"]
        resp = self.client.get(
            "/auth/me", headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["username"], "ana")
        self.assertNotIn("password_hash", body)

    def test_invalid_token_401(self):
        resp = self.client.get(
            "/auth/me", headers={"Authorization": "Bearer not-a-jwt"}
        )
        self.assertEqual(resp.status_code, 401)

    def test_protected_endpoint_requires_auth(self):
        self.assertEqual(
            self.client.get("/source-records").status_code, 401
        )

    def test_analyst_cannot_access_investigator_routes(self):
        token = self._login("ana").json()["access_token"]
        resp = self.client.post(
            "/source-records",
            json={"source_type": "txt", "title": "t"},
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(resp.status_code, 403)

    def test_analyst_can_access_analytics_routes(self):
        token = self._login("ana").json()["access_token"]
        resp = self.client.get(
            "/analytics/degree-centrality",
            headers={"Authorization": f"Bearer {token}"},
        )
        # 200 (Neo4j up) or 503 (Neo4j down) — never 401/403.
        self.assertIn(resp.status_code, (200, 503))

    def test_investigator_can_access_investigation_routes(self):
        token = self._login("inv").json()["access_token"]
        resp = self.client.get(
            "/source-records",
            headers={"Authorization": f"Bearer {token}"},
        )
        self.assertEqual(resp.status_code, 200)

    def test_admin_full_access(self):
        token = self._login("adm").json()["access_token"]
        hdr = {"Authorization": f"Bearer {token}"}
        self.assertEqual(
            self.client.get("/source-records", headers=hdr).status_code, 200
        )
        resp = self.client.get("/analytics/degree-centrality", headers=hdr)
        self.assertIn(resp.status_code, (200, 503))

    def test_health_is_public(self):
        self.assertEqual(self.client.get("/health").status_code, 200)


    def test_wrong_secret_rejected(self):
        token = auth_service.create_access_token(1, "bob", "ADMIN")
        with patch.object(settings, "jwt_secret_key", "other-secret"):
            with self.assertRaises(jwt_exceptions.InvalidTokenError):
                auth_service.decode_token(token)


if __name__ == "__main__":
    unittest.main()

