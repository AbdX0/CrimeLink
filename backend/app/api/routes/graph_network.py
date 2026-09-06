"""Read-only graph network endpoint: nodes + edges for visualization."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.source_record import SourceRecord
from app.neo4j import get_driver
from app.services import graph

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/network")
def network(
    entity_type: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict:
    """Return the knowledge-graph network (nodes + edges) for visualization.

    Read-only. Optionally filter by entity type; ``limit`` caps node count.
    """
    if entity_type:
        try:
            label = graph._validate_entity_type(entity_type)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        node_match = f"(n:{label})"
    else:
        node_match = "(n)"

    try:
        driver = get_driver()
        with driver.session() as session:
            node_rows = session.run(
                f"MATCH {node_match} WHERE n.id IS NOT NULL "
                "RETURN n.id AS id, labels(n) AS labels, "
                "n.name AS name, n.confidence AS confidence, "
                "n.source_record_id AS source_record_id "
                "ORDER BY id LIMIT $limit",
                {"limit": limit},
            ).data()
            edge_rows = session.run(
                "MATCH (a)-[r]->(b) WHERE a.id IS NOT NULL AND b.id IS NOT NULL "
                "AND type(r) IN $rel_types "
                "RETURN elementId(r) AS id, a.id AS source, b.id AS target, "
                "type(r) AS type, r.evidence_source_id AS evidence_source_id, "
                "r.confidence AS confidence, r.timestamp AS timestamp",
                {"rel_types": sorted(graph.RELATIONSHIP_TYPES)},
            ).data()
    except Exception as exc:
        raise HTTPException(
            status_code=503, detail=f"Neo4j unavailable: {exc}"
        ) from exc

    node_ids = {row["id"] for row in node_rows}
    nodes = [
        {
            "id": row["id"],
            "labels": row["labels"],
            "name": row.get("name"),
            "confidence": row.get("confidence"),
            "source_record_id": row.get("source_record_id"),
        }
        for row in node_rows
    ]
    edges = [
        {
            "id": row["id"],
            "source": row["source"],
            "target": row["target"],
            "type": row["type"],
            "evidence_source_id": row.get("evidence_source_id"),
            "confidence": row.get("confidence"),
            "timestamp": row.get("timestamp"),
        }
        for row in edge_rows
        if row["source"] in node_ids and row["target"] in node_ids
    ]
    return {"node_count": len(nodes), "edge_count": len(edges),
            "nodes": nodes, "edges": edges}


@router.get("/evidence/{source_record_id}")
def evidence_record(
    source_record_id: int, db: Session = Depends(get_db)
) -> dict:
    """Read-only lookup of a source record used as graph evidence."""
    record = (
        db.query(SourceRecord)
        .filter(SourceRecord.id == source_record_id)
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Source record not found")
    return {
        "id": record.id,
        "source_type": record.source_type,
        "title": record.title,
        "created_at": record.created_at.isoformat(),
    }


@router.get("/persons")
def list_persons(
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict]:
    """Return all PERSON nodes in the graph with their degree and basic metadata."""
    try:
        driver = get_driver()
        with driver.session() as session:
            rows = session.run(
                """
                MATCH (p:PERSON)
                WHERE p.id IS NOT NULL
                OPTIONAL MATCH (p)-[r]-()
                RETURN p.id AS id, p.name AS name, p.confidence AS confidence,
                       p.source_record_id AS source_record_id,
                       count(r) AS degree
                ORDER BY degree DESC, name ASC
                LIMIT $limit
                """,
                {"limit": limit},
            ).data()
            return [
                {
                    "id": r["id"],
                    "name": r.get("name") or r["id"].replace("PERSON:", ""),
                    "confidence": r.get("confidence"),
                    "source_record_id": r.get("source_record_id"),
                    "degree": r.get("degree", 0),
                }
                for r in rows
            ]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Neo4j unavailable: {exc}") from exc


@router.get("/entity/{node_id:path}/profile")
def entity_profile(
    node_id: str,
    db: Session = Depends(get_db),
) -> dict:
    """Return a comprehensive intelligence profile for one selected entity/person."""
    try:
        driver = get_driver()
        with driver.session() as session:
            target_res = session.run(
                """
                MATCH (n {id: $node_id})
                RETURN n.id AS id, labels(n) AS labels, n.name AS name,
                       n.confidence AS confidence, n.source_record_id AS source_record_id,
                       properties(n) AS properties
                """,
                {"node_id": node_id},
            ).data()

            if not target_res:
                raise HTTPException(status_code=404, detail=f"Entity not found: {node_id}")

            target_row = target_res[0]
            target_entity = {
                "id": target_row["id"],
                "name": target_row.get("name") or target_row["id"],
                "labels": target_row.get("labels", []),
                "type": target_row.get("labels", ["ENTITY"])[0] if target_row.get("labels") else "ENTITY",
                "confidence": target_row.get("confidence"),
                "source_record_id": target_row.get("source_record_id"),
                "properties": target_row.get("properties", {}),
            }

            # Direct 1-hop relationships
            one_hop_rows = session.run(
                """
                MATCH (n {id: $node_id})-[r]-(m)
                WHERE m.id IS NOT NULL AND type(r) IN $rel_types
                RETURN elementId(r) AS edge_id,
                       type(r) AS type,
                       startNode(r).id AS source,
                       endNode(r).id AS target,
                       r.evidence_source_id AS evidence_source_id,
                       r.confidence AS confidence,
                       r.timestamp AS timestamp,
                       properties(r) AS rel_props,
                       m.id AS neighbor_id,
                       labels(m) AS neighbor_labels,
                       m.name AS neighbor_name,
                       m.confidence AS neighbor_confidence,
                       m.source_record_id AS neighbor_source_record_id,
                       properties(m) AS neighbor_props
                """,
                {"node_id": node_id, "rel_types": sorted(graph.RELATIONSHIP_TYPES)},
            ).data()

            # 2-hop communications via phones
            phone_comm_rows = session.run(
                """
                MATCH (n {id: $node_id})-[:USES|ASSOCIATED_WITH]-(ph:PHONE)-[c:CALLS]-(ph2:PHONE)
                OPTIONAL MATCH (ph2)-[:USES|ASSOCIATED_WITH]-(p2:PERSON)
                RETURN elementId(c) AS edge_id,
                       startNode(c).id AS from_phone,
                       endNode(c).id AS to_phone,
                       c.timestamp AS timestamp,
                       c.confidence AS confidence,
                       c.evidence_source_id AS evidence_source_id,
                       properties(c) AS props,
                       ph.id AS my_phone,
                       p2.id AS other_person_id,
                       p2.name AS other_person_name
                """,
                {"node_id": node_id},
            ).data()

            # Direct person-to-person calls
            direct_calls_rows = session.run(
                """
                MATCH (n {id: $node_id})-[c:CALLS]-(p2:PERSON)
                RETURN elementId(c) AS edge_id,
                       startNode(c).id AS from_id,
                       endNode(c).id AS to_id,
                       c.timestamp AS timestamp,
                       c.confidence AS confidence,
                       c.evidence_source_id AS evidence_source_id,
                       properties(c) AS props,
                       p2.id AS other_person_id,
                       p2.name AS other_person_name
                """,
                {"node_id": node_id},
            ).data()

            # 2-hop financial transactions via accounts
            account_trans_rows = session.run(
                """
                MATCH (n {id: $node_id})-[:OWNS|ASSOCIATED_WITH]-(acc:ACCOUNT)-[t:TRANSFERS]-(acc2:ACCOUNT)
                OPTIONAL MATCH (acc2)-[:OWNS|ASSOCIATED_WITH]-(p2:PERSON)
                RETURN elementId(t) AS edge_id,
                       startNode(t).id AS source_account,
                       endNode(t).id AS dest_account,
                       t.timestamp AS timestamp,
                       t.confidence AS confidence,
                       t.evidence_source_id AS evidence_source_id,
                       t.amount AS amount,
                       properties(t) AS props,
                       acc.id AS my_account,
                       p2.id AS other_person_id,
                       p2.name AS other_person_name
                """,
                {"node_id": node_id},
            ).data()

            # Direct transfers
            direct_trans_rows = session.run(
                """
                MATCH (n {id: $node_id})-[t:TRANSFERS]-(other)
                RETURN elementId(t) AS edge_id,
                       startNode(t).id AS source_id,
                       endNode(t).id AS dest_id,
                       t.timestamp AS timestamp,
                       t.confidence AS confidence,
                       t.evidence_source_id AS evidence_source_id,
                       t.amount AS amount,
                       properties(t) AS props,
                       other.id AS other_id,
                       other.name AS other_name,
                       labels(other) AS other_labels
                """,
                {"node_id": node_id},
            ).data()

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Neo4j unavailable: {exc}") from exc

    person_connections = []
    locations = []
    vehicles = []
    cases = []
    phones = []
    accounts = []
    evidence_ids: set[int] = set()

    if target_entity.get("source_record_id"):
        evidence_ids.add(target_entity["source_record_id"])

    subgraph_nodes: dict[str, dict] = {target_entity["id"]: target_entity}
    subgraph_edges: list[dict] = []

    for row in one_hop_rows:
        eid = row.get("evidence_source_id")
        if eid:
            evidence_ids.add(eid)

        neighbor_id = row["neighbor_id"]
        neighbor_labels = row["neighbor_labels"] or []
        primary_label = neighbor_labels[0] if neighbor_labels else "ENTITY"
        neighbor_name = row["neighbor_name"] or neighbor_id
        rel_type = row["type"]
        is_outgoing = row["source"] == node_id

        if neighbor_id not in subgraph_nodes:
            subgraph_nodes[neighbor_id] = {
                "id": neighbor_id,
                "name": neighbor_name,
                "labels": neighbor_labels,
                "type": primary_label,
                "confidence": row.get("neighbor_confidence"),
                "source_record_id": row.get("neighbor_source_record_id"),
                "properties": row.get("neighbor_props", {}),
            }

        subgraph_edges.append({
            "id": row["edge_id"],
            "source": row["source"],
            "target": row["target"],
            "type": rel_type,
            "evidence_source_id": eid,
            "confidence": row.get("confidence"),
            "timestamp": row.get("timestamp"),
        })

        if primary_label == "PERSON":
            person_connections.append({
                "person_id": neighbor_id,
                "name": neighbor_name,
                "relationship_type": rel_type,
                "direction": "OUTGOING" if is_outgoing else "INCOMING",
                "confidence": row.get("confidence"),
                "timestamp": row.get("timestamp"),
                "evidence_source_id": eid,
            })
        elif primary_label == "LOCATION":
            props = row.get("neighbor_props") or {}
            locations.append({
                "location_id": neighbor_id,
                "location_name": neighbor_name,
                "relationship_type": rel_type,
                "timestamp": row.get("timestamp"),
                "confidence": row.get("confidence"),
                "evidence_source_id": eid,
                "latitude": props.get("latitude") or props.get("lat"),
                "longitude": props.get("longitude") or props.get("lon") or props.get("lng"),
            })
        elif primary_label == "VEHICLE":
            props = row.get("neighbor_props") or {}
            vehicles.append({
                "vehicle_id": neighbor_id,
                "vehicle_number": neighbor_name,
                "relationship_type": rel_type,
                "owner": target_entity["name"] if rel_type == "OWNS" else None,
                "timestamp": row.get("timestamp"),
                "confidence": row.get("confidence"),
                "evidence_source_id": eid,
                "details": props.get("details") or props.get("color") or props.get("model"),
            })
        elif primary_label == "PHONE":
            phones.append({
                "phone_id": neighbor_id,
                "phone_number": neighbor_name,
                "relationship_type": rel_type,
                "timestamp": row.get("timestamp"),
                "confidence": row.get("confidence"),
                "evidence_source_id": eid,
            })
        elif primary_label == "ACCOUNT":
            accounts.append({
                "account_id": neighbor_id,
                "account_number": neighbor_name,
                "relationship_type": rel_type,
                "timestamp": row.get("timestamp"),
                "confidence": row.get("confidence"),
                "evidence_source_id": eid,
            })
        elif primary_label == "CASE":
            cases.append({
                "case_id": neighbor_id,
                "case_name": neighbor_name,
                "evidence_source_id": eid,
            })

    # Communications parsing
    communications = []
    seen_comm_edges = set()

    for r in direct_calls_rows:
        seen_comm_edges.add(r["edge_id"])
        eid = r.get("evidence_source_id")
        if eid:
            evidence_ids.add(eid)
        is_from_me = r["from_id"] == node_id
        from_name = target_entity["name"] if is_from_me else (r["other_person_name"] or r["from_id"].replace("PERSON:", ""))
        to_name = (r["other_person_name"] or r["to_id"].replace("PERSON:", "")) if is_from_me else target_entity["name"]
        communications.append({
            "id": r["edge_id"],
            "timestamp": r.get("timestamp"),
            "from_party": from_name,
            "to_party": to_name,
            "channel": "DIRECT CALL",
            "event_type": "CALLS",
            "evidence_source_id": eid,
            "confidence": r.get("confidence"),
        })

    for r in phone_comm_rows:
        if r["edge_id"] in seen_comm_edges:
            continue
        seen_comm_edges.add(r["edge_id"])
        eid = r.get("evidence_source_id")
        if eid:
            evidence_ids.add(eid)
        from_ph = r["from_phone"]
        to_ph = r["to_phone"]
        my_ph = r["my_phone"]
        is_from_me = from_ph == my_ph
        from_label = target_entity["name"] if is_from_me else (r.get("other_person_name") or from_ph.replace("PHONE:", ""))
        to_label = (r.get("other_person_name") or to_ph.replace("PHONE:", "")) if is_from_me else target_entity["name"]
        communications.append({
            "id": r["edge_id"],
            "timestamp": r.get("timestamp"),
            "from_party": from_label,
            "to_party": to_label,
            "channel": f"{from_ph.replace('PHONE:', '')} → {to_ph.replace('PHONE:', '')}",
            "event_type": "PHONE_CALL",
            "evidence_source_id": eid,
            "confidence": r.get("confidence"),
        })

    communications.sort(key=lambda c: (c.get("timestamp") or "", c["id"]))

    # Transactions parsing
    transactions = []
    seen_trans_edges = set()

    for r in account_trans_rows:
        seen_trans_edges.add(r["edge_id"])
        eid = r.get("evidence_source_id")
        if eid:
            evidence_ids.add(eid)
        src_acc = r["source_account"].replace("ACCOUNT:", "")
        dst_acc = r["dest_account"].replace("ACCOUNT:", "")
        is_outgoing = r["source_account"] == r["my_account"]
        amt = r.get("amount") or r.get("props", {}).get("amount")

        transactions.append({
            "id": r["edge_id"],
            "direction": "OUTGOING" if is_outgoing else "INCOMING",
            "source_account": src_acc,
            "destination_account": dst_acc,
            "amount": amt,
            "transaction_type": "WIRE_TRANSFER",
            "associated_person": r.get("other_person_name"),
            "timestamp": r.get("timestamp"),
            "evidence_source_id": eid,
            "confidence": r.get("confidence"),
        })

    for r in direct_trans_rows:
        if r["edge_id"] in seen_trans_edges:
            continue
        seen_trans_edges.add(r["edge_id"])
        eid = r.get("evidence_source_id")
        if eid:
            evidence_ids.add(eid)
        is_outgoing = r["source_id"] == node_id
        amt = r.get("amount") or r.get("props", {}).get("amount")
        transactions.append({
            "id": r["edge_id"],
            "direction": "OUTGOING" if is_outgoing else "INCOMING",
            "source_account": target_entity["name"] if is_outgoing else (r.get("other_name") or r["source_id"]),
            "destination_account": (r.get("other_name") or r["dest_id"]) if is_outgoing else target_entity["name"],
            "amount": amt,
            "transaction_type": "DIRECT_TRANSFER",
            "associated_person": r.get("other_name"),
            "timestamp": r.get("timestamp"),
            "evidence_source_id": eid,
            "confidence": r.get("confidence"),
        })

    transactions.sort(key=lambda t: (t.get("timestamp") or "", t["id"]))

    # Evidence details lookup from PostgreSQL
    evidence_records = []
    if evidence_ids:
        records_db = (
            db.query(SourceRecord)
            .filter(SourceRecord.id.in_(list(evidence_ids)))
            .all()
        )
        for srec in records_db:
            evidence_records.append({
                "id": srec.id,
                "title": srec.title or f"Source Record #{srec.id}",
                "source_type": srec.source_type,
                "created_at": srec.created_at.isoformat() if srec.created_at else None,
                "content_snippet": (srec.content[:240] + "…") if srec.content and len(srec.content) > 240 else srec.content,
            })

    # Suspicious alerts
    matched_alerts = []
    try:
        from app.services.patterns import detect_suspicious_patterns
        all_alerts = detect_suspicious_patterns(driver=driver)
        for al in all_alerts:
            if al.get("entity_id") == node_id or (al.get("entity_name") and al["entity_name"] == target_entity["name"]):
                matched_alerts.append(al)
    except Exception:
        pass

    overview_counts = {
        "connected_persons": len(person_connections),
        "phones": len(phones),
        "vehicles": len(vehicles),
        "accounts": len(accounts),
        "locations": len(locations),
        "transactions": len(transactions),
        "communications": len(communications),
        "alerts": len(matched_alerts),
        "primary_case": cases[0]["case_name"] if cases else None,
    }

    return {
        "target_entity": target_entity,
        "overview": overview_counts,
        "person_connections": person_connections,
        "communications": communications,
        "locations": locations,
        "vehicles": vehicles,
        "transactions": transactions,
        "cases": cases,
        "phones": phones,
        "accounts": accounts,
        "evidence_records": evidence_records,
        "alerts": matched_alerts,
        "subgraph": {
            "node_count": len(subgraph_nodes),
            "edge_count": len(subgraph_edges),
            "nodes": list(subgraph_nodes.values()),
            "edges": subgraph_edges,
        },
    }
