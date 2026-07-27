import {
  pgTable,
  text,
  boolean,
  timestamp,
  uuid,
  jsonb,
  integer,
  customType,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── pgvector custom type (voyage-3-lite: 1024 dims) ─────────────────────────

export const vector = customType<{
  data: number[];
  config: { dimensions: number };
  configRequired: true;
  driverData: string;
}>({
  dataType(config) {
    return `vector(${config.dimensions})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});

// ── Better Auth managed tables ───────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

// ── App tables ───────────────────────────────────────────────────────────────

export const dataConnections = pgTable("data_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dbType: text("db_type", { enum: ["postgresql", "mysql"] }).notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(5432),
  dbName: text("db_name").notNull(),
  username: text("username").notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  sslMode: text("ssl_mode").default("prefer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSessions = pgTable("app_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Untitled Session"),
  tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
  shareToken: text("share_token").unique(),
  sourceType: text("source_type", { enum: ["csv", "database"] }).notNull().default("csv"),
  // FK to data_connections — only set when source_type = 'database'
  connectionId: uuid("connection_id").references(() => dataConnections.id, { onDelete: "set null" }),
  sqlitePath: text("sqlite_path"),
  // AI-generated domain understanding — persisted so it survives restarts
  understanding: jsonb("understanding"),
  // CSV sessions expire after 90 days; DB sessions don't expire
  expiresAt: timestamp("expires_at", { withTimezone: true }).default(
    sql`now() + interval '90 days'`
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => appSessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: jsonb("content").notNull(),
  // Populated in Phase 4 by Voyage AI embeddings for semantic search
  embedding: vector("embedding", { dimensions: 1024 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const understandingEmbeddings = pgTable("understanding_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  contentHash: text("content_hash").notNull().unique(),
  understanding: jsonb("understanding").notNull(),
  schemaText: text("schema_text").notNull(),
  // Populated in Phase 4 for similarity-based cache hits
  embedding: vector("embedding", { dimensions: 1024 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Per-session per-table embeddings (for semantic schema selection) ──────────

export const tableEmbeddings = pgTable(
  "table_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => appSessions.id, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    schemaText: text("schema_text").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    rowCount: integer("row_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("table_embeddings_session_table_idx").on(t.sessionId, t.tableName)]
);

// ── Inferred types ────────────────────────────────────────────────────────────

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type AppSession = typeof appSessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DataConnection = typeof dataConnections.$inferSelect;
export type TableEmbedding = typeof tableEmbeddings.$inferSelect;
