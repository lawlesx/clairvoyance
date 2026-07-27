import { Hono } from "hono";
import { requireSession } from "../db/manager";
import { getSchema } from "../db/schemaReader";

export const schemaRouter = new Hono();

schemaRouter.get("/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");

  let db;
  try {
    db = requireSession(sessionId);
  } catch {
    return c.json({ error: "Session not found" }, 404);
  }

  const tables = getSchema(db);
  return c.json({ sessionId, tables });
});
