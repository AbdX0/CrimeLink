"""Tests for the Neo4j graph-population service (Step 9).

Uses fake in-memory Neo4j session/driver doubles (no live Neo4j needed) plus
HTTP-level endpoint tests with an in-memory SQLite database and a mocked
population service.
"""

import os
import sys
import unittest
from unittest import mock
from typing import Generator

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from app.services import graph, graph_populate


class FakeResult:
    def __init__(self, created: bool):
        self._created = created

    def single(self):
        return {"created": self._created}


class FakeSession:
    """Records every run() call; returns a fixed created flag."""

    def __init__(self, created: bool = True):
        self.created = created
        self.calls: list[tuple[str, dict]] = []

    def run(self, query, params=None):
        self.calls.append((query, params))
        return FakeResult(self.created)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeDriver:
    def __init__(self, created: bool = True):
        self.fake_session = FakeSession(created)

    def session(self):
        return self.fake_session


SAMPLE_ENTITIES = [
    {"entity_type": "PERSON", "entity_text": "Sara Alvarez",
     "confidence": 0.9, "source_record_id": 7},
    {"entity_type": "PHONE", "entity_text": "555-014-7721",
     "confidence": 0.7, "source_record_id": 7},
    {"entity_type": "CASE", "entity_text": "CASE-2023-0042",
     "confidence": 0.7, "source_record_id": 7},
]


class NodeIdTests(unittest.TestCase):
    """Deterministic, stable node ids."""

    def test_id_format(self):
        self.assertEqual(
            graph_populate.node_id_for("PERSON", "Sara Alvarez"),
            "PERSON:sara alvarez",
        )

    def test_normalization_makes_ids_stable(self):
        # Case/punctuation differences map to the same node id.
        self.assertEqual(
            graph_populate.node_id_for("PERSON", "Sara M. Alvarez"),
            graph_populate.node_id_for("PERSON", "sara-m  alvarez"),
        )

    def test_type_is_part_of_the_id(self):
        self.assertNotEqual(
            graph_populate.node_id_for("PERSON", "Java"),
            graph_populate.node_id_for("LOCATION", "Java"),
        )


class PlanTests(unittest.TestCase):
    """plan_population builds a deterministic, whitelisted plan."""

    def test_plan_nodes_deduplicated(self):
        entities = SAMPLE_ENTITIES + [
            {"entity_type": "PERSON", "entity_text": "Sara Alvarez",
             "confidence": 0.9, "source_record_id": 7},
        ]
        plan = graph_populate.plan_population(entities, 7)
        self.assertEqual(len(plan["nodes"]), 3)

    def test_plan_case_relationships(self):
        plan = graph_populate.plan_population(SAMPLE_ENTITIES, 7)
        involved = [r for r in plan["relationships"]
                    if r["rel_type"] == "INVOLVED_IN"]
        self.assertEqual(len(involved), 2)  # person->case, phone->case
        for rel in involved:
            self.assertEqual(rel["to_type"], "CASE")
            self.assertTrue(rel["to_id"].startswith("CASE:"))

    def test_plan_cooccurrence_relationship(self):
        plan = graph_populate.plan_population(SAMPLE_ENTITIES, 7)
        assoc = [r for r in plan["relationships"]
                 if r["rel_type"] == "ASSOCIATED_WITH"]
        self.assertEqual(len(assoc), 1)
        self.assertTrue(assoc[0]["from_id"].startswith("PERSON:"))
        self.assertTrue(assoc[0]["to_id"].startswith("PHONE:"))

    def test_plan_semantic_relationship_with_source_text(self):
        entities = [
            {"entity_type": "PERSON", "entity_text": "Sara Alvarez", "confidence": 0.9},
            {"entity_type": "PERSON", "entity_text": "Bob Smith", "confidence": 0.8},
        ]
        text = "Sara Alvarez called Bob Smith yesterday."
        plan = graph_populate.plan_population(entities, 7, source_text=text)
        rels = [r for r in plan["relationships"] if r["rel_type"] == "CALLS"]
        self.assertEqual(len(rels), 1)
        self.assertEqual(rels[0]["from_id"], "PERSON:sara alvarez")
        self.assertEqual(rels[0]["to_id"], "PERSON:bob smith")

    def test_plan_semantic_uses_with_source_text(self):
        entities = [
            {"entity_type": "PERSON", "entity_text": "Sara Alvarez", "confidence": 0.9},
            {"entity_type": "PHONE", "entity_text": "555-014-7721", "confidence": 0.7},
        ]
        text = "Sara Alvarez (phone: 555-014-7721) was placed on watch."
        plan = graph_populate.plan_population(entities, 7, source_text=text)
        rels = [r for r in plan["relationships"] if r["rel_type"] == "USES"]
        self.assertEqual(len(rels), 1)
        self.assertEqual(rels[0]["from_id"], graph_populate.node_id_for("PERSON", "Sara Alvarez"))
        self.assertEqual(rels[0]["to_id"], graph_populate.node_id_for("PHONE", "555-014-7721"))

    def test_plan_only_whitelisted_types(self):
        plan = graph_populate.plan_population(SAMPLE_ENTITIES, 7)
        for node in plan["nodes"]:
            self.assertIn(node["entity_type"], graph.ENTITY_TYPES)
        for rel in plan["relationships"]:
            self.assertIn(rel["rel_type"], graph.RELATIONSHIP_TYPES)

    def test_plan_rejects_unsupported_entity_type(self):
        with self.assertRaises(ValueError):
            graph_populate.plan_population(
                [{"entity_type": "ALIEN", "entity_text": "X",
                  "confidence": 1.0}], 7)


