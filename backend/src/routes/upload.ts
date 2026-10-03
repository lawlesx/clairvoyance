import { Hono } from "hono";
import Papa from "papaparse";
import path from "path";
import { randomUUID } from "crypto";
import { createSession, setSessionCache, SESSIONS_DIR } from "../db/manager";
import { getSchema } from "../db/schemaReader";
import { inferForeignKeys } from "../db/schemaIndex";
import { hashContent } from "../db/understandingCache";
import { upsertTableEmbeddings } from "../db/tableEmbeddings";
import { startAnalysis } from "../db/analysisJobs";
import { db as pgDb } from "../db/pgClient";
import { appSessions } from "../db/schema";
import type { AppEnv } from "../types";

export const uploadRouter = new Hono<AppEnv>();

const ACCEPTED = /\.(csv|tsv|txt)$/i;

uploadRouter.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody({ all: true });
  const raw = body["files"];
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []) as File[];

  if (!files.length) return c.json({ error: "No files provided" }, 400);
  for (const file of files) {
    if (!ACCEPTED.test(file.name)) {
      return c.json({ error: `"${file.name}" isn't a CSV file. Export it from Excel or Google Sheets as CSV and try again.` }, 400);
    }
  }

  const sessionId = randomUUID();
  const db = createSession(sessionId);
  const fileContents: string[] = [];
  const usedNames = new Set<string>();

  for (const file of files) {
    const text = await file.text();
    fileContents.push(text);

    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: true,
      transformHeader: (h, i) => h.trim() || `column_${i + 1}`,
    });

    if (result.errors.length && result.data.length === 0) {
      return c.json({ error: `Couldn't read ${file.name}: ${result.errors[0]?.message ?? "unknown error"}` }, 400);
    }
    const rows = result.data;
    if (!rows.length || !rows[0]) return c.json({ error: `${file.name} has no rows` }, 400);

    let tableName = sanitizeTableName(file.name.replace(ACCEPTED, ""));
    while (usedNames.has(tableName)) tableName += "_2";
    usedNames.add(tableName);

    const columns = result.meta.fields ?? Object.keys(rows[0]);
    const columnDefs = columns.map((col) => `${quoteIdent(col)} ${inferSQLType(rows, col)}`).join(", ");

    db.run(`DROP TABLE IF EXISTS ${quoteIdent(tableName)}`);
    db.run(`CREATE TABLE ${quoteIdent(tableName)} (${columnDefs})`);

    const insert = db.prepare(
      `INSERT INTO ${quoteIdent(tableName)} (${columns.map(quoteIdent).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
    );
    const insertAll = db.transaction((all: Record<string, unknown>[]) => {
      for (const row of all) insert.run(...columns.map((col) => toSqlValue(row[col])));
    });
    insertAll(rows);
  }

  const schema = getSchema(db);
  setSessionCache(sessionId, schema);

  const sessionName = files[0]!.name.replace(ACCEPTED, "").replace(/[_-]+/g, " ").trim() || "Untitled data";
  await pgDb.insert(appSessions).values({
    id: sessionId,
    userId: user.id,
    name: files.length > 1 ? `${sessionName} + ${files.length - 1} more` : sessionName,
    sourceType: "csv",
    sqlitePath: path.join(SESSIONS_DIR, `${sessionId}.db`),
  });

  // Getting to know the data happens in the background; the session page picks it up.
  const source = { kind: "csv" as const, db, tables: inferForeignKeys(schema), dialect: "SQLite" as const };
  const contentHash = await hashContent(fileContents);
  startAnalysis(sessionId, source, { cacheKey: contentHash }).catch((e) =>
    console.warn("[upload] background analysis failed:", e)
  );
  upsertTableEmbeddings(sessionId, schema).catch(() => {});

  return c.json({ sessionId, tables: schema });
});

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sanitizeTableName(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return (/^\d/.test(cleaned) ? `t_${cleaned}` : cleaned) || "data";
}

function toSqlValue(v: unknown): string | number | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}

function inferSQLType(rows: Record<string, unknown>[], col: string): string {
  const samples = rows.slice(0, 500).map((r) => r[col]).filter((v) => v != null && v !== "");
  if (!samples.length) return "TEXT";
  if (samples.every((v) => typeof v === "number")) {
    return samples.every((v) => Number.isInteger(v)) ? "INTEGER" : "REAL";
  }
  if (samples.every((v) => typeof v === "boolean")) return "INTEGER";
  return "TEXT";
}
