"""Tests for entity profile and person list endpoints."""

import os
import sys
import unittest
from typing import Generator
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.database import Base, get_db
from app.main import app
from app.models.source_record import SourceRecord
from app.models.user import User


class FakeSession:
    def __init__(self, target_exists=True):
        self.target_exists = target_exists
        self.calls = []

    def run(self, query, params=None):
        self.calls.append((query, params or {}))
        q = query.strip()

        # MATCH (p:PERSON)
        if "MATCH (p:PERSON)" in q:
            return mock.MagicMock(
                data=lambda: [
                    {
                        "id": "PERSON:marcus vance",
                        "name": "Marcus Vance",
                        "confidence": 0.95,
                        "source_record_id": 1,
                        "degree": 5,
                    },
                    {
                        "id": "PERSON:elena rostova",
                        "name": "Elena Rostova",
                        "confidence": 0.9,
                        "source_record_id": 1,
                        "degree": 2,
                    },
                ]
            )

        # MATCH (n {id: $node_id})
        if "MATCH (n {id: $node_id})" in q and "RETURN n.id" in q:
            if not self.target_exists:
                return mock.MagicMock(data=lambda: [])
            return mock.MagicMock(
                data=lambda: [
                    {
                        "id": params.get("node_id", "PERSON:marcus vance"),
                        "labels": ["PERSON"],
                        "name": "Marcus Vance",
                        "confidence": 0.95,
                        "source_record_id": 1,
                        "properties": {},
                    }
                ]
            )

        # 1-hop relationships
        if "MATCH (n {id: $node_id})-[r]-(m)" in q:
            return mock.MagicMock(
                data=lambda: [
                    {
                        "edge_id": "e-1",
                        "type": "CALLS",
                        "source": "PERSON:marcus vance",
                        "target": "PERSON:elena rostova",
                        "evidence_source_id": 1,
                        "confidence": 0.9,
                        "timestamp": "2026-09-01T12:00:00",
                        "rel_props": {},
                        "neighbor_id": "PERSON:elena rostova",
                        "neighbor_labels": ["PERSON"],
                        "neighbor_name": "Elena Rostova",
                        "neighbor_confidence": 0.9,
                        "neighbor_source_record_id": 1,
                        "neighbor_props": {},
                    },
                    {
                        "edge_id": "e-2",
                        "type": "USES",
                        "source": "PERSON:marcus vance",
                        "target": "PHONE:5550148899",
                        "evidence_source_id": 1,
                        "confidence": 0.95,
                        "timestamp": None,
                        "rel_props": {},
                        "neighbor_id": "PHONE:5550148899",
                        "neighbor_labels": ["PHONE"],
                        "neighbor_name": "555-014-8899",
                        "neighbor_confidence": 0.95,
                        "neighbor_source_record_id": 1,
                        "neighbor_props": {},
                    },
                    {
                        "edge_id": "e-3",
                        "type": "OWNS",
                        "source": "PERSON:marcus vance",
                        "target": "VEHICLE:ny4521",
                        "evidence_source_id": 1,
                        "confidence": 0.9,
                        "timestamp": None,
                        "rel_props": {},
                        "neighbor_id": "VEHICLE:ny4521",
                        "neighbor_labels": ["VEHICLE"],
                        "neighbor_name": "NY-4521",
                        "neighbor_confidence": 0.9,
                        "neighbor_source_record_id": 1,
                        "neighbor_props": {"details": "black sedan"},
                    },
                    {
                        "edge_id": "e-4",
                        "type": "VISITS",
                        "source": "PERSON:marcus vance",
                        "target": "LOCATION:waterfront warehouse",
                        "evidence_source_id": 1,
                        "confidence": 0.85,
                        "timestamp": "2026-09-01",
                        "rel_props": {},
                        "neighbor_id": "LOCATION:waterfront warehouse",
                        "neighbor_labels": ["LOCATION"],
                        "neighbor_name": "waterfront warehouse",
                        "neighbor_confidence": 0.85,
                        "neighbor_source_record_id": 1,
                        "neighbor_props": {},
                    },
                ]
            )

        # 2-hop phone calls
        if "MATCH (n {id: $node_id})-[:USES|ASSOCIATED_WITH]-(ph:PHONE)-[c:CALLS]-(ph2:PHONE)" in q:
            return mock.MagicMock(
                data=lambda: [
                    {
                        "edge_id": "e-c1",
                        "from_phone": "PHONE:5550148899",
                        "to_phone": "PHONE:5550149911",
                        "timestamp": "2026-09-02T10:00:00",
                        "confidence": 0.85,
                        "evidence_source_id": 2,
                        "props": {},
                        "my_phone": "PHONE:5550148899",
                        "other_person_id": "PERSON:tariq mansour",
                        "other_person_name": "Tariq Mansour",
                    }
                ]
            )

        # Direct calls
        if "MATCH (n {id: $node_id})-[c:CALLS]-(p2:PERSON)" in q:
            return mock.MagicMock(data=lambda: [])

        # Account transfers
        if "TRANSFERS" in q:
            return mock.MagicMock(
                data=lambda: [
                    {
                        "edge_id": "e-t1",
                        "source_account": "ACCOUNT:412355667788",
                        "dest_account": "ACCOUNT:987654321098",
                        "timestamp": "2026-09-02",
                        "confidence": 0.9,
                        "evidence_source_id": 2,
                        "amount": None,  # No amount in source
                        "props": {},
                        "my_account": "ACCOUNT:412355667788",
                        "other_person_id": "PERSON:tariq mansour",
                        "other_person_name": "Tariq Mansour",
                    }
                ]
            )

        return mock.MagicMock(data=lambda: [])

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeDriver:
    def __init__(self, target_exists=True):
        self.fake_session = FakeSession(target_exists=target_exists)

    def session(self):
        return self.fake_session


class EntityProfileEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.TestSession = sessionmaker(bind=cls.engine)
        Base.metadata.create_all(bind=cls.engine)

        def override_get_db() -> Generator:
            db = cls.TestSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        # Fake analyst user
        app.dependency_overrides[get_current_user] = lambda: User(
            id=1, username="analyst_test", role="ANALYST", is_active=True
        )
        cls.client = TestClient(app)

        # Seed source record
        db = cls.TestSession()
        try:
            rec = SourceRecord(
                id=1,
                source_type="TXT",
                title="Operation Nightshade",
                content="Surveillance observed Marcus Vance meeting Elena Rostova.",
            )
            db.add(rec)
            db.commit()
        finally:
            db.close()

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def test_list_persons(self):
        with mock.patch("app.api.routes.graph_network.get_driver", return_value=FakeDriver()):
            resp = self.client.get("/graph/persons")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]["id"], "PERSON:marcus vance")
        self.assertEqual(data[0]["degree"], 5)

    def test_entity_profile_success(self):
        with mock.patch("app.api.routes.graph_network.get_driver", return_value=FakeDriver()):
            resp = self.client.get("/graph/entity/PERSON:marcus vance/profile")
        self.assertEqual(resp.status_code, 200)
        profile = resp.json()

        # Target entity
        self.assertEqual(profile["target_entity"]["name"], "Marcus Vance")
        self.assertEqual(profile["target_entity"]["type"], "PERSON")

        # Overview counts
        overview = profile["overview"]
        self.assertEqual(overview["connected_persons"], 1)
        self.assertEqual(overview["phones"], 1)
        self.assertEqual(overview["vehicles"], 1)
        self.assertEqual(overview["locations"], 1)
        self.assertEqual(overview["transactions"], 1)
        self.assertEqual(overview["communications"], 1)

        # Sections
        self.assertEqual(profile["person_connections"][0]["name"], "Elena Rostova")
        self.assertEqual(profile["vehicles"][0]["vehicle_number"], "NY-4521")
        self.assertEqual(profile["locations"][0]["location_name"], "waterfront warehouse")
        self.assertIsNone(profile["locations"][0]["latitude"])  # Coordinates not invented!

        # Transactions
        trans = profile["transactions"][0]
        self.assertEqual(trans["source_account"], "412355667788")
        self.assertEqual(trans["destination_account"], "987654321098")
        self.assertIsNone(trans["amount"])  # Amount not invented!
        self.assertEqual(trans["direction"], "OUTGOING")

        # Communications
        comm = profile["communications"][0]
        self.assertEqual(comm["event_type"], "PHONE_CALL")
        self.assertEqual(comm["from_party"], "Marcus Vance")
        self.assertEqual(comm["to_party"], "Tariq Mansour")

        # Evidence records
        self.assertTrue(len(profile["evidence_records"]) >= 1)
        self.assertEqual(profile["evidence_records"][0]["title"], "Operation Nightshade")

        # Subgraph
        self.assertTrue(profile["subgraph"]["node_count"] >= 4)
        self.assertTrue(profile["subgraph"]["edge_count"] >= 4)

    def test_entity_profile_404_when_not_found(self):
        with mock.patch("app.api.routes.graph_network.get_driver", return_value=FakeDriver(target_exists=False)):
            resp = self.client.get("/graph/entity/PERSON:nonexistent/profile")
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
