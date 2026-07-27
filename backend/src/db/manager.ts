import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import type { TableSchema } from "./schemaReader";
import type { DataUnderstanding } from "../agents/dataAnalyst";

const SESSIONS_DIR = path.join(import.meta.dir, "../../sessions");
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

interface SessionEntry {
  db: Database;
  schema?: TableSchema[];
  understanding?: DataUnderstanding;
}

// In-memory registry: sessionId -> session entry
const sessions = new Map<string, SessionEntry>();

export function createSession(sessionId: string): Database {
  const dbPath = path.join(SESSIONS_DIR, `${sessionId}.db`);
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode=WAL");
  sessions.set(sessionId, { db });
  return db;
}

export function setSessionCache(
  sessionId: string,
  schema: TableSchema[],
  understanding: DataUnderstanding
): void {
  const entry = sessions.get(sessionId);
  if (entry) {
    entry.schema = schema;
    entry.understanding = understanding;
  }
}

export function getSession(sessionId: string): Database | null {
  const entry = sessions.get(sessionId);
  if (entry) return entry.db;

  // Reconnect if file exists (server restart) — schema/understanding not cached after restart
  const dbPath = path.join(SESSIONS_DIR, `${sessionId}.db`);
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath);
    db.run("PRAGMA journal_mode=WAL");
    sessions.set(sessionId, { db });
    return db;
  }

  return null;
}

export function getSessionEntry(sessionId: string): SessionEntry | null {
  if (sessions.has(sessionId)) return sessions.get(sessionId)!;

  // Reconnect if file exists (server restart)
  const dbPath = path.join(SESSIONS_DIR, `${sessionId}.db`);
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath);
    db.run("PRAGMA journal_mode=WAL");
    const entry: SessionEntry = { db };
    sessions.set(sessionId, entry);
    return entry;
  }

  return null;
}

export function requireSession(sessionId: string): Database {
  const db = getSession(sessionId);
  if (!db) throw new Error(`Session '${sessionId}' not found`);
  return db;
}

export function requireSessionEntry(sessionId: string): SessionEntry {
  const entry = getSessionEntry(sessionId);
  if (!entry) throw new Error(`Session '${sessionId}' not found`);
  return entry;
}
