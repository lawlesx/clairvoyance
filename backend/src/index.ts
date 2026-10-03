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
import { db as pgDb, pool } from "./db/pgClient";
import { appSessions, messages } from "./db/schema";

const app = new Hono();

/** Say clearly at startup if the metadata database is unreachable or not migrated. */
async function checkDatabase() {
  const where = (process.env.DATABASE_URL ?? "").replace(/\/\/([^:@/]+):[^@/]*@/, "//$1:***@");
  try {
    const { rows } = await pool.query<{ t: string | null }>(`SELECT to_regclass('public."user"')::text AS t`);
    if (!rows[0]?.t) {
      console.error(`\n⚠️  Connected to Postgres but Clairvoyance's tables don't exist yet.\n   Run: cd backend && bunx drizzle-kit migrate\n`);
    }
  } catch (e) {
    const code = (e as { code?: string }).code ?? (e as Error).message;
    console.error(
      `\n⚠️  Can't reach Postgres at ${where} (${code}). Sign-in and everything else will fail until it's running.\n` +
      `   • Using Docker: start Docker Desktop, then run \`docker compose up -d\` in the project root.\n` +
      `   • Using your own Postgres: point DATABASE_URL in backend/.env at it (it needs the pgvector extension).\n` +
      `   Then run: cd backend && bunx drizzle-kit migrate\n`
    );
  }
}
checkDatabase();

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
