import { Hono } from "hono";
import { eq, and, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import fs from "fs";
import { db as pgDb } from "../db/pgClient";
import { appSessions, messages } from "../db/schema";
import { persistSessionUnderstanding } from "../db/understandingCache";
import { upsertTableEmbeddings } from "../db/tableEmbeddings";
import type { User } from "../db/schema";
import type { AppEnv } from "../types";

export const sessionsRouter = new Hono<AppEnv>();

// GET /sessions/search?q= — semantic search over message embeddings
sessionsRouter.get("/search", async (c) => {
  const user = c.get("user") as User;
  const q = c.req.query("q");
  if (!q?.trim()) return c.json({ sessions: [] });

  if (!process.env.VOYAGE_API_KEY) {
    return c.json({ sessions: [], error: "Semantic search not configured" });
  }

  try {
    const { embedText } = await import("../lib/embeddings");
    const embedding = await embedText(q);
    const vectorLiteral = `[${embedding.join(",")}]`;

    const rows = await pgDb.execute<{ sessionId: string; similarity: number }>(sql`
      SELECT m.session_id AS "sessionId",
             MAX(1 - (m.embedding <=> ${vectorLiteral}::vector)) AS similarity
      FROM messages m
      JOIN app_sessions s ON s.id = m.session_id
      WHERE s.user_id = ${user.id}
        AND m.embedding IS NOT NULL
        AND 1 - (m.embedding <=> ${vectorLiteral}::vector) >= 0.7
      GROUP BY m.session_id
      ORDER BY similarity DESC
      LIMIT 10
    `);

    if (!rows.rows.length) return c.json({ sessions: [] });

    const sessionIds = rows.rows.map((r) => r.sessionId);

    const sessionRows = await pgDb
      .select({
        id: appSessions.id,
        name: appSessions.name,
        tags: appSessions.tags,
        sourceType: appSessions.sourceType,
        createdAt: appSessions.createdAt,
        updatedAt: appSessions.updatedAt,
      })
      .from(appSessions)
      .where(and(eq(appSessions.userId, user.id)));

    const filtered = sessionRows
      .filter((s) => sessionIds.includes(s.id))
      .sort((a, b) => sessionIds.indexOf(a.id) - sessionIds.indexOf(b.id));

    return c.json({ sessions: filtered });
  } catch (e: any) {
    return c.json({ sessions: [], error: e.message });
  }
});

// ── Authenticated session routes ─────────────────────────────────────────────

// GET /sessions — list user's sessions
sessionsRouter.get("/", async (c) => {
  const user = c.get("user") as User;

  const rows = await pgDb
    .select({
      id: appSessions.id,
      name: appSessions.name,
      tags: appSessions.tags,
      sourceType: appSessions.sourceType,
      shareToken: appSessions.shareToken,
      createdAt: appSessions.createdAt,
      updatedAt: appSessions.updatedAt,
      expiresAt: appSessions.expiresAt,
    })
    .from(appSessions)
    .where(eq(appSessions.userId, user.id))
    .orderBy(desc(appSessions.updatedAt));

  return c.json({ sessions: rows });
});

// GET /sessions/:id — full session with all messages
sessionsRouter.get("/:id", async (c) => {
  const user = c.get("user") as User;
  const sessionId = c.req.param("id");

  const [appSession] = await pgDb
    .select()
    .from(appSessions)
    .where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, user.id)))
    .limit(1);

  if (!appSession) return c.json({ error: "Session not found" }, 404);

  const msgs = await pgDb
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt);

  // Try to rehydrate understanding + schema so the insights panel works on resume
  let understanding: import("../agents/dataAnalyst").DataUnderstanding | null = null;
  let tables: import("../db/schemaReader").TableSchema[] | null = null;

  // Understanding is stored directly on app_sessions — no hash lookup needed
  if (appSession.understanding) {
    understanding = appSession.understanding as import("../agents/dataAnalyst").DataUnderstanding;
  }

  if (appSession.sourceType === "csv" && appSession.sqlitePath) {
    try {
      const { getSessionEntry } = await import("../db/manager");
      const entry = getSessionEntry(sessionId);
      if (entry?.schema) {
        tables = entry.schema;
      } else {
        const { existsSync } = await import("fs");
        if (existsSync(appSession.sqlitePath)) {
          const { Database } = await import("bun:sqlite");
          const { getSchema } = await import("../db/schemaReader");
          const db = new Database(appSession.sqlitePath);
          tables = getSchema(db);
          db.close();
        }
      }
    } catch {
      // non-fatal — insights sidebar just stays empty
    }
  }

  return c.json({ session: appSession, messages: msgs, understanding, tables });
});

// PATCH /sessions/:id — update name and/or tags
sessionsRouter.patch("/:id", async (c) => {
  const user = c.get("user") as User;
  const sessionId = c.req.param("id");
  const body = await c.req.json() as { name?: string; tags?: string[] };

  const updates: Partial<typeof appSessions.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.name !== undefined) updates.name = body.name;
  if (body.tags !== undefined) updates.tags = body.tags;

  const [updated] = await pgDb
    .update(appSessions)
    .set(updates)
    .where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, user.id)))
    .returning();

  if (!updated) return c.json({ error: "Session not found" }, 404);
  return c.json({ session: updated });
});

