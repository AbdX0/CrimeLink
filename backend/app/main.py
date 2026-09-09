"""CrimeLink backend application entry point.

Run with:
    uvicorn app.main:app --reload
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  (import models so tables are registered)

from app.api.deps import REQUIRE_ADMIN, REQUIRE_ANALYST, REQUIRE_INVESTIGATOR
from app.api.routes.analytics import router as analytics_router
from app.api.routes.audit import router as audit_router
from app.api.routes.auth import router as auth_router
from app.api.routes.graph_network import router as graph_network_router
from app.api.routes.graph_population import router as graph_population_router
from app.api.routes.health import router as health_router
from app.api.routes.ingest import router as ingest_router
from app.api.routes.patterns import router as patterns_router
from app.api.routes.pipeline import router as pipeline_router
from app.api.routes.resolution import router as resolution_router
from app.api.routes.source_records import router as source_records_router
from app.database import Base, engine

from app.services import audit as audit_service

app = FastAPI(
    title="CrimeLink API",
    description="AI-powered criminal network intelligence system - backend",
    version="0.1.0",
)

# Audit logging of authenticated/denied API requests (append-only).
app.add_middleware(audit_service.AuditMiddleware)

# Allow the investigator dashboard (Vite dev server) to call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public endpoints (no authentication).
app.include_router(health_router)
app.include_router(auth_router)

# Investigation/data access: ADMIN + INVESTIGATOR.
app.include_router(source_records_router, dependencies=REQUIRE_INVESTIGATOR)
app.include_router(ingest_router, dependencies=REQUIRE_INVESTIGATOR)
app.include_router(resolution_router, dependencies=REQUIRE_INVESTIGATOR)
app.include_router(graph_population_router, dependencies=REQUIRE_INVESTIGATOR)
app.include_router(pipeline_router, dependencies=REQUIRE_INVESTIGATOR)

# Read-only analytics/graph access: ADMIN + INVESTIGATOR + ANALYST.
app.include_router(graph_network_router, dependencies=REQUIRE_ANALYST)
app.include_router(analytics_router, dependencies=REQUIRE_ANALYST)
app.include_router(patterns_router, dependencies=REQUIRE_ANALYST)

# Audit-log queries: ADMIN only.
app.include_router(audit_router, dependencies=REQUIRE_ADMIN)


def _init_db() -> None:
    """Create tables and default demo users if possible without crashing when the DB is unavailable."""
    try:
        Base.metadata.create_all(bind=engine)
        from app.database import SessionLocal
        from app.models.user import User
        from app.services import auth

        db = SessionLocal()
        try:
            demo_users = (
                ("admin", "admin123", "ADMIN"),
                ("investigator", "investigator123", "INVESTIGATOR"),
                ("analyst", "analyst123", "ANALYST"),
            )
            for username, password, role in demo_users:
                existing = db.query(User).filter(User.username == username).first()
                if existing is None:
                    db.add(
                        User(
                            username=username,
                            password_hash=auth.hash_password(password),
                            role=role,
                            is_active=True,
                        )
                    )
            db.commit()
        finally:
            db.close()
    except Exception:
        pass


_init_db()


logger = logging.getLogger("crimelink")


@app.on_event("startup")
def on_startup() -> None:
    """Ensure tables and demo users are present when server starts."""
    _init_db()
    _check_connections()


def _check_connections() -> None:
    """Ping PostgreSQL and Neo4j and print a clear status line to stdout."""
    print("\n" + "─" * 50)
    print("  CrimeLink — Database Connection Check")
    print("─" * 50)

    # --- PostgreSQL ---
    try:
        from sqlalchemy import text
        from app.database import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("  ✅  PostgreSQL  — connected successfully")
    except Exception as exc:
        print(f"  ❌  PostgreSQL  — connection FAILED: {exc}")

    # --- Neo4j ---
    try:
        from app.neo4j import get_driver

        driver = get_driver()
        driver.verify_connectivity()
        print("  ✅  Neo4j       — connected successfully")
    except Exception as exc:
        print(f"  ❌  Neo4j       — connection FAILED: {exc}")

    print("─" * 50 + "\n")


@app.get("/")
def root() -> dict:
    """Basic root endpoint for quick verification that the API is running."""
    return {"message": "CrimeLink API", "docs": "/docs"}
