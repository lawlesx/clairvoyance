import { Hono } from "hono";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import fs from "fs";
import { db as pgDb } from "../db/pgClient";
import { appSessions, messages, dataConnections } from "../db/schema";
import { getSessionUnderstanding } from "../db/understandingCache";
import { upsertTableEmbeddings } from "../db/tableEmbeddings";
import { startAnalysis } from "../db/analysisJobs";
import { getOwnedSession, loadDataSource, SourceError } from "../db/dataSource";
import { closeSession } from "../db/manager";
import type { AppEnv } from "../types";

export const sessionsRouter = new Hono<AppEnv>();

const listColumns = {
  id: appSessions.id,
  name: appSessions.name,
  tags: appSessions.tags,
  sourceType: appSessions.sourceType,
  shareToken: appSessions.shareToken,
  createdAt: appSessions.createdAt,
  updatedAt: appSessions.updatedAt,
  expiresAt: appSessions.expiresAt,
  domain: sql<string | null>`${appSessions.understanding}->>'domain'`,
  summary: sql<string | null>`${appSessions.understanding}->>'summary'`,
  questionCount: sql<number>`(SELECT COUNT(*)::int FROM ${messages} WHERE ${messages.sessionId} = ${appSessions.id} AND ${messages.role} = 'user')`,
};

// GET /sessions/search?q= — semantic search over message embeddings
sessionsRouter.get("/search", async (c) => {
  const user = c.get("user");
  const q = c.req.query("q");
  if (!q?.trim()) return c.json({ sessions: [] });
  if (!process.env.VOYAGE_API_KEY) return c.json({ sessions: [], error: "Semantic search not configured" });

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
      .select(listColumns)
      .from(appSessions)
      .where(and(eq(appSessions.userId, user.id), inArray(appSessions.id, sessionIds)));

    const ordered = sessionRows.sort((a, b) => sessionIds.indexOf(a.id) - sessionIds.indexOf(b.id));
    return c.json({ sessions: ordered });
  } catch (e: any) {
    return c.json({ sessions: [], error: e.message });
  }
});

// GET /sessions — list user's sessions
sessionsRouter.get("/", async (c) => {
  const user = c.get("user");
  const rows = await pgDb
    .select(listColumns)
    .from(appSessions)
    .where(eq(appSessions.userId, user.id))
    .orderBy(desc(appSessions.updatedAt));
  return c.json({ sessions: rows });
});

// POST /sessions/connect — create a new live-DB session and start getting to know it
sessionsRouter.post("/connect", async (c) => {
  const user = c.get("user");
  const { connectionId, name } = (await c.req.json().catch(() => ({}))) as { connectionId?: string; name?: string };
  if (!connectionId) return c.json({ error: "connectionId is required" }, 400);

  const [conn] = await pgDb
    .select({ id: dataConnections.id, name: dataConnections.name })
    .from(dataConnections)
    .where(and(eq(dataConnections.id, connectionId), eq(dataConnections.userId, user.id)))
    .limit(1);
  if (!conn) return c.json({ error: "Connection not found" }, 404);

  const [session] = await pgDb
    .insert(appSessions)
    .values({ userId: user.id, name: name?.trim() || conn.name, sourceType: "database", connectionId, expiresAt: null })
    .returning();
  if (!session) return c.json({ error: "Failed to create session" }, 500);

  // Warm up in the background: schema cache, table embeddings, plain-language overview.
  loadDataSource(session)
    .then((source) => {
      upsertTableEmbeddings(session.id, source.tables).catch(() => {});
      return startAnalysis(session.id, source);
    })
    .catch((e) => console.warn("[connect] background analysis failed:", e));

  return c.json({ sessionId: session.id, session }, 201);
});

