import { PgConnector } from "./pgConnector";
import { MySQLConnector } from "./mysqlConnector";

export interface SchemaColumn {
  name: string;
  type: string;
}

export interface SchemaTable {
  tableName: string;
  columns: SchemaColumn[];
  rowCount: number;
}

export interface ConnectorInterface {
  readSchema(): Promise<SchemaTable[]>;
  executeQuery(sql: string): Promise<Record<string, unknown>[]>;
  testConnection(): Promise<void>;
  close(): Promise<void>;
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

// Pool registry — one connector per connection_id
const registry = new Map<string, ConnectorInterface>();

export function getConnector(config: ConnectionConfig): ConnectorInterface {
  const existing = registry.get(config.id);
  if (existing) return existing;

  let connector: ConnectorInterface;

  if (config.dbType === "postgresql") {
    connector = new PgConnector({
      host: config.host,
      port: config.port,
      database: config.dbName,
      user: config.username,
      password: config.password,
      ssl: config.sslMode === "require" ? { rejectUnauthorized: false } : undefined,
    });
  } else {
    connector = new MySQLConnector({
      host: config.host,
      port: config.port,
      database: config.dbName,
      user: config.username,
      password: config.password,
      ssl: config.sslMode === "require" ? { rejectUnauthorized: false } : undefined,
    });
  }

  registry.set(config.id, connector);
  return connector;
}

export async function removeConnector(connectionId: string): Promise<void> {
  const connector = registry.get(connectionId);
  if (connector) {
    await connector.close().catch(() => {});
    registry.delete(connectionId);
  }
}
