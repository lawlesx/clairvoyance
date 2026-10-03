import { Pool as PgPool, types, type PoolConfig } from "pg";
import type { RawConnector } from "./index";
import { QUERY_TIMEOUT_MS } from "./limits";
import type { TableSchema, ForeignKey } from "../schemaReader";

const INT8_OID = 20;
const NUMERIC_OID = 1700;

/**
 * Return BIGINT (e.g. COUNT(*)) and NUMERIC (e.g. SUM(price)) as JS numbers instead
 * of strings. String numbers were the main reason charts came out empty or wrong.
 */
const typeParsers = {
  getTypeParser: ((oid: number, format?: "text" | "binary") => {
    if (oid === INT8_OID || oid === NUMERIC_OID) return (v: string) => (v === null ? null : Number(v));
    return types.getTypeParser(oid, format);
  }) as typeof types.getTypeParser,
};

export class PgConnector implements RawConnector {
  private pool: PgPool;

  constructor(config: PoolConfig) {
    this.pool = new PgPool({
      ...config,
      max: 5,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 15_000,
      statement_timeout: QUERY_TIMEOUT_MS,
      types: typeParsers,
    });
  }

  async readSchema(): Promise<TableSchema[]> {
    // Separate pool connections so the three catalogue queries really run in parallel.
    const client = this.pool;
    {
      const [colRes, countRes, fkRes] = await Promise.all([
        client.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(`
          SELECT table_schema, table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            AND table_schema NOT LIKE 'pg_%'
          ORDER BY table_schema, table_name, ordinal_position
        `),
        // reltuples (from ANALYZE) is the better estimate; n_live_tup covers never-analysed tables.
        client.query<{ schemaname: string; relname: string; estimate: string }>(`
          SELECT n.nspname AS schemaname, c.relname,
                 CASE WHEN c.reltuples >= 0 THEN c.reltuples::bigint ELSE COALESCE(s.n_live_tup, 0) END AS estimate
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
          WHERE c.relkind IN ('r', 'p', 'm', 'f')
            AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_%'
        `),
        client.query<{
          table_schema: string; table_name: string; column_name: string;
          ref_schema: string; ref_table: string; ref_column: string;
        }>(`
          SELECT cn.nspname AS table_schema, c.relname AS table_name, a.attname AS column_name,
                 fn.nspname AS ref_schema, f.relname AS ref_table, fa.attname AS ref_column
          FROM pg_constraint con
          JOIN pg_class c ON c.oid = con.conrelid
          JOIN pg_namespace cn ON cn.oid = c.relnamespace
          JOIN pg_class f ON f.oid = con.confrelid
          JOIN pg_namespace fn ON fn.oid = f.relnamespace
          CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS k(col, fcol)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.col
          JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = k.fcol
          WHERE con.contype = 'f'
            AND cn.nspname NOT IN ('pg_catalog', 'information_schema')
        `).catch(() => ({ rows: [] })),
      ]);

      const keyFor = (schema: string, table: string) =>
        schema === "public" ? quoteIdentifier(table) : `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

      const countMap = new Map<string, number>();
      for (const row of countRes.rows) countMap.set(`${row.schemaname}.${row.relname}`, Number(row.estimate));

      const fkMap = new Map<string, ForeignKey[]>();
      for (const row of fkRes.rows) {
        const key = keyFor(row.table_schema, row.table_name);
        if (!fkMap.has(key)) fkMap.set(key, []);
        fkMap.get(key)!.push({
          column: row.column_name,
          refTable: keyFor(row.ref_schema, row.ref_table),
          refColumn: row.ref_column,
        });
      }

      // Table names are emitted already quoted where needed (PascalCase etc.) so the
      // model copies them into SQL correctly.
      const map = new Map<string, TableSchema>();
      for (const row of colRes.rows) {
        const key = keyFor(row.table_schema, row.table_name);
        if (!map.has(key)) {
          map.set(key, {
            name: key,
            columns: [],
            rowCount: countMap.get(`${row.table_schema}.${row.table_name}`) ?? 0,
            sample: [],
            foreignKeys: fkMap.get(key) ?? [],
          });
        }
        map.get(key)!.columns.push({ name: row.column_name, type: row.data_type });
      }
      return Array.from(map.values());
    }
  }

  async executeQuery(sql: string): Promise<Record<string, unknown>[]> {
    const client = await this.pool.connect();
    try {
      // Belt and braces on top of the SQL guardrails: the database itself refuses writes.
      await client.query("BEGIN READ ONLY");
      const { rows } = await client.query(sql);
      await client.query("COMMIT");
      return rows as Record<string, unknown>[];
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async sampleRows(table: string, limit: number): Promise<Record<string, unknown>[]> {
    // `table` comes from readSchema(), which already quotes identifiers.
    return this.executeQuery(`SELECT * FROM ${table} LIMIT ${Math.max(1, Math.min(limit, 20))}`);
  }

  async testConnection(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Quote an identifier only when it needs it (uppercase letters, spaces, symbols). */
function quoteIdentifier(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}
