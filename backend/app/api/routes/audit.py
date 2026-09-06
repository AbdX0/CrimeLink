"""Audit-log query endpoints (ADMIN-only, read-only)."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.audit_log import AuditLog

router = APIRouter(prefix="/audit-logs", tags=["audit"])


class AuditLogItem(BaseModel):
    """One audit-log entry as returned by the API."""

    id: int
    user_id: Optional[int]
    username: Optional[str]
    action: str
    method: str
    path: str
    status_code: int
    timestamp: datetime
    resource_type: Optional[str]
    resource_id: Optional[str]
    client_ip: Optional[str]
    denied: bool

    model_config = {"from_attributes": True}


@router.get("", response_model=list[AuditLogItem])
def list_audit_logs(
    username: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    path: Optional[str] = Query(default=None),
    date_from: Optional[datetime] = Query(default=None),
    date_to: Optional[datetime] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Query audit logs with basic filtering (ADMIN only, append-only data)."""
    q = db.query(AuditLog)
    if username:
        q = q.filter(AuditLog.username == username)
    if action:
        q = q.filter(AuditLog.action == action)
    if path:
        q = q.filter(AuditLog.path.contains(path))
    if date_from is not None:
        q = q.filter(AuditLog.timestamp >= date_from)
    if date_to is not None:
        q = q.filter(AuditLog.timestamp <= date_to)
    return q.order_by(AuditLog.id.desc()).limit(limit).all()
