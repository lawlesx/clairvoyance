import type {
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { createMessage, responseText } from "../lib/llm";
import { schemaToPrompt, getAllColumnNames, type TableSchema } from "../db/schemaReader";
import {
  buildSchemaIndex, searchSchema, compactTableIndex, withRelatedTables, largestTables, findTable,
} from "../db/schemaIndex";
import { searchTablesByEmbedding, ensureTableEmbeddings } from "../db/tableEmbeddings";
import { ensureLimit, MAX_QUERY_ROWS } from "../db/connectors/index";
import type { DataSource } from "../db/dataSource";
import { validateSQL, GuardrailError } from "./guardrails";
import {
  buildAnswer, normalizeRows, profileColumns, summarizeForModel,
  type AnswerPayload, type ColumnMeta, type Visual,
} from "./visual";
import type { DataUnderstanding } from "./dataAnalyst";

/**
 * The question-answering agent.
 *
 * Claude works with five tools: find the right tables (large databases), peek at the
 * data, run the query that answers the question, and finally *present* the answer —
 * a plain-language headline, a few insights, a suggested visual with friendly labels,
 * and follow-up questions. The visual is then checked against the real result
 * (agents/visual.ts) before it reaches the user.
 */

const FULL_SCHEMA_TABLE_LIMIT = parseInt(process.env.FULL_SCHEMA_TABLE_LIMIT ?? "25");
const FULL_SCHEMA_COLUMN_LIMIT = 600;
const RELEVANT_TABLES = 12;
const RELEVANT_WITH_RELATED = 20;
const PREVIEW_ROWS_TO_MODEL = Math.min(parseInt(process.env.DATA_ROWS_TO_MODEL ?? "40"), 200);
const EXPLORE_ROW_LIMIT = 200;
const MAX_TURNS = 12;

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
  /** The SQL behind an earlier answer, so follow-ups ("now split it by region") build on it */
  sql?: string;
}

export type StatusState = "active" | "done" | "error";

export type StreamEvent =
  | { type: "status"; id: string; label: string; detail?: string; state: StatusState }
  | { type: "sql"; sql: string }
  | { type: "result"; answer: AnswerPayload }
  | { type: "done" }
  | { type: "error"; message: string };

type Emit = (event: StreamEvent) => Promise<void>;

// ── Tools ─────────────────────────────────────────────────────────────────────

const VISUAL_TYPES = ["kpi", "line", "area", "bar", "pie", "scatter", "table", "none"];
const FORMATS = ["number", "currency", "percent", "ratio", "date", "text"];

