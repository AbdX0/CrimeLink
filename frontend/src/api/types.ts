/** Types mirroring the FastAPI response schemas. */

export interface HealthStatus {
  status: string;
}

export interface SourceRecord {
  id: number;
  source_type: string;
  title: string | null;
  url: string | null;
  content: string | null;
  created_at: string;
}

export interface SourceRecordListItem {
  id: number;
  source_type: string;
  title: string | null;
  url: string | null;
  content: string | null;
  created_at: string;
}

export interface EntityItem {
  entity_type: string;
  entity_text: string;
  start: number;
  end: number;
  confidence: number;
  source_record_id: number;
}

export interface EntityExtractionResponse {
  source_record_id: number;
  entities: EntityItem[];
}

export interface ResolutionItem {
  entity_id: number;
  entity_type: string;
  entity_text: string;
  normalized_value: string;
  similarity: number;
  resolution_status: string;
}

export interface ResolutionResult {
  entity_id: number;
  entity_type: string;
  entity_text: string;
  normalized_value: string;
  resolved_with: ResolutionItem[];
  resolution_status: string;
}

export interface AnalyticsEntityScore {
  entity_id: string;
  name: string | null;
  labels: string[];
  degree?: number;
  score?: number;
  community_id?: number;
}

export interface ShortestPathResult {
  algorithm: string;
  from_id: string;
  to_id: string;
  found: boolean;
  path: string[];
  length: number | null;
}

export interface SuspiciousAlert {
  entity_id: string;
  entity_name: string | null;
  entity_labels: string[];
  pattern_type: string;
  risk_score: number;
  explanation: string;
  evidence_source_ids: Array<number | string>;
}

export interface SuspiciousResponse {
  count: number;
  thresholds: Record<string, number>;
  alerts: SuspiciousAlert[];
}

export interface PipelineGraphSummary {
  nodes_created: number;
  nodes_merged: number;
  relationships_created: number;
  relationships_merged: number;
}

export interface PipelineResolutionSummary {
  entities_resolved: number;
  matches: number;
  candidates: number;
  results: ResolutionResult[];
}

export interface PipelineProcessResponse {
  status: string;
  source_record_id: number;
  source_record: SourceRecordListItem;
  entities: EntityItem[];
  resolution: PipelineResolutionSummary;
  graph: PipelineGraphSummary | null;
  errors: Record<string, string>;
}

export interface AuthUser {
  id: number;
  username: string;
  role: "ADMIN" | "INVESTIGATOR" | "ANALYST";
  is_active: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  role: "ADMIN" | "INVESTIGATOR" | "ANALYST";
  username: string;
}

export interface AuditLogItem {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  method: string;
  path: string;
  status_code: number;
  timestamp: string;
  resource_type: string | null;
  resource_id: string | null;
  client_ip: string | null;
  denied: boolean;
}
