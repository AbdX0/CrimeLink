"""Database engine, session, and declarative base for PostgreSQL.

Uses SQLAlchemy with the psycopg (v3) driver. Models inherit from
``Base`` and are discovered via ``app.models``.
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    # Short connect timeout so startup doesn't hang when PostgreSQL is down.
    connect_args={"connect_timeout": 3},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a database session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()