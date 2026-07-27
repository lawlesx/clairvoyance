const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface ColumnInfo { name: string; type: string }
export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
  sample: Record<string, unknown>[];
}

export interface KeyFeature {
  column: string;
  label: string;
  description: string;
  importance: "high" | "medium" | "low";
}

export interface DataUnderstanding {
  domain: string;
  summary: string;
  keyFeatures: KeyFeature[];
  suggestedQuestions: string[];
  primaryMetrics: string[];
}

export interface UploadResponse {
  sessionId: string;
  tables: TableSchema[];
  understanding: DataUnderstanding;
  fromCache: boolean;
  message: string;
}

export type ChartType = "bar" | "line" | "area" | "pie" | "scatter" | "heatmap" | "number";

export interface ChartConfig {
  type: ChartType;
  xKey?: string;
  yKey?: string;
  valueKey?: string;
  labelKey?: string;
  title?: string;
  xLabel?: string;
  yLabel?: string;
}

export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  error?: boolean;
}

export interface QueryResponse {
  answer: string;
  sql?: string;
  data?: Record<string, unknown>[];
  chart?: ChartConfig;
  charts?: ChartConfig[];
  clarificationNeeded?: boolean;
  steps?: AgentStep[];
}

export async function uploadCSV(files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);

  const res = await fetch(`${API_URL}/upload`, { method: "POST", body: formData, credentials: "include" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Upload failed");
  return json;
}

export type StreamEvent =
  | { type: "tool_start"; tool: string; description: string }
  | { type: "tool_done"; tool: string; summary: string; error?: boolean }
  | { type: "answer"; text: string }
  | { type: "sql"; sql: string }
  | { type: "data"; data: Record<string, unknown>[]; chart: ChartConfig; charts: ChartConfig[] }
  | { type: "done" }
  | { type: "error"; message: string };

export async function streamQuery(
  sessionId: string,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const res = await fetch(`${API_URL}/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ sessionId, question, history }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as any).error ?? "Query failed");
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by double newlines
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      try {
        const event = JSON.parse(dataLine.slice(6)) as StreamEvent;
        onEvent(event);
      } catch {
        // skip malformed
      }
    }
  }
}

export interface AppSession {
  id: string;
  name: string;
  tags: string[];
  sourceType: "csv" | "database";
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

export interface AppMessage {
  id: string;
  role: "user" | "assistant";
  content: {
    text?: string;
    answer?: string;
    sql?: string;
    data?: Record<string, unknown>[];
    chart?: ChartConfig;
    charts?: ChartConfig[];
    clarificationNeeded?: boolean;
  };
  createdAt: string;
}

export async function analyzeSession(sessionId: string): Promise<DataUnderstanding> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/analyze`, {
    method: "POST",
    credentials: "include",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Analysis failed");
  return json.understanding;
}

export async function listSessions(): Promise<AppSession[]> {
  const res = await fetch(`${API_URL}/sessions`, { credentials: "include" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to fetch sessions");
  return json.sessions;
}

export async function searchSessions(q: string): Promise<AppSession[]> {
  const res = await fetch(`${API_URL}/sessions/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to search sessions");
  return json.sessions;
}

export async function getSession(id: string): Promise<{
  session: AppSession;
  messages: AppMessage[];
  understanding?: DataUnderstanding;
  tables?: TableSchema[];
}> {
  const res = await fetch(`${API_URL}/sessions/${id}`, { credentials: "include" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to fetch session");
  return json;
}

export async function updateSession(id: string, patch: { name?: string; tags?: string[] }): Promise<AppSession> {
  const res = await fetch(`${API_URL}/sessions/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to update session");
  return json.session;
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/sessions/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as any).error ?? "Failed to delete session");
  }
}

export async function shareSession(id: string): Promise<{ shareToken: string; shareUrl: string }> {
  const res = await fetch(`${API_URL}/sessions/${id}/share`, {
    method: "POST",
    credentials: "include",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to share session");
  return json;
}

export async function revokeShare(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/sessions/${id}/share`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as any).error ?? "Failed to revoke share");
  }
}

export async function getSharedSession(token: string): Promise<{ session: Omit<AppSession, "shareToken" | "updatedAt" | "expiresAt">; messages: AppMessage[] }> {
  const res = await fetch(`${API_URL}/share/${token}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Share link not found");
  return json;
}

// ── Connections ──────────────────────────────────────────────────────────────

export interface DataConnection {
  id: string;
  name: string;
  dbType: "postgresql" | "mysql";
  host: string;
  port: number;
  dbName: string;
  username: string;
  sslMode: string | null;
  createdAt: string;
}

export async function listConnections(): Promise<DataConnection[]> {
  const res = await fetch(`${API_URL}/connections`, { credentials: "include" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to list connections");
  return json;
}

export async function createConnection(data: {
  name: string;
  dbType: "postgresql" | "mysql";
  host: string;
  port: number;
  dbName: string;
  username: string;
  password: string;
  sslMode?: string;
}): Promise<DataConnection> {
  const res = await fetch(`${API_URL}/connections`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to create connection");
  return json;
}

export async function previewConnection(id: string): Promise<{ tables: { tableName: string; columns: { name: string; type: string }[]; rowCount: number }[]; tableCount: number }> {
  const res = await fetch(`${API_URL}/connections/${id}/schema`, { credentials: "include" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to preview connection");
  return json;
}

export async function testConnection(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_URL}/connections/${id}/test`, {
    method: "POST",
    credentials: "include",
  });
  return res.json();
}

export async function deleteConnection(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/connections/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as any).error ?? "Failed to delete connection");
  }
}

export async function connectDatabase(connectionId: string, name?: string): Promise<{ sessionId: string }> {
  const res = await fetch(`${API_URL}/sessions/connect`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connectionId, name }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to connect database");
  return json;
}

