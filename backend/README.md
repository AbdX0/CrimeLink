# CrimeLink Backend

AI-powered criminal network intelligence system - backend foundation.

> Note: PostgreSQL persistence is implemented (SQLAlchemy + psycopg3) with a
> `SourceRecord` model and create/list endpoints. A Neo4j knowledge-graph
> foundation is implemented (driver, health check, minimal node/relationship
> create/query services). A data-ingestion foundation is implemented
> (`POST /ingest/file` for TXT and PDF uploads -> stored as `SourceRecord`s),
> including an OCR fallback for scanned PDFs. NLP named-entity extraction is
> implemented (`GET /source-records/{id}/entities`). Entity resolution
> (RapidFuzz-based fuzzy matching with configurable thresholds) is implemented
> via `GET /resolution/...`. Authentication, analytics,
> graph algorithms, and frontend are **not** implemented yet.

## Stack (planned)

- Python + FastAPI
- PostgreSQL (SQLAlchemy ORM + psycopg3)
- Neo4j (knowledge-graph foundation, official Python driver)
- Data ingestion: multipart upload + pypdf (TXT/PDF text extraction)
- OCR fallback for scanned PDFs: Tesseract + pytesseract + PyMuPDF
- NLP named-entity extraction: spaCy + regex
- Entity resolution: RapidFuzz fuzzy matching
- NetworkX (future)
- Docker (future)

## Project structure

```text
backend/
├── app/
│   ├── main.py                     # FastAPI app entry point
│   ├── database.py                 # SQLAlchemy engine, session, Base, get_db
│   ├── neo4j.py                   # Neo4j driver, session, health-check helper
│   ├── api/
│   │   └── routes/
│   │       ├── health.py           # GET /health, GET /health/neo4j
│   │       ├── source_records.py   # GET/POST /source-records
│   │       ├── ingest.py           # POST /ingest/file (TXT/PDF upload)
│   │       ├── resolution.py       # GET /resolution/entity/{id}, /source-record/{id}
│   │       └── graph_population.py # POST /graph/populate/source-record/{id}
│   ├── core/
│   │   └── config.py               # Runtime settings incl. DATABASE_URL, NEO4J_*
│   ├── models/
│   │   ├── source_record.py        # SourceRecord ORM model
│   │   └── source_entity.py        # SourceEntity ORM model (extracted entities)
│   ├── schemas/
│   │   ├── source_record.py        # Pydantic schemas for SourceRecord
│   │   └── source_entity.py        # Pydantic schemas for extracted entities
│   └── services/
│       ├── graph.py                # Minimal Neo4j create/query service
│       ├── ingest.py               # TXT/PDF text extraction for ingestion
│       ├── ocr.py                  # Tesseract OCR fallback for scanned PDFs
│       ├── nlp.py                  # spaCy NER + regex entity extraction
│       ├── resolution.py           # RapidFuzz entity-resolution service
│       ├── analytics.py            # Network analytics (degree, PageRank, Louvain, shortest path)
│       └── graph_populate.py       # Project SourceEntity data into Neo4j
│       ├── patterns.py             # Rule-based suspicious-pattern detection

├── requirements.txt
├── .env.example
└── .gitignore
```

The virtual environment (`.venv`) is not committed to git.

## Prerequisites

- Python 3.9+ installed on your machine.
- A running PostgreSQL server (only required for database features; the API
  and `GET /health` start without one).

## Setup

Create the virtual environment (only needed once):

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment:

- **Windows (PowerShell)**:

    ```powershell
    .venv\Scripts\Activate.ps1
    ```

    If PowerShell blocks scripts, run:

    ```powershell
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
    ```

- **macOS / Linux**:

    ```bash
    source .venv/bin/activate
    ```

Install dependencies:

```bash
pip install -r requirements.txt
```

### PostgreSQL configuration

Configure the database connection by copying `.env.example` to `.env` and
setting `DATABASE_URL`, for example:

```text
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/crimelink
```

On startup, the app attempts to create its tables (`source_records`) via
`Base.metadata.create_all`. If PostgreSQL is not reachable, startup does not
fail, but the `GET/POST /source-records` endpoints will error until the DB is
up. For production, prefer running migrations (e.g. Alembic) rather than
`create_all`.

### Neo4j configuration

Configurethe Neo4j connection by adding these variables to `.env` (see
`.env.example`):

```text
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=neo4j_dev
```

