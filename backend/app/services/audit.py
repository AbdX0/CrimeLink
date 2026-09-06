"""Audit service: append-only logging of authenticated API activity.

Design notes:

- A dedicated ASGI middleware (``AuditMiddleware``) records one row per
  request to a protected API path, including denied (401/403) requests.
- Only metadata is stored: who, what action, which path, status, when,
  which resource, client IP. Request bodies, query strings, passwords,
  password hashes, and Authorization/JWT tokens are NEVER logged.
- Writes are best-effort: an audit failure must never break the API.
- Records are append-only: this module only INSERTs.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.models.audit_log import AuditLog
from app.services import auth as auth_service

logger = logging.getLogger(__name__)

# Paths that never get audit rows: public/uninteresting endpoints.
PUBLIC_PREFIXES = (
    "/health",
    "/auth/login",
    "/docs",
    "/redoc",
    "/openapi.json",
)

# HTTP method -> audit action verb.
ACTION_BY_METHOD = {
    "GET": "READ",
    "POST": "CREATE",
    "PUT": "UPDATE",
    "PATCH": "UPDATE",
    "DELETE": "DELETE",
}


def parse_resource(path: str) -> tuple[Optional[str], Optional[str]]:
    """Best-effort (resource_type, resource_id) from an API path.

    e.g. ``/source-records/3/entities`` -> ("source_records", "3").
    """
    parts = [p for p in path.split("/") if p]
    if not parts:
        return None, None
    resource_type = parts[0]
    resource_id = parts[1] if len(parts) > 1 and parts[1].isdigit() else None
    return resource_type, resource_id


def record(
    *,
    user_id: Optional[int],
    username: Optional[str],
    action: str,
    method: str,
    path: str,
    status_code: int,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    client_ip: Optional[str] = None,
    denied: bool = False,
) -> None:
    """Insert one audit row in its own short-lived session (best effort)."""
    # Local import avoids a circular import at module load time.
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        db.add(
            AuditLog(
                user_id=user_id,
                username=username,
                action=action,
                method=method,
                path=path,
                status_code=status_code,
                timestamp=datetime.now(timezone.utc),
                resource_type=resource_type,
                resource_id=resource_id,
                client_ip=client_ip,
                denied=denied,
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001 - auditing must never break the API
        db.rollback()
        logger.exception("Failed to write audit log")
    finally:
        db.close()


class AuditMiddleware(BaseHTTPMiddleware):
    """Log authenticated/denied requests to protected API paths."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        path = request.url.path  # path only — never the query string
        if response.status_code in (401, 403) or not any(
            path.startswith(p) for p in PUBLIC_PREFIXES
        ):
            # Authenticated or denied request to a protected path (and any
            # non-public 401/403, e.g. failed /auth/me).
            self._log_request(request, response.status_code, path)
        return response

    def _log_request(self, request: Request, status_code: int, path: str) -> None:
        denied = status_code in (401, 403)
        user_id: Optional[int] = None
        username: Optional[str] = None

        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[len("Bearer "):]
            try:
                payload = auth_service.decode_token(token)
                user_id = int(payload.get("sub")) if payload.get("sub") else None
                username = payload.get("username")
            except Exception:  # noqa: BLE001 - invalid/expired tokens are fine
                pass

        verb = ACTION_BY_METHOD.get(request.method, request.method)
        action = f"{verb}_DENIED" if denied else verb
        resource_type, resource_id = parse_resource(path)
        client_ip = request.client.host if request.client else None

        record(
            user_id=user_id,
            username=username,
            action=action,
            method=request.method,
            path=path,
            status_code=status_code,
            resource_type=resource_type,
            resource_id=resource_id,
            client_ip=client_ip,
            denied=denied,
        )