function buildTools(largeSchema: boolean): BetaTool[] {
  const tools: BetaTool[] = [];
  if (largeSchema) {
    tools.push({
      name: "find_tables",
      description:
        "Search this database for tables relevant to a topic and get their full column lists and relationships. Use business terms ('refunds', 'marketing spend') or exact table names. Call it whenever the tables you need are not already described.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "Topic, business terms, or table names." } },
        required: ["query"],
      },
    });
  }
  tools.push(
    {
      name: "explore_data",
      description:
        "Run a small exploratory SELECT to check something before answering — e.g. which values a status column uses, the date range, or whether a join works. Results are for you only; the user does not see them.",
      input_schema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "A read-only SELECT. Keep it small (LIMIT 50 or less)." },
          purpose: { type: "string", description: "Plain-language purpose shown to the user, e.g. 'Checking which order statuses exist'." },
        },
        required: ["sql", "purpose"],
      },
    },
    {
      name: "run_query",
      description:
        "Run the query whose result answers the user's question. Its result is what the user will see as a chart or table. You receive the row count, a preview, column types and summary statistics (including correlation between the first two numeric columns). Call again with a corrected query if the result isn't right; the last successful call is used.",
      input_schema: {
        type: "object",
        properties: { sql: { type: "string", description: "A read-only SELECT shaped for display (see instructions)." } },
        required: ["sql"],
      },
    },
    {
      name: "present_answer",
      description: "Deliver the final answer to the user. Call exactly once, after run_query (or without it if the data can't answer the question).",
      input_schema: {
        type: "object",
        properties: {
          headline: { type: "string", description: "One plain-English sentence that directly answers the question, with the key number(s) formatted." },
          insights: { type: "array", items: { type: "string" }, description: "0-3 short bullets that add something the headline doesn't." },
          visual: {
            type: "object",
            description: "How to show the result.",
            properties: {
              type: { type: "string", enum: VISUAL_TYPES },
              x: { type: "string", description: "Result column for categories, time, or the x-axis." },
              y: { type: "array", items: { type: "string" }, description: "Numeric result column(s) to plot (one per series)." },
              series: { type: "string", description: "Optional result column that splits one measure into several lines/bar groups." },
              title: { type: "string", description: "Short chart title in plain words, e.g. 'Monthly revenue, 2024'." },
            },
            required: ["type"],
          },
          columns: {
            type: "array",
            description: "Friendly label and display format for every result column.",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "Exact result column name." },
                label: { type: "string", description: "Plain-language label, e.g. 'Revenue', 'Signup month'." },
                format: { type: "string", enum: FORMATS, description: "percent = values 0-100; ratio = values 0-1 shown as %." },
                currency: { type: "string", description: "ISO code for currency format, e.g. USD, EUR, INR." },
              },
              required: ["key", "label", "format"],
            },
          },
          method: { type: "string", description: "One plain sentence on how this was calculated, including filters and assumptions." },
          follow_ups: { type: "array", items: { type: "string" }, description: "2-3 natural next questions." },
        },
        required: ["headline", "visual", "columns", "follow_ups"],
      },
    },
    {
      name: "ask_clarification",
      description:
        "Ask the user to choose between interpretations, only when the question is ambiguous in a way that would materially change the answer and no sensible default exists.",
      input_schema: {
        type: "object",
        properties: {
          question: { type: "string", description: "The clarifying question, in plain language." },
          options: { type: "array", items: { type: "string" }, description: "2-4 short answers the user can click." },
        },
        required: ["question", "options"],
      },
    }
  );
  return tools;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function dialectRules(dialect: DataSource["dialect"]): string {
  if (dialect === "PostgresQL") {
    return `PostgreSQL. Table names are given exactly as they must be written (already quoted where needed). Double-quote any column with capitals or spaces. Use date_trunc('month', col) for time buckets.`;
  }
  if (dialect === "MySQL") {
    return `MySQL 8. Quote identifiers with backticks when needed. Use DATE_FORMAT(col, '%Y-%m') for monthly buckets.`;
  }
  return `SQLite. Quote identifiers containing spaces or capitals with double quotes. Dates are stored as text; use strftime('%Y-%m', col) for monthly buckets. There is no FULL OUTER JOIN.`;
}

function glossaryText(u?: DataUnderstanding): string {
  if (!u) return "";
  const terms = u.keyFeatures.map((f) => `- ${f.label} = ${f.column}: ${f.description}`).join("\n");
  return `\n## What this data is about\n${u.domain}. ${u.summary}\n\n## Business terms (friendly name = where it lives)\n${terms}\n`;
}

function buildSystemPrompt(opts: {
  dialect: DataSource["dialect"];
  understanding?: DataUnderstanding;
  dataSection: string;
  largeSchema: boolean;
}): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are Clairvoyance, a friendly senior data analyst. People ask you business questions about their data; you query it and explain the result to someone who does not know SQL or how the data is stored — typically a product manager or business analyst.

# How to work
1. Work out which data answers the question.${opts.largeSchema ? " This is a large database: the tables most likely to matter are described in the user's message; use find_tables to look for anything else." : ""}
2. If unsure about values (how a status is spelled, the date range, whether a join is right), check with explore_data first. Don't guess category spellings.
3. Call run_query with ONE query whose result directly answers the question, shaped for display:
   - Trend over time → one row per period, ordered by time; choose a grain giving roughly 6–60 points.
   - Ranking / comparison → one row per group, sorted, usually LIMIT 15 unless asked for more.
   - Relationship / correlation between two measures → one row per entity (customer, product, day…) with both measures as columns.
   - A single figure → one row.
   - Show names, not IDs (join to get product names, customer names, etc.).
   - Readable column aliases (e.g. month, total_revenue, avg_order_value). Round averages and rates to 2 decimals. Return percentages as 0–100.
