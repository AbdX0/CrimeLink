"""Tests for semantic relationship extraction rules (Plan 1).

Covers all SIH relationship types:
- CALLS: person <-> person, phone <-> phone
- USES: person -> phone
- OWNS: person -> account, person -> vehicle, organization -> account, organization -> vehicle
- TRANSFERS: account -> account
- VISITS: person -> location
- INVOLVED_IN: non-case -> case
- ASSOCIATED_WITH: fallback & negative cases
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

from app.services.relationship_rules import classify_semantic_relationship


def _make_entity(node_id: str, entity_type: str, entity_text: str) -> dict:
    return {
        "node_id": node_id,
        "entity_type": entity_type,
        "entity_text": entity_text,
    }


class CallsRelationshipTests(unittest.TestCase):
    """Tests for CALLS (person <-> person, phone <-> phone)."""

    def test_person_calls_person_forward(self):
        text = "Marcus Vance placed an outgoing call to Tariq Mansour yesterday."
        p1 = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        p2 = _make_entity("PERSON:tariq mansour", "PERSON", "Tariq Mansour")
        rel_type, from_id, from_type, to_id, to_type = classify_semantic_relationship(p1, p2, text)
        self.assertEqual(rel_type, "CALLS")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(to_id, "PERSON:tariq mansour")

    def test_person_calls_person_spoke_with(self):
        text = "Marcus Vance spoke with Elena Rostova regarding the shipment."
        p1 = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        p2 = _make_entity("PERSON:elena rostova", "PERSON", "Elena Rostova")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(p1, p2, text)
        self.assertEqual(rel_type, "CALLS")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(to_id, "PERSON:elena rostova")

    def test_person_calls_person_reverse(self):
        text = "Tariq Mansour received an incoming call from Marcus Vance."
        p1 = _make_entity("PERSON:tariq mansour", "PERSON", "Tariq Mansour")
        p2 = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(p1, p2, text)
        self.assertEqual(rel_type, "CALLS")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(to_id, "PERSON:tariq mansour")

    def test_phone_calls_phone_forward(self):
        text = "Target device 555-014-8899 placed multiple outgoing calls to 555-014-9911."
        ph1 = _make_entity("PHONE:555-014-8899", "PHONE", "555-014-8899")
        ph2 = _make_entity("PHONE:555-014-9911", "PHONE", "555-014-9911")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(ph1, ph2, text)
        self.assertEqual(rel_type, "CALLS")
        self.assertEqual(from_id, "PHONE:555-014-8899")
        self.assertEqual(to_id, "PHONE:555-014-9911")

    def test_phone_calls_phone_reverse(self):
        text = "Device 555-014-9911 was called by 555-014-8899 at midnight."
        ph1 = _make_entity("PHONE:555-014-9911", "PHONE", "555-014-9911")
        ph2 = _make_entity("PHONE:555-014-8899", "PHONE", "555-014-8899")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(ph1, ph2, text)
        self.assertEqual(rel_type, "CALLS")
        self.assertEqual(from_id, "PHONE:555-014-8899")
        self.assertEqual(to_id, "PHONE:555-014-9911")


class UsesRelationshipTests(unittest.TestCase):
    """Tests for USES (person -> phone)."""

    def test_person_uses_phone_parenthetical(self):
        text = "Field surveillance observed primary suspect Marcus Vance (phone: 555-014-8899) meeting Elena."
        p = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        ph = _make_entity("PHONE:555-014-8899", "PHONE", "555-014-8899")
        rel_type, from_id, from_type, to_id, to_type = classify_semantic_relationship(p, ph, text)
        self.assertEqual(rel_type, "USES")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(from_type, "PERSON")
        self.assertEqual(to_id, "PHONE:555-014-8899")
        self.assertEqual(to_type, "PHONE")

    def test_person_uses_phone_explicit_verb(self):
        text = "The driver was identified as Marcus Vance, using mobile device 555-014-8899."
        p = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        ph = _make_entity("PHONE:555-014-8899", "PHONE", "555-014-8899")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(ph, p, text)
        self.assertEqual(rel_type, "USES")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(to_id, "PHONE:555-014-8899")

    def test_person_communicating_via_phone(self):
        text = "Tariq Mansour was seen communicating via 555-014-9911."
        p = _make_entity("PERSON:tariq mansour", "PERSON", "Tariq Mansour")
        ph = _make_entity("PHONE:555-014-9911", "PHONE", "555-014-9911")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(p, ph, text)
        self.assertEqual(rel_type, "USES")
        self.assertEqual(from_id, "PERSON:tariq mansour")
        self.assertEqual(to_id, "PHONE:555-014-9911")

    def test_person_contact_at_phone(self):
        text = "Contact Detective Sarah Jenkins at 555-014-2233 regarding authorization."
        p = _make_entity("PERSON:sarah jenkins", "PERSON", "Sarah Jenkins")
        ph = _make_entity("PHONE:555-014-2233", "PHONE", "555-014-2233")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(p, ph, text)
        self.assertEqual(rel_type, "USES")
        self.assertEqual(from_id, "PERSON:sarah jenkins")
        self.assertEqual(to_id, "PHONE:555-014-2233")


class OwnsRelationshipTests(unittest.TestCase):
    """Tests for OWNS (person/org -> account/vehicle)."""

    def test_person_owns_account(self):
        text = "Marcus Vance is the registered account holder of 4123-5566-7788."
        p = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        acc = _make_entity("ACCOUNT:4123-5566-7788", "ACCOUNT", "4123-5566-7788")
        rel_type, from_id, from_type, to_id, to_type = classify_semantic_relationship(p, acc, text)
        self.assertEqual(rel_type, "OWNS")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(to_id, "ACCOUNT:4123-5566-7788")

    def test_organization_owns_account_linked(self):
        text = "Financial transactions show offshore account 4123-5566-7788 linked to shell company Apex Logistics."
        acc = _make_entity("ACCOUNT:4123-5566-7788", "ACCOUNT", "4123-5566-7788")
        org = _make_entity("ORGANIZATION:apex logistics", "ORGANIZATION", "Apex Logistics")
        rel_type, from_id, from_type, to_id, to_type = classify_semantic_relationship(acc, org, text)
        self.assertEqual(rel_type, "OWNS")
        self.assertEqual(from_id, "ORGANIZATION:apex logistics")
        self.assertEqual(to_id, "ACCOUNT:4123-5566-7788")

    def test_person_owns_vehicle_operating(self):
        text = "Vance was operating vehicle NY-4521 (black sedan)."
        p = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        veh = _make_entity("VEHICLE:ny-4521", "VEHICLE", "NY-4521")
        rel_type, from_id, from_type, to_id, to_type = classify_semantic_relationship(p, veh, text)
        self.assertEqual(rel_type, "OWNS")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(to_id, "VEHICLE:ny-4521")

    def test_person_driver_of_vehicle(self):
        text = "Automated license plate reader flagged vehicle NY-4521. The driver was identified as Marcus Vance."
        p = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        veh = _make_entity("VEHICLE:ny-4521", "VEHICLE", "NY-4521")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(veh, p, text)
        self.assertEqual(rel_type, "OWNS")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(to_id, "VEHICLE:ny-4521")


class TransfersRelationshipTests(unittest.TestCase):
    """Tests for TRANSFERS (account -> account)."""

    def test_account_transfers_to_account_forward(self):
        text = "Funds from account 4123-5566-7788 were deposited into account 9876-5432-1098."
        acc1 = _make_entity("ACCOUNT:4123-5566-7788", "ACCOUNT", "4123-5566-7788")
        acc2 = _make_entity("ACCOUNT:9876-5432-1098", "ACCOUNT", "9876-5432-1098")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(acc1, acc2, text)
        self.assertEqual(rel_type, "TRANSFERS")
        self.assertEqual(from_id, "ACCOUNT:4123-5566-7788")
        self.assertEqual(to_id, "ACCOUNT:9876-5432-1098")

    def test_account_transfers_reverse(self):
        text = "Account 9876-5432-1098 received wire transfer from account 4123-5566-7788."
        acc1 = _make_entity("ACCOUNT:9876-5432-1098", "ACCOUNT", "9876-5432-1098")
        acc2 = _make_entity("ACCOUNT:4123-5566-7788", "ACCOUNT", "4123-5566-7788")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(acc1, acc2, text)
        self.assertEqual(rel_type, "TRANSFERS")
        self.assertEqual(from_id, "ACCOUNT:4123-5566-7788")
        self.assertEqual(to_id, "ACCOUNT:9876-5432-1098")


class VisitsRelationshipTests(unittest.TestCase):
    """Tests for VISITS (person -> location)."""

    def test_person_visits_location_meeting_at(self):
        text = "Field surveillance observed Marcus Vance meeting with Elena Rostova at the waterfront warehouse."
        p = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        loc = _make_entity("LOCATION:waterfront warehouse", "LOCATION", "waterfront warehouse")
        rel_type, from_id, from_type, to_id, to_type = classify_semantic_relationship(p, loc, text)
        self.assertEqual(rel_type, "VISITS")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(to_id, "LOCATION:waterfront warehouse")

    def test_person_visits_location_entering(self):
        text = "Marcus Vance was seen entering the downtown industrial corridor at 08:00."
        p = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        loc = _make_entity("LOCATION:downtown industrial corridor", "LOCATION", "downtown industrial corridor")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(p, loc, text)
        self.assertEqual(rel_type, "VISITS")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(to_id, "LOCATION:downtown industrial corridor")

    def test_person_visits_safehouse(self):
        text = "Subject Tariq Mansour confirmed meeting Vance at coordinated safehouse."
        p = _make_entity("PERSON:tariq mansour", "PERSON", "Tariq Mansour")
        loc = _make_entity("LOCATION:coordinated safehouse", "LOCATION", "coordinated safehouse")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(p, loc, text)
        self.assertEqual(rel_type, "VISITS")
        self.assertEqual(from_id, "PERSON:tariq mansour")
        self.assertEqual(to_id, "LOCATION:coordinated safehouse")


class InvolvedInRelationshipTests(unittest.TestCase):
    """Tests for INVOLVED_IN (entity -> CASE)."""

    def test_person_involved_in_case(self):
        p = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        c = _make_entity("CASE:case-2026-0042", "CASE", "CASE-2026-0042")
        rel_type, from_id, from_type, to_id, to_type = classify_semantic_relationship(p, c)
        self.assertEqual(rel_type, "INVOLVED_IN")
        self.assertEqual(from_id, "PERSON:marcus vance")
        self.assertEqual(to_id, "CASE:case-2026-0042")

    def test_phone_involved_in_case(self):
        ph = _make_entity("PHONE:555-014-8899", "PHONE", "555-014-8899")
        c = _make_entity("CASE:case-2026-0042", "CASE", "CASE-2026-0042")
        rel_type, from_id, from_type, to_id, to_type = classify_semantic_relationship(ph, c)
        self.assertEqual(rel_type, "INVOLVED_IN")
        self.assertEqual(from_id, "PHONE:555-014-8899")
        self.assertEqual(to_id, "CASE:case-2026-0042")


class NegativeAndFallbackTests(unittest.TestCase):
    """Negative tests and fallback behavior."""

    def test_co_occurrence_fallback_without_text(self):
        p1 = _make_entity("PERSON:alice", "PERSON", "Alice")
        p2 = _make_entity("PERSON:bob", "PERSON", "Bob")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(p1, p2, None)
        self.assertEqual(rel_type, "ASSOCIATED_WITH")
        self.assertEqual(from_id, "PERSON:alice")
        self.assertEqual(to_id, "PERSON:bob")

    def test_people_co_occurring_without_call_predicate(self):
        text = "Field surveillance observed Marcus Vance meeting with associate Elena Rostova."
        p1 = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        p2 = _make_entity("PERSON:elena rostova", "PERSON", "Elena Rostova")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(p1, p2, text)
        self.assertEqual(rel_type, "ASSOCIATED_WITH")

    def test_accounts_without_transfer_predicate(self):
        text = "Account 1111-2222-3333 is open. In an unrelated bank, account 4444-5555-6666 was audited."
        acc1 = _make_entity("ACCOUNT:1111-2222-3333", "ACCOUNT", "1111-2222-3333")
        acc2 = _make_entity("ACCOUNT:4444-5555-6666", "ACCOUNT", "4444-5555-6666")
        rel_type, _, _, _, _ = classify_semantic_relationship(acc1, acc2, text)
        self.assertEqual(rel_type, "ASSOCIATED_WITH")

    def test_distant_unrelated_entities(self):
        text = "Marcus Vance lives in Boston." + (" " * 400) + "Tariq Mansour lives in Miami."
        p1 = _make_entity("PERSON:marcus vance", "PERSON", "Marcus Vance")
        p2 = _make_entity("PERSON:tariq mansour", "PERSON", "Tariq Mansour")
        rel_type, from_id, _, to_id, _ = classify_semantic_relationship(p1, p2, text)
        self.assertEqual(rel_type, "ASSOCIATED_WITH")


if __name__ == "__main__":
    unittest.main()
