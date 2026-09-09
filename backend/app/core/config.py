"""Application configuration.

PostgreSQL and Neo4j connection settings and other runtime values are read
from environment variables (optionally sourced from a local .env file).
AI/NLP, OCR, authentication, and analytics settings will land here later.
"""

import os

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover - dotenv is optional in some setups
    pass


class Settings:
    """Runtime configuration loaded from environment variables."""

    app_name: str = os.getenv("APP_NAME", "CrimeLink API")
    app_version: str = os.getenv("APP_VERSION", "0.1.0")

    # SQLAlchemy PostgreSQL connection string (psycopg3 driver), e.g.
    # postgresql+psycopg://user:password@localhost:5432/crimelink
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://postgres:postgres@localhost:5432/crimelink",
    )

    # Neo4j (Bolt) connection settings, e.g. bolt://localhost:7687
    neo4j_uri: str = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    neo4j_user: str = os.getenv("NEO4J_USER", "neo4j")
    neo4j_password: str = os.getenv("NEO4J_PASSWORD", "neo4j_dev")

    # spaCy pipeline model used for named-entity recognition (PERSON, LOCATION,
    # ORGANIZATION). Install with, e.g., python -m spacy download en_core_web_sm.
    ner_model: str = os.getenv("NER_MODEL", "en_core_web_sm")

    # Entity resolution thresholds (similarity score in 0..100 from RapidFuzz).
    # Matches below these are not merged; they are reported as 'no_match'.
    entity_match_threshold: float = float(
        os.getenv("ENTITY_MATCH_THRESHOLD", "85")
    )
    entity_candidate_threshold: float = float(
        os.getenv("ENTITY_CANDIDATE_THRESHOLD", "60")
    )

    # Authentication / JWT settings. Override the secret in production via
    # the JWT_SECRET_KEY environment variable (generate with e.g.
    # python -c "import secrets; print(secrets.token_hex(32))").
    jwt_secret_key: str = os.getenv(
        "JWT_SECRET_KEY",
        "dev-only-insecure-secret-change-me",
    )
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    access_token_expire_minutes: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480")
    )

    # Google Gemini API key for AI Assistant reasoning & interrogation
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


settings = Settings()