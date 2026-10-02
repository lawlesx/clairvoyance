const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Types shared with the backend ────────────────────────────────────────────

export interface ColumnInfo { name: string; type: string }

export interface TableSummary {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
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
  areas?: { name: string; description: string }[];
}

export type VisualType = "kpi" | "bar" | "line" | "area" | "pie" | "scatter" | "table" | "none";
export type ValueFormat = "number" | "currency" | "percent" | "ratio" | "date" | "text";

export interface Visual {
  type: VisualType;
  x?: string;
  y?: string[];
  series?: string;
  title?: string;
}

export interface ColumnMeta {
  key: string;
  label: string;
  kind: "number" | "date" | "text";
  format: ValueFormat;
  currency?: string;
}

export type Row = Record<string, unknown>;

export interface Answer {
  headline: string;
  insights: string[];
  method?: string;
  followUps: string[];
  visual: Visual;
  columns: ColumnMeta[];
  data: Row[];
  totalRows: number;
  truncated: boolean;
  stats?: { correlation?: { x: string; y: string; r: number; n: number; description: string } };
  sql?: string;
  clarification?: { question: string; options: string[] };
  /** Older answers were free-form markdown */
  legacyMarkdown?: boolean;
}

export type StreamEvent =
  | { type: "status"; id: string; label: string; detail?: string; state: "active" | "done" | "error" }
  | { type: "sql"; sql: string }
  | { type: "result"; answer: Answer }
  | { type: "done" }
  | { type: "error"; message: string };

export interface AppSession {
  id: string;
  name: string;
  tags: string[];
  sourceType: "csv" | "database";
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  domain?: string | null;
  summary?: string | null;
  questionCount?: number;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: Partial<Answer> & {
    text?: string;
    answer?: string;
    // legacy fields
    chart?: { type: string; xKey?: string; yKey?: string; labelKey?: string; valueKey?: string; title?: string };
  };
  createdAt: string;
}

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

