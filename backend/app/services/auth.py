"""Authentication service: bcrypt password hashing and JWT access tokens.

Passwords are never stored or logged in plaintext. Tokens carry the user id,
username and role, and expire after ``settings.access_token_expire_minutes``.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt

from app.core.config import settings

# Supported roles, ordered from most to least privileged.
ROLES = ("ADMIN", "INVESTIGATOR", "ANALYST")

# Algorithm used for password hashing.
_PASSWORD_ALGORITHM = b"2b"


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt (salt generated per call)."""
    salt = bcrypt.gensalt(rounds=12, prefix=_PASSWORD_ALGORITHM)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Check a plaintext password against a stored bcrypt hash."""
    try:
        return bcrypt.checkpw(
            password.encode("utf-8"), password_hash.encode("utf-8")
        )
    except ValueError:
        return False


def create_access_token(
    user_id: int,
    username: str,
    role: str,
    expires_minutes: Optional[int] = None,
) -> str:
    """Create a signed JWT access token for the given user."""
    if role not in ROLES:
        raise ValueError(f"Unknown role: {role!r}")
    now = datetime.now(timezone.utc)
    expire = now + timedelta(
        minutes=(
            expires_minutes
            if expires_minutes is not None
            else settings.access_token_expire_minutes
        )
    )
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "iat": now,
        "exp": expire,
    }
    return jwt.encode(
        payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )


def decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises jwt exceptions when invalid."""
    return jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
    )
