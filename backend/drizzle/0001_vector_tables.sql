-- Add AI-generated understanding to app_sessions so it survives restarts
ALTER TABLE "app_sessions" ADD COLUMN IF NOT EXISTS "understanding" jsonb;
--> statement-breakpoint

-- Per-session per-table vector embeddings for semantic schema selection
CREATE TABLE IF NOT EXISTS "table_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "app_sessions"("id") ON DELETE CASCADE,
  "table_name" text NOT NULL,
  "schema_text" text NOT NULL,
  "embedding" vector(1024) NOT NULL,
  "row_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "table_embeddings_session_table_idx"
  ON "table_embeddings" ("session_id", "table_name");
--> statement-breakpoint

-- ivfflat index for fast approximate cosine search over table embeddings
-- lists=100 is a good default for up to ~1M rows
CREATE INDEX IF NOT EXISTS "table_embeddings_embedding_idx"
  ON "table_embeddings" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
