import type { NextConfig } from "next";

/**
 * In production the browser talks only to the frontend. Requests to /backend/* are
 * forwarded to the API server (BACKEND_URL, e.g. Railway's private network address),
 * so the login cookie is first-party on whatever domain the app is served from.
 *
 * /api/auth/* is forwarded too: OAuth providers redirect the browser to
 * <BETTER_AUTH_URL>/api/auth/callback/<provider>, and BETTER_AUTH_URL must be a bare origin
 * (Better Auth stops serving its routes if the URL has a path), so that callback lands here.
 *
 * Rewrites are resolved at build time, so BACKEND_URL must be set when building.
 * Locally, leave BACKEND_URL unset and the app calls http://localhost:3001 directly.
 */
const backendUrl = process.env.BACKEND_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Answers stream for up to a couple of minutes; the default proxy timeout is 30 s.
  experimental: { proxyTimeout: 300_000 },
  async rewrites() {
    return backendUrl
      ? [
          { source: "/backend/:path*", destination: `${backendUrl}/:path*` },
          { source: "/api/auth/:path*", destination: `${backendUrl}/api/auth/:path*` },
        ]
      : [];
  },
};

export default nextConfig;
