# Clairvoyance API (Bun + Hono). Build context: ./backend
FROM oven/bun:1

WORKDIR /app

# Install dependencies first so they're cached between code-only changes.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production \
    PORT=3001 \
    SESSIONS_DIR=/data/sessions

# Uploaded files live in SQLite files under SESSIONS_DIR — mount a persistent volume at /data.
EXPOSE 3001

# Apply database migrations, then start the server. Migrations are idempotent;
# on failure the real error is printed and the container exits non-zero.
CMD ["sh", "-c", "bun run src/db/migrate.ts && exec bun run src/index.ts"]
