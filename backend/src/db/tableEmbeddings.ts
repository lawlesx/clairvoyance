import { sql, eq } from "drizzle-orm";
import { db as pgDb } from "./pgClient";
import { tableEmbeddings } from "./schema";
import { embedBatch } from "../lib/embeddings";
import type { TableSchema } from "./schemaReader";

/**
 * Build a rich schema text for a single table — used as the embedding input.
 * Format: "tableName: col1 (TYPE), col2 (TYPE), ... | N rows"
 */
function tableToSchemaText(table: TableSchema): string {
  const cols = table.columns.map((c) => `${c.name} (${c.type || "TEXT"})`).join(", ");
  return `${table.name}: ${cols} | ${table.rowCount} rows`;
}

/**
 * Embed all tables for a session and upsert into table_embeddings.
 * Uses embedBatch for a single Voyage round-trip regardless of table count.
 * Non-fatal — silently skips if VOYAGE_API_KEY is not set.
 */
export async function upsertTableEmbeddings(
  sessionId: string,
  tables: TableSchema[]
): Promise<void> {
  if (!process.env.VOYAGE_API_KEY || tables.length === 0) return;

  try {
    const schemaTexts = tables.map(tableToSchemaText);
    const embeddings = await embedBatch(schemaTexts);

    const rows = tables.map((t, i) => ({
      sessionId,
      tableName: t.name,
      schemaText: schemaTexts[i]!,
      embedding: embeddings[i]!,
      rowCount: t.rowCount,
    }));

    // Upsert in a single statement — ON CONFLICT updates embedding + schemaText
    for (const row of rows) {
      await pgDb
        .insert(tableEmbeddings)
        .values(row)
        .onConflictDoUpdate({
          target: [tableEmbeddings.sessionId, tableEmbeddings.tableName],
          set: {
            schemaText: row.schemaText,
            embedding: row.embedding,
            rowCount: row.rowCount,
          },
        })
        .catch(() => {/* non-fatal per row */});
    }
  } catch {
    // Non-fatal — schema selection degrades to keyword fallback
  }
}

/**
 * Find the most semantically relevant tables for a query using cosine similarity.
 * Returns up to `limit` TableSchema objects ordered by similarity descending.
 * Falls back to an empty array if no embeddings exist or Voyage is unavailable.
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
    if (!queryEmbedding) return [];

    const vectorLiteral = `[${queryEmbedding.join(",")}]`;

    const rows = await pgDb.execute<{ table_name: string; similarity: number }>(sql`
      SELECT table_name,
             1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM table_embeddings
      WHERE session_id = ${sessionId}::uuid
      ORDER BY similarity DESC
      LIMIT ${limit}
    `);

    if (!rows.rows.length) return [];

    // Map back to TableSchema objects in similarity order
    const tableMap = new Map(allTables.map((t) => [t.name, t]));
    return rows.rows
      .map((r) => tableMap.get(r.table_name))
      .filter((t): t is TableSchema => t !== undefined);
  } catch {
    return [];
  }
}
