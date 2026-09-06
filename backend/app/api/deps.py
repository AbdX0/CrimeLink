"""Shared FastAPI dependencies: current-user resolution and role checks."""

from typing import Optional, Sequence

import jwt as jwt_exceptions
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.services import auth as auth_service

# Token is expected as a Bearer token (POST /auth/login also accepts the
# OAuth2 password form so it integrates with the /docs "Authorize" button).
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login-form", auto_error=False)

_401_HEADERS = {"WWW-Authenticate": "Bearer"}


def _credentials_error(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers=_401_HEADERS,
    )


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the requesting user from the Bearer token (or 401)."""
    if not token:
        raise _credentials_error()
    try:
        payload = auth_service.decode_token(token)
    except jwt_exceptions.ExpiredSignatureError:
        raise _credentials_error("Token has expired")
    except jwt_exceptions.InvalidTokenError:
        raise _credentials_error("Invalid token")

    user_id = payload.get("sub")
    if user_id is None:
        raise _credentials_error("Invalid token")
    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None or not user.is_active:
        raise _credentials_error("User not found or inactive")
    return user


def require_roles(*allowed: str):
    """Dependency factory: allow only users whose role is in ``allowed``.

    Usage: ``Depends(require_roles("ADMIN", "INVESTIGATOR"))``. ADMIN always
    has access regardless of the listed roles.
    """

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role == "ADMIN" or user.role in allowed:
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role {user.role!r} is not permitted to access this "
            "resource",
        )

    return checker


# Convenience dependency tuples for the standard role tiers. ANALYST tier is
# read-only analytics/graph access (INVESTIGATORs also get it).
REQUIRE_INVESTIGATOR = [Depends(require_roles("INVESTIGATOR"))]
REQUIRE_ANALYST = [Depends(require_roles("ANALYST", "INVESTIGATOR"))]
REQUIRE_ADMIN = [Depends(require_roles())]
