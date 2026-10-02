import mysql from "mysql2/promise";
import type { RawConnector } from "./index";
import { QUERY_TIMEOUT_MS } from "./limits";
import type { TableSchema, ForeignKey } from "../schemaReader";

export class MySQLConnector implements RawConnector {
  private pool: mysql.Pool;

  constructor(config: mysql.PoolOptions) {
    this.pool = mysql.createPool({
      ...config,
      connectionLimit: 5,
      idleTimeout: 60_000,
      connectTimeout: 15_000,
      // Return DECIMAL / BIGINT as numbers so sums and counts chart correctly.
      decimalNumbers: true,
      supportBigNumbers: true,
      bigNumberStrings: false,
    });
  }

  async readSchema(): Promise<TableSchema[]> {
    const conn = await this.pool.getConnection();
    try {
      const [[colRows], [countRows], [fkRows]] = await Promise.all([
        conn.query<mysql.RowDataPacket[]>(`
          SELECT TABLE_NAME as table_name, COLUMN_NAME as column_name, DATA_TYPE as data_type
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
          ORDER BY TABLE_NAME, ORDINAL_POSITION
        `),
        conn.query<mysql.RowDataPacket[]>(`
          SELECT TABLE_NAME as table_name, TABLE_ROWS as row_count
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
        `),
        conn.query<mysql.RowDataPacket[]>(`
          SELECT TABLE_NAME as table_name, COLUMN_NAME as column_name,
                 REFERENCED_TABLE_NAME as ref_table, REFERENCED_COLUMN_NAME as ref_column
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
        `),
      ]);

      const countMap = new Map<string, number>();
      for (const row of countRows) countMap.set(row.table_name, Number(row.row_count ?? 0));

      const fkMap = new Map<string, ForeignKey[]>();
      for (const row of fkRows) {
        if (!fkMap.has(row.table_name)) fkMap.set(row.table_name, []);
        fkMap.get(row.table_name)!.push({ column: row.column_name, refTable: row.ref_table, refColumn: row.ref_column });
      }

      const map = new Map<string, TableSchema>();
      for (const row of colRows) {
        if (!map.has(row.table_name)) {
          map.set(row.table_name, {
            name: row.table_name,
            columns: [],
            rowCount: countMap.get(row.table_name) ?? 0,
            sample: [],
            foreignKeys: fkMap.get(row.table_name) ?? [],
          });
        }
        map.get(row.table_name)!.columns.push({ name: row.column_name, type: row.data_type });
      }
      return Array.from(map.values());
    } finally {
      conn.release();
    }
  }

  async executeQuery(sql: string): Promise<Record<string, unknown>[]> {
    const conn = await this.pool.getConnection();
    try {
      await conn.query("START TRANSACTION READ ONLY");
      const [rows] = await conn.query<mysql.RowDataPacket[]>({ sql, timeout: QUERY_TIMEOUT_MS });
      await conn.query("COMMIT");
      return rows as Record<string, unknown>[];
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  async sampleRows(table: string, limit: number): Promise<Record<string, unknown>[]> {
    const quoted = "`" + table.replace(/`/g, "``") + "`";
    return this.executeQuery(`SELECT * FROM ${quoted} LIMIT ${Math.max(1, Math.min(limit, 20))}`);
  }

  async testConnection(): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.query("SELECT 1");
    } finally {
      conn.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
