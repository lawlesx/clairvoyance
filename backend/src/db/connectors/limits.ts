/** Rows returned to callers are capped here regardless of what the SQL asks for. */
export const MAX_QUERY_ROWS = parseInt(process.env.MAX_ROWS ?? "10000");
/** Per-statement timeout for live database queries. */
export const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS ?? "30000");
