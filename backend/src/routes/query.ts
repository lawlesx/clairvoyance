import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { requireSessionEntry } from "../db/manager";
import { runAgent } from "../agents/orchestrator";
import type { StreamEvent } from "../agents/orchestrator";
import { db as pgDb } from "../db/pgClient";
import { messages, appSessions, dataConnections } from "../db/schema";
import { eq } from "drizzle-orm";
import { getConnector } from "../db/connectors/index";
import type { SqlDialect } from "../agents/guardrails";
import type { DataUnderstanding } from "../agents/dataAnalyst";

export const queryRouter = new Hono();

async function resolveSession(sessionId: string) {
  const [appSession] = await pgDb
    .select({
      sourceType: appSessions.sourceType,
      connectionId: appSessions.connectionId,
      understanding: appSessions.understanding,
    })
    .from(appSessions)
    .where(eq(appSessions.id, sessionId))
    .limit(1)
    .catch(() => [null]);

  return appSession ?? null;
}

// Streaming endpoint — emits SSE events as the agent works
queryRouter.post("/stream", async (c) => {
  const body = await c.req.json() as {
    sessionId: string;
    question: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  const { sessionId, question, history = [] } = body;
  if (!sessionId) return c.json({ error: "sessionId is required" }, 400);
  if (!question?.trim()) return c.json({ error: "question is required" }, 400);

  const appSession = await resolveSession(sessionId);
  const isLiveDb = appSession?.sourceType === "database" && appSession.connectionId;

  let entry: ReturnType<typeof requireSessionEntry> | null = null;
  let liveConnector = undefined;
  let sqlDialect: SqlDialect = "SQLite";

  if (isLiveDb) {
    // For live DB sessions, look up the connection config from Postgres
    const [conn] = await pgDb
      .select()
      .from(dataConnections)
      .where(eq(dataConnections.id, appSession.connectionId!))
      .limit(1);

    if (!conn) return c.json({ error: "Connection not found" }, 404);

    const { decryptPassword } = await import("../lib/crypto");
    const password = decryptPassword(conn.encryptedPassword);

    liveConnector = getConnector({
      id: conn.id,
      dbType: conn.dbType as "postgresql" | "mysql",
      host: conn.host,
      port: conn.port,
      dbName: conn.dbName,
      username: conn.username,
      password,
      sslMode: conn.sslMode ?? undefined,
    });
    sqlDialect = conn.dbType === "postgresql" ? "PostgresQL" : "MySQL";
  } else {
    try {
      entry = requireSessionEntry(sessionId);
    } catch {
      return c.json({ error: "Session not found. Please upload your data first." }, 404);
    }
  }

  const db = entry?.db ?? null;
  const schema = entry?.schema;
  // Use cached understanding from in-memory map first; fall back to Postgres-persisted value
  const understanding = (entry?.understanding ?? appSession?.understanding ?? null) as DataUnderstanding | undefined;

  return streamSSE(c, async (stream) => {
    const emit = async (event: StreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(event), event: event.type });
    };

    try {
      const result = await runAgent(db, question, history, emit, schema, understanding, liveConnector, sqlDialect, sessionId);

      // Persist messages to Postgres (best-effort — don't fail the stream if this errors)
      try {
        // Embed both the user question and assistant answer in one Voyage call
        let userEmbedding: number[] | undefined;
        let assistantEmbedding: number[] | undefined;

        if (process.env.VOYAGE_API_KEY && result.answer) {
          const { embedBatch } = await import("../lib/embeddings");
          const embeddings = await embedBatch([question, result.answer]).catch(() => []);
          userEmbedding = embeddings[0];
          assistantEmbedding = embeddings[1];
        }

        await pgDb.insert(messages).values([
          {
            sessionId,
            role: "user",
            content: { text: question },
            embedding: userEmbedding,
          },
          {
            sessionId,
            role: "assistant",
            content: {
              answer: result.answer,
              sql: result.sql,
              data: result.data as any,
              chart: result.chart,
              clarificationNeeded: result.clarificationNeeded,
            },
            embedding: assistantEmbedding,
          },
        ]);
      } catch (persistErr) {
        console.warn("Failed to persist messages:", persistErr);
      }
    } catch (e: any) {
      await emit({ type: "error", message: e.message });
      await emit({ type: "done" });
    }
  });
});

// Non-streaming fallback
queryRouter.post("/", async (c) => {
  const body = await c.req.json() as {
    sessionId: string;
    question: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  const { sessionId, question, history = [] } = body;
  if (!sessionId) return c.json({ error: "sessionId is required" }, 400);
  if (!question?.trim()) return c.json({ error: "question is required" }, 400);

  const appSession = await resolveSession(sessionId);
  const isLiveDb = appSession?.sourceType === "database" && appSession.connectionId;

  let entry: ReturnType<typeof requireSessionEntry> | null = null;
  let liveConnector = undefined;
  let sqlDialect: SqlDialect = "SQLite";

  if (isLiveDb) {
    const [conn] = await pgDb
      .select()
      .from(dataConnections)
      .where(eq(dataConnections.id, appSession.connectionId!))
      .limit(1);

    if (!conn) return c.json({ error: "Connection not found" }, 404);

    const { decryptPassword } = await import("../lib/crypto");
    const password = decryptPassword(conn.encryptedPassword);

    liveConnector = getConnector({
      id: conn.id,
      dbType: conn.dbType as "postgresql" | "mysql",
      host: conn.host,
      port: conn.port,
      dbName: conn.dbName,
      username: conn.username,
      password,
      sslMode: conn.sslMode ?? undefined,
    });
    sqlDialect = conn.dbType === "postgresql" ? "PostgresQL" : "MySQL";
  } else {
    try {
      entry = requireSessionEntry(sessionId);
    } catch {
      return c.json({ error: "Session not found. Please upload your data first." }, 404);
    }
  }

  const db = entry?.db ?? null;
  const understanding = (entry?.understanding ?? appSession?.understanding ?? null) as DataUnderstanding | undefined;
  const result = await runAgent(db, question, history, undefined, entry?.schema, understanding, liveConnector, sqlDialect, sessionId);

  // Persist messages to Postgres (best-effort) — embed both messages in one Voyage call
  try {
    let userEmbedding: number[] | undefined;
    let assistantEmbedding: number[] | undefined;

    if (process.env.VOYAGE_API_KEY && result.answer) {
      const { embedBatch } = await import("../lib/embeddings");
      const embeddings = await embedBatch([question, result.answer]).catch(() => []);
      userEmbedding = embeddings[0];
      assistantEmbedding = embeddings[1];
    }

    await pgDb.insert(messages).values([
      { sessionId, role: "user", content: { text: question }, embedding: userEmbedding },
      {
        sessionId,
        role: "assistant",
        content: {
          answer: result.answer,
          sql: result.sql,
          data: result.data as any,
          chart: result.chart,
          clarificationNeeded: result.clarificationNeeded,
        },
        embedding: assistantEmbedding,
      },
    ]);
  } catch (persistErr) {
    console.warn("Failed to persist messages:", persistErr);
  }

  return c.json(result);
});

