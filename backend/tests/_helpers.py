"""Shared test helpers."""

from contextlib import contextmanager

from app.api.deps import get_current_user
from app.main import app
from app.models.user import User


def _fake_admin() -> User:
    """A non-persisted ADMIN user used to bypass auth in older tests."""
    return User(id=1, username="test-admin", role="ADMIN", is_active=True)


def use_fake_admin() -> None:
    """Install the fake-ADMIN override (call in setUpClass / fixtures)."""
    app.dependency_overrides[get_current_user] = _fake_admin


@contextmanager
def bypass_auth():
    """Temporarily override authentication with a fake ADMIN user.

    Role-based behavior is tested in tests/test_auth.py; other endpoint
    tests use this to keep focusing on their own functionality.
    """
    app.dependency_overrides[get_current_user] = _fake_admin
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)
