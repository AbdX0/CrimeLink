"""Tests for rule-based suspicious-pattern detection (synthetic data).

Uses a fake Neo4j session fed with synthetic activity rows; no live Neo4j
is required.
"""

import unittest
from unittest import mock

from app.services import patterns


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def data(self):
        return self._rows


class _Session:
    """Fake session: first run() returns activity rows; later run() calls
    (multi-hop reach queries) return the next queued results, then zeros."""

    def __init__(self, activity_rows, reach_results=None):
        self._activity = activity_rows
        self._reach = list(reach_results or [])
        self.reach_queries = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def run(self, query, params=None):
        if "count(DISTINCT m)" in query:
            self.reach_queries += 1
            if self._reach:
                return _Result([{"c": self._reach.pop(0)}])
            return _Result([{"c": 0}])
        return _Result(self._activity)


def _row(eid, rel_type=None, evidence=None, name=None, labels=None):
    return {"entity_id": eid, "name": name, "labels": labels or [],
            "rel_type": rel_type, "evidence": evidence}


class DetectionRuleTests(unittest.TestCase):
    def _with(self, rows, **kwargs):
        session = _Session(rows, kwargs.pop("reach", None))
        d = mock.Mock()
        d.session.return_value = session
        return patterns.detect_suspicious_patterns(driver=d, **kwargs)

    def test_no_alerts_for_uniform_low_activity(self):
        # 3 entities each with 1 relationship: no z-outliers, no hubs.
        rows = [_row("A", "CALLS", "s1"), _row("B", "CALLS", "s1"),
                _row("C", "CALLS", "s2")]
        self.assertEqual(self._with(rows, hub_degree=5), [])

    def test_hub_detected_with_evidence(self):
        rows = (
            [_row("HUB1", "CALLS", f"s{i}", name="Hub") for i in range(5)]
            + [_row("P1", "CALLS", "s1"), _row("P2", "CALLS", "s2"),
               _row("P3", "CALLS", "s3")]
        )
        alerts = self._with(rows, hub_degree=5)
        hubs = [a for a in alerts if a["pattern_type"] == "HUB"]
        self.assertEqual(len(hubs), 1)
        self.assertEqual(hubs[0]["entity_id"], "HUB1")
        self.assertGreaterEqual(hubs[0]["risk_score"], 40)
        self.assertEqual(len(hubs[0]["evidence_source_ids"]), 5)
        self.assertIn("5 relationships", hubs[0]["explanation"])

    def test_high_activity_zscore(self):
        # Degrees: HUB=10, others=1 (7 entities) -> HUB z-score >> 2.
        rows = ([_row("HUB", "CALLS", f"s{i}", name="Hub") for i in range(10)]
                + [_row(f"P{i}", "CALLS", f"s{i}") for i in range(7)])
        alerts = self._with(rows, hub_degree=50)
        ha = [a for a in alerts if a["pattern_type"] == "HIGH_ACTIVITY"]
        self.assertEqual(len(ha), 1)
        self.assertEqual(ha[0]["entity_id"], "HUB")
        self.assertGreaterEqual(ha[0]["risk_score"], 40)

    def test_relationship_concentration(self):
        # 5 CALLS + 1 OWNS on same entity: CALLS share = 5/6 >= 0.8.
        rows = ([_row("X", "CALLS", f"s{i}") for i in range(5)]
                + [_row("X", "OWNS", "s9")]
                + [_row("Y", "CALLS", "s1"), _row("Y", "OWNS", "s2")])
        alerts = self._with(rows, hub_degree=50)
        conc = [a for a in alerts if a["pattern_type"] ==
                "RELATIONSHIP_CONCENTRATION"]
        self.assertEqual([a["entity_id"] for a in conc], ["X"])
        self.assertIn("CALLS", conc[0]["explanation"])

    def test_multihop_reach(self):
        rows = [_row("M", "CALLS", "s1"), _row("A", "CALLS", "s1")]
        alerts = self._with(rows, hub_degree=50, reach=[25])
        mh = [a for a in alerts if a["pattern_type"] == "MULTI_HOP_REACH"]
        self.assertEqual(len(mh), 1)
        self.assertEqual(mh[0]["entity_id"], "M")
        self.assertIn("25 entities", mh[0]["explanation"])

    def test_alerts_sorted_by_risk_desc(self):
        rows = (
            [_row("HUB", "CALLS", f"s{i}", name="Hub") for i in range(6)]
            + [_row(f"P{i}", "CALLS", f"s{i}") for i in range(6)]
        )
        alerts = self._with(rows, hub_degree=5)
        scores = [a["risk_score"] for a in alerts]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(set(a) >= {
            "entity_id", "pattern_type", "risk_score", "explanation",
            "evidence_source_ids"} for a in alerts))


class PatternEndpointTests(unittest.TestCase):
    def _client(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from tests._helpers import use_fake_admin

        use_fake_admin()
        return TestClient(app, raise_server_exceptions=False)

    def test_suspicious_ok(self):
        fake = [{"entity_id": "HUB", "pattern_type": "HUB",
                 "risk_score": 70, "explanation": "x",
                 "evidence_source_ids": ["s1"]}]
        with mock.patch.object(patterns, "detect_suspicious_patterns",
                               return_value=fake):
            resp = self._client().get("/patterns/suspicious")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["alerts"][0]["entity_id"], "HUB")
        self.assertIn("thresholds", body)

    def test_suspicious_503_when_neo4j_down(self):
        with mock.patch.object(
            patterns, "detect_suspicious_patterns",
            side_effect=RuntimeError("connection refused"),
        ):
            resp = self._client().get("/patterns/suspicious")
        self.assertEqual(resp.status_code, 503)
        self.assertIn("Neo4j unavailable", resp.json()["detail"])

    def test_suspicious_400_invalid_type(self):
        with mock.patch.object(
            patterns, "detect_suspicious_patterns",
            side_effect=ValueError("bad type"),
        ):
            resp = self._client().get("/patterns/suspicious")
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()

