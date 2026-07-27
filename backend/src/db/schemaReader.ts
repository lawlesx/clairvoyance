import type { Database } from "bun:sqlite";

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
  sample: Record<string, unknown>[];
}

export function getSchema(db: Database): TableSchema[] {
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_session_%'"
    )
    .all();

  return tables.map(({ name }) => {
    const colRows = db.query<{ name: string; type: string }, []>(
      `PRAGMA table_info('${name}')`
    ).all();
    const columns: ColumnInfo[] = colRows.map((r) => ({ name: r.name, type: r.type }));

    const countRow = db.query<{ count: number }, []>(`SELECT COUNT(*) as count FROM '${name}'`).get();
    const rowCount = countRow?.count ?? 0;

    const sampleRows = db.query(`SELECT * FROM '${name}' LIMIT 5`).all() as Record<string, unknown>[];

    return { name, columns, rowCount, sample: sampleRows };
  });
}

export function schemaToPrompt(tables: TableSchema[]): string {
  return tables
    .map((t) => {
      const cols = t.columns.map((c) => `${c.name} (${c.type || "TEXT"})`).join(", ");
      const samples = t.sample.length
        ? `\n  Sample rows:\n${t.sample.map((r) => `    ${JSON.stringify(r)}`).join("\n")}`
        : "";
      return `Table: ${t.name} [${t.rowCount} rows]\n  Columns: ${cols}${samples}`;
    })
    .join("\n\n");
}

export function getAllColumnNames(tables: TableSchema[]): Set<string> {
  const cols = new Set<string>();
  for (const t of tables) {
    for (const c of t.columns) cols.add(c.name.toLowerCase());
    cols.add(t.name.toLowerCase()); // table name also valid as alias
  }
  return cols;
}
