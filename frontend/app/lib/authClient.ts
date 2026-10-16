import { createAuthClient } from "better-auth/react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Better Auth needs an absolute URL. A relative API_URL ("/backend") means the frontend
// proxies to the API, so auth lives at <this origin>/backend/api/auth (a base URL that
// already contains a path is used as-is).
const baseURL = API_URL.startsWith("/")
  ? `${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}${API_URL}/api/auth`
  : API_URL;

export const authClient = createAuthClient({ baseURL });

export const { signIn, signUp, signOut, useSession } = authClient;
