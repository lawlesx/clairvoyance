import type { Database } from "bun:sqlite";

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface ForeignKey {
  column: string;
  refTable: string;
  refColumn: string;
  /** true when guessed from naming (customer_id → customers.id) rather than a real constraint */
  inferred?: boolean;
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
  sample: Record<string, unknown>[];
  foreignKeys?: ForeignKey[];
}

export function getSchema(db: Database): TableSchema[] {
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_session_%'"
    )
    .all();

  return tables.map(({ name }) => {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const colRows = db.query<{ name: string; type: string }, []>(`PRAGMA table_info(${quoted})`).all();
    const columns: ColumnInfo[] = colRows.map((r) => ({ name: r.name, type: r.type }));

    const countRow = db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM ${quoted}`).get();
    const rowCount = countRow?.count ?? 0;

    const sampleRows = db.query(`SELECT * FROM ${quoted} LIMIT 5`).all() as Record<string, unknown>[];

    return { name, columns, rowCount, sample: sampleRows };
  });
}

function shortType(type: string): string {
  const t = (type || "text").toLowerCase();
  if (/int|serial/.test(t)) return "integer";
  if (/numeric|decimal|real|float|double|money/.test(t)) return "number";
  if (/timestamp|datetime/.test(t)) return "timestamp";
  if (/date/.test(t)) return "date";
  if (/time/.test(t)) return "time";
  if (/bool|bit/.test(t)) return "boolean";
  if (/json/.test(t)) return "json";
  return "text";
}

function truncateValue(v: unknown): unknown {
  if (typeof v === "string" && v.length > 60) return v.slice(0, 57) + "…";
  return v;
}

/**
 * Compact schema description for the model. Includes relationships so the model
 * knows how to join tables, and (optionally) a couple of sample rows so it knows
 * what values look like (e.g. 'Shipped' vs 'SHIPPED').
 */
export function schemaToPrompt(tables: TableSchema[], opts: { samples?: number } = {}): string {
  const maxSamples = opts.samples ?? 2;
  return tables
    .map((t) => {
      const fkByCol = new Map((t.foreignKeys ?? []).map((fk) => [fk.column, fk]));
      const cols = t.columns
        .map((c) => {
          const fk = fkByCol.get(c.name);
          const link = fk ? ` → ${fk.refTable}.${fk.refColumn}${fk.inferred ? "?" : ""}` : "";
          return `${c.name} (${shortType(c.type)}${link})`;
        })
        .join(", ");
      const samples = t.sample.slice(0, maxSamples);
      const sampleText = samples.length
        ? `\n  e.g. ${samples
            .map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, truncateValue(v)]))))
            .join("\n       ")}`
        : "";
      return `Table ${t.name} (~${t.rowCount.toLocaleString()} rows)\n  ${cols}${sampleText}`;
    })
    .join("\n\n");
}

/** Lower-cased set of every table and column name — used to catch hallucinated columns. */
export function getAllColumnNames(tables: TableSchema[]): Set<string> {
  const cols = new Set<string>();
  for (const t of tables) {
    for (const c of t.columns) cols.add(c.name.toLowerCase());
    cols.add(t.name.toLowerCase());
    // Allow both `schema."Table"` and bare `Table` forms
    const bare = t.name.split(".").pop()!.replace(/"/g, "").toLowerCase();
    cols.add(bare);
  }
  return cols;
}
