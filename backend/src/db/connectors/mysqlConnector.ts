import mysql from "mysql2/promise";
import type { ConnectorInterface, SchemaTable } from "./index";

export class MySQLConnector implements ConnectorInterface {
  private pool: mysql.Pool;

  constructor(config: mysql.PoolOptions) {
    this.pool = mysql.createPool({ ...config, connectionLimit: 5, idleTimeout: 60_000 });
  }

  async readSchema(): Promise<SchemaTable[]> {
    const conn = await this.pool.getConnection();
    try {
      const [colRows, countRows] = await Promise.all([
        conn.query<mysql.RowDataPacket[]>(`
          SELECT TABLE_NAME as table_name, COLUMN_NAME as column_name, DATA_TYPE as data_type
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
          ORDER BY TABLE_NAME, ORDINAL_POSITION
        `),
        conn.query<mysql.RowDataPacket[]>(`
          SELECT TABLE_NAME as table_name, TABLE_ROWS as row_count
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        `),
      ]);

      const countMap = new Map<string, number>();
      for (const row of countRows[0]) {
        countMap.set(row.table_name, Number(row.row_count ?? 0));
      }

      const map = new Map<string, SchemaTable>();
      for (const row of colRows[0]) {
        if (!map.has(row.table_name)) {
          map.set(row.table_name, { tableName: row.table_name, columns: [], rowCount: countMap.get(row.table_name) ?? 0 });
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
      const [rows] = await conn.query<mysql.RowDataPacket[]>(sql);
      return rows as Record<string, unknown>[];
    } finally {
      conn.release();
    }
  }

  async testConnection(): Promise<void> {
    const conn = await this.pool.getConnection();
    await conn.query("SELECT 1");
    conn.release();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
