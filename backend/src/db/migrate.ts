import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./pgClient";

/** Apply pending migrations; print the real error and exit non-zero on failure. */
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await pool.end();
} catch (e) {
  const err = e as Error & { code?: string; cause?: unknown };
  console.error(`\nMigration failed: ${err.code ? `[${err.code}] ` : ""}${err.message || err}`);
  if (err.cause) console.error("Cause:", err.cause);
  process.exit(1);
}
