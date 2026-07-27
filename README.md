# Clairvoyance

**Ask questions about any structured dataset in plain English.**

No SQL. No filters. No technical knowledge required — upload a CSV or connect a live database and start asking.

---

## How It Works

```
Sign in  →  Upload CSV (or connect DB)  →  AI analyses data  →  Ask questions  →  Answer + chart
```

**1. Sign in** — Create an account (email/password or OAuth). Sessions are saved and resumable across devices.

**2. Upload or connect** — Drop one or more CSV files, or connect a live PostgreSQL/MySQL database directly. Data stays where it is — Clairvoyance only holds metadata.

**3. AI understands your data** — Claude reads the schema and sample rows, then returns:
- What the dataset is about (domain, summary)
- Which columns matter and why (importance-ranked)
- 6–8 suggested questions tailored to your specific data
- Understanding is cached by content hash (exact) and schema similarity (semantic) — re-uploading the same data is instant

**4. Ask a question** — Type freely or click a suggestion. The agent runs:

```
read_schema → generate_sql → execute_query → choose_visualization
```

**5. Live thinking** — Watch each step in real time. See the SQL being written and executed before the answer arrives.

**6. Answer + chart** — Markdown answer with an auto-selected chart when it genuinely helps.

**7. Sessions persist** — All messages are saved. Resume any session from the dashboard. Insights and suggested questions are restored automatically on resume (from the understanding cache for CSV sessions; re-analysed in the background for live-DB sessions). Share a read-only link with anyone.

---

## User Flow

