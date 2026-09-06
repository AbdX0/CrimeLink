"""Pydantic schemas for authentication and user accounts."""

from datetime import datetime

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """Payload accepted by POST /auth/login (JSON variant)."""

    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=255)


class TokenResponse(BaseModel):
    """JWT access token returned by POST /auth/login."""

    access_token: str
    token_type: str = "bearer"
    role: str
    username: str


class UserOut(BaseModel):
    """Safe public view of a user (never exposes the password hash)."""

    id: int
    username: str
    role: str
    is_active: bool
    created_at: datetime