// DELETE /sessions/:id — hard delete with SQLite file cleanup
sessionsRouter.delete("/:id", async (c) => {
  const user = c.get("user") as User;
  const sessionId = c.req.param("id");

  const [deleted] = await pgDb
    .delete(appSessions)
    .where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, user.id)))
    .returning();

  if (!deleted) return c.json({ error: "Session not found" }, 404);

  // Clean up SQLite file if present
  if (deleted.sqlitePath) {
    try {
      fs.rmSync(deleted.sqlitePath, { force: true });
    } catch {
      // non-fatal
    }
  }

  return c.json({ success: true });
});

// POST /sessions/:id/share — generate share token
sessionsRouter.post("/:id/share", async (c) => {
  const user = c.get("user") as User;
  const sessionId = c.req.param("id");

  const token = nanoid(24);
  const [updated] = await pgDb
    .update(appSessions)
    .set({ shareToken: token, updatedAt: new Date() })
    .where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, user.id)))
    .returning();

  if (!updated) return c.json({ error: "Session not found" }, 404);

  const shareUrl = `${process.env.BETTER_AUTH_TRUSTED_ORIGIN ?? "http://localhost:3000"}/share/${token}`;
  return c.json({ shareToken: token, shareUrl });
});

// DELETE /sessions/:id/share — revoke share token
sessionsRouter.delete("/:id/share", async (c) => {
  const user = c.get("user") as User;
  const sessionId = c.req.param("id");

  const [updated] = await pgDb
    .update(appSessions)
    .set({ shareToken: null, updatedAt: new Date() })
    .where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, user.id)))
    .returning();

  if (!updated) return c.json({ error: "Session not found" }, 404);
  return c.json({ success: true });
});

// POST /sessions/connect — create a new live-DB session (no SQLite file)
sessionsRouter.post("/connect", async (c) => {
  const user = c.get("user") as User;
  const body = await c.req.json() as { connectionId: string; name?: string };
  const { connectionId, name } = body;

  if (!connectionId) return c.json({ error: "connectionId is required" }, 400);

  // Verify the connection belongs to this user
  const { dataConnections } = await import("../db/schema");
  const [conn] = await pgDb
    .select({ id: dataConnections.id, name: dataConnections.name, dbType: dataConnections.dbType })
    .from(dataConnections)
    .where(and(eq(dataConnections.id, connectionId), eq(dataConnections.userId, user.id)))
    .limit(1);

  if (!conn) return c.json({ error: "Connection not found" }, 404);

  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const [session] = await pgDb
    .insert(appSessions)
    .values({
      userId: user.id,
      name: name ?? `${conn.name} session`,
      sourceType: "database",
      connectionId,
      expiresAt,
    })
    .returning();

  if (!session) return c.json({ error: "Failed to create session" }, 500);
  return c.json({ sessionId: session.id, session }, 201);
});

// POST /sessions/:id/analyze — run AI schema analysis (works for both CSV and DB sessions)
sessionsRouter.post("/:id/analyze", async (c) => {
  const user = c.get("user") as User;
  const sessionId = c.req.param("id");

  const [appSession] = await pgDb
    .select()
    .from(appSessions)
    .where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, user.id)))
    .limit(1);

  if (!appSession) return c.json({ error: "Session not found" }, 404);

  const { analyzeData } = await import("../agents/dataAnalyst");

  if (appSession.sourceType === "database") {
    // ── Live DB session ──────────────────────────────────────────────────────
    if (!appSession.connectionId) return c.json({ error: "Connection not found" }, 400);

    const { dataConnections } = await import("../db/schema");
    const [conn] = await pgDb
      .select()
      .from(dataConnections)
      .where(eq(dataConnections.id, appSession.connectionId))
      .limit(1);

    if (!conn) return c.json({ error: "Connection record not found" }, 404);

    const { decryptPassword } = await import("../lib/crypto");
    const { getConnector } = await import("../db/connectors/index");
    const password = decryptPassword(conn.encryptedPassword);
    const connector = getConnector({
      id: conn.id,
      dbType: conn.dbType as "postgresql" | "mysql",
      host: conn.host,
      port: conn.port,
      dbName: conn.dbName,
      username: conn.username,
      password,
      sslMode: conn.sslMode ?? undefined,
    });

    const rawTables = await connector.readSchema();
    const tables = rawTables.map((t) => ({
      name: t.tableName,
      columns: t.columns.map((col) => ({ name: col.name, type: col.type })),
      rowCount: t.rowCount,
      sample: [] as Record<string, unknown>[],
    }));

    const understanding = await analyzeData(tables);

    // Persist understanding + embed tables — both non-blocking after response
    persistSessionUnderstanding(sessionId, understanding).catch(() => {});
    upsertTableEmbeddings(sessionId, tables).catch(() => {});

    return c.json({ understanding });
  } else {
    // ── CSV session ──────────────────────────────────────────────────────────
    if (!appSession.sqlitePath) return c.json({ error: "Session data not found" }, 400);

    const { existsSync } = await import("fs");
    if (!existsSync(appSession.sqlitePath)) return c.json({ error: "Session file not found" }, 404);

    const { Database } = await import("bun:sqlite");
    const { getSchema } = await import("../db/schemaReader");
    const db = new Database(appSession.sqlitePath);
    const tables = getSchema(db);
    db.close();

    if (!tables.length) return c.json({ error: "No tables found in session" }, 400);

    const understanding = await analyzeData(tables);

    // Persist understanding + embed tables — both non-blocking after response
    persistSessionUnderstanding(sessionId, understanding).catch(() => {});
    upsertTableEmbeddings(sessionId, tables).catch(() => {});

    return c.json({ understanding });
  }
});