// ── Helpers ──────────────────────────────────────────────────────────────────

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { credentials: "include", ...init });
  } catch {
    throw new Error("Can't reach the Clairvoyance server. Is it running?");
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

function jsonBody(body: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Convert a stored assistant message (new or legacy shape) into an Answer. */
export function toAnswer(content: StoredMessage["content"]): Answer {
  if (typeof content.headline === "string") {
    return {
      headline: content.headline,
      insights: content.insights ?? [],
      method: content.method,
      followUps: content.followUps ?? [],
      visual: content.visual ?? { type: "none" },
      columns: content.columns ?? [],
      data: content.data ?? [],
      totalRows: content.totalRows ?? content.data?.length ?? 0,
      truncated: content.truncated ?? false,
      stats: content.stats,
      sql: content.sql,
      clarification: content.clarification,
    };
  }
  // Legacy: free-form markdown answer + chart config
  const c = content.chart;
  const legacyType = c?.type === "heatmap" || c?.type === "number" ? undefined : c?.type;
  const visual: Visual = legacyType
    ? { type: legacyType as VisualType, x: c?.xKey ?? c?.labelKey, y: [c?.yKey ?? c?.valueKey ?? ""].filter(Boolean) }
    : { type: content.data?.length ? "table" : "none" };
  return {
    headline: content.answer ?? "",
    insights: [],
    followUps: [],
    visual,
    columns: [],
    data: content.data ?? [],
    totalRows: content.data?.length ?? 0,
    truncated: false,
    sql: content.sql,
    legacyMarkdown: true,
  };
}

// ── Upload & questions ───────────────────────────────────────────────────────

export async function uploadCSV(files: File[]): Promise<{ sessionId: string }> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  return request("/upload", { method: "POST", body: formData });
}

export async function streamQuery(
  sessionId: string,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string; sql?: string }>,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/query/stream`, {
      method: "POST",
      credentials: "include",
      signal,
      ...jsonBody({ sessionId, question, history }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error("Can't reach the Clairvoyance server. Is it running?");
  }

  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? "Something went wrong. Please try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      try {
        onEvent(JSON.parse(dataLine.slice(6)) as StreamEvent);
      } catch {
        // skip malformed event
      }
    }
  }
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function analyzeSession(sessionId: string, refresh = false): Promise<DataUnderstanding> {
  const json = await request<{ understanding: DataUnderstanding }>(
    `/sessions/${sessionId}/analyze${refresh ? "?refresh=1" : ""}`,
    { method: "POST" }
  );
  return json.understanding;
}

export async function listSessions(): Promise<AppSession[]> {
  return (await request<{ sessions: AppSession[] }>("/sessions")).sessions;
}

export async function searchSessions(q: string): Promise<AppSession[]> {
  return (await request<{ sessions: AppSession[] }>(`/sessions/search?q=${encodeURIComponent(q)}`)).sessions;
}

export async function getSession(id: string): Promise<{
  session: AppSession;
  messages: StoredMessage[];
  understanding: DataUnderstanding | null;
}> {
  return request(`/sessions/${id}`);
}

export async function getSessionTables(id: string): Promise<TableSummary[]> {
  return (await request<{ tables: TableSummary[] }>(`/sessions/${id}/tables`)).tables;
}

export async function updateSession(id: string, patch: { name?: string; tags?: string[] }): Promise<void> {
  await request(`/sessions/${id}`, { method: "PATCH", ...jsonBody(patch) });
}

export async function deleteSession(id: string): Promise<void> {
  await request(`/sessions/${id}`, { method: "DELETE" });
}

export async function shareSession(id: string): Promise<{ shareToken: string; shareUrl: string }> {
  return request(`/sessions/${id}/share`, { method: "POST" });
}

export async function revokeShare(id: string): Promise<void> {
  await request(`/sessions/${id}/share`, { method: "DELETE" });
}

export async function getSharedSession(token: string): Promise<{
  session: Pick<AppSession, "id" | "name" | "tags" | "sourceType" | "createdAt">;
  messages: StoredMessage[];
}> {
  return request(`/share/${token}`);
}

// ── Connections ──────────────────────────────────────────────────────────────

export interface ConnectionInput {
  name?: string;
  dbType: "postgresql" | "mysql";
  host: string;
  port: number;
  dbName: string;
  username: string;
  password: string;
  sslMode?: string;
}

export async function listConnections(): Promise<DataConnection[]> {
  return request("/connections");
}

export async function createConnection(data: ConnectionInput): Promise<DataConnection> {
  return request("/connections", { method: "POST", ...jsonBody(data) });
}

export async function previewConnection(id: string): Promise<{ tables: TableSummary[]; tableCount: number }> {
  return request(`/connections/${id}/schema`);
}

export async function deleteConnection(id: string): Promise<void> {
  await request(`/connections/${id}`, { method: "DELETE" });
}

export async function connectDatabase(connectionId: string, name?: string): Promise<{ sessionId: string }> {
  return request("/sessions/connect", { method: "POST", ...jsonBody({ connectionId, name }) });
}

/**
 * Parse a connection string such as
 *   postgres://user:pass@host:5432/db?sslmode=require
 *   mysql://user:pass@host/db
 * Returns null when it isn't one.
 */
export function parseConnectionString(input: string): ConnectionInput | null {
  const trimmed = input.trim();
  const m = trimmed.match(/^(postgres(?:ql)?|mysql|mariadb):\/\//i);
  if (!m) return null;
  try {
    // URL() doesn't know these schemes' defaults; swap to http for parsing.
    const url = new URL(trimmed.replace(/^[a-z]+:\/\//i, "http://"));
    const dbType = m[1]!.toLowerCase().startsWith("postgres") ? "postgresql" : "mysql";
    const ssl = url.searchParams.get("sslmode") ?? url.searchParams.get("ssl") ?? url.searchParams.get("ssl-mode");
    return {
      dbType,
      host: decodeURIComponent(url.hostname),
      port: Number(url.port) || (dbType === "mysql" ? 3306 : 5432),
      dbName: decodeURIComponent(url.pathname.replace(/^\//, "")),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      sslMode: ssl && /require|true|verify|1/i.test(ssl) ? "require" : undefined,
    };
  } catch {
    return null;
  }
}
