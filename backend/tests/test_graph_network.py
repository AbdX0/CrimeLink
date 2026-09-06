"""Tests for the read-only graph network endpoint (mocked Neo4j session)."""

import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import graph_network


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def data(self):
        return self._rows


class _FakeSession:
    """Returns canned node rows, then edge rows."""

    def __init__(self, node_rows, edge_rows):
        self._node_rows = node_rows
        self._edge_rows = edge_rows

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def run(self, query, params=None):
        if "labels(n)" in query:
            return _FakeResult(self._node_rows)
        return _FakeResult(self._edge_rows)


class _FakeDriver:
    def __init__(self, session):
        self._session = session

    def session(self):
        return self._session


def _client():
    app = FastAPI()
    app.include_router(graph_network.router)
    return TestClient(app)


class NetworkEndpointTests(unittest.TestCase):
    def test_network_shape_and_orphan_edge_filtering(self):
        node_rows = [
            {"id": "PERSON:alice", "labels": ["PERSON"], "name": "Alice",
             "confidence": 0.9, "source_record_id": 1},
            {"id": "PHONE:555", "labels": ["PHONE"], "name": "555",
             "confidence": 1.0, "source_record_id": 1},
        ]
        edge_rows = [
            {"id": "e1", "source": "PERSON:alice", "target": "PHONE:555",
             "type": "USES", "evidence_source_id": 1,
             "confidence": 0.9, "timestamp": None},
            # both endpoints outside the fetched node set -> filtered out
            {"id": "e2", "source": "GHOST:1", "target": "GHOST:2",
             "type": "CALLS", "evidence_source_id": None,
             "confidence": None, "timestamp": None},
        ]
        driver = _FakeDriver(_FakeSession(node_rows, edge_rows))
        with mock.patch.object(graph_network, "get_driver",
                               return_value=driver):
            resp = _client().get("/graph/network")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["node_count"], 2)
        self.assertEqual(body["edge_count"], 1)  # orphan edge excluded
        self.assertEqual(body["edges"][0]["type"], "USES")
        self.assertEqual(body["nodes"][0]["id"], "PERSON:alice")

    def test_entity_type_filter_400(self):
        resp = _client().get("/graph/network", params={"entity_type": "BOGUS"})
        self.assertEqual(resp.status_code, 400)

    def test_neo4j_unavailable_503(self):
        with mock.patch.object(graph_network, "get_driver",
                               side_effect=Exception("connection refused")):
            resp = _client().get("/graph/network")
        self.assertEqual(resp.status_code, 503)
        self.assertIn("Neo4j unavailable", resp.json()["detail"])

    def test_evidence_record_404(self):
        app = FastAPI()
        app.include_router(graph_network.router)
        app.dependency_overrides[graph_network.get_db] = lambda: iter([])
        client = TestClient(app)

        class _Q:
            def filter(self, *a, **k):
                return self

            def first(self):
                return None

        db = mock.Mock()
        db.query.return_value = _Q()
        app.dependency_overrides[graph_network.get_db] = lambda: db
        resp = client.get("/graph/evidence/999")
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
