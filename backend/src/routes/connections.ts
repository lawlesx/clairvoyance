import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { db as pgDb } from "../db/pgClient";
import { dataConnections } from "../db/schema";
import { encryptPassword } from "../lib/crypto";
import { connectorForRecord, createTemporaryConnector, removeConnector, type DbType } from "../db/connectors/index";
import type { AppEnv } from "../types";

export const connectionsRouter = new Hono<AppEnv>();

const publicColumns = {
  id: dataConnections.id,
  name: dataConnections.name,
  dbType: dataConnections.dbType,
  host: dataConnections.host,
  port: dataConnections.port,
  dbName: dataConnections.dbName,
  username: dataConnections.username,
  sslMode: dataConnections.sslMode,
  createdAt: dataConnections.createdAt,
};

async function ownedConnection(id: string, userId: string) {
  const [conn] = await pgDb
    .select()
    .from(dataConnections)
    .where(and(eq(dataConnections.id, id), eq(dataConnections.userId, userId)))
    .limit(1);
  return conn ?? null;
}

/** Turn driver errors into something a non-DBA can act on. */
function explainConnectionError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) return "Couldn't find that server. Check the host name.";
  if (/ECONNREFUSED/i.test(msg)) return "The server refused the connection. Check the host and port, and that the database accepts outside connections.";
  if (/timeout|ETIMEDOUT/i.test(msg)) return "The connection timed out. The database may be behind a firewall or VPN.";
  if (/password authentication failed|Access denied/i.test(msg)) return "The username or password was rejected.";
  if (/does not exist|Unknown database/i.test(msg)) return "That database name doesn't exist on this server.";
  if (/SSL|TLS|no pg_hba.conf entry.*SSL off/i.test(msg)) return "The server requires a secure (SSL) connection. Turn on 'Require SSL' and try again.";
  return `Couldn't connect: ${msg}`;
}

// GET /connections — list user's connections (no passwords)
connectionsRouter.get("/", async (c) => {
  const user = c.get("user");
  const rows = await pgDb
    .select(publicColumns)
    .from(dataConnections)
    .where(eq(dataConnections.userId, user.id))
    .orderBy(desc(dataConnections.createdAt));
  return c.json(rows);
});

// POST /connections — test the credentials, then save them (password encrypted)
connectionsRouter.post("/", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string; dbType?: DbType; host?: string; port?: number | string;
    dbName?: string; username?: string; password?: string; sslMode?: string;
  };

  const dbType: DbType | null = body.dbType === "mysql" ? "mysql" : body.dbType === "postgresql" ? "postgresql" : null;
  const port = Number(body.port) || (dbType === "mysql" ? 3306 : 5432);
  const { host, dbName, username, password = "", sslMode } = body;
  if (!dbType || !host || !dbName || !username) {
    return c.json({ error: "Please fill in the database type, host, database name and username." }, 400);
  }

  const temp = createTemporaryConnector({ dbType, host, port, dbName, username, password, sslMode });
  try {
    await temp.testConnection();
  } catch (e) {
    return c.json({ error: explainConnectionError(e) }, 422);
  } finally {
    await temp.close().catch(() => {});
  }

  let encryptedPassword: string;
  try {
    encryptedPassword = encryptPassword(password);
  } catch (e: any) {
    return c.json({ error: `Server can't store credentials securely: ${e.message}. Set CREDENTIAL_ENCRYPTION_KEY.` }, 500);
  }

  // Re-use the existing record when the same database is connected again.
  const [existing] = await pgDb
    .select({ id: dataConnections.id })
    .from(dataConnections)
    .where(and(
      eq(dataConnections.userId, user.id), eq(dataConnections.host, host), eq(dataConnections.port, port),
      eq(dataConnections.dbName, dbName), eq(dataConnections.username, username),
    ))
    .limit(1);

  const values = {
    userId: user.id, name: body.name?.trim() || dbName, dbType, host, port, dbName, username, encryptedPassword,
    sslMode: sslMode || "prefer",
  };
  const [conn] = existing
    ? await pgDb.update(dataConnections).set(values).where(eq(dataConnections.id, existing.id)).returning(publicColumns)
    : await pgDb.insert(dataConnections).values(values).returning(publicColumns);
  if (!conn) return c.json({ error: "Failed to save connection" }, 500);
  if (existing) await removeConnector(existing.id); // drop the pool built with the old credentials

  return c.json(conn, existing ? 200 : 201);
});

// GET /connections/:id/schema — preview tables in the connected DB
connectionsRouter.get("/:id/schema", async (c) => {
  const user = c.get("user");
  const conn = await ownedConnection(c.req.param("id"), user.id);
  if (!conn) return c.json({ error: "Connection not found" }, 404);

  try {
    const tables = await connectorForRecord(conn).readSchema();
    return c.json({
      tables: tables.map((t) => ({ name: t.name, columns: t.columns, rowCount: t.rowCount })),
      tableCount: tables.length,
    });
  } catch (e) {
    return c.json({ error: explainConnectionError(e) }, 422);
  }
});

connectionsRouter.post("/:id/test", async (c) => {
  const user = c.get("user");
  const conn = await ownedConnection(c.req.param("id"), user.id);
  if (!conn) return c.json({ error: "Connection not found" }, 404);
  try {
    await connectorForRecord(conn).testConnection();
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ ok: false, error: explainConnectionError(e) });
  }
});

// DELETE /connections/:id
connectionsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const conn = await ownedConnection(c.req.param("id"), user.id);
  if (!conn) return c.json({ error: "Connection not found" }, 404);
  await removeConnector(conn.id);
  await pgDb.delete(dataConnections).where(eq(dataConnections.id, conn.id));
  return c.json({ ok: true });
});
