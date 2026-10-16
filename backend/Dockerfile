# Clairvoyance API (Bun + Hono). Build context: ./backend
FROM oven/bun:1

WORKDIR /app

# Install dependencies first so they're cached between code-only changes.
# (devDependencies are needed: drizzle-kit runs the migrations on start.)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=production \
    PORT=3001 \
    SESSIONS_DIR=/data/sessions

# Uploaded files live in SQLite files under SESSIONS_DIR — mount a persistent volume at /data.
EXPOSE 3001

# Apply database migrations, then start the server. Migrations are idempotent.
CMD ["sh", "-c", "bunx drizzle-kit migrate && exec bun run src/index.ts"]
