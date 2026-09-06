"""Authentication endpoints: login and current-user information."""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.user import LoginRequest, TokenResponse, UserOut
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _login_user(db: Session, username: str, password: str) -> TokenResponse:
    """Validate credentials and issue a JWT (shared by both login forms)."""
    user = db.query(User).filter(User.username == username).first()
    # Same generic error for unknown user and bad password (no user probing).
    if user is None or not auth_service.verify_password(
        password, user.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is deactivated",
        )
    token = auth_service.create_access_token(
        user.id, user.username, user.role
    )
    return TokenResponse(
        access_token=token,
        role=user.role,
        username=user.username,
    )


@router.post("/login", response_model=TokenResponse)
def login_json(payload: LoginRequest, db: Session = Depends(get_db)):
    """Login with a JSON body {"username", "password"}."""
    return _login_user(db, payload.username, payload.password)


@router.post("/login-form", response_model=TokenResponse, include_in_schema=False)
def login_form(
    form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
):
    """OAuth2 password-form login (used by the /docs Authorize button)."""
    return _login_user(db, form.username, form.password)


@router.get("/me", response_model=UserOut)
def read_current_user(user: User = Depends(get_current_user)):
    """Return the authenticated user's profile (no password hash)."""
    return user
