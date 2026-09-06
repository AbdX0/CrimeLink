"""Unit and integration tests for EVENT entity extraction and persistence."""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from app.services import nlp
from app.services.nlp import extract_entities
from app.services.graph_populate import plan_population


class EventExtractionTests(unittest.TestCase):
    """Test deterministic regex extraction for investigative EVENT entities."""

    def test_extract_call_events(self):
        text = "Surveillance recorded a wiretap intercept after the suspect placed outgoing calls and received an incoming call."
        ents = extract_entities(text, use_ner=False)
        event_texts = [e["entity_text"].lower() for e in ents if e["entity_type"] == "EVENT"]
        self.assertTrue(any("wiretap intercept" in t for t in event_texts))
        self.assertTrue(any("placed outgoing calls" in t for t in event_texts))
        self.assertTrue(any("incoming call" in t for t in event_texts))

    def test_extract_transfer_events(self):
        text = "Audit revealed multiple wire transfers, suspicious financial transactions, and funds deposited into offshore accounts."
        ents = extract_entities(text, use_ner=False)
        event_texts = [e["entity_text"].lower() for e in ents if e["entity_type"] == "EVENT"]
        self.assertTrue(any("wire transfers" in t for t in event_texts))
        self.assertTrue(any("financial transactions" in t for t in event_texts))
        self.assertTrue(any("funds deposited" in t for t in event_texts))

    def test_extract_meeting_events(self):
        text = "Agents monitored a clandestine meeting and scheduled a coordination meeting after the meeting with associate."
        ents = extract_entities(text, use_ner=False)
        event_texts = [e["entity_text"].lower() for e in ents if e["entity_type"] == "EVENT"]
        self.assertTrue(any("clandestine meeting" in t for t in event_texts))
        self.assertTrue(any("coordination meeting" in t for t in event_texts))
        self.assertTrue(any("meeting with associate" in t for t in event_texts))

    def test_extract_visit_events(self):
        text = "The suspect conducted a site visit, attempted a border crossing, and executed an unauthorized facility entry."
        ents = extract_entities(text, use_ner=False)
        event_texts = [e["entity_text"].lower() for e in ents if e["entity_type"] == "EVENT"]
        self.assertTrue(any("site visit" in t for t in event_texts))
        self.assertTrue(any("border crossing" in t for t in event_texts))
        self.assertTrue(any("facility entry" in t for t in event_texts))

    def test_extract_observation_events(self):
        text = "Field surveillance commenced following the intelligence briefing. Automated license plate reader flagged the vehicle in the surveillance log."
        ents = extract_entities(text, use_ner=False)
        event_texts = [e["entity_text"].lower() for e in ents if e["entity_type"] == "EVENT"]
        self.assertTrue(any("field surveillance" in t for t in event_texts))
        self.assertTrue(any("intelligence briefing" in t for t in event_texts))
        self.assertTrue(any("license plate reader" in t for t in event_texts))
        self.assertTrue(any("surveillance log" in t for t in event_texts))

    def test_extract_arrest_events(self):
        text = "Officers initiated a traffic stop resulting in a suspect arrest during the multi-agency police raid and subsequent custody detention."
        ents = extract_entities(text, use_ner=False)
        event_texts = [e["entity_text"].lower() for e in ents if e["entity_type"] == "EVENT"]
        self.assertTrue(any("traffic stop" in t for t in event_texts))
        self.assertTrue(any("suspect arrest" in t for t in event_texts))
        self.assertTrue(any("police raid" in t for t in event_texts))
        self.assertTrue(any("custody detention" in t for t in event_texts))

    def test_event_spans_and_confidence(self):
        text = "Field surveillance recorded a wire transfer."
        ents = extract_entities(text, use_ner=False)
        event_ents = [e for e in ents if e["entity_type"] == "EVENT"]
        self.assertEqual(len(event_ents), 2)
        for ent in event_ents:
            self.assertEqual(ent["entity_type"], "EVENT")
            self.assertEqual(ent["confidence"], 0.8)
            self.assertEqual(text[ent["start"]:ent["end"]], ent["entity_text"])
            self.assertTrue(ent["end"] > ent["start"])

    def test_negative_cases_no_false_events(self):
        text = "The investigator wrote a report at his desk while drinking coffee and reading ordinary documentation."
        ents = extract_entities(text, use_ner=False)
        event_ents = [e for e in ents if e["entity_type"] == "EVENT"]
        self.assertEqual(len(event_ents), 0)

    def test_event_participates_in_graph_population_plan(self):
        entities = [
            {"entity_type": "EVENT", "entity_text": "wire transfer", "confidence": 0.8},
            {"entity_type": "PERSON", "entity_text": "Marcus Vance", "confidence": 0.9},
            {"entity_type": "CASE", "entity_text": "CASE-2026-0042", "confidence": 0.7},
        ]
        text = "Marcus Vance initiated a wire transfer connected to CASE-2026-0042."
        plan = plan_population(entities, source_record_id=1, source_text=text)
        
        # Verify node creation
        node_ids = {n["node_id"] for n in plan["nodes"]}
        self.assertIn("EVENT:wire transfer", node_ids)
        self.assertIn("PERSON:marcus vance", node_ids)
        self.assertIn("CASE:case 2026 0042", node_ids)
        
        # Verify relationships
        rels = plan["relationships"]
        # EVENT -> CASE (INVOLVED_IN)
        event_case_rels = [
            r for r in rels
            if r["from_id"] == "EVENT:wire transfer" and r["to_id"] == "CASE:case 2026 0042"
        ]
        self.assertEqual(len(event_case_rels), 1)
        self.assertEqual(event_case_rels[0]["rel_type"], "INVOLVED_IN")
        
        # EVENT <-> PERSON (ASSOCIATED_WITH fallback)
        person_event_rels = [
            r for r in rels
            if (r["from_id"] == "EVENT:wire transfer" and r["to_id"] == "PERSON:marcus vance")
            or (r["from_id"] == "PERSON:marcus vance" and r["to_id"] == "EVENT:wire transfer")
        ]
        self.assertEqual(len(person_event_rels), 1)
        self.assertEqual(person_event_rels[0]["rel_type"], "ASSOCIATED_WITH")


if __name__ == "__main__":
    unittest.main()
