import { sql } from "drizzle-orm";
import { db as pgDb } from "./pgClient";
import { tableEmbeddings } from "./schema";
import { embedBatch } from "../lib/embeddings";
import type { TableSchema } from "./schemaReader";

/**
 * Per-table vector embeddings (pgvector) so that, in a database with hundreds of
 * tables, a question like "which marketing channel brings the best customers?"
 * finds `ad_campaigns` + `customers` even though no words match exactly.
 */

const EMBED_CHUNK = 128;
const inFlight = new Map<string, Promise<void>>();

/** "tableName: col1, col2, … | joins: other_table | N rows" — the embedding input. */
function tableToSchemaText(table: TableSchema): string {
  const cols = table.columns.map((c) => c.name).join(", ");
  const joins = (table.foreignKeys ?? []).map((fk) => fk.refTable);
  const joinText = joins.length ? ` | joins: ${[...new Set(joins)].join(", ")}` : "";
  return `${table.name}: ${cols}${joinText} | ${table.rowCount} rows`;
}

/**
 * Embed all tables for a session and upsert into table_embeddings.
 * Non-fatal — silently skips if VOYAGE_API_KEY is not set.
 */
export async function upsertTableEmbeddings(sessionId: string, tables: TableSchema[]): Promise<void> {
  if (!process.env.VOYAGE_API_KEY || tables.length === 0) return;

  try {
    for (let i = 0; i < tables.length; i += EMBED_CHUNK) {
      const chunk = tables.slice(i, i + EMBED_CHUNK);
      const texts = chunk.map(tableToSchemaText);
      const embeddings = await embedBatch(texts);
      const rows = chunk
        .map((t, j) => ({
          sessionId,
          tableName: t.name,
          schemaText: texts[j]!,
          embedding: embeddings[j]!,
          rowCount: Math.min(t.rowCount, 2_147_483_647),
        }))
        .filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0);
      if (!rows.length) continue;

      await pgDb
        .insert(tableEmbeddings)
        .values(rows)
        .onConflictDoUpdate({
          target: [tableEmbeddings.sessionId, tableEmbeddings.tableName],
          set: {
            schemaText: sql`excluded.schema_text`,
            embedding: sql`excluded.embedding`,
            rowCount: sql`excluded.row_count`,
          },
        });
    }
  } catch (e) {
    console.warn("[tableEmbeddings] upsert failed (falling back to keyword search):", e);
  }
}

/**
 * Make sure a session has table embeddings, building them in the background if not.
 * Safe to call on every question — it's a cheap COUNT and de-duplicated per session.
 */
export async function ensureTableEmbeddings(sessionId: string, tables: TableSchema[]): Promise<void> {
  if (!process.env.VOYAGE_API_KEY || tables.length === 0 || inFlight.has(sessionId)) return;
  try {
    const res = await pgDb.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM table_embeddings WHERE session_id = ${sessionId}::uuid
    `);
    if ((res.rows[0]?.n ?? 0) >= tables.length * 0.9) return;
  } catch {
    return;
  }
  const job = upsertTableEmbeddings(sessionId, tables).finally(() => inFlight.delete(sessionId));
  inFlight.set(sessionId, job);
}

/**
 * Find the most semantically relevant tables for a query using cosine similarity.
 * Returns [] if no embeddings exist yet or Voyage is unavailable.
 */
export async function searchTablesByEmbedding(
  sessionId: string,
  queryText: string,
  limit: number,
  allTables: TableSchema[]
): Promise<TableSchema[]> {
  if (!process.env.VOYAGE_API_KEY || allTables.length === 0) return [];

  try {
    const [queryEmbedding] = await embedBatch([queryText]);
    if (!queryEmbedding?.length) return [];
    const vectorLiteral = `[${queryEmbedding.join(",")}]`;

    const rows = await pgDb.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM table_embeddings
      WHERE session_id = ${sessionId}::uuid
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `);

    const tableMap = new Map(allTables.map((t) => [t.name, t]));
    return rows.rows
      .map((r) => tableMap.get(r.table_name))
      .filter((t): t is TableSchema => t !== undefined);
  } catch {
    return [];
  }
}
