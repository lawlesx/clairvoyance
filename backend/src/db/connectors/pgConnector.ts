import { Pool as PgPool, type PoolConfig } from "pg";
import type { ConnectorInterface, SchemaTable } from "./index";

export class PgConnector implements ConnectorInterface {
  private pool: PgPool;

  constructor(config: PoolConfig) {
    this.pool = new PgPool({ ...config, max: 5, idleTimeoutMillis: 60_000 });
  }

  async readSchema(): Promise<SchemaTable[]> {
    const client = await this.pool.connect();
    try {
      const [colRes, countRes] = await Promise.all([
        client.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(`
          SELECT table_schema, table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            AND table_schema NOT LIKE 'pg_%'
          ORDER BY table_schema, table_name, ordinal_position
        `),
        client.query<{ schemaname: string; relname: string; n_live_tup: string }>(`
          SELECT schemaname, relname, n_live_tup
          FROM pg_stat_user_tables
        `),
      ]);

      // Build rowCount lookup: "schema.table" or "table" for public schema
      const countMap = new Map<string, number>();
      for (const row of countRes.rows) {
        const key = row.schemaname === "public" ? row.relname : `${row.schemaname}.${row.relname}`;
        countMap.set(key, Number(row.n_live_tup));
      }

      const map = new Map<string, SchemaTable>();
      for (const row of colRes.rows) {
        // Use the raw (unquoted) key for countMap lookup, but build a properly-quoted
        // tableName so the AI generates valid SQL for PascalCase/mixed-case identifiers.
        const rawKey = row.table_schema === "public" ? row.table_name : `${row.table_schema}.${row.table_name}`;
        const quotedTable = quoteIdentifier(row.table_name);
        const key = row.table_schema === "public" ? quotedTable : `${row.table_schema}.${quotedTable}`;
        if (!map.has(key)) {
          map.set(key, { tableName: key, columns: [], rowCount: countMap.get(rawKey) ?? 0 });
        }
        map.get(key)!.columns.push({ name: row.column_name, type: row.data_type });
      }
      return Array.from(map.values());
    } finally {
      client.release();
    }
  }

  async executeQuery(sql: string): Promise<Record<string, unknown>[]> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query(sql);
      return rows as Record<string, unknown>[];
    } finally {
      client.release();
    }
  }

  async testConnection(): Promise<void> {
    const client = await this.pool.connect();
    await client.query("SELECT 1");
    client.release();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Quote an identifier only when it contains uppercase letters or special characters. */
function quoteIdentifier(name: string): string {
  return /[A-Z\s\-]/.test(name) ? `"${name}"` : name;
}
