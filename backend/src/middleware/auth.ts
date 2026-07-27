import type { Context, Next } from "hono";
import { auth } from "../lib/auth";

// Paths that bypass authentication
const PUBLIC_PREFIXES = ["/health", "/api/auth/", "/share/"];

function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  if (isPublicPath(c.req.path)) {
    return next();
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", session.user);
  c.set("session", session.session);
  return next();
}