The Neo4j driver is created lazily; the app starts without a live server. Probe
connectivity via:

```bash
curl http://127.0.0.1:8000/health/neo4j
```

### Neo4j graph foundation

Minimal graph service functions live in `app/services/graph.py`, constrained to
a whitelist of entity types and relationship types`.

- **Entity types:** `PERSON`, `PHONE`, `VEHICLE`, `ACCOUNT`, `LOCATION`,
  `ORGANIZATION`, `CASE`, `EVENT`
- **Relationship types:** `CALLS`, `USES`, `OWNS`, `TRANSFERS`, `VISITS`,
  `ASSOCIATED_WITH`, `INVOLVED_IN`
- Relationships support optional `timestamp`, `confidence`, and `evidence_source_id`
  properties (where applicable).

Functions:
- `create_node(entity_type, node_id, properties=None)` — MERGE a node keyed by `id`.
- `create_relationship(rel_type, from_entity_type, from_id, to_entity_type, to_id, *, timestamp=None, confidence=None, evidence_source_id=None)` — MERGE a typed relationship.

- `query_nodes(entity_type=None, limit=100)` — list nodes.
- `query_relationships(rel_type=None, limit=100)` — list relationships.

None of these functions run at import time; they connect only when invoked.

### Data ingestion

`POST /ingest/file` accepts a file upload (multipart form data) for TXT and PDF
source documents, extracts its text, and stores it as a `SourceRecord` in
PostgreSQL (`source_type` derived from the extension, e.g. `txt`/`pdf`, with the
extracted text as `content`). The original source filename is preserved (used as
the record `title` when no title is supplied) and included in the response.

Supported types: `.txt`, `.pdf`. Unsupported file types return HTTP `400`.

**OCR fallback (scanned PDFs):** PDF text is first extracted with `pypdf`. If a
PDF has little or no extractable text (treated as scanned), the pages are
rendered to images with PyMuPDF and OCR'd with Tesseract
(`app/services/ocr.py`). If Tesseract is not installed, ingestion of a
text-less PDF returns HTTP `503` with a clear message.

> Tesseract is an external engine. Install it separately (e.g.
> `apt install tesseract-ocr` on Debian/Ubuntu, `brew install tesseract` on
> macOS, or use the Ubuntu installer for Windows) and ensure it is on `PATH`. The
> Python dependencies are in `requirements.txt`.

Example (TXT):

```bash
curl -X POST http://127.0.0.1:8000/ingest/file \
  -F "file=@/path/to/note.txt" \
  -F "title=Investigation note"
```

Example (PDF):

```bash
curl -X POST http://127.0.0.1:8000/ingest/file \
  -F "file=@/path/to/report.pdf"
```

Response:

```json
{ "id": 3, "source_type": "txt", "title": "Investigation note",
  "filename": "note.txt", "content_length": 42, "created_at": "2026-09-01T00:00:00" }
