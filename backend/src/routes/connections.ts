import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db as pgDb } from "../db/pgClient";
import { dataConnections } from "../db/schema";
import { encryptPassword } from "../lib/crypto";
import { getConnector, removeConnector } from "../db/connectors/index";
import type { User } from "../db/schema";
import type { AppEnv } from "../types";

export const connectionsRouter = new Hono<AppEnv>();

// GET /connections — list user's connections (no plaintext passwords)
connectionsRouter.get("/", async (c) => {
  const user = c.get("user") as User;
  const rows = await pgDb
    .select({
      id: dataConnections.id,
      name: dataConnections.name,
      dbType: dataConnections.dbType,
      host: dataConnections.host,
      port: dataConnections.port,
      dbName: dataConnections.dbName,
      username: dataConnections.username,
      sslMode: dataConnections.sslMode,
      createdAt: dataConnections.createdAt,
    })
    .from(dataConnections)
    .where(eq(dataConnections.userId, user.id));

  return c.json(rows);
});

// POST /connections — create a new connection (test + encrypt password)
connectionsRouter.post("/", async (c) => {
  const user = c.get("user") as User;
  const body = await c.req.json() as {
    name: string;
    dbType: "postgresql" | "mysql";
    host: string;
    port: number;
    dbName: string;
    username: string;
    password: string;
    sslMode?: string;
  };

  const { name, dbType, host, port, dbName, username, password, sslMode } = body;
  if (!name || !dbType || !host || !port || !dbName || !username || !password) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  // Test connection before saving
  const tempConnector = getConnector({
    id: `test-${Date.now()}`,
    dbType,
    host,
    port,
    dbName,
    username,
    password,
    sslMode,
  });
  try {
    await tempConnector.testConnection();
    await tempConnector.close();
  } catch (e: any) {
    return c.json({ error: `Connection test failed: ${e.message}` }, 422);
  }

  let encryptedPwd: string;
  try {
    encryptedPwd = encryptPassword(password);
  } catch (e: any) {
    return c.json({ error: `Encryption failed: ${e.message}` }, 500);
  }

  const [conn] = await pgDb
    .insert(dataConnections)
    .values({
      userId: user.id,
      name,
      dbType,
      host,
      port,
      dbName,
      username,
      encryptedPassword: encryptedPwd,
      sslMode,
    })
    .returning();

  if (!conn) return c.json({ error: "Failed to create connection" }, 500);

  return c.json({
    id: conn.id,
    name: conn.name,
    dbType: conn.dbType,
    host: conn.host,
    port: conn.port,
    dbName: conn.dbName,
    username: conn.username,
    sslMode: conn.sslMode,
    createdAt: conn.createdAt,
  }, 201);
});

// GET /connections/:id/schema — preview tables in the connected DB
connectionsRouter.get("/:id/schema", async (c) => {
  const user = c.get("user") as User;
  const id = c.req.param("id");

  const [conn] = await pgDb
    .select()
    .from(dataConnections)
    .where(and(eq(dataConnections.id, id), eq(dataConnections.userId, user.id)))
    .limit(1);

  if (!conn) return c.json({ error: "Connection not found" }, 404);

  const { decryptPassword } = await import("../lib/crypto");
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

  try {
    const tables = await connector.readSchema();
    return c.json({ tables, tableCount: tables.length });
  } catch (e: any) {
    return c.json({ error: e.message }, 422);
  }
});


connectionsRouter.post("/:id/test", async (c) => {
  const user = c.get("user") as User;
  const id = c.req.param("id");

  const [conn] = await pgDb
    .select()
    .from(dataConnections)
    .where(and(eq(dataConnections.id, id), eq(dataConnections.userId, user.id)))
    .limit(1);

  if (!conn) return c.json({ error: "Connection not found" }, 404);

  const { decryptPassword } = await import("../lib/crypto");
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

  try {
    await connector.testConnection();
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ ok: false, error: e.message });
  }
});

// DELETE /connections/:id
connectionsRouter.delete("/:id", async (c) => {
  const user = c.get("user") as User;
  const id = c.req.param("id");

  const [conn] = await pgDb
    .select({ id: dataConnections.id })
    .from(dataConnections)
    .where(and(eq(dataConnections.id, id), eq(dataConnections.userId, user.id)))
    .limit(1);

  if (!conn) return c.json({ error: "Connection not found" }, 404);

  await removeConnector(id);
  await pgDb.delete(dataConnections).where(eq(dataConnections.id, id));

  return c.json({ ok: true });
});