class PopulateServiceTests(unittest.TestCase):
    """populate_source_record against a fake Neo4j driver."""

    def test_counts_on_first_population(self):
        driver = FakeDriver(created=True)
        counts = graph_populate.populate_source_record(
            SAMPLE_ENTITIES, 7, driver=driver)
        self.assertEqual(counts, {
            "nodes_created": 3,
            "nodes_merged": 0,
            "relationships_created": 3,
            "relationships_merged": 0,
        })

    def test_idempotent_repeated_population(self):
        first = FakeDriver(created=True)
        c1 = graph_populate.populate_source_record(
            SAMPLE_ENTITIES, 7, driver=first)
        # Second run: everything MERGEs onto existing graph -> nothing created.
        second = FakeDriver(created=False)
        c2 = graph_populate.populate_source_record(
            SAMPLE_ENTITIES, 7, driver=second)
        self.assertEqual(c2, {
            "nodes_created": 0,
            "nodes_merged": 3,
            "relationships_created": 0,
            "relationships_merged": 3,
        })
        # Identical call sequences => deterministic, no duplicates possible.
        self.assertEqual(first.fake_session.calls, second.fake_session.calls)

    def test_evidence_metadata_on_relationships(self):
        driver = FakeDriver(created=True)
        graph_populate.populate_source_record(
            SAMPLE_ENTITIES, 7, record_timestamp="2026-09-01T00:00:00",
            driver=driver)
        rel_calls = [(q, p) for q, p in driver.fake_session.calls
                     if "MERGE (a)-" in q]
        self.assertTrue(rel_calls)
        for query, params in rel_calls:
            self.assertEqual(params["props"]["evidence_source_id"], 7)
            self.assertEqual(params["props"]["timestamp"],
                             "2026-09-01T00:00:00")
            self.assertIsNotNone(params["props"]["confidence"])

    def test_node_properties_preserved(self):
        driver = FakeDriver(created=True)
        graph_populate.populate_source_record(SAMPLE_ENTITIES, 7, driver=driver)
        node_calls = [(q, p) for q, p in driver.fake_session.calls
                      if "MERGE (n:" in q]
        self.assertEqual(len(node_calls), 3)
        for query, params in node_calls:
            self.assertEqual(params["props"]["source_record_id"], 7)
            self.assertIn("name", params["props"])

    def test_unsupported_entity_type_raises(self):
        with self.assertRaises(ValueError):
            graph_populate.populate_source_record(
                [{"entity_type": "ALIEN", "entity_text": "X",
                  "confidence": 1.0}], 7, driver=FakeDriver())

    def test_combined_confidence_is_minimum(self):
        self.assertEqual(
            graph_populate._combined_confidence(0.9, 0.5), 0.5)
        self.assertIsNone(graph_populate._combined_confidence(None, None))



class PopulateEndpointTests(unittest.TestCase):
    """HTTP-level tests of POST /graph/populate/source-record/{id}."""

    @classmethod
    def setUpClass(cls):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool
        from fastapi.testclient import TestClient

        from app.main import app
        from app.database import Base, get_db

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
        from tests._helpers import use_fake_admin

        use_fake_admin()
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        from app.main import app
        app.dependency_overrides.clear()

    def _seed_record_with_entities(self):
        from app.models.source_record import SourceRecord
        from app.models.source_entity import SourceEntity

        db = self.TestSession()
        try:
            record = SourceRecord(source_type="txt", title="Note",
                                  content="Sara Alvarez called.")
            db.add(record)
            db.commit()
            db.refresh(record)
            db.add(SourceEntity(
                entity_type="PERSON", entity_text="Sara Alvarez",
                start=0, end=12, confidence=0.9,
                source_record_id=record.id))
            db.commit()
            return record.id
        finally:
            db.close()

    def test_populate_returns_counts(self):
        record_id = self._seed_record_with_entities()
        with mock.patch(
            "app.services.graph_populate.populate_source_record",
            return_value={"nodes_created": 1, "nodes_merged": 0,
                          "relationships_created": 0,
                          "relationships_merged": 0},
        ) as mocked:
            resp = self.client.post(
                f"/graph/populate/source-record/{record_id}")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["source_record_id"], record_id)
        self.assertEqual(body["nodes_created"], 1)
        mocked.assert_called_once()
        # Entities passed in text order with confidence preserved.
        args, kwargs = mocked.call_args
        self.assertEqual(args[0][0]["entity_type"], "PERSON")
        self.assertEqual(args[0][0]["confidence"], 0.9)
        self.assertEqual(args[1], record_id)

    def test_populate_unknown_record_404(self):
        resp = self.client.post("/graph/populate/source-record/9999")
        self.assertEqual(resp.status_code, 404)

    def test_populate_record_without_entities_404(self):
        from app.models.source_record import SourceRecord
        db = self.TestSession()
        try:
            record = SourceRecord(source_type="txt", title="Empty")
            db.add(record)
            db.commit()
            db.refresh(record)
            record_id = record.id
        finally:
            db.close()
        resp = self.client.post(f"/graph/populate/source-record/{record_id}")
        self.assertEqual(resp.status_code, 404)
        self.assertIn("No entities", resp.json()["detail"])

    def test_populate_neo4j_unavailable_503(self):
        record_id = self._seed_record_with_entities()
        with mock.patch(
            "app.services.graph_populate.populate_source_record",
            side_effect=ConnectionError("couldn't connect to localhost:7687"),
        ):
            resp = self.client.post(
                f"/graph/populate/source-record/{record_id}")
        self.assertEqual(resp.status_code, 503)
        self.assertIn("Neo4j unavailable", resp.json()["detail"])


if __name__ == "__main__":
    unittest.main()