4. Finish by calling present_answer exactly once.

# Writing the answer (present_answer)
- Plain English for a business reader. Never mention SQL, queries, tables, columns, rows, joins, snake_case names, or other database jargon in headline, insights, method or labels.
- headline: one sentence that answers the question directly, with the key number(s) nicely formatted ("$1.2M", "34%", "about 4,100 customers").
- insights: up to 3 short bullets (≤ 25 words) that add something the headline doesn't: the biggest mover, an outlier, a caveat. Leave empty rather than pad.
- Relationship questions: describe strength and direction in plain words using the correlation run_query reports, e.g. "a strong positive relationship (r = 0.78)". Mention that it doesn't prove cause and effect only when that matters.
- visual: choose what helps most — kpi (1–4 headline numbers), line (trend), area (cumulative trend), bar (compare/rank groups), pie (share of a whole, ≤ 6 parts), scatter (two measures against each other), table (a list of records or details), none (the headline says it all). Don't force a chart.
- columns: give every result column a friendly label and format (currency with ISO code when it's money).
- method: one plain sentence on how it was worked out, including filters and assumptions ("Paid orders from Jan–Jun 2024, refunds excluded.").
- follow_ups: 2–3 natural next questions the person might ask.
- If the data can't answer the question, say so plainly in the headline, suggest what it can answer instead, and use visual "none".
- Only ask_clarification when the ambiguity would materially change the answer; otherwise make a sensible assumption and state it in method.

# SQL rules
- ${dialectRules(opts.dialect)}
- Read-only SELECT (or WITH … SELECT) statements only, one statement per call.
- Today's date is ${today}.
${glossaryText(opts.understanding)}
# The data
${opts.dataSection}`;
}

function historyToMessages(history: HistoryTurn[]): BetaMessageParam[] {
  const recent = history.slice(-12);
  while (recent.length && recent[0]!.role !== "user") recent.shift();
  return recent
    .filter((h) => h.content?.trim())
    .map((h) => ({
      role: h.role,
      content: h.role === "assistant" && h.sql ? `${h.content}\n\n[Data used for that answer: ${h.sql}]` : h.content,
    }));
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export interface RunAgentOptions {
  question: string;
  history?: HistoryTurn[];
  source: DataSource;
  understanding?: DataUnderstanding;
  sessionId?: string;
  onEvent?: Emit;
  signal?: AbortSignal;
}

export async function runAgent(opts: RunAgentOptions): Promise<AnswerPayload> {
  const { question, source, understanding, sessionId, signal } = opts;
  const emit: Emit = opts.onEvent ?? (async () => {});
  const tables = source.tables;
  const index = buildSchemaIndex(tables);
  const totalColumns = tables.reduce((n, t) => n + t.columns.length, 0);
  const largeSchema = tables.length > FULL_SCHEMA_TABLE_LIMIT || totalColumns > FULL_SCHEMA_COLUMN_LIMIT;

  // Hallucination check only — any real column of any table is allowed.
  const allowedCols = getAllColumnNames(tables);

  let dataSection: string;
  let questionPreamble = "";
  if (largeSchema) {
    if (sessionId) ensureTableEmbeddings(sessionId, tables).catch(() => {});
    await emit({ type: "status", id: "find", label: "Looking for the right data", state: "active" });
    const context = [question, ...(opts.history ?? []).slice(-3).map((h) => h.content)].join("\n");
    const relevant = await findRelevantTables(context, sessionId, tables, index);
    dataSection = compactTableIndex(tables);
    questionPreamble = `Tables most likely relevant to this question:\n\n${schemaToPrompt(relevant, { samples: 1 })}\n\n---\n\n`;
    await emit({ type: "status", id: "find", label: "Looking for the right data", state: "done" });
  } else {
    dataSection = schemaToPrompt(tables, { samples: 2 });
  }

  const system = buildSystemPrompt({ dialect: source.dialect, understanding, dataSection, largeSchema });
  const tools = buildTools(largeSchema);
  const messages: BetaMessageParam[] = [
    ...historyToMessages(opts.history ?? []),
    { role: "user", content: questionPreamble + question },
  ];

  let lastSql: string | undefined;
  let lastRows: Record<string, unknown>[] | undefined;
  let presented: AnswerPayload | undefined;
  let finalText = "";
  let failedQueries = 0;

  await emit({ type: "status", id: "think", label: "Understanding your question", state: "active" });

  for (let turn = 0; turn < MAX_TURNS && !presented; turn++) {
    if (signal?.aborted) throw new Error("Cancelled");

    const response = await createMessage(
      {
        max_tokens: 16000,
        output_config: { effort: "medium" },
        // Prompt caching: tools + system (schema, glossary) are stable across a session.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      },
      { signal }
    );

    if (response.stop_reason === "refusal") {
      finalText = "I can't help with that request.";
      break;
    }

    const text = responseText(response);
    if (text) finalText = text;

    const toolUses = response.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) break;

    if (turn === 0) await emit({ type: "status", id: "think", label: "Understanding your question", state: "done" });

    const results: BetaToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const input = (toolUse.input ?? {}) as Record<string, any>;
      let content: string;
      let isError = false;

      try {
        switch (toolUse.name) {
          case "find_tables": {
            const id = `find-${toolUse.id}`;
            await emit({ type: "status", id, label: "Looking for the right data", detail: String(input.query ?? ""), state: "active" });
            const found = await findRelevantTables(String(input.query ?? ""), sessionId, tables, index, 8);
            content = found.length
              ? schemaToPrompt(found, { samples: 1 })
              : "No matching tables. Try other business terms, or pick from the table index.";
            await emit({ type: "status", id, label: "Looking for the right data", state: "done" });
            break;
          }

          case "explore_data": {
            const id = `explore-${toolUse.id}`;
            const purpose = String(input.purpose ?? "Checking the data");
            await emit({ type: "status", id, label: "Checking the data", detail: purpose, state: "active" });
            try {
              const sql = ensureLimit(validateSQL(String(input.sql ?? ""), allowedCols, source.dialect), EXPLORE_ROW_LIMIT);
              const rows = normalizeRows(await execute(source, sql));
              content = JSON.stringify({ rowCount: rows.length, rows: rows.slice(0, 50) });
              await emit({ type: "status", id, label: "Checking the data", detail: purpose, state: "done" });
            } catch (e) {
              isError = true;
              content = errorForModel(e);
              await emit({ type: "status", id, label: "Checking the data", detail: purpose, state: "done" });
            }
            break;
          }

          case "run_query": {
            const id = `query-${toolUse.id}`;
            await emit({ type: "status", id, label: "Crunching the numbers", state: "active" });
            try {
              const sql = ensureLimit(validateSQL(String(input.sql ?? ""), allowedCols, source.dialect));
              // The SQL may carry its own (larger) LIMIT; never hold more than the cap.
              const rows = normalizeRows((await execute(source, sql)).slice(0, MAX_QUERY_ROWS));
              lastSql = sql;
              lastRows = rows;
              await emit({ type: "sql", sql });
              const cols = profileColumns(rows);
              content = JSON.stringify({
                rowCount: rows.length,
                columns: cols.map((c) => ({ name: c.key, type: c.kind })),
                summary: summarizeForModel(rows, cols),
                preview: rows.slice(0, PREVIEW_ROWS_TO_MODEL),
                ...(rows.length > PREVIEW_ROWS_TO_MODEL && { note: `Preview shows ${PREVIEW_ROWS_TO_MODEL} of ${rows.length} rows; summary covers all rows.` }),
                ...(rows.length === 0 && { note: "No rows. Check your filters/values with explore_data before concluding there is no data." }),
              });
              await emit({
                type: "status", id, label: "Crunching the numbers",
                detail: rows.length === 1 ? "Got the result" : `Got ${rows.length.toLocaleString()} results`, state: "done",
              });
            } catch (e) {
              isError = true;
              failedQueries++;
              content = errorForModel(e);
              await emit({
                type: "status", id, label: "Crunching the numbers",
                detail: failedQueries > 1 ? "Still working on it — trying another approach" : "Adjusting the approach", state: "done",
              });
            }
            break;
          }

          case "present_answer": {
            await emit({ type: "status", id: "present", label: "Writing up the answer", state: "active" });
            presented = buildAnswer({
              headline: String(input.headline ?? finalText ?? ""),
              insights: Array.isArray(input.insights) ? input.insights.map(String) : [],
              method: typeof input.method === "string" ? input.method : undefined,
              followUps: Array.isArray(input.follow_ups) ? input.follow_ups.map(String) : [],
              proposedVisual: input.visual as Partial<Visual> | undefined,
              proposedColumns: Array.isArray(input.columns) ? (input.columns as Array<Partial<ColumnMeta> & { key: string }>) : undefined,
              rows: lastRows,
              sql: lastSql,
              question,
            });
            content = "Delivered.";
            await emit({ type: "status", id: "present", label: "Writing up the answer", state: "done" });
            break;
          }

          case "ask_clarification": {
            const q = String(input.question ?? "Could you clarify what you mean?");
            const options = Array.isArray(input.options) ? input.options.map(String).slice(0, 4) : [];
            presented = { ...buildAnswer({ headline: q, question }), visual: { type: "none" }, clarification: { question: q, options } };
            content = "Asked.";
            break;
          }

          default:
            isError = true;
            content = `Unknown tool ${toolUse.name}`;
        }
      } catch (e) {
        isError = true;
        content = errorForModel(e);
      }

      results.push({ type: "tool_result", tool_use_id: toolUse.id, content, ...(isError && { is_error: true }) });
    }

    // Append-only history: keep the full assistant content (incl. thinking blocks).
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: results });
  }

  // The model ended without present_answer — build the best answer we can.
  const answer =
    presented ??
    buildAnswer({
      headline: finalText || (lastRows ? "Here's what I found." : "Sorry — I couldn't work that one out. Try rephrasing the question."),
      rows: lastRows,
      sql: lastSql,
      question,
    });

  await emit({ type: "result", answer });
  await emit({ type: "done" });
  return answer;
}

async function execute(source: DataSource, sql: string): Promise<Record<string, unknown>[]> {
  if (source.kind === "database") return source.connector.executeQuery(sql);
  return source.db.query(sql).all() as Record<string, unknown>[];
}

function errorForModel(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return e instanceof GuardrailError ? `Rejected: ${message}` : `Query failed: ${message}`;
}

async function findRelevantTables(
  text: string,
  sessionId: string | undefined,
  tables: TableSchema[],
  index: ReturnType<typeof buildSchemaIndex>,
  limit = RELEVANT_TABLES
): Promise<TableSchema[]> {
  const byName = text
    .split(/[\s,]+/)
    .map((w) => findTable(index, w))
    .filter((t): t is TableSchema => !!t);
  const semantic = sessionId ? await searchTablesByEmbedding(sessionId, text, limit, tables) : [];
  const keyword = searchSchema(index, text, limit);

  const merged = new Map<string, TableSchema>();
  // Interleave semantic and keyword results so either signal can surface a table.
  for (const t of byName) merged.set(t.name, t);
  for (let i = 0; i < Math.max(semantic.length, keyword.length) && merged.size < limit; i++) {
    const s = semantic[i], k = keyword[i];
    if (s && merged.size < limit) merged.set(s.name, s);
    if (k && merged.size < limit) merged.set(k.name, k);
  }
  const seed = merged.size ? Array.from(merged.values()) : largestTables(tables, 8);
  return withRelatedTables(index, seed, Math.max(limit, RELEVANT_WITH_RELATED));
}
