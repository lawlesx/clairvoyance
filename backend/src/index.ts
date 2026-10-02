import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { eq } from "drizzle-orm";
import { uploadRouter } from "./routes/upload";
import { queryRouter } from "./routes/query";
import { sessionsRouter } from "./routes/sessions";
import { connectionsRouter } from "./routes/connections";
import { auth } from "./lib/auth";
import { authMiddleware } from "./middleware/auth";
import { db as pgDb } from "./db/pgClient";
import { appSessions, messages } from "./db/schema";

const app = new Hono();

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

app.use(
  "*",
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);
app.use("*", logger());

// Better Auth handler — public, must be mounted before auth middleware
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

// Public health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Public share route — read-only, no auth required
app.get("/share/:token", async (c) => {
  const token = c.req.param("token");

  const [appSession] = await pgDb
    .select()
    .from(appSessions)
    .where(eq(appSessions.shareToken, token))
    .limit(1);

  if (!appSession) return c.json({ error: "Share link not found or revoked" }, 404);

  const msgs = await pgDb
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.sessionId, appSession.id))
    .orderBy(messages.createdAt);

  return c.json({
    session: {
      id: appSession.id,
      name: appSession.name,
      tags: appSession.tags,
      sourceType: appSession.sourceType,
      createdAt: appSession.createdAt,
    },
    messages: msgs,
  });
});

// Auth guard — applies to all routes below this line
app.use("*", authMiddleware);

app.route("/upload", uploadRouter);
app.route("/query", queryRouter);
app.route("/sessions", sessionsRouter);
app.route("/connections", connectionsRouter);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

const port = parseInt(process.env.PORT ?? "3001");
console.log(`🚀 Clairvoyance backend running on http://localhost:${port}`);

// 255s is Bun's maximum; overview analysis of very large databases can take a while.
export default { port, idleTimeout: 255, fetch: app.fetch };
