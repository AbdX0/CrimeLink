"""Tests for entity-resolution service: exact match, fuzzy match, different types,
and low-confidence cases using synthetic entities.

Run with:
    python -m unittest tests.test_resolution -v
"""

import unittest

from app.services.resolution import (
    MATCH,
    CANDIDATE,
    NO_MATCH,
    normalize_entity_text,
    resolve_entity,
    resolve_entities_for_scope,
    _score_similarity,
)


class NormalizeTests(unittest.TestCase):
    """Text normalization for resilient fuzzy comparison."""

    def test_lowercase_and_whitespace(self):
        self.assertEqual(normalize_entity_text("  Sara   Alvarez "), "sara alvarez")

    def test_punctuation_stripped(self):
        self.assertEqual(normalize_entity_text("Sara M. Alvarez"), "sara m alvarez")
        self.assertEqual(normalize_entity_text("O'Brien"), "o brien")

    def test_dashes_and_mixed(self):
        self.assertEqual(normalize_entity_text("ACME-Corp."), "acme corp")

    def test_none_and_empty(self):
        self.assertEqual(normalize_entity_text(None), "")
        self.assertEqual(normalize_entity_text(""), "")


class ScoreSimilarityTests(unittest.TestCase):
    """RapidFuzz similarity scoring on normalized strings."""

    def test_identical(self):
        self.assertEqual(_score_similarity("sara alvarez", "sara alvarez"), 100.0)

    def test_completely_different(self):
        self.assertLess(_score_similarity("sara", "zzzzzzzzz"), 50.0)


class ResolveEntityTests(unittest.TestCase):
    """resolve_entity against synthetic candidates."""

    def test_exact_match(self):
        candidates = [
            {"id": 2, "entity_type": "PERSON", "entity_text": "Sara Alvarez"},
            {"id": 3, "entity_type": "PERSON", "entity_text": "John Doe"},
        ]
        result = resolve_entity(1, "PERSON", "Sara Alvarez", candidates,
                                match_threshold=85, candidate_threshold=60)
        self.assertEqual(result["entity_id"], 1)
        self.assertEqual(result["resolution_status"], MATCH)
        matched_ids = [m["entity_id"] for m in result["resolved_with"]]
        self.assertIn(2, matched_ids)

    def test_fuzzy_match(self):
        candidates = [
            {"id": 2, "entity_type": "PERSON", "entity_text": "Sara M. Alvarez"},
        ]
        result = resolve_entity(1, "PERSON", "Sara Alvarez", candidates,
                                match_threshold=85, candidate_threshold=60)
        # Fuzzy match should be at least a candidate.
        self.assertIn(result["resolution_status"], (MATCH, CANDIDATE))
        self.assertGreaterEqual(len(result["resolved_with"]), 1)
        self.assertGreaterEqual(result["resolved_with"][0]["similarity"], 60)

    def test_different_types_not_compared(self):
        candidates = [
            {"id": 2, "entity_type": "LOCATION", "entity_text": "Sara Alvarez"},
        ]
        result = resolve_entity(1, "PERSON", "Sara Alvarez", candidates,
                                match_threshold=85, candidate_threshold=60)
        self.assertEqual(result["resolution_status"], NO_MATCH)
        self.assertEqual(result["resolved_with"], [])

    def test_low_confidence_no_match(self):
        candidates = [
            {"id": 2, "entity_type": "PERSON",
             "entity_text": "Completely Different Name XYZ"},
        ]
        result = resolve_entity(1, "PERSON", "Sara Alvarez", candidates,
                                match_threshold=85, candidate_threshold=60)
        self.assertEqual(result["resolution_status"], NO_MATCH)
        self.assertEqual(result["resolved_with"], [])


    def test_empty_strings(self):
        self.assertEqual(_score_similarity("", "sara"), 0.0)
        self.assertEqual(_score_similarity("sara", ""), 0.0)


    def test_candidate_between_thresholds(self):
        candidates = [
            {"id": 2, "entity_type": "ORGANIZATION",
             "entity_text": "Acme Corporation Ltd"},
        ]
        # "Acme Corp" should be a candidate but not a solid match.
        result = resolve_entity(1, "ORGANIZATION", "Acme Corp", candidates,
                                match_threshold=90, candidate_threshold=40)
        self.assertIn(result["resolution_status"], (MATCH, CANDIDATE))
        if result["resolved_with"]:
            self.assertGreaterEqual(
                result["resolved_with"][0]["similarity"], 40)

    def test_normalized_value_populated(self):
        result = resolve_entity(1, "PERSON", "  Sara   M. Alvarez  ", [],
                                match_threshold=85, candidate_threshold=60)
        self.assertEqual(result["normalized_value"], "sara m alvarez")

    def test_schema_fields_present(self):
        candidates = [
            {"id": 2, "entity_type": "PHONE", "entity_text": "555-014-7721"}
        ]
        result = resolve_entity(1, "PHONE", "555-014-7721", candidates,
                                match_threshold=85, candidate_threshold=60)
        for key in ("entity_id", "entity_type", "entity_text",
                    "normalized_value", "resolved_with", "resolution_status"):
            self.assertIn(key, result)
        if result["resolved_with"]:
            item = result["resolved_with"][0]
            for key in ("entity_id", "entity_type", "entity_text",
                        "normalized_value", "similarity", "resolution_status"):
                self.assertIn(key, item)


class ResolveScopeTests(unittest.TestCase):
    """resolve_entities_for_scope resolves multiple entities at once."""

    def test_resolves_each_scope_entity(self):
        scope = [
            {"id": 1, "entity_type": "PERSON", "entity_text": "Sara Alvarez"},
            {"id": 2, "entity_type": "LOCATION", "entity_text": "New York"},
        ]
        corpus = scope + [
            {"id": 3, "entity_type": "PERSON", "entity_text": "Sara M. Alvarez"},
            {"id": 4, "entity_type": "LOCATION", "entity_text": "NYC"},
        ]
        results = resolve_entities_for_scope(
            scope, corpus, match_threshold=85, candidate_threshold=60)
        self.assertEqual(len(results), 2)
        ids = {r["entity_id"] for r in results}
        self.assertEqual(ids, {1, 2})
        # Entity 1 (PERSON Sara) should find entity 3 as a match/candidate.
        r1 = next(r for r in results if r["entity_id"] == 1)
        self.assertIn(r1["resolution_status"], (MATCH, CANDIDATE))


if __name__ == "__main__":
    unittest.main()
