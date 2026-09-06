"""Semantic relationship extraction rules.

Detects explicit relationship predicates from source document text using
deterministic, explainable regex patterns to classify relationships into:
- CALLS: person <-> person, phone <-> phone
- USES: person -> phone
- OWNS: person -> account, person -> vehicle, organization -> account, organization -> vehicle
- TRANSFERS: account -> account
- VISITS: person -> location
- INVOLVED_IN: non-case -> case
- ASSOCIATED_WITH: default co-occurrence fallback when no specific predicate is detected.
"""

import re
from typing import Optional, Tuple

# Patterns for CALLS (person <-> person, phone <-> phone)
CALL_FORWARD_PATTERN = re.compile(
    r"\b(calls?|called|calling|dials?|dialed|dialing|contacted?|contacting|"
    r"spoke\s+with|speaking\s+with|speaks?\s+with|talked\s+to|talking\s+to|"
    r"placed\s+(?:an?\s+)?(?:outgoing\s+)?calls?\s+to|"
    r"telephoned?|communicat(?:es?|ed|ing)\s+(?:with|via)|reached\s+out\s+to)\b",
    re.IGNORECASE,
)

CALL_REVERSE_PATTERN = re.compile(
    r"\b(received\s+(?:an?\s+)?(?:incoming\s+)?calls?\s+from|"
    r"was\s+called\s+by|was\s+contacted\s+by|incoming\s+calls?\s+from)\b",
    re.IGNORECASE,
)

# Patterns for USES (person -> phone)
USES_PATTERN = re.compile(
    r"\b(uses?|used|using|operat(?:es?|ed|ing)|utiliz(?:es?|ed|ing)|"
    r"handl(?:es?|ed|ing)|device|subscriber|carrier|mobile(?:\s+device)?|"
    r"phone:?|cell:?|communicat(?:es?|ed|ing)\s+via|contact\s+(?:.*?at|at))\b",
    re.IGNORECASE,
)

# Patterns for OWNS (person -> account/vehicle, organization -> account/vehicle)
OWNS_PATTERN = re.compile(
    r"\b(owns?|owned|owning|owner(?:s)?|account\s+holder|holder\s+of|"
    r"held\s+by|belongs?\s+to|registered\s+(?:to|under)|account\s+of|"
    r"linked\s+to|driv(?:es?|ing|en)|driver\s+(?:of|was\s+identified\s+as)?|"
    r"drove|purchased|bought|operat(?:es?|ing|ed)\s+vehicle|operating)\b",
    re.IGNORECASE,
)

# Patterns for TRANSFERS (account -> account)
TRANSFERS_FORWARD_PATTERN = re.compile(
    r"\b(transfer(?:s|red|ring)?|wire(?:s|d|ring)?|deposit(?:s|ed|ing)?|"
    r"sent\s+(?:funds|money|cash|payment)|remitt(?:ed|ance|ing)|"
    r"paid\s+to|moved\s+funds|disburs(?:ed?|ing)|credited\s+to|deposited\s+into|into|to)\b",
    re.IGNORECASE,
)

TRANSFERS_REVERSE_PATTERN = re.compile(
    r"\b(received\s+(?:(?:funds|money|cash|transfer|wire|incoming|payment)\s*)+from|"
    r"debited\s+from|drawn\s+from)\b",
    re.IGNORECASE,
)

# Patterns for VISITS (person -> location)
VISITS_PATTERN = re.compile(
    r"\b(visit(?:s|ed|ing)?|travel(?:l)?(?:s|ed|ing)?(?:\s+to)?|"
    r"sighted\s+at|spotted\s+at|seen\s+(?:at|in)|arrived\s+(?:at|in)|"
    r"enter(?:s|ed|ing)?|met\s+at|meeting\s+(?:with\s+.*?\s+)?at|meeting\s+at|"
    r"frequented|fled\s+to|present\s+at|located\s+at|stayed\s+at|"
    r"resided\s+at|hideout|warehouse|safehouse)\b",
    re.IGNORECASE,
)


def _get_entity_search_tokens(entity_text: str) -> list[str]:
    """Return distinct search tokens/phrases for matching entity mentions in text."""
    if not entity_text or not entity_text.strip():
        return []
    clean = entity_text.strip()
    tokens = [clean]
    # For multi-word entity names (e.g. "Marcus Vance"), also search for individual name tokens (e.g. "Vance")
    words = [w for w in re.split(r"\s+", clean) if len(w) >= 3 and w.lower() not in {"the", "and", "off", "for"}]
    for w in words:
        if w not in tokens:
            tokens.append(w)
    return tokens


