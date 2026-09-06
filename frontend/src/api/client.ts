import type {
  AnalyticsEntityScore,
  AuditLogItem,
  AuthUser,
  EntityExtractionResponse,
  HealthStatus,
  PipelineProcessResponse,
  ResolutionResult,
  ShortestPathResult,
  SourceRecord,
  SourceRecordListItem,
  SuspiciousResponse,
  TokenResponse,
} from "./types";

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  "http://localhost:8000";

const TOKEN_KEY = "crimelink_token";
const USER_KEY = "crimelink_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: AuthUser | null) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new ApiError(
      0,
      "Cannot reach the CrimeLink backend. Is it running on " +
        `${API_BASE}?`,
    );
  }
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = await resp.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(resp.status, detail);
  }
  return (await resp.json()) as T;
}

/** Authentication */
export async function login(
  username: string,
  password: string,
): Promise<TokenResponse> {
  const resp = await request<TokenResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  setToken(resp.access_token);
  setStoredUser({
    id: 0,
    username: resp.username,
    role: resp.role,
    is_active: true,
  });
  return resp;
}

export function logout() {
  setToken(null);
  setStoredUser(null);
}

export async function getCurrentUser(): Promise<AuthUser> {
  const user = await request<AuthUser>("/auth/me");
  setStoredUser(user);
  return user;
}

/** Health & overview */
export const getHealth = () =>
  request<HealthStatus>("/health");

/** Source records */
export const listSourceRecords = (limit = 50, skip = 0) =>
  request<SourceRecordListItem[]>(
    `/source-records?skip=${skip}&limit=${limit}`,
  );

export const getSourceRecord = (id: number) =>
  request<SourceRecord>(`/source-records/${id}`);

export async function deleteSourceRecord(id: number): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/source-records/${id}`, {
    method: "DELETE",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok && res.status !== 204) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {}
    throw new ApiError(res.status, detail);
  }
}

/** NLP entity extraction for a record */
export const extractEntities = (recordId: number) =>
  request<EntityExtractionResponse>(
    `/source-records/${recordId}/entities`,
  );

/** Entity resolution for a record */
export const resolveSourceRecord = (recordId: number) =>
  request<ResolutionResult[]>(
    `/resolution/source-record/${recordId}`,
  );

/** Analytics */
export const getDegreeCentrality = (
  entityType?: string,
  limit = 20,
) => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (entityType) q.set("entity_type", entityType);
  return request<{ algorithm: string; results: AnalyticsEntityScore[] }>(
    `/analytics/degree-centrality?${q}`,
  );
};

export const getPageRank = (limit = 20) =>
  request<{ algorithm: string; results: AnalyticsEntityScore[] }>(
    `/analytics/pagerank?limit=${limit}`,
  );

export const getCommunities = () =>
  request<{ algorithm: string; results: AnalyticsEntityScore[] }>(
    "/analytics/communities",
  );

export const getShortestPath = (fromId: string, toId: string) => {
  const q = new URLSearchParams({ from_id: fromId, to_id: toId });
  return request<ShortestPathResult>(`/analytics/shortest-path?${q}`);
};

/** Suspicious-pattern alerts */
export const getSuspiciousPatterns = () =>
  request<SuspiciousResponse>("/patterns/suspicious");

/** Pipeline orchestration */
export const processPipelineRecord = (recordId: number) =>
  request<PipelineProcessResponse>(
    `/pipeline/process/source-record/${recordId}`,
    { method: "POST" },
  );

export const processPipelineFile = (file: File, title?: string) => {
  const form = new FormData();
  form.append("file", file);
  if (title) form.append("title", title);
  return request<PipelineProcessResponse>("/pipeline/process/file", {
    method: "POST",
    body: form,
  });
};

/** Standalone Ingestion & Population */
export const ingestFile = (file: File, title?: string) => {
  const form = new FormData();
  form.append("file", file);
  if (title) form.append("title", title);
  return request<SourceRecordListItem>("/ingest/file", {
    method: "POST",
    body: form,
  });
};

export const populateGraphRecord = (recordId: number) =>
  request<{
    source_record_id: number;
    nodes_created: number;
    nodes_merged: number;
    relationships_created: number;
    relationships_merged: number;
  }>(`/graph/populate/source-record/${recordId}`, {
    method: "POST",
  });

/** Audit logs (ADMIN only) */
export const getAuditLogs = (params?: {
  username?: string;
  action?: string;
  limit?: number;
}) => {
  const q = new URLSearchParams();
  if (params?.username) q.set("username", params.username);
  if (params?.action) q.set("action", params.action);
  if (params?.limit) q.set("limit", String(params.limit));
  return request<AuditLogItem[]>(`/audit-logs?${q}`);
};
