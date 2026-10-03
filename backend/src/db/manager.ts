import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import type { TableSchema } from "./schemaReader";

/** Uploaded files are stored as one SQLite database per session. */
export const SESSIONS_DIR = path.join(import.meta.dir, "../../sessions");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

interface SessionEntry {
  db: Database;
  schema?: TableSchema[];
}

// In-memory registry: sessionId -> open database + cached schema
const sessions = new Map<string, SessionEntry>();

function open(dbPath: string): Database {
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode=WAL");
  return db;
}

export function createSession(sessionId: string): Database {
  const db = open(path.join(SESSIONS_DIR, `${sessionId}.db`));
  sessions.set(sessionId, { db });
  return db;
}

export function setSessionCache(sessionId: string, schema: TableSchema[]): void {
  const entry = sessions.get(sessionId);
  if (entry) entry.schema = schema;
}

/** Open (or reopen after a restart) the SQLite database for a CSV session. */
export function getSessionEntry(sessionId: string): SessionEntry | null {
  const existing = sessions.get(sessionId);
  if (existing) return existing;

  const dbPath = path.join(SESSIONS_DIR, `${sessionId}.db`);
  if (!fs.existsSync(dbPath)) return null;
  const entry: SessionEntry = { db: open(dbPath) };
  sessions.set(sessionId, entry);
  return entry;
}

/** Close and forget a session's database (before deleting its file). */
export function closeSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (entry) {
    try { entry.db.close(); } catch { /* already closed */ }
    sessions.delete(sessionId);
  }
}
