"""Neo4j driver module and health-check helper.

The driver is created lazily so importing this module (or starting the app)
does not require a live Neo4j server. Connectivity is only attempted when a
graph operation or the health-check runs.

Uses the official ``neo4j`` Python driver (Bolt protocol.
"""

from typing import Optional

from neo4j import Driver, GraphDatabase
from neo4j.exceptions import Neo4jError

from app.core.config import settings

_driver: Optional[Driver] = None


def get_driver() -> Driver:
    """Return the shared Neo4j driver, creating it on first use."""
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
    return _driver


def close_driver() -> None:
    """Close the shared driver if it exists."""
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


def check_neo4j() -> dict:
    """Probe the Neo4j server and return a health payload."""
    try:
        driver = get_driver()
        with driver.session() as session:
            session.run("RETURN 1").consume()
        return {"status": "ok"}
    except Neo4jError as exc:
        return {"status": "error", "detail": str(exc)}
    except Exception as exc:  # pragma: no cover - network/auth failures vary
        return {"status": "error", "detail": str(exc)}
