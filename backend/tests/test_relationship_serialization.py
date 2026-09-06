"""Tests covering Neo4j relationship source/target serialization."""

import unittest


from app.services.graph import create_node, create_relationship, query_relationships


class FakeRel:
    """Minimal stand-in for a Neo4j relationship (for pure unit tests)."""

    type = "CALLS"

    def items(self):
        return [("confidence", 0.9), ("timestamp", "2026-01-01T00:00:00Z")]


class SourceTargetSerializationUnitTests(unittest.TestCase):
    """Pure unit tests of _rel_dict serialization."""

    def test_rel_dict_source_and_target(self):
        from app.services.graph import _rel_dict
        out = _rel_dict(FakeRel(), "person-a", "person-b")
        self.assertEqual(out["source"], "person-a")
        self.assertEqual(out["target"], "person-b")
        self.assertEqual(out["type"], "CALLS")
        self.assertEqual(out["properties"]["confidence"], 0.9)


class LiveRelationshipSerializationTests(unittest.TestCase):
    """Live integration check against Neo4j (skips if server unreachable)."""

    def test_create_and_query_relationship_source_target(self):
        try:
            create_node("PERSON", "ser-test-a")
            create_node("PERSON", "ser-test-b")
        except Exception as exc:
            self.skipTest(f"Neo4j unavailable: {exc}")
        created = create_relationship(
            "CALLS", "PERSON", "ser-test-a", "PERSON", "ser-test-b",
            timestamp="2026-09-01T00:00:00Z", confidence=0.95,
        )
        self.assertEqual(created["source"], "ser-test-a")
        self.assertEqual(created["target"], "ser-test-b")
        self.assertEqual(created["type"], "CALLS")
        qrs = query_relationships("CALLS")
        match = [r for r in qrs if r["source"] == "ser-test-a" and r["target"] == "ser-test-b"]
        self.assertEqual(len(match), 1)
        self.assertEqual(match[0]["source"], "ser-test-a")
        self.assertEqual(match[0]["target"], "ser-test-b")


if __name__ == "__main__":
    unittest.main()
