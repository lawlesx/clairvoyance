# Deploying Clairvoyance on Railway

This sets up three things in one Railway project:

```
Browser ──► frontend (Next.js, public URL) ──/backend/*──► backend (Bun API, private only) ──► Postgres + pgvector
                                                               └─ volume at /data (uploaded CSVs)
```

Only the frontend is reachable from the internet. It forwards `/backend/*` to the API over Railway's private network, so the browser sees a single domain and login cookies work on Railway's free `*.up.railway.app` URLs (and in Safari, which blocks cross-site cookies).

> **Cost.** Railway bills by usage (see [Railway's pricing](https://railway.com/pricing) for current rates). Set a **usage limit** under Settings → Usage so it can't surprise you. Anthropic API usage is billed separately by Anthropic — set a spend limit in the Anthropic console too.

## Before you start

- A [Railway](https://railway.com) account and this repo on GitHub.
- Railway's GitHub app must have access to the repo. If the repo doesn't appear under **+ New → GitHub Repo**, click **Configure GitHub App**, choose **Only select repositories**, add this repo, save, and refresh.
- An Anthropic API key.
- Generate two secrets on your computer:
  ```bash
  openssl rand -base64 32   # → BETTER_AUTH_SECRET
  openssl rand -hex 32      # → CREDENTIAL_ENCRYPTION_KEY (must be exactly 64 hex characters)
  ```
  Keep `CREDENTIAL_ENCRYPTION_KEY` safe: if you lose or change it, saved database passwords can no longer be decrypted.

## 1. Postgres with pgvector

Clairvoyance stores users, analyses and answers in Postgres and **requires the `pgvector` extension** (the first migration runs `CREATE EXTENSION vector`).

In a new Railway project choose **+ New → Template** and search for **pgvector** (a Postgres image that includes the extension). Railway's plain "Database → PostgreSQL" option may not include pgvector; if the backend later fails with `extension "vector" is not available`, that's the cause.

*Cheaper alternative:* a free Postgres from [Neon](https://neon.tech) or [Supabase](https://supabase.com) also supports pgvector. Skip this service and use its connection string as `DATABASE_URL` below. On Neon, create a project (only the Postgres service is needed; leave object storage, Functions, Auth etc. off), open **Connect**, turn **Pooled connection** off, and copy the direct string. Make it end in `?sslmode=require` and delete any `&channel_binding=require`. Migrations run over this connection, and the pooler can break them. The backend logs a red "SSL modes … are treated as aliases for verify-full" warning with this setup; it is harmless.

## 2. Backend service

1. **+ New → GitHub Repo →** this repository. In the service **Settings**, set **Root Directory** to `backend`. Rename the service to `backend` (the name matters for the variable references below): click the service title at the top of its panel and edit it. Keep this service and the frontend in the **same Railway project**; private networking doesn't cross projects.
2. **Variables:**

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (use your Postgres service's name; or the Neon/Supabase URL) |
   | `ANTHROPIC_API_KEY` | your key |
   | `BETTER_AUTH_SECRET` | from above |
   | `CREDENTIAL_ENCRYPTION_KEY` | from above |
   | `PORT` | `3001` |
   | `SESSIONS_DIR` | `/data/sessions` |
   | `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGIN`, `FRONTEND_ORIGIN` | set in step 4, once the frontend has a URL |

   Optional: `VOYAGE_API_KEY` (semantic table search for big databases), `CLAIRVOYANCE_MODEL`.
3. **Volume:** right-click the service → **Attach volume** → mount path `/data`. Without it, uploaded CSVs disappear on every redeploy.
4. **Do not** generate a public domain for the backend — it should only be reachable from the frontend.
5. Leave it at **one replica**. Uploaded data lives in files on that volume and analysis jobs are tracked in memory, so the backend can't be scaled horizontally.

On every start the backend runs `drizzle-kit migrate` (safe to repeat), then boots. Check the deploy logs: you should see `🚀 Clairvoyance backend running`. If you see a ⚠️ message about Postgres, it says what to fix.

## 3. Frontend service

1. **+ New → GitHub Repo →** the same repository, **Root Directory** `frontend`. Name it `frontend`.
2. **Variables:**

   | Variable | Value |
   |---|---|
   | `BACKEND_URL` | `http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:3001` |
   | `NEXT_PUBLIC_API_URL` | `/backend` |

   These are used **at build time** (Next.js resolves the proxy rule when it builds), so after changing either one, redeploy the frontend (Deployments → ⋮ → Redeploy). Click the ✓ to save a variable before deploying, or the build uses the old value.
3. **Settings → Networking → Generate Domain.** Note the URL, e.g. `https://frontend-production-xxxx.up.railway.app`.

## 4. Connect the two

Back on the **backend** service, add (using the frontend URL from step 3, with `https://` and no trailing slash):

```
BETTER_AUTH_URL=https://frontend-production-xxxx.up.railway.app
BETTER_AUTH_TRUSTED_ORIGIN=https://frontend-production-xxxx.up.railway.app
FRONTEND_ORIGIN=https://frontend-production-xxxx.up.railway.app
```

Railway redeploys the backend. Open the frontend URL, create an account, upload a CSV and ask a question.

## Optional: Google / GitHub sign-in

The backend supports `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`. Because the browser reaches the API through the `/backend` proxy, set `BETTER_AUTH_URL` to `https://<frontend-url>/backend` and register `https://<frontend-url>/backend/api/auth/callback/<google|github>` as the provider's callback URL. (Untested: email/password sign-in is the path this guide covers.)

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Backend restarts in a loop, logging only "applying migrations…" and never `🚀 Clairvoyance backend running` | The migration can't connect to Postgres, and `drizzle-kit` hides the error. Check that `DATABASE_URL` is set on the backend (if it is missing, it falls back to a localhost database), is the bare URL with no quotes or `psql` prefix, and has no `channel_binding` parameter |
| Sign-up/sign-in fails, backend logs ECONNREFUSED to Postgres | `DATABASE_URL` wrong, or the Postgres service isn't running |
| `extension "vector" is not available` in backend logs | Postgres image without pgvector — use the pgvector template or Neon/Supabase |
| Pages load but every action shows a 5xx / "Internal Server Error" | The frontend can't reach the backend. Check `BACKEND_URL` (and that the frontend was rebuilt after setting it). If the frontend logs show `ECONNREFUSED`/`ENOTFOUND` for the private domain, add `HOST=::` to the **backend** variables so it also listens on IPv6 (older Railway environments resolve private names to IPv6 only; newer ones are dual-stack, so this is usually not needed there), and redeploy |
| Login works but you're logged out on refresh | `BETTER_AUTH_URL` / `BETTER_AUTH_TRUSTED_ORIGIN` don't exactly match the frontend URL |
| Empty `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` etc. appear in Variables | Railway imports blank entries from `backend/.env.example`. They're harmless (a blank client ID leaves that sign-in disabled) and can be deleted |
| "The AI service isn't configured correctly" | `ANTHROPIC_API_KEY` missing or wrong on the backend |
| "This session's data file is no longer available" for old uploads | The volume wasn't attached at `/data` (or `SESSIONS_DIR` doesn't point into it) |
| Saving a database connection fails | `CREDENTIAL_ENCRYPTION_KEY` missing (must be 64 hex characters) |

## Operating it

- **Updates:** push to the branch Railway watches (e.g. `main`); both services rebuild. Migrations run automatically.
- **Backups:** enable backups on the Postgres service. The volume holds uploaded CSVs; analyses of *connected* databases need no file backups.
- **Custom domain:** add it to the frontend service, then update the three `BETTER_AUTH_*`/`FRONTEND_ORIGIN` variables on the backend to the new URL.
- **Connecting your own databases:** the backend connects out from Railway, so the database must be reachable from the internet (allow Railway's outbound traffic) — and use a read-only user.