```

`app/services/ingest.py` contains the text-extraction logic and
`app/services/ocr.py` the OCR fallback. NLP and entity extraction will build on
this later.

### NLP entity extraction

`GET /source-records/{id}/entities` extracts and returns typed entities from a
stored `SourceRecord`'s text. The response contains the `source_record_id` and a
list of entity objects:

```json
{
  "source_record_id": 3,
  "entities": [
    { "entity_type": "PERSON", "entity_text": "Sara Alvarez",
      "start": 0, "end": 12, "confidence": 0.9, "source_record_id": 3 },
    { "entity_type": "PHONE", "entity_text": "555-014-7721",
      "start": 29, "end": 42, "confidence": 0.7, "source_record_id": 3 }
  ]
}
```

Extraction (`app/services/nlp.py`, isolated in a dedicated service):

- **spaCy NER** for natural-language entities -> `PERSON`, `LOCATION` (from `LOC`/`GPE`),
  `ORGANIZATION` (from `ORG`).
- **Lightweight regex** for structured values -> `PHONE`, `VEHICLE`,
  `ACCOUNT`, `CASE`.

Each entity carries `entity_type`, `entity_text`, `start`, `end`, `confidence`,
and a `source_record_id` (persisted as `SourceEntity` rows in PostgreSQL).

If the spaCy model is unavailable, the endpoint returns HTTP `503` with a clear
message instead of failing silently. Install the model with:

```bash
python -m spacy download en_core_web_sm   # or set NER_MODEL to another model
```

The configured model name is read from the `NER_MODEL` environment variable
(default `en_core_web_sm`, see `app/core/config.py`).

### Entity resolution

`GET /resolution/entity/{entity_id}` resolves one entity against all other
stored entities; `GET /resolution/source-record/{source_record_id}` resolves
every entity of a source record. Optional query parameters
`match_threshold` and `candidate_threshold` override the configured defaults.

```json
{
  "entity_id": 1,
  "entity_type": "PERSON",
  "entity_text": "Sara Alvarez",
  "normalized_value": "sara alvarez",
  "resolved_with": [
    { "entity_id": 3, "entity_type": "PERSON",
      "entity_text": "Sara M. Alvarez", "normalized_value": "sara m alvarez",
      "similarity": 91.5, "resolution_status": "match" }
  ],
  "resolution_status": "match"
}
```

Resolution logic (isolated in `app/services/resolution.py`):

- **Normalization** — lowercase, collapse whitespace, strip basic punctuation.
- **Compatibility** — only entities of the same `entity_type` are compared.
- **Similarity** — RapidFuzz `WRatio` score (0–100) on normalized text.
- **Thresholds** — `ENTITY_MATCH_THRESHOLD` (default **85**) marks a `match`;
  `ENTITY_CANDIDATE_THRESHOLD` (default **60**) marks a `candidate` for review;
  anything below is `no_match`. Nothing is ever merged automatically — the
  original `SourceEntity` rows are preserved untouched.

### Neo4j graph population

`POST /graph/populate/source-record/{id}` projects a source record's extracted
entities into the Neo4j knowledge graph (entities must exist first — call
`GET /source-records/{id}/entities`). It is **idempotent**: nodes use
deterministic ids (`TYPE:normalized text`) and relationships MERGE per evidence
source, so repeated population never duplicates graph data. Existing Neo4j data
is never deleted.

Response:

```json
{ "source_record_id": 3, "nodes_created": 2, "nodes_merged": 1,
  "relationships_created": 2, "relationships_merged": 0 }
