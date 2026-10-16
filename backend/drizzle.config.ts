import { defineConfig } from "drizzle-kit";

const url =
  process.env.DATABASE_URL ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "postgresql://clairvoyance:clairvoyance_dev@localhost:5433/clairvoyance");
if (!url) {
  throw new Error("DATABASE_URL is required in production (refusing to fall back to localhost)");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
