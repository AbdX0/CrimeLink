"""NLP service: named-entity extraction from SourceRecord text.

Combines spaCy NER (PERSON, LOCATION, ORGANIZATION) with lightweight regex
extraction for softer, structured patterns (PHONE, VEHICLE, ACCOUNT, CASE).

The spaCy model is loaded lazily so importing this module (or starting the app)
never requires the model to be installed. If the model is unavailable when a
real extraction is requested, a ``ModelUnavailableError`` is raised with a clear
message (rather than silently returning nothing).
"""

import re
from typing import Optional

from app.core.config import settings


class ModelUnavailableError(Exception):
    """Raised when the configured spaCy model cannot be loaded."""


# Map spaCy NER labels to CrimeLink entity types.
SPACY_LABEL_MAP = {
    "PERSON": "PERSON",
    "LOC": "LOCATION",
    "GPE": "LOCATION",
    "ORG": "ORGANIZATION",
}


def _phone_pattern() -> re.Pattern:
    # Typical phone numbers: optional international "+<country>" prefix, then a
    # 3-digit area code and a 7-digit local number (3-3-4), with optional
    # separators or spaces. The optional international prefix requires a "+" so
    # a leading space is never absorbed.
    return re.compile(r"(?:\+\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{3,4}\b")


def _vehicle_pattern() -> re.Pattern:
    # Licence-plate-ish: 2-3 letters, dash, 2-4 digits (optionally a letter).
    return re.compile(r"\b[A-Z]{2,3}-\d{2,4}[A-Z]?\b")


def _account_pattern() -> re.Pattern:
    # Bank-account-ish runs of 12-16 digits in 3-4 groups (e.g. 1234-5678-9012).
    return re.compile(r"\b\d{4}[ -]\d{4}[ -]\d{4}(?:[ -]\d{4})?\b")


def _case_pattern() -> re.Pattern:
    # Case references: "CASE-2023-0042" or a standalone "2023-0042". Negative
    # lookbehind avoids matching a bare number that follows "CASE-", and the
    # negative lookahead avoids matching the leading groups of an account number.
    return re.compile(
        r"(?:CASE[- ]|(?<![A-Z-])\b)\d{4}-\d{2,6}(?!-\d{2,6})\b",
        re.IGNORECASE,
    )


def _event_pattern() -> re.Pattern:
    # Deterministic regex for investigative event phrases:
    # - CALL: outgoing calls, incoming calls, telephone calls, phone calls, wiretap intercepts, call intercepts, placed calls
    # - TRANSFER: wire transfers, funds transfers, money transfers, bank transfers, financial transactions, funds transferred/deposited
    # - MEETING: clandestine meetings, coordination meetings, surveillance meetings, confirmed meetings, meeting with associate(s)
    # - VISIT: site visits, border crossings, facility entry, warehouse visits, safehouse visits, location visits
    # - OBSERVATION: field surveillance, physical surveillance, surveillance operations/logs, visual observations, intelligence briefings, license plate readers, intercept transcripts
    # - ARREST: traffic stops, suspect arrests, police arrests, police raids, custody detentions, warrant executions
    return re.compile(
        r"\b("
        # CALL
        r"(?:outgoing|incoming|telephone|phone|voice|wiretap|call)\s+(?:calls?|intercepts?)|"
        r"placed\s+(?:an?\s+|multiple\s+)?(?:outgoing\s+)?calls?|"
        # TRANSFER
        r"(?:wire|funds?|money|bank|electronic)\s+transfers?|"
        r"financial\s+transactions?|"
        r"(?:cash\s+|funds?\s+)?deposits?|"
        r"funds?\s+(?:transferred|deposited)|"
        # MEETING
        r"(?:clandestine|coordination|surveillance|briefing|scheduled|confirmed)\s+meetings?|"
        r"meeting\s+with\s+(?:associates?|suspects?)|"
        # VISIT
        r"(?:site|warehouse|safehouse|location|facility)\s+visits?|"
        r"border\s+crossings?|facility\s+entry|"
        # OBSERVATION
        r"(?:field|physical|electronic)\s+surveillance|"
        r"surveillance\s+(?:operations?|logs?)|"
        r"visual\s+observations?|"
        r"intelligence\s+briefings?|"
        r"(?:automated\s+)?license\s+plate\s+readers?|"
        r"intercept\s+transcripts?|"
        # ARREST
        r"traffic\s+stops?|"
        r"(?:suspect\s+|police\s+|tactical\s+)?arrests?|"
        r"custody\s+detentions?|"
        r"(?:police|tactical)\s+raids?|"
        r"warrant\s+executions?"
        r")\b",
        re.IGNORECASE,
    )


