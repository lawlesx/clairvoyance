import { Hono } from "hono";
import Papa from "papaparse";
import { createSession, setSessionCache } from "../db/manager";
import { getSchema } from "../db/schemaReader";
import { analyzeData } from "../agents/dataAnalyst";
import { hashContent, getCachedUnderstanding, setCachedUnderstanding, storeSessionUnderstandingHash, persistSessionUnderstanding } from "../db/understandingCache";
import { upsertTableEmbeddings } from "../db/tableEmbeddings";
import { randomUUID } from "crypto";
import { db as pgDb } from "../db/pgClient";
import { appSessions } from "../db/schema";
import path from "path";
import type { AppEnv } from "../types";

const SESSIONS_DIR = path.join(import.meta.dir, "../../sessions");

export const uploadRouter = new Hono<AppEnv>();

uploadRouter.post("/", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = body["files"];
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []) as File[];

  if (!files.length) {
    return c.json({ error: "No files provided" }, 400);
  }

  const sessionId = randomUUID();
  const db = createSession(sessionId);
  const loadedTables: string[] = [];
  const fileContents: string[] = [];

  for (const file of files) {
    if (!file.name.endsWith(".csv")) {
      return c.json({ error: `Only CSV files are supported. Got: ${file.name}` }, 400);
    }

    const text = await file.text();
    fileContents.push(text);

    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
    });

    if (result.errors.length && result.data.length === 0) {
      return c.json({ error: `Failed to parse ${file.name}: ${result.errors[0]?.message ?? "unknown error"}` }, 400);
    }

    const tableName = sanitizeTableName(file.name.replace(/\.csv$/i, ""));
    const rows = result.data;

    if (!rows.length) {
      return c.json({ error: `File ${file.name} is empty` }, 400);
    }

    const firstRow = rows[0];
    if (!firstRow) {
      return c.json({ error: `File ${file.name} is empty` }, 400);
    }
    const columns = Object.keys(firstRow);
    const columnDefs = columns.map((col) => {
      const type = inferSQLType(rows, col);
      return `'${sanitizeCol(col)}' ${type}`;
    }).join(", ");

    db.run(`DROP TABLE IF EXISTS '${tableName}'`);
    db.run(`CREATE TABLE '${tableName}' (${columnDefs})`);

    const placeholders = columns.map(() => "?").join(", ");
    const colNames = columns.map((col) => `'${sanitizeCol(col)}'`).join(", ");
    const insert = db.prepare(`INSERT INTO '${tableName}' (${colNames}) VALUES (${placeholders})`);

    db.run("BEGIN");
    for (const row of rows) {
      const values = columns.map((col) => row[col] ?? null);
      insert.run(...values);
    }
    db.run("COMMIT");

    loadedTables.push(tableName);
  }

  const schema = getSchema(db);
  const schemaText = schema.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(",")})`).join(";");

  const contentHash = await hashContent(fileContents);
  let understanding = await getCachedUnderstanding(contentHash);
  let fromCache = !!understanding;

  if (!understanding) {
    // Try semantic similarity before running the full analyst
    const { setSimilarUnderstanding } = await import("../db/understandingCache");
    understanding = await setSimilarUnderstanding(schemaText);
    if (understanding) {
      fromCache = true;
    } else {
      fromCache = false;
      understanding = await analyzeData(schema);
    }
    await setCachedUnderstanding(contentHash, understanding, schemaText);
  }

  storeSessionUnderstandingHash(db, contentHash);
  setSessionCache(sessionId, schema, understanding);

  // Persist app_session metadata to Postgres
  const user = c.get("user") as { id: string } | undefined;
  if (user) {
    const sqlitePath = path.join(SESSIONS_DIR, `${sessionId}.db`);
    const sessionName = files[0]!.name.replace(/\.csv$/i, "");
    await pgDb.insert(appSessions).values({
      id: sessionId,
      userId: user.id,
      name: sessionName,
      sourceType: "csv",
      sqlitePath,
      understanding,
    });

    // Embed all table schemas for semantic table selection — non-blocking
    upsertTableEmbeddings(sessionId, schema).catch(() => {});
  }

  return c.json({
    sessionId,
    tables: schema,
    understanding,
    fromCache,
    message: `Loaded ${loadedTables.length} table(s): ${loadedTables.join(", ")}`,
  });
});

function sanitizeTableName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
}

function sanitizeCol(name: string): string {
  return name.replace(/'/g, "''");
}

function inferSQLType(rows: Record<string, unknown>[], col: string): string {
  const samples = rows.slice(0, 100).map((r) => r[col]).filter((v) => v != null);
  if (!samples.length) return "TEXT";

  const allNumeric = samples.every((v) => typeof v === "number" || (typeof v === "string" && !isNaN(Number(v))));
  if (allNumeric) {
    const allInt = samples.every((v) => Number.isInteger(Number(v)));
    return allInt ? "INTEGER" : "REAL";
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}/;
  const allDates = samples.every((v) => typeof v === "string" && datePattern.test(v));
  if (allDates) return "TEXT";

  return "TEXT";
}
