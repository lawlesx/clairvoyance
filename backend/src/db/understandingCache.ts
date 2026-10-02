import { eq } from "drizzle-orm";
import { db as pgDb } from "./pgClient";
import { understandingEmbeddings, appSessions } from "./schema";
import type { DataUnderstanding } from "../agents/dataAnalyst";

/**
 * Exact-match cache for dataset understandings, keyed by a content hash (CSV) or a
 * schema fingerprint (live database). Re-uploading the same file or reconnecting
 * the same database is instant and costs nothing.
 *
 * (An earlier version also reused understandings of merely *similar* schemas via
 * vector similarity. That could show one dataset's summary for a different dataset
 * with similar column names, so it was removed.)
 */

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

function isCurrentShape(u: unknown): u is DataUnderstanding {
  const x = u as DataUnderstanding | null;
  // Entries written before the plain-language rewrite have no `areas`; regenerate those.
  return !!x && typeof x.summary === "string" && Array.isArray(x.suggestedQuestions) && Array.isArray(x.areas);
}

export async function getCachedUnderstanding(hash: string): Promise<DataUnderstanding | null> {
  const [row] = await pgDb
    .select({ understanding: understandingEmbeddings.understanding })
    .from(understandingEmbeddings)
    .where(eq(understandingEmbeddings.contentHash, hash))
    .limit(1)
    .catch(() => [null]);

  return row && isCurrentShape(row.understanding) ? row.understanding : null;
}

export async function setCachedUnderstanding(
  hash: string,
  understanding: DataUnderstanding,
  schemaText = ""
): Promise<void> {
  await pgDb
    .insert(understandingEmbeddings)
    .values({ contentHash: hash, understanding, schemaText })
    .onConflictDoUpdate({
      target: understandingEmbeddings.contentHash,
      set: { understanding, schemaText },
    })
    .catch((e) => console.warn("Failed to cache understanding:", e));
}

/** Read the understanding persisted on a session (survives restarts). */
export async function getSessionUnderstanding(sessionId: string): Promise<DataUnderstanding | null> {
  const [row] = await pgDb
    .select({ understanding: appSessions.understanding })
    .from(appSessions)
    .where(eq(appSessions.id, sessionId))
    .limit(1)
    .catch(() => [null]);
  return row && isCurrentShape(row.understanding) ? row.understanding : null;
}

export async function persistSessionUnderstanding(sessionId: string, understanding: DataUnderstanding): Promise<void> {
  await pgDb
    .update(appSessions)
    .set({ understanding })
    .where(eq(appSessions.id, sessionId))
    .catch((e) => console.warn("Failed to persist session understanding:", e));
}
