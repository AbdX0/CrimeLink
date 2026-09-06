/** Graph network types + endpoints (read-only). */

import { request } from "./client";

export interface GraphNode {
  id: string;
  labels: string[];
  name: string | null;
  confidence: number | null;
  source_record_id: number | null;
  properties?: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  evidence_source_id: number | string | null;
  confidence: number | null;
  timestamp: string | null;
}

export interface GraphNetwork {
  node_count: number;
  edge_count: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface EvidenceRecord {
  id: number;
  source_type: string;
  title: string | null;
  created_at: string;
}

export interface PersonItem {
  id: string;
  name: string;
  confidence: number | null;
  source_record_id: number | null;
  degree: number;
}

export interface PersonConnectionItem {
  person_id: string;
  name: string;
  relationship_type: string;
  direction: "INCOMING" | "OUTGOING";
  confidence: number | null;
  timestamp: string | null;
  evidence_source_id: number | string | null;
}

export interface CommunicationItem {
  id: string;
  timestamp: string | null;
  from_party: string;
  to_party: string;
  channel: string;
  event_type: string;
  evidence_source_id: number | string | null;
  confidence: number | null;
}

export interface LocationItem {
  location_id: string;
  location_name: string;
  relationship_type: string;
  timestamp: string | null;
  confidence: number | null;
  evidence_source_id: number | string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface VehicleItem {
  vehicle_id: string;
  vehicle_number: string;
  relationship_type: string;
  owner: string | null;
  timestamp: string | null;
  confidence: number | null;
  evidence_source_id: number | string | null;
  details?: string | null;
}

export interface TransactionItem {
  id: string;
  direction: "INCOMING" | "OUTGOING";
  source_account: string;
  destination_account: string;
  amount: number | string | null;
  transaction_type: string;
  associated_person: string | null;
  timestamp: string | null;
  evidence_source_id: number | string | null;
  confidence: number | null;
}

export interface CaseItem {
  case_id: string;
  case_name: string;
  evidence_source_id: number | string | null;
}

export interface EvidenceRecordItem {
  id: number;
  title: string;
  source_type: string;
  created_at: string | null;
  content_snippet: string | null;
}

export interface PatternAlertItem {
  entity_id: string;
  pattern_type: string;
  risk_score: number;
  explanation: string;
  evidence_source_ids: number[];
  entity_name?: string;
  entity_labels?: string[];
}

export interface EntityProfileResponse {
  target_entity: {
    id: string;
    name: string;
    labels: string[];
    type: string;
    confidence: number | null;
    source_record_id: number | null;
    properties: Record<string, any>;
  };
  overview: {
    connected_persons: number;
    phones: number;
    vehicles: number;
    accounts: number;
    locations: number;
    transactions: number;
    communications: number;
    alerts: number;
    primary_case: string | null;
  };
  person_connections: PersonConnectionItem[];
  communications: CommunicationItem[];
  locations: LocationItem[];
  vehicles: VehicleItem[];
  transactions: TransactionItem[];
  cases: CaseItem[];
  phones: Array<{
    phone_id: string;
    phone_number: string;
    relationship_type: string;
    timestamp: string | null;
    confidence: number | null;
    evidence_source_id: number | string | null;
  }>;
  accounts: Array<{
    account_id: string;
    account_number: string;
    relationship_type: string;
    timestamp: string | null;
    confidence: number | null;
    evidence_source_id: number | string | null;
  }>;
  evidence_records: EvidenceRecordItem[];
  alerts: PatternAlertItem[];
  subgraph: GraphNetwork;
}

/** Fetch the full read-only network for visualization. */
export const getGraphNetwork = (entityType?: string, limit = 300) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (entityType) q.set("entity_type", entityType);
  return request<GraphNetwork>(`/graph/network?${q}`);
};

/** Fetch a source record used as evidence (read-only). */
export const getEvidenceRecord = (sourceRecordId: number) =>
  request<EvidenceRecord>(`/graph/evidence/${sourceRecordId}`);

/** Fetch all detected person nodes for selection and filtering. */
export const getPersonsList = (limit = 100) =>
  request<PersonItem[]>(`/graph/persons?limit=${limit}`);

/** Fetch full entity investigation profile. */
export const getEntityProfile = (nodeId: string) =>
  request<EntityProfileResponse>(`/graph/entity/${encodeURIComponent(nodeId)}/profile`);
