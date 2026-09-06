"""Tests for the network-analytics service and endpoints (mocked graph).

No live Neo4j or GDS plugin is required: sessions/drivers are replaced with
simple fakes, so these run in CI.
"""

import unittest
from unittest import mock

from fastapi import HTTPException

from app.services import analytics


class _Result:
    """Fake neo4j Result supporting .data()."""

    def __init__(self, rows):
        self._rows = rows

    def data(self):
        return self._rows


class _Session:
    """Fake session; returns queued row lists per executed query."""

    def __init__(self, results):
        self._results = list(results)
        self.queries = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def run(self, query, params=None):
        self.queries.append(query)
        if not self._results:
            return _Result([])
        return _Result(self._results.pop(0))


class _Driver:
    def __init__(self, results):
        self._results = results

    def session(self):
        return _Session(self._results)


class DegreeCentralityTests(unittest.TestCase):
    def test_degree_centrality_maps_rows(self):
        d = _Driver([[{"entity_id": "PERSON:x", "name": "X",
                       "labels": ["PERSON"], "degree": 3}]])
        out = analytics.degree_centrality(driver=d)
        self.assertEqual(out[0]["entity_id"], "PERSON:x")
        self.assertEqual(out[0]["degree"], 3)

    def test_degree_centrality_invalid_type_rejected(self):
        with self.assertRaises(ValueError):
            analytics.degree_centrality(entity_type="NOT_A_TYPE",
                                        driver=_Driver([]))


class ShortestPathTests(unittest.TestCase):
    def test_entities_missing_raises(self):
        d = _Driver([[{"c": 1}]])  # only one of the two entities exists
        with self.assertRaises(analytics.EntityNotFoundError):
            analytics.shortest_path("A", "B", driver=d)

    def test_connected_path(self):
        d = _Driver([[{"c": 2}], [{"path": ["A", "B"], "length": 1}]])
        out = analytics.shortest_path("A", "B", driver=d)
        self.assertTrue(out["found"])
        self.assertEqual(out["path"], ["A", "B"])
        self.assertEqual(out["length"], 1)

    def test_disconnected_returns_not_found(self):
        d = _Driver([[{"c": 2}], []])
        out = analytics.shortest_path("A", "B", driver=d)
        self.assertFalse(out["found"])
        self.assertEqual(out["path"], [])


class GdsTests(unittest.TestCase):
    def test_gds_missing_raises(self):
        class BrokenSession(_Session):
            def run(self, query, params=None):
                raise RuntimeError("no procedure gds.version")

        d = mock.Mock()
        d.session.return_value = BrokenSession([])
        with self.assertRaises(analytics.GdsUnavailableError):
            analytics.pagerank(driver=d)
        with self.assertRaises(analytics.GdsUnavailableError):
            analytics.communities(driver=d)

    def test_pagerank_maps_rows(self):
        d = _Driver([
            [{"version": "2.x"}],  # gds.version
            [],                    # drop stale projection
            [{"graphName": "p"}],  # project
            [{"entity_id": "PERSON:x", "name": "X", "labels": ["PERSON"],
              "score": 0.42}],     # pagerank stream
            [{"graphName": "p"}],  # drop projection
        ])
        out = analytics.pagerank(driver=d)
        self.assertEqual(out[0]["score"], 0.42)
        self.assertEqual(out[0]["entity_id"], "PERSON:x")

    def test_communities_maps_rows(self):
        d = _Driver([
            [{"version": "2.x"}],
            [],
            [{"graphName": "p"}],
            [{"entity_id": "CASE:c1", "name": None, "labels": ["CASE"],
              "community_id": 7}],
            [{"graphName": "p"}],
        ])
        out = analytics.communities(driver=d)
        self.assertEqual(out[0]["community_id"], 7)


class AnalyticsEndpointTests(unittest.TestCase):
    def _client(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from tests._helpers import use_fake_admin

        use_fake_admin()
        return TestClient(app, raise_server_exceptions=False)

    def test_shortest_path_404_for_missing_entity(self):
        with mock.patch.object(
            analytics, "shortest_path",
            side_effect=analytics.EntityNotFoundError("missing"),
        ):
            resp = self._client().get(
                "/analytics/shortest-path",
                params={"from_id": "A", "to_id": "B"},
            )
        self.assertEqual(resp.status_code, 404)
        self.assertIn("missing", resp.json()["detail"])

    def test_pagerank_503_when_gds_unavailable(self):
        with mock.patch.object(
            analytics, "pagerank",
            side_effect=analytics.GdsUnavailableError("no gds"),
        ):
            resp = self._client().get("/analytics/pagerank")
        self.assertEqual(resp.status_code, 503)
        self.assertIn("no gds", resp.json()["detail"])

    def test_degree_centrality_ok(self):
        fake = [{"entity_id": "PERSON:x", "name": "X", "labels": ["PERSON"],
                 "degree": 2}]
        with mock.patch.object(analytics, "degree_centrality",
                               return_value=fake):
            resp = self._client().get("/analytics/degree-centrality")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["algorithm"], "degree_centrality")
        self.assertEqual(body["results"][0]["entity_id"], "PERSON:x")


if __name__ == "__main__":
    unittest.main()
