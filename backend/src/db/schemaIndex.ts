import type { TableSchema, ForeignKey } from "./schemaReader";

/**
 * Finding the right tables in a database with hundreds of them.
 *
 * Semantic search (pgvector, see tableEmbeddings.ts) is used when VOYAGE_API_KEY is
 * set. This module is the always-available fallback and the glue around it:
 * keyword scoring with light stemming, relationship inference for databases that
 * don't declare foreign keys, and "pull in the tables this one joins to".
 */

export interface SchemaIndex {
  /** stemmed word → table name → score contribution */
  wordToTables: Map<string, Map<string, number>>;
  /** table name → TableSchema */
  tableMap: Map<string, TableSchema>;
  /** lower-cased bare table name → table name (for forgiving lookups) */
  aliasMap: Map<string, string>;
}

const STOP_WORDS = new Set([
  "the", "of", "and", "or", "to", "in", "on", "for", "by", "with", "what", "which", "how", "many", "much",
  "show", "me", "is", "are", "was", "were", "do", "does", "did", "a", "an", "per", "each", "all", "my", "our",
  "this", "that", "these", "those", "from", "between", "over", "than", "top", "most", "least", "give", "list",
  "find", "data", "table", "tables", "it", "its", "be", "has", "have", "any", "there", "about", "vs", "versus",
]);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && /(ses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Tokenise into stemmed lowercase words (splits camelCase, snake_case, schema.table). */
export function tokenise(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_\-./\\"'`,;:()?!]+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map(stem);
}

export function bareName(table: string): string {
  return table.split(".").pop()!.replace(/"/g, "").toLowerCase();
}

/**
 * Many real databases have no FK constraints. Guess the obvious ones from naming:
 * `customer_id` / `customerId` → a table called customer(s) with an `id` column.
 */
export function inferForeignKeys(tables: TableSchema[]): TableSchema[] {
  const byBare = new Map<string, TableSchema>();
  for (const t of tables) byBare.set(bareName(t.name), t);

  return tables.map((t) => {
    const declared = new Set((t.foreignKeys ?? []).map((fk) => fk.column));
    const inferred: ForeignKey[] = [];
    for (const col of t.columns) {
      if (declared.has(col.name)) continue;
      const m = col.name.match(/^(.+?)_?(id|Id|ID)$/);
      if (!m || !m[1]) continue;
      const base = m[1].replace(/_$/, "").toLowerCase();
      if (!base || base === bareName(t.name)) continue;
      const target = byBare.get(base) ?? byBare.get(base + "s") ?? byBare.get(base + "es") ??
        (base.endsWith("y") ? byBare.get(base.slice(0, -1) + "ies") : undefined);
      if (!target || target.name === t.name) continue;
      const idCol = target.columns.find((c) => c.name.toLowerCase() === "id") ??
        target.columns.find((c) => c.name.toLowerCase() === col.name.toLowerCase());
      if (idCol) inferred.push({ column: col.name, refTable: target.name, refColumn: idCol.name, inferred: true });
    }
    return inferred.length ? { ...t, foreignKeys: [...(t.foreignKeys ?? []), ...inferred] } : t;
  });
}

export function buildSchemaIndex(tables: TableSchema[]): SchemaIndex {
  const wordToTables = new Map<string, Map<string, number>>();
  const tableMap = new Map<string, TableSchema>();
  const aliasMap = new Map<string, string>();

  const add = (word: string, table: string, weight: number) => {
    if (!wordToTables.has(word)) wordToTables.set(word, new Map());
    const m = wordToTables.get(word)!;
    m.set(table, Math.max(m.get(table) ?? 0, weight));
  };

  for (const table of tables) {
    tableMap.set(table.name, table);
    aliasMap.set(table.name.toLowerCase(), table.name);
    aliasMap.set(bareName(table.name), table.name);
    // A word in the table name says much more than the same word in a column name.
    for (const w of tokenise(table.name)) add(w, table.name, 3);
    for (const c of table.columns) for (const w of tokenise(c.name)) add(w, table.name, 1);
  }

  return { wordToTables, tableMap, aliasMap };
}

export function findTable(index: SchemaIndex, name: string): TableSchema | undefined {
  const key = index.aliasMap.get(name.toLowerCase()) ?? index.aliasMap.get(bareName(name));
  return key ? index.tableMap.get(key) : undefined;
}

/** Keyword-score tables against free text. Empty when nothing matches. */
export function searchSchema(index: SchemaIndex, queryText: string, maxTables = 12): TableSchema[] {
  const scores = new Map<string, number>();
  for (const token of new Set(tokenise(queryText))) {
    const exact = index.wordToTables.get(token);
    if (exact) for (const [t, w] of exact) scores.set(t, (scores.get(t) ?? 0) + w);
    // Prefix match catches "revenue" vs "revenues_daily", "cust" vs "customer"
    if (token.length >= 4) {
      for (const [word, tables] of index.wordToTables) {
        if (word !== token && (word.startsWith(token) || token.startsWith(word)) && word.length >= 4) {
          for (const [t, w] of tables) scores.set(t, (scores.get(t) ?? 0) + w * 0.5);
        }
      }
    }
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1] || (index.tableMap.get(b[0])!.rowCount - index.tableMap.get(a[0])!.rowCount))
    .slice(0, maxTables)
    .map(([name]) => index.tableMap.get(name)!);
}

/** Add the tables that `seed` tables join to (one hop, both directions), up to `max`. */
export function withRelatedTables(index: SchemaIndex, seed: TableSchema[], max: number): TableSchema[] {
  const out = new Map(seed.map((t) => [t.name, t]));
  const seedNames = new Set(seed.map((t) => t.name));

  // Outgoing references first (orders → customers), they're the joins people need.
  for (const t of seed) {
    for (const fk of t.foreignKeys ?? []) {
      if (out.size >= max) break;
      const ref = findTable(index, fk.refTable);
      if (ref && !out.has(ref.name)) out.set(ref.name, ref);
    }
  }
  // Then incoming references (customers ← orders)
  if (out.size < max) {
    for (const t of index.tableMap.values()) {
      if (out.size >= max) break;
      if (out.has(t.name)) continue;
      if ((t.foreignKeys ?? []).some((fk) => seedNames.has(findTable(index, fk.refTable)?.name ?? ""))) {
        out.set(t.name, t);
      }
    }
  }
  return Array.from(out.values());
}

/** The biggest tables — a reasonable starting point when nothing matches. */
export function largestTables(tables: TableSchema[], n: number): TableSchema[] {
  return [...tables].sort((a, b) => b.rowCount - a.rowCount).slice(0, n);
}

/**
 * One line per table with its row count, for the system prompt of large databases.
 * Capped so even a 5,000-table warehouse fits; the rest is reachable via find_tables.
 */
export function compactTableIndex(tables: TableSchema[], maxEntries = 1500): string {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  const shown = sorted.slice(0, maxEntries).map((t) => `${t.name} (~${t.rowCount.toLocaleString()})`);
  const more = sorted.length > maxEntries ? `\n…and ${sorted.length - maxEntries} more (use find_tables)` : "";
  return `All ${tables.length} tables (name, ~rows):\n${shown.join(", ")}${more}`;
}