def _location_pattern() -> re.Pattern:
    # Investigative location and facility phrases (warehouse, safehouse, corridor, dock, etc.)
    return re.compile(
        r"\b(?:(?:waterfront|abandoned|central|north|south|east|west|downtown|coordinated|dockside)\s+)?"
        r"(?:industrial\s+corridor|warehouse|safehouse|harbor|dock|corridor|terminal|facility|hideout|compound)\b",
        re.IGNORECASE,
    )


REGEX_EXTRACTORS = (
    ("PHONE", _phone_pattern()),
    ("VEHICLE", _vehicle_pattern()),
    ("ACCOUNT", _account_pattern()),
    ("CASE", _case_pattern()),
    ("LOCATION", _location_pattern()),
    ("EVENT", _event_pattern()),
)

# Nominal confidence for regex hits (no statistical certainty available).
REGEX_CONFIDENCE = 0.7
EVENT_CONFIDENCE = 0.8
# Nominal confidence for spaCy NER hits (per-sentence heuristics not reported).
NER_DEFAULT_CONFIDENCE = 0.9

_nlp = None
_nlp_tried = False


def get_nlp():
    """Return the lazily-loaded spaCy pipeline, or raise ModelUnavailableError."""
    global _nlp, _nlp_tried
    if _nlp is not None:
        return _nlp
    if _nlp_tried:
        raise ModelUnavailableError(
            f"spaCy model '{settings.ner_model}' is unavailable. Install it with "
            f"`python -m spacy download {settings.ner_model}` to enable NER "
            "extraction, or set NER_MODEL to a valid model."
        )
    _nlp_tried = True
    try:
        import spacy

        _nlp = spacy.load(settings.ner_model)
    except Exception as exc:
        raise ModelUnavailableError(
            f"Could not load spaCy model '{settings.ner_model}': {exc}. Install it "
            f"with `python -m spacy download {settings.ner_model}`."
        ) from exc
    return _nlp


def _extract_regex_entities(text: str) -> list[dict]:
    """Run regex extractors and return entity dicts with their spans."""
    found: list[dict] = []
    for entity_type, pattern in REGEX_EXTRACTORS:
        for match in pattern.finditer(text):
            conf = EVENT_CONFIDENCE if entity_type == "EVENT" else REGEX_CONFIDENCE
            found.append(
                {
                    "entity_type": entity_type,
                    "entity_text": match.group(0),
                    "start": match.start(),
                    "end": match.end(),
                    "confidence": conf,
                }
            )
    return found


def _extract_ner_entities(text: str) -> list[dict]:
    """Run spaCy NER and return PERSON/LOCATION/ORGANIZATION entities."""
    nlp = get_nlp()
    doc = nlp(text)
    found: list[dict] = []
    for ent in doc.ents:
        entity_type = SPACY_LABEL_MAP.get(ent.label_)
        if entity_type is None:
            continue
        found.append(
            {
                "entity_type": entity_type,
                "entity_text": ent.text,
                "start": ent.start_char,
                "end": ent.end_char,
                "confidence": NER_DEFAULT_CONFIDENCE,
            }
        )
    return found


def extract_entities(text: str, use_ner: bool = True) -> list[dict]:
    """Extract entities from ``text``.

    Returns a list of dicts with keys entity_type, entity_text, start, end,
    confidence. Raises ``ModelUnavailableError`` if NER is requested but the
    spaCy model is unavailable.
    """
    entities = _extract_regex_entities(text)
    if use_ner:
        entities.extend(_extract_ner_entities(text))
    # Deduplicate overlapping/near-identical hits (keep first occurrence).
    unique: list[dict] = []
    seen: set[tuple] = set()
    for ent in entities:
        key = (ent["entity_type"], ent["entity_text"], ent["start"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(ent)
    unique.sort(key=lambda e: e["start"])
    return unique


def extract_entities_for_record(text: str, source_record_id: int, use_ner: bool = True) -> list[dict]:
    """Extract entities and attach the owning source record id."""
    entities = extract_entities(text, use_ner=use_ner)
    for ent in entities:
        ent["source_record_id"] = source_record_id
    return entities