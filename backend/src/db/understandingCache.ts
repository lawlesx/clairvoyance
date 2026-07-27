import { Database } from "bun:sqlite";
import { eq, sql } from "drizzle-orm";
import { db as pgDb } from "./pgClient";
import { understandingEmbeddings, appSessions } from "./schema";
import { embedText } from "../lib/embeddings";
import type { DataUnderstanding } from "../agents/dataAnalyst";

const SIMILARITY_THRESHOLD = 0.92;

export async function hashContent(contents: string[]): Promise<string> {
  const perFileHashes = await Promise.all(
    contents.map(async (c) => {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(c));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    })
  );
  const combined = perFileHashes.sort().join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(combined));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getCachedUnderstanding(hash: string): Promise<DataUnderstanding | null> {
  // 1. Exact hash hit
  const [row] = await pgDb
    .select({ understanding: understandingEmbeddings.understanding })
    .from(understandingEmbeddings)
    .where(eq(understandingEmbeddings.contentHash, hash))
    .limit(1)
    .catch(() => [null]);

  if (row) return row.understanding as DataUnderstanding;

  // 2. Semantic similarity fallback — only if VOYAGE_API_KEY is set
  if (!process.env.VOYAGE_API_KEY) return null;
  return null; // Will be filled on next setCachedUnderstanding call with embedding
}

export async function setSimilarUnderstanding(schemaText: string): Promise<DataUnderstanding | null> {
  if (!process.env.VOYAGE_API_KEY) return null;
  try {
    const embedding = await embedText(schemaText);
    const vectorLiteral = `[${embedding.join(",")}]`;

    const rows = await pgDb.execute<{ understanding: unknown; similarity: number }>(sql`
      SELECT understanding, 1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM understanding_embeddings
      WHERE embedding IS NOT NULL
        AND 1 - (embedding <=> ${vectorLiteral}::vector) >= ${SIMILARITY_THRESHOLD}
      ORDER BY similarity DESC
      LIMIT 1
    `);

    if (rows.rows.length > 0) {
      return rows.rows[0]!.understanding as DataUnderstanding;
    }
  } catch {
    // Non-fatal — fallback returns null
  }
  return null;
}

export async function setCachedUnderstanding(
  hash: string,
  understanding: DataUnderstanding,
  schemaText: string = ""
): Promise<void> {
  let embedding: number[] | null = null;
  if (process.env.VOYAGE_API_KEY && schemaText) {
    try {
      embedding = await embedText(schemaText);
    } catch {
      // Non-fatal
    }
  }

  await pgDb
    .insert(understandingEmbeddings)
    .values({
      contentHash: hash,
      understanding,
      schemaText,
      embedding: embedding ?? undefined,
    })
    .onConflictDoUpdate({
      target: understandingEmbeddings.contentHash,
      set: {
        understanding,
        schemaText,
        embedding: embedding ?? undefined,
      },
    })
    .catch((e) => console.warn("Failed to cache understanding:", e));
}

// Store only the hash reference in the session DB
export function storeSessionUnderstandingHash(sessionDb: Database, hash: string): void {
  sessionDb.run(`
    CREATE TABLE IF NOT EXISTS _session_meta (key TEXT PRIMARY KEY, value TEXT)
  `);
  sessionDb.run(
    "INSERT OR REPLACE INTO _session_meta (key, value) VALUES ('understanding_hash', ?)",
    [hash]
  );
}

/**
 * Read the DataUnderstanding for a session directly from app_sessions.understanding in Postgres.
 * This replaces the old broken sync SQLite hash lookup.
 */
export async function getSessionUnderstanding(sessionId: string): Promise<DataUnderstanding | null> {
  try {
    const [row] = await pgDb
      .select({ understanding: appSessions.understanding })
      .from(appSessions)
      .where(eq(appSessions.id, sessionId))
      .limit(1)
      .catch(() => [null]);

    if (row?.understanding) return row.understanding as DataUnderstanding;
  } catch {
    // Non-fatal
  }
  return null;
}

/**
 * Persist understanding into app_sessions so it survives restarts.
 * Call this after analyzeData resolves, alongside setCachedUnderstanding.
 */
export async function persistSessionUnderstanding(
  sessionId: string,
  understanding: DataUnderstanding
): Promise<void> {
  await pgDb
    .update(appSessions)
    .set({ understanding })
    .where(eq(appSessions.id, sessionId))
    .catch((e) => console.warn("Failed to persist session understanding:", e));
}
