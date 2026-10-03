-- Table embeddings are always searched within one session (a few to a few thousand
-- rows). An ivfflat index here is approximate *before* the session_id filter is
-- applied, so it could silently return too few tables. An exact scan over the
-- session's rows (found via the (session_id, table_name) unique index) is both
-- correct and fast at this size.
DROP INDEX IF EXISTS "table_embeddings_embedding_idx";
