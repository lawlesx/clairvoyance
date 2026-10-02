import type { Database } from "bun:sqlite";
import { and, eq } from "drizzle-orm";
import { db as pgDb } from "./pgClient";
import { appSessions, dataConnections, type AppSession } from "./schema";
import { getSessionEntry } from "./manager";
import { getSchema, type TableSchema } from "./schemaReader";
import { inferForeignKeys } from "./schemaIndex";
import { connectorForRecord, type ConnectorInterface } from "./connectors/index";
import type { SqlDialect } from "../agents/guardrails";

/** Where a session's data lives, plus its (cached) schema. */
export type DataSource =
  | { kind: "csv"; db: Database; tables: TableSchema[]; dialect: "SQLite" }
  | { kind: "database"; connector: ConnectorInterface; tables: TableSchema[]; dialect: SqlDialect };

export class SourceError extends Error {
  constructor(message: string, public status: 400 | 404 = 404) {
    super(message);
  }
}

/** Load a session row, but only if it belongs to `userId`. */
export async function getOwnedSession(sessionId: string, userId: string): Promise<AppSession | null> {
  const [row] = await pgDb
    .select()
    .from(appSessions)
    .where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, userId)))
    .limit(1)
    .catch(() => [undefined]);
  return row ?? null;
}

export async function loadDataSource(session: AppSession): Promise<DataSource> {
  if (session.sourceType === "database") {
    if (!session.connectionId) throw new SourceError("This session's database connection was removed.");
    const [conn] = await pgDb.select().from(dataConnections).where(eq(dataConnections.id, session.connectionId)).limit(1);
    if (!conn) throw new SourceError("This session's database connection was removed.");
    const connector = connectorForRecord(conn);
    const tables = inferForeignKeys(await connector.readSchema());
    return { kind: "database", connector, tables, dialect: conn.dbType === "postgresql" ? "PostgresQL" : "MySQL" };
  }

  const entry = getSessionEntry(session.id);
  if (!entry) throw new SourceError("This session's data file is no longer available. Please upload it again.");
  if (!entry.schema) entry.schema = getSchema(entry.db);
  return { kind: "csv", db: entry.db, tables: inferForeignKeys(entry.schema), dialect: "SQLite" };
}

/** A function that fetches a few example rows — used when describing live databases. */
export function samplerFor(source: DataSource) {
  return source.kind === "database"
    ? (t: TableSchema) => source.connector.sampleRows(t.name, 3)
    : undefined;
}