def _find_proximity_snippet(
    text: str, text_a: str, text_b: str, max_distance: int = 250
) -> Optional[Tuple[str, str, str]]:
    """Locate the closest co-occurrence of text_a and text_b in text.

    Returns (order_type, between_text, context_window) or None if too distant.
    order_type is 'a_first' or 'b_first'.
    """
    if not text or not text_a or not text_b:
        return None

    tokens_a = _get_entity_search_tokens(text_a)
    tokens_b = _get_entity_search_tokens(text_b)

    matches_a: list[Tuple[int, int]] = []
    for tok in tokens_a:
        pat = r"\b" + re.escape(tok) + r"\b"
        for m in re.finditer(pat, text, re.IGNORECASE):
            span = m.span()
            if span not in matches_a:
                matches_a.append(span)

    matches_b: list[Tuple[int, int]] = []
    for tok in tokens_b:
        pat = r"\b" + re.escape(tok) + r"\b"
        for m in re.finditer(pat, text, re.IGNORECASE):
            span = m.span()
            if span not in matches_b:
                matches_b.append(span)

    if not matches_a or not matches_b:
        return None

    best_score = float("inf")
    best_candidate = None

    for sa, ea in matches_a:
        for sb, eb in matches_b:
            if sa < sb:
                dist = sb - ea
                cand = ("a_first", sa, ea, sb, eb)
                cand_between = text[ea:sb]
            else:
                dist = sa - eb
                cand = ("b_first", sb, eb, sa, ea)
                cand_between = text[eb:sa]

            if dist < 0 or dist > max_distance:
                continue

            # Penalize cross-sentence spans so same-sentence co-occurrences are preferred
            penalty = 100 if ("\n" in cand_between or ". " in cand_between) else 0
            score = dist + penalty
            if score < best_score:
                best_score = score
                best_candidate = cand

    if not best_candidate:
        return None

    order_type, s1, e1, s2, e2 = best_candidate
    between = text[e1:s2]
    context = text[max(0, s1 - 40):min(len(text), e2 + 40)]
    return order_type, between, context


def _is_same_sentence_clause(between: str, max_sentence_breaks: int = 0) -> bool:
    """Check if the text between two mentions stays within the same sentence/clause."""
    if not between:
        return True
    # Count full stops, newlines, or semicolons
    breaks = len(re.findall(r"(?:\.\s+|\n+|;\s+)", between))
    return breaks <= max_sentence_breaks


