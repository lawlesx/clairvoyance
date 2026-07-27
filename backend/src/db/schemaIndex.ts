import type { TableSchema } from "./schemaReader";

export interface SchemaIndex {
  /** word → set of table names that contain the word (in name or column names) */
  wordToTables: Map<string, Set<string>>;
  /** table name → TableSchema */
  tableMap: Map<string, TableSchema>;
}

/** Tokenise a string into lowercase words (strips punctuation, splits camelCase/snake_case). */
function tokenise(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase → camel Case
    .split(/[\s_\-./\\]+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 1);
}

/** Build an inverted keyword index from a list of tables. */
export function buildSchemaIndex(tables: TableSchema[]): SchemaIndex {
  const wordToTables = new Map<string, Set<string>>();
  const tableMap = new Map<string, TableSchema>();

  for (const table of tables) {
    tableMap.set(table.name, table);

    const words = new Set([
      ...tokenise(table.name),
      ...table.columns.flatMap((c) => tokenise(c.name)),
    ]);

    for (const word of words) {
      if (!wordToTables.has(word)) wordToTables.set(word, new Set());
      wordToTables.get(word)!.add(table.name);
    }
  }

  return { wordToTables, tableMap };
}

/**
 * Score and return the most relevant tables for a given query string.
 * Always returns at least `minTables` tables (top by row count) even if
 * there are no keyword matches.
 */
export function searchSchema(
  index: SchemaIndex,
  queryText: string,
  maxTables = 20,
  minTables = 5
): TableSchema[] {
  const queryTokens = tokenise(queryText);
  const scores = new Map<string, number>();

  for (const token of queryTokens) {
    const matches = index.wordToTables.get(token);
    if (!matches) continue;
    for (const tableName of matches) {
      scores.set(tableName, (scores.get(tableName) ?? 0) + 1);
    }
  }

  const allTables = Array.from(index.tableMap.values());

  // Sort by score desc, then row count desc as tiebreaker
  const scored = allTables
    .map((t) => ({ table: t, score: scores.get(t.name) ?? 0 }))
    .sort((a, b) => b.score - a.score || b.table.rowCount - a.table.rowCount);

  const topMatches = scored.filter((s) => s.score > 0).slice(0, maxTables).map((s) => s.table);

  // If we don't have enough matched tables, pad with highest row-count tables
  if (topMatches.length < minTables) {
    const matched = new Set(topMatches.map((t) => t.name));
    const fallback = allTables
      .filter((t) => !matched.has(t.name))
      .sort((a, b) => b.rowCount - a.rowCount)
      .slice(0, minTables - topMatches.length);
    return [...topMatches, ...fallback];
  }

  return topMatches;
}

/** Build a compact one-line table index string (all table names). */
export function compactTableIndex(tables: TableSchema[]): string {
  const names = tables.map((t) => t.name).join(", ");
  return `Schema Index (${tables.length} table${tables.length !== 1 ? "s" : ""} total): ${names}`;
}