```mermaid
graph LR
    A([Sign in]) --> B([Upload CSV\nor Connect DB])
    B --> C[AI analyses\nschema & samples]
    C --> D{Cache hit?}
    D -- Exact ⚡ --> E[Show insights\ninstantly]
    D -- Semantic ⚡ --> E
    D -- Miss --> F[Claude analyses\ndata] --> E
    E --> G([User asks\na question])
    G --> H[read_schema]
    H --> I[generate_sql]
    I --> J[execute_query]
    J --> K[choose_visualization]
    K --> L([Answer + chart])
    L --> N{Chart\nrefinement?}
    N -- NL or switcher --> O[Re-render\nclient-side]
    N -- New question --> G
    O --> G
    E --> M([Dashboard\nsaved sessions])
    M --> P{Resume\nsession}
    P -- CSV: cache hit --> E
    P -- DB or cache miss --> Q[analyzeSession\nbackground call] --> E
    M --> G
```

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React, Tailwind CSS, Recharts, react-resizable-panels |
| Backend | Bun + Hono (TypeScript) |
| Auth | Better Auth (email/password + Google/GitHub OAuth) |
| AI Agent | Anthropic Claude `claude-sonnet-4-6` (tool-use) |
| Embeddings | Voyage AI `voyage-3-lite` (1024-dim, optional) |
| Metadata DB | PostgreSQL 16 + pgvector + Drizzle ORM |
| Session Data | SQLite via `bun:sqlite` (per-session, zero config) |
| DB Connectors | `pg` (PostgreSQL), `mysql2` (MySQL) |
| SQL Safety | `node-sql-parser` — SELECT-only, AST-validated, multi-dialect |
| Streaming | Server-Sent Events (Hono `streamSSE`) |

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh) ≥ 1.0
- [Docker](https://www.docker.com) (for the Postgres metadata database)
- An [Anthropic API key](https://console.anthropic.com)

### 1. Start PostgreSQL

```bash
docker compose up -d
```

This starts a PostgreSQL 16 instance with pgvector on **port 5433** (avoids conflicts with any existing local Postgres on 5432).

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env — required: ANTHROPIC_API_KEY, BETTER_AUTH_SECRET
# Optional: VOYAGE_API_KEY (enables semantic search)
bun install
bunx drizzle-kit migrate   # create all tables
bun run dev                # → http://localhost:3001
```

### 3. Frontend

```bash
cd frontend
bun install
cp .env.local.example .env.local
bun run dev                # → http://localhost:3000
```

### Both at once (from project root)

```bash
bun run dev        # starts backend + frontend in parallel
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

**`backend/.env`** (required)

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `DATABASE_URL` | Postgres connection string (default: `postgres://clairvoyance:clairvoyance@localhost:5433/clairvoyance`) |
| `BETTER_AUTH_SECRET` | Random secret for session signing (min 32 chars) |
| `CREDENTIAL_ENCRYPTION_KEY` | 64-char hex key for encrypting stored DB passwords |

**`backend/.env`** (optional)

| Variable | Description |
|---|---|
| `VOYAGE_API_KEY` | Enables semantic understanding cache + session search |
| `BETTER_AUTH_GOOGLE_*` | Google OAuth credentials |
| `BETTER_AUTH_GITHUB_*` | GitHub OAuth credentials |

---

## Key Features

### 🔐 Authentication & Sessions
- Sign up / sign in with email+password, Google, or GitHub (via Better Auth)
- Every session is persisted in Postgres — resume from any device
- Share any session as a public read-only link (`/share/<token>`)
- Rename sessions and add tags inline from the chat view

### 🗄️ Direct Database Connectors
- Connect PostgreSQL or MySQL databases directly — no CSV needed
- Credentials encrypted with AES-256-GCM; plaintext never stored
- Same SQL guardrails apply to live databases
- Connection pool per external DB (max 5 connections, idle timeout)

### ⚡ Understanding Cache (two-layer)
- **Exact hit**: SHA-256 of file content → instant cache lookup in Postgres
- **Semantic hit** *(requires `VOYAGE_API_KEY`)*: cosine similarity over schema embeddings — same schema with a different filename still hits the cache (threshold: 0.92)
- Cache misses run the full `dataAnalyst` agent and store the result for future hits

### 🔍 Semantic Session Search *(requires `VOYAGE_API_KEY`)*
- Both user questions and assistant responses are embedded on save
- `GET /sessions/search?q=` runs a pgvector cosine similarity query over all your messages
- Dashboard search bar is debounced (400 ms) and falls back to name-filter if the API key isn't set

### 🔒 SQL Guardrails
- Only `SELECT` queries reach any database — enforced by AST parsing
- Works across SQLite, PostgreSQL, and MySQL dialects
- Column references validated against real schema — no hallucinated columns
- All queries capped at 10,000 rows

### 📡 Real-time Streaming
- Agent steps stream to the frontend via SSE as they happen
- You see: schema read → SQL written → query run → visualization chosen

### 📊 Smart Visualization

Results automatically render as **multiple complementary charts** when the data supports it. The backend picks only relevant types — no noise.

| Data shape | Charts shown |
|---|---|
| Scalar (1×1) | Inline number — no chart |
| < 2 rows | Text only |
| Time + numeric (trend/cumulative) | Area + Line + Bar |
| Time + numeric (other) | Line + Area + Bar |
| 2 numeric columns | Scatter only |
| Categorical + numeric (> 8 rows) | Bar only |
| Categorical + numeric (≤ 8 rows) | Bar + Pie |
| 2 text cols + numeric (low cardinality) | Heatmap + Bar |

Charts render in a **2-column compact grid** with labelled headers (📊 Bar, 📈 Line, …). Each has its own ⬇ PNG export button.

### 🔄 Multi-Turn Chart Refinement

After a chart appears you can change how it looks — no re-running the query.

- **Switcher pills** — `bar | line | area | pie | scatter | heatmap` buttons appear below every chart; click to switch instantly (pure client-side, zero network round-trip)
- **Natural language** — type "make it a pie chart", "show as area", "switch to bar" — the app intercepts the message client-side and re-renders immediately
- **Multi-view panels** — click "Add view" to pin a second chart of the same data in a different type side-by-side; remove any extra view independently

### 📤 Export

- **⬇ PNG** — captures the chart div with `html2canvas` (2× resolution, white background) and triggers a download
- **⬇ CSV** — converts `data[]` to RFC-4180 CSV (values with commas/quotes properly escaped) and triggers a download
- Both buttons appear in the chart toolbar alongside the type switcher; filename defaults to the chart title

---

## Project Structure

```
clairvoyance/
├── docker-compose.yml            Postgres 16 + pgvector (port 5433)
├── backend/
│   ├── drizzle/                  Auto-generated SQL migrations
│   ├── drizzle.config.ts
│   └── src/
│       ├── index.ts              Hono app — mounts all routers, CORS, auth middleware
│       ├── types.ts              AppEnv (typed Hono context)
│       ├── routes/
│       │   ├── upload.ts         POST /upload (CSV → SQLite + app_sessions row)
│       │   ├── query.ts          POST /query/stream (SSE, persists messages)
│       │   ├── schema.ts         GET  /schema/:sessionId
│       │   ├── sessions.ts       CRUD /sessions + share tokens + /sessions/search
│       │   └── connections.ts    CRUD /connections (live DB connectors)
│       ├── middleware/
│       │   └── auth.ts           Better Auth session verification
│       ├── agents/
│       │   ├── orchestrator.ts   Anthropic tool-use loop (routes to SQLite or live DB)
│       │   ├── dataAnalyst.ts    Upload-time data understanding
│       │   ├── guardrails.ts     SQL AST validation (SQLite / PostgreSQL / MySQL)
│       │   └── vizSelector.ts    Chart type selection
│       ├── db/
│       │   ├── pgClient.ts       Drizzle + pg pool
│       │   ├── schema.ts         All Drizzle table definitions
│       │   ├── manager.ts        Per-session SQLite registry
│       │   ├── schemaReader.ts   SQLite schema extraction
│       │   ├── understandingCache.ts  Two-layer cache (exact hash + pgvector similarity)
│       │   ├── tableEmbeddings.ts     Per-table schema embeddings (semantic table selection)
│       │   └── connectors/
│       │       ├── index.ts      ConnectorInterface + pool registry
│       │       ├── pgConnector.ts
│       │       └── mysqlConnector.ts
│       └── lib/
│           ├── auth.ts           Better Auth instance
│           ├── crypto.ts         AES-256-GCM for credential encryption
│           └── embeddings.ts     Voyage AI voyage-3-lite wrapper
└── frontend/
    └── app/
        ├── layout.tsx            Root layout — wraps with SessionGuard
        ├── page.tsx              Main chat (session resume, share modal, title edit)
        ├── dashboard/page.tsx    Sessions list + semantic search bar
        ├── share/[token]/page.tsx  Public read-only session view
        ├── (auth)/
        │   ├── sign-in/page.tsx
        │   └── sign-up/page.tsx
        ├── lib/
        │   ├── api.ts            All typed API + SSE client functions
        │   ├── authClient.ts     Better Auth React client
        │   └── formatDate.ts     Human-readable date formatting utility
        ├── components/
        │   ├── SessionGuard.tsx  Auth redirect guard
        │   ├── DataUpload/       CSV drag-drop + Connect Database form
        │   ├── DataInsights/     Domain, summary, suggested questions
        │   ├── Chat/             Streaming chat + live step timeline + loading tracker
        │   ├── Charts/           Recharts renderers
        │   └── SchemaViewer/     Table/column browser
        └── ...
```

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed diagrams of every subsystem.

---

## Large Schema Support

Clairvoyance is designed to work well with real-world databases that have hundreds of tables. Two separate problems require two separate strategies.

### UI behaviour by schema size

| Tables | Insights panel | "Ideas to Explore" panel | Analysis |
|---|---|---|---|
| < 50 | ✅ Insights + Schema tabs | ✅ Shown | Full analysis runs automatically |
| ≥ 50 | ❌ Hidden (Schema tab only) | ❌ Not rendered | Skipped — no tokens spent |

When a database with ≥ 50 tables is connected, the frontend immediately shows the Schema browser. A clear message explains why insights are not available. The chat panel takes the full remaining width.

This threshold is controlled by `LARGE_SCHEMA_THRESHOLD = 50` in `frontend/app/page.tsx`.

---

### Problem 1 — AI Insights with 30–49 tables

For databases in the 30–49 table range, Clairvoyance uses a **two-pass clustered analysis** rather than dumping everything into one prompt:

```
Pass 1 — Catalogue (cheap)
  Send: table_name | row_count for all tables
  Ask:  "Group these into domain clusters"
  Get:  { clusters: [{ name: "billing", tables: ["invoices", "payments", ...] }, ...] }

Pass 2 — Deep dive per cluster (parallel, max 8 clusters)
  For each cluster: pick top 3 tables by column count
  Send: full schema + 3 sample rows for those tables
  Get:  a DataUnderstanding per cluster

Synthesis
  Merge all cluster results → one DataUnderstanding
  · domain: from the most prominent cluster
  · keyFeatures: top 5 per cluster, sorted by importance
  · suggestedQuestions: 2 per cluster (max 8 total)
  · primaryMetrics: union across all clusters
```

**Fallback**: if clustering fails, the top 25 tables by row count are analysed directly.

For databases ≤ 30 tables, the standard single-pass analysis runs (no change).

---

### Problem 2 — Query context with large schemas

Even below the 50-table UI threshold, putting all schemas in **every query's system prompt** is expensive. Clairvoyance uses **contextual schema injection**:

```
At session start:
  Build a keyword index:  word → {table names, column names that contain it}

At query time:
  1. Tokenise the question + last 3 conversation turns
  2. Score each table by how many tokens overlap with its name + column names
  3. Inject full schema for the top ~20 scoring tables
  4. Always prepend a compact one-liner index of ALL table names so the AI
     knows what exists even if the full schema wasn't included

System prompt structure:
  ## Schema Index (N tables)
  auth_users, auth_sessions, orders, order_items, products, ...

  ## Relevant Schema (20 tables for this query)
  Table: orders [45,231 rows]
    Columns: id (INTEGER), customer_id (INTEGER), total (REAL), ...
    Sample rows: { "id": 1, "customer_id": 42, "total": 129.99 }
  ...
```

If the AI needs a table that wasn't included, it calls a `lookup_schema` tool:

```
Tool: lookup_schema({ table_name: "shipment_events" })
→ Returns full column definitions for that table on demand
→ That table's columns are added to the allowed-column guardrail for the query
```

This means:
- **Small schemas (≤ 30 tables)**: full schema in prompt, no change
- **Medium schemas (30–49 tables)**: contextual injection + two-pass insights
- **Large schemas (50+ tables)**: contextual injection for queries; insights + suggestions panels hidden in UI

---

### Problem 3 — Result rows sent to the AI

SQL can return thousands of rows but the AI only needs a sample to write a good summary. Clairvoyance enforces a strict split:

| Destination | Row limit |
|---|---|
| Database → user (frontend table/CSV) | Up to `MAX_ROWS` (default: 10,000) |
| Database → AI reasoning | Up to `DATA_ROWS_TO_MODEL` (default: 50) |

The model receives: `{ rowCount: 9500, preview: [...50 rows...], note: "9450 more rows available to the user" }`

This keeps mid-conversation context small regardless of result set size.

**`backend/.env` knobs:**

| Variable | Default | Description |
|---|---|---|
| `MAX_ROWS` | `10000` | Hard cap on rows returned to the user |
| `DATA_ROWS_TO_MODEL` | `50` | Rows included in the tool result for AI reasoning |
| `MAX_SCHEMA_TABLES_PER_QUERY` | `20` | Tables included in a single query's system prompt |
| `SCHEMA_CLUSTER_PASSES` | `8` | Max clusters in two-pass insight analysis |

---

## Roadmap

- [ ] Pinned dashboard of saved questions
- [ ] BigQuery / Snowflake connectors
- [ ] Session expiry + storage cleanup job