```

Mapping (`app/services/graph_populate.py`, reuses the `app.services.graph`
whitelists):

- Each unique entity becomes a `(:TYPE {id: "TYPE:normalized-text"})` node
  (PERSON, PHONE, VEHICLE, ACCOUNT, LOCATION, ORGANIZATION, CASE, EVENT) with
  `name`, `confidence` and `source_record_id` (first-seen).
- Entities co-occurring in the same record are linked `ASSOCIATED_WITH`
  (directed in text order).
- Non-CASE entities appearing alongside a CASE are linked `INVOLVED_IN`
  (entity -> CASE).
- Relationships carry `evidence_source_id` (the source record id), the
  record's `created_at` timestamp, and a `confidence` (minimum of the two
  entity confidences).

If Neo4j is unreachable, the endpoint returns HTTP `503` with a clear message.


### Network analytics (read-only)

`app/services/analytics.py` provides read-only graph analytics over the Neo4j
knowledge graph:

- `GET /analytics/degree-centrality` — most-connected entities (pure Cypher,
  optional `entity_type` and `limit` filters).
- `GET /analytics/shortest-path?from_id=...&to_id=...` — shortest path between
  two entity ids (pure Cypher; 404 if an entity does not exist).
- `GET /analytics/pagerank` — PageRank scores (requires the Neo4j Graph Data
  Science plugin).
- `GET /analytics/communities` — Louvain community detection (requires GDS).

All endpoints return `{algorithm, results|...}` JSON with entity IDs and
scores. GDS algorithms run on a temporary in-memory projection which is
dropped immediately after use; stored graph data is never modified or deleted.
If GDS or Neo4j is unavailable, the endpoints return HTTP `503` with a clear
message instead of failing silently.

### Suspicious-pattern detection (read-only, rule-based)

`app/services/patterns.py` detects explainable, deterministic suspicious
patterns from the existing Neo4j graph (no ML):

- `HIGH_ACTIVITY` — degree unusually above the network mean (z-score).
- `HUB` — highly connected entity (absolute degree threshold).
- `RELATIONSHIP_CONCENTRATION` — one relationship type dominates (share).
- `MULTI_HOP_REACH` — reaches unusually many entities within `max_hops`.

Every alert includes `entity_id`, `pattern_type`, `risk_score` (0-100),
`explanation`, and `evidence_source_ids` (from relationship evidence).

- `GET /patterns/suspicious` — ranked alerts; all thresholds configurable via
  query params (`zscore_threshold`, `hub_degree`, `concentration_threshold`,
  `multihop_reach_threshold`, `max_hops`). Missing Neo4j returns HTTP `503`.

### Authentication & role-based access control

`app/services/auth.py` + `app/api/deps.py` implement JWT authentication with
bcrypt password hashing (no plaintext passwords are ever stored).

- `POST /auth/login` — JSON `{"username", "password"}` → JWT access token
  (`POST /auth/login-form` accepts the OAuth2 form for the `/docs` button).
- `GET /auth/me` — the authenticated user's profile (no password hash).

Roles: **ADMIN** (full access), **INVESTIGATOR** (investigation/data access),
**ANALYST** (read-only analytics/graph access).

| Route group | Roles allowed |
| --- | --- |
| `/health`, `/auth/*` | public |
| `/source-records`, `/ingest`, `/resolution`, `/graph/populate` | ADMIN, INVESTIGATOR |
| `/graph/network`, `/graph/evidence`, `/analytics`, `/patterns` | ADMIN, INVESTIGATOR, ANALYST |

Send the token as `Authorization: Bearer <token>`. Missing/invalid tokens
return `401`; valid tokens with an insufficient role return `403`. JWT
settings (`JWT_SECRET_KEY`, `JWT_ALGORITHM`,
`ACCESS_TOKEN_EXPIRE_MINUTES`) come from the environment. Create users with
`python scripts/create_user.py <username> <password> <ROLE>` (interactive
prompt fallback). Unauthenticated requests to protected endpoints return
`401`; authenticated users with the wrong role get `403`.

### Audit logging

`app/services/audit.py` provides append-only audit logging of authenticated
and denied API requests via ASGI middleware (`AuditMiddleware`).

**What is recorded** (per request): `user_id`, `username`, `action`
(`READ`/`CREATE`/`UPDATE`/`DELETE`, with `_DENIED` suffix for 401/403),
`method`, `path`, `status_code`, `timestamp`, `resource_type`, `resource_id`,
`client_ip`, `denied` flag.

**What is NEVER recorded**: passwords, password hashes, JWT tokens, request
bodies, or query strings.

**Public paths excluded**: `/health`, `/auth/login`, `/docs`, `/redoc`,
`/openapi.json` are not audited.

- `GET /audit-logs` — query audit logs (ADMIN only). Supports filters:
  `username`, `action`, `path`, `date_from`, `date_to`, `limit`.

| Route group | Roles allowed |
| --- | --- |
| `/audit-logs` | ADMIN |

Audit records are append-only: the application only inserts rows; there are
no update or delete endpoints.

### Pipeline orchestration (end-to-end workflow)

`app/services/pipeline.py` orchestrates the complete investigative pipeline:

`Ingest -> NLP entity extraction -> Entity resolution -> Neo4j graph population`

- `POST /pipeline/process/source-record/{id}` — runs extraction, resolution, and graph population for a stored `SourceRecord`.
- `POST /pipeline/process/file` — multipart file upload (TXT/PDF) that creates the record and executes the full pipeline in a single step.

| Route group | Roles allowed |
| --- | --- |
| `/pipeline/*` | ADMIN, INVESTIGATOR |

All workflow requests are protected by JWT and recorded in the PostgreSQL audit log.

## Run the backend

With the virtual environment activated, from the `backend/` directory:

```bash
uvicorn app.main:app --reload
```

Then open:

- Interactive API docs: http://127.0.0.1:8000/docs
- Health check: http://127.0.0.1:8000/health

### Verify it works

```bash
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok"}
```

### SourceRecord endpoints

- `POST /source-records` — create a source record.

  ```bash
  curl -X POST http://127.0.0.1:8000/source-records \
    -H "Content-Type: application/json" \
    -d '{"source_type": "news_article", "title": "Example", "url": "https://example.com", "content": "..."}'
  ```

- `GET /source-records?skip=0&limit=100` — list source records.

- `GET /source-records/{id}/entities` — extract entities (PERSON, PHONE,
  VEHICLE, LOCATION, ORGANIZATION, ACCOUNT, CASE) from a source record's text.

## Development

To stop the server, press `Ctrl+C` in the terminal.

To run from a specific host/port:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Run tests

```bash
python -m unittest discover -v
```