// GET /sessions/:id — session with messages and (if ready) its understanding
sessionsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("id");
  const appSession = await getOwnedSession(sessionId, user.id);
  if (!appSession) return c.json({ error: "Session not found" }, 404);

  const msgs = await pgDb
    .select({ id: messages.id, role: messages.role, content: messages.content, createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt);

  const understanding = await getSessionUnderstanding(sessionId);
  const { understanding: _raw, sqlitePath: _path, ...session } = appSession;
  return c.json({ session, messages: msgs, understanding });
});

// GET /sessions/:id/tables — tables in the session's data (may take a moment for big databases)
sessionsRouter.get("/:id/tables", async (c) => {
  const user = c.get("user");
  const appSession = await getOwnedSession(c.req.param("id"), user.id);
  if (!appSession) return c.json({ error: "Session not found" }, 404);
  try {
    const source = await loadDataSource(appSession);
    return c.json({
      tables: source.tables.map((t) => ({ name: t.name, columns: t.columns, rowCount: t.rowCount })),
    });
  } catch (e) {
    const status = e instanceof SourceError ? e.status : 502;
    return c.json({ error: (e as Error).message }, status);
  }
});

// POST /sessions/:id/analyze — get (or wait for) the plain-language overview of the data
sessionsRouter.post("/:id/analyze", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("id");
  const appSession = await getOwnedSession(sessionId, user.id);
  if (!appSession) return c.json({ error: "Session not found" }, 404);

  const existing = await getSessionUnderstanding(sessionId);
  if (existing && c.req.query("refresh") !== "1") return c.json({ understanding: existing });

  try {
    const source = await loadDataSource(appSession);
    if (!source.tables.length) return c.json({ error: "No tables found in this data" }, 400);
    const understanding = await startAnalysis(sessionId, source);
    return c.json({ understanding });
  } catch (e) {
    const status = e instanceof SourceError ? e.status : 500;
    console.warn("[analyze] failed:", e);
    return c.json({ error: e instanceof SourceError ? e.message : "Couldn't analyse this data. Please try again." }, status);
  }
});

// PATCH /sessions/:id — update name and/or tags
sessionsRouter.patch("/:id", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; tags?: string[] };

  const updates: Partial<typeof appSessions.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim().slice(0, 200);
  if (Array.isArray(body.tags)) updates.tags = body.tags.map(String).slice(0, 20);

  const [updated] = await pgDb
    .update(appSessions)
    .set(updates)
    .where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, user.id)))
    .returning({ id: appSessions.id, name: appSessions.name, tags: appSessions.tags });
  if (!updated) return c.json({ error: "Session not found" }, 404);
  return c.json({ session: updated });
});

// DELETE /sessions/:id — hard delete with SQLite file cleanup
sessionsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("id");

  const [deleted] = await pgDb
    .delete(appSessions)
    .where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, user.id)))
    .returning();
  if (!deleted) return c.json({ error: "Session not found" }, 404);

  if (deleted.sqlitePath) {
    closeSession(sessionId);
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.rmSync(deleted.sqlitePath + suffix, { force: true }); } catch { /* non-fatal */ }
    }
  }
  return c.json({ success: true });
});

// POST /sessions/:id/share — generate share token
sessionsRouter.post("/:id/share", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("id");
  const existing = await getOwnedSession(sessionId, user.id);
  if (!existing) return c.json({ error: "Session not found" }, 404);

  const token = existing.shareToken ?? nanoid(24);
  if (!existing.shareToken) {
    await pgDb.update(appSessions).set({ shareToken: token }).where(eq(appSessions.id, sessionId));
  }
  const shareUrl = `${process.env.BETTER_AUTH_TRUSTED_ORIGIN ?? "http://localhost:3000"}/share/${token}`;
  return c.json({ shareToken: token, shareUrl });
});

// DELETE /sessions/:id/share — revoke share token
sessionsRouter.delete("/:id/share", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("id");
  const [updated] = await pgDb
    .update(appSessions)
    .set({ shareToken: null })
    .where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, user.id)))
    .returning({ id: appSessions.id });
  if (!updated) return c.json({ error: "Session not found" }, 404);
  return c.json({ success: true });
});
