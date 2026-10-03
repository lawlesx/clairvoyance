import { PgConnector } from "./pgConnector";
import { MySQLConnector } from "./mysqlConnector";
import type { TableSchema } from "../schemaReader";
import { decryptPassword } from "../../lib/crypto";
import type { DataConnection } from "../schema";

import { MAX_QUERY_ROWS } from "./limits";

export { MAX_QUERY_ROWS, QUERY_TIMEOUT_MS } from "./limits";
const SCHEMA_CACHE_TTL_MS = parseInt(process.env.SCHEMA_CACHE_TTL_MS ?? String(10 * 60_000));

export interface RawConnector {
  /** Tables with columns, estimated row counts and foreign keys. Sample is always []. */
  readSchema(): Promise<TableSchema[]>;
  /** Runs inside a read-only transaction with a statement timeout. */
  executeQuery(sql: string): Promise<Record<string, unknown>[]>;
  /** A few rows from one table (table name exactly as returned by readSchema). */
  sampleRows(table: string, limit: number): Promise<Record<string, unknown>[]>;
  testConnection(): Promise<void>;
  close(): Promise<void>;
}

export interface ConnectorInterface extends RawConnector {
  /** Drop the cached schema so the next readSchema() hits the database. */
  invalidateSchema(): void;
}

export type DbType = "postgresql" | "mysql";

export interface ConnectionConfig {
  id: string;
  dbType: DbType;
  host: string;
  port: number;
  dbName: string;
  username: string;
  password: string;
  sslMode?: string;
}

/**
 * Reading the schema of a big database (hundreds of tables) takes real time, and it
 * used to happen on every single question. Cache it per connection.
 */
class CachedConnector implements ConnectorInterface {
  private schema: { at: number; promise: Promise<TableSchema[]> } | null = null;

  constructor(private inner: RawConnector) {}

  readSchema(): Promise<TableSchema[]> {
    if (this.schema && Date.now() - this.schema.at < SCHEMA_CACHE_TTL_MS) return this.schema.promise;
    const promise = this.inner.readSchema();
    this.schema = { at: Date.now(), promise };
    promise.catch(() => { this.schema = null; });
    return promise;
  }

  invalidateSchema() { this.schema = null; }
  executeQuery(sql: string) { return this.inner.executeQuery(sql); }
  sampleRows(table: string, limit: number) { return this.inner.sampleRows(table, limit); }
  testConnection() { return this.inner.testConnection(); }
  close() { return this.inner.close(); }
}

function createRaw(config: ConnectionConfig): RawConnector {
  const ssl = config.sslMode === "require" ? { rejectUnauthorized: false } : undefined;
  const base = {
    host: config.host,
    port: config.port,
    database: config.dbName,
    user: config.username,
    password: config.password,
    ssl,
  };
  return config.dbType === "postgresql" ? new PgConnector(base) : new MySQLConnector(base);
}

// Pool registry — one connector per connection_id
const registry = new Map<string, ConnectorInterface>();

export function getConnector(config: ConnectionConfig): ConnectorInterface {
  const existing = registry.get(config.id);
  if (existing) return existing;
  const connector = new CachedConnector(createRaw(config));
  registry.set(config.id, connector);
  return connector;
}

/** A throwaway connector (not registered) — used to test credentials before saving. */
export function createTemporaryConnector(config: Omit<ConnectionConfig, "id">): RawConnector {
  return createRaw({ ...config, id: "temporary" });
}

/** Build (or reuse) the connector for a saved connection row. */
export function connectorForRecord(conn: DataConnection): ConnectorInterface {
  return getConnector({
    id: conn.id,
    dbType: conn.dbType as DbType,
    host: conn.host,
    port: conn.port,
    dbName: conn.dbName,
    username: conn.username,
    password: decryptPassword(conn.encryptedPassword),
    sslMode: conn.sslMode ?? undefined,
  });
}

export async function removeConnector(connectionId: string): Promise<void> {
  const connector = registry.get(connectionId);
  if (connector) {
    await connector.close().catch(() => {});
    registry.delete(connectionId);
  }
}

/** Add the row cap to a SELECT if it has no LIMIT of its own. */
const TRAILING_LIMIT_RE =
  /\b(limit\s+\d+(\s*,\s*\d+)?(\s+offset\s+\d+)?|offset\s+\d+\s+rows?(\s+fetch\s+(first|next)\s+\d*\s*rows?\s+only)?|fetch\s+(first|next)\s+\d*\s*rows?\s+only)\s*$/i;

/** Add the row cap to a SELECT unless it already ends with its own LIMIT / FETCH clause. */
export function ensureLimit(sql: string, max = MAX_QUERY_ROWS): string {
  const trimmed = sql.trim();
  if (TRAILING_LIMIT_RE.test(trimmed)) return trimmed;
  return `${trimmed}\nLIMIT ${max}`;
}