def classify_semantic_relationship(
    entity_a: dict,
    entity_b: dict,
    source_text: Optional[str] = None,
) -> Tuple[str, str, str, str, str]:
    """Determine the semantic relationship type and directed edge orientation.

    Args:
        entity_a: dict with 'node_id', 'entity_type', 'entity_text'
        entity_b: dict with 'node_id', 'entity_type', 'entity_text'
        source_text: optional raw document text

    Returns:
        (rel_type, from_id, from_type, to_id, to_type)
    """
    type_a = entity_a["entity_type"]
    type_b = entity_b["entity_type"]
    id_a = entity_a["node_id"]
    id_b = entity_b["node_id"]
    text_a = entity_a.get("entity_text", "")
    text_b = entity_b.get("entity_text", "")

    # Rule: non-CASE -> CASE is always INVOLVED_IN
    if type_a != "CASE" and type_b == "CASE":
        return ("INVOLVED_IN", id_a, type_a, id_b, type_b)
    if type_b != "CASE" and type_a == "CASE":
        return ("INVOLVED_IN", id_b, type_b, id_a, type_a)

    # Without source text or text mentions, fall back to ASSOCIATED_WITH
    if not source_text or not text_a or not text_b:
        return ("ASSOCIATED_WITH", id_a, type_a, id_b, type_b)

    snippet = _find_proximity_snippet(source_text, text_a, text_b)
    if not snippet:
        return ("ASSOCIATED_WITH", id_a, type_a, id_b, type_b)

    order_type, between, context = snippet
    same_sentence = _is_same_sentence_clause(between, max_sentence_breaks=0)
    nearby_sentence = _is_same_sentence_clause(between, max_sentence_breaks=1)

    # 1. ACCOUNT <-> ACCOUNT -> TRANSFERS
    if type_a == "ACCOUNT" and type_b == "ACCOUNT":
        if same_sentence:
            has_reverse = bool(
                TRANSFERS_REVERSE_PATTERN.search(between)
                or "received wire from" in between.lower()
                or "deposited from" in between.lower()
            )
            has_forward = bool(
                TRANSFERS_FORWARD_PATTERN.search(between)
                or "deposited into" in between.lower()
                or "transferred to" in between.lower()
                or "wire to" in between.lower()
            )
            if has_reverse:
                if order_type == "a_first":
                    return ("TRANSFERS", id_b, type_b, id_a, type_a)
                return ("TRANSFERS", id_a, type_a, id_b, type_b)
            elif has_forward:
                if order_type == "a_first":
                    return ("TRANSFERS", id_a, type_a, id_b, type_b)
                return ("TRANSFERS", id_b, type_b, id_a, type_a)

    # 2. PERSON/ORGANIZATION <-> PERSON/ORGANIZATION or PHONE <-> PHONE -> CALLS
    if (
        (type_a in ("PERSON", "ORGANIZATION") and type_b in ("PERSON", "ORGANIZATION"))
        or (type_a == "PHONE" and type_b == "PHONE")
    ):
        if same_sentence:
            has_call_rev = bool(CALL_REVERSE_PATTERN.search(between))
            has_call_fwd = bool(CALL_FORWARD_PATTERN.search(between))
            if has_call_rev:
                if order_type == "a_first":
                    return ("CALLS", id_b, type_b, id_a, type_a)
                return ("CALLS", id_a, type_a, id_b, type_b)
            elif has_call_fwd:
                if order_type == "a_first":
                    return ("CALLS", id_a, type_a, id_b, type_b)
                return ("CALLS", id_b, type_b, id_a, type_a)

    # 3. PERSON/ORGANIZATION <-> PHONE -> USES
    if (
        (type_a in ("PERSON", "ORGANIZATION") and type_b == "PHONE")
        or (type_a == "PHONE" and type_b in ("PERSON", "ORGANIZATION"))
    ):
        person_ent = entity_a if type_a in ("PERSON", "ORGANIZATION") else entity_b
        phone_ent = entity_b if type_a in ("PERSON", "ORGANIZATION") else entity_a
        cleaned_between = between.strip()
        
        # Direct short connector (e.g. "Marcus Vance (phone: 555-...)" or "555-... (Marcus Vance)")
        is_valid_connector = False
        if order_type == "a_first" and type_a in ("PERSON", "ORGANIZATION"):
            # Person -> Phone: between should not start with ')'
            if not cleaned_between.startswith(")") and len(cleaned_between) <= 25 and (
                any(c in cleaned_between for c in ("(", ":", "-", "at", "phone", "cell", "device"))
                or len(cleaned_between) <= 5
            ):
                is_valid_connector = True
        elif order_type == "a_first" and type_a == "PHONE":
            # Phone -> Person: between should start with '(' or ':' (e.g. "555-014-8899 (Marcus Vance)")
            if (cleaned_between.startswith("(") or cleaned_between.startswith(":")) and len(cleaned_between) <= 25:
                is_valid_connector = True
        elif order_type == "b_first" and type_b in ("PERSON", "ORGANIZATION"):
            # Person -> Phone (order b_first): between should start with '(' or ':'
            if (cleaned_between.startswith("(") or cleaned_between.startswith(":")) and len(cleaned_between) <= 25:
                is_valid_connector = True
        elif order_type == "b_first" and type_b == "PHONE":
            # Phone -> Person (order b_first): between should not start with ')'
            if not cleaned_between.startswith(")") and len(cleaned_between) <= 25 and (
                any(c in cleaned_between for c in ("(", ":", "-", "at", "phone", "cell", "device"))
                or len(cleaned_between) <= 5
            ):
                is_valid_connector = True

        if is_valid_connector and "\n" not in between:
            return (
                "USES",
                person_ent["node_id"],
                person_ent["entity_type"],
                phone_ent["node_id"],
                "PHONE",
            )
        # Explicit usage verb in between in the same sentence clause (without call verbs)
        has_call_phrase = bool(
            re.search(r"\b(calls?|called|calling|dials?|dialed|spoke\s+with|talked\s+to|placed\s+(?:an?\s+)?(?:outgoing\s+)?calls?\s+to)\b", between, re.IGNORECASE)
            or CALL_REVERSE_PATTERN.search(between)
        )
        if same_sentence and not has_call_phrase and USES_PATTERN.search(between) and not cleaned_between.startswith(")"):
            return (
                "USES",
                person_ent["node_id"],
                person_ent["entity_type"],
                phone_ent["node_id"],
                "PHONE",
            )

    # 4. PERSON/ORGANIZATION <-> ACCOUNT -> OWNS
    if (
        (type_a in ("PERSON", "ORGANIZATION") and type_b == "ACCOUNT")
        or (type_b in ("PERSON", "ORGANIZATION") and type_a == "ACCOUNT")
    ):
        owner_ent = entity_a if type_a in ("PERSON", "ORGANIZATION") else entity_b
        account_ent = entity_b if type_a in ("PERSON", "ORGANIZATION") else entity_a
        # Ownership verbs in between within the same sentence
        if same_sentence and (
            OWNS_PATTERN.search(between)
            or "linked" in between.lower()
            or "account" in between.lower()
            or len(between.strip()) <= 15
        ):
            return (
                "OWNS",
                owner_ent["node_id"],
                owner_ent["entity_type"],
                account_ent["node_id"],
                "ACCOUNT",
            )

    # 5. PERSON/ORGANIZATION <-> VEHICLE -> OWNS
    if (
        (type_a in ("PERSON", "ORGANIZATION") and type_b == "VEHICLE")
        or (type_b in ("PERSON", "ORGANIZATION") and type_a == "VEHICLE")
    ):
        owner_ent = entity_a if type_a in ("PERSON", "ORGANIZATION") else entity_b
        veh_ent = entity_b if type_a in ("PERSON", "ORGANIZATION") else entity_a
        # Check if driver/ownership is explicitly stated in between
        driver_match = re.search(r"\b(driver\s+(?:of|was\s+identified\s+as)?|operating\s+vehicle|driv(?:es?|ing|en)|drove|owner\s+of|owns?)\b", between, re.IGNORECASE)
        if same_sentence and (OWNS_PATTERN.search(between) or "vehicle" in between.lower() or "sedan" in between.lower()):
            return (
                "OWNS",
                owner_ent["node_id"],
                owner_ent["entity_type"],
                veh_ent["node_id"],
                "VEHICLE",
            )
        elif nearby_sentence and driver_match:
            # Person must be in the same sentence as the driver phrase (no period between person and driver phrase)
            if order_type == "a_first" and type_a in ("PERSON", "ORGANIZATION"):
                # Person is first, driver phrase is in between
                text_after_person = between[:driver_match.start()]
                if "." not in text_after_person and "\n" not in text_after_person:
                    return ("OWNS", owner_ent["node_id"], owner_ent["entity_type"], veh_ent["node_id"], "VEHICLE")
            else:
                # Driver phrase is before Person (at end)
                text_before_person = between[driver_match.end():]
                if "." not in text_before_person and "\n" not in text_before_person:
                    return ("OWNS", owner_ent["node_id"], owner_ent["entity_type"], veh_ent["node_id"], "VEHICLE")

    # 6. PERSON <-> LOCATION -> VISITS
    if (type_a in ("PERSON", "ORGANIZATION") and type_b == "LOCATION") or (type_a == "LOCATION" and type_b in ("PERSON", "ORGANIZATION")):
        person_ent = entity_a if type_a in ("PERSON", "ORGANIZATION") else entity_b
        loc_ent = entity_b if type_a in ("PERSON", "ORGANIZATION") else entity_a
        cleaned_between = between.strip().lower()
        has_prep = (
            len(cleaned_between) <= 50
            and any(p in cleaned_between.split() for p in ("at", "in", "to", "near", "from"))
        )
        if same_sentence and (
            VISITS_PATTERN.search(between)
            or has_prep
        ):
            return (
                "VISITS",
                person_ent["node_id"],
                person_ent["entity_type"],
                loc_ent["node_id"],
                "LOCATION",
            )

    # Default fallback: co-occurrence
    return ("ASSOCIATED_WITH", id_a, type_a, id_b, type_b)

