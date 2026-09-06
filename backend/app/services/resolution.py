"""Entity-resolution service: find likely duplicate entities using fuzzy matching.

Compares extracted entities (SourceEntity rows) by:

1. Normalizing the raw entity text (case, whitespace, basic punctuation) so that
   e.g. "Sara M. Alvarez" and "sara-m alvarez" normalize similarly.
2. Restricting comparisons to compatible entity types.
3. Scoring similarity with RapidFuzz and comparing against configurable
   thresholds. Low-confidence matches are reported (as ``no_match`` or
   ``candidate``), never auto-merged.
"""

import re
from typing import Optional

from rapidfuzz import fuzz, process

from app.core.config import settings

# Resolution statuses.
MATCH = "match"          # similarity >= match threshold -> likely duplicate.
CANDIDATE = "candidate"   # between candidate and match threshold -> review.
NO_MATCH = "no_match"     # below candidate threshold -> not a duplicate.


def normalize_entity_text(text: str) -> str:
    """Normalize entity text for resilient, fuzzy-safe comparison.

    Lowercases, collapses internal whitespace, and strips basic punctuation so
    that semantically identical-but-stylistically-different strings align.
    """
    if text is None:
        return ""
    # Lowercase, then replace punctuation/dashes with a single space.
    cleaned = re.sub(r"[^a-z0-9\s]", " ", text.lower())
    # Collapse runs of whitespace to a single space and trim.
    return re.sub(r"\s+", " ", cleaned).strip()


def _score_similarity(a: str, b: str) -> float:
    """Return a RapidFuzz similarity score (0..100) for normalized strings."""
    if not a or not b:
        return 0.0
    return float(fuzz.WRatio(a, b))


def resolve_entity(
    entity_id: int,
    entity_type: str,
    entity_text: str,
    candidates: list[dict],
    match_threshold: Optional[float] = None,
    candidate_threshold: Optional[float] = None,
) -> dict:
    """Resolve a single entity against a list of candidate entities.

    Args:
        entity_id: id of the entity being resolved.
        entity_type: entity type of the entity being resolved.
        entity_text: raw text of the entity being resolved.
        candidates: list of dicts with keys id, entity_type, entity_text for
            candidate duplicates (excluding the entity itself).
        match_threshold: similarity above which a candidate is a 'match'.
        candidate_threshold: similarity above which a candidate is a 'candidate'.

    Returns:
        A resolution result dict matching the ResolutionResult schema.
    """
    mt = match_threshold if match_threshold is not None else settings.entity_match_threshold
    ct = candidate_threshold if candidate_threshold is not None else settings.entity_candidate_threshold

    norm = normalize_entity_text(entity_text)
    matched: list[dict] = []

    for cand in candidates:
        if cand["entity_type"] != entity_type:
            # Only compare compatible entity types.
            continue
        cand_norm = normalize_entity_text(cand["entity_text"])
        sim = _score_similarity(norm, cand_norm)
        if sim >= ct:
            status = MATCH if sim >= mt else CANDIDATE
            matched.append(
                {
                    "entity_id": cand["id"],
                    "entity_type": cand["entity_type"],
                    "entity_text": cand["entity_text"],
                    "normalized_value": cand_norm,
                    "similarity": round(sim, 2),
                    "resolution_status": status,
                }
            )

    # Best match decides the overall status; otherwise no_match.
    matched.sort(key=lambda m: m["similarity"], reverse=True)
    if matched:
        overall_status = matched[0]["resolution_status"]
    else:
        overall_status = NO_MATCH

    return {
        "entity_id": entity_id,
        "entity_type": entity_type,
        "entity_text": entity_text,
        "normalized_value": norm,
        "resolved_with": matched,
        "resolution_status": overall_status,
    }


def resolve_entities_for_scope(
    scope_entities: list[dict],
    all_entities: list[dict],
    match_threshold: Optional[float] = None,
    candidate_threshold: Optional[float] = None,
) -> list[dict]:
    """Resolve each entity in ``scope_entities`` against all others.

    Args:
        scope_entities: entities to resolve (the selected record/entity scope).
        all_entities: the full corpus of candidate entities.
        match_threshold, candidate_threshold: optional overrides.

    Returns:
        A list of resolution result dicts (one per scope entity).
    """
    results = []
    for ent in scope_entities:
        # Candidate pool = all entities except the entity being resolved.
        candidates = [c for c in all_entities if c["id"] != ent["id"]]
        results.append(
            resolve_entity(
                ent["id"],
                ent["entity_type"],
                ent["entity_text"],
                candidates,
                match_threshold=match_threshold,
                candidate_threshold=candidate_threshold,
            )
        )
    